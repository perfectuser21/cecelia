/**
 * [BEHAVIOR] run 原语接线（链 bf5088a3 棒1，任务 66db3dfb）：
 *  - recordRunFromCallback / startRunForExecResult 的分支语义（内存 pool 替身，只验 SQL 走向）
 *  - fail-open：DB 抛错绝不外泄
 *  - 五条执行路径的接线钉子（executor 漏斗 / dispatcher / openclaw-agent / 回执通道 / kernel 终态）
 *  - cecelia-run.sh 终态回执携带 run_id + exit_code（脚本侧不改码的前提，钉死这一耦合）
 * 真 PG 落库语义见 integration/task-run-primitive.pg.integration.test.js。
 */
import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  startRun,
  finishRun,
  recordRunFromCallback,
  startRunForExecResult,
} from '../lib/task-run.js';

const BRAIN_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const read = (rel) => readFileSync(path.join(BRAIN_ROOT, rel), 'utf8');

/** 记录每条 SQL 的内存 pool；INSERT 视为新建（返回一行），可配置为已存在。 */
function fakePool({ insertRows = [{ id: 'row-1', run_id: 'r' }], existing = [{ id: 'row-0' }], failWith } = {}) {
  const calls = [];
  return {
    calls,
    query: vi.fn(async (sql, params) => {
      calls.push({ sql: String(sql), params });
      if (failWith) throw failWith;
      if (/INSERT INTO task_runs/i.test(sql)) return { rows: insertRows };
      if (/UPDATE task_runs/i.test(sql)) return { rows: [{ id: 'row-1' }] };
      return { rows: existing };
    }),
  };
}
const kinds = (pool) => pool.calls.map((c) => (/INSERT/i.test(c.sql) ? 'insert' : /UPDATE/i.test(c.sql) ? 'update' : 'select'));

describe('recordRunFromCallback — 回执通道 → run 原语', () => {
  it('无 run_id 的回执无从关联，直接跳过（不碰库）', async () => {
    const pool = fakePool();
    const out = await recordRunFromCallback({ taskId: 't1', status: 'completed' }, { pool });
    expect(out.skipped).toBe(true);
    expect(pool.query).not.toHaveBeenCalled();
  });

  it('running 回执只补行（幂等 upsert），不结束', async () => {
    const pool = fakePool();
    await recordRunFromCallback({ taskId: 't1', runId: 'r1', status: 'running' }, { pool });
    expect(kinds(pool)).toEqual(['insert']);
    expect(pool.calls[0].params[2]).toContain('"source":"execution-callback"');
  });

  it('终态回执：补行 + finishRun，exit code 与产物（result.artifacts + pr_url）入 result', async () => {
    const pool = fakePool();
    await recordRunFromCallback(
      { taskId: 't1', runId: 'r1', status: 'completed', exitCode: 0, result: { artifacts: ['pr:1'] }, prUrl: 'https://github.com/o/r/pull/9' },
      { pool },
    );
    expect(kinds(pool)).toEqual(['insert', 'update']);
    const upd = pool.calls[1];
    expect(upd.params[1]).toBe('success');
    expect(JSON.parse(upd.params[2])).toEqual({ exit_code: 0, artifacts: ['pr:1', 'https://github.com/o/r/pull/9'] });
    expect(upd.params[3]).toBeNull();
  });

  it("cecelia-run 的 'AI Done' / 'AI Failed' 别名各自归到 success / failed，失败带 error", async () => {
    const done = fakePool();
    await recordRunFromCallback({ taskId: 't', runId: 'r', status: 'AI Done', exitCode: 0 }, { pool: done });
    expect(done.calls[1].params[1]).toBe('success');
    const failed = fakePool();
    await recordRunFromCallback({ taskId: 't', runId: 'r', status: 'AI Failed', exitCode: 2, error: 'boom' }, { pool: failed });
    expect(failed.calls[1].params[1]).toBe('failed');
    expect(failed.calls[1].params[3]).toBe('boom');
  });

  it('未知/中间态回执（in_progress 等）只保证行存在，不伪造终态', async () => {
    const pool = fakePool();
    await recordRunFromCallback({ taskId: 't', runId: 'r', status: 'in_progress' }, { pool });
    expect(kinds(pool)).toEqual(['insert']);
  });
});

describe('startRunForExecResult — 触发返回值 → run 行', () => {
  const task = { id: 'task-1', task_type: 'dev' };

  it('触发失败（success !== true）不留 run', async () => {
    const pool = fakePool();
    const id = await startRunForExecResult({ task, execResult: { success: false }, source: 'executor' }, { pool });
    expect(id).toBeNull();
    expect(pool.query).not.toHaveBeenCalled();
  });

  it('有 runId：startRun 幂等，返回同一 runId，context 带 source/task_type/executor', async () => {
    const pool = fakePool();
    const id = await startRunForExecResult(
      { task, execResult: { success: true, runId: 'run-9', executor: 'codex-bridge' }, source: 'executor' },
      { pool },
    );
    expect(id).toBe('run-9');
    const ctx = JSON.parse(pool.calls[0].params[2]);
    expect(ctx).toMatchObject({ source: 'executor', task_type: 'dev', executor: 'codex-bridge' });
  });

  it('internal handler（无 runId）：合成 runId 落行并立即 finish 成功，避免长期误报裸跑', async () => {
    const pool = fakePool();
    const id = await startRunForExecResult(
      { task, execResult: { success: true, internal: true, action: 'diagnose' }, source: 'executor' },
      { pool },
    );
    expect(id).toMatch(/^internal-task-1-/);
    expect(kinds(pool)).toEqual(['insert', 'update']);
    expect(JSON.parse(pool.calls[0].params[2]).synthetic).toBe(true);
    expect(pool.calls[1].params[1]).toBe('success');
  });

  it('异常形状（success 却无 runId 且非 internal）：合成 runId 只落 running，不猜终态', async () => {
    const pool = fakePool();
    const id = await startRunForExecResult({ task, execResult: { success: true }, source: 'dispatcher' }, { pool });
    expect(id).toMatch(/^dispatch-task-1-/);
    expect(kinds(pool)).toEqual(['insert']);
  });

  it('dispatcher 兜底与 executor 漏斗对同一 runId 幂等：已存在行不重复 finish', async () => {
    const pool = fakePool({ insertRows: [] });
    await startRunForExecResult({ task, execResult: { success: true, runId: 'run-9' }, source: 'dispatcher' }, { pool });
    expect(kinds(pool)).toEqual(['insert', 'select']);
  });
});

