import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { createLiveFeed } from './live-feed.mjs';

function viewer(feed) {
  const response = new EventEmitter();
  response.events = [];
  response.writeHead = () => {};
  response.flushHeaders = () => {};
  response.write = line => response.events.push(JSON.parse(line));
  feed.subscribe(response);
  return response;
}

test('students receive streaming text, late-join history, and synchronized clearing', () => {
  const feed = createLiveFeed();
  const first = viewer(feed);
  assert.deepEqual(first.events[0], { type: 'snapshot', records: [] });
  const id = feed.start('Welcome to class.');
  feed.update(id, { type: 'delta', delta: '欢迎' });
  feed.update(id, { type: 'delta', delta: '来到课堂。' });
  feed.update(id, { type: 'done', text: '欢迎来到课堂。' });
  assert.equal(first.events.at(-1).record.translation, '欢迎来到课堂。');
  const late = viewer(feed);
  assert.equal(late.events[0].records[0].english, 'Welcome to class.');
  assert.equal(late.events[0].records[0].status, 'done');
  feed.clear();
  feed.update(id, { type: 'delta', delta: 'stale text must not reappear' });
  assert.deepEqual(first.events.at(-1), { type: 'snapshot', records: [] });
  assert.deepEqual(late.events.at(-1), { type: 'snapshot', records: [] });
  first.emit('close'); late.emit('close');
});
