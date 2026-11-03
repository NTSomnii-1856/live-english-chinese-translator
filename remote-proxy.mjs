import http from 'node:http';
import { randomBytes, timingSafeEqual } from 'node:crypto';

export function createRemoteProxy({ target, getPublicOrigin, code }) {
  const sessions = new Map();
  const attempts = new Map();
  const cookieName = '__Host-translator';
  const ttl = 12 * 60 * 60 * 1000;
  const compare = value => {
    const a = Buffer.from(value || ''); const b = Buffer.from(code);
    return a.length === b.length && timingSafeEqual(a, b);
  };
  const cleanup = setInterval(() => {
    const now = Date.now();
    for (const [key, value] of sessions) if (value < now) sessions.delete(key);
    for (const [key, value] of attempts) if (value.until < now) attempts.delete(key);
  }, 60000).unref();
  function limit(key, max) {
    let entry = attempts.get(key);
    if (!entry || entry.until < Date.now()) { entry = { count: 0, until: Date.now() + 60000 }; attempts.set(key, entry); }
    return ++entry.count <= max;
  }
  function locked(key, max) { const entry = attempts.get(key); return entry && entry.until > Date.now() && entry.count >= max; }
  function reply(res, status, data, type = 'application/json; charset=utf-8') {
    res.writeHead(status, { 'Content-Type': type });
    res.end(type.startsWith('application/json') ? JSON.stringify(data) : data);
  }
  const server = http.createServer(async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    // Native sign-in forms need their same-origin Origin header. no-referrer
    // can make browsers send Origin: null for a form navigation.
    res.setHeader('Referrer-Policy', 'same-origin');
    res.setHeader('Content-Security-Policy', "default-src 'self'; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
    const publicOrigin = getPublicOrigin();
    if (!publicOrigin) return reply(res, 503, { error: 'The sharing connection is starting.' });
    if (req.headers.host !== new URL(publicOrigin).host || req.headers['x-forwarded-proto'] !== 'https') return reply(res, 403, { error: 'Use the HTTPS sharing address.' });
    if (req.headers.origin && req.headers.origin !== publicOrigin) return reply(res, 403, { error: 'Request origin rejected.' });
    const path = new URL(req.url, publicOrigin).pathname;
    const ip = String(req.headers['x-forwarded-for'] || req.socket.remoteAddress).split(',').pop().trim();
    if (req.method === 'POST' && path === '/login') {
      if (req.headers.origin !== publicOrigin) return reply(res, 403, { error: 'Open the sign-in page first.' });
      if (locked('login:' + ip, 5) || locked('login:global', 60)) return reply(res, 429, { error: 'Too many attempts. Wait a minute and try again.' });
      if (!String(req.headers['content-type']).startsWith('application/x-www-form-urlencoded')) return reply(res, 415, { error: 'Expected a sign-in form.' });
      let body = ''; req.setEncoding('utf8');
      for await (const part of req) { body += part; if (body.length > 1000) return reply(res, 413, { error: 'Request too large.' }); }
      if (!compare(new URLSearchParams(body).get('code')?.trim())) {
        limit('login:' + ip, 5); limit('login:global', 60);
        return reply(res, 401, loginPage('Incorrect access code. Please try again.'), 'text/html; charset=utf-8');
      }
      if (sessions.size >= 100) return reply(res, 429, { error: 'Too many signed-in devices. Restart sharing to reset them.' });
      const session = randomBytes(32).toString('hex'); sessions.set(session, Date.now() + ttl);
      res.writeHead(303, { Location: '/?student=1', 'Set-Cookie': `${cookieName}=${session}; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=${ttl/1000}` });
      return res.end();
    }
    const session = String(req.headers.cookie || '').split(';').map(s => s.trim()).find(s => s.startsWith(cookieName + '='))?.slice(cookieName.length + 1);
    if (!session || (sessions.get(session) || 0) < Date.now()) {
      if (req.method === 'GET' && (path === '/' || path === '/index.html')) return reply(res, 200, loginPage(), 'text/html; charset=utf-8');
      return reply(res, 401, { error: 'Your device session expired. Refresh and enter the access code again.' });
    }
    if (req.method === 'POST' && path === '/logout' && req.headers.origin === publicOrigin) {
      sessions.delete(session);
      res.writeHead(303, { Location: '/', 'Set-Cookie': `${cookieName}=; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=0` });
      return res.end();
    }
    if (path === '/live') return reply(res, 403, { error: 'Each student device has its own private transcript.' });
    if (req.method === 'GET' && ['/', '/index.html'].includes(path) && new URL(req.url,publicOrigin).searchParams.get('student') !== '1') {
      res.writeHead(303, { Location: '/?student=1' }); return res.end();
    }
    if (!((req.method === 'GET' && ['/', '/index.html', '/status', '/speech-preview.mjs'].includes(path)) || (req.method === 'POST' && ['/translate','/clear'].includes(path)))) return reply(res, 404, { error: 'Not found.' });
    if (req.method === 'POST' && req.headers.origin !== publicOrigin) return reply(res, 403, { error: 'Request origin rejected.' });
    if (path === '/translate' && !limit('translate:' + session, 60)) return reply(res, 429, { error: 'Please wait a minute before translating more phrases.' });
    if (Number(req.headers['content-length']) > 20000) return reply(res, 413, { error: 'Phrase too long.' });
    const upstreamHeaders = { host: new URL(target).host, origin: target };
    upstreamHeaders['x-translator-device'] = session;
    for (const name of ['content-type', 'x-local-token']) if (req.headers[name]) upstreamHeaders[name] = req.headers[name];
    const upstream = http.request(new URL(path, target), { method: req.method, headers: upstreamHeaders }, response => {
      res.writeHead(response.statusCode, response.headers); response.pipe(res);
    });
    upstream.setTimeout(120000, () => upstream.destroy(new Error('Translation connection timed out.')));
    upstream.on('error', () => { if (!res.headersSent) reply(res, 502, { error: 'The PC translator is unavailable. Please restart Share Translator on the PC.' }); else res.destroy(); });
    res.on('close', () => upstream.destroy());
    // Bound streaming bodies too; a missing Content-Length must not remove the limit.
    let bytes = 0;
    req.on('data', part => { bytes += part.length; if (bytes > 20000) { upstream.destroy(); req.destroy(); } });
    req.pipe(upstream);
  });
  server.on('close', () => clearInterval(cleanup));
  return server;
}

