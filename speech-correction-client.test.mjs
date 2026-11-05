import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { sameSpeech } from './speech-preview.mjs';
import { createSpeechSegments } from './speech-segments.mjs';
import { sanitizeCaption } from './caption-filter.mjs';

const flush = () => new Promise(setImmediate);
function element() {
  const classes = new Set();
  return {
    children: [], parentNode: null, className: '', _text: '', checked: false, scrollHeight: 0,
    classList: { add(value) { classes.add(value); }, remove(value) { classes.delete(value); }, toggle(value, force) {
      const active = force === undefined ? !classes.has(value) : force;
      if (active) classes.add(value); else classes.delete(value);
      return active;
    } },
    get textContent() { return this._text + this.children.map(child => child.textContent).join(''); },
    set textContent(text) { this.replaceChildren(); this._text = String(text); },
    append(child) { child.remove(); this.children.push(child); child.parentNode = this; },
    remove() {
      if (!this.parentNode) return;
      const siblings = this.parentNode.children, index = siblings.indexOf(this);
      if (index !== -1) siblings.splice(index, 1);
      this.parentNode = null;
    },
    replaceChildren(...children) {
      for (const child of [...this.children]) child.remove();
      this._text = '';
      for (const child of children) this.append(child);
    },
  };
}
function setup({ pauseTranslations = false } = {}) {
  const html = readFileSync(new URL('./index.html', import.meta.url), 'utf8');
  const start = html.indexOf('function addPhrase('), end = html.indexOf('function speak(text)', start);
  const ids = Object.fromEntries(['english', 'chinese', 'studentStatus', 'speak', 'start', 'interim'].map(id => [id, element()]));
  const captures = [], requests = [], messages = [];
  const context = {
    connected: true, microphoneSupported: true, blocked: false, listening: false, processing: pauseTranslations,
    queue: [], entries: [], pendingSpeech: [], session: 0, speechGeneration: 0, nextEntryOrder: 0,
    speechCapture: null, requestController: null, headers: {},
    AbortController, TextDecoder, sameSpeech, createSpeechSegments, sanitizeCaption,
    document: { createElement: element }, $: id => ids[id], status() {},
    message(text, error) { messages.push({ text, error }); },
    window: { speechSynthesis: { cancel() {} } },
    async startLocalSpeech(options) {
      const capture = { options, cancelled: false, stopped: false, cancel() { this.cancelled = true; }, stop() { this.stopped = true; } };
      captures.push(capture); return capture;
    },
    async fetch(url, options) {
      assert.equal(url, '/translate');
      const parts = [], waiters = [];
      const deliver = part => waiters.length ? waiters.shift()(part) : parts.push(part);
      const request = {
        ...JSON.parse(options.body),
        event(value) { deliver({ value: new TextEncoder().encode(JSON.stringify(value) + '\n'), done: false }); },
        finish() { deliver({ done: true }); },
        done(text) { this.event({ type: 'done', text }); this.finish(); },
      };
      requests.push(request);
      return { ok: true, body: { getReader: () => ({ read: () => parts.length ? Promise.resolve(parts.shift()) : new Promise(resolve => waiters.push(resolve)) }) } };
    },
  };
  vm.runInNewContext(html.slice(start, end), context);
  return {
    context, ids, captures, requests, messages,
    transcript(id, text, final = false) { captures.at(-1).options.onTranscript(id, text, final); },
  };
}
function assertPairedOrder(s) {
  const english = s.ids.english.children.flatMap(group => group.children);
  const chinese = s.ids.chinese.children.flatMap(group => group.children);
  const entries = Array.from(s.context.entries);
  assert.deepEqual(english, entries.map(entry => entry.source));
  assert.deepEqual(chinese, entries.map(entry => entry.output));
  assert.equal(new Set(english).size, entries.length);
  assert.equal(new Set(chinese).size, entries.length);
}

