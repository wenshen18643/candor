# Meta Model API — verified 2026-10-26

## Verification and dependencies

- PyPI latest queried directly: `openai==3.37.0` (Python >=3.10), `httpx==0.28.1` (Python >=3.8).
- Installed under `%TEMP%`, using Python 3.13.7. Verified imports, keyword signatures, request serialization, Bearer auth, URL joining, and response parsing with mocked HTTP transports. **No authenticated Meta inference was performed**; an unauthenticated `/v1/models` probe returned 401.
- `openai` 3.37.0 internally uses `httpx2` (resolved version 2.16.0). Its `http_client=` expects `httpx2.Client`, not `httpx.Client`; the raw HTTP example below independently uses `httpx`.
- Registry evidence: [openai](https://pypi.org/pypi/openai/json), [httpx](https://pypi.org/pypi/httpx/json).

```powershell
# Use a throwaway directory, not the repository, for experiments.
$lab = Join-Path $env:TEMP ('candor-meta-' + [guid]::NewGuid())
python -m venv "$lab/venv"
& "$lab/venv/Scripts/python.exe" -m pip install openai==3.37.0 httpx==0.28.1
$env:MODEL_API_KEY = '<Meta API key>'
```

In this sandbox, `venv`/ensurepip failed; this alternative actually installed successfully:

```powershell
uv pip install --python python --target "$lab/packages" --cache-dir "$lab/cache" `
  --index-url https://pypi.org/simple openai==3.37.0 httpx==0.28.1
$env:PYTHONPATH = "$lab/packages"
```

## Models, prices, and limits

Base URL: `https://api.meta.ai/v1`; header: `Authorization: Bearer MODEL_API_KEY_VALUE`. These are Meta model IDs, not npm/PyPI versions. All listed text models have a 1,048,576-token context. Muse Wonder Full is **not** a Model API model. Muse Spark Open and Muse Glimmer use self/provider hosting, not this endpoint. [Models](https://dev.meta.ai/docs/models)

USD per million tokens; limits are per team **and per model**, shared by all keys:

| Model ID | Input | Cached input | Output | RPM | TPM |
|---|---:|---:|---:|---:|---:|
| `muse-spark-1.3` | 1.25 | 0.15 | 4.25 | 3,000 | 4,000,000 |
| `muse-spark-1.2` | 1.25 | 0.15 | 4.25 | 3,000 | 4,000,000 |
| `muse-spark-1.1` | 1.25 | 0.15 | 4.25 | 3,000 | 4,000,000 |
| `muse-spark-1.3-contributor` | 0.10 | 0.002 | 0.20 | 150 | 3,000,000 |
| `muse-spark-1.2-contributor` | 0.10 | 0.002 | 0.20 | 150 | 3,000,000 |
| `muse-wonder-1.0` | 4.00 | 0.20 | 20.00 | 3,000 | 4,000,000 |

Other endpoint-specific IDs: `muse-image-1.0` ($0.01/image; 150 RPM), `muse-voice-transcribe-1.0` ($0.18/audio hour; 256 concurrent streams, 16,000 streams/hour), `sam-3.1` ($2.50/1,000 images or $0.20/1,000 video frames; 3,000 RPM). These do not use the text-model token prices. [Pricing/rate limits](https://dev.meta.ai/docs/pricing-rate-limits)

**Candor configuration:** use Standard IDs. Contributor mode permits training on submitted content; Standard mode does not. This is a training-policy distinction, not a claim of zero retention. [Mode definitions](https://dev.meta.ai/docs/models)

## Minimal Chat Completions call and JSON schema

`OpenAI(*, api_key=..., base_url=..., timeout=..., max_retries=...)`; `client.chat.completions.create(*, model, messages, response_format=..., max_completion_tokens=..., reasoning_effort=...)` were inspected in installed 3.37.0.

```python
import json
import os
from openai import OpenAI

SCHEMA = {
    "type": "object",
    "properties": {"category": {"type": "string", "enum": ["fraud", "other"]}},
    "required": ["category"],
    "additionalProperties": False,
}
BODY = {
    "model": "muse-spark-1.3",
    "messages": [{"role": "user", "content": "Classify invoice fraud. Return JSON."}],
    "max_completion_tokens": 2048,
    "reasoning_effort": "low",
    "response_format": {
        "type": "json_schema",
        "json_schema": {"name": "classification", "strict": True, "schema": SCHEMA},
    },
}
with OpenAI(api_key=os.environ["MODEL_API_KEY"],
            base_url="https://api.meta.ai/v1", timeout=90.0, max_retries=2) as client:
    result = client.chat.completions.create(**BODY)
    choice = result.choices[0]
    if choice.finish_reason != "stop" or not choice.message.content:
        raise RuntimeError(f"Incomplete/non-text completion: {choice.finish_reason}")
    data = json.loads(choice.message.content)
    print(data, result.usage.model_dump() if result.usage else None)
```

Raw HTTP equivalent, after defining `BODY` above:

```python
import httpx
import os

with httpx.Client(timeout=90.0) as client:
    response = client.post(
        "https://api.meta.ai/v1/chat/completions",
        headers={"Authorization": f"Bearer {os.environ['MODEL_API_KEY']}"},
        json=BODY,
    )
    response.raise_for_status()
    result = response.json()
    print(result["choices"][0]["message"]["content"])
```

`json=` supplies Content-Type. httpx does not automatically retry HTTP failures. The SDK mock returned `{"category":"fraud"}` and `usage.total_tokens == 15`; these were synthetic test values, not a model response.

The schema wrapper above is exact. `strict` defaults to false; setting true validates the strict subset: object root, no root union/enum/not, no `oneOf`/`allOf` anywhere, `anyOf` allowed below root, every object's `additionalProperties:false`, every property listed in `required`. Rules also apply within definitions. Limits: depth 10, 5,000 properties, 120,000 combined schema-name/enum/const characters, 1,000 enum values by default; string enums >250 values have a 15,000-character cap. Expanded refs must stay <=200,000 nodes; recursive ref cycles are rejected. These limits also apply to tool parameters. Omitted/false strict normalizes schemas rather than applying strict-subset validation. [Structured output](https://dev.meta.ai/docs/structured-output)

Validate parsed data locally as an application boundary; schema-constrained generation does not ensure factual correctness or a complete response after interruption.

## Response shape and generation parameters

Representative shape (illustrative counts/IDs):

```json
{"id":"chatcmpl-example","object":"chat.completion","created":0,
 "model":"muse-spark-1.3",
 "choices":[{"index":0,"message":{"role":"assistant","content":"Hello"},
             "finish_reason":"stop"}],
 "usage":{"prompt_tokens":12,"completion_tokens":8,"total_tokens":20}}
```

| Parameter | Current behavior |
|---|---|
| `temperature` | Supported, 0–2, default 1.0; Meta recommends default. |
| `seed` | Supported integer; best-effort determinism, no guarantee. |
| `n` | Only 1; >1 returns 400. |
| `top_p` | `0 < top_p <= 1`; 0 returns 400. |
| `max_completion_tokens` | Output budget; `max_tokens` is a deprecated accepted alias. |
| `max_output_tokens` | Responses-only; rejected by Chat Completions. |
| `stream` | SSE chunks, `choices[].delta`, ending finish reason. |

Chat is stateless: resend full message history. `system`, `developer`, `user`, `assistant`, and tool messages are used as appropriate. [Chat protocol](https://dev.meta.ai/docs/protocols/chat-completions)

`reasoning_effort`: minimal/low/medium/high/xhigh; `max` additionally works on Spark 1.3 Standard and Wonder. `none` fails. Reasoning consumes the output budget and is billed; `usage.completion_tokens_details.reasoning_tokens` separates it from visible text. The generic Chat parameter table omits `max`; the dedicated reasoning page explicitly documents it. [Reasoning](https://dev.meta.ai/docs/reasoning)

Cache usage: `usage.prompt_tokens_details.cached_tokens` (Chat), versus `usage.input_tokens_details.cached_tokens` (Responses). Treat missing optional detail objects as unavailable, not zero by assumption. [Caching](https://dev.meta.ai/docs/prompt-caching)

## Function tools

Execute only application-allowlisted functions after validating arguments:

```python
import json
import os
from openai import OpenAI

client = OpenAI(api_key=os.environ["MODEL_API_KEY"], base_url="https://api.meta.ai/v1")
tools = [{"type": "function", "function": {
    "name": "lookup_status", "description": "Return a case status",
    "strict": True,
    "parameters": {"type": "object", "properties": {"case_id": {"type": "string"}},
                   "required": ["case_id"], "additionalProperties": False},
}}]
messages = [{"role": "user", "content": "Look up case demo-1"}]
r = client.chat.completions.create(model="muse-spark-1.3", messages=messages,
                                   tools=tools, tool_choice="auto")
message = r.choices[0].message
messages.append(message.model_dump(exclude_none=True))
for call in message.tool_calls or []:
    if call.type != "function" or call.function.name != "lookup_status":
        raise ValueError("Unexpected tool")
    args = json.loads(call.function.arguments)  # Arguments are a JSON string.
    if set(args) != {"case_id"} or not isinstance(args["case_id"], str):
        raise ValueError("Invalid arguments")
    value = {"case_id": args["case_id"], "status": "demo"}  # Replace with lookup.
    messages.append({"role": "tool", "tool_call_id": call.id,
                     "content": json.dumps(value)})
if message.tool_calls:
    r = client.chat.completions.create(model="muse-spark-1.3",
                                       messages=messages, tools=tools)
client.close()
```

Each call has `id`, `type`, `function.name`, and string `function.arguments`. Replay the full assistant tool-call message and one matching result per ID. Multiple calls may arrive. **Only `tool_choice="auto"` is supported**: none/required/named choices return 400. To avoid calls, omit tools. [Tool calling](https://dev.meta.ai/docs/tool-calling)

## Image input

```python
import base64
from pathlib import Path

encoded = base64.b64encode(Path("redacted.png").read_bytes()).decode("ascii")
image_message = {"role": "user", "content": [
    {"type": "text", "text": "Summarize this redacted page."},
    {"type": "image_url", "image_url": {"url": f"data:image/png;base64,{encoded}"}},
]}
# client.chat.completions.create(model="muse-spark-1.3", messages=[image_message])
```

A public HTTP(S) URL can replace the data URL. Chat uses an `image_url` object; Responses uses `input_image` with a string `image_url` (or uploaded `file_id`). Maximum 50 images/request, also subject to body/context limits. Redact locally before sending; a hosted image URL must be fetchable by Meta. [Vision](https://dev.meta.ai/docs/image-understanding)

## Errors and retry policy

Error envelope: `{"error":{"message":"...","type":"...","param":null,"code":null}}`. `code` can be null. [Error handling](https://dev.meta.ai/docs/error-handling)

| HTTP | Action |
|---|---|
| 400 | Fix parameters/schema/history; do not retry unchanged. |
| 401 | Fix auth (`invalid_api_key`). |
| 402 | Fix billing (`billing_not_configured`). |
| 403 | Check permissions. |
| 404 | Check IDs/path (`model_not_found`, `file_not_found`). |
| 413 | Reduce payload (`payload_too_large`). |
| 429 | Back off; honor `Retry-After`. |
| 500 | Bounded retry. |
| 503 | Retry; codes include `server_shutting_down`, `service_overloaded`, `backend_unavailable`. Overload may specify `Retry-After: 60`. |
| 504 | Non-streaming timeout: reduce work or use streaming; no successful output assumed. |

Use bounded exponential backoff plus jitter (e.g. 0.5s, 1s, 2s, capped), waiting at least `Retry-After`. Read `x-ratelimit-limit-tokens`, `x-ratelimit-remaining-tokens`, `x-ratelimit-limit-requests`, `x-ratelimit-remaining-requests`. Avoid multiplying SDK retries with an unbounded outer retry loop. [Rate handling](https://dev.meta.ai/docs/pricing-rate-limits)

The [API-reference URL](https://dev.meta.ai/docs/api-reference/chat-completions) exposed only a short page shell to the fetcher. Exact behavior above is sourced from the accessible protocol/capability pages; authenticated server acceptance remains untested.
