export function createTranslationQueue({ concurrency = 3, maxQueued = 60, timeoutMs = 90000 } = {}) {
  let active = 0;
  const waiting = [];
  function drain() {
    while (active < concurrency && waiting.length) {
      const job = waiting.shift();
      clearTimeout(job.timer); job.signal?.removeEventListener('abort', job.abort);
      if (job.signal?.aborted) { job.reject(new Error('Cancelled.')); continue; }
      active++;
      Promise.resolve().then(job.task).then(job.resolve, job.reject).finally(() => { active--; drain(); });
    }
  }
  return {
    run(task, signal, queued = () => {}) {
      return new Promise((resolve, reject) => {
        if (signal?.aborted) return reject(new Error('Cancelled.'));
        if (active >= concurrency && waiting.length >= maxQueued) return reject(new Error('The translator is busy. Please retry shortly.'));
        const job = { task, signal, resolve, reject };
        job.abort = () => { const i = waiting.indexOf(job); if (i !== -1) waiting.splice(i, 1); clearTimeout(job.timer); reject(new Error('Cancelled.')); };
        job.timer = setTimeout(() => { job.abort(); }, timeoutMs);
        signal?.addEventListener('abort', job.abort, { once: true });
        waiting.push(job);
        if (active >= concurrency) queued(waiting.length);
        drain();
      });
    },
  };
}
