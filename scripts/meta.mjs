import { spawnSync } from "node:child_process";

import { isMain, loadEnvironment, root } from "./dev.mjs";

const usage = "Usage: pnpm meta [all|evals|bench] [--repeats N]";

export function metaPlan(argv, env) {
  const index = argv.indexOf("--repeats");
  const repeats = index === -1 ? "3" : argv[index + 1];
  const rest = index === -1 ? argv : [...argv.slice(0, index), ...argv.slice(index + 2)];
  if (rest.length > 1) throw new Error(usage);
  const mode = rest[0] ?? "all";
  if (!["all", "evals", "bench"].includes(mode)) throw new Error(usage);
  if (!/^\d+$/.test(repeats ?? "") || Number(repeats) < 1) throw new Error(usage);
  if (!env.MODEL_API_KEY?.trim()) {
    throw new Error("Set MODEL_API_KEY in .env or your shell before running the Meta evaluation.");
  }
  const meta = `meta:${env.CANDOR_META_MODEL || "muse-spark-1.3"}`;
  const evals = ["uv", "run", "--project", "services/evals", "candor-evals"];
  const steps = [];
  if (mode !== "bench") {
    steps.push([...evals, "run", "--provider", meta, "--scenarios", "all", "--samples", "3"]);
  }
  if (mode !== "evals") {
    const providers = [meta, "codex:gpt-6.1-sol", "fireworks", "baseten"].join(",");
    steps.push([...evals, "bench", "--providers", providers, "--repeats", repeats]);
  }
  const clean = { ...env };
  delete clean.CANDOR_REPLAY_DIR;
  return { steps, env: clean };
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
  console.log("Results are in apps/web/public/data. Commit them to publish the numbers.");
}
