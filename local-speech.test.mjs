import test from 'node:test';
import assert from 'node:assert/strict';
import { createAudioUtterances } from './local-speech.mjs';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
const voice = () => Float32Array.from({ length: 1600 }, (_, i) => 0.1 * Math.sin(i * 0.2));
const silence = () => new Float32Array(1600);
test('speech sends early previews before a final pause; silence sends nothing', () => {
  const requests = [], capture = createAudioUtterances({ onAudio: x => requests.push(x) });
  for (let i = 0; i < 20; i++) capture.push(silence());
  assert.equal(requests.length, 0);
  for (let i = 0; i < 9; i++) capture.push(voice());
  assert.equal(requests.length, 1); assert.equal(requests[0].final, false);
  assert.ok(requests[0].samples.length <= 16000);
  for (let i = 0; i < 6; i++) capture.push(silence());
  assert.equal(requests.at(-1).final, true); assert.equal(requests.at(-1).id, requests[0].id);
  for (let i = 0; i < 3; i++) capture.push(voice());
  capture.flush(); assert.notEqual(requests.at(-1).id, requests[0].id);
});
test('sustained speech has bounded audio windows and cancel drops buffered speech', () => {
  const requests = [], capture = createAudioUtterances({ onAudio: x => requests.push(x) });
  for (let i = 0; i < 130; i++) capture.push(voice());
  assert.ok(requests.filter(x => x.final).length >= 2);
  assert.ok(requests.every(x => x.samples.length <= 5.8 * 16000));
  const count = requests.length; capture.clear(); capture.flush(); assert.equal(requests.length, count);
});
test('audio worklet resamples native microphone rates into exact 100 ms packets', () => {
  const code = readFileSync(new URL('./audio-capture.worklet.js', import.meta.url), 'utf8');
  for (const sampleRate of [16000,44100,48000]) {
    let Processor; const packets=[];
    vm.runInNewContext(code,{sampleRate,Float32Array,AudioWorkletProcessor:class {port={postMessage(packet){packets.push(packet);}};},registerProcessor(name,value){Processor=value;}});
    const processor=new Processor();
    for(let i=0;i<Math.ceil(sampleRate/128);i++)processor.process([[Float32Array.from({length:128},(_,j)=>.125*Math.sin(2*Math.PI*500*(i*128+j)/sampleRate))]]);
    assert.equal(packets.length,10);assert.ok(packets.every(p=>p.length===1600&&p.every(Number.isFinite)));
    const last=packets.at(-1),rms=Math.sqrt(last.reduce((n,x)=>n+x*x,0)/last.length);assert.ok(rms>.07&&rms<.1);
  }
});
test('cancelling capture stops microphone tracks and discards an in-flight transcript', async () => {
  let stops=0, closes=0, node, finish;
  const requests=[],transcripts=[],errors=[];
  const connectable=()=>({connect(){},disconnect(){}});
  const code=readFileSync(new URL('./local-speech.mjs',import.meta.url),'utf8').replaceAll('export ','');
  class AudioContext {
    audioWorklet={async addModule(path){assert.equal(path,'/audio-capture.worklet.js');}};
    async resume(){} async close(){closes++;}
    createMediaStreamSource(){return connectable();} createGain(){return{...connectable(),gain:{value:1}};}
  }
  const context=vm.createContext({Float32Array,DataView,ArrayBuffer,AbortController,Map,Math,setTimeout,clearTimeout,window:{AudioContext},navigator:{mediaDevices:{async getUserMedia(){return{getTracks:()=>[{stop(){stops++;}}]};}}},AudioWorkletNode:class{port={};constructor(){node=this;}connect(){}disconnect(){}},fetch(url,options){requests.push({url,options});return new Promise(r=>finish=r);}});
  vm.runInContext(code,context);
  const capture=await context.startLocalSpeech({headers:{'X-Local-Token':'fixture'},onTranscript:(...x)=>transcripts.push(x),onError:x=>errors.push(x)});
  for(let i=0;i<9;i++)node.port.onmessage({data:voice()});
  assert.equal(requests.length,1);assert.equal(requests[0].url,'/recognize');
  assert.equal(requests[0].options.headers['Content-Type'],'audio/pcm;rate=16000');
  assert.equal(requests[0].options.body.byteLength,28800);
  capture.cancel();finish({ok:true,json:async()=>({text:'Must not appear'})});
  await new Promise(setImmediate);
  assert.equal(stops,1);assert.equal(closes,1);assert.equal(transcripts.length,0);assert.equal(errors.length,0);
});
test('stopping the worklet flushes the last partial audio packet', () => {
  const code=readFileSync(new URL('./audio-capture.worklet.js',import.meta.url),'utf8');let Processor;const packets=[];
  vm.runInNewContext(code,{sampleRate:16000,Float32Array,AudioWorkletProcessor:class{port={postMessage(value){packets.push(value);}};},registerProcessor(name,value){Processor=value;}});
  const processor=new Processor();processor.process([[new Float32Array(128).fill(.25)]]);
  processor.port.onmessage({data:{type:'flush'}});
  assert.equal(packets[0].length,128);assert.ok(packets[0].every(Number.isFinite));assert.ok(packets[0].some(x=>Math.abs(x)>0));assert.equal(packets[1].type,'flushed');
  processor.process([[new Float32Array(128).fill(.25)]]);assert.equal(packets.length,2);
});
test('background correction updates the same utterance while the next live request continues', async () => {
  let node,stops=0;const requests=[],transcripts=[],errors=[];
  const connectable=()=>({connect(){},disconnect(){}});
  class AudioContext {
    audioWorklet={async addModule(){}};async resume(){}async close(){}
    createMediaStreamSource(){return connectable();}createGain(){return{...connectable(),gain:{value:1}};}
  }
  const context=vm.createContext({Float32Array,DataView,ArrayBuffer,AbortController,Map,Math,setTimeout,clearTimeout,window:{AudioContext},navigator:{mediaDevices:{async getUserMedia(){return{getTracks:()=>[{stop(){stops++;}}]};}}},AudioWorkletNode:class{port={};constructor(){node=this;}connect(){}disconnect(){}},fetch(url,options){return new Promise(resolve=>requests.push({url,options,respond(text,ok=true){resolve({ok,status:ok?200:503,json:async()=>({text})});}}));}});
  vm.runInContext(readFileSync(new URL('./local-speech.mjs',import.meta.url),'utf8').replaceAll('export ',''),context);
  const capture=await context.startLocalSpeech({headers:{},onTranscript:(...args)=>transcripts.push(args),onError:e=>errors.push(e)});
  const tick=()=>new Promise(setImmediate);
  for(let i=0;i<9;i++)node.port.onmessage({data:voice()});
  for(let i=0;i<6;i++)node.port.onmessage({data:silence()});
  requests[0].respond('The might a contrary');await tick();
  assert.equal(requests[1].url,'/recognize');requests[1].respond('The might a contrary produces energy.');await tick();
  const correction=requests.find(r=>r.url==='/refine');assert.ok(correction);
  for(let i=0;i<9;i++)node.port.onmessage({data:voice()});
  const next=requests.at(-1);assert.equal(next.url,'/recognize');next.respond('Please open your books');await tick();
  assert.ok(transcripts.some(t=>t[0]==='2'&&t[1]==='Please open your books'));
  correction.respond('The mitochondria produce energy.');await tick();
  const accurate=transcripts.find(t=>t[3]?.quality==='accurate');assert.equal(accurate[0],'1');assert.equal(accurate[1],'The mitochondria produce energy.');
  // Fail the next correction quietly; it must not stop the live microphone.
  for(let i=0;i<6;i++)node.port.onmessage({data:silence()});requests.at(-1).respond('Please open your books.');await tick();
  const failed=requests.at(-1);assert.equal(failed.url,'/refine');failed.respond('',false);await tick();
  assert.equal(errors.length,0);assert.equal(stops,0);
  for(let i=0;i<9;i++)node.port.onmessage({data:voice()});
  for(let i=0;i<6;i++)node.port.onmessage({data:silence()});
  requests.at(-1).respond('Third draft');await tick();requests.at(-1).respond('Third final');await tick();
  const stale=requests.at(-1);assert.equal(stale.url,'/refine');
  capture.cancel();stale.respond('Must not appear after Clear');await tick();
  assert.ok(!transcripts.some(t=>t[1].includes('Must not appear')));assert.equal(stops,1);
});
