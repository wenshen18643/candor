import { randomBytes } from "node:crypto";

import { describe, expect, it } from "vitest";

import { readConfig } from "../src/config.js";

function environment(): NodeJS.ProcessEnv {
  return {
    CANDOR_IDENTITY_SECRET: randomBytes(32).toString("hex"),
    CANDOR_IDENTITY_ADMIN_TOKEN: randomBytes(32).toString("hex"),
  };
}

describe("configuration", () => {
  it("uses offline demo defaults and honors explicit configuration", () => {
    const env = environment();
    expect(readConfig(env)).toMatchObject({
      port: 8787,
      dataDir: "./data",
      selfMode: "mock",
      selfEndpoint: "http://localhost:8787/v1/self/verify",
      webUrl: "http://localhost:3000",
    });
    expect(
      readConfig({
        ...env,
        PORT: "9000",
        CANDOR_DATA_DIR: "identity-data",
        SELF_MODE: "mainnet",
        SELF_ENDPOINT: "https://identity.example/v1/self/verify",
        CANDOR_WEB_URL: "https://candor.example/",
      }),
    ).toMatchObject({
      port: 9000,
      dataDir: "identity-data",
      selfMode: "mainnet",
      webUrl: "https://candor.example",
    });
  });

  it.each([
    { PORT: "0" },
    { PORT: "65536" },
    { PORT: "1.5" },
    { SELF_MODE: "unknown" },
    { CANDOR_IDENTITY_SECRET: "" },
    { CANDOR_IDENTITY_ADMIN_TOKEN: "short" },
    { SELF_MODE: "staging" },
    { SELF_MODE: "mainnet", SELF_ENDPOINT: "http://identity.example/verify" },
    { CANDOR_WEB_URL: "https://user:password@web.example" },
    { CANDOR_WEB_URL: "https://web.example/subpath" },
    { CANDOR_MODE: "production", SELF_MODE: "mock" },
    {
      CANDOR_MODE: "production",
      SELF_MODE: "mainnet",
      SELF_ENDPOINT: "https://identity.example",
      CANDOR_IDENTITY_SECRET: "dev-identity-secret-change-me",
    },
  ])("fails closed for invalid configuration %#", (changes) => {
    expect(() => readConfig({ ...environment(), ...changes })).toThrow("invalid_configuration");
  });
});
