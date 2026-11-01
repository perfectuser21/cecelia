import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Only external I/O is replaced: real triage, createTask and work routing run.
vi.mock('../../db.js', () => ({ default: { query: () => { throw new Error('Unexpected global DB access'); } } }));
vi.mock('../../llm-caller.js', () => ({ callLLM: () => { throw new Error('Unexpected model call'); } }));
vi.mock('../../notifier.js', () => ({ sendBark: vi.fn().mockResolvedValue(undefined) }));

import { runCaptureTriage, __resetCaptureTriageForTest } from '../../capture-triage.js';
import { sendBark } from '../../notifier.js';

function database(atom, failOn = '') {
  const calls = [];
  const query = async (sql, params = []) => {
    calls.push({ sql, params });
    if (failOn && sql.includes(failOn)) throw new Error('fixture write failed');
    if (sql.includes('FROM capture_atoms')) return { rows: [atom] };
    if (sql.includes('FROM map_scope_repositories') && !sql.includes('WITH authoritative_scope')) {
      return { rows: [{ scope_key: 'cecelia', repo: 'cecelia', adapter_config: {} }] };
    }
    if (sql.includes('WITH authoritative_scope')) return { rows: [{ node_key: 'F1' }] };
    if (sql.includes('INSERT INTO side_effect_dedupe')) return { rowCount: 1, rows: [{ id: 'dedupe-1' }] };
    if (sql.includes('INSERT INTO tasks')) return { rows: [{ id: 'task-1', title: params[0], task_type: params[3] }] };
    if (sql.includes('INSERT INTO work_routing_receipts')) return { rows: [{ id: 'receipt-1' }] };
    if (sql.includes('INSERT INTO notes')) return { rows: [{ id: 'note-1' }] };
    if (/^SELECT/.test(sql.trim()) || sql.includes('FROM tasks')) return { rows: [] };
    if (/^(BEGIN|COMMIT|ROLLBACK|UPDATE|INSERT|DELETE)/.test(sql.trim())) return { rows: [], rowCount: 1 };
    throw new Error(`Unexpected SQL: ${sql}`);
  };
  const client = { query, release: vi.fn() };
  // Pool and transaction writes are separately recorded to catch lost atomicity.
  const outside = [];
  const pool = {
    query: async (sql, params) => { outside.push(sql); return query(sql, params); },
    connect: async () => client,
  };
  return { pool, calls, outside, client };
}
const urgent = { id: 'atom-urgent', content: '解析函数在空输入下崩溃', target_type: 'issue', target_subtype: 'P0' };
const okr = { id: 'atom-okr', content: '下一季度提高获客质量', target_type: 'learning', target_subtype: 'note' };
const llm = async () => ({ text: '{"route":"okr","confidence":0.9,"reason":"季度目标"}' });

