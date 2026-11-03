import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

test('pending speech fragments combine without changing the phrase already translating', () => {
  const html=readFileSync(new URL('./index.html',import.meta.url),'utf8');
  const start=html.indexOf('function addPhrase('),end=html.indexOf('function scroll()',start);
  const panes={english:{append(){},replaceChildren(){}},chinese:{append(){},replaceChildren(){}}};
  const context={queue:[],entries:[],session:0,listening:false,document:{createElement:()=>({textContent:'',className:''})},$:id=>panes[id],pump(){},scroll(){},status(){}};
  const add=vm.runInNewContext(html.slice(start,end)+';addPhrase',context);
  add('First spoken phrase.',true);
  const active=context.queue.shift();
  add('Open your',true);add('books to page twenty.',true);
  assert.equal(active.english,'First spoken phrase.');
  assert.equal(context.queue.length,1);
  assert.equal(context.queue[0].english,'Open your books to page twenty.');
  assert.equal(context.queue[0].source.textContent,'Open your books to page twenty.');
  add('Typed text stays separate.',false);assert.equal(context.queue.length,2);
  add('a'.repeat(300),true);add('b'.repeat(30),true);assert.equal(context.queue.length,4);
});
