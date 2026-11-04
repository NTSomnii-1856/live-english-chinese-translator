# Hosting

GitHub Pages hosts the static `docs/` entry page. The host PC runs the local model and must stay awake. Install dependencies with `npm ci`, then launch `Share Translator.cmd`.

Sharing starts the local translation server on 8767, an authenticated proxy on 8766, and the owner dashboard on 8768. All bind to loopback. Only 8766 is tunneled by ngrok. The dashboard shows the QR and random six-digit code; that code is never embedded in the GitHub page or written to `.local/share-info.json`.

The proxy checks tunnel host, HTTPS forwarding, request origin, login attempts, cookie lifetime, body size and supported routes. Student sessions have private transcripts, one active request per device, and a bounded fair queue. Local inference runs one request at a time on a warm model worker. Student devices cannot read the local feed or clear other students’ data. ngrok inspection is disabled. The PC microphone and browser are not required.

The pinned translation and speech ONNX models download from Hugging Face into ignored `.local/models/` on first start. Student microphone audio reaches the PC through the authenticated `/recognize` endpoint, limited to six seconds of 16 kHz mono PCM per request. Each session gets one active recognition and one active translation request, through separate bounded queues. Recognition and translation run locally, with no model-provider API calls and no saved recordings. Audio, caption modules and the worklet are available only to authenticated remote devices. English and Chinese captions are profanity-filtered before leaving the PC. ngrok still requires connectivity. The optional `TRANSLATOR_ENGINE=codex` translation path requires the host’s Codex sign-in; speech recognition stays local and no account credential is forwarded to browsers.

For use while this PC is off, install the backend and model on another host and provide authenticated HTTPS access there. A static HTML host alone cannot perform this backend inference.
