import test from 'node:test';
import assert from 'node:assert/strict';
import { createVoiceGate, createAudioUtterances } from './local-speech.mjs';
import { LocalRecognizer } from './local-recognizer.mjs';
import { AccurateRecognizer } from './accurate-recognizer.mjs';

let seed=123456;
function white(rms){return Float32Array.from({length:1600},()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return(seed/4294967296*2-1)*Math.sqrt(3)*rms;});}
function speech(rms,frame=0,frequency=200){return Float32Array.from({length:1600},(_,i)=>Math.SQRT2*rms*Math.sin(2*Math.PI*frequency*(frame*1600+i)/16000));}
const silence=()=>new Float32Array(1600);
test('steady white noise alone never starts caption requests, even above the old fixed threshold',()=>{
  for(const level of [.006,.015,.04]){
    const requests=[],capture=createAudioUtterances({onAudio:x=>requests.push(x)});
    for(let i=0;i<100;i++)capture.push(white(level));capture.flush();
    assert.equal(requests.length,0,`noise RMS ${level}`);
  }
});
test('speech above a learned noise floor still produces early captions with its onset intact',()=>{
  const requests=[],capture=createAudioUtterances({onAudio:x=>requests.push(x)});
  for(let i=0;i<20;i++)capture.push(white(.004));
  const voiced=[];
  for(let i=0;i<9;i++){const tone=speech(.025,i),noise=white(.004);const frame=Float32Array.from(tone,(v,j)=>v+noise[j]);voiced.push(frame);capture.push(frame);}
  assert.ok(requests.length>0);assert.equal(requests[0].final,false);
  const samples=requests[0].samples;
  assert.ok(voiced[0].every((v,i)=>samples[3200+i]===v),'300ms pre-roll retains the first voice frame');
});
test('dominant speech suppresses quieter interjections and follows a new loudest speaker after a pause',()=>{
  const gate=createVoiceGate();
  for(let i=0;i<10;i++)assert.equal(gate.update(speech(.06,i),i>0),true);
  for(let i=0;i<6;i++)assert.equal(gate.update(speech(.01,i,320),false),false);
  assert.equal(gate.update(speech(.09,0,260)),true,'a louder new voice is accepted');
  assert.equal(gate.update(speech(.025,1,260),true),true,'hysteresis preserves a softer speech ending');
  for(let i=0;i<60;i++)gate.update(silence(),false);
  assert.ok(gate.update(speech(.01,0,320))||gate.update(speech(.01,1,320)),'the remaining quieter voice can become dominant');
});
test('quiet speech is retained and padded quiet words are not mistaken for digital silence',async()=>{
  const requests=[],capture=createAudioUtterances({onAudio:x=>requests.push(x)});
  for(let i=0;i<4;i++)capture.push(speech(.004,i));
  for(let i=0;i<6;i++)capture.push(silence());
  assert.ok(requests.some(x=>x.final));
  const padded=new Float32Array(16000);padded.set(speech(.004),0);
  for(const engine of [new LocalRecognizer(),new AccurateRecognizer()]){
    engine.start=async()=>{throw Error('Quiet audio reached model');};
    await assert.rejects(engine.transcribe(padded),/Quiet audio reached model/);
  }
});
test('a quieter new foreground speaker can take over after a normal pause without losing the onset',()=>{
  const gate=createVoiceGate();
  for(let i=0;i<10;i++)gate.update(speech(.06,i),true);
  for(let i=0;i<6;i++)gate.update(silence(),false);
  assert.ok([0,1,2].some(i=>gate.update(speech(.01,i,260),false)));
});
