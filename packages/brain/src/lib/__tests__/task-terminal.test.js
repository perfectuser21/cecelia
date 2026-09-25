/**
 * task-terminal — 任务终态写入唯一收口（链 bf5088a3 第 2 棒）
 *  1. buildTerminalUpdate：status 字面量在 SET 首位；终态统一清 claimed；completed 类 completed_at COALESCE；
 *     白名单列 / jsonb 合并 / dropPayloadKeys / CAS onlyIfStatus / 额外 WHERE 参数重编号 / id::text
 *  2. 非终态 / 非法列 / 无定位条件 → throw
 *  3. finalizeTask：写完对 completed / completed_no_pr 调接棒；failed 不接棒；relay:false 不接棒；多行各接一次
 *  4. afterTerminalTransition：completed_no_pr 也接棒；接棒抛错吞成 warn 不冒泡
 */
import { describe, it, expect, vi } from 'vitest';
import { buildTerminalUpdate, finalizeTask, afterTerminalTransition, isRelayTerminalStatus } from '../task-terminal.js';

const ID = '44444444-4444-4444-8444-444444444444';

describe('buildTerminalUpdate', () => {
  it('completed：status 字面量领头、清 claimed、completed_at COALESCE、updated_at NOW、RETURNING id', () => {
    const { sql, params } = buildTerminalUpdate(ID, 'completed');
    expect(sql).toMatch(/^UPDATE tasks SET status = 'completed'/);
    expect(sql).toContain('claimed_by = NULL');
    expect(sql).toContain('claimed_at = NULL');
    expect(sql).toContain('completed_at = COALESCE(completed_at, NOW())');
    expect(sql).toContain('updated_at = NOW()');
    expect(sql).toMatch(/WHERE id = \$1\s+RETURNING id, status/);
    expect(params).toEqual([ID]);
  });

  it('failed 默认不动 completed_at；set.completed_at="now" 才写', () => {
    expect(buildTerminalUpdate(ID, 'failed').sql).not.toContain('completed_at');
    expect(buildTerminalUpdate(ID, 'failed', { set: { completed_at: 'now' } }).sql).toContain('completed_at = NOW()');
  });

  it('白名单列 / setIfNull / jsonb 合并 / dropPayloadKeys / onlyIfStatus / 额外 WHERE 重编号', () => {
    const { sql, params } = buildTerminalUpdate(ID, 'completed', {
      set: { error_message: 'boom', pr_status: 'merged', result: { a: 1 } },
      setIfNull: { pr_url: 'https://x/pr/1' },
      mergePayload: { run_status: 'merged' },
      mergeResult: { receipt: { ok: true } },
      dropPayloadKeys: ['current_run_id'],
      onlyIfStatus: ['in_progress', 'queued'],
      where: { sql: 'pr_merged_at IS NULL AND trigger_source = $1', params: ['v4_bridge'] },
      returning: ['goal_id', 'pr_url'],
    });
    expect(sql).toContain('error_message = $1');
    expect(sql).toContain('pr_status = $2');
    expect(sql).toContain('result = $3::jsonb');
    expect(sql).toContain('pr_url = COALESCE(pr_url, $4)');
    expect(sql).toContain("payload = (COALESCE(payload, '{}'::jsonb) || $5::jsonb) - 'current_run_id'");
    expect(sql).toContain("result = COALESCE(result, '{}'::jsonb) || $6::jsonb");
    expect(sql).toContain('WHERE id = $7 AND status IN ($8, $9) AND (pr_merged_at IS NULL AND trigger_source = $10)');
    expect(sql).toMatch(/RETURNING id, status, goal_id, pr_url$/);
    expect(params).toEqual(['boom', 'merged', JSON.stringify({ a: 1 }), 'https://x/pr/1', JSON.stringify({ run_status: 'merged' }), JSON.stringify({ receipt: { ok: true } }), ID, 'in_progress', 'queued', 'v4_bridge']);
  });

  it('set.result=null → result = NULL；idCast text → id::text；onlyIfStatusNot → NOT IN', () => {
    const { sql, params } = buildTerminalUpdate('init-123', 'completed', { set: { result: null }, idCast: 'text', onlyIfStatusNot: 'completed' });
    expect(sql).toContain('result = NULL');
    expect(sql).toContain('WHERE id::text = $1 AND status NOT IN ($2)');
    expect(params).toEqual(['init-123', 'completed']);
  });

  it('无 taskId 时必须给 where；非终态 / 非白名单列 / 非法 drop 键 → throw', () => {
    expect(() => buildTerminalUpdate(null, 'completed')).toThrow(/taskId|where/);
    expect(() => buildTerminalUpdate(ID, 'queued')).toThrow(/终态|terminal/);
    expect(() => buildTerminalUpdate(ID, 'failed', { set: { title: 'x' } })).toThrow(/白名单|column/);
    expect(() => buildTerminalUpdate(ID, 'failed', { dropPayloadKeys: ["x' OR 1=1"] })).toThrow(/dropPayloadKeys/);
    const { sql } = buildTerminalUpdate(null, 'completed', { where: { sql: 'id = (SELECT current_task_id FROM initiative_runs WHERE id = $1::uuid)', params: ['r1'] } });
    expect(sql).toContain('WHERE (id = (SELECT current_task_id FROM initiative_runs WHERE id = $1::uuid))');
  });
});

