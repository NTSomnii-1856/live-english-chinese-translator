import { fileURLToPath } from 'node:url';
import { pipeline, StoppingCriteria } from '@huggingface/transformers';

const model = 'onnx-community/moonshine-tiny-ONNX';
const revision = 'a6da1241cd305dcd64eab1edbd615f2bb9aabb95';
class Cancelled extends StoppingCriteria {
  constructor(state) { super(); this.state = state; }
  _call(ids) { return ids.map(() => this.state.cancelled); }
}
const send = event => { if (process.connected) process.send(event); };
process.on('disconnect', () => process.exit(0));
try {
  const recognizer = await pipeline('automatic-speech-recognition', model, {
    revision, dtype: 'q8', device: 'cpu',
    cache_dir: fileURLToPath(new URL('./.local/models', import.meta.url)),
    // One thread avoids per-token parallel scheduling overhead on short live snippets.
    session_options: { intraOpNumThreads: Math.min(4, Math.max(1, Number(process.env.SPEECH_CPU_THREADS) || 1)), interOpNumThreads: 1 },
  });
  await recognizer(new Float32Array(16000), { max_new_tokens: 1, num_beams: 1 });
  send({ type: 'ready' });
  let busy = false;
  let current = null;
  process.on('message', async ({ id, audio, type }) => {
    if (type === 'cancel') { if (current?.id === id) current.cancelled = true; return; }
    const state = { id, cancelled: false };
    const emit = event => send({ id, ...event });
    if (busy) return emit({ type: 'error', message: 'Speech recognition is busy. Please retry.' });
    busy = true; current = state;
    try {
      const started = performance.now();
      const result = await recognizer(audio, {
        num_beams: 1, max_new_tokens: Math.min(48, Math.max(8, Math.ceil(audio.length / 16000) * 7)),
        no_repeat_ngram_size: 3, stopping_criteria: [new Cancelled(state)],
      });
      if (state.cancelled) throw Error('Cancelled.');
      emit({ type: 'done', result: { text: result.text.trim(), durationMs: Math.round(audio.length / 16), inferenceMs: Math.round(performance.now() - started) } });
    } catch (error) { emit({ type: 'error', message: error.message }); }
    finally { busy = false; current = null; }
  });
} catch (error) { send({ type: 'startup-error', message: error.message }); }
