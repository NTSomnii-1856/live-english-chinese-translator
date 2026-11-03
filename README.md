# Live English → Simplified Chinese

Entry page: https://ntsomnii-1856.github.io/live-english-chinese-translator/

Protected live translator: https://rockiness-curve-satchel.ngrok-free.dev (available while sharing is running on the PC).

## Use from another device (PC stays on, no API key)

Run **Share Translator.cmd** on the PC. It starts an access-code-protected ngrok HTTPS connection and the local Codex bridge. On that PC, open **http://127.0.0.1:8768** to see the HTTPS address and access code. Open **http://127.0.0.1:8767** on the teacher PC and click **Start listening**. Students open the HTTPS address or scan the QR code, enter the access code, and see the teacher’s live English and Simplified Chinese captions automatically.

Keep the PC awake and the sharing process running. Closing it disconnects remote devices. The access code changes whenever sharing starts. Signed-in device sessions last up to 12 hours. Treat the code as a password: it lets a device view your live classroom transcript.

**Student QR:** the PC sharing page displays a large QR code and the current access code. Students scan it and enter the access code. Their view contains only the English and Chinese panels, with maximize/restore controls on each panel. Student devices do not request microphone access. The GitHub Pages entry page also displays a QR code without the access code. The translator toolbar has a **Student QR** link to that entry page. QR codes contain only the HTTPS student-view address, never an access code or account credential. Remote students can read the live feed but cannot start translations or clear the class transcript. Refreshing or reconnecting restores up to the latest 200 phrases. Clearing the teacher transcript clears student screens.

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
