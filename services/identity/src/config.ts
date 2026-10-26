import type { SelfMode } from "./models.js";

export interface Config {
  port: number;
  dataDir: string;
  secret: string;
  adminToken: string;
  selfMode: SelfMode;
  selfEndpoint: string;
  webUrl: string;
}

function required(env: NodeJS.ProcessEnv, name: string): string {
  const value = env[name];
  if (!value || value.length < 24) throw new Error(`invalid_configuration:${name}`);
  if (env.CANDOR_MODE === "production" && value.startsWith("dev-")) {
    throw new Error(`invalid_configuration:${name}`);
  }
  return value;
}

function url(value: string, name: string): URL {
  try {
    const parsed = new URL(value);
    if (
      !["https:", "http:"].includes(parsed.protocol) ||
      parsed.username ||
      parsed.password ||
      parsed.hash ||
      parsed.search
    ) {
      throw new Error();
    }
    return parsed;
  } catch {
    throw new Error(`invalid_configuration:${name}`);
  }
}

export function readConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const port = Number(env.PORT ?? 8787);
  if (!Number.isInteger(port) || port < 1 || port > 65535)
    throw new Error("invalid_configuration:PORT");
  const mode = env.SELF_MODE ?? "mock";
  if (mode !== "mock" && mode !== "staging" && mode !== "mainnet")
    throw new Error("invalid_configuration:SELF_MODE");
  if (env.CANDOR_MODE === "production" && mode === "mock")
    throw new Error("invalid_configuration:SELF_MODE");
  const endpoint =
    env.SELF_ENDPOINT || (mode === "mock" ? `http://localhost:${port}/v1/self/verify` : "");
  const parsedEndpoint = url(endpoint, "SELF_ENDPOINT");
  if (mode !== "mock" && parsedEndpoint.protocol !== "https:")
    throw new Error("invalid_configuration:SELF_ENDPOINT");
  const web = url(env.CANDOR_WEB_URL ?? "http://localhost:3000", "CANDOR_WEB_URL");
  if (web.pathname !== "/") throw new Error("invalid_configuration:CANDOR_WEB_URL");
  return {
    port,
    dataDir: env.CANDOR_DATA_DIR || "./data",
    secret: required(env, "CANDOR_IDENTITY_SECRET"),
    adminToken: required(env, "CANDOR_IDENTITY_ADMIN_TOKEN"),
    selfMode: mode,
    selfEndpoint: parsedEndpoint.href,
    webUrl: web.origin,
  };
}
