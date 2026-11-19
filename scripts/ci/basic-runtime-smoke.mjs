import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { createServer } from 'node:net';
import { appendFileSync, writeFileSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
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
  const artifacts = mkdtempSync(join(tmpdir(), 'cecelia-ci-runtime-artifacts-'));
  let child, closed = false, closedPromise;
  const controller = new AbortController();
  const cancel = () => {
    process.exitCode = 1;
    controller.abort(new Error('运行验收收到中断信号'));
  };
  process.once('SIGINT', cancel);
  process.once('SIGTERM', cancel);
  try {
    assert.equal((await pool.query('SELECT current_database() AS name')).rows[0].name, 'cecelia_scratch');
    const retention = await pool.connect();
    try {
      await retention.query('BEGIN');
      const id = randomUUID();
      const before = await retention.query(
        "INSERT INTO decisions (id,topic,decision,created_at) VALUES ($1,$2,$3,NOW()-INTERVAL '90 days') RETURNING id,topic,decision,created_at",
        [id, 'CI durable decision', 'retain historical decision'],
      );
      assert.equal((await retention.query('SELECT cleanup_decisions(30) AS n')).rows[0].n, 0, '决策台账不能按年龄删除');
      const after = await retention.query('SELECT id,topic,decision,created_at FROM decisions WHERE id=$1', [id]);
      assert.deepEqual(after.rows, before.rows, '历史决策内容必须完整保留');
    } finally {
      try { await retention.query('ROLLBACK'); } finally { retention.release(); }
    }
    controller.signal.throwIfAborted();
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
        HANDOFF_DOCS_DIR: artifacts,
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
      controller.signal.throwIfAborted();
      if (launchError || child.exitCode !== null || child.signalCode !== null || Date.now() > deadline) {
        throw new Error(`本人 Brain 启动失败；日志：${log}\n${output.slice(-4000)}`);
      }
      await sleep(100);
    }
    if (process.argv[2] === '--cancel-probe') {
      controller.signal.throwIfAborted();
      process.stdout.write(`RUNTIME_CANCEL_PROBE ${JSON.stringify({pid: child.pid, port, artifacts})}\n`);
      await new Promise((_, reject) => controller.signal.addEventListener('abort', () => reject(controller.signal.reason), {once: true}));
    }
    async function request(path, method = 'GET', body, expected = [200, 201]) {
      const response = await fetch(`http://127.0.0.1:${port}/api/brain${path}`, {
        method, headers: { 'Content-Type': 'application/json' },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.any([controller.signal, AbortSignal.timeout(10000)]),
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
    const beforeDrain = (await pool.query('SELECT * FROM tasks WHERE id=$1', [task.id])).rows;
    const pause = await request('/tick/drain', 'POST');
    try {
      assert.equal(pause.protocol, 'brain-process-drain-v1', '发布排空必须确认进程归属协议');
      assert.match(pause.drain_id, /^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/);
      const ready = await request('/tick/drain-status');
      assert.equal(ready.drain_id, pause.drain_id);
      assert.equal(ready.safe_to_swap, true, '独立有头任务不应阻塞 Brain 切换');
      assert.equal(ready.remaining, 0);
      assert.equal(ready.draining, true, '读到排空完成后仍须保持暂停');
      assert.ok(ready.independent_task_count >= 1);
      assert.equal((await request('/tick/status')).draining, true);
      assert.deepEqual((await pool.query('SELECT * FROM tasks WHERE id=$1', [task.id])).rows, beforeDrain);
    } finally {
      assert.equal((await request('/tick/drain-cancel', 'POST', { drain_id: pause.drain_id })).success, true);
    }
    const resumed = await request('/tick/drain-status');
    assert.equal(resumed.draining, false);
    assert.equal(resumed.safe_to_swap, false, '未暂停时不能签发切换许可');
    const result = { actor: 'basic-ci-owner', evidence: randomUUID() };
    await request(`/tasks/${task.id}`, 'PATCH', { status: 'completed', result });
    const persisted = (await pool.query('SELECT title,task_type,status,result,completed_at FROM tasks WHERE id=$1', [task.id])).rows[0];
    assert.equal(persisted.title, title);
    assert.equal(persisted.task_type, 'research');
    assert.equal(persisted.status, 'completed');
    assert.equal(persisted.result.evidence, result.evidence);
    assert.ok(persisted.completed_at);
    const handoff = readdirSync(artifacts).find(name => name.endsWith(`-${task.id.slice(0, 8)}.md`));
    assert.ok(handoff, '交接文件必须落在本人临时目录');
    assert.ok(readFileSync(join(artifacts, handoff), 'utf8').includes(task.id));
    const key = `ci_basic_${randomUUID().replaceAll('-', '_')}`;
    await request(`/kv/${key}`, 'GET', undefined, [404]);
    const value = { evidence: randomUUID(), task: task.id };
    assert.equal((await request(`/kv/${key}`, 'POST', value)).ok, true);
    assert.deepEqual((await request(`/kv/${key}`)).value, value);
    const stored = (await pool.query('SELECT value_json FROM working_memory WHERE key=$1', [key])).rows[0];
    assert.deepEqual(stored.value_json, value);
    process.stdout.write(`历史决策留存、真实服务启动、排空归属及持续暂停、任务创建/领取/防抢领/完成、KV读写及 PG 持久化通过：${task.id}\n日志：${log}\n`);
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
    if (!child?.pid || closed) rmSync(artifacts, {recursive: true, force: true});
    process.removeListener('SIGINT', cancel);
    process.removeListener('SIGTERM', cancel);
    if (cleanupError) throw cleanupError;
  }
}

main().catch(error => { process.stderr.write(`${error.stack || error.message}\n`); process.exitCode = 1; });
