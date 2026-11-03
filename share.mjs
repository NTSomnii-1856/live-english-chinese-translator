import http from 'node:http';
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdir, writeFile } from 'node:fs/promises';
import { createRemoteProxy } from './remote-proxy.mjs';

const root = dirname(fileURLToPath(import.meta.url));
const runtime = resolve(root, '.local');
await mkdir(runtime, { recursive: true });
const code = randomBytes(12).toString('base64url');
const target = 'http://127.0.0.1:8767';
let publicOrigin = null;
let tunnel = null;
let bridge = null;
let stopping = false;
const proxy = createRemoteProxy({ target, code, getPublicOrigin: () => publicOrigin });
// The owner dashboard has a separate loopback-only port that is never tunneled.
const owner = http.createServer((req, res) => {
  if (req.headers.host !== '127.0.0.1:8768' || req.headers.origin || req.headers['sec-fetch-site'] === 'cross-site') { res.writeHead(403); return res.end('Local access only.'); }
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer', 'X-Frame-Options': 'DENY', 'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; frame-ancestors 'none'" });
  res.end(`<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Translator · PC sharing controls</title><style>body{font:16px system-ui;background:#f6f5f0;color:#202822;max-width:650px;margin:60px auto;padding:24px;line-height:1.8}h1{font:42px Georgia}code{display:block;background:#e9eee3;padding:16px;font-size:24px;border-radius:10px;overflow-wrap:anywhere}a{color:#24664d;overflow-wrap:anywhere}small{color:#72786f}</style><h1>Translator sharing</h1><p>Open this HTTPS address on your other device:</p><p>${publicOrigin ? `<a href="${publicOrigin}" target="_blank" rel="noreferrer">${publicOrigin}</a>` : 'Starting the secure connection… Refresh in a moment.'}</p><p>Enter this access code there:</p><code>${code}</code><p>Keep this code private. It lets a device use your translator and Codex allowance.</p><small>Keep this PC awake and the sharing process running. To disconnect every device, close sharing. This code changes each time sharing starts.</small></html>`);
});
async function waitFor(url, tries = 40) {
  for (let i = 0; i < tries; i++) {
    if (stopping) throw new Error('Sharing stopped.');
    try { const res = await fetch(url, { signal: AbortSignal.timeout(2000) }); if (res.ok) return res; } catch {}
    await new Promise(r => setTimeout(r, 400));
  }
  throw new Error('The local translator did not become ready.');
}
async function listen(server, port) {
  await new Promise((done, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', done); });
}
function stop() {
  if (stopping) return; stopping = true;
  tunnel?.kill(); bridge?.kill(); proxy.close(); owner.close();
  setTimeout(() => process.exit(0), 300).unref();
}
for (const sig of ['SIGINT','SIGTERM']) process.on(sig, stop);
try {
  await listen(owner, 8768);
  await listen(proxy, 8766);
  bridge = spawn(process.execPath, [resolve(root, 'server.mjs')], { cwd: root, env: { ...process.env, PORT: '8767' }, windowsHide: true, stdio: ['ignore','pipe','pipe'] });
  bridge.stdout.on('data', () => {}); bridge.stderr.on('data', () => {});
  bridge.on('error', error => { console.error('Translator could not start:', error.message); stop(); });
  bridge.on('exit', () => { if (!stopping) { console.error('Translator closed.'); stop(); } });
  await waitFor(target);
  tunnel = spawn(process.env.NGROK_BIN || 'ngrok', ['http', 'http://127.0.0.1:8766', '--inspect=false', '--log=stdout', '--log-format=json'], { cwd: root, windowsHide: true, stdio: ['ignore','pipe','pipe'] });
  let output = '';
  tunnel.stdout.on('data', bytes => {
    output += bytes.toString(); let at;
    while ((at = output.indexOf('\n')) !== -1) {
      const line = output.slice(0, at); output = output.slice(at+1);
      try {
        const event = JSON.parse(line);
        if (event.url?.startsWith('https://') && event.msg === 'started tunnel') {
          const parsed = new URL(event.url);
          if (parsed.protocol === 'https:' && !parsed.username && !parsed.password && parsed.pathname === '/') publicOrigin = parsed.origin;
        }
      } catch {}
    }
  });
  // Do not log ngrok configuration or tokens.
  tunnel.stderr.on('data', () => {});
  tunnel.on('error', error => { console.error('ngrok could not start:', error.message); stop(); });
  tunnel.on('exit', () => { if (!stopping) { console.error('ngrok closed. Check that ngrok is signed in and no conflicting endpoint is running.'); stop(); } });
  for (let i=0; i<100 && !publicOrigin && !stopping; i++) await new Promise(r=>setTimeout(r,300));
  if (!publicOrigin) throw new Error('No HTTPS tunnel was assigned. Check ngrok sign-in/configuration.');
  // Only the public address is persisted; access codes and account credentials are not.
  await writeFile(resolve(runtime, 'share-info.json'), JSON.stringify({ publicOrigin, ownerUrl:'http://127.0.0.1:8768' }, null, 2));
  console.log(`Online translator: ${publicOrigin}\nAccess code (on this PC only): http://127.0.0.1:8768\nKeep this process running. Press Ctrl+C to stop sharing.`);
} catch (error) { console.error(error.message); stop(); process.exitCode=1; }
