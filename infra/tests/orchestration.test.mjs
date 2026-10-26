import assert from "node:assert/strict";
import { EventEmitter, once } from "node:events";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { resolve } from "node:path";
import { PassThrough } from "node:stream";
import test from "node:test";

import {
  commandFor,
  loadEnvironment,
  localUrl,
  prefixOutput,
  Processes,
  root,
  safeLine,
  serviceEnvironment,
  servicePlan,
  stopChild,
  waitForHealth,
} from "../../scripts/dev.mjs";
import { metaPlan } from "../../scripts/meta.mjs";
import { hasDemoSeed, requireStoppedApi, seed } from "../../scripts/seed.mjs";
import { testPython } from "../../scripts/test-py.mjs";

async function fixture() {
  const parent = resolve(root, "infra/.artifacts/tests");
  await mkdir(parent, { recursive: true });
  return mkdtemp(resolve(parent, "run-"));
}

function fakeRunner(codes) {
  return {
    calls: [],
    stopped: false,
    controller: new AbortController(),
    start(...args) {
      this.calls.push(args);
      return { completion: Promise.resolve(codes.shift() ?? 0) };
    },
    async stop() {
      this.stopped = true;
    },
  };
}

test("dotenv precedence preserves explicit empty values and resolves custom data directory", async () => {
  const directory = await fixture();
  await mkdir(resolve(directory, "custom/demo"), { recursive: true });
  await writeFile(
    resolve(directory, ".env"),
    'CANDOR_DATA_DIR=custom\nFIRST=file\nEMPTY=file\nQUOTED="two words"\n',
  );
  await writeFile(
    resolve(directory, "custom/demo/.env.local"),
    "FIRST=generated\nSECOND=generated\nEMPTY=generated\n",
  );
  const env = loadEnvironment({ FIRST: "shell", EMPTY: "" }, directory);
  assert.equal(env.FIRST, "shell");
  assert.equal(env.EMPTY, "");
  assert.equal(env.SECOND, "generated");
  assert.equal(env.QUOTED, "two words");
  assert.equal(env.CANDOR_DATA_DIR, resolve(directory, "custom"));
  assert.equal(env.CANDOR_LLM_PROVIDER, "claude");
});

test("blank .env placeholders are filled by seeded values", async () => {
  const directory = await fixture();
  await mkdir(resolve(directory, "data/demo"), { recursive: true });
  await writeFile(resolve(directory, ".env"), "CANDOR_ENCLAVE_SK=\nKEPT=file\n");
  await writeFile(
    resolve(directory, "data/demo/.env.local"),
    "CANDOR_ENCLAVE_SK=seeded\nKEPT=generated\n",
  );
  const env = loadEnvironment({}, directory);
  assert.equal(env.CANDOR_ENCLAVE_SK, "seeded");
  assert.equal(env.KEPT, "file");
});

test("dotenv files are optional and explicit provider wins", async () => {
  const directory = await fixture();
  const env = loadEnvironment({ CANDOR_LLM_PROVIDER: "replay" }, directory);
  assert.equal(env.CANDOR_LLM_PROVIDER, "replay");
  assert.equal(env.CANDOR_DATA_DIR, resolve(directory, "data"));
});

test("service environments isolate worker, identity and browser configuration", () => {
  const env = {
    CANDOR_ENCLAVE_SK: "test-worker",
    MODEL_API_KEY: "test-provider",
    CANDOR_IDENTITY_SECRET: "test-identity",
    CANDOR_JWT_SECRET: "test-api",
    CANDOR_IDENTITY_ADMIN_TOKEN: "test-admin",
    NEXT_PUBLIC_API_URL: "http://localhost:8000",
  };
  assert.equal(serviceEnvironment("worker", env).CANDOR_ENCLAVE_SK, "test-worker");
  assert.equal(serviceEnvironment("api", env).CANDOR_ENCLAVE_SK, undefined);
  assert.equal(serviceEnvironment("api", env).CANDOR_IDENTITY_SECRET, undefined);
  assert.equal(serviceEnvironment("identity", env).CANDOR_JWT_SECRET, undefined);
  assert.equal(serviceEnvironment("web", env).CANDOR_IDENTITY_ADMIN_TOKEN, undefined);
  assert.equal(serviceEnvironment("web", env).NEXT_PUBLIC_API_URL, env.NEXT_PUBLIC_API_URL);
  assert.equal(env.CANDOR_ENCLAVE_SK, "test-worker");
});

