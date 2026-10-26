import { mkdirSync } from "node:fs";
import { resolve } from "node:path";

import { serve } from "@hono/node-server";

import { createApp, jsonLogger } from "./app.js";
import { readConfig } from "./config.js";
import { SqliteStore } from "./store.js";

function main(): void {
  const config = readConfig();
  mkdirSync(config.dataDir, { recursive: true, mode: 0o700 });
  const store = new SqliteStore(resolve(config.dataDir, "identity.db"));
  store.purge(Date.now());
  const app = createApp({ config, store });
  const server = serve({ fetch: app.fetch, port: config.port }, () =>
    jsonLogger({ event: "started" }),
  );
  const purge = setInterval(() => {
    try {
      store.purge(Date.now());
    } catch {
      jsonLogger({ event: "purge_failed" });
    }
  }, 60_000);
  purge.unref();
  let stopping = false;
  const stop = (): void => {
    if (stopping) return;
    stopping = true;
    clearInterval(purge);
    const deadline = setTimeout(() => process.exit(1), 30_000);
    deadline.unref();
    server.close((error) => {
      clearTimeout(deadline);
      store.close();
      jsonLogger({ event: error ? "shutdown_failed" : "stopped" });
      process.exitCode = error ? 1 : 0;
    });
    if ("closeIdleConnections" in server) server.closeIdleConnections();
  };
  server.on("error", () => {
    jsonLogger({ event: "startup_failed" });
    process.exitCode = 1;
    stop();
  });
  process.once("SIGTERM", stop);
  process.once("SIGINT", stop);
}

try {
  main();
} catch {
  jsonLogger({ event: "startup_failed" });
  process.exitCode = 1;
}
