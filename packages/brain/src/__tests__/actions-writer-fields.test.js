import { describe, expect, it, vi } from 'vitest';

// actions 和 store 都是真身；只有数据库/广播边界 record-only。
const canonicalQuery = vi.hoisted(() => vi.fn(() => { throw new Error('canonical_db_forbidden'); }));
vi.mock('../db.js', () => ({ default: { query: canonicalQuery } }));
vi.mock('../task-updater.js', () => ({ broadcastTaskState: vi.fn() }));
import { createTask } from '../actions.js';

function ownedDatabase() {
  const calls = [];
  const query = vi.fn(async (sql, args = []) => {
    calls.push([String(sql), args]);
    if (/INSERT INTO tasks\s*\(/.test(sql)) return { rows: [{ id: 'owned-task', status: 'queued' }], rowCount: 1 };
    if (/INSERT INTO work_routing_receipts/.test(sql)) return { rows: [{ id: 'owned-receipt' }], rowCount: 1 };
    if (/^(SELECT|\s*SELECT|UPDATE tasks SET payload|INSERT INTO cecelia_events)/.test(sql)) return { rows: [], rowCount: 0 };
    throw new Error(`Unexpected owned query: ${sql}`);
  });
  return { query, calls };
}

function actualInsertValue(db, column) {
  const inserts = db.calls.filter(([sql]) => /INSERT INTO tasks\s*\(/.test(sql));
  expect(inserts).toHaveLength(1);
  const [sql, args] = inserts[0];
  const columns = sql.match(/INSERT INTO tasks\s*\(([\s\S]+?)\) VALUES/)[1].split(',').map(s => s.trim());
  const index = columns.indexOf(column);
  expect(index, `真实INSERT缺少${column}`).toBeGreaterThanOrEqual(0);
  return args[index];
}

describe('actions → real routed writer fields (record-only DB)', () => {
  it.each([
    [{ domain: 'quality' }, 'quality', 'vp_qa', 'code-only'],
    [{ domain: 'quality', owner_role: 'owned-role', delivery_type: 'owned-delivery' }, 'quality', 'owned-role', 'owned-delivery'],
    [{}, 'research', null, 'code-only'],
  ])('按真实INSERT列名绑定，不从测试双身推导SQL %#', async (input, domain, owner, delivery) => {
    const db = ownedDatabase();
    const result = await createTask({ title: '普通事项', task_type: 'research', source: 'api', source_id: 'owned-fields', db, ...input });
    expect(result.success).toBe(true);
    expect(actualInsertValue(db, 'domain')).toBe(domain);
    expect(actualInsertValue(db, 'owner_role')).toBe(owner);
    expect(actualInsertValue(db, 'delivery_type')).toBe(delivery);
    expect(db.calls.some(([sql]) => /INSERT INTO work_routing_receipts/.test(sql))).toBe(true);
    expect(canonicalQuery).not.toHaveBeenCalled();
  });
});
