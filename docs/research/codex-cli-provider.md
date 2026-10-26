# Codex CLI as a Python subprocess provider — 2026-10-26

## VERIFIED WORKING (lead engineer, outside the Codex sandbox)

The failures recorded below happen only when Codex is invoked from inside another Codex sandbox.
From a normal shell on this machine this exact command succeeds in about 8 s with exit 0 and
`answer.json` containing `{"answer":42,"label":"verified"}`:

```bash
echo '<prompt>' | codex exec --skip-git-repo-check --ephemeral --ignore-user-config -s read-only \
  -m gpt-6.1-sol --disable shell_tool --disable apps --disable plugins --disable multi_agent \
  -c 'web_search="disabled"' -c 'model_reasoning_effort="low"' \
  --output-schema /abs/schema.json -o /abs/answer.json -
```

Inside a Codex agent sandbox, real Codex calls fail with `workspace routing discovery failed`, so
record cassettes from a normal shell, not from within an agent run.

## Verified version and result

- Ran `codex --version`: **`codex-cli 0.163.0`**; installed package manifest also says `@openai/codex` 0.163.0.
- npm registry `latest` was **0.164.0**, queried directly on 2026-10-26. Tests used the installed 0.163.0; no global upgrade was made. [npm registry](https://registry.npmjs.org/@openai%2fcodex/latest)
- Python 3.13.7, Node v24.15.0, Windows PowerShell. Python integration needs only standard-library `subprocess`, `json`, `tempfile`, `pathlib`, `os`, and `time`; no PyPI Codex wrapper is required.
- **Real model experiment attempted, not successful.** Default home failed with access denied; isolated temporary `CODEX_HOME` got as far as a model turn, then failed with `workspace routing discovery failed`. Repeating with shell/apps/plugins/multi-agent/search disabled failed identically. There is **no verified successful command/output or successful-inference latency** from this environment.
- All experimental files/installations were under `%TEMP%`. Existing auth was copied privately to temporary runtime storage; credentials were never printed. No config/auth changes were made to the user's original installation. **Cleanup limitation:** automatic approval review rejected deletion with `blocked by policy`; the temporary `codex-home/auth.json` at the exact path below remains and needs user cleanup.

Install a pinned copy into a throwaway directory if needed:

```powershell
$lab = Join-Path $env:TEMP ('candor-codex-' + [guid]::NewGuid())
npm install --prefix "$lab" --no-save @openai/codex@0.163.0
node "$lab/node_modules/@openai/codex/bin/codex.js" --version
# 0.164.0 was registry-latest; its behavior was not tested here.
```

## Flag contract

Verified against local `codex exec --help`, plus [official CLI reference](https://learn.chatgpt.com/docs/cli/reference) and [non-interactive documentation](https://learn.chatgpt.com/docs/non-interactive-mode):

| Argument | Behavior / integration consequence |
|---|---|
| `exec` | Non-interactive execution. |
| `-` | Read the entire prompt from stdin. Omission also reads stdin; supplying both an argument prompt and piped input appends a `<stdin>` block. |
| `--output-schema FILE` | FILE contains the final answer's JSON Schema, not the OpenAI `response_format` wrapper. |
| `-o FILE`, `--output-last-message FILE` | Write final assistant message to FILE. Use a new path per request; never consume stale output after failure. |
| `--json` | stdout is an event JSONL stream, **not** just the answer JSON. Read `-o` separately. |
| `--ephemeral` | Avoid persisted session files. Does not promise no runtime DB/log/auth/network activity. |
| `--ignore-user-config` | Skip `$CODEX_HOME/config.toml`; auth still uses `CODEX_HOME`. Does not mean all managed/project policies or tools disappear. |
| `-s read-only` | Restrict model-generated shell filesystem access; it does not disable tools. |
| `--skip-git-repo-check` | Needed for an empty temporary working directory outside Git. |
| `-m gpt-6.1-sol` | Select this exact model; access depends on account/backend availability. |
| `-c 'model_reasoning_effort="low"'` | Per-run reasoning-effort override; no config-file edit. |

## Schema subset

Use an object root, every property in `required`, and `additionalProperties:false` on every object. Nullable required fields (`"type":["string","null"]`) represent optional data. Nested anyOf, enums, arrays, definitions/local refs, and recursion are documented by OpenAI Structured Outputs; root anyOf is disallowed. Unsupported composition includes allOf/not/dependentRequired/dependentSchemas/if/then/else. Limits: 10 nested levels, 5,000 object properties, 120,000 combined name/enum/const characters, 1,000 enum values; string enums >250 entries have a 15,000-character limit. [Structured Outputs subset](https://developers.openai.com/api/docs/guides/structured-outputs)

These are the documented OpenAI backend constraints, **not an experimentally established Codex-specific acceptance matrix**. The real run never reached server-side schema validation. Only malformed JSON rejection was directly observed. Do not assume arbitrary JSON Schema keywords work because the CLI accepted the schema file.

The exact schema tested:

```json
{
  "type": "object",
  "properties": {
    "answer": {"type": "integer"},
    "label": {"type": "string"}
  },
  "required": ["answer", "label"],
  "additionalProperties": false
}
```

## Exact real experiment

Working directory and `CODEX_HOME` were respectively:

```text
C:\Users\Shen\AppData\Local\Temp\candor-api-research-ed675cf01e2643eb8f825b30a9d22a3c
C:\Users\Shen\AppData\Local\Temp\candor-api-research-ed675cf01e2643eb8f825b30a9d22a3c\codex-home
```

Python passed this exact argument vector (absolute schema/output paths), with `shell=False`. It invokes the same JS launcher as this machine's `codex.cmd`:

```python
root = r"C:\Users\Shen\AppData\Local\Temp\candor-api-research-ed675cf01e2643eb8f825b30a9d22a3c"
argv = [
    "node", r"C:\Users\Shen\AppData\Roaming\npm\node_modules\@openai\codex\bin\codex.js",
    "exec", "--skip-git-repo-check", "--ephemeral", "--ignore-user-config",
    "-s", "read-only", "-m", "gpt-6.1-sol",
    "--disable", "shell_tool", "--disable", "apps",
    "--disable", "plugins", "--disable", "multi_agent",
    "-c", 'web_search="disabled"', "-c", 'model_reasoning_effort="low"',
    "--output-schema", root + r"\schema.json",
    "-o", root + r"\answer2.json", "--json", "-",
]
```

Exact stdin:

```text
Answer directly. Do not use any tools or read any files. Compute 6 * 7. Return answer=42 and label="verified" using the supplied JSON schema.
```

Equivalent CLI syntax (use Python argv above to avoid Windows quoting changes):

```text
codex exec --skip-git-repo-check --ephemeral --ignore-user-config -s read-only -m gpt-6.1-sol --disable shell_tool --disable apps --disable plugins --disable multi_agent -c 'web_search="disabled"' -c 'model_reasoning_effort="low"' --output-schema schema.json -o answer2.json --json -
```

Actual stdout began with `thread.started` and `turn.started`, retried routing, fell back from WebSockets to HTTPS, then ended with these exact lines:

```jsonl
{"type":"error","message":"workspace routing discovery failed"}
{"type":"turn.failed","error":{"message":"workspace routing discovery failed"}}
```

`answer2.json` was absent, exit **1**, elapsed **23.149 s**. stderr also reported model-refresh connection errors. This is a transport/routing failure, not evidence that the model ID or schema is unsupported.

| Experiment | Exit | Wall time | Result |
|---|---:|---:|---|
| Default home, same schema/model, minimal flags | 1 | 1.063 s | In-process app-server initialization: access denied (os error 5). |
| Temporary home, minimal flags | 1 | 22.516 s | Workspace routing failed; no answer file. |
| Temporary home, tools reduced as above | 1 | 23.149 s | Same routing failure; no answer file. |
| `exec --not-a-real-option` | 2 | 0.640 s | CLI argument error. |
| `--output-schema invalid-schema.json`, file content `{not JSON` | 1 | 1.308 s | Local invalid-JSON error before inference. |

Successful runs are expected to return 0; that path was not observed. Treat every nonzero exit as failure and validate the result even on zero. A complete public exit-code taxonomy was not established. No credible typical latency can be inferred from failed runs; benchmark successful calls on the deployment host and enforce a deadline.

## Python provider adapter (rerunnable; success path unverified here)

Use the native executable so timeout management does not leave a Node wrapper's child running. On this machine it exists at the path below; configure `CODEX_BINARY` on another host. The auth home must be writable and already authenticated. `CODEX_API_KEY` is supported for a single `exec` invocation, or reuse existing CLI login. [Automation auth](https://learn.chatgpt.com/docs/non-interactive-mode)

```python
import json
import os
from pathlib import Path
import subprocess
import tempfile
import time

DEFAULT_BINARY = (
    r"C:\Users\Shen\AppData\Roaming\npm\node_modules\@openai\codex\node_modules"
    r"\@openai\codex-win32-x64\vendor\x86_64-pc-windows-msvc\bin\codex.exe"
)

def classify_with_codex(prompt: str, schema: dict, timeout: float = 120.0) -> dict:
    binary = os.environ.get("CODEX_BINARY", DEFAULT_BINARY)
    with tempfile.TemporaryDirectory(prefix="candor-codex-") as work:
        directory = Path(work)
        schema_path, output_path = directory / "schema.json", directory / "answer.json"
        schema_path.write_text(json.dumps(schema), encoding="utf-8")
        command = [
            binary, "exec", "--skip-git-repo-check", "--ephemeral",
            "--ignore-user-config", "-s", "read-only", "-m", "gpt-6.1-sol",
            "--disable", "shell_tool", "--disable", "apps", "--disable", "plugins",
            "--disable", "multi_agent", "-c", 'web_search="disabled"',
            "-c", 'model_reasoning_effort="low"',
            "--output-schema", str(schema_path), "-o", str(output_path), "--json", "-",
        ]
        start = time.perf_counter()
        result = subprocess.run(
            command, cwd=work, input=(
                "Answer directly using only the supplied text. Do not run tools, "
                "browse, read files, or execute commands. Return the requested JSON.\n" + prompt
            ), capture_output=True, text=True, encoding="utf-8",
            timeout=timeout, shell=False, env=os.environ.copy(),
        )
        if result.returncode != 0:
            # Keep sensitive stdout/stderr out of public error responses.
            raise RuntimeError(f"Codex failed, exit={result.returncode}")
        events = [json.loads(line) for line in result.stdout.splitlines() if line.strip()]
        if any(e.get("type") in {"error", "turn.failed"} for e in events):
            raise RuntimeError("Codex reported an unsuccessful turn")
        # Reject tool activity even if a final answer exists.
        allowed_items = {"agent_message", "reasoning"}
        if any(e.get("item", {}).get("type") not in allowed_items
               for e in events if e.get("type", "").startswith("item.")):
            raise RuntimeError("Unexpected tool/activity in direct-answer request")
        if not any(e.get("type") == "turn.completed" for e in events):
            raise RuntimeError("Missing completion event")
        value = json.loads(output_path.read_text(encoding="utf-8"))
        if not isinstance(value, dict):
            raise ValueError("Expected an object")
        # Apply your application's full schema/semantic validation here.
        return {"value": value, "elapsed_seconds": time.perf_counter() - start}
```

For the tested schema, additionally require `set(value)=={"answer","label"}`, `type(value["answer"]) is int`, and `isinstance(value["label"], str)`; do not accept `bool` as an integer. Catch `subprocess.TimeoutExpired`, missing output, JSON errors, and validation failures at the job boundary. Keep concurrency bounded to avoid spawning unbounded CLI processes.

## Direct-answer and privacy limitations

- `--disable shell_tool` controls command tools; `web_search="disabled"` disables hosted search. These are documented controls; local feature listing recognized shell_tool, apps, plugins, and multi_agent. [Feature config](https://learn.chatgpt.com/docs/config-file/config-basic), [search config](https://learn.chatgpt.com/docs/web-search)
- No universal `--no-tools` flag was found in 0.163.0 help. Disabling selected features and prompting directly is not proof that every managed/MCP tool is absent. An empty temporary cwd avoids repository instructions, but managed settings still apply. Inspect JSONL and reject unexpected activity as above; this detects activity after it occurs, not before.
- `--ephemeral` concerns session persistence, not provider retention or local runtime logs. The temporary-home run still initialized runtime state and attempted model/auth network requests. This is a cloud LLM backend controlled by a local CLI, not local inference.
- Setting `CODEX_HOME` to a new directory without authentication does not transfer login. Production should provision a private writable authenticated home; the temporary credential copy was only an isolated experiment.
- Do not claim Candor's JSON backend is ready on this machine until a real call produces a validated `answer.json`. Repair the routing/connectivity issue or use a working authenticated deployment environment, then rerun the exact schema test and measure successful latency.
