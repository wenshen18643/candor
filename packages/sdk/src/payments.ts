import { randomKey, toHex, utf8 } from "@candor/crypto";

import type { PaymentRequirements } from "./types.js";

export type PaymentAuthorization = {
  from: string;
  to: string;
  value: string;
  validAfter: string;
  validBefore: string;
  nonce: string;
};
export type WalletTypedData = {
  domain: { name: string; version: string; chainId: number; verifyingContract: string };
  types: { TransferWithAuthorization: { name: string; type: string }[] };
  primaryType: "TransferWithAuthorization";
  message: PaymentAuthorization;
};
export interface WalletSigner {
  address: string;
  signTypedData(data: WalletTypedData): Promise<string>;
}
export type PaymentOptions = {
  mode?: "mock" | "testnet";
  wallet?: WalletSigner;
  payer?: string;
  nonce?: string;
  now?: number;
};

function encodePayment(value: unknown): string {
  return btoa(
    Array.from(utf8(JSON.stringify(value)), (byte) => String.fromCharCode(byte)).join(""),
  );
}

export async function createPayment(
  requirements: PaymentRequirements,
  options: PaymentOptions = {},
): Promise<string> {
  const mode =
    options.mode ??
    (typeof process !== "undefined" && process.env.X402_MODE === "testnet" ? "testnet" : "mock");
  const nonce = options.nonce ?? `0x${toHex(randomKey())}`;
  const payer =
    mode === "testnet"
      ? options.wallet?.address
      : (options.payer ?? "0x0000000000000000000000000000000000000001");
  if (!payer || !/^0x[0-9a-fA-F]{40}$/.test(payer) || !/^0x[0-9a-fA-F]{64}$/.test(nonce))
    throw new Error("Invalid payment identity");
  if (
    requirements.scheme !== "exact" ||
    requirements.network !== "base-sepolia" ||
    !/^\d+$/.test(requirements.maxAmountRequired) ||
    !/^0x[0-9a-fA-F]{40}$/.test(requirements.payTo) ||
    !/^0x[0-9a-fA-F]{40}$/.test(requirements.asset) ||
    !Number.isSafeInteger(requirements.maxTimeoutSeconds) ||
    requirements.maxTimeoutSeconds <= 0
  )
    throw new Error("Unsupported payment requirements");
  const envelope = { x402Version: 1, scheme: requirements.scheme, network: requirements.network };
  if (mode === "mock") return encodePayment({ ...envelope, payload: { mock: true, payer, nonce } });
  if (!options.wallet) throw new Error("Wallet signer required");
  const now = Math.floor((options.now ?? Date.now()) / 1000);
  const authorization: PaymentAuthorization = {
    from: payer,
    to: requirements.payTo,
    value: requirements.maxAmountRequired,
    validAfter: String(now - 60),
    validBefore: String(now + requirements.maxTimeoutSeconds),
    nonce,
  };
  const signature = await options.wallet.signTypedData({
    domain: {
      name: requirements.extra?.name ?? "USDC",
      version: requirements.extra?.version ?? "2",
      chainId: 84532,
      verifyingContract: requirements.asset,
    },
    types: {
      TransferWithAuthorization: [
        { name: "from", type: "address" },
        { name: "to", type: "address" },
        { name: "value", type: "uint256" },
        { name: "validAfter", type: "uint256" },
        { name: "validBefore", type: "uint256" },
        { name: "nonce", type: "bytes32" },
      ],
    },
    primaryType: "TransferWithAuthorization",
    message: authorization,
  });
  if (!/^0x[0-9a-fA-F]{130}$/.test(signature)) throw new Error("Invalid wallet signature");
  return encodePayment({ ...envelope, payload: { signature, authorization } });
}
