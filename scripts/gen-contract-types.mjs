import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { compile } from "json-schema-to-typescript";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const pipelineSrc = resolve(root, "services/pipeline/src");
const targets = [
  resolve(root, "apps/web/src/lib/contracts.generated.ts"),
  resolve(root, "packages/sdk/src/contracts.generated.ts"),
];

const dumpSchema = `
import json, sys
sys.path.insert(0, ${JSON.stringify(pipelineSrc)})
from pydantic import TypeAdapter
from candor_pipeline import contracts
models = [contracts.AnalysisPayload, contracts.AnalysisResult, contracts.StageEvent]
union = TypeAdapter(contracts.AnalysisPayload | contracts.AnalysisResult | contracts.StageEvent)
print(json.dumps(union.json_schema(mode="serialization")))
`;

const raw = execFileSync(
  "uv",
  ["run", "--no-project", "--with", "pydantic>=2.9", "python", "-c", dumpSchema],
  { encoding: "utf8", cwd: root },
);
const schema = JSON.parse(raw);
const definitions = schema.$defs ?? {};
for (const definition of Object.values(definitions)) {
  if (definition.properties) definition.required = Object.keys(definition.properties);
}
const wrapper = {
  title: "CandorContracts",
  type: "object",
  additionalProperties: false,
  properties: Object.fromEntries(
    Object.keys(definitions).map((name) => [name, { $ref: `#/$defs/${name}` }]),
  ),
  $defs: definitions,
};

const output = await compile(wrapper, "CandorContracts", {
  bannerComment: "",
  additionalProperties: false,
  unreachableDefinitions: true,
  style: { printWidth: 100, trailingComma: "all" },
});

for (const target of targets) {
  writeFileSync(target, output);
  console.log(`wrote ${target}`);
}