function loginPage(error = '') {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Connect · Live Translate</title><style>*{box-sizing:border-box}body{font-family:system-ui,sans-serif;color:#202822;background:#f6f5f0;margin:0;min-height:100vh;display:grid;place-items:center;padding:24px}main{width:100%;max-width:440px;background:#fffefa;border:1px solid #d9ded3;padding:34px;border-radius:18px}small{color:#24664d;letter-spacing:2px}h1{font:40px Georgia,serif;letter-spacing:-1.2px;margin:17px 0}p{color:#72786f;font-size:14px;line-height:1.7}label{display:block;font-size:13px;margin-top:24px}input,button{font:inherit;width:100%;border-radius:9px;padding:13px;margin-top:9px}input{border:1px solid #d9ded3;background:white}button{border:0;color:white;background:#24664d;cursor:pointer}.error{color:#ab4035}footer{font-size:11px;line-height:1.6;color:#72786f;margin-top:24px}</style></head><body><main><small>ENGLISH → 简体中文</small><h1>Join translation</h1><p>Enter the access code from your teacher.</p><p class="error">${error}</p><form action="/login" method="post"><label for="code">Access code</label><input id="code" name="code" type="text" inputmode="numeric" pattern="[0-9]{6}" autocomplete="one-time-code" spellcheck="false" required minlength="6" maxlength="6" autofocus><button>Join →</button></form></main></body></html>`;
}
