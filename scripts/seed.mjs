import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { handleSignals, isMain, loadEnvironment, Processes, root } from "./dev.mjs";

export async function hasDemoSeed(directory = root) {
  try {
    const manifest = JSON.parse(await readFile(resolve(directory, "packages/sdk/package.json"), "utf8"));
    return typeof manifest.scripts?.["seed:demo"] === "string";
  } catch (error) {
    if (error.code === "ENOENT") return false;
    throw error;
  }
}

export async function seed({ directory = root, env = loadEnvironment(process.env, directory), runner } = {}) {
  const processes = runner || new Processes(env);
  const removeSignals = handleSignals(processes);
  try {
    const reset = await processes.start("seed", "uv", ["run", "--project", "services/api", "candor-api", "seed", "--reset"], { persistent: false, quiet: true }).completion;
    if (reset !== 0 || processes.controller.signal.aborted) return reset || 1;
    console.log("[seed] API reset and demo identities created.");
    if (!(await hasDemoSeed(directory))) {
      console.warn("[seed] SDK seed:demo is not available yet. Once implemented, start pnpm dev, then run pnpm --filter @candor/sdk seed:demo.");
      return 0;
    }
    const refreshed = loadEnvironment(process.env, directory);
    const status = await processes.start("seed", "pnpm", ["--filter", "@candor/sdk", "seed:demo"], { env: refreshed, persistent: false, quiet: true }).completion;
    console.log(status === 0 ? "[seed] SDK demo seeding completed; sensitive CLI output suppressed." : "[seed] SDK seed failed. Ensure identity and API are running with pnpm dev --no-worker; check SDK configuration.");
    return status;
  } finally {
    await processes.stop();
    removeSignals();
  }
}

if (isMain(import.meta.url)) {
  seed().then((code) => { process.exitCode = code; }).catch(() => {
    console.error("[seed] Seeding failed; check dependencies and configuration.");
    process.exitCode = 1;
  });
}
