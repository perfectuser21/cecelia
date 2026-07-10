// packages/brain/src/__tests__/flush-callback-queue.test.js
// 驱动真实 bash 脚本(仓库 hook 测试同套路):起本地 http server 当假 webhook
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, existsSync, rmSync, readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const SCRIPT = join(HERE, '../../scripts/flush-callback-queue.sh');

function runFlush(queueDir, webhookUrl) {
  return spawnSync('bash', [SCRIPT], {
    env: { ...process.env, CALLBACK_QUEUE_DIR: queueDir, WEBHOOK_URL: webhookUrl },
    encoding: 'utf8', timeout: 30000,
  });
}

describe('flush-callback-queue.sh 死信队列自愈', () => {
  let dir;
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'cbq-')); });
  afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

  it('webhook 200:队列文件被删除,exit 0', async () => {
    writeFileSync(join(dir, 'task-a.json'), JSON.stringify({ task_id: 'a', status: 'completed' }));
    const srv = createServer((req, res) => { res.writeHead(200); res.end('{"success":true}'); });
    await new Promise((r) => srv.listen(0, '127.0.0.1', r));
    const port = srv.address().port;
    const out = runFlush(dir, `http://127.0.0.1:${port}/cb`);
    srv.close();
    expect(out.status).toBe(0);
    expect(existsSync(join(dir, 'task-a.json'))).toBe(false);
  });

  it('webhook 不可达:文件保留,exit 仍 0 不阻断主流程', () => {
    writeFileSync(join(dir, 'task-b.json'), '{"task_id":"b"}');
    const out = runFlush(dir, 'http://127.0.0.1:1/cb');
    expect(out.status).toBe(0);
    expect(existsSync(join(dir, 'task-b.json'))).toBe(true);
  });

  it('队列目录不存在:直接 exit 0', () => {
    const out = runFlush(join(dir, 'nope'), 'http://127.0.0.1:1/cb');
    expect(out.status).toBe(0);
  });

  it('cecelia-run.sh 已接线调用 flush 脚本', () => {
    const runSh = readFileSync(join(HERE, '../../scripts/cecelia-run.sh'), 'utf8');
    expect(runSh).toMatch(/flush-callback-queue\.sh/);
  });
});
