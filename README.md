# Live English → Simplified Chinese

Entry page: https://ntsomnii-1856.github.io/live-english-chinese-translator/

Protected student app: https://rockiness-curve-satchel.ngrok-free.dev/?student=1

## Students and host PC

Run **Share Translator.cmd** on the host PC. Open **http://127.0.0.1:8768** to show the student QR and six-digit code. Each student scans, signs in, taps **Start listening**, and allows their phone’s microphone. Each phone listens independently and displays its own English and Simplified Chinese panels, with maximize/restore and Clear controls.

Keep the host PC awake with the background service running. Its microphone is never used; its browser can close. Each phone sends short microphone audio snippets through the authenticated HTTPS connection to the PC. Speech recognition and translation run locally there. Audio is processed in memory and is not saved. No API key or Codex sign-in is needed for the default engine. Translation does not consume a Codex allowance.

The default engine is quantized [OPUS-MT English → Chinese](https://huggingface.co/Xenova/opus-mt-en-zh), with a Simplified Mandarin target token. It uses [Transformers.js](https://huggingface.co/docs/transformers.js/en/index) and ONNX on the PC CPU. The pinned weights download once (about 120 MB) from Hugging Face into ignored `.local/models/`, then stay cached. Transcripts are never sent to Hugging Face. The model stays warm in a worker with two inference threads; requests from different devices queue fairly. Typical short-sentence inference measured on this host was 0.12–0.30 seconds, before network and recognition latency. Accuracy can be lower than a larger cloud model, especially for names or specialist vocabulary.

Speech recognition uses quantized [Moonshine tiny](https://huggingface.co/onnx-community/moonshine-tiny-ONNX), with about 28 MB of additional model weights cached locally. The phone captures 16 kHz mono audio in 100 ms packets. The first preview is submitted after about 0.9 seconds of detected speech, with coalesced updates every 0.8 seconds and a final update after a short pause. Audio windows are bounded to 4.5 seconds, and only one recognition request per device runs at a time. Silence does not send requests. Model inference on short synthetic recordings measured about 60–160 ms on this PC; capture time, network, PC load and translation add to the delay. This bypasses delayed Android browser recognition and does not promise instantaneous captions.

Recognized speech is divided into sections of at most eight words. Unchanged sections are not translated again. New untranslated sections go ahead of older refinements, while existing Chinese stays visible until its correction is ready. Final recognition can correct or remove earlier draft sections in place. Drafts appear lighter.

Common English and Chinese profanity is replaced with `***` before display, translation, spoken output, copying or export. The streaming filter holds incomplete matches so known words cannot flash across split token updates. This is a vocabulary filter, not a guarantee against every euphemism or unfamiliar spelling. Normal classroom words and biology terms are preserved.

The access code changes on a normal new launch. Signed-in sessions last up to 12 hours. QR codes contain only the student HTTPS address, never the code. Each device has its own transcript. Clearing one screen does not affect another; student devices cannot read the local shared feed. Text stays in page memory unless saved. The local model keeps no conversation history.

## Installation

Use Node.js 20 or newer, then run `npm ci` in this folder. Remote sharing also requires ngrok installed and connected to an ngrok account. Double-click **Share Translator.cmd** to share, or **Start Translator.cmd** for local use at **http://127.0.0.1:8765**. The first launch needs internet to download model files; subsequent launches use the cache.

Microphone access from another device requires HTTPS and a browser supporting AudioWorklet, such as Android Chrome. ngrok relays microphone audio, recognized text and translations between phones and the host PC. The default app does not call the phone browser’s cloud speech-recognition service. School networks may block ngrok even when mobile data works.

GitHub Pages hosts the `docs/` entry page; it cannot run the translation backend. Public source excludes model files, credentials, access codes and transcripts. The owner dashboard is local-only, separate from the authenticated tunnel. The proxy validates request origins and uses Secure / HttpOnly session cookies. All local listeners bind to 127.0.0.1.

## Optional Codex engine

Set `TRANSLATOR_ENGINE=codex` before launch to use the previous cloud engine instead. This requires Codex CLI on PATH and `codex login` using ChatGPT. It uses a separate ephemeral session per device, not this open chat, and consumes the account’s Codex allowance. Defaults are GPT-6 Luna with no reasoning; `TRANSLATOR_MODEL` and `TRANSLATOR_EFFORT` override these. Codex credentials remain outside the browser and repository. Cloud requests have higher network latency.

## Checks and model license

Run `npm run check` and `npm test`. The tests cover authentication, origin checks, device isolation, queuing, audio packet format and microphone cleanup, profanity split across streaming tokens, and caption revisions. Translation integration uses `npm run test:local`. Speech integration uses `npm run test:speech`; set `SPEECH_TEST_WAV` to an artificial 16-bit mono 16 kHz WAV to run the model check. No real microphone is activated by these tests.

The original [Helsinki-NLP OPUS-MT model](https://huggingface.co/Helsinki-NLP/opus-mt-en-zh) is Apache-2.0 licensed. ONNX weights are pinned to revision `046f55aec303cdee3e0318604406d4df20f1e8ea` of `Xenova/opus-mt-en-zh`. Package versions are locked in `package-lock.json`. Weights are downloaded, never committed.

Moonshine tiny ONNX weights are pinned to `a6da1241cd305dcd64eab1edbd615f2bb9aabb95`, MIT licensed, and stored only in `.local/models/`. `SPEECH_CPU_THREADS` optionally overrides the default one inference thread; increasing it can make short snippets slower.
