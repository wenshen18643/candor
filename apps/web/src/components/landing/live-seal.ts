import type { SealResult } from "./demo-data";

export async function sealInBrowser(plaintext: string, names: string[]): Promise<SealResult> {
  const candor = await import("@candor/crypto");
  await candor.ready();
  const reportId = crypto.randomUUID();
  const associated = candor.context("file/0", reportId);
  const reportKey = candor.randomKey();
  const box = candor.encryptBox(reportKey, candor.utf8(plaintext), associated);
  const recipients = names.map(() => candor.generateBoxKeyPair());
  const shares = await candor.splitKey(reportKey, recipients.length, 2);
  const sealed = shares.map((share, index) => {
    const recipient = recipients[index];
    if (!recipient) throw new Error("Missing recipient");
    return candor.sealKey(share, recipient.publicKey);
  });
  const quorum = [0, recipients.length - 1].map((index) => {
    const recipient = recipients[index];
    const envelope = sealed[index];
    if (!recipient || !envelope) throw new Error("Missing share");
    return candor.openSealedKey(envelope, recipient.publicKey, recipient.privateKey);
  });
  const rebuilt = await candor.combineShares(quorum);
  const opened = new TextDecoder().decode(candor.decryptBox(rebuilt, box, associated));
  return {
    live: true,
    ciphertext: box.c,
    nonce: box.n,
    keyHex: candor.toHex(reportKey),
    shares: names.map((name, index) => ({
      reviewer: name,
      sealed: sealed[index] ?? "",
      keyId: candor.keyId(recipients[index]?.publicKey ?? new Uint8Array(32)),
    })),
    verified: opened === plaintext,
  };
}
