import { Worker } from 'node:worker_threads';

export class LocalTranslator {
  worker = null;
  ready = null;
  pending = new Map();
  nextId = 1;
  // ONNX sessions are shared: one fast inference at a time, queued fairly by the server.
  concurrency = 1;
  start() {
    if (this.ready) return this.ready;
    this.ready = new Promise((resolve, reject) => {
      const worker = this.worker = new Worker(new URL('./local-translation-worker.mjs', import.meta.url));
      const timer = setTimeout(() => fail(new Error('Local model startup timed out. Check the PC connection and retry.')), 180000);
      const fail = error => {
        clearTimeout(timer); this.ready = null;
        if (this.worker === worker) this.worker = null;
        worker.terminate(); reject(error);
        for (const pending of this.pending.values()) pending.reject(error);
        this.pending.clear();
      };
      worker.on('error', fail);
      worker.on('exit', code => { if (this.worker === worker) fail(new Error(`Local translation worker stopped (${code}).`)); });
      worker.on('message', event => {
        if (event.type === 'ready') { clearTimeout(timer); resolve({ connected: true, auth: 'Local PC', engine: 'local' }); return; }
        if (event.type === 'startup-error') { fail(new Error(event.message)); return; }
        const pending = this.pending.get(event.id);
        if (!pending) return;
        if (event.type === 'error') pending.reject(new Error(event.message));
        else {
          if (!pending.signal.aborted) pending.emit(event);
          if (event.type === 'done') pending.resolve();
        }
      });
    });
    return this.ready;
  }
  async translate(text, context, emit, signal) {
    await this.start();
    if (signal.aborted) throw Error('Cancelled.');
    const id = this.nextId++, flag = new Int32Array(new SharedArrayBuffer(4));
    await new Promise((resolve, reject) => {
      const abort = () => Atomics.store(flag, 0, 1);
      const timer = setTimeout(abort, 30000);
      const finish = action => value => {
        clearTimeout(timer); signal.removeEventListener('abort', abort); this.pending.delete(id); action(value);
      };
      this.pending.set(id, { emit, signal, resolve: finish(resolve), reject: finish(reject) });
      signal.addEventListener('abort', abort, { once: true });
      this.worker.postMessage({ id, text, cancellation: flag.buffer });
    });
  }
  close() { this.worker?.terminate(); this.worker = null; }
}
