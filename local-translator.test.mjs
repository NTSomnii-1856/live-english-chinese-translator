import test from 'node:test';
import assert from 'node:assert/strict';
import { LocalTranslator } from './local-translator.mjs';

test('local model streams Chinese, preserves a correction, and releases cancelled work', { timeout: 180000 }, async () => {
  const engine = new LocalTranslator();
  try {
    assert.equal((await engine.start()).engine, 'local');
    const events = [];
    await engine.translate('The answer is forty-two, not twenty-four.', '', e => events.push(e), new AbortController().signal);
    const output = events.find(e => e.type === 'done')?.text;
    assert.ok(events.some(e => e.type === 'delta' && /\p{Script=Han}/u.test(e.delta)));
    assert.match(output, /42|四十二/); assert.match(output, /24|二十四/); assert.match(output, /不|非/);
    assert.equal(events.filter(e => e.type === 'delta').map(e => e.delta).join('').trim(), output);
    const controller = new AbortController();
    await assert.rejects(engine.translate('Please open your books and read the following paragraph very carefully. '.repeat(12), '', e => {
      if (e.type === 'delta') controller.abort();
      assert.notEqual(e.type, 'done');
    }, controller.signal), /Cancelled/);
    const next = [];
    await engine.translate('I do not agree with that answer.', '', e => next.push(e), new AbortController().signal);
    assert.match(next.find(e => e.type === 'done').text, /不|没|非/);
    assert.equal(engine.pending.size, 0);
  } finally { engine.close(); }
});
