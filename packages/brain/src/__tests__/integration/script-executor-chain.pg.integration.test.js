/**
 * executor=script 端到端 —— 真 PostgreSQL + 真 dispatcher/executor + 真远端 runner
 * （链 bf5088a3 棒3 PR B，任务 5cdbd52a）。
 *
 * 唯一替身：ssh 传输。假传输把「ssh <target> <远端命令>」改成本机 `sh -c <远端命令>`（HOME 指向临时目录），
 * 所以远端 runner 脚本、.pid/.exit 三件套、超时杀进程组都是真的在跑，只是没有网络。
 * agent 步 = 既有 internal handler 执行路径的桩（不调模型）。
 *
 * 断言：
 *   ① script → agent → script 三步链由 dispatcher 自动串完，hard 依赖门控生效（前一步没 completed 后一步不派）；
 *      tasks 每步一行、task_runs 每步一行，stdout 经收割落 tasks.result.script。
 *   ② 失败：按 retry-policy 重排一次，再失败即 failed，带 exit code / 截断 stderr / attempts 记录。
 *   ③ 违规 payload（us-vps）绕过建单入口直插库也不会被派发，终态 failed。
 *   ④ 幂等：同一次尝试重复派发只跑一遍。
 *   ⑤ 并发槽：同一跑场机 in_progress 的 script 数达上限，后来者留在 queued。
 * 用完即删临时库；不连共享库。
 */
import { execFile as nodeExecFile, spawn as nodeSpawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createTempMigratedDb } from '../helpers/temp-migrated-db.js';

// 派发链上会打外网/查配额的两个外围模块：只替身这两个，其余全部真跑。
vi.mock('../../quota-guard.js', async (importOriginal) => ({
  ...(await importOriginal()),
  checkQuotaGuard: async () => ({ allow: true, priorityFilter: null, bestPct: 0, reason: 'test' }),
}));
// agent 步（internal handler 桩）走 dispatcher 的 bridge 健康检查：CI 上没有 cecelia-bridge，替身成「可用」。
// script 步本身不走这道检查（surface=script 豁免），这里只服务 agent 桩。
vi.mock('../../executor.js', async (importOriginal) => ({
  ...(await importOriginal()),
  checkCeceliaRunAvailable: async () => ({ available: true }),
}));
vi.mock('../../account-usage.js', async (importOriginal) => ({
  ...(await importOriginal()),
  proactiveTokenCheck: async () => {},
}));

let db;
let home;
let dispatcher;
let scriptExec;
let router;
let handlerBackup;
const remoteCalls = [];

const fakeTransport = () => ({
  spawnFn: (bin, args, opts) => {
    remoteCalls.push({ kind: 'spawn', bin, args });
    return nodeSpawn('sh', ['-c', args.at(-1)], { ...opts, env: { ...process.env, HOME: home } });
  },
  execFileFn: (bin, args, opts, cb) => {
    remoteCalls.push({ kind: 'exec', bin, args });
    return nodeExecFile('sh', ['-c', args.at(-1)], { ...opts, env: { ...process.env, HOME: home } }, cb);
  },
});

beforeAll(async () => {
  home = mkdtempSync(join(tmpdir(), 'script-chain-home-'));
  db = await createTempMigratedDb('scriptchain');
  // 被测模块（dispatcher/executor/db.js 默认池）必须连到临时库：db-config 在 import 时读 env。
  process.env.DB_NAME = db.name;
  process.env.NODE_ENV = 'test';
  vi.resetModules();
  dispatcher = await import('../../dispatcher.js');
  scriptExec = await import('../../script-executor.js');
  router = await import('../../task-router.js');
  scriptExec._setScriptTransport(fakeTransport());
  // agent 步桩：既有 internal handler 路径（executor 0.6），handler 自己经 updateTaskResult→finalizeTask 落 completed。
  handlerBackup = router.INTERNAL_TASK_HANDLERS.harness_intervention;
  router.INTERNAL_TASK_HANDLERS.harness_intervention = async (task, deps) => {
    await deps.updateTaskResult(task.id, { agent_step: 'stub-done' });
    return { action: 'stub' };
  };
}, 240_000);