test('an old utterance grows and shrinks in place before newer captions in both panels', async () => {
  const s = setup({ pauseTranslations: true });
  await s.context.startListening();
  s.transcript('first', 'The train leaves at thirteen minutes after noon', true);
  const original = s.context.entries[0];
  s.transcript('second', 'Please open your books now.', true);
  const later = s.context.entries[1];
  s.transcript('first', 'The train leaves at thirty minutes after noon and not at thirteen minutes in the morning.', true);
  assert.equal(s.context.entries.length, 3);
  assert.equal(s.context.entries[0], original);
  assert.equal(s.context.entries[2], later);
  assert.equal(s.ids.english.children.length, 2);
  assertPairedOrder(s);
  s.transcript('first', 'The train leaves at thirty.', true);
  assert.equal(s.context.entries.length, 2);
  assert.equal(s.context.entries[0], original);
  assert.equal(s.context.entries[1], later);
  assert.equal(original.source.textContent, 'The train leaves at thirty.');
  assert.equal(later.source.textContent, 'Please open your books now.');
  assertPairedOrder(s);
});

test('a removed segment ignores its late translation while newer speech keeps moving', async () => {
  const s = setup(); await s.context.startListening();
  s.transcript('old', 'The train leaves at thirteen minutes after noon and not at thirty minutes in the morning.', true);
  await flush(); assert.equal(s.requests.length, 1);
  s.requests[0].done('旧句的第一行。'); await flush();
  assert.equal(s.requests.length, 2);
  const removed = s.context.entries[1];
  s.transcript('new', 'Please open your books now.', true);
  s.transcript('old', 'Wait.', true);
  assert.equal(removed.cancelled, true);
  assert.equal(removed.source.parentNode, null);
  assert.equal(removed.output.parentNode, null);
  s.requests[1].event({ type: 'delta', delta: 'STALE REMOVED CAPTION' });
  s.requests[1].done('STALE REMOVED CAPTION'); await flush();
  assert.equal(s.requests[2].text, 'Please open your books now.');
  assert.ok(!s.ids.chinese.textContent.includes('STALE'));
  assert.ok(!removed.output.textContent.includes('STALE'));
  assert.equal(s.context.listening, true);
  s.requests[2].done('现在请打开书。'); await flush();
  assert.equal(s.requests[3].text, 'Wait.');
  s.requests[3].done('等一下。'); await flush();
  assert.deepEqual(Array.from(s.context.entries, entry => entry.english), ['Wait.', 'Please open your books now.']);
  assertPairedOrder(s); assert.equal(s.context.processing, false);
});

test('background corrected words requeue Chinese without duplicating rows or blocking fresh speech', async () => {
  const s = setup(); await s.context.startListening();
  s.transcript('old', 'The answer is thirteen.', true); await flush();
  const old = s.context.entries[0];
  s.requests[0].done('答案是十三。'); await flush();
  s.transcript('current', 'Please open your books.', false); await flush();
  assert.equal(s.requests[1].text, 'Please open your books.');
  s.transcript('old', 'The answer is thirty.', true);
  assert.equal(s.context.entries[0], old);
  assert.equal(old.source.textContent, 'The answer is thirty.');
  assert.equal(old.output.textContent, '答案是十三。');
  assert.ok(s.context.queue.includes(old));
  assert.equal(s.requests.length, 2);
  s.transcript('next', 'Keep reading the next paragraph.', false);
  s.requests[1].done('请打开书。'); await flush();
  assert.equal(s.requests[2].text, 'Keep reading the next paragraph.');
  s.requests[2].done('继续读下一段。'); await flush();
  assert.equal(s.requests[3].text, 'The answer is thirty.');
  s.requests[3].event({ type: 'delta', delta: '答' }); await flush();
  assert.equal(old.output.textContent, '答案是十三。');
  s.requests[3].done('答案是三十。'); await flush();
  assert.equal(old.output.textContent, '答案是三十。');
  assert.equal(s.context.entries.length, 3);
  assert.equal(s.context.listening, true);
  assertPairedOrder(s); assert.equal(s.context.processing, false);
});

