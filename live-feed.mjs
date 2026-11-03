import { randomUUID } from 'node:crypto';

export function createLiveFeed() {
  let records = [];
  const clients = new Set();
  const send = (res, event) => { if (!res.destroyed) res.write(JSON.stringify(event) + '\n'); };
  const broadcast = event => { for (const res of clients) send(res, event); };
  return {
    start(english) {
      const record = { id: randomUUID(), english, translation: '', status: 'translating' };
      records.push(record); records = records.slice(-200);
      broadcast({ type: 'record', record: { ...record } });
      return record.id;
    },
    update(id, event) {
      const record = records.find(value => value.id === id);
      if (!record) return;
      if (event.type === 'delta') record.translation += event.delta;
      else if (event.type === 'done') { record.translation = event.text; record.status = 'done'; }
      else if (event.type === 'error') record.status = 'error';
      else return;
      broadcast({ type: 'record', record: { ...record } });
    },
    clear() { records = []; broadcast({ type: 'snapshot', records: [] }); },
    subscribe(res) {
      res.writeHead(200, { 'Content-Type': 'application/x-ndjson; charset=utf-8', 'Cache-Control': 'no-store', 'X-Accel-Buffering': 'no' });
      res.flushHeaders(); clients.add(res);
      send(res, { type: 'snapshot', records });
      const timer = setInterval(() => send(res, { type: 'ping' }), 15000);
      res.on('close', () => { clearInterval(timer); clients.delete(res); });
    },
  };
}
