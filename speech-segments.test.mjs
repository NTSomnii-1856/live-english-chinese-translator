import test from 'node:test';
import assert from 'node:assert/strict';
import { createSpeechSegments } from './speech-segments.mjs';

function setup(options = {}) {
  const rows = new Map(), events = [], removed = [];
  const segments = createSpeechSegments({
    ...options,
    onSegment(key, text, final) { rows.set(key, { text, final }); events.push({ key, text, final }); },
    onRemove(key) { rows.delete(key); removed.push(key); },
  });
  return { segments, rows, events, removed };
}

test('80 words of growing interim speech stay bounded and leave stable prefixes untouched', () => {
  const s = setup(), words = Array.from({ length: 80 }, (_, i) => `word${i + 1}`);
  for (let count = 1; count <= words.length; count++) {
    s.segments.update('browser-result', words.slice(0, count).join(' '));
    assert.ok(s.events.every(e => e.text.split(' ').length <= 8));
  }
  assert.equal(s.rows.size, 10);
  assert.equal(s.events.length, 60); // Six tail previews per row (lengths 3 through 8).
  assert.equal(s.events.filter(e => e.key === 'browser-result:0' && e.text.split(' ').length === 8).length, 1);
  const before = s.events.length;
  s.segments.update('browser-result', words.join(' '));
  s.segments.update('browser-result', words.join(' ') + ' one');
  assert.equal(s.events.length, before); // An unchanged prefix and a one-word tail add no work.
  s.segments.update('browser-result', words.join(' '), true);
  assert.equal(s.events.length, before + 10);
  assert.ok([...s.rows.values()].every(row => row.final));
  assert.equal([...s.rows.values()].map(row => row.text).join(' '), words.join(' '));
});

test('final insertion and deletion revise stable IDs and remove obsolete rows', () => {
  const s = setup();
  s.segments.update('r', 'Please open your books to page twenty and read every question carefully before writing down your answer to each question');
  assert.equal(s.rows.size, 3);
  s.segments.update('r', 'Please do not open your books to page twenty.', true);
  assert.equal(s.rows.size, 2);
  assert.deepEqual(s.removed, ['r:2']);
  assert.equal([...s.rows.values()].map(row => row.text).join(' '), 'Please do not open your books to page twenty.');
  assert.deepEqual([...s.rows.keys()], ['r:0', 'r:1']);
  s.segments.update('r', 'Wait.', true);
  assert.deepEqual([...s.rows.entries()], [['r:0', { text: 'Wait.', final: true }]]);
  assert.deepEqual(s.removed, ['r:2', 'r:1']);
});

test('sentence boundaries preserve decimals, numbers and negation with exact final word reconstruction', () => {
  const s = setup();
  const source = 'The answer is 42.5. Do not write 24.5 instead! Is that clear?';
  s.segments.update('audio-7', source, true);
  assert.deepEqual([...s.rows.values()].map(row => row.text), [
    'The answer is 42.5.', 'Do not write 24.5 instead!', 'Is that clear?',
  ]);
  assert.equal([...s.rows.values()].map(row => row.text).join(' '), source);
});

test('short final speech is retained, independent results are isolated and clear removes all rows', () => {
  const s = setup();
  s.segments.update('first', 'No.');
  assert.equal(s.rows.size, 0);
  s.segments.update('first', 'No.', true);
  s.segments.update('second', 'Thank you', true);
  assert.equal(s.rows.get('first:0').text, 'No.');
  assert.equal(s.rows.get('second:0').text, 'Thank you');
  s.segments.update('first', '', true);
  assert.deepEqual([...s.rows.keys()], ['second:0']);
  s.segments.clear();
  assert.equal(s.rows.size, 0);
  s.segments.update('first', 'No.', true);
  assert.equal(s.rows.size, 1);
});
test('local audio previews can show even the first recognized word immediately', () => {
  const s=setup({minWords:1});s.segments.update('live','Please');
  assert.equal(s.rows.get('live:0').text,'Please');
  s.segments.update('live','Please open your books.',true);
  assert.equal(s.rows.size,1);assert.equal(s.rows.get('live:0').text,'Please open your books.');
});
