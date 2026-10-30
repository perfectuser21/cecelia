import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { createServer } from 'node:net';
import { appendFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const sleep = ms => new Promise(done => setTimeout(done, ms));

async function main() {
  const url = new URL(process.env.DATABASE_URL || 'postgresql://localhost/invalid');
  if (!['postgres:', 'postgresql:'].includes(url.protocol) || !['localhost', '127.0.0.1'].includes(url.hostname)
      || url.pathname !== '/cecelia_scratch' || url.search || url.hash) {
    throw new Error('只允许本机专用 cecelia_scratch 数据库');
  }
  if (process.argv[2] === '--validate-only') {
    const fields = {
      DB_HOST: url.hostname, DB_PORT: url.port || '5432', DB_NAME: 'cecelia_scratch',
      DB_USER: decodeURIComponent(url.username), DB_PASSWORD: decodeURIComponent(url.password),
    };
    for (const [key, value] of Object.entries(fields)) {
      if (process.env[key] !== value) throw new Error(`迁移与运行连接必须一致：${key}`);
    }
    process.stdout.write('迁移前专用数据库连接核对通过\n');
    return;
  }
  const pool = new pg.Pool({ connectionString: url.href, connectionTimeoutMillis: 5000, query_timeout: 10000, max: 1 });
  let child, closed = false, closedPromise;
  try {
    assert.equal((await pool.query('SELECT current_database() AS name')).rows[0].name, 'cecelia_scratch');
    // 由操作系统分配端口，绝不连接已有的 Brain，也不清理别人的进程。
    const socket = createServer();
    await new Promise((done, reject) => socket.once('error', reject).listen(0, '127.0.0.1', done));
    const port = socket.address().port;
    await new Promise(done => socket.close(done));
    const log = join(tmpdir(), `cecelia-ci-basic-runtime-${randomUUID()}.log`);
    writeFileSync(log, '');
    let output = '', launchError;
    child = spawn(process.execPath, ['server.js'], {
      cwd: join(root, 'packages/brain'), stdio: ['ignore', 'pipe', 'pipe'],
      env: {
        ...process.env, NODE_ENV: 'test', CI: 'true', PORT: String(port), BRAIN_PORT: String(port),
        DB_HOST: url.hostname, DB_PORT: url.port || '5432', DB_NAME: 'cecelia_scratch',
        DB_USER: decodeURIComponent(url.username), DB_PASSWORD: decodeURIComponent(url.password),
        CECELIA_TICK_ENABLED: 'false', CECELIA_LLM_DISABLED: 'true', SKIP_MIGRATIONS: 'true',
      },
    });
    closedPromise = new Promise(done => child.once('close', () => { closed = true; done(); }));
    child.on('error', error => { launchError = error; });
    for (const stream of [child.stdout, child.stderr]) stream.on('data', chunk => {
      output = (output + chunk).slice(-256000);
      appendFileSync(log, chunk);
    });
    const deadline = Date.now() + 60000;
    while (!output.includes(`Cecelia Brain running on http://localhost:${port}`)) {
      if (launchError || child.exitCode !== null || child.signalCode !== null || Date.now() > deadline) {
        throw new Error(`本人 Brain 启动失败；日志：${log}\n${output.slice(-4000)}`);
      }
      await sleep(100);
    }
    async function request(path, method = 'GET', body, expected = [200, 201]) {
      const response = await fetch(`http://127.0.0.1:${port}/api/brain${path}`, {
        method, headers: { 'Content-Type': 'application/json' },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(10000),
      });
      const json = await response.json();
      assert.ok(expected.includes(response.status), `${method} ${path} 返回 ${response.status}：${JSON.stringify(json)}`);
      return json;
    }
    const health = await request('/health');
    assert.equal(health.runtime?.isolated, true);
    assert.equal(health.runtime?.background_automation, false);
    const title = `CI 基础运行验收 ${randomUUID()}`;
    const task = await request('/tasks', 'POST', {
      title, task_type: 'research', mutation_intent: 'none', trigger_source: 'manual',
      payload: { headed_manual: 'true' },
    });
    assert.match(task.id, /^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/);
    assert.equal((await request(`/tasks/${task.id}`)).title, title);
    const claimed = await request(`/tasks/${task.id}/claim`, 'POST', { claimer: 'basic-ci-owner' });
    assert.equal(claimed.claimed_by, 'basic-ci-owner');
    await request(`/tasks/${task.id}/claim`, 'POST', { claimer: 'another-ci-owner' }, [409]);
    await request(`/tasks/${task.id}`, 'PATCH', { status: 'in_progress' });
    const result = { actor: 'basic-ci-owner', evidence: randomUUID() };
    await request(`/tasks/${task.id}`, 'PATCH', { status: 'completed', result });
    const persisted = (await pool.query('SELECT title,task_type,status,result,completed_at FROM tasks WHERE id=$1', [task.id])).rows[0];
    assert.equal(persisted.title, title);
    assert.equal(persisted.task_type, 'research');
    assert.equal(persisted.status, 'completed');
    assert.equal(persisted.result.evidence, result.evidence);
    assert.ok(persisted.completed_at);
    process.stdout.write(`真实服务启动、任务创建/领取/防抢领/完成及 PG 持久化通过：${task.id}\n日志：${log}\n`);
  } finally {
    let cleanupError;
    if (child?.pid && !closed) {
      const waitForClose = async () => {
        let timer;
        await Promise.race([closedPromise, new Promise(done => { timer = setTimeout(done, 5000); })]);
        clearTimeout(timer);
      };
      child.kill('SIGTERM');
      await waitForClose();
      if (!closed) {
        child.kill('SIGKILL');
        await waitForClose();
      }
      if (!closed) cleanupError = new Error(`本人测试进程未能关闭：${child.pid}`);
    }
    await pool.end();
    if (cleanupError) throw cleanupError;
  }
}

main().catch(error => { process.stderr.write(`${error.stack || error.message}\n`); process.exitCode = 1; });
