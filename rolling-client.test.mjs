import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { sameSpeech } from './speech-preview.mjs';

const flush=()=>new Promise(setImmediate);
function element(){return{textContent:'',children:[],checked:false,scrollHeight:0,classList:{add(){},remove(){},toggle(){}},append(child){this.children.push(child);},replaceChildren(){this.children=[];}};}
function setup(){
  const html=readFileSync(new URL('./index.html',import.meta.url),'utf8');
  const start=html.indexOf('function addPhrase('),end=html.indexOf('function startListening()',start);
  const ids={english:element(),chinese:element(),studentStatus:element(),speak:element()};
  const requests=[];
  const context={queue:[],entries:[],session:0,listening:true,processing:false,blocked:false,headers:{},requestController:null,AbortController,TextDecoder,sameSpeech,document:{createElement:element},$:id=>ids[id],status(){},message(){},stopListening(){throw Error('Unexpected stop');},fetch:async(url,options)=>{
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
  s.context.reviseSpeech(entry,'Please open your books to page twenty');
  s.requests[0].event({type:'done',text:'请打开书。'});s.requests[0].finish();await flush();
  assert.equal(entry.output.textContent,'请打开书。');assert.equal(s.requests[1].text,'Please open your books to page twenty');
  s.requests[1].event({type:'done',text:'请把书翻到第二十页。'});s.requests[1].finish();await flush();
  s.context.finalizeSpeech(entry,'Please open your books to page twenty.');
  assert.equal(s.requests.length,2);assert.equal(s.context.entries.length,1);assert.equal(entry.output.textContent,'请把书翻到第二十页。');
});