afterAll(async () => {
  if (router && handlerBackup) router.INTERNAL_TASK_HANDLERS.harness_intervention = handlerBackup;
  scriptExec?._resetScriptTransport?.();
  // 被测模块的默认池（db.js）也连着临时库：先关它，否则 DROP 时连接被强杀，pg 池抛 57P01 未处理错误。
  try { await (await import('../../db.js')).default.end(); } catch { /* 已关 */ }
  if (db) await db.drop();
  if (home) rmSync(home, { recursive: true, force: true });
}, 60_000);

const insertTask = async ({ taskType, title, payload, description = null }) => {
  const id = randomUUID();
  await db.pool.query(
    `INSERT INTO tasks (id, title, description, task_type, status, priority, payload)
     VALUES ($1, $2, $3, $4, 'queued', 'P2', $5::jsonb)`,
    [id, `${title} ${id}`, description, taskType, JSON.stringify(payload)],
  );
  return id;
};
const scriptPayload = (cmd, over = {}) => ({ host: 'xian-m4', cmd, timeout_sec: 30, ...over });
const dep = (from, to) => db.pool.query(
  `INSERT INTO task_dependencies (from_task_id, to_task_id, edge_type) VALUES ($1, $2, 'hard')`, [from, to],
);
const statusOf = async (id) => (await db.pool.query('SELECT * FROM tasks WHERE id = $1', [id])).rows[0];
const runsOf = async (id) => (await db.pool.query('SELECT * FROM task_runs WHERE task_id = $1 ORDER BY started_at', [id])).rows;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** 一个 tick：派发一次 + 收割一次（真实部署里分别由 tick 与 scheduler job 完成）。 */
async function tick() {
  const dispatched = await dispatcher.dispatchNextTask(null);
  await sleep(400);
  const reaped = await scriptExec.reapScriptRuns(db.pool, fakeTransport());
  return { dispatched, reaped };
}

async function tickUntil(predicate, max = 40) {
  for (let i = 0; i < max; i++) {
    await tick();
    if (await predicate()) return i + 1;
  }
  throw new Error('tickUntil 超出上限');
}

describe.sequential('script → agent → script 三步链', () => {
  it('由 dispatcher 自动串完；hard 依赖门控生效；tasks 与 task_runs 每步一行', async () => {
    const t1 = await insertTask({ taskType: 'script_run', title: '链-脚本1', payload: scriptPayload(`printf 'step1' > "$HOME/marker.txt"; echo done-1`) });
    const t2 = await insertTask({ taskType: 'harness_intervention', title: '链-agent', description: 'agent 步桩：走既有 internal handler 执行路径', payload: { action: 'spike' } });
    const t3 = await insertTask({ taskType: 'script_run', title: '链-脚本3', payload: scriptPayload(`cat "$HOME/marker.txt"; echo done-3`, { env: { SCRIPT_TOKEN: 'TOPSECRETVALUE' } }) });
    await dep(t2, t1);
    await dep(t3, t2);

    const snapshots = [];
    await tickUntil(async () => {
      const rows = await Promise.all([t1, t2, t3].map(statusOf));
      snapshots.push(rows.map((r) => r.status));
      return rows.every((r) => r.status === 'completed');
    });

    // 门控：任一快照里，前一步没 completed，后一步必须还是 queued
    for (const [s1, s2, s3] of snapshots) {
      if (s1 !== 'completed') expect(s2).toBe('queued');
      if (s2 !== 'completed') expect(s3).toBe('queued');
    }

    const [r1, r2, r3] = await Promise.all([t1, t2, t3].map(statusOf));
    expect([r1.status, r2.status, r3.status]).toEqual(['completed', 'completed', 'completed']);
    expect(r1.executor_kind).toBe('script');
    expect(r3.executor_kind).toBe('script');

    // stdout 经收割落 tasks.result.script；第三步读到了第一步写的文件
    expect(r1.result.script).toMatchObject({ exit_code: 0, host: 'xian-mac-m4' });
    expect(r1.result.script.stdout).toContain('done-1');
    expect(r3.result.script.stdout).toContain('step1');
    expect(r3.result.script.stdout).toContain('done-3');
    // agent 步走的是既有 internal 路径
    expect(r2.result).toMatchObject({ agent_step: 'stub-done' });

    // task_runs：每步恰好一行
    const [runs1, runs2, runs3] = await Promise.all([t1, t2, t3].map(runsOf));
    expect(runs1).toHaveLength(1);
    expect(runs2).toHaveLength(1);
    expect(runs3).toHaveLength(1);
    for (const run of [runs1[0], runs3[0]]) {
      expect(run.status).toBe('success');
      expect(run.context.source).toBe('script');
      expect(run.result.exit_code).toBe(0);
      expect(run.result.artifacts.some((a) => /brain-runs\/script-.*\.out$/.test(a))).toBe(true);
      expect(run.ended_at).not.toBeNull();
    }
    expect(runs1[0].run_id).toBe(`script-${t1}-a1`);
    expect(runs2[0].status).toBe('success');

    // 凭据不外泄：env 值不在 tasks.result / task_runs / task_events / ssh 命令行里，只有键名
    const leak = JSON.stringify([
      r3.result,
      runs3,
      (await db.pool.query('SELECT payload FROM task_events WHERE task_id = $1', [t3])).rows,
      remoteCalls.map((c) => c.args),
    ]);
    expect(leak).not.toContain('TOPSECRETVALUE');
    expect(leak).toContain('SCRIPT_TOKEN');
    // ssh 命令行里也没有 cmd 明文
    expect(JSON.stringify(remoteCalls.map((c) => c.args))).not.toContain('marker.txt');
  }, 120_000);
});