test("stopped supervisors refuse to launch more children", async () => {
  const runner = new Processes({});
  await runner.stop();
  assert.equal(await runner.start("stopped", "unavailable", []).completion, 1);
  assert.equal(runner.children.size, 0);
});

test("service plan gates worker and web and starts API with reload", () => {
  assert.deepEqual(
    servicePlan({}).map((entry) => entry.name),
    ["identity", "api", "web"],
  );
  const env = { CANDOR_ENCLAVE_SK: "test-only-sentinel", CANDOR_LLM_PROVIDER: "replay" };
  const plan = servicePlan(env, ["--no-web"]);
  assert.deepEqual(
    plan.map((entry) => entry.name),
    ["identity", "api", "worker"],
  );
  assert.ok(plan[1].args.includes("--reload"));
  assert.equal(plan[1].health.pathname, "/v1/health");
  assert.equal(plan[1].env.CANDOR_ENCLAVE_SK, undefined);
  assert.equal(plan[2].env.CANDOR_LLM_PROVIDER, "replay");
  assert.deepEqual(
    servicePlan(env, ["--no-worker", "--no-web"]).map((entry) => entry.name),
    ["identity", "api"],
  );
  assert.throws(() => servicePlan({}, ["--invalid"]));
});

test("local endpoints reject credentials, remote origins and malformed URLs", () => {
  for (const url of [
    "https://localhost:8000",
    "http://example.com",
    "http://user:pass@localhost",
    "http://localhost/?token=sample",
    "http://localhost/path",
  ]) {
    assert.throws(() => localUrl(url));
  }
  const plan = servicePlan({
    CANDOR_API_URL: "http://127.0.0.1:8123",
    CANDOR_IDENTITY_URL: "http://localhost:8788",
  });
  assert.equal(plan[0].env.PORT, "8788");
  assert.ok(plan[1].args.includes("8123"));
});

test("Windows pnpm invocation uses Node without a shell", async () => {
  const directory = await fixture();
  const cli = resolve(directory, "pnpm.cjs");
  await writeFile(cli, "");
  assert.deepEqual(
    commandFor("pnpm", ["--filter", "@candor/web", "dev"], { npm_execpath: cli }, "win32"),
    [process.execPath, [cli, "--filter", "@candor/web", "dev"]],
  );
  assert.deepEqual(commandFor("uv", ["run"], {}, "win32"), ["uv", ["run"]]);
  assert.throws(() => commandFor("pnpm", [], { PATH: directory }, "win32"));
});

test("logs suppress body fields, codenames and configured sensitive values", () => {
  const env = { CANDOR_ENCLAVE_SK: "test-only-sentinel", MODEL_API_KEY: "test-only-provider" };
  assert.equal(
    safeLine("key=test-only-sentinel api=test-only-provider", env),
    "key=[redacted] api=[redacted]",
  );
  assert.equal(safeLine('event {"body":"synthetic"}', env), "[sensitive output suppressed]");
  assert.equal(safeLine("Codename: synthetic", env), "[sensitive output suppressed]");
});

test("prefixing handles split chunks and unterminated final lines", async () => {
  const input = new PassThrough();
  const output = new PassThrough();
  let captured = "";
  output.on("data", (chunk) => {
    captured += chunk;
  });
  const lines = prefixOutput(input, "api", 32, {}, output);
  const closed = once(lines, "close");
  input.write("fir");
  input.write("st\r\nsec");
  input.end("ond");
  await closed;
  assert.equal(captured, "[api] first\n[api] second\n");
});

