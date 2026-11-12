# Demo video

Narrated 2:55 walkthrough of PayPilot, recorded live against the Azure deployment and PayPal Sandbox. The rendered `paypilot-demo.mp4` and the raw recording are gitignored; this folder holds what is needed to reproduce them.

| File | Purpose |
| --- | --- |
| `script.json` | Narration, one line per beat. Every figure must match what the app shows at recording time. |
| `narrate.py` | Renders `audio/<voice>/NN.wav` with Kokoro TTS and writes `timings.json` (how long each beat holds). |
| `record.mjs` | Drives Chrome through the app beat by beat (cursor, typing, spotlights) and writes `session.mp4` + `beats.json` (when each beat began). |
| `mux.py` | Places each narration line at its recorded beat time and encodes the final MP4. |
| `cards/` | Title cards shown at the start and end. |
| `beats_raw.json` | Beat times of the final take before the edit below. |
| `rehearse.mjs`, `shots.mjs` | Helpers used to time agent responses and screenshot pages while writing the script. |

## Re-record

Needs `ffmpeg`, `espeak-ng`, a Python venv with `kokoro soundfile`, and Chrome for Testing (`CHROME_PATH`). PayPal credentials come from the repo's `.env`.

```bash
cd demo && npm install
KVOICE=af_heart KSPEED=1.12 KAIR=0.45 <venv>/bin/python narrate.py
DRY=1 node --env-file=../.env record.mjs https://<app-host> dry.mp4   # rehearsal: no PayPal reminder, no payment
node --env-file=../.env record.mjs https://<app-host> session.mp4      # real take
KVOICE=af_heart python3 mux.py session.mp4 paypilot-demo.mp4
```

The real take has side effects in PayPal Sandbox: it sends a reminder for invoice `PILOT-1794474025465-A` (PayPal allows two per invoice per day) and records a $2,000 external payment on `INV2-5M2P-HLUK-BB6L-JZS8`. Re-check the numbers in `script.json` against the dashboard before every take, and cancel pending drafts left by rehearsals.

## Edits in the published cut

The PayPal `INVOICING.INVOICE.PAID` webhook took about 28 seconds to arrive, so 11 seconds of static screen (139.5–150.5 s of `session.mp4`) were trimmed and later beats shifted by 11 s (`beats.json` vs `beats_raw.json`). Nothing else is cut or staged.

## Recorder note

`record.mjs` captures frames over the Chrome DevTools Protocol with a screenshot watchdog instead of `page.screencast()`. The built-in screencast intermittently stopped delivering frames for tens of seconds mid-session, freezing the picture.
