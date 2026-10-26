import { readFile } from "node:fs/promises";

import ts from "typescript";

export async function resolve(specifier, context, nextResolve) {
  try {
    return await nextResolve(specifier, context);
  } catch (error) {
    if (
      error.code !== "ERR_MODULE_NOT_FOUND" ||
      !specifier.startsWith(".") ||
      !specifier.endsWith(".js")
    )
      throw error;
    return nextResolve(specifier.slice(0, -3) + ".ts", context);
  }
}

export async function load(url, context, nextLoad) {
  if (url.startsWith("file:") && url.endsWith(".ts")) {
    const source = await readFile(new URL(url), "utf8");
    const transformed = ts.transpileModule(source, {
      compilerOptions: {
        target: ts.ScriptTarget.ES2022,
        module: ts.ModuleKind.ESNext,
        verbatimModuleSyntax: true,
        sourceMap: false,
      },
      fileName: new URL(url).pathname,
    });
    return { format: "module", source: transformed.outputText, shortCircuit: true };
  }
  if (url.endsWith("/eff-large-wordlist.json")) {
    const words = JSON.parse(await readFile(new URL(url), "utf8"));
    return {
      format: "module",
      source: `export default ${JSON.stringify(words)};`,
      shortCircuit: true,
    };
  }
  return nextLoad(url, context);
}
