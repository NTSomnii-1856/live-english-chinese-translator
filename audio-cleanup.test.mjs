import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const code = readFileSync(new URL('./audio-capture.worklet.js', import.meta.url), 'utf8');
function setup(sampleRate) {
  let Processor; const packets = [];
  vm.runInNewContext(code, { sampleRate, Float32Array, AudioWorkletProcessor: class { port = { postMessage(value) { packets.push(value); } }; }, registerProcessor(name, value) { assert.equal(name, 'caption-audio-capture'); Processor = value; } });
  const processor = new Processor();
  return {
    processor, packets,
    push(samples) { for (let i = 0; i < samples.length; i += 128) processor.process([[samples.subarray(i, i + 128)]]); },
    finish() {
      processor.port.onmessage({ data: { type: 'flush' } });
      return Float32Array.from(packets.filter(p => p instanceof Float32Array).flatMap(p => [...p]));
    },
  };
}
const rms = audio => Math.sqrt(audio.reduce((sum, value) => sum + value * value, 0) / audio.length);
function toneGain(sampleRate, frequency) {
  const capture = setup(sampleRate);
  capture.push(Float32Array.from({ length: sampleRate }, (_, i) => .2 * Math.sin(2 * Math.PI * frequency * i / sampleRate)));
  const output = capture.finish().slice(3200);
  assert.ok(output.every(Number.isFinite));
  return rms(output) / (.2 / Math.SQRT2);
}
test('cleanup attenuates rumble and high-frequency hiss while preserving the speech band', () => {
  for (const rate of [16000, 44100, 48000]) {
    assert.ok(toneGain(rate, 50) < .38, `${rate}Hz rumble attenuation`);
    for (const frequency of [500, 2000, 4000]) {
      const gain = toneGain(rate, frequency);
      assert.ok(gain > .93 && gain < 1.01, `${rate}Hz ${frequency}Hz gain ${gain}`);
    }
    const hissFrequency = rate === 16000 ? 7500 : 9000;
    assert.ok(toneGain(rate, hissFrequency) < .32, `${rate}Hz hiss attenuation`);
  }
});
test('filtered resampling keeps exact packets and is continuous across render blocks', () => {
  for (const rate of [16000, 44100, 48000]) {
    const capture = setup(rate);
    const input = Float32Array.from({ length: rate }, (_, i) => .25 * Math.sin(2 * Math.PI * 500 * i / rate));
    capture.push(input);
    const output = capture.finish();
    assert.equal(output.length, 16000);
    assert.equal(capture.packets.filter(p => p instanceof Float32Array).length, 10);
    assert.ok(capture.packets.filter(p => p instanceof Float32Array).every(p => p.length === 1600));
    assert.ok(output.every(x => Number.isFinite(x) && Math.abs(x) <= 1));
    let step = 0; for (let i = 1; i < output.length; i++) step = Math.max(step, Math.abs(output[i] - output[i - 1]));
    assert.ok(step < .065, `${rate}Hz no discontinuity at block or packet boundaries`);
  }
});
test('flush preserves the filtered tail and ignores repeated flushes or stopped input', () => {
  for (const rate of [16000, 44100, 48000]) {
    const capture = setup(rate);
    capture.push(Float32Array.from({ length: 128 }, (_, i) => .25 * Math.sin(2 * Math.PI * 500 * i / rate)));
    const output = capture.finish();
    assert.equal(output.length, Math.floor(127 / (rate / 16000)) + 1);
    assert.ok(output.every(Number.isFinite));
    assert.equal(capture.packets.at(-1).type, 'flushed');
    const count = capture.packets.length;
    capture.processor.port.onmessage({ data: { type: 'flush' } });
    capture.push(new Float32Array(128));
    assert.equal(capture.packets.length, count);
  }
});
test('invalid samples cannot poison filter state or cause clipping', () => {
  for (const rate of [16000, 44100, 48000]) {
    const capture = setup(rate);
    const samples = Float32Array.from({ length: rate }, (_, i) => .35 * Math.sin(2 * Math.PI * 2000 * i / rate));
    samples[32] = NaN; samples[60] = Infinity; samples[80] = -Infinity;
    capture.push(samples);
    const output = capture.finish();
    assert.ok(output.every(x => Number.isFinite(x) && Math.abs(x) <= 1));
    assert.ok(rms(output.slice(3200)) > .2);
  }
});
