import { createServer } from 'node:http';
import { runOpsCollector } from '../../ops-collector.js';
import { fakePool, NOW } from './ops-collector-command-values.mjs';

let ticks = 0;
const heartbeat = setInterval(() => ticks++, 10);
const server = createServer((_request, response) => {
  response.writeHead(200, { 'Content-Type': 'application/json' });
  response.end(JSON.stringify({ ticks }));
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
process.send({ event: 'ready', port: server.address().port });
process.once('message', async message => {
  if (message !== 'collect') throw Error('unexpected fixture input');
  const pool = fakePool();
  try {
    const result = await runOpsCollector(pool, { inContainer: true, now: NOW });
    process.send({ event: 'finished', result, queries: pool.queries });
  } catch (error) {
    process.send({ event: 'failed', error: error.message });
  } finally {
    clearInterval(heartbeat);
    server.close(() => process.disconnect());
  }
});
