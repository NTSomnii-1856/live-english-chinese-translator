import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { LocalRecognizer } from './local-recognizer.mjs';
import { LocalTranslator } from './local-translator.mjs';

test('local recognizer rejects malformed input and never hallucinates digital silence', async () => {
  const engine = new LocalRecognizer();
  await assert.rejects(engine.transcribe(new Float32Array(100)), /0.2–6/);
  await assert.rejects(engine.transcribe(new Float32Array(96001)), /0.2–6/);
  await assert.rejects(engine.transcribe(new Float32Array(16000).fill(NaN)), /Invalid/);
  await assert.rejects(engine.transcribe(new Float32Array(16000).fill(2)), /Invalid/);
  assert.equal((await engine.transcribe(new Float32Array(16000))).text, '');
  assert.equal(engine.worker, null);
  const aborted = new AbortController(); aborted.abort();
  await assert.rejects(engine.transcribe(new Float32Array(16000), aborted.signal), /Cancelled/);
});

// Supply an artificial 16-bit, mono, 16kHz WAV; never use a student's recording.
test('local speech model recognizes artificial speech and recovers after cancellation', { skip: !process.env.SPEECH_TEST_WAV, timeout: 180000 }, async () => {
  const wav = await readFile(process.env.SPEECH_TEST_WAV);
  let offset = 12, data;
  while (offset + 8 <= wav.length) {
    const type = wav.toString('ascii', offset, offset + 4), length = wav.readUInt32LE(offset + 4);
    if (type === 'data') { data = wav.subarray(offset + 8, offset + 8 + length); break; }
    offset += 8 + length + length % 2;
  }
  assert.ok(data);
  const samples = Float32Array.from({ length: data.length / 2 }, (_, i) => data.readInt16LE(i * 2) / 32768);
  const engine = new LocalRecognizer(), translation = new LocalTranslator();
  try {
    const [status] = await Promise.all([engine.start(), translation.start()]);
    assert.equal(status.speechEngine, 'local');
    const controller = new AbortController();
    const cancelled = engine.transcribe(samples, controller.signal);
    setTimeout(() => controller.abort(), 10);
    await assert.rejects(cancelled, /Cancelled/);
    const events = [];
    const [output] = await Promise.all([
      engine.transcribe(samples),
      translation.translate('Please open your books.', '', e => events.push(e), new AbortController().signal),
    ]);
    assert.match(output.text, /open your books/i);
    assert.match(output.text, /23|twenty.three/i);
    assert.equal(engine.pending.size, 0);
    assert.match(events.find(e => e.type === 'done').text, /\p{Script=Han}/u);
  } finally { engine.close(); translation.close(); }
});
