# Demo video

The submitted cut is **2 minutes 45 seconds**, 1920×1080, with a voice-over and burned-in captions:
https://wenshen18643.github.io/candor/demo.mp4

It was recorded on localhost against the static showcase build (`pnpm pages`, which is what
https://wenshen18643.github.io/candor/ serves), so every screen is the same one a judge can open.
A headless Chromium drove each step and streamed its frames into ffmpeg; the narration is a
neural text-to-speech voice, and every scene is timed to its line. Nothing is sped up: sealing,
including its random delay, runs in real time.

Every number on screen comes from the page itself: the showcase analysis is the committed Muse
Spark Open run, and the evaluation page reads `apps/web/public/data/evals-latest.json`.

## Script

| Time      | On screen                                                                                                                | Said                                                                                                                                                                                                                                                                                                                                         |
| --------- | ------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 0:00–0:15 | Landing page; the animated email runs through Detect, Replace, Lock and Split key.                                       | Most fraud is caught because someone on the inside speaks up. Forty-three percent of cases start with a tip. But speaking up is dangerous. Hotlines ask who you are, and your files carry your name. Candor lets you say what happened, not who you are.                                                                                     |
| 0:15–0:29 | **Make a report** → **Start** → **Use test passport A** → open "How this stays unlinkable" → **Continue**.               | I start a report for Northwind Health. First, I prove I'm a real adult with a zero-knowledge passport check. The service learns only yes or no, then blind-signs a token, so even Candor can't link my report back to that check.                                                                                                            |
| 0:29–0:45 | **Use sample evidence** → **Clean and review**; the PDF, Word and email metadata lines, then the code names.             | Next, my evidence. Everything is cleaned here, on my device. The PDF loses its author, the Word file loses its hidden properties, the emails lose their IP addresses, and every name becomes a placeholder, the same one in every file.                                                                                                      |
| 0:45–0:58 | **Looks right** → **Seal and send** (real time, including the random delay) → **Get my receipt**; the eight words.       | Then it's sealed. The report is encrypted, and the key is split three ways. Any two reviewers can open it. One alone can't, and neither can we. These eight words are my anonymous inbox.                                                                                                                                                    |
| 0:58–1:11 | `/console` → **Avery Chen** → the Northwind report; the Brief and its claim chips.                                       | Now the reviewer's side. Meta's Muse Spark Open, an open-weights model, read only the redacted text and wrote this brief. Every point ends in claim numbers, and code throws out any point it can't back up.                                                                                                                                 |
| 1:11–1:27 | Click **C003**: verbatim-match badges, the highlighted quote, 3/3 samples, the verifier and the 95 confidence.           | Click a claim, and you land on the exact sentence it came from. Muse extracted it in three separate passes, code matched the quote character by character, and a second, independent Muse pass verified it. The confidence score is a formula, not a vibe.                                                                                   |
| 1:27–1:49 | **Timeline** (17 Feb, "the day before 18 Feb"), back to **Brief**, open quarantined **D6.P001**, then "Unsupported 1".   | Dates are resolved against each document's own date, so yesterday, in a February eighteenth email, lands on the seventeenth. And one vendor PDF hides a note telling the AI to ignore its instructions and say nothing was wrong. It was quarantined: kept as evidence, never obeyed. The one claim that leaned on it is marked unsupported. |
| 1:49–2:05 | **Pipeline**: the DAG pans across all twelve stages, each model stage labelled Muse Spark Open.                          | Here's the whole run. Twelve stages, nine calls to Muse Spark Open, fifty-nine seconds, sixteen cents. Because the weights are open, an organisation can run this model inside its own walls, so even the redacted evidence never has to leave.                                                                                              |
| 2:05–2:13 | **Evidence** → type a reason → **Request quorum access** → **Approve as Morgan Ellis** → **Combine shares and decrypt**. | Opening the original files takes two of three reviewers. I ask, Morgan approves, and the key shares combine in my browser.                                                                                                                                                                                                                   |
| 2:13–2:24 | `/audit` → **Run all checks** → open entry 40 → **Tamper with this entry** → "Verification failed".                      | Every submission, analysis and unlock goes into a public Merkle log. Change a single byte of one entry, and the proof fails, right here in the browser.                                                                                                                                                                                      |
| 2:24–2:42 | `/evals`: Muse Spark Open as model under test, zero leaks, 100% quote grounding, 100% injections flagged.                | And we test it the hard way. Six synthetic cases with planted names, prompt injections and date puzzles, all run on Muse. Zero identifier leaks. Every quote found word for word. Every planted injection caught. That's Candor. Say what happened, not who you are.                                                                         |
| 2:42–2:45 | End card: live demo, code and model links.                                                                               | (silence)                                                                                                                                                                                                                                                                                                                                    |

## Re-recording with a live Muse run

The showcase replays a recorded run. To show Muse working in real time instead, put
`BASETEN_API_KEY` in `.env`, then:

```bash
pnpm seed   # fresh demo data; the test passports allow three reports a month
pnpm dev    # identity, API, Muse worker and web app on http://localhost:3000
```

Make a report at `localhost:3000/report/northwind-ethics`, then in `/console` sign in as Avery
Chen, open the new report, click **Run analysis · 0.50 USDC**, **Pay 0.50 USDC and run** (x402,
mock settlement) and **Watch the pipeline**. The twelve stages take about a minute.

## Thumbnail

A still of the Brief tab with the evidence profile on the right reads best.
