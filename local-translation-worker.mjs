import { parentPort } from 'node:worker_threads';
import { fileURLToPath } from 'node:url';
import { pipeline, TextStreamer, StoppingCriteria } from '@huggingface/transformers';

// Pinned ONNX weights; inference happens on this PC, never through a hosted API.
const model = 'Xenova/opus-mt-en-zh';
const revision = '046f55aec303cdee3e0318604406d4df20f1e8ea';
class Cancelled extends StoppingCriteria {
  constructor(flag) { super(); this.flag = flag; }
  _call(ids) { return ids.map(() => Atomics.load(this.flag, 0) !== 0); }
}
try {
  const translator = await pipeline('translation', model, {
    revision, dtype: 'q8', device: 'cpu',
    cache_dir: fileURLToPath(new URL('./.local/models', import.meta.url)),
    session_options: { intraOpNumThreads: 2, interOpNumThreads: 1 },
  });
  await translator('>>cmn_Hans<< Hello.', { num_beams: 1, max_new_tokens: 16 });
  parentPort.postMessage({ type: 'ready' });
  parentPort.on('message', async ({ id, text, cancellation }) => {
    const flag = new Int32Array(cancellation);
    const emit = event => parentPort.postMessage({ id, ...event });
    try {
      if (Atomics.load(flag, 0)) throw Error('Cancelled.');
      // Bound each model input so long browser utterances cannot overflow its context.
      // Split at sentence boundaries followed by whitespace, preserving decimals such as 42.5.
      const chunks = text.split(/(?<=[.!?])\s+|\n+/);
      const pieces = chunks.flatMap(chunk => {
        const words = chunk.trim().split(/\s+/).flatMap(word => word.match(/.{1,300}/gu) || []), parts = [];
        let current = [];
        for (const word of words) {
          if (current.length >= 45 || current.join(' ').length + word.length > 320) { parts.push(current.join(' ')); current = []; }
          current.push(word);
        }
        if (current.length) parts.push(current.join(' '));
        return parts;
      }).filter(Boolean);
      const output = [];
      for (const piece of pieces) {
        if (Atomics.load(flag, 0)) throw Error('Cancelled.');
        const streamer = new TextStreamer(translator.tokenizer, {
          skip_prompt: true, skip_special_tokens: true,
          callback_function: delta => { if (delta && !Atomics.load(flag, 0)) emit({ type: 'delta', delta }); },
        });
        const result = await translator('>>cmn_Hans<< ' + piece, {
          num_beams: 1, max_new_tokens: Math.min(256, Math.max(48, piece.split(/\s+/).length * 5)),
          streamer, stopping_criteria: [new Cancelled(flag)],
        });
        output.push(result[0].translation_text.trim());
      }
      if (Atomics.load(flag, 0)) throw Error('Cancelled.');
      const translated = output.join('');
      if (!translated) throw Error('No translation returned. Please retry.');
      emit({ type: 'done', text: translated });
    } catch (error) { emit({ type: 'error', message: error.message }); }
  });
} catch (error) { parentPort.postMessage({ type: 'startup-error', message: error.message }); }