describe('fail-open — 留痕失败绝不拖垮执行主链', () => {
  const boom = new Error('db down');
  it('startRun / finishRun / recordRunFromCallback / startRunForExecResult 遇 DB 错误都不抛', async () => {
    const pool = fakePool({ failWith: boom });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    await expect(startRun({ taskId: 't', runId: 'r', source: 'x' }, { pool })).resolves.toBeNull();
    await expect(finishRun({ runId: 'r', status: 'completed' }, { pool })).resolves.toEqual({ updated: false });
    await expect(recordRunFromCallback({ taskId: 't', runId: 'r', status: 'completed' }, { pool })).resolves.toBeDefined();
    await expect(
      startRunForExecResult({ task: { id: 't' }, execResult: { success: true, runId: 'r' }, source: 'x' }, { pool }),
    ).resolves.toBe('r');
    warn.mockRestore();
  });

  it('缺 source / 缺 taskId 也只 warn 返回 null（留痕缺参不炸执行）', async () => {
    const pool = fakePool();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    await expect(startRun({ taskId: 't', runId: 'r' }, { pool })).resolves.toBeNull();
    await expect(startRun({ runId: 'r', source: 'x' }, { pool })).resolves.toBeNull();
    expect(pool.query).not.toHaveBeenCalled();
    warn.mockRestore();
  });

  it('finishRun 对 running / 未知状态不动库（只认真实终态，不伪造）', async () => {
    const pool = fakePool();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    await expect(finishRun({ runId: 'r', status: 'running' }, { pool })).resolves.toEqual({ updated: false });
    await expect(finishRun({ runId: 'r', status: 'weird' }, { pool })).resolves.toEqual({ updated: false });
    expect(pool.query).not.toHaveBeenCalled();
    warn.mockRestore();
  });
});

describe('执行路径接线钉子（漏接即红）', () => {
  it('executor：triggerCeceliaRun 是经 startRunForExecResult 的漏斗包装，内层改名', () => {
    const src = read('src/executor.js');
    expect(src).toMatch(/from '\.\/lib\/task-run\.js'/);
    expect(src).toMatch(/async function triggerCeceliaRun\(task\)\s*\{\s*const execResult = await _triggerCeceliaRunInner\(task\);/);
    expect(src).toMatch(/startRunForExecResult\(\{ task, execResult, source \}\)/);
    expect(src).toMatch(/async function _triggerCeceliaRunInner\(task\)/);
  });

  it('dispatcher：兜底 startRunForExecResult，且 dispatched 事件带 task_id（裸跑检测 join 键）', () => {
    const src = read('src/dispatcher.js');
    expect(src).toMatch(/startRunForExecResult\(\{ task: nextTask, execResult, source: 'dispatcher' \}\)/);
    expect(src).toMatch(/recordDispatchResult\(pool, true, null, undefined, nextTask\.id\)/);
    expect(src).not.toMatch(/recordDispatchResult\(pool, true\)/);
  });

  it('openclaw-agent：ssh 起成功后 startRun，收割终态后 finishRun', () => {
    const src = read('src/openclaw-agent-executor.js');
    expect(src).toMatch(/source: 'openclaw-agent'/);
    expect(src).toMatch(/await startRun\(/);
    expect(src).toMatch(/await finishRun\(/);
  });

  it('execution-callback：回执经 recordRunFromCallback 留痕（在 callback_queue 落库之后、幂等短路之前）', () => {
    const src = read('src/routes/execution.js');
    const at = src.indexOf('await recordRunFromCallback(');
    expect(at).toBeGreaterThan(src.indexOf("router.post('/execution-callback'"));
    expect(at).toBeGreaterThan(src.indexOf('callback_queue unavailable'));
    expect(at).toBeLessThan(src.indexOf('幂等性保护：run_id + status 组合去重'));
  });

  it('kernel 终态：finalizeKernelRun 提交后 finishRun', () => {
    const src = read('src/orchestrator/kernel-run-store.js');
    const commit = src.lastIndexOf("await client.query('COMMIT');\n    committed = true;\n    // run 原语补终态");
    expect(commit).toBeGreaterThan(0);
    expect(src).toMatch(/await finishRun\(\{\s*runId,/);
  });

  it('cecelia-run.sh 终态回执带 run_id + exit_code（脚本不改码，由 execution-callback 收尾）', () => {
    const sh = read('scripts/cecelia-run.sh');
    expect(sh).toMatch(/--arg run_id "\$CHECKPOINT_ID"/);
    expect(sh).toMatch(/run_id: \$run_id/);
    expect(sh).toMatch(/exit_code: \$exit_code_val/);
    expect(sh).toMatch(/execution-callback/);
    const bridge = read('scripts/cecelia-bridge.cjs');
    expect(bridge).toMatch(/execution-callback/);
    expect(bridge).toMatch(/checkpoint_id/);
  });
});
