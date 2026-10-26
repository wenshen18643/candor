# Fireworks AI and Baseten — verified 2026-10-26

## Dependencies and verification boundary

Direct PyPI registry checks: `openai==3.37.0`, `httpx==0.28.1`, `fireworks-ai==1.2.30`, `baseten==0.13.1`, `truss==0.18.36`. The last three are optional provider/deployment packages, **not required** for the OpenAI-compatible examples; their imports were not tested. [openai registry](https://pypi.org/pypi/openai/json), [httpx registry](https://pypi.org/pypi/httpx/json), [fireworks-ai registry](https://pypi.org/pypi/fireworks-ai/json), [baseten registry](https://pypi.org/pypi/baseten/json), [truss registry](https://pypi.org/pypi/truss/json)

Installed `openai` and `httpx` under `%TEMP%`, Python 3.13.7. Both provider URL/request/response paths passed mock-transport tests, including exact schema serialization and Bearer auth. **No paid/authenticated provider inference was run.** Baseten's unauthenticated `/v1/models` returned 401. Catalog claims below are documentation-verified, not account-entitlement tests.

```powershell
$lab = Join-Path $env:TEMP ('candor-providers-' + [guid]::NewGuid())
uv pip install --python python --target "$lab/packages" --cache-dir "$lab/cache" `
  --index-url https://pypi.org/simple openai==3.37.0 httpx==0.28.1
$env:PYTHONPATH = "$lab/packages"
$env:FIREWORKS_API_KEY = '<Fireworks key>'
$env:BASETEN_API_KEY = '<Baseten key>'
```

Conventional environment install: `python -m pip install openai==3.37.0 httpx==0.28.1`. Python >=3.10 is required by this OpenAI SDK version. It uses `httpx2` internally (2.16.0 resolved); custom SDK transports must use `httpx2.Client`, not `httpx.Client`.

## Endpoints and model catalog

| Provider/surface | OpenAI `base_url` | Auth |
|---|---|---|
| Fireworks inference | `https://api.fireworks.ai/inference/v1` | Bearer `FIREWORKS_API_KEY` |
| Baseten Model APIs | `https://inference.baseten.co/v1` | Bearer `BASETEN_API_KEY` |
| Baseten dedicated OpenAI server | `https://model-<id>.api.baseten.co/environments/production/sync/v1` | `BASETEN_API_KEY`; use dashboard's actual URL |

Append `/chat/completions` for raw POSTs; do not append it to the SDK base URL. Dedicated deployment configuration determines compatibility and model routing. [Fireworks API example](https://app.fireworks.ai/models/fireworks/muse-spark-open), [Baseten Model APIs](https://docs.baseten.co/inference/model-apis/overview), [Baseten dedicated example](https://docs.baseten.co/inference/structured-outputs)

USD per 1M tokens, input / cached input / output:

| Provider | Meta model and exact ID | Availability verified | Price |
|---|---|---|---|
| Fireworks | Muse Spark Open: `accounts/fireworks/models/muse-spark-open` | Serverless + dedicated; 1M context, text/image input | Standard **1.25 / 0.15 / 4.25** |
| Fireworks | Muse Spark Open, same ID | Priority capacity | **1.875 / 0.225 / 6.375** |
| Fireworks | Muse Glimmer 30B: `accounts/fireworks/models/muse-glimmer-30b` | Serverless + dedicated; 131,072 context, image input | Model card **0.35 / 0.04 / 1.50**; see discrepancy below |
| Fireworks | Llama 4 Scout: `accounts/fireworks/models/llama4-scout-instruct-basic` | Dedicated; current card says serverless unsupported | No current per-token serverless rate |
| Fireworks | Llama 4 Maverick: `accounts/fireworks/models/llama4-maverick-instruct-basic` | Dedicated; current card says serverless unsupported | No current per-token serverless rate |
| Baseten | Muse Spark Open: `meta-models/muse-spark-open` | Model APIs + dedicated; NVFP4 | **1.25 / 0.15 / 4.25** |
| Baseten | Llama 4 Scout / Maverick | Library templates for deployment; examples use deployment URLs and empty model field | No verified shared Model API slug or current per-token rate |
| Baseten | Muse Glimmer | No current official listing found in searches/catalog pages read | ID, availability, and price unverified |

Sources: [Fireworks Spark card](https://app.fireworks.ai/models/fireworks/muse-spark-open), [Fireworks pricing](https://docs.fireworks.ai/serverless/pricing), [Glimmer card](https://fireworks.ai/models/fireworks/muse-glimmer-30b), [Scout card](https://fireworks.ai/models/fireworks/llama4-scout-instruct-basic), [Maverick card](https://app.fireworks.ai/models/fireworks/llama4-maverick-instruct-basic), [Baseten Spark card](https://www.baseten.co/library/muse-spark-open/), [Baseten launch](https://www.baseten.co/blog/muse-spark-open-launch/), [Baseten Scout](https://www.baseten.co/library/llama-4-scout/), [Baseten Maverick](https://www.baseten.co/library/llama-4-maverick/).

Pricing discrepancy: Fireworks' current central table omits Glimmer and says unlisted dense models >16B cost $0.90/M for both input/output, while Glimmer's specific card advertises $0.35/$0.04/$1.50. **Do not treat either as a reconciled billing quote**; confirm the live console before budgeting. The central table confirms Spark Open pricing and US-only capacity with its US premium waived. Dedicated capacity is GPU/time-priced, not a portable per-token quote. [Central pricing](https://docs.fireworks.ai/serverless/pricing)

Baseten's general pricing/catalog tables were not exposed in fetched page text; the Spark library page and dated October 15 changelog independently provide its price/slug. [Launch slug](https://www.baseten.co/resources/changelog/muse-spark-open-and-nemotron-35-super-vl-available-on-baseten/)

Muse Spark Open is a distinct open-weight release; do not substitute Meta's proprietary `muse-spark-1.3` or `muse-wonder-1.0` IDs into these provider calls. Do not infer provider audio/video support merely from checkpoint capabilities: Fireworks' Spark card explicitly lists text/image, while Baseten's card lists text/image/audio/video.

## Minimal Python calls

`OpenAI(*, api_key, base_url, timeout=..., max_retries=...)`; `client.chat.completions.create(*, model, messages, response_format=..., max_completion_tokens=...)` signatures verified in installed 3.37.0.

```python
import os
from openai import OpenAI

def complete(provider: str, text: str) -> str:
    endpoints = {
        "fireworks": ("https://api.fireworks.ai/inference/v1",
                      "FIREWORKS_API_KEY", "accounts/fireworks/models/muse-spark-open"),
        "baseten": ("https://inference.baseten.co/v1",
                    "BASETEN_API_KEY", "meta-models/muse-spark-open"),
    }
    base, key_name, model = endpoints[provider]
    with OpenAI(base_url=base, api_key=os.environ[key_name],
                timeout=90.0, max_retries=2) as client:
        r = client.chat.completions.create(
            model=model, messages=[{"role": "user", "content": text}],
            max_completion_tokens=2048,
        )
    if r.choices[0].finish_reason != "stop":
        raise RuntimeError(f"Incomplete response: {r.choices[0].finish_reason}")
    return r.choices[0].message.content or ""

print(complete("fireworks", "Summarize the supplied redacted evidence: demo text."))
```

Use the Baseten branch for the second provider. The SDK's local mock test verified both POST URLs and parsed `choices[0].message.content`; it does not establish live endpoint acceptance of every optional parameter.

## Structured output: provider differences

Fireworks supports `json_object` and `json_schema` with this request wrapper:

```python
import json
from openai import OpenAI
import os

schema = {
    "type": "object",
    "properties": {"category": {"type": "string", "enum": ["fraud", "other"]}},
    "required": ["category"], "additionalProperties": False,
}
with OpenAI(base_url="https://api.fireworks.ai/inference/v1",
            api_key=os.environ["FIREWORKS_API_KEY"]) as client:
    r = client.chat.completions.create(
        model="accounts/fireworks/models/muse-spark-open",
        messages=[{"role": "user", "content":
                   "Classify invoice fraud. Return JSON matching: " + json.dumps(schema)}],
        response_format={"type": "json_schema", "json_schema": {
            "name": "classification", "schema": schema}},
        max_completion_tokens=2048,
    )
    if r.choices[0].finish_reason != "stop":
        raise RuntimeError("Incomplete structured output")
    value = json.loads(r.choices[0].message.content)
    if set(value) != {"category"} or value["category"] not in {"fraud", "other"}:
        raise ValueError("Invalid classification")
```

Fireworks documents types, required/additionalProperties, items, length/size limits, anyOf/allOf/oneOf, local refs/definitions and recursion. External refs are unsupported. Regex support is best-effort: unsupported constructs such as lookahead may be ignored. Put the schema in the prompt too; constrained decoding alone does not show it to the model. `finish_reason="length"` may leave invalid JSON. [Structured outputs](https://docs.fireworks.ai/structured-responses/structured-response-formatting)

**Baseten Muse Spark Open does not enforce JSON schema** even though it accepts `response_format.type="json_schema"`; its Model APIs documentation also excludes Spark Open from JSON-mode support. Client-side `parse()` cannot turn this into server-constrained generation. If using it for extraction, prompt explicitly and validate/retry locally, or choose another model whose schema support is confirmed. [Baseten structured output exception](https://docs.baseten.co/inference/structured-outputs), [feature support](https://docs.baseten.co/inference/model-apis/overview)

Baseten supports structured output on its other Model APIs and compatible dedicated engines; this does not prove availability of an unlisted Meta model. For dedicated endpoints the SDK still requires `model`, but routing may ignore it. Copy the deployment's actual invocation example.

## Operational checks and gotchas

- Baseten live catalog: `GET https://inference.baseten.co/v1/models` with Bearer auth, or `baseten model-api list`. Check deployment/account availability at integration time. A library template is not proof of shared API availability. [Catalog API](https://docs.baseten.co/inference/model-apis/overview)
- Baseten Spark Open supports only `n=1`; `logprobs`/`top_logprobs` are ignored. Neither seed nor temperature zero guarantees reproducibility. [Limitations](https://docs.baseten.co/inference/model-apis/overview)
- Keep keys on the server; redact locally before any hosted call. Baseten documents zero retention for synchronous Model API inputs/outputs, with separate retention considerations for queued dedicated inference. [Retention](https://docs.baseten.co/inference/model-apis/overview)
- Handle finish reasons and missing content before JSON parsing. Bound retries; avoid logging whistleblower content or credentials in error telemetry. Different provider IDs, schema enforcement, pricing tiers, and deployment modalities prevent treating compatibility as behavioral identity.
- The `app.fireworks.ai` Glimmer/Scout pages could not be fetched; their official `fireworks.ai/models/...` pages were accessible. Baseten Glimmer support remains explicitly unverified.
