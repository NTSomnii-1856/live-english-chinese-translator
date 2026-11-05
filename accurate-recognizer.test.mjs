import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { AccurateRecognizer } from './accurate-recognizer.mjs';
import { LocalRecognizer } from './local-recognizer.mjs';

test('background recognizer validates memory-only PCM and suppresses silence without loading a model', async () => {
  const engine = new AccurateRecognizer();
  await assert.rejects(engine.transcribe(new Float32Array(100)), /0.2–6/);
  await assert.rejects(engine.transcribe(new Float32Array(96001)), /0.2–6/);
  await assert.rejects(engine.transcribe(new Float32Array(16000).fill(Infinity)), /Invalid/);
  await assert.rejects(engine.transcribe(new Float32Array(16000).fill(2)), /Invalid/);
  assert.equal((await engine.transcribe(new Float32Array(16000))).text, '');
  assert.equal(engine.worker, null);
  const aborted = new AbortController(); aborted.abort();
  await assert.rejects(engine.transcribe(new Float32Array(16000), aborted.signal), /Cancelled/);
});

// Optional artificial fixture: "Please open your books to page twenty three."
// No real microphone or student's audio is used by this integration test.
test('background correction uses an isolated process, cancels, and coexists with live recognition', { skip: !process.env.SPEECH_TEST_WAV, timeout: 180000 }, async () => {
  const wav = await readFile(process.env.SPEECH_TEST_WAV);
  let offset = 12, data;
  while (offset + 8 <= wav.length) {
    const type = wav.toString('ascii', offset, offset + 4), length = wav.readUInt32LE(offset + 4);
    if (type === 'data') { data = wav.subarray(offset + 8, offset + 8 + length); break; }
    offset += 8 + length + length % 2;
  }
  assert.ok(data);
  const samples = Float32Array.from({ length: data.length / 2 }, (_, i) => data.readInt16LE(i * 2) / 32768);
  const engine = new AccurateRecognizer(), live = new LocalRecognizer();
  try {
    const [status] = await Promise.all([engine.start(), live.start()]);
    assert.equal(status.model, 'Xenova/whisper-base.en');
    assert.notEqual(engine.worker.pid, live.worker.pid);
    const controller = new AbortController();
    const cancelled = engine.transcribe(samples, controller.signal);
    setTimeout(() => controller.abort(), 10);
    await assert.rejects(cancelled, /Cancelled/);
    const [corrected, draft] = await Promise.all([engine.transcribe(samples), live.transcribe(samples)]);
    assert.match(corrected.text, /open your books/i);
    assert.match(corrected.text, /23|twenty.three/i);
    assert.match(draft.text, /open your books/i);
    assert.equal(engine.pending.size, 0);
  } finally { engine.close(); live.close(); }
});