describe('finalizeTask', () => {
  it('completed → 写库后对每一行调接棒（deps 注入），返回 rowCount/task/relay', async () => {
    const db = { query: vi.fn(async () => ({ rowCount: 1, rows: [{ id: ID, status: 'completed' }] })) };
    const relayOnComplete = vi.fn(async () => ({ synthesized: true, tasks: [{ id: 't1' }], decisions: [], skipped: [] }));
    const out = await finalizeTask(db, ID, 'completed', { sessionId: 's1', deps: { relayOnComplete } });
    expect(db.query).toHaveBeenCalledTimes(1);
    expect(db.query.mock.calls[0][0]).toMatch(/^UPDATE tasks SET status = 'completed'/);
    expect(relayOnComplete).toHaveBeenCalledWith(db, ID, { sessionId: 's1' });
    expect(out).toMatchObject({ rowCount: 1, task: { id: ID }, relay: { relayed: true, relay: { synthesized: true } } });
  });

  it('completed_no_pr 也接棒；failed 不接棒；relay:false 不接棒；CAS 未命中（0 行）不接棒', async () => {
    const relayOnComplete = vi.fn(async () => ({ tasks: [], decisions: [], skipped: [] }));
    const hit = { query: vi.fn(async () => ({ rowCount: 1, rows: [{ id: ID, status: 'completed_no_pr' }] })) };
    await finalizeTask(hit, ID, 'completed_no_pr', { deps: { relayOnComplete } });
    expect(relayOnComplete).toHaveBeenCalledTimes(1);

    await finalizeTask(hit, ID, 'failed', { deps: { relayOnComplete } });
    expect(relayOnComplete).toHaveBeenCalledTimes(1);

    await finalizeTask(hit, ID, 'completed', { relay: false, deps: { relayOnComplete } });
    expect(relayOnComplete).toHaveBeenCalledTimes(1);

    const miss = { query: vi.fn(async () => ({ rowCount: 0, rows: [] })) };
    const out = await finalizeTask(miss, ID, 'completed', { deps: { relayOnComplete } });
    expect(relayOnComplete).toHaveBeenCalledTimes(1);
    expect(out).toMatchObject({ rowCount: 0, task: null, relay: null });
  });

  it('多行命中（无 id 的 where）→ 每行各接棒一次；relayDb 优先于写库句柄（事务内写、事务外接棒）', async () => {
    const client = { query: vi.fn(async () => ({ rowCount: 2, rows: [{ id: 'a', status: 'completed' }, { id: 'b', status: 'completed' }] })) };
    const pool = { query: vi.fn() };
    const relayOnComplete = vi.fn(async () => ({ tasks: [], decisions: [], skipped: [] }));
    const out = await finalizeTask(client, null, 'completed', { where: { sql: "payload->>'run_id' = $1", params: ['r'] }, relayDb: pool, deps: { relayOnComplete } });
    expect(relayOnComplete.mock.calls.map((c) => [c[0], c[1]])).toEqual([[pool, 'a'], [pool, 'b']]);
    expect(out.relays).toHaveLength(2);
  });
});

describe('afterTerminalTransition', () => {
  it('completed / completed_no_pr 接棒；failed / archived / 非终态返回 relayed:false', async () => {
    const relayOnComplete = vi.fn(async () => ({ tasks: [], decisions: [], skipped: [] }));
    expect(isRelayTerminalStatus('completed_no_pr')).toBe(true);
    expect((await afterTerminalTransition({}, ID, 'completed_no_pr', { deps: { relayOnComplete } })).relayed).toBe(true);
    expect(await afterTerminalTransition({}, ID, 'failed', { deps: { relayOnComplete } })).toEqual({ relayed: false, reason: 'non_relay_terminal' });
    expect(await afterTerminalTransition({}, ID, 'archived', { deps: { relayOnComplete } })).toEqual({ relayed: false, reason: 'non_relay_terminal' });
    expect(await afterTerminalTransition({}, ID, 'queued', { deps: { relayOnComplete } })).toEqual({ relayed: false, reason: 'not_terminal' });
    expect(relayOnComplete).toHaveBeenCalledTimes(1);
  });

  it('接棒抛错 → 吞成 warn，返回 relayed:false 带 error，不冒泡', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const relayOnComplete = vi.fn(async () => { throw new Error('relay boom'); });
    const out = await afterTerminalTransition({}, ID, 'completed', { deps: { relayOnComplete } });
    expect(out).toEqual({ relayed: false, reason: 'relay_error', error: 'relay boom' });
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});
