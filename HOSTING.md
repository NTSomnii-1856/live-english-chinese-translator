# Hosting choices

This repository contains the local translator, a protected remote-sharing launcher, and a GitHub Pages entry page. Publishing its HTML alone does not provide a working online translator.

GitHub Pages serves static HTML, CSS, and JavaScript. It cannot launch the included Node.js / Codex bridge. Do not publish Codex credentials, access tokens, session files, or a server-issued page token to GitHub.

For cross-device use with the existing Codex account, run `Share Translator.cmd`. The sharing launcher starts a separate Codex bridge on port 8767, an authenticated remote proxy on 8766, and a PC owner dashboard on 8768. All bind to loopback. Only port 8766 is tunneled by ngrok. Remote browsers must enter a randomly generated 96-bit access code before viewing the translator or calling translation endpoints. The dashboard shows that code locally; it is never committed or embedded in the GitHub page. The `.local/share-info.json` runtime file contains only the public HTTPS address.

The proxy checks the assigned tunnel host, HTTPS forwarding, request origins, access-code login attempts, cookie lifetime, request size, and supported routes. ngrok request inspection is disabled. Closing sharing stops the tunnel and its child bridge. Existing local-only translation on port 8765 can continue separately.

GitHub Pages serves `docs/`. Initially it asks for your sharing address. After an address is assigned, its main link can be updated to that address. Public GitHub source and remote sharing are separate decisions; a private repository can store the code while the protected translator is reached through its HTTPS address.

For use while that PC is off, run a backend on a separate host and configure supported model authentication there. An OpenAI API version needs server-side API credentials; they must never appear in GitHub Pages HTML or browser code.

Microphone capture on another device requires HTTPS, a supported browser, and microphone permission. Translation still requires internet access.

References: [GitHub Pages](https://docs.github.com/en/pages/getting-started-with-github-pages/creating-a-github-pages-site), [Codex app-server](https://learn.chatgpt.com/docs/app-server).