for (const activeOrdinal of [0, 1]) {
  test(`AI Chinese correction collapses old rows in place and ignores a late fast response for row ${activeOrdinal}`, async () => {
    const s = setup(); await s.context.startListening();
    const english = 'Mitochondria are the powerhouse of the cell and they release energy that living organisms need daily.';
    const chinese = '线粒体是细胞的动力工厂，为生物体释放每日所需的能量。';
    s.transcript('old', english, true); await flush();
    assert.equal(s.context.entries.length, 2);
    const first = s.context.entries[0], second = s.context.entries[1];
    if (activeOrdinal === 1) { s.requests[0].done('甲子体是细胞的动力工厂。'); await flush(); }
    assert.equal(s.requests.length, activeOrdinal + 1);
    assert.equal(s.context.entries[activeOrdinal].working, true);
    s.transcript('new', 'Move to the next question.', false);
    const later = s.context.entries[2];
    s.captures[0].options.onPolished('old', english, chinese);
    assert.equal(s.context.entries.length, 2);
    assert.equal(s.context.entries[0], first);
    assert.equal(s.context.entries[1], later);
    assert.equal(first.polished, true);
    assert.equal(first.source.textContent, english);
    assert.equal(first.output.textContent, chinese);
    assert.equal(second.cancelled, true);
    assert.equal(second.source.parentNode, null);
    assert.equal(second.output.parentNode, null);
    assert.ok(!s.context.queue.includes(first));
    assert.ok(!s.context.queue.includes(second));
    assertPairedOrder(s);

    // Neither a stale stream nor another recognizer callback can undo the corrected pair.
    s.requests[activeOrdinal].event({ type: 'delta', delta: 'STALE 甲子体' });
    s.requests[activeOrdinal].done('STALE 甲子体'); await flush();
    assert.equal(first.output.textContent, chinese);
    assert.ok(!s.ids.chinese.textContent.includes('STALE'));
    assert.equal(s.requests[activeOrdinal + 1].text, 'Move to the next question.');
    s.transcript('old', 'Incorrect late words must not replace the verified transcript.', true);
    s.captures[0].options.onPolished('old', 'Duplicate incorrect English', '重复的不正确翻译。');
    assert.equal(first.source.textContent, english);
    assert.equal(first.output.textContent, chinese);
    assert.equal(s.context.entries.length, 2);
    s.requests[activeOrdinal + 1].done('继续下一题。'); await flush();
    assert.equal(s.requests.length, activeOrdinal + 2); // No fast request is requeued for the polished row.
    assert.equal(s.context.queue.length, 0);
    assert.equal(s.context.processing, false);
    assert.equal(s.context.listening, true);
    assertPairedOrder(s);
  });
}

test('a polished callback from an old microphone generation cannot edit old or newly reused utterance IDs', async () => {
  const s = setup({ pauseTranslations: true }); await s.context.startListening();
  s.transcript('same-id', 'Earlier unpolished speech.', true);
  const original = s.context.entries[0], oldCapture = s.captures[0];
  s.context.stopListening(); await s.context.startListening();
  assert.equal(oldCapture.cancelled, true);
  s.transcript('same-id', 'New microphone speech.', true);
  const current = s.context.entries[1];
  oldCapture.options.onPolished('same-id', 'Stale English', '过期的翻译。');
  assert.equal(original.source.textContent, 'Earlier unpolished speech.');
  assert.equal(original.polished, undefined);
  assert.equal(current.source.textContent, 'New microphone speech.');
  assert.equal(current.polished, undefined);
  s.captures[1].options.onPolished('same-id', 'New microphone speech.', '新麦克风的语音。');
  assert.equal(current.output.textContent, '新麦克风的语音。');
  assert.equal(current.polished, true);
  assert.equal(original.polished, undefined);
  assertPairedOrder(s);
});
