class CaptionAudioCapture extends AudioWorkletProcessor {
  constructor() {
    super(); this.position = 0; this.inputCount = 0;
    this.packet = new Float32Array(1600); this.length = 0;
    this.stopped = false;
    this.port.onmessage = event => {
      if (event.data?.type !== 'flush') return;
      this.stopped = true;
      if (this.length) { const tail = this.packet.slice(0, this.length); this.port.postMessage(tail, [tail.buffer]); this.length = 0; }
      this.port.postMessage({ type: 'flushed' });
    };
  }
  process(inputs) {
    const input = inputs[0]?.[0];
    if (!input || this.stopped) return true;
    // A continuous sample clock resamples the device's native rate to 16 kHz.
    const end = this.inputCount + input.length;
    while (this.position < end) {
      const at = Math.max(0, Math.floor(this.position - this.inputCount));
      this.packet[this.length++] = input[at];
      this.position += sampleRate / 16000;
      if (this.length === this.packet.length) {
        this.port.postMessage(this.packet, [this.packet.buffer]);
        this.packet = new Float32Array(1600); this.length = 0;
      }
    }
    this.inputCount = end;
    return true;
  }
}
registerProcessor('caption-audio-capture', CaptionAudioCapture);