describe.sequential('失败如实 + retry-policy（硬约束 4）', () => {
  it('exit≠0：重排一次后再失败即 failed，带 exit code、截断 stderr 与 attempts 记录', async () => {
    const before = remoteCalls.filter((c) => c.kind === 'spawn').length;
    const t = await insertTask({ taskType: 'script_run', title: '失败脚本', payload: scriptPayload('echo oops >&2; exit 3') });

    await tickUntil(async () => (await statusOf(t)).status !== 'in_progress' && (await statusOf(t)).payload.script_attempts?.length === 1);
    let row = await statusOf(t);
    expect(row.status).toBe('queued');
    expect(row.payload.script_attempts).toHaveLength(1);
    expect(row.payload.script_attempts[0]).toMatchObject({ attempt: 1, exit_code: 3, run_id: `script-${t}-a1` });
    expect(new Date(row.payload.next_run_at).getTime()).toBeGreaterThan(Date.now());
    expect(row.claimed_by).toBeNull();

    // 退避未到期：不会被派发
    await dispatcher.dispatchNextTask(null);
    expect((await statusOf(t)).status).toBe('queued');

    // 模拟退避到期
    await db.pool.query(`UPDATE tasks SET payload = payload || '{"next_run_at":"2020-01-01T00:00:00.000Z"}'::jsonb WHERE id = $1`, [t]);
    await tickUntil(async () => (await statusOf(t)).status === 'failed');
    row = await statusOf(t);
    expect(row.status).toBe('failed');
    expect(row.error_message).toMatch(/script_exit_3/);
    expect(row.error_message).toMatch(/oops/);
    expect(row.result.script).toMatchObject({ exit_code: 3, attempts: 2 });
    expect(row.result.script.stderr).toContain('oops');
    expect(row.payload.script_attempts).toHaveLength(2);
    expect(row.payload.script_attempts.map((a) => a.run_id)).toEqual([`script-${t}-a1`, `script-${t}-a2`]);

    const runs = await runsOf(t);
    expect(runs).toHaveLength(2);
    expect(runs.map((r) => r.status)).toEqual(['failed', 'failed']);
    expect(runs.every((r) => r.result.exit_code === 3)).toBe(true);

    // 终态后不再被派发：全程只发了两次 spawn
    await tick();
    expect(remoteCalls.filter((c) => c.kind === 'spawn').length - before).toBe(2);
  }, 120_000);

  it('超时：远端杀进程标失败，failed 带 script_timeout（重试一次后）', async () => {
    const t = await insertTask({ taskType: 'script_run', title: '超时脚本', payload: scriptPayload('sleep 25', { timeout_sec: 1 }) });
    await tickUntil(async () => (await statusOf(t)).payload.script_attempts?.length === 1, 30);
    expect((await statusOf(t)).payload.script_attempts[0]).toMatchObject({ exit_code: 124, timed_out: true });
    await db.pool.query(`UPDATE tasks SET payload = payload || '{"next_run_at":"2020-01-01T00:00:00.000Z"}'::jsonb WHERE id = $1`, [t]);
    await tickUntil(async () => (await statusOf(t)).status === 'failed', 30);
    const row = await statusOf(t);
    expect(row.error_message).toMatch(/script_timeout/);
    expect((await runsOf(t)).map((r) => r.status)).toEqual(['timeout', 'timeout']);
  }, 120_000);
});

