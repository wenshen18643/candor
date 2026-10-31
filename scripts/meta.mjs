import { spawnSync } from "node:child_process";

import { isMain, loadEnvironment, root } from "./dev.mjs";

const usage = "Usage: pnpm meta [all|evals|bench] [--repeats N]";

const hosts = [
  ["meta", "MODEL_API_KEY", "CANDOR_META_MODEL", "muse-spark-1.3"],
  ["baseten", "BASETEN_API_KEY", "CANDOR_BASETEN_MODEL", "meta-models/muse-spark-open-1026"],
  [
    "fireworks",
    "FIREWORKS_API_KEY",
    "CANDOR_FIREWORKS_MODEL",
    "accounts/fireworks/models/muse-spark-open",
  ],
];

export function museHosts(env) {
  return hosts
    .filter(([, key]) => env[key]?.trim())
    .map(([name, , model, fallback]) => `${name}:${env[model] || fallback}`);
}

export function metaPlan(argv, env) {
  const index = argv.indexOf("--repeats");
  const repeats = index === -1 ? "3" : argv[index + 1];
  const rest = index === -1 ? argv : [...argv.slice(0, index), ...argv.slice(index + 2)];
  if (rest.length > 1) throw new Error(usage);
  const mode = rest[0] ?? "all";
  if (!["all", "evals", "bench"].includes(mode)) throw new Error(usage);
  if (!/^\d+$/.test(repeats ?? "") || Number(repeats) < 1) throw new Error(usage);
  const muse = museHosts(env);
  if (!muse.length) {
    throw new Error(
      "Set MODEL_API_KEY, BASETEN_API_KEY or FIREWORKS_API_KEY in .env before running the Muse evaluation.",
    );
  }
  const evals = ["uv", "run", "--project", "services/evals", "candor-evals"];
  const steps = [];
  if (mode !== "bench") {
    steps.push([
      ...evals,
      "run",
      "--provider",
      muse[0],
      "--scenarios",
      "all",
      "--samples",
      "3",
      "--record",
    ]);
  }
  if (mode !== "evals") {
    const providers = [...muse, "claude:claude-haiku-5-5"].join(",");
    steps.push([...evals, "bench", "--providers", providers, "--repeats", repeats]);
  }
  const slug = muse[0].split(":")[0] + "-" + muse[0].split("/").at(-1).split(":").at(-1);
  const clean = { ...env, CANDOR_REPLAY_DIR: `services/evals/cassettes/${slug}` };
  return { steps, env: clean, cassettes: clean.CANDOR_REPLAY_DIR };
}

if (isMain(import.meta.url)) {
  let plan;
  try {
    plan = metaPlan(process.argv.slice(2), loadEnvironment());
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }
  for (const [command, ...args] of plan.steps) {
    console.log(`> ${[command, ...args].join(" ")}`);
    const result = spawnSync(command, args, { cwd: root, env: plan.env, stdio: "inherit" });
    if (result.status !== 0) process.exit(result.status ?? 1);
  }
  console.log(
    `Results are in apps/web/public/data and the model calls in ${plan.cassettes}. Commit both to publish the numbers.`,
  );
}
