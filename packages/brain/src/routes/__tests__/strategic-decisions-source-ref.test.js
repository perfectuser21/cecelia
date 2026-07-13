/**
 * POST /api/brain/strategic-decisions — source_ref 写入口 [BEHAVIOR]
 *
 * 刀B judgments 对账地基：harness judge 机械闸按
 * decisions WHERE category='judgment' AND source_ref=<task_id> 对账
 * judgments_written 声明，前提是 POST / 能把 source_ref 落进 INSERT。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockQuery = vi.hoisted(() => vi.fn());
vi.mock('../../db.js', () => ({ default: { query: mockQuery } }));

const { default: router } = await import('../strategic-decisions.js');

function findHandler(method, path) {
  const layer = router.stack.find(
    (l) => l.route && l.route.path === path && l.route.methods[method]
  );
  return layer.route.stack[layer.route.stack.length - 1].handle;
}

function mockRes() {
  const res = { statusCode: 200 };
  res.status = vi.fn((c) => { res.statusCode = c; return res; });
  res.json = vi.fn((b) => { res.body = b; return res; });
  return res;
}

describe('POST /strategic-decisions source_ref 写入口（刀B judgments 对账地基）', () => {
  beforeEach(() => {
    mockQuery.mockReset();
    mockQuery.mockResolvedValue({ rows: [{ id: 'x' }] });
  });

  it('body 带 source_ref → INSERT 列含 source_ref 且参数透传', async () => {
    const handler = findHandler('post', '/');
    const res = mockRes();
    await handler({ body: { topic: 't', decision: 'd', category: 'judgment', source_ref: 'task-abc' } }, res);
    const call = mockQuery.mock.calls.find(([sql]) => /INSERT INTO decisions/.test(sql));
    expect(call).toBeTruthy();
    expect(call[0]).toMatch(/source_ref/);
    expect(call[1]).toContain('task-abc');
  });

  it('body 不带 source_ref → 参数为 null，不报错', async () => {
    const handler = findHandler('post', '/');
    const res = mockRes();
    await handler({ body: { topic: 't', decision: 'd' } }, res);
    const call = mockQuery.mock.calls.find(([sql]) => /INSERT INTO decisions/.test(sql));
    expect(call[0]).toMatch(/source_ref/);
    expect(call[1]).toContain(null);
  });
});
