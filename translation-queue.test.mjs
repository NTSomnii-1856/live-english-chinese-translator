import test from 'node:test';
import assert from 'node:assert/strict';
import { createTranslationQueue } from './translation-queue.mjs';

test('separate student requests run concurrently and queued cancellation never starts work', async () => {
  const queue = createTranslationQueue({ concurrency: 2 });
  const started = [];
  let releaseA, releaseB;
  const a = queue.run(() => { started.push('a'); return new Promise(r => releaseA=r); });
  const b = queue.run(() => { started.push('b'); return new Promise(r => releaseB=r); });
  await Promise.resolve();
  assert.deepEqual(started,['a','b']);
  const controller = new AbortController();
  const cancelled = queue.run(() => started.push('cancelled'),controller.signal);
  const rejected = assert.rejects(cancelled,/Cancelled/);
  controller.abort(); await rejected;
  const c = queue.run(() => { started.push('c'); return 'third student'; });
  releaseA('first student'); assert.equal(await a,'first student');
  assert.equal(await c,'third student'); releaseB('second student');
  assert.equal(await b,'second student'); assert.deepEqual(started,['a','b','c']);
});
