# Demo video

A 2 minute 45 second script for the submission video, recorded against the live demo at
https://candor-whistle.vercel.app. The left column is what is on screen; the right is what you say.
Every number below is on the page you are showing at that moment, so nothing has to be taken on
trust.

## Before you record

- Chrome, 1920×1080, browser zoom 110%, bookmarks bar hidden, dark theme, one tab.
- Open each page once beforehand so nothing cold-starts on camera.
- Record each scene as its own clip, then cut. Speed up only the waiting (sealing, scrolling) and
  say so on screen ("2× speed").
- Add burned-in captions; many judges watch muted.
- Speak slower than feels natural. The script is about 360 words, which fits 2:45 with pauses.

## Script

| Time      | On screen                                                                                                                                  | Say                                                                                                                                                                                                                                                                                               |
| --------- | ------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 0:00–0:15 | Landing page. Let the animated email run through Detect and Replace.                                                                       | "Most fraud is caught because someone inside speaks up. Forty-three percent of cases start with a tip. But speaking up is dangerous: hotlines ask who you are, and your files carry your name. Candor lets you say what happened, not who you are."                                               |
| 0:15–0:30 | `/report/northwind-ethics` → Start → **Use test passport A** → Continue.                                                                   | "I prove I'm a real adult with a zero-knowledge passport check. The service learns yes or no. It then blind-signs a token, so even it can't link my report back to that check."                                                                                                                   |
| 0:30–0:50 | **Use sample evidence** → **Clean and review**. Point at the removed PDF and Word properties, then at a name turning into `PERSON_1`.      | "Everything is cleaned here on my device. The PDF loses its author, the Word file loses its hidden properties, the emails lose their IP addresses, and every name becomes a placeholder, the same one in every file."                                                                             |
| 0:50–1:05 | **Looks right** → **Seal and send** (2× speed) → the eight-word codename.                                                                  | "Then it's encrypted, and the key is split three ways: any two reviewers can open it, one alone can't, and neither can we. These eight words are my anonymous inbox."                                                                                                                             |
| 1:05–1:25 | `/console` → **Avery Chen** → open the Northwind report. Brief tab.                                                                        | "Now the reviewer's side. Meta's Muse Spark Open, an open-weights model, read only the redacted text and wrote this brief. Every point ends in claim numbers, and code throws out any point it can't back up."                                                                                    |
| 1:25–1:45 | Click **C003** in point 02. Show the quote highlighted in the email, the "3 of 3 readings", the verifier verdict and the confidence score. | "Click any claim and you land on the exact sentence it came from. Muse extracted it three separate times, code matched the quote character by character, and a second, independent Muse pass checked it. The confidence is a formula, not a vibe."                                                |
| 1:45–2:00 | **Timeline** tab, then the purple "1 passage quarantined" box on the Brief.                                                                | "Dates are resolved against each document's own date, so 'yesterday' in a February email lands on the 17th. And this vendor PDF hides a note telling the AI to ignore its instructions and say nothing was wrong. It was quarantined, and the one claim that leaned on it is marked unsupported." |
| 2:00–2:15 | **Pipeline** tab. Point at "Muse Spark Open" under a model stage.                                                                          | "Twelve stages, nine calls to Muse Spark Open, fifty-nine seconds, sixteen cents. Because the weights are open, an organisation can run this model inside its own walls, so even the redacted evidence never has to leave."                                                                       |
| 2:15–2:30 | **Evidence** tab → Request access → approve as Morgan. Then `/audit` → **Run all checks** → **Tamper with this entry**.                    | "Opening the originals takes two of three reviewers, and every opening goes into a public Merkle log. Change one entry and the proofs fail, right here in the browser."                                                                                                                           |
| 2:30–2:45 | `/evals`, top of the page.                                                                                                                 | "We test it the hard way: six synthetic cases with planted names, injections and date puzzles, run on Muse. Zero identifier leaks, every quote found word for word, every planted injection caught. That's Candor: say what happened, not who you are."                                           |

## Stronger variant: a live run on your machine

The hosted demo shows a recorded run. Swapping the 2:00–2:15 scene for a live one shows Muse working
in real time and costs about 60 seconds of footage at 4× speed. With `BASETEN_API_KEY` in `.env`:

```bash
pnpm seed   # fresh demo data; the test passports allow three reports a month
pnpm dev    # identity, API, Muse worker and web app on http://localhost:3000
```

1. Make a report at `localhost:3000/report/northwind-ethics` exactly as in the script.
2. In `/console`, sign in as Avery Chen, open the new report, click **Run analysis · 0.50 USDC**,
   then **Pay 0.50 USDC and run** (x402, mock settlement) and **Watch the pipeline**.
3. Record the stages turning green, at 4× speed with "4×" on screen.

Say instead: "This is live. The organisation pays fifty cents over x402, and Muse Spark Open works
through twelve stages in about a minute. Because the weights are open, an organisation can run this
model inside its own walls, so even the redacted evidence never has to leave."

## Submission thumbnail

A screenshot of the Brief tab with the evidence profile on the right reads best as a still.