beforeEach(() => {
  __resetCaptureTriageForTest();
  vi.clearAllMocks();
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());

describe('FR-5: urgent 路由 → 真实 task + Bark', () => {
  it('urgent 路由后 atom 包含 routed_to_table + routed_to_id，且事务提交后才通知', async () => {
    const db = database(urgent);
    let committedAtNotification = false;
    vi.mocked(sendBark).mockImplementationOnce(async () => {
      committedAtNotification = db.calls.some(call => call.sql === 'COMMIT');
    });
    expect(await runCaptureTriage(db.pool)).toEqual({ processed: 1, failed: 0 });
    const task = db.calls.find(call => call.sql.includes('INSERT INTO tasks'));
    expect(task.params.slice(0, 5)).toEqual(['[紧急] 解析函数在空输入下崩溃', '来源: capture_atoms urgent路由, atom_id=atom-urgent\n\n解析函数在空输入下崩溃', 'P1', 'harness_initiative', 'queued']);
    expect(JSON.parse(task.params[9])).toMatchObject({ mode: 'headed', headed_manual: 'true', repo: 'cecelia', map_scope: ['F1'] });
    const update = db.calls.find(call => call.sql.startsWith('UPDATE capture_atoms'));
    expect(update.params).toEqual(['atom-urgent', '[triage:urgent] task=task-1. ', 'tasks', 'task-1', 1]);
    expect(update.sql).toContain("status = 'confirmed'");
    expect(db.outside).toHaveLength(1);
    expect(db.calls.filter(call => ['BEGIN', 'COMMIT', 'ROLLBACK'].includes(call.sql)).map(call => call.sql)).toEqual(['BEGIN', 'COMMIT']);
    expect(sendBark).toHaveBeenCalledWith('[Cecelia] 紧急进箱: 解析函数在空输入下崩溃');
    expect(committedAtNotification).toBe(true);
    expect(db.client.release).toHaveBeenCalledOnce();
  });

  it.each(['生产环境修改', 'Production 数据库修改', 'prod env 切换', 'LLM渠道切换'])(
    '生产护栏命中 %s → 仅通知，不创建任务、不写目标回链', async content => {
      const db = database({ ...urgent, content });
      expect(await runCaptureTriage(db.pool)).toEqual({ processed: 1, failed: 0 });
      expect(db.calls.some(call => call.sql.includes('INSERT INTO tasks'))).toBe(false);
      expect(db.calls.some(call => call.sql === 'BEGIN')).toBe(false);
      const update = db.calls.find(call => call.sql.startsWith('UPDATE capture_atoms'));
      expect(update.params).toEqual(['atom-urgent', '[triage:urgent] 生产护栏命中，仅 Bark，不建 task。', 1]);
      expect(update.sql).not.toContain('routed_to_id');
      expect(sendBark).toHaveBeenCalledOnce();
    },
  );

  it('任务 INSERT 失败 → 回滚，不确认 atom、不发送成功通知', async () => {
    const db = database(urgent, 'INSERT INTO tasks');
    expect(await runCaptureTriage(db.pool)).toEqual({ processed: 1, failed: 1 });
    expect(db.calls.filter(call => ['BEGIN', 'COMMIT', 'ROLLBACK'].includes(call.sql)).map(call => call.sql)).toEqual(['BEGIN', 'ROLLBACK']);
    expect(db.calls.some(call => call.sql.startsWith('UPDATE capture_atoms'))).toBe(false);
    expect(sendBark).not.toHaveBeenCalled();
    expect(db.client.release).toHaveBeenCalledOnce();
  });
});

describe('FR-6: okr 路由 → notes 表', () => {
  it('okr 路由 atom → notes strategic_input，并在同一事务写回 notes 回链', async () => {
    const db = database(okr);
    expect(await runCaptureTriage(db.pool, { llm })).toEqual({ processed: 1, failed: 0 });
    const note = db.calls.find(call => call.sql.includes('INSERT INTO notes'));
    expect(note.sql).toContain("'strategic_input', 'capture_triage'");
    expect(note.params).toEqual(['下一季度提高获客质量', '季度目标']);
    const update = db.calls.find(call => call.sql.startsWith('UPDATE capture_atoms'));
    expect(update.params).toEqual(['atom-okr', '[triage:okr] note=note-1. 季度目标', 'notes', 'note-1', 0.9]);
    expect(update.sql).toContain("status = 'confirmed'");
    expect(db.outside).toHaveLength(1);
    expect(db.calls.filter(call => ['BEGIN', 'COMMIT', 'ROLLBACK'].includes(call.sql)).map(call => call.sql)).toEqual(['BEGIN', 'COMMIT']);
    expect(sendBark).not.toHaveBeenCalled();
  });

  it('notes INSERT 失败 → 回滚且 atom 不更新', async () => {
    const db = database(okr, 'INSERT INTO notes');
    expect(await runCaptureTriage(db.pool, { llm })).toEqual({ processed: 1, failed: 1 });
    expect(db.calls.filter(call => ['BEGIN', 'COMMIT', 'ROLLBACK'].includes(call.sql)).map(call => call.sql)).toEqual(['BEGIN', 'ROLLBACK']);
    expect(db.calls.some(call => call.sql.startsWith('UPDATE capture_atoms'))).toBe(false);
    expect(db.client.release).toHaveBeenCalledOnce();
  });

  it('回链 UPDATE 失败 → 先前 notes INSERT 也必须处于回滚事务', async () => {
    const db = database(okr, 'UPDATE capture_atoms');
    expect(await runCaptureTriage(db.pool, { llm })).toEqual({ processed: 1, failed: 1 });
    expect(db.calls.filter(call => ['BEGIN', 'COMMIT', 'ROLLBACK'].includes(call.sql)).map(call => call.sql)).toEqual(['BEGIN', 'ROLLBACK']);
    expect(db.outside).toHaveLength(1);
  });
});
