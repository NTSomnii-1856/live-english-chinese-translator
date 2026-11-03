import http from 'node:http';
import { spawn, execFileSync } from 'node:child_process';
import { randomInt } from 'node:crypto';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdir, writeFile } from 'node:fs/promises';
import { createRemoteProxy } from './remote-proxy.mjs';
import { studentQrSvg } from './student-qr.mjs';

const root = dirname(fileURLToPath(import.meta.url));
const runtime = resolve(root, '.local');
await mkdir(runtime, { recursive: true });
const code = /^[0-9]{6}$/.test(process.env.TRANSLATOR_ACCESS_CODE || '')
  ? process.env.TRANSLATOR_ACCESS_CODE : String(randomInt(100000, 1000000));
const target = 'http://127.0.0.1:8767';
let publicOrigin = null;
let tunnel = null;
let bridge = null;
let stopping = false;
const proxy = createRemoteProxy({ target, code, getPublicOrigin: () => publicOrigin });
// The owner dashboard has a separate loopback-only port that is never tunneled.
const owner = http.createServer((req, res) => {
  if (req.headers.host !== '127.0.0.1:8768' || req.headers.origin || req.headers['sec-fetch-site'] === 'cross-site') { res.writeHead(403); return res.end('Local access only.'); }
  if (req.method === 'POST' && req.url === '/stop') {
    if (req.headers['x-owner-code'] !== code) { res.writeHead(403); return res.end('Owner authorization required.'); }
    res.end('Sharing stopped.'); setImmediate(stop); return;
  }
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer', 'X-Frame-Options': 'DENY', 'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; frame-ancestors 'none'" });
  res.end(`<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Translator · Student QR & sharing</title>
  <style>*{box-sizing:border-box}body{font:16px system-ui;background:#f6f5f0;color:#202822;max-width:720px;margin:36px auto;padding:24px;line-height:1.8}h1{font:42px Georgia;margin-bottom:10px}h2{font-size:22px}.student-access{background:#fffefa;border:1px solid #d9ded3;border-radius:16px;padding:26px;text-align:center}.student-access svg{display:block;width:min(100%,320px);height:auto;margin:12px auto;background:#fff}.student-access p{font-size:14px;color:#72786f}code{display:block;background:#e9eee3;padding:14px;font-size:clamp(19px,4vw,28px);border-radius:10px;overflow-wrap:anywhere;user-select:all}a{color:#24664d;overflow-wrap:anywhere}small{display:block;color:#72786f;margin-top:20px}.print{font:inherit;padding:10px 14px;border:1px solid #d9ded3;border-radius:8px;background:#fffefa;color:#24664d;cursor:pointer}@media print{body{margin:0;max-width:none}.print,small{display:none}.student-access{border:0}.student-access svg{width:360px}}</style>
  <h1>Student sign-in</h1><p>Show this page to the students you want to give access.</p>
  <section class="student-access"><h2>Scan to open the translator</h2>
  ${publicOrigin ? studentQrSvg(publicOrigin) : '<p>Starting the secure connection… Refresh in a moment.</p>'}
  <p>1. Scan with your phone camera.<br>2. Enter the access code below.<br>3. Watch the teacher’s live translation.</p>
  <code>${code}</code>
  ${publicOrigin ? `<p><a href="${publicOrigin}" target="_blank" rel="noreferrer">${publicOrigin}</a></p>` : ''}
  </section><p>Teacher: <a href="http://127.0.0.1:8767" target="_blank" rel="noreferrer">Open teacher studio</a> and start listening there.</p><small>Share this code only with your students. Keep this PC awake and sharing running. Closing sharing disconnects devices; restarting changes the access code.</small></html>`);
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
  let ngrokBin = process.env.NGROK_BIN || 'ngrok';
  if (!process.env.NGROK_BIN && process.platform === 'win32') {
    try {
      const installed = execFileSync('powershell.exe', ['-NoProfile', '-Command', 'Get-AppxPackage -Name ngrok.ngrok | Select-Object -ExpandProperty InstallLocation'], { encoding: 'utf8', windowsHide: true, stdio: ['ignore','pipe','ignore'] }).trim();
      if (installed && !installed.includes('\n')) ngrokBin = resolve(installed, 'ngrok.exe');
    } catch {}
  }
  tunnel = spawn(ngrokBin, ['http', 'http://127.0.0.1:8766', '--inspect=false', '--log=stdout', '--log-format=json'], { cwd: root, windowsHide: true, stdio: ['ignore','pipe','pipe'] });
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
  console.log(`Student translator: ${publicOrigin}/?student=1\nTeacher studio: http://127.0.0.1:8767\nStudent QR + access code (on this PC only): http://127.0.0.1:8768\nKeep this process running. Press Ctrl+C to stop sharing.`);
} catch (error) { console.error(error.message); stop(); process.exitCode=1; }
