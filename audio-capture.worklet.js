// Small causal IIR filters add no packet buffering and run at the microphone's
// native rate, before downsampling can fold high-frequency hiss into speech.
class CaptionBiquad {
  constructor(type, frequency, q) {
    const omega = 2 * Math.PI * frequency / sampleRate;
    const cosine = Math.cos(omega), alpha = Math.sin(omega) / (2 * q);
    const a0 = 1 + alpha;
    if (type === 'highpass') {
      this.b0 = (1 + cosine) / (2 * a0);
      this.b1 = -(1 + cosine) / a0;
      this.b2 = this.b0;
    } else {
      this.b0 = (1 - cosine) / (2 * a0);
      this.b1 = (1 - cosine) / a0;
      this.b2 = this.b0;
    }
    this.a1 = -2 * cosine / a0; this.a2 = (1 - alpha) / a0;
    this.z1 = 0; this.z2 = 0;
  }
  push(input) {
    const output = this.b0 * input + this.z1;
    this.z1 = this.b1 * input - this.a1 * output + this.z2;
    this.z2 = this.b2 * input - this.a2 * output;
    // Avoid subnormal arithmetic after long silence; this is far below audible levels.
    if (Math.abs(this.z1) < 1e-24) this.z1 = 0;
    if (Math.abs(this.z2) < 1e-24) this.z2 = 0;
    return output;
  }
}

class CaptionAudioCapture extends AudioWorkletProcessor {
  constructor() {
    super(); this.position = 0; this.inputCount = 0;
    this.packet = new Float32Array(1600); this.length = 0;
    this.previous = 0;
    this.highpass = new CaptionBiquad('highpass', 80, Math.SQRT1_2);
    const cutoff = Math.min(6500, sampleRate * 0.42);
    this.lowpass1 = new CaptionBiquad('lowpass', cutoff, 0.541196100146197);
    this.lowpass2 = new CaptionBiquad('lowpass', cutoff, 1.306562964876377);
    this.stopped = false;
    this.port.onmessage = event => {
      if (event.data?.type !== 'flush' || this.stopped) return;
      this.stopped = true;
      if (this.length) { const tail = this.packet.slice(0, this.length); this.port.postMessage(tail, [tail.buffer]); this.length = 0; }
      this.port.postMessage({ type: 'flushed' });
    };
  }
  process(inputs) {
    const input = inputs[0]?.[0];
    if (!input || this.stopped) return true;
    // A continuous clock and interpolation keep the sample count stable across
    // 128-frame worklet calls, including 44.1kHz microphones.
    for (let i = 0; i < input.length; i++) {
      const at = this.inputCount + i;
      const value = Number.isFinite(input[i]) ? Math.max(-1, Math.min(1, input[i])) : 0;
      const filtered = this.lowpass2.push(this.lowpass1.push(this.highpass.push(value)));
      while (this.position <= at + 1e-9) {
        const fraction = at ? Math.max(0, Math.min(1, this.position - (at - 1))) : 1;
        const output = this.previous + fraction * (filtered - this.previous);
        this.packet[this.length++] = Math.max(-1, Math.min(1, output));
        this.position += sampleRate / 16000;
        if (this.length === this.packet.length) {
          this.port.postMessage(this.packet, [this.packet.buffer]);
          this.packet = new Float32Array(1600); this.length = 0;
        }
      }
      this.previous = filtered;
    }
    this.inputCount += input.length;
    return true;
  }
}
registerProcessor('caption-audio-capture', CaptionAudioCapture);
