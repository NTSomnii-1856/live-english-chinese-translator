# Live English → Simplified Chinese

Entry page: https://ntsomnii-1856.github.io/live-english-chinese-translator/

Protected live translator: https://rockiness-curve-satchel.ngrok-free.dev (available while sharing is running on the PC).

## Use from another device (PC stays on, no API key)

Run **Share Translator.cmd** on the PC. It starts the protected HTTPS connection and background Codex bridge. On the PC, open **http://127.0.0.1:8768** to display the QR and six-digit code. Each student scans it, enters the code, taps **Start listening** on their own device, and allows that device’s microphone. The student device listens to English and shows its own Simplified Chinese translation.

The host PC needs to stay awake with the background sharing service running and Codex signed in. Its microphone is not used, and no translator or browser tab needs to stay open there. The phone captures speech; the PC only forwards text to Codex using the existing account. Internet access and the account’s Codex usage allowance are still required.

Keep the PC awake and the sharing process running. Closing it disconnects remote devices. The access code changes on a normal new launch. Signed-in device sessions last up to 12 hours. The code authorizes devices to translate using the host account; do not publish it.

**Student screen:** English and Chinese panels, maximize/restore buttons, a microphone start/stop button, and a clear button. Each device has its own transcript and context. Clearing one screen does not affect another. Student devices cannot read the old shared class feed. Up to three phrases translate concurrently, with additional devices queued fairly. Browser speech recognition support varies; use a supported browser and allow microphone access.

The GitHub Pages entry page also displays a QR without the access code. QR codes contain only the HTTPS student address, never an access code or account credential.

Remote sharing requires ngrok installed and connected to an ngrok account. ngrok relays HTTPS traffic between your browser and PC, including speech transcripts and translations. Browser speech recognition may also send microphone audio to the browser provider. Codex account credentials remain in the PC's Codex installation, outside the repository and browser.

The public `docs/` folder is a GitHub Pages entry page. It links to the protected HTTPS translator; translation runs on the PC. A changed sharing address can be entered on that page. GitHub Pages cannot run the Node.js / Codex backend.

## Use only on this PC

Double-click **Start Translator.cmd**, keep its terminal open, then use **http://127.0.0.1:8765** in Chrome or Edge. Click **Start listening** and allow the microphone.

The HTML needs the included local Node.js bridge. It uses Codex CLI's existing ChatGPT sign-in, with no separate API key. This is a separate temporary translation session under your account, not messages inserted into the open Codex chat. It requires internet and consumes your account's Codex usage allowance.

Requirements: Node.js 20+, Codex CLI on PATH, and `codex login` completed using ChatGPT. If launching from a terminal: `node server.mjs`.

Speech is transcribed by browser speech recognition (which may send audio to the browser provider). Confirmed phrases are translated by Codex and stream into the Chinese pane; expect a delay of several seconds, rather than simultaneous speech interpretation. A typed-input alternative is included.

**Read Chinese aloud** uses your browser's Chinese voice, if installed. For microphone feedback prevention, speech plays when listening has stopped. Captions continue while listening. Use headphones. Copy, save, clear, and failed-phrase retry controls are included. Transcripts are kept only in page memory unless you save them; clearing or refreshing removes them. Browser/cloud providers' own retention policies still apply.

All local listeners bind only to 127.0.0.1. The remote proxy authenticates devices before forwarding any page or translation, checks request origins, and uses Secure / HttpOnly cookies. It exposes only the translator routes. The PC owner page is on a separate port that is never tunneled. Codex account credentials stay outside the browser. Translator sessions are ephemeral and have read-only sandboxing with environment access disabled. Runtime state goes in ignored `.local/` folders. No credentials are included in the source.

## Checks

Run `npm run check` and `npm test`. There are no package dependencies to install.

Reference: [Codex app-server](https://learn.chatgpt.com/docs/app-server).
