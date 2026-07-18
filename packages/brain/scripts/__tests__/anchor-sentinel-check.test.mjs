import { describe, it, expect, afterEach } from 'vitest';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { createServer } from 'http';
import { resolve } from 'path';
import { fileURLToPath } from 'url';

const execFileAsync = promisify(execFile);
const __dirname = fileURLToPath(new URL('.', import.meta.url));
const SCRIPT = resolve(__dirname, '../anchor-sentinel-check.mjs');

describe('anchor-sentinel-check.mjs', () => {
  let server;
  afterEach(() => { if (server) server.close(); });

  it('打印 broken/total/covered 的 JSON', async () => {
    server = createServer((req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        anchor_coverage: { total_features: 10, anchored: 8, covered_by_graph: 6 },
        freshness: { stale: false },
        broken: 4,
      }));
    });
    await new Promise((r) => server.listen(0, '127.0.0.1', r));
    const port = server.address().port;

    const { stdout } = await execFileAsync('node', [SCRIPT], {
      env: { ...process.env, BRAIN_URL: `http://127.0.0.1:${port}` },
    });
    const parsed = JSON.parse(stdout.trim().split('\n').pop());
    expect(parsed.broken).toBe(4);
    expect(parsed.total).toBe(10);
    expect(parsed.covered).toBe(6);
  });

  it('Brain 不可达 → 非零退出', async () => {
    await expect(execFileAsync('node', [SCRIPT], {
      env: { ...process.env, BRAIN_URL: 'http://127.0.0.1:19998' },
    })).rejects.toThrow();
  });
});
