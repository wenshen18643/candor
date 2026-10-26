import { readFile, rm } from "node:fs/promises";
import { resolve } from "node:path";

import {
  handleSignals,
  isMain,
  loadEnvironment,
  localUrl,
  Processes,
  root,
  servicePlan,
  waitForHealth,
} from "./dev.mjs";

export async function requireStoppedApi(env) {
  const url = new URL("/v1/health", localUrl(env.CANDOR_API_URL, "http://localhost:8000"));
  let running = false;
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(1000) });
    await response.body?.cancel();
    running = true;
  } catch {
    running = false;
  }
  if (running) {
    console.error(
      "[seed] Stop the local API before pnpm seed. Resetting a running API invalidates its in-memory audit keys.",
    );
    throw new Error("Stop the API before resetting demo data.");
  }
}

export async function resetIdentity(env, directory = root) {
  const dataDir = resolve(directory, env.CANDOR_DATA_DIR || "./data");
  for (const suffix of ["", "-shm", "-wal", "-journal"])
    await rm(resolve(dataDir, `identity.db${suffix}`), { force: true });
}

export async function ensureBackends(processes, env) {
  for (const service of servicePlan(env, ["--no-worker", "--no-web"])) {
    let healthy = false;
    try {
      const response = await fetch(service.health, { signal: AbortSignal.timeout(1000) });
      healthy = response.ok;
      await response.body?.cancel();
    } catch {
      healthy = false;
    }
    processes.controller.signal.throwIfAborted();
    if (!healthy) {
      processes.start(service.name, service.command, service.args, service);
      await waitForHealth(service.health, processes.controller.signal);
    }
  }
}

export async function hasDemoSeed(directory = root) {
  try {
    const manifest = JSON.parse(
      await readFile(resolve(directory, "packages/sdk/package.json"), "utf8"),
    );
    return typeof manifest.scripts?.["seed:demo"] === "string";
  } catch (error) {
    if (error.code === "ENOENT") return false;
    throw error;
  }
}

export async function seed({
  directory = root,
  env = loadEnvironment(process.env, directory),
  runner,
  prepare = ensureBackends,
  base = process.env,
  preflight = requireStoppedApi,
} = {}) {
  const processes =
    runner ||
    new Processes(env, () => {
      void processes.stop();
    });
  const removeSignals = handleSignals(processes);
  try {
    await preflight(env);
    await resetIdentity(env, directory);
    const reset = await processes.start(
      "seed",
      "uv",
      ["run", "--project", "services/api", "candor-api", "seed", "--reset"],
      { persistent: false, quiet: true },
    ).completion;
    if (reset !== 0 || processes.controller.signal.aborted) return reset || 1;
    console.log("[seed] API reset and demo identities created.");
    if (!(await hasDemoSeed(directory))) {
      console.warn(
        "[seed] SDK seed:demo is not available yet. Once implemented, start pnpm dev, then run pnpm --filter @candor/sdk seed:demo.",
      );
      return 0;
    }
    const refreshed = loadEnvironment(base, directory);
    await prepare(processes, refreshed);
    const status = await processes.start("seed", "pnpm", ["--filter", "@candor/sdk", "seed:demo"], {
      env: refreshed,
      persistent: false,
      quiet: true,
    }).completion;
    console.log(
      status === 0
        ? "[seed] SDK demo seeding completed; sensitive CLI output suppressed."
        : "[seed] SDK seed failed. Ensure identity and API are running with pnpm dev --no-worker; check SDK configuration.",
    );
    return status;
  } finally {
    await processes.stop();
    removeSignals();
  }
}

if (isMain(import.meta.url)) {
  seed()
    .then((code) => {
      process.exitCode = code;
    })
    .catch(() => {
      console.error("[seed] Seeding failed; check dependencies and configuration.");
      process.exitCode = 1;
    });
}
