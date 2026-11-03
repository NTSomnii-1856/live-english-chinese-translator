import test from 'node:test';
import assert from 'node:assert/strict';
import { createSpeechPreview, sameSpeech } from './speech-preview.mjs';

function setup(){let now=0,id=0;const jobs=new Map(),events=[];const preview=createSpeechPreview({onPreview:(i,t)=>events.push(['draft',i,t]),onFinal:(i,t)=>events.push(['final',i,t]),schedule:(fn,ms)=>{jobs.set(++id,{fn,at:now+ms});return id;},cancel:id=>jobs.delete(id),now:()=>now});return{preview,events,tick(ms){const end=now+ms;while(true){const next=[...jobs].sort((a,b)=>a[1].at-b[1].at).find(([,j])=>j.at<=end);if(!next)break;now=next[1].at;jobs.delete(next[0]);next[1].fn();}now=end;}};}

test('draft translates before recognition is final, then final text corrects the same result',()=>{
  const s=setup();s.preview.update(0,'The train leaves at thirteen');s.tick(179);assert.equal(s.events.length,0);s.tick(1);
  assert.deepEqual(s.events[0],['draft',0,'The train leaves at thirteen']);
  s.preview.update(0,'The train leaves at thirty.',true);s.tick(2000);
  assert.deepEqual(s.events[1],['final',0,'The train leaves at thirty.']);assert.equal(s.events.length,2);
  s.preview.update(0,'The train leaves at thirty.',true);assert.equal(s.events.length,2);
});
test('continuous speech gets a bounded draft without a pause',()=>{
  const s=setup();for(let i=0;i<4;i++){s.preview.update(0,'Please open your books '+('now '.repeat(i+1)).trim());s.tick(120);}
  assert.equal(s.events.length,1);assert.equal(s.events[0][0],'draft');assert.match(s.events[0][2],/now now now now/);
});
test('short finalized speech is immediate; disposal cancels stale drafts',()=>{
  const s=setup();s.preview.update(0,'Hello there',true);assert.deepEqual(s.events,[['final',0,'Hello there']]);
  s.preview.update(1,'A draft that must disappear');s.preview.dispose();s.tick(2000);assert.equal(s.events.length,1);
});
test('punctuation does not retrigger a translation but changed numbers do',()=>{
  assert.ok(sameSpeech('Open your books','Open your books.'));assert.ok(!sameSpeech('The answer is 13','The answer is 30'));
});
test('a long utterance keeps producing coalesced drafts before any final result',()=>{
  const s=setup();s.preview.update(0,'Please open your books');s.tick(180);
  s.preview.update(0,'Please open your books to page');s.tick(300);
  s.preview.update(0,'Please open your books to page twenty and look');s.tick(300);
  assert.equal(s.events.length,3);assert.ok(s.events.every(e=>e[0]==='draft'&&e[1]===0));
  s.preview.update(0,'Please open your books to page twenty and look.',true);
  assert.equal(s.events.at(-1)[0],'final');
});
