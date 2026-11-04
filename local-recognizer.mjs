import { fork } from 'node:child_process';
import { fileURLToPath } from 'node:url';

export class LocalRecognizer {
  worker = null;
  ready = null;
  pending = new Map();
  nextId = 1;
  concurrency = 1;
  start() {
    if (this.ready) return this.ready;
    this.ready = new Promise((resolve, reject) => {
      // ONNX Runtime's native addon is isolated from the translation worker's V8 runtime.
      const worker = this.worker = fork(fileURLToPath(new URL('./speech-worker.mjs', import.meta.url)), [], {
        execPath: process.execPath, execArgv: [], windowsHide: true,
        stdio: ['ignore', 'ignore', 'pipe', 'ipc'], serialization: 'advanced',
      });
      worker.stderr.on('data', () => {});
      const timer = setTimeout(() => fail(new Error('Local speech model startup timed out. Retry after checking the PC connection.')), 180000);
      const fail = error => {
        clearTimeout(timer); this.ready = null;
        if (this.worker === worker) this.worker = null;
        worker.kill(); reject(error);
        for (const pending of this.pending.values()) pending.reject(error);
        this.pending.clear();
      };
      worker.on('error', fail);
      worker.on('exit', code => { if (this.worker === worker) fail(new Error(`Local speech worker stopped (${code}).`)); });
      worker.on('message', event => {
        if (event.type === 'ready') { clearTimeout(timer); resolve({ connected: true, speechEngine: 'local', sampleRate: 16000, maxSeconds: 6 }); return; }
        if (event.type === 'startup-error') { fail(new Error(event.message)); return; }
        const pending = this.pending.get(event.id);
        if (!pending) return;
        if (event.type === 'error') pending.reject(new Error(event.message));
        else if (event.type === 'done') {
          if (pending.signal.aborted) pending.reject(new Error('Cancelled.'));
          else pending.resolve(event.result);
        }
      });
    });
    return this.ready;
  }
  async transcribe(audio, signal = new AbortController().signal) {
    if (!(audio instanceof Float32Array) || audio.length < 3200 || audio.length > 96000) throw Error('Expected 0.2–6 seconds of 16 kHz mono PCM audio.');
    let sum = 0;
    for (const sample of audio) {
      if (!Number.isFinite(sample) || Math.abs(sample) > 1.01) throw Error('Invalid audio samples.');
      sum += sample * sample;
    }
    if (signal.aborted) throw Error('Cancelled.');
    // Do not ask a generative recognizer to invent text for digital silence.
    if (Math.sqrt(sum / audio.length) < 0.002) return { text: '', durationMs: Math.round(audio.length / 16), inferenceMs: 0 };
    await this.start();
    if (signal.aborted) throw Error('Cancelled.');
    const id = this.nextId++;
    return await new Promise((resolve, reject) => {
      const child = this.worker;
      const abort = () => { if (child.connected) child.send({ type: 'cancel', id }); };
      const timer = setTimeout(abort, 30000);
      const finish = action => value => {
        clearTimeout(timer); signal.removeEventListener('abort', abort); this.pending.delete(id); action(value);
      };
      this.pending.set(id, { signal, resolve: finish(resolve), reject: finish(reject) });
      signal.addEventListener('abort', abort, { once: true });
      // Advanced IPC serialization keeps typed samples without detaching the microphone buffer.
      child.send({ id, audio }, error => { if (error) this.pending.get(id)?.reject(error); });
    });
  }
  close() {
    const error = new Error('Local speech recognition stopped.');
    for (const pending of this.pending.values()) pending.reject(error);
    this.pending.clear(); this.worker?.kill(); this.worker = null; this.ready = null;
  }
}
