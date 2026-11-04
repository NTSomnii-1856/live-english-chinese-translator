import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { sameSpeech } from './speech-preview.mjs';
import { sanitizeCaption } from './caption-filter.mjs';

const flush=()=>new Promise(setImmediate);
function element(){return{textContent:'',children:[],checked:false,scrollHeight:0,classList:{add(){},remove(){},toggle(){}},append(child){this.children.push(child);},replaceChildren(){this.children=[];}};}
function setup(){
  const html=readFileSync(new URL('./index.html',import.meta.url),'utf8');
  const start=html.indexOf('function addPhrase('),end=html.indexOf('function removeSpeech(',start);
  const ids={english:element(),chinese:element(),studentStatus:element(),speak:element()};
  const requests=[];
  const context={queue:[],entries:[],session:0,listening:true,processing:false,blocked:false,headers:{},requestController:null,AbortController,TextDecoder,sameSpeech,sanitizeCaption,document:{createElement:element},$:id=>ids[id],status(){},message(){},stopListening(){throw Error('Unexpected stop');},fetch:async(url,options)=>{
    const parts=[],waiters=[];
    const reader={read:()=>parts.length?Promise.resolve(parts.shift()):new Promise(r=>waiters.push(r))};
    const deliver=part=>waiters.length?waiters.shift()(part):parts.push(part);
    requests.push({text:JSON.parse(options.body).text,event:value=>deliver({value:new TextEncoder().encode(JSON.stringify(value)+'\n'),done:false}),finish:()=>deliver({done:true})});
    return{ok:true,body:{getReader:()=>reader}};
  }};
  vm.runInNewContext(html.slice(start,end),context);
  return{context,requests,ids};
}
test('a revised draft is corrected in place while the next phrase moves ahead',async()=>{
  const s=setup(),c=s.context;
  const previous=c.addPhrase('The train leaves at thirteen.');previous.provisional=true;await flush();
  c.finalizeSpeech(previous,'The train leaves at thirty.');c.addPhrase('Please open your books.',true);
  s.requests[0].event({type:'delta',delta:'STALE WRONG NUMBER'});s.requests[0].event({type:'done',text:'STALE WRONG NUMBER'});s.requests[0].finish();await flush();
  assert.equal(s.requests[1].text,'Please open your books.');assert.ok(!previous.output.textContent.includes('STALE'));
  s.requests[1].event({type:'done',text:'请打开书。'});s.requests[1].finish();await flush();
  assert.equal(s.requests[2].text,'The train leaves at thirty.');
  s.requests[2].event({type:'done',text:'火车三十分出发。'});s.requests[2].finish();await flush();
  assert.equal(c.entries.length,2);assert.equal(previous.source.textContent,'The train leaves at thirty.');assert.equal(previous.output.textContent,'火车三十分出发。');assert.equal(c.processing,false);
});
test('unchanged final words reuse the draft translation without a duplicate request',async()=>{
  const s=setup(),entry=s.context.addPhrase('Open your books');entry.provisional=true;await flush();
  s.context.finalizeSpeech(entry,'Open your books.');s.requests[0].event({type:'done',text:'请打开书。'});s.requests[0].finish();await flush();
  assert.equal(s.requests.length,1);assert.equal(s.context.entries.length,1);assert.equal(entry.output.textContent,'请打开书。');
});
test('long speech shows successive drafts while newer words are still being recognized',async()=>{
  const s=setup(),entry=s.context.addPhrase('Please open your books');entry.provisional=true;await flush();
  s.requests[0].event({type:'done',text:'请打开书。'});s.requests[0].finish();await flush();
  s.context.reviseSpeech(entry,'Please open your books to page twenty');await flush();
  assert.equal(entry.output.textContent,'请打开书。');assert.equal(s.requests[1].text,'Please open your books to page twenty');
  s.requests[1].event({type:'delta',delta:'请'});await flush();assert.equal(entry.output.textContent,'请打开书。');
  s.requests[1].event({type:'done',text:'请把书翻到第二十页。'});s.requests[1].finish();await flush();
  s.context.finalizeSpeech(entry,'Please open your books to page twenty.');
  assert.equal(s.requests.length,2);assert.equal(s.context.entries.length,1);assert.equal(entry.output.textContent,'请把书翻到第二十页。');
});
test('English display and request text are filtered before any caption is shown',async()=>{
  const s=setup(),entry=s.context.addPhrase('What the fuck is that?');await flush();
  assert.equal(entry.source.textContent,'What the *** is that?');
  assert.equal(s.requests[0].text,'What the *** is that?');
  s.requests[0].event({type:'done',text:'那是什么狗屎？'});s.requests[0].finish();await flush();
  assert.equal(entry.translation,'那是什么***？');assert.equal(entry.output.textContent,entry.translation);
});
test('quick Stop then Start isolates callbacks from the old microphone capture',async()=>{
  const html=readFileSync(new URL('./index.html',import.meta.url),'utf8'),start=html.indexOf('function removeSpeech('),end=html.indexOf('function speak(text)',start);
  const captures=[],updates=[],ids={start:{},interim:{},speak:{checked:false}};
  const c={connected:true,microphoneSupported:true,blocked:false,listening:false,session:0,speechGeneration:0,speechCapture:null,headers:{},pendingSpeech:[],sanitizeCaption,$:id=>ids[id],status(){},message(){},window:{speechSynthesis:{cancel(){}}},createSpeechSegments:()=>({update(...args){updates.push(args);}}),async startLocalSpeech(options){const capture={options,cancelled:false,stop(){},cancel(){this.cancelled=true;}};captures.push(capture);return capture;}};
  vm.runInNewContext(html.slice(start,end),c);
  await c.startListening();c.stopListening();await c.startListening();
  assert.equal(captures[0].cancelled,true);assert.equal(c.listening,true);
  captures[0].options.onError(Error('Old request cancelled'));captures[0].options.onTranscript('1','Old text',true);
  assert.equal(c.listening,true);assert.equal(updates.length,0);
  captures[1].options.onTranscript('1','New speech',false);assert.equal(updates.length,1);assert.equal(updates[0][1],'New speech');
});
