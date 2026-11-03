import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createRemoteProxy } from './remote-proxy.mjs';

test('remote sharing requires login and rejects foreign origins before proxying', async t => {
  const publicOrigin = 'https://translator.example';
  const code = '123456';
  let called = 0;
  const upstream = http.createServer((req, res) => {
    called++;
    assert.equal(req.headers.origin, target);
    assert.equal(req.headers.host, new URL(target).host);
    assert.match(req.headers['x-translator-device'],/^[a-f0-9]{64}$/);
    res.writeHead(200, { 'Content-Type': 'application/x-ndjson' });
    res.end(JSON.stringify({ type: 'done', text: '你好' }) + '\n');
  });
  await new Promise(r => upstream.listen(0,'127.0.0.1',r));
  const target = `http://127.0.0.1:${upstream.address().port}`;
  const proxy = createRemoteProxy({ target, getPublicOrigin:()=>publicOrigin, code });
  await new Promise(r => proxy.listen(0,'127.0.0.1',r));
  t.after(()=>{proxy.closeAllConnections();proxy.close();upstream.closeAllConnections();upstream.close();});
  function request(path, {method='GET',body,origin,cookie,host='translator.example'}={}) {
    return new Promise((resolve,reject)=>{
      const headers={host,'x-forwarded-proto':'https'};
      if(origin)headers.origin=origin;
      if(cookie)headers.cookie=cookie;
      if(body)headers['content-type']=path==='/login'?'application/x-www-form-urlencoded':'application/json';
      const req=http.request({hostname:'127.0.0.1',port:proxy.address().port,path,method,headers},res=>{
        let data='';res.setEncoding('utf8');res.on('data',part=>data+=part);res.on('end',()=>resolve({status:res.statusCode,headers:res.headers,body:data}));
      });req.on('error',reject);req.end(body);
    });
  }
  const login=await request('/');
  assert.equal(login.headers['referrer-policy'],'same-origin');
  assert.equal(login.status,200); assert.match(login.body,/Access code/);assert.ok(!login.body.includes(code));
  assert.equal((await request('/translate',{method:'POST',origin:publicOrigin,body:'{}'})).status,401);
  assert.equal((await request('/speech-preview.mjs')).status,401);
  assert.equal((await request('/login',{method:'POST',origin:'https://evil.example',body:'code='+code})).status,403);
  assert.equal((await request('/login',{method:'POST',origin:'null',body:'code='+code})).status,403);
  assert.equal((await request('/login',{method:'POST',origin:publicOrigin,body:'code=wrong'})).status,401);
  const signedIn=await request('/login',{method:'POST',origin:publicOrigin,body:'code='+code});
  assert.equal(signedIn.status,303);
  const setCookie=signedIn.headers['set-cookie'][0];
  for(const flag of ['Secure','HttpOnly','SameSite=Strict','Path=/'])assert.ok(setCookie.includes(flag));
  const cookie=setCookie.split(';')[0];
  assert.equal((await request('/translate',{method:'POST',origin:'https://evil.example',cookie,body:'{}'})).status,403);
  assert.equal((await request('/translate',{method:'POST',cookie,body:'{}'})).status,403);
  assert.equal((await request('/status',{cookie,host:'evil.example'})).status,403);
  assert.equal((await request('/live',{cookie})).status,403);
  const translated=await request('/translate',{method:'POST',origin:publicOrigin,cookie,body:'{"text":"Hello"}'});
  assert.equal(translated.status,200);assert.match(translated.body,/你好/);assert.equal(called,1);
  assert.equal((await request('/clear',{method:'POST',origin:publicOrigin,cookie,body:'{}'})).status,200);
  assert.equal((await request('/speech-preview.mjs',{cookie})).status,200);
  assert.equal((await request('/owner',{cookie})).status,404);
  assert.equal((await request('/logout',{method:'POST',origin:publicOrigin,cookie})).status,303);
  assert.equal((await request('/status',{cookie})).status,401);
  assert.match(login.body, /inputmode="numeric"/);
  for(let i=0;i<4;i++) assert.equal((await request('/login',{method:'POST',origin:publicOrigin,body:'code=000000'})).status,401);
  assert.equal((await request('/login',{method:'POST',origin:publicOrigin,body:'code='+code})).status,429);
});
