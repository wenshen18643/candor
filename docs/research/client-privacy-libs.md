# Browser privacy libraries: verified package/API notes

Verified **2026-10-26** using live npm metadata, release READMEs/types/source, Node **24.15.0**, and esbuild **0.28.2**. All installs, fixtures and bundles were under `%TEMP%`. This is a library integration study, not a claim of complete document anonymization.

## Current versions, ESM/Node support and measured bundle sizes

All versions below were npm `dist-tags.latest` on the verification date and were installed. Every selected browser entry compiled with `--bundle --minify --platform=browser --format=esm --target=es2022`. Sizes are **KiB (1024 bytes), minified / gzip-9**, including bundled dependencies, excluding source maps; they are not npm unpacked sizes or predictions of a Next.js chunk. Exports retained: PDFDocument/PDFName/PDFDict/PDFStream, unpdf extraction/proxy, PDF.js getDocument/GlobalWorkerOptions, exifr parse/gps, phone finder, Shamir split/combine, noble SHA-256/BLAKE2b; default exports for other rows.

| Package (registry evidence) | ESM / browser entry | Node support | Measured KiB min / gzip |
|---|---|---|---|
| [`pdf-lib@1.17.1`](https://registry.npmjs.org/pdf-lib/1.17.1) | ESM `es/index.js` via bundler `module`; CJS root also works | Tested; no declared minimum | 421.6 / 174.5 |
| [`unpdf@1.9.1`](https://registry.npmjs.org/unpdf/1.9.1) | Native ESM + CJS; `unpdf` | >=22; tested | 1586.0 / 494.1 |
| [`pdfjs-dist@6.4.299`](https://registry.npmjs.org/pdfjs-dist/6.4.299) | Native ESM `build/pdf.mjs` | >=22.13.0 or >=24; use legacy build | 421.2 / 126.1 |
| [`mammoth@1.13.0`](https://registry.npmjs.org/mammoth/1.13.0) | UMD/CJS `mammoth/mammoth.browser.js`; bundler interop | >=12; browser entry tested in Node | 300.4 / 90.3 |
| [`jszip@3.10.2`](https://registry.npmjs.org/jszip/3.10.2) | CJS/UMD with browser mapping; bundler interop | Tested; no declared minimum | 96.5 / 29.6 |
| [`exifr@7.1.3`](https://registry.npmjs.org/exifr/7.1.3) | Native `exifr/dist/full.esm.mjs`; UMD root | Tested; no declared minimum | 72.5 / 25.3 |
| [`postal-mime@4.1.4`](https://registry.npmjs.org/postal-mime/4.1.4) | Native ESM + CJS exports | >=20; tested | 87.2 / 27.9 |
| [`compromise@14.19.0`](https://registry.npmjs.org/compromise/14.19.0) | Native ESM + CJS exports | >=18; tested | 356.6 / 148.0 |
| [`libphonenumber-js@1.13.15`](https://registry.npmjs.org/libphonenumber-js/1.13.15) | Native ESM + CJS exports | Tested; no declared minimum | 141.6 / 35.0 |
| [`shamir-secret-sharing@0.0.4`](https://registry.npmjs.org/shamir-secret-sharing/0.0.4) | Native ESM + CJS; browser/Node RNG conditions | Tested; no declared minimum | 4.9 / 2.0 |
| [`@noble/hashes@2.4.0`](https://registry.npmjs.org/@noble%2fhashes/2.4.0) | Native ESM; explicit `.js` subpaths | >=20.19.0; tested | 11.5 / 4.7 |

PDF.js additionally needs its **matching worker**: `build/pdf.worker.min.mjs` is **1234.7 / 365.3 KiB** in this release. CMaps/fonts/WASM assets are additional if needed by the documents. unpdf's measurement already includes its inline PDF.js worker implementation. These are substantial lazy-loaded dependencies.

```powershell
npm install --save-exact pdf-lib@1.17.1 unpdf@1.9.1 pdfjs-dist@6.4.299 mammoth@1.13.0 jszip@3.10.2 exifr@7.1.3 postal-mime@4.1.4 compromise@14.19.0 libphonenumber-js@1.13.15 shamir-secret-sharing@0.0.4 @noble/hashes@2.4.0
# Reproduce measurements from small entry files exporting the APIs listed above:
npm install --save-dev --save-exact esbuild@0.28.2
npx esbuild entry.mjs --bundle --minify --platform=browser --format=esm --target=es2022 --outfile=out.mjs
```

No library requires API keys or env vars. Avoid sending documents to a server for these operations. Serve parser worker/assets locally with pinned versions; remote URLs are unnecessary. Browser crypto requires secure randomness. Node checks and browser-target builds passed; **no actual browser session or Next.js/Turbopack application build was run**.

## PDF Info dictionary and XMP removal (`pdf-lib`)

Deleting a catalog reference alone can leave the old indirect object serialized in the output. Delete the referenced objects as well. This tested low-level API removes trailer Info and `/Metadata` entries on indirect dictionaries/streams:

```js
import { PDFDocument, PDFName, PDFDict, PDFStream } from 'pdf-lib';
export async function stripPdfMetadata(input) { // Uint8Array -> Promise<Uint8Array>
  const doc = await PDFDocument.load(input, { updateMetadata: false });
  const info = doc.context.trailerInfo.Info;
  if (info) doc.context.delete(info);
  delete doc.context.trailerInfo.Info;
  for (const [, obj] of doc.context.enumerateIndirectObjects()) {
    const dict = obj instanceof PDFDict ? obj : obj instanceof PDFStream ? obj.dict : null;
    if (!dict) continue;
    const ref = dict.get(PDFName.of('Metadata'));
    if (ref) {
      dict.delete(PDFName.of('Metadata'));
      if (typeof ref.objectNumber === 'number') doc.context.delete(ref);
    }
  }
  return doc.save({ useObjectStreams: false });
}
```

`updateMetadata:false` prevents pdf-lib inserting fresh producer/dates during load. Do not call metadata getters/setters afterward (they can create an Info dictionary). `useObjectStreams:false` made the fixture auditable; it is not required for deletion. Test created an author and XMP stream, saved/reloaded, removed them, checked no Info/catalog Metadata remained, checked marker bytes disappeared, and extracted the original page text successfully.

This is **metadata removal, not PDF redaction**: nested direct dictionaries, orphan objects not reached by these references, trailer `/ID`, annotations, attachments, form values, embedded image metadata and visible content can still identify a source. Saving also changes signed PDFs. Do not market this snippet as a complete anonymizer or encryption bypass.

## PDF text extraction in a Next.js 15 client

Use a client event handler so imports and processing happen after a user selects a file. The following unpdf path requires **no separate worker setup**; its bundled worker runs in-process. For responsiveness with large files, wrap it in your own Web Worker and terminate the worker on timeout.

```jsx
'use client';
export default function PdfTextInput() {
  return <input type="file" accept="application/pdf" onChange={async event => {
    const file = event.target.files?.[0];
    if (!file) return;
    const { getDocumentProxy, extractText } = await import('unpdf');
    const pdf = await getDocumentProxy(new Uint8Array(await file.arrayBuffer()));
    try {
      const { totalPages, text } = await extractText(pdf, { mergePages: true });
      // Consume text locally; totalPages is a number, text is a string.
      event.target.dataset.pages = String(totalPages);
    } finally { await pdf.loadingTask.destroy(); }
  }} />;
}
```

`extractText(dataOrProxy, {mergePages:true})` returns `Promise<{totalPages:number,text:string}>`; false/omitted returns `text:string[]`. A caller-supplied proxy remains caller-owned. **PDF.js 6 removed `PDFDocumentProxy.destroy()`**: that older call threw in our test; `pdf.loadingTask.destroy()` succeeded. No OCR is provided for image-only PDFs. The unpdf 1.9.1 bundled PDF.js is **6.4.299** and requires global `Iterator` (README: Safari 18.4+); it polyfills some other new APIs.

For a separate real PDF.js worker, copy the **same installed version's** file to the app's static assets during build (example command is for future integration, not executed in this repository):

```powershell
Copy-Item node_modules/pdfjs-dist/build/pdf.worker.min.mjs public/pdf.worker.min.mjs
```

Then call this only on the client:

```js
export async function pdfText(file) {
  const pdfjs = await import('pdfjs-dist/build/pdf.mjs');
  pdfjs.GlobalWorkerOptions.workerSrc = '/pdf.worker.min.mjs';
  const task = pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) });
  try {
    const pdf = await task.promise, pages = [];
    for (let i = 1; i <= pdf.numPages; i++) {
      const content = await (await pdf.getPage(i)).getTextContent();
      pages.push(content.items.filter(x => 'str' in x).map(x => x.str).join(' '));
    }
    return pages.join('\n'); // Basic extraction; not layout-preserving reading order.
  } finally { await task.destroy(); }
}
```

PDF.js modern import under Node 24.15.0 warned to use legacy, then extraction failed with `hashOriginal.toHex is not a function`. The same fixture passed using **`pdfjs-dist/legacy/build/pdf.mjs`**. unpdf's default build also passed. Never infer Node compatibility solely from the package engine range.

Next.js/Turbopack integration notes (documentation-based, not an app-build test): `'use client'` does not make every top-level import browser-only during prerendering. Lazy import browser-dependent libraries in events/effects; `dynamic(...,{ssr:false})` must be declared in a Client Component. A same-origin static worker path avoids bundler-specific `new URL(...,import.meta.url)` resolution. Ensure basePath/asset hosting and CSP `worker-src` allow that URL and return JavaScript, not an HTML fallback. Webpack configuration does not configure Turbopack; use the version-appropriate `turbopack` options (called `experimental.turbo` before Next 15.3). No Node polyfills were needed for the selected browser bundles.

## DOCX extraction and docProps rewriting

```js
import mammoth from 'mammoth/mammoth.browser.js';
import JSZip from 'jszip';
export async function processDocx(arrayBuffer) {
  const { value: text, messages } = await mammoth.extractRawText({ arrayBuffer });
  const zip = await JSZip.loadAsync(arrayBuffer);
  const replacements = {
    'docProps/core.xml': '<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties"/>',
    'docProps/app.xml': '<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties"/>',
    'docProps/custom.xml': '<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/custom-properties"/>',
  };
  for (const [path, xml] of Object.entries(replacements)) {
    if (zip.file(path)) zip.file(path, xml); // Preserve part names and relationships.
  }
  zip.comment = '';
  zip.forEach((path, entry) => { entry.date = new Date('1980-01-01T00:00:00Z'); entry.comment = ''; });
  const sanitized = await zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' });
  return { text, messages, sanitized };
}
```

Mammoth browser input is **`{arrayBuffer}`**; the Node root entry supports `{buffer: Buffer}` or `{path}`. Return type is `Promise<{value:string,messages:Array}>`. Browser file buffers were tested against a synthetic DOCX. The explicit browser entry is UMD/CJS, not native ESM; ESM default-import interop and bundling worked. Its subpath has no dedicated type declaration; TypeScript strict projects may need an ambient module declaration reusing `mammoth`'s root types.

Tested JSZip load/rewrite/generate/reload with the creator removed and text preserved. Replacement keeps package relationships valid for existing parts. `docProps/thumbnail.*`, document comments/revisions/authors, hidden text, embedded media and custom XML need separate handling; deleting parts requires updating OPC relationships/content types. ZIP entry names and other metadata can still disclose information. Reject oversized/decompression-heavy inputs. `extractRawText` loses formatting; Mammoth HTML output and mail HTML below are not sanitized HTML.

## EXIF/GPS, EML, entities and phone numbers

```js
import { parse, gps } from 'exifr/dist/full.esm.mjs';
import PostalMime from 'postal-mime';
import nlp from 'compromise';
import { findPhoneNumbersInText } from 'libphonenumber-js';
export async function inspect(photoFile, emlFile, text) {
  const photo = new Uint8Array(await photoFile.arrayBuffer());
  const tags = await parse(photo); // Promise<object|undefined>
  const coordinates = await gps(photo); // {latitude,longitude}|undefined
  const email = await PostalMime.parse(await emlFile.arrayBuffer());
  const doc = nlp(text);
  const entities = { people: doc.people().out('array'), places: doc.places().out('array'),
    organizations: doc.organizations().out('array') };
  const phones = findPhoneNumbersInText(text, 'US').map(hit => ({
    start: hit.startsAt, end: hit.endsAt, e164: hit.number.number,
  }));
  return { tags, coordinates, email, entities, phones };
}
```

- exifr reads metadata; **it does not remove it**. Explicit full ESM entry avoids depending on Node's UMD root choice. Tested TIFF Make and GPS: latitude 3.1333333333333333, longitude 101.68333333333334. Browser `File`/`Blob`, ArrayBuffer/typed arrays are supported inputs; Node can use buffers/paths. Missing GPS is not proof of absent identifying metadata; defaults do not imply every optional segment was parsed.
- postal-mime **4.x**: `PostalMime.parse(rawEmail, options?) -> Promise<Email>` or `new PostalMime(options?).parse(rawEmail)` (one use per instance). Text, ArrayBuffer and other binary inputs are supported. Fields include `from`, `to`, `subject`, `headers`, `text`, `html`, `attachments`; optional fields may be absent. Parsing preserves headers and attachments; it does not anonymize mail. Never insert unsanitized `html` or automatically load remote image URLs.
- compromise is English rule/lexicon-based NLP, not comprehensive multilingual PII detection. Fixture `Barack Obama visited Paris and Microsoft.` yielded `Barack Obama`, `Paris`, `Microsoft.` (punctuation retained). Treat matches as review suggestions; absence is not privacy assurance.
- `findPhoneNumbersInText(text, defaultCountryOrOptions?)` returns `{startsAt, endsAt, number:PhoneNumber}[]`; offsets are JS string indices. International E.164 is `number.number`. Set the default country from context, not always US. Root/min metadata was tested; use `libphonenumber-js/max` for fuller validation/type data, with a larger bundle. `searchPhoneNumbersInText` offers an iterator for long text.

## Shamir sharing and hashes

```js
import { split, combine } from 'shamir-secret-sharing';
import { sha256 } from '@noble/hashes/sha2.js';
import { blake2b } from '@noble/hashes/blake2.js';
import { bytesToHex } from '@noble/hashes/utils.js';
const key = crypto.getRandomValues(new Uint8Array(32));
const shares = await split(key, 3, 2); // Promise<Uint8Array[]>; three 33-byte shares
const recovered = await combine([shares[0], shares[2]]); // Promise<Uint8Array>
const digest = bytesToHex(sha256(recovered));
const blake = blake2b(recovered, { dkLen: 32 }); // Uint8Array
```

`shamir-secret-sharing@0.0.4` is the Privy package. Signature: `split(secret:Uint8Array, shares:number, threshold:number)`; `combine(shares:Uint8Array[])`. Require `2 <= threshold <= shares <= 255`. Tested 2-of-3 reconstruction matched all 32 bytes. Corrupt/mixed shares can reconstruct wrong bytes without an error: verify reconstruction through the encrypted payload's authentication tag. Split random encryption keys; preserve complete shares including their index byte.

`@noble/hashes@2.4.0` uses **`.js` export paths**; old `@noble/hashes/sha256` snippets are wrong for this major version. SHA-256 of UTF-8 `abc` matched `ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad`; BLAKE2b `{dkLen:32}` returned 32 bytes. Root import is not a hash-function namespace. Use `TextEncoder` for string inputs and keep raw/hex encodings explicit.

## Evidence and sources

Executed Node fixture coverage: PDF metadata-object deletion/reload/text extraction; Mammoth browser-entry DOCX extraction; JSZip rewriting; EXIF/GPS parsing; EML parsing; NER result inspection; two phone matches/offsets; Shamir round trip; noble known-answer hash. All passed. Separately tested PDF.js modern failure and legacy success. Browser-target bundles all passed; actual browser and Turbopack runtime remain unverified.

- Registry links in the table establish exact package names/versions and declared engines/exports.
- [pdf-lib source/API](https://github.com/Hopding/pdf-lib), [unpdf README](https://github.com/unjs/unpdf), [PDF.js examples](https://mozilla.github.io/pdf.js/examples/).
- [Mammoth README/browser API](https://github.com/mwilliamson/mammoth.js), [JSZip loadAsync](https://stuk.github.io/jszip/documentation/api_jszip/load_async.html), [JSZip generateAsync](https://stuk.github.io/jszip/documentation/api_jszip/generate_async.html).
- [exifr](https://github.com/MikeKovarik/exifr), [postal-mime](https://github.com/postalsys/postal-mime), [compromise](https://github.com/spencermountain/compromise), [libphonenumber-js](https://github.com/catamphetamine/libphonenumber-js).
- [Privy Shamir](https://github.com/privy-io/shamir-secret-sharing), [noble-hashes](https://github.com/paulmillr/noble-hashes).
- [Next.js 15 lazy loading](https://nextjs.org/docs/15/app/guides/lazy-loading), [Next.js 15 Turbopack configuration](https://nextjs.org/docs/15/app/api-reference/config/next-config-js/turbopack).
