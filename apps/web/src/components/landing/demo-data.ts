export type PiiKind = "person" | "org" | "email";

export type EmailSegment =
  | { kind: "text"; text: string }
  | { kind: "pii"; text: string; type: PiiKind; placeholder: string };

export const emailSegments: EmailSegment[] = [
  { kind: "text", text: "From: " },
  { kind: "pii", text: "Dana Whitfield", type: "person", placeholder: "PERSON_1" },
  { kind: "text", text: " <" },
  { kind: "pii", text: "d.whitfield@northwind.example", type: "email", placeholder: "EMAIL_1" },
  { kind: "text", text: ">\nDate: 5 Mar 2026\n\n" },
  { kind: "pii", text: "Priya", type: "person", placeholder: "PERSON_5" },
  { kind: "text", text: " — please update the technical score for " },
  { kind: "pii", text: "MedAxis Supply", type: "org", placeholder: "ORG_2" },
  { kind: "text", text: " from 61 to 78 before the sheet goes to " },
  { kind: "pii", text: "Elena Sorensen", type: "person", placeholder: "PERSON_4" },
  {
    kind: "text",
    text: " on Friday. The committee already agreed verbally, so no need to recirculate.\n\nThanks, ",
  },
  { kind: "pii", text: "Dana", type: "person", placeholder: "PERSON_1" },
];

export const originalEmail = emailSegments.map((segment) => segment.text).join("");

export const piiSummary = (() => {
  const found = emailSegments.filter((segment) => segment.kind === "pii");
  const people = found.filter((segment) => segment.type === "person");
  return {
    total: found.length,
    personMentions: people.length,
    distinctPeople: new Set(people.map((segment) => segment.placeholder)).size,
    orgs: found.filter((segment) => segment.type === "org").length,
    emails: found.filter((segment) => segment.type === "email").length,
  };
})();

export const nameMap = [
  { placeholder: "PERSON_1", value: "Dana Whitfield", variants: ["Dana"] },
  { placeholder: "PERSON_4", value: "Elena Sorensen", variants: [] },
  { placeholder: "PERSON_5", value: "Priya Raman", variants: ["Priya"] },
  { placeholder: "ORG_2", value: "MedAxis Supply", variants: [] },
  { placeholder: "EMAIL_1", value: "d.whitfield@northwind.example", variants: [] },
];

export const reviewers = [
  { name: "Avery Chen", role: "Admin" },
  { name: "Morgan Ellis", role: "Reviewer" },
  { name: "Riley Park", role: "Auditor" },
];

export function padmeLength(length: number) {
  const exponent = Math.floor(Math.log2(length));
  const quantum = 2 ** (exponent - Math.floor(Math.log2(exponent)) - 1);
  return Math.ceil(length / quantum) * quantum;
}

export function b64uLength(bytes: number) {
  return Math.ceil((bytes * 8) / 6);
}

export function byteSizes(text: string) {
  const plain = new TextEncoder().encode(text).length;
  const framed = plain + 4;
  const padded = padmeLength(framed);
  const sealed = padded + 16;
  return { plain, framed, padded, sealed, encoded: b64uLength(sealed) };
}

export const emailSizes = byteSizes(originalEmail);

const b64uAlphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
const hexAlphabet = "0123456789abcdef";

function seededChars(length: number, seed: number, alphabet: string) {
  let state = seed >>> 0;
  let out = "";
  for (let index = 0; index < length; index += 1) {
    state = (state + 0x6d2b79f5) >>> 0;
    let mixed = state;
    mixed = Math.imul(mixed ^ (mixed >>> 15), mixed | 1);
    mixed ^= mixed + Math.imul(mixed ^ (mixed >>> 7), mixed | 61);
    out += alphabet[((mixed ^ (mixed >>> 14)) >>> 0) % alphabet.length];
  }
  return out;
}

export const randomB64uChar = () => b64uAlphabet[Math.floor(Math.random() * 64)] ?? "A";

export type SealedShare = { reviewer: string; sealed: string; keyId: string };

export type SealResult = {
  live: boolean;
  ciphertext: string;
  nonce: string;
  keyHex: string;
  shares: SealedShare[];
  verified: boolean;
};

export const illustrativeSeal: SealResult = {
  live: false,
  ciphertext: seededChars(emailSizes.encoded, 7, b64uAlphabet),
  nonce: seededChars(b64uLength(24), 11, b64uAlphabet),
  keyHex: seededChars(64, 13, hexAlphabet),
  shares: reviewers.map((reviewer, index) => ({
    reviewer: reviewer.name,
    sealed: seededChars(b64uLength(33 + 48), 20 + index, b64uAlphabet),
    keyId: seededChars(32, 30 + index, hexAlphabet),
  })),
  verified: false,
};
