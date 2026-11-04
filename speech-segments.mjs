// Keep recognition previews small: an unchanged prefix never needs another translation.
export function createSpeechSegments({ onSegment, onRemove = () => {}, maxWords = 8, minWords = 3 }) {
  if (typeof onSegment !== 'function') throw new TypeError('onSegment must be a function.');
  if (!Number.isInteger(maxWords) || maxWords < 1) throw new RangeError('maxWords must be a positive integer.');
  const results = new Map();
  function split(text, final) {
    const words = text.trim().split(/\s+/).filter(Boolean);
    const parts = [];
    let current = [];
    for (const word of words) {
      current.push(word);
      // A decimal within a word is not a sentence boundary.
      if (current.length === maxWords || /[.!?]["'’”\])}]*$/u.test(word)) {
        parts.push(current); current = [];
      }
    }
    if (current.length) parts.push(current);
    // Wait for a little context in the newest fragment, without hiding short final speech.
    if (!final && parts.at(-1)?.length < Math.min(minWords, maxWords)) parts.pop();
    return parts.map(part => part.join(' '));
  }
  return {
    update(resultId, text, final = false) {
      const id = String(resultId), previous = results.get(id) || [];
      const parts = split(String(text ?? ''), final);
      const next = parts.map((value, ordinal) => ({ key: `${id}:${ordinal}`, text: value, final: Boolean(final) }));
      results.set(id, next);
      for (let i = next.length; i < previous.length; i++) onRemove(previous[i].key);
      next.forEach((part, ordinal) => {
        const old = previous[ordinal];
        if (!old || old.text !== part.text || old.final !== part.final) onSegment(part.key, part.text, part.final);
      });
    },
    clear() {
      const old = [...results.values()].flat();
      results.clear();
      for (const part of old) onRemove(part.key);
    },
  };
}
