export const utf8 = (text: string): Uint8Array => new TextEncoder().encode(text);

export const toHex = (bytes: Uint8Array): string =>
  Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");

export function fromHex(text: string): Uint8Array {
  if (!/^(?:[0-9a-f]{2})*$/.test(text)) throw new Error("Invalid hexadecimal encoding");
  return Uint8Array.from(text.match(/../g) ?? [], (pair) => parseInt(pair, 16));
}

function encode(bytes: Uint8Array): string {
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += 8192)
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 8192));
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function decode(text: string): Uint8Array {
  if (!/^[A-Za-z0-9_-]*$/.test(text) || text.length % 4 === 1)
    throw new Error("Invalid base64url encoding");
  const bytes = Uint8Array.from(atob(text.replace(/-/g, "+").replace(/_/g, "/")), (c) =>
    c.charCodeAt(0),
  );
  if (encode(bytes) !== text) throw new Error("Noncanonical base64url encoding");
  return bytes;
}

export const b64u = { encode, decode };

export function padmeLength(length: number): number {
  if (!Number.isSafeInteger(length) || length < 4 || length > 0xffffffff + 4)
    throw new RangeError("Invalid frame length");
  const exponent = Math.floor(Math.log2(length));
  const quantum = 2 ** (exponent - Math.floor(Math.log2(exponent)) - 1);
  return Math.ceil(length / quantum) * quantum;
}

export function padmeFrame(plaintext: Uint8Array): Uint8Array {
  const framed = new Uint8Array(padmeLength(plaintext.length + 4));
  new DataView(framed.buffer).setUint32(0, plaintext.length);
  framed.set(plaintext, 4);
  return framed;
}

export function padmeUnframe(framed: Uint8Array): Uint8Array {
  if (framed.length < 4) throw new Error("Invalid frame");
  const length = new DataView(framed.buffer, framed.byteOffset, framed.byteLength).getUint32(0);
  if (
    length + 4 > framed.length ||
    padmeLength(length + 4) !== framed.length ||
    framed.subarray(length + 4).some((b) => b !== 0)
  )
    throw new Error("Invalid frame");
  return framed.slice(4, length + 4);
}

export const context = (purpose: string, reportId: string): Uint8Array =>
  utf8(`candor/v1/${purpose}/${reportId}`);

export function jsonBytes(value: unknown): Uint8Array {
  const text = JSON.stringify(value);
  if (text === undefined) throw new TypeError("Value is not JSON");
  return utf8(sortedJson(JSON.parse(text) as unknown));
}

function compareKeys(left: string, right: string): number {
  const a = Array.from(left, (character) => character.codePointAt(0)!);
  const b = Array.from(right, (character) => character.codePointAt(0)!);
  for (let index = 0; index < Math.min(a.length, b.length); index++) {
    if (a[index] !== b[index]) return a[index]! - b[index]!;
  }
  return a.length - b.length;
}

function sortedJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(sortedJson).join(",")}]`;
  if (value !== null && typeof value === "object") {
    const object = value as Record<string, unknown>;
    return `{${Object.keys(object)
      .sort(compareKeys)
      .map((key) => `${JSON.stringify(key)}:${sortedJson(object[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

export function parseJson<T>(bytes: Uint8Array): T {
  return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)) as T;
}
