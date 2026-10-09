/**
 * 依赖单一写口 lib/task-dependencies.js（链 bf5088a3 棒5，任务 3fad28e0）。
 * task_dependencies 为边真列，payload.depends_on 是派发/级联的读侧兼容，只由本模块同步写。
 */
import { describe, it, expect, vi } from 'vitest';
import {
  addTaskDependency,
  addTaskDependencies,
  removeTaskDependency,
  insertEdgeRow,
  TaskDependencyError,
} from '../task-dependencies.js';

const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';
const C = '33333333-3333-4333-8333-333333333333';

function makeDb({ existing = [A, B], cycle = false, inserted = 1 } = {}) {
  return {
    query: vi.fn(async (sql) => {
      if (/SELECT id FROM tasks WHERE id = ANY/.test(sql)) return { rows: existing.map((id) => ({ id })) };
      if (/WITH RECURSIVE/.test(sql)) return { rows: cycle ? [{ hit: 1 }] : [] };
      if (/INSERT INTO task_dependencies/.test(sql)) return { rowCount: inserted, rows: [] };
      if (/DELETE FROM task_dependencies/.test(sql)) return { rowCount: 1, rows: [] };
      return { rowCount: 1, rows: [] };
    }),
  };
}
const sqls = (db) => db.query.mock.calls.map(([s]) => String(s));

describe('addTaskDependency', () => {
  it('违规输入被拒：自环（from==to）→ dependency_self_loop，不查库', async () => {
    const db = makeDb();
    const err = await addTaskDependency(db, { fromTaskId: A, toTaskId: A }).catch((e) => e);
    expect(err).toBeInstanceOf(TaskDependencyError);
    expect(err.code).toBe('dependency_self_loop');
    expect(db.query).not.toHaveBeenCalled();
  });

  it('违规输入被拒：非 uuid → invalid_task_id', async () => {
    const err = await addTaskDependency(makeDb(), { fromTaskId: 'x', toTaskId: B }).catch((e) => e);
    expect(err.code).toBe('invalid_task_id');
  });

  it('违规输入被拒：edge_type 非 hard|soft → invalid_edge_type', async () => {
    const err = await addTaskDependency(makeDb(), { fromTaskId: A, toTaskId: B, edgeType: 'weird' }).catch((e) => e);
    expect(err.code).toBe('invalid_edge_type');
  });

  it('违规输入被拒：任一端任务不存在 → dependency_task_not_found（带 missing）', async () => {
    const db = makeDb({ existing: [A] });
    const err = await addTaskDependency(db, { fromTaskId: A, toTaskId: B }).catch((e) => e);
    expect(err.code).toBe('dependency_task_not_found');
    expect(err.details.missing).toEqual([B]);
    expect(sqls(db).some((s) => /INSERT INTO task_dependencies/.test(s))).toBe(false);
  });

  it('违规输入被拒：会成环（to 已可达 from）→ dependency_cycle，不写边', async () => {
    const db = makeDb({ cycle: true });
    const err = await addTaskDependency(db, { fromTaskId: A, toTaskId: B }).catch((e) => e);
    expect(err.code).toBe('dependency_cycle');
    expect(sqls(db).some((s) => /INSERT INTO task_dependencies/.test(s))).toBe(false);
  });

  it('hard 边：写边 + 同步 payload.depends_on', async () => {
    const db = makeDb();
    const r = await addTaskDependency(db, { fromTaskId: A, toTaskId: B });
    expect(r).toEqual({ added: true });
    expect(sqls(db).some((s) => /INSERT INTO task_dependencies/.test(s))).toBe(true);
    const upd = db.query.mock.calls.find(([s]) => /UPDATE tasks/.test(s) && /depends_on/.test(s));
    expect(upd).toBeTruthy();
    expect(upd[1]).toEqual(expect.arrayContaining([A, B]));
  });

  it('soft 边：只写边，不动 payload.depends_on（软依赖不阻塞派发）', async () => {
    const db = makeDb();
    await addTaskDependency(db, { fromTaskId: A, toTaskId: B, edgeType: 'soft' });
    expect(sqls(db).some((s) => /UPDATE tasks/.test(s))).toBe(false);
  });

  it('边已存在（ON CONFLICT 不插入）→ added=false，且仍幂等补 payload', async () => {
    const db = makeDb({ inserted: 0 });
    const r = await addTaskDependency(db, { fromTaskId: A, toTaskId: B });
    expect(r).toEqual({ added: false });
  });

  it('verify=false / syncPayload=false（harness-dag 虚拟 uuid 审计边）→ 只 INSERT 边', async () => {
    const db = makeDb({ existing: [] });
    await addTaskDependency(db, { fromTaskId: A, toTaskId: B, verify: false, syncPayload: false, checkCycle: false });
    expect(sqls(db)).toHaveLength(1);
    expect(sqls(db)[0]).toMatch(/INSERT INTO task_dependencies/);
  });
});

describe('addTaskDependencies（批量）', () => {
  it('一次校验存在性，逐条写边', async () => {
    const db = makeDb({ existing: [A, B, C] });
    const r = await addTaskDependencies(db, A, [B, C]);
    expect(r.added).toBe(2);
    expect(sqls(db).filter((s) => /INSERT INTO task_dependencies/.test(s))).toHaveLength(2);
  });
});

describe('addTaskDependencies 宽松模式（createRoutedTask 内部建单用）', () => {
  it('strict=false：不存在的依赖跳过、不抛（历史调用方传脏 id 不能让建单失败）', async () => {
    const db = makeDb({ existing: [A, B] });
    const r = await addTaskDependencies(db, A, [B, C], { strict: false });
    expect(r.added).toBe(1);
    expect(r.skipped).toEqual([C]);
  });

  it('strict 默认（API 入口）：任一依赖不存在 → 抛 dependency_task_not_found', async () => {
    const db = makeDb({ existing: [A, B] });
    const err = await addTaskDependencies(db, A, [B, C]).catch((e) => e);
    expect(err.code).toBe('dependency_task_not_found');
    expect(err.details.missing).toEqual([C]);
  });
});

describe('removeTaskDependency / insertEdgeRow', () => {
  it('remove：删边并从 payload.depends_on 摘掉', async () => {
    const db = makeDb();
    const r = await removeTaskDependency(db, { fromTaskId: A, toTaskId: B });
    expect(r.removed).toBe(true);
    expect(sqls(db).some((s) => /DELETE FROM task_dependencies/.test(s))).toBe(true);
    expect(sqls(db).some((s) => /UPDATE tasks/.test(s) && /depends_on/.test(s))).toBe(true);
  });

  it('insertEdgeRow 是全仓唯一的边 INSERT 语句', async () => {
    const db = makeDb();
    await insertEdgeRow(db, A, B, 'hard');
    expect(sqls(db)[0]).toMatch(/INSERT INTO task_dependencies/);
    expect(sqls(db)[0]).toMatch(/ON CONFLICT/);
  });
});
