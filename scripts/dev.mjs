import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { delimiter, dirname, resolve } from "node:path";
import { createInterface } from "node:readline";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parseEnv } from "node:util";

export const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

export function isMain(url) {
  return Boolean(process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === url);
}

export function loadEnvironment(base = process.env, directory = root) {
  const env = { ...base };
  const load = (path) => {
    if (!existsSync(path)) return;
    for (const [key, value] of Object.entries(parseEnv(readFileSync(path, "utf8")))) {
      if (env[key] === undefined) env[key] = value;
    }
  };
  load(resolve(directory, ".env"));
  const data = resolve(directory, env.CANDOR_DATA_DIR || "data");
  load(resolve(data, "demo", ".env.local"));
  env.CANDOR_DATA_DIR = data;
  env.CANDOR_LLM_PROVIDER ??= "codex";
  return env;
}

export function commandFor(command, args, env = process.env, platform = process.platform) {
  if (command !== "pnpm" || platform !== "win32") return [command, args];
  const candidates = [env.npm_execpath];
  for (const directory of (env.PATH || env.Path || "").split(delimiter)) {
    candidates.push(
      resolve(directory, "node_modules/pnpm/bin/pnpm.cjs"),
      resolve(directory, "node_modules/corepack/dist/pnpm.js"),
    );
  }
  const cli = candidates.find((path) => path && /pnpm\.(?:c?js)$/.test(path) && existsSync(path));
  if (!cli) throw new Error("pnpm entry point unavailable; run this command through pnpm.");
  return [process.execPath, [cli, ...args]];
}

export function safeLine(line, env) {
  if (/codename|authorization|sealed_key|"body"|"prompt"|"content"/i.test(line)) {
    return "[sensitive output suppressed]";
  }
  let safe = line;
  for (const [key, value] of Object.entries(env)) {
    if (/(?:SECRET|TOKEN|(?:^|_)SK|PRIVATE_KEY|API_KEY|LINK_KEY)$/.test(key) && value) {
      safe = safe.replaceAll(value, "[redacted]");
    }
  }
  return safe;
}

export function prefixOutput(stream, name, color, env, output = process.stdout) {
  const lines = createInterface({ input: stream, crlfDelay: Infinity });
  lines.on("line", (line) => {
    const label = output.isTTY ? `\u001b[${color}m[${name}]\u001b[0m` : `[${name}]`;
    output.write(`${label} ${safeLine(line, env)}\n`);
  });
  return lines;
}

export async function stopChild(child, platform = process.platform, launch = spawn) {
  if (!child.pid) return;
  if (platform === "win32") {
    if (child.exitCode !== null && child.exitCode !== undefined) return;
    await new Promise((done, reject) => {
      const killer = launch("taskkill", ["/T", "/F", "/PID", String(child.pid)], {
        windowsHide: true,
        stdio: "ignore",
      });
      const failed = () => {
        child.kill();
        reject(
          new Error("taskkill could not stop the child tree; check Windows process permissions."),
        );
      };
      killer.once("error", failed);
      killer.once("close", (code) => {
        if (code === 0) done();
        else failed();
      });
    });
    return;
  }
  const signal = (value) => {
    try {
      process.kill(-child.pid, value);
      return true;
    } catch (error) {
      if (error.code !== "ESRCH") throw error;
      return false;
    }
  };
  if (!signal("SIGTERM")) return;
  for (let attempt = 0; attempt < 30; attempt++) {
    await delay(100);
    if (!signal(0)) return;
  }
  signal("SIGKILL");
}

export class Processes {
  children = new Set();
  controller = new AbortController();
  stopping = null;

  constructor(env, onUnexpectedExit = () => {}) {
    this.env = env;
    this.onUnexpectedExit = onUnexpectedExit;
  }

  start(
    name,
    command,
    args,
    { env = this.env, persistent = true, quiet = false, inherit = false } = {},
  ) {
    if (this.controller.signal.aborted) return { completion: Promise.resolve(1) };
    const [executable, argv] = commandFor(command, args, env);
    const output = quiet ? "ignore" : inherit ? "inherit" : "pipe";
    let child;
    try {
      child = spawn(executable, argv, {
        cwd: root,
        env,
        detached: process.platform !== "win32",
        windowsHide: true,
        stdio: ["ignore", output, output],
      });
    } catch {
      console.error(
        `[${name}] Process could not start; check executable availability and process permissions.`,
      );
      if (persistent) this.onUnexpectedExit(name, 1);
      return { completion: Promise.resolve(1) };
    }
    this.children.add(child);
    if (!quiet && !inherit) {
      const color = { identity: 36, api: 32, worker: 35, web: 34 }[name] || 33;
      prefixOutput(child.stdout, name, color, this.env);
      prefixOutput(child.stderr, name, color, this.env, process.stderr);
    }
    const completion = new Promise((done) => {
      let finished = false;
      const finish = (code) => {
        if (finished) return;
        finished = true;
        if (!persistent) this.children.delete(child);
        if (persistent && !this.controller.signal.aborted) this.onUnexpectedExit(name, code);
        done(code);
      };
      child.once("error", () => finish(1));
      child.once("close", (code) => finish(code ?? 1));
    });
    return { child, completion };
  }

  stop() {
    if (!this.stopping) {
      this.controller.abort();
      this.stopping = Promise.allSettled([...this.children].map((child) => stopChild(child))).then(
        (results) => {
          if (results.some((result) => result.status === "rejected")) {
            console.error(
              "[dev] Process-tree cleanup failed; check Windows taskkill permissions and stop remaining service processes.",
            );
          }
          return results;
        },
      );
    }
    return this.stopping;
  }
}

