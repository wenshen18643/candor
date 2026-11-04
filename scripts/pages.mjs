import { spawnSync } from "node:child_process";
import { copyFileSync, existsSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

const web = fileURLToPath(new URL("../apps/web/", import.meta.url));
const out = join(web, "out");
const basePath = process.env.NEXT_PUBLIC_BASE_PATH ?? "/candor";

const next = join(web, "node_modules", "next", "dist", "bin", "next");
const build = spawnSync(process.execPath, [next, "build", "--webpack"], {
  cwd: web,
  stdio: "inherit",
  env: {
    ...process.env,
    CANDOR_STATIC_EXPORT: "1",
    NEXT_PUBLIC_BASE_PATH: basePath,
    NEXT_PUBLIC_API_URL: "",
    NEXT_PUBLIC_IDENTITY_URL: "",
  },
});
if (build.status !== 0) process.exit(build.status ?? 1);

function files(dir) {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? files(path) : [path];
  });
}

let flattened = 0;
function walk(dir) {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (!statSync(path).isDirectory()) continue;
    if (!name.startsWith("__next.")) {
      walk(path);
      continue;
    }
    for (const file of files(path)) {
      const target = join(dir, relative(dir, file).split(sep).join("."));
      if (existsSync(target)) continue;
      copyFileSync(file, target);
      flattened++;
    }
  }
}

walk(out);
writeFileSync(join(out, ".nojekyll"), "");
console.log(`[pages] ${out} ready for ${basePath || "/"} (${flattened} segment files flattened)`);
