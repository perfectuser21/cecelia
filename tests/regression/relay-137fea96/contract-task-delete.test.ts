import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import pg from 'pg';

/**
 * Golden Path Step 1-3 — DELETE /api/brain/tasks/:id [BEHAVIOR]
 *
 * TDD Red phase: task-tasks.js 当前无 DELETE 路由，Express 落到通用 404 handler
 * （返回 HTML "Cannot DELETE ..."，不是 JSON）。本测试对已存在任务断言 200 +
 * status=cancelled，在路由未注册时必然 FAIL（真红）。
 *
 * 运行环境要求：Brain 在 localhost:5221 运行，DB 在 $DB 或 postgresql://localhost/cecelia 可访问
 * 真实调用方式：真实 HTTP DELETE + 真实 Postgres 校验（不 mock db.js pool，命中「禁 mock 边清单」
 * 第一条：packages/brain/src/routes/task-tasks.js ↔ tasks 表）
 */

const BRAIN_URL = process.env.BRAIN_URL || 'http://localhost:5221';
const DB_URL = process.env.DB || 'postgresql://localhost/cecelia';

let client: pg.Client;
let pendingTaskId: string;
let completedTaskId: string;

beforeAll(async () => {
  client = new pg.Client(DB_URL);
  await client.connect();

  const r1 = await client.query<{ id: string }>(
    `INSERT INTO tasks (task_type, status, title, payload)
     VALUES ('dev', 'pending_postdeploy', 'contract-test-delete-pending-137fea96', '{}'::jsonb)
     RETURNING id::text`
  );
  pendingTaskId = r1.rows[0].id;

  const r2 = await client.query<{ id: string }>(
    `INSERT INTO tasks (task_type, status, title, payload)
     VALUES ('dev', 'completed', 'contract-test-delete-completed-137fea96', '{}'::jsonb)
     RETURNING id::text`
  );
  completedTaskId = r2.rows[0].id;
});

afterAll(async () => {
  if (client) {
    await client.query('DELETE FROM tasks WHERE id = ANY($1::uuid[])', [
      [pendingTaskId, completedTaskId].filter(Boolean),
    ]);
    await client.end();
  }
});

describe('DELETE /api/brain/tasks/:id [BEHAVIOR]', () => {
  it('存在的非终态任务 → HTTP 200，响应 status=cancelled', async () => {
    const resp = await fetch(`${BRAIN_URL}/api/brain/tasks/${pendingTaskId}`, { method: 'DELETE' });
    expect(resp.status).toBe(200);
    const body = (await resp.json()) as Record<string, unknown>;
    expect(body.status).toBe('cancelled');
    expect(body.id).toBe(pendingTaskId);
  });

  it('DB 中该任务 status 真实变为 cancelled（真 Postgres 校验，不信任响应体自证）', async () => {
    const r = await client.query<{ status: string }>('SELECT status FROM tasks WHERE id = $1', [pendingTaskId]);
    expect(r.rows[0].status).toBe('cancelled');
  });

  it('不存在的 id → HTTP 404 + error 字段 (string)', async () => {
    const resp = await fetch(`${BRAIN_URL}/api/brain/tasks/00000000-0000-0000-0000-000000000099`, {
      method: 'DELETE',
    });
    expect(resp.status).toBe(404);
    const body = (await resp.json()) as Record<string, unknown>;
    expect(typeof body.error).toBe('string');
    expect(body.id).toBe('00000000-0000-0000-0000-000000000099');
  });

  it('已 completed 的任务 → HTTP 409，状态未被改动（防误删历史记录）', async () => {
    const resp = await fetch(`${BRAIN_URL}/api/brain/tasks/${completedTaskId}`, { method: 'DELETE' });
    expect(resp.status).toBe(409);
    const body = (await resp.json()) as Record<string, unknown>;
    expect(typeof body.error).toBe('string');
    expect(typeof body.details).toBe('string');
    const r = await client.query<{ status: string }>('SELECT status FROM tasks WHERE id = $1', [completedTaskId]);
    expect(r.rows[0].status).toBe('completed');
  });

  it('[AI_ADDED] 已 cancelled 的任务再次 DELETE → HTTP 409（幂等防重复误改，TERMINAL_STATUSES 含 cancelled）', async () => {
    // 依赖上一条用例已把 pendingTaskId 转为 cancelled
    const resp = await fetch(`${BRAIN_URL}/api/brain/tasks/${pendingTaskId}`, { method: 'DELETE' });
    expect(resp.status).toBe(409);
    const body = (await resp.json()) as Record<string, unknown>;
    expect(typeof body.error).toBe('string');
    expect(typeof body.details).toBe('string');
  });
});