export function handleSignals(processes) {
  const stop = (signal) => {
    process.exitCode = signal === "SIGINT" ? 130 : 143;
    void processes.stop();
  };
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);
  return () => {
    process.off("SIGINT", stop);
    process.off("SIGTERM", stop);
  };
}

export async function waitForHealth(url, signal, timeout = 120_000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    signal.throwIfAborted();
    try {
      const response = await fetch(url, {
        signal: AbortSignal.any([signal, AbortSignal.timeout(2_000)]),
      });
      await response.body?.cancel();
      if (response.ok) return;
    } catch {
      signal.throwIfAborted();
    }
    await delay(250, undefined, { signal });
  }
  throw new Error("Service health check timed out.");
}

export function localUrl(value, fallback) {
  const url = new URL(value || fallback);
  if (
    url.protocol !== "http:" ||
    !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    url.pathname !== "/"
  )
    throw new Error("Local service URLs must be HTTP loopback origins without credentials.");
  return url;
}

export function serviceEnvironment(name, env) {
  const filtered = { ...env };
  if (name === "worker") return filtered;
  for (const key of ["CANDOR_ENCLAVE_SK", "MODEL_API_KEY", "FIREWORKS_API_KEY", "BASETEN_API_KEY"]) {
    delete filtered[key];
  }
  if (name === "api") delete filtered.CANDOR_IDENTITY_SECRET;
  if (name === "identity" || name === "web") {
    for (const key of ["CANDOR_WORKER_TOKEN", "CANDOR_JWT_SECRET", "CANDOR_PAYMENTS_LINK_KEY", "ANCHOR_PRIVATE_KEY"]) {
      delete filtered[key];
    }
  }
  if (name === "web") {
    delete filtered.CANDOR_IDENTITY_SECRET;
    delete filtered.CANDOR_IDENTITY_ADMIN_TOKEN;
  }
  return filtered;
}

export function servicePlan(env, flags = []) {
  if (flags.some((flag) => !["--no-worker", "--no-web"].includes(flag))) {
    throw new Error("Usage: pnpm dev [--no-worker] [--no-web]");
  }
  const api = localUrl(env.CANDOR_API_URL, "http://localhost:8000");
  const identity = localUrl(env.CANDOR_IDENTITY_URL, "http://localhost:8787");
  const web = localUrl(env.CANDOR_WEB_URL, "http://localhost:3000");
  const services = [
    {
      name: "identity",
      command: "pnpm",
      args: ["--filter", "@candor/identity", "dev"],
      env: { ...serviceEnvironment("identity", env), PORT: identity.port || "80" },
      url: identity,
      health: new URL("/health", identity),
    },
    {
      name: "api",
      command: "uv",
      args: [
        "run",
        "--project",
        "services/api",
        "uvicorn",
        "candor_api.app:create_app",
        "--factory",
        "--reload",
        "--reload-dir",
        "services/api/src",
        "--host",
        api.hostname.replace(/^\[|\]$/g, ""),
        "--port",
        api.port || "80",
        "--no-access-log",
      ],
      env: serviceEnvironment("api", env),
      url: api,
      health: new URL("/v1/health", api),
    },
  ];
  if (!flags.includes("--no-web"))
    services.push({
      name: "web",
      command: "pnpm",
      args: [
        "--filter",
        "@candor/web",
        "exec",
        "next",
        "dev",
        "--webpack",
        "--port",
        web.port || "80",
      ],
      env: serviceEnvironment("web", env),
      url: web,
      health: web,
    });
  if (!flags.includes("--no-worker") && env.CANDOR_ENCLAVE_SK?.trim())
    services.push({
      name: "worker",
      command: "uv",
      args: ["run", "--project", "services/pipeline", "candor-worker"],
      env,
    });
  return services;
}

export async function main(flags = process.argv.slice(2)) {
  const env = loadEnvironment();
  const plan = servicePlan(env, flags);
  const processes = new Processes(env, (name, code) => {
    console.error(`[dev] ${name} exited unexpectedly (status ${code}); stopping services.`);
    process.exitCode = 1;
    void processes.stop();
  });
  const removeSignals = handleSignals(processes);
  try {
    if (!flags.includes("--no-worker") && !env.CANDOR_ENCLAVE_SK?.trim()) {
      console.warn(
        "[dev] Worker skipped: CANDOR_ENCLAVE_SK is absent. Run pnpm seed, then restart; remove any empty override from .env.",
      );
    }
    const servers = plan.filter((service) => service.health);
    for (const service of servers)
      processes.start(service.name, service.command, service.args, service);
    await Promise.all(
      servers.map((service) => waitForHealth(service.health, processes.controller.signal)),
    );
    for (const service of plan.filter((entry) => !entry.health)) {
      processes.start(service.name, service.command, service.args, service);
    }
    for (const service of servers) console.log(`[dev] ${service.name}: ${service.url.origin}`);
    console.log("[dev] Ready. Press Ctrl+C to stop all services.");
    await new Promise((done) => {
      if (processes.controller.signal.aborted) done();
      else processes.controller.signal.addEventListener("abort", done, { once: true });
    });
  } catch {
    if (!processes.controller.signal.aborted) {
      console.error("[dev] Startup failed; check configuration, dependencies and service health.");
      process.exitCode = 1;
    }
  } finally {
    await processes.stop();
    removeSignals();
  }
}

if (isMain(import.meta.url)) {
  main().catch(() => {
    console.error("[dev] Invalid configuration. Usage: pnpm dev [--no-worker] [--no-web]");
    process.exitCode = 1;
  });
}