test("health polling retries HTTP errors then succeeds and aborts promptly", async () => {
  let requests = 0;
  const server = createServer((_request, response) => {
    response.writeHead(++requests < 2 ? 503 : 200).end();
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  try {
    const url = `http://127.0.0.1:${server.address().port}`;
    await waitForHealth(url, new AbortController().signal, 2000);
    assert.equal(requests, 2);
    await assert.rejects(waitForHealth(url, AbortSignal.abort(), 2000));
    await assert.rejects(waitForHealth(url, new AbortController().signal, 0), /timed out/);
  } finally {
    server.closeAllConnections();
    await new Promise((done) => server.close(done));
  }
});

test("seeding missing SDK still resets API and gives a successful handoff", async () => {
  const directory = await fixture();
  const runner = fakeRunner([0]);
  assert.equal(await hasDemoSeed(directory), false);
  assert.equal(await seed({ directory, env: {}, runner, preflight: async () => {} }), 0);
  assert.equal(runner.calls.length, 1);
  assert.deepEqual(runner.calls[0][2].slice(-3), ["candor-api", "seed", "--reset"]);
  assert.equal(runner.stopped, true);
});

test("seeding fails fast on reset failure", async () => {
  const runner = fakeRunner([7]);
  assert.equal(
    await seed({ directory: await fixture(), env: {}, runner, preflight: async () => {} }),
    7,
  );
  assert.equal(runner.calls.length, 1);
  assert.equal(runner.stopped, true);
});

test("seeding refuses to reset an active API before starting any command", async () => {
  const server = createServer((_request, response) => response.writeHead(200).end());
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const runner = fakeRunner([]);
  try {
    const env = { CANDOR_API_URL: `http://127.0.0.1:${server.address().port}` };
    await assert.rejects(requireStoppedApi(env), /Stop the API/);
    await assert.rejects(seed({ directory: await fixture(), env, runner }), /Stop the API/);
    assert.equal(runner.calls.length, 0);
    assert.equal(runner.stopped, true);
  } finally {
    server.closeAllConnections();
    await new Promise((done) => server.close(done));
  }
});

test("SDK seeding follows reset and refreshes generated configuration without logging output", async () => {
  const directory = await fixture();
  await mkdir(resolve(directory, "packages/sdk"), { recursive: true });
  await writeFile(
    resolve(directory, "packages/sdk/package.json"),
    JSON.stringify({ scripts: { "seed:demo": "node seed" } }),
  );
  const runner = fakeRunner([0, 9]);
  let prepared = false;
  const code = await seed({
    directory,
    base: {},
    env: {},
    runner,
    preflight: async () => {},
    prepare: async () => {
      prepared = true;
    },
  });
  assert.equal(prepared, true);
  assert.equal(code, 9);
  assert.deepEqual(runner.calls[1][2], ["--filter", "@candor/sdk", "seed:demo"]);
  assert.equal(runner.calls[1][3].quiet, true);
  assert.equal(runner.calls[1][3].env.CANDOR_DATA_DIR, resolve(directory, "data"));
});

test("Python runner continues after failure and reports failing exit", async () => {
  const runner = fakeRunner([1, 0, 0]);
  assert.equal(await testPython(runner), 1);
  assert.deepEqual(
    runner.calls.map((call) => call[0]),
    ["api", "pipeline", "evals"],
  );
  assert.deepEqual(runner.calls[2][2], [
    "run",
    "--project",
    "services/evals",
    "pytest",
    "services/evals/tests",
    "-q",
  ]);
  assert.equal(runner.stopped, true);
});

test("Python runner returns success only when all suites pass", async () => {
  assert.equal(await testPython(fakeRunner([0, 0, 0])), 0);
  const cancelled = fakeRunner([]);
  cancelled.controller.abort();
  assert.equal(await testPython(cancelled), 1);
  assert.equal(cancelled.calls.length, 0);
});

test("supervisor reports unexpected child exit and cleans up idempotently", async () => {
  let exit;
  const runner = new Processes(process.env, (name, code) => {
    exit = { name, code };
  });
  const launched = runner.start("probe", process.execPath, ["-e", "process.exit(7)"], {
    quiet: true,
  });
  assert.equal(await launched.completion, 7);
  assert.deepEqual(exit, { name: "probe", code: 7 });
  assert.equal(runner.stop(), runner.stop());
  await runner.stop();
});

test("Windows shutdown requests taskkill on the full tree and reports rejection", async () => {
  const child = { pid: 1234, exitCode: null, kill: () => {} };
  const launch = (code) => (command, args, options) => {
    assert.equal(command, "taskkill");
    assert.deepEqual(args, ["/T", "/F", "/PID", "1234"]);
    assert.equal(options.windowsHide, true);
    const emitter = new EventEmitter();
    queueMicrotask(() => emitter.emit("close", code));
    return emitter;
  };
  await stopChild(child, "win32", launch(0));
  await assert.rejects(stopChild(child, "win32", launch(1)), /taskkill could not/);
});

test("supervisor stops a running parent and its grandchild", async (context) => {
  const directory = await fixture();
  const file = resolve(directory, "pids.json");
  const code = `const {spawn}=require('node:child_process'); const fs=require('node:fs'); const child=spawn(process.execPath,['-e','setTimeout(()=>{},8000)'],{stdio:'ignore',windowsHide:true}); fs.writeFileSync(process.argv[1],JSON.stringify([process.pid,child.pid])); setTimeout(()=>{},8000);`;
  const runner = new Processes(process.env);
  runner.start("tree", process.execPath, ["-e", code, file], { quiet: true });
  let pids;
  let results;
  try {
    for (let attempt = 0; attempt < 100; attempt++) {
      try {
        pids = JSON.parse(await readFile(file, "utf8"));
        break;
      } catch {
        await new Promise((done) => setTimeout(done, 50));
      }
    }
    assert.ok(pids, "Child process started");
  } finally {
    results = await runner.stop();
  }
  if (process.platform === "win32" && results.some((result) => result.status === "rejected")) {
    for (const pid of pids) {
      try {
        process.kill(pid);
      } catch {
        continue;
      }
    }
    context.skip(
      "Windows sandbox rejects taskkill with Access denied; exact command and rejection handling tested separately.",
    );
    return;
  }
  for (const pid of pids) assert.throws(() => process.kill(pid, 0), { code: "ESRCH" });
});

test("meta plan runs live Meta evals and a benchmark without cassette reuse", () => {
  assert.throws(() => metaPlan([], { MODEL_API_KEY: " " }), /MODEL_API_KEY/);
  assert.throws(() => metaPlan(["everything"], { MODEL_API_KEY: "k" }), /Usage/);
  assert.throws(() => metaPlan(["bench", "--repeats", "0"], { MODEL_API_KEY: "k" }), /Usage/);
  const plan = metaPlan(["--repeats", "2"], {
    MODEL_API_KEY: "k",
    CANDOR_REPLAY_DIR: "services/evals/cassettes",
  });
  assert.equal(plan.env.CANDOR_REPLAY_DIR, undefined);
  assert.equal(plan.steps.length, 2);
  assert.deepEqual(plan.steps[0].slice(5), [
    "run",
    "--provider",
    "meta:muse-spark-1.3",
    "--scenarios",
    "all",
    "--samples",
    "3",
  ]);
  assert.deepEqual(plan.steps[1].slice(5), [
    "bench",
    "--providers",
    "meta:muse-spark-1.3,claude:claude-haiku-5-5,fireworks,baseten",
    "--repeats",
    "2",
  ]);
  const evalsOnly = metaPlan(["evals"], { MODEL_API_KEY: "k", CANDOR_META_MODEL: "muse-x" });
  assert.equal(evalsOnly.steps.length, 1);
  assert.equal(evalsOnly.steps[0][7], "meta:muse-x");
});