describe.sequential('硬约束：违规与幂等与并发槽', () => {
  it('绕过建单入口直插库的违规 payload（host=us-vps）：派发时终态 failed，绝不发 ssh', async () => {
    const before = remoteCalls.length;
    const t = await insertTask({ taskType: 'script_run', title: '违规-us-vps', payload: scriptPayload('echo hi', { host: 'us-vps' }) });
    await tickUntil(async () => (await statusOf(t)).status === 'failed', 10);
    const row = await statusOf(t);
    expect(row.error_message).toMatch(/script_payload_invalid/);
    expect(row.error_message).toMatch(/调度器|零执行/);
    expect(row.payload.failure_class).toBe('script_payload_invalid');
    expect(remoteCalls.length).toBe(before);
    expect(await runsOf(t)).toHaveLength(0);
  }, 60_000);

  it('幂等：同一次尝试重复派发（模拟 ssh 超时后重试/重启），命令只跑一遍、run 只有一行', async () => {
    const counter = join(home, 'idem-counter');
    const t = await insertTask({ taskType: 'script_run', title: '幂等脚本', payload: scriptPayload(`echo x >> '${counter}'; sleep 1`) });
    const row = await statusOf(t);
    const deps = { pool: db.pool, ...fakeTransport() };
    const a = await scriptExec.triggerScriptRun(row, deps);
    const b = await scriptExec.triggerScriptRun(row, deps);
    expect(a.success).toBe(true);
    expect(b).toMatchObject({ success: true, alreadyRunning: true, runId: a.runId });
    await sleep(2500);
    expect(readFileSync(counter, 'utf8').trim().split('\n')).toHaveLength(1);
    expect(await runsOf(t)).toHaveLength(1);
    // 收掉它：别让这条 in_progress 占着 xian-mac-m4 的并发槽影响后面的用例
    await scriptExec.reapScriptRuns(db.pool, fakeTransport());
    expect((await statusOf(t)).status).toBe('completed');
  }, 60_000);

  it('并发槽：同一跑场机 in_progress 的 script 数达上限，后来者留在 queued，前者收割后放行', async () => {
    process.env.SCRIPT_HOST_CONCURRENCY = '1';
    try {
      const a = await insertTask({ taskType: 'script_run', title: '槽-A', payload: scriptPayload('sleep 2; echo A') });
      const b = await insertTask({ taskType: 'script_run', title: '槽-B', payload: scriptPayload('echo B') });
      await db.pool.query(`UPDATE tasks SET created_at = NOW() - INTERVAL '1 hour' WHERE id = $1`, [a]);
      const first = await dispatcher.dispatchNextTask(null);
      expect((await statusOf(a)).status, `首次派发结果：${JSON.stringify(first)}`).toBe('in_progress');
      await dispatcher.dispatchNextTask(null);
      expect((await statusOf(b)).status).toBe('queued');
      await tickUntil(async () => (await statusOf(a)).status === 'completed', 20);
      await tickUntil(async () => (await statusOf(b)).status === 'completed', 20);
      expect((await statusOf(b)).result.script.stdout).toContain('B');
    } finally {
      delete process.env.SCRIPT_HOST_CONCURRENCY;
    }
  }, 120_000);
});
