# Hosting

GitHub Pages hosts the static `docs/` entry page. The host PC runs the local model and must stay awake. Install dependencies with `npm ci`, then launch `Share Translator.cmd`.

Sharing starts the local translation server on 8767, an authenticated proxy on 8766, and the owner dashboard on 8768. All bind to loopback. Only 8766 is tunneled by ngrok. The dashboard shows the QR and random six-digit code; that code is never embedded in the GitHub page or written to `.local/share-info.json`.

The proxy checks tunnel host, HTTPS forwarding, request origin, login attempts, cookie lifetime, body size and supported routes. Student sessions have private transcripts, one active request per device, and a bounded fair queue. Local inference runs one request at a time on a warm model worker. Student devices cannot read the local feed or clear other students’ data. ngrok inspection is disabled. The PC microphone and browser are not required.

The pinned ONNX model downloads from Hugging Face into ignored `.local/models/` on first start. Student text is processed locally, with no model-provider API calls. Browser speech recognition and ngrok still require connectivity. The optional `TRANSLATOR_ENGINE=codex` path requires the host’s Codex sign-in; no account credential is forwarded to browsers.

For use while this PC is off, install the backend and model on another host and provide authenticated HTTPS access there. A static HTML host alone cannot perform this backend inference.
