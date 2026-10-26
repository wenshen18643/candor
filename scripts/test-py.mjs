import { handleSignals, isMain, Processes } from "./dev.mjs";

export async function testPython(runner = new Processes(process.env)) {
  const removeSignals = handleSignals(runner);
  const results = [];
  try {
    for (const name of ["api", "pipeline", "evals"]) {
      if (runner.controller.signal.aborted) break;
      const directory = `services/${name}`;
      const started = Date.now();
      const code = await runner.start(
        name,
        "uv",
        ["run", "--project", directory, "pytest", `${directory}/tests`, "-q"],
        { persistent: false, inherit: true },
      ).completion;
      results.push({ name, code, seconds: ((Date.now() - started) / 1000).toFixed(1) });
    }
    for (const result of results)
      console.log(
        `[test:py] ${result.name}: ${result.code === 0 ? "PASS" : "FAIL"} (${result.seconds}s)`,
      );
    const failed = results.filter((result) => result.code !== 0).length;
    console.log(
      `[test:py] ${results.length - failed} passed, ${failed} failed, ${3 - results.length} not run.`,
    );
    return failed || results.length !== 3 ? 1 : 0;
  } finally {
    await runner.stop();
    removeSignals();
  }
}

if (isMain(import.meta.url)) {
  testPython()
    .then((code) => {
      process.exitCode = code;
    })
    .catch(() => {
      console.error("[test:py] Runner failed; verify uv and the service environments.");
      process.exitCode = 1;
    });
}
