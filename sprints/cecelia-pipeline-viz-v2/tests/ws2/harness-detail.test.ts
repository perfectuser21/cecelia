import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import pg from 'pg';

/**
 * WS2 — Brain GET /api/brain/harness/initiative/:id/detail [BEHAVIOR]
 *
 * TDD Red phase: 端点在 WS2 实现前不存在。
 * Brain 通用 404 handler 对任何路径返回 {"error":"Not Found"}。
 * 对真实 initiative（已在 DB 中）调用 /detail 预期返回 200 — 这在端点未注册时 FAIL（真红）。
 *
 * 运行环境要求：Brain 在 localhost:5221 运行，DB 在 $DB 或 postgresql://localhost/cecelia 可访问
 */

const BRAIN_URL = 'http://localhost:5221';
const DB_URL = process.env.DB || 'postgresql://localhost/cecelia';

let testTaskId: string | null = null;
let client: pg.Client | null = null;

beforeAll(async () => {
  client = new pg.Client(DB_URL);
  await client.connect();
  const res = await client.query<{ id: string }>(
    `INSERT INTO tasks (task_type, status, title, payload)
     VALUES ('harness_initiative', 'completed', 'test-detail-ws2-tdd', '{}'::jsonb)
     RETURNING id::text`
  );
  testTaskId = res.rows[0].id;
});

afterAll(async () => {
  if (testTaskId && client) {
    await client.query('DELETE FROM tasks WHERE id = $1::uuid', [testTaskId]);
  }
  if (client) await client.end();
});

describe('WS2 — GET /api/brain/harness/initiative/:id/detail [BEHAVIOR]', () => {
  it('已存在 initiative 返回 HTTP 200（端点未注册时 Brain 404 → 真红）', async () => {
    const resp = await fetch(`${BRAIN_URL}/api/brain/harness/initiative/${testTaskId}/detail`);
    // 端点未注册时：Brain 通用 404 → status=404 → 断言 toBe(200) FAIL → 真红 ✓
    // 端点注册后：返回 200 → PASS ✓
    expect(resp.status).toBe(200);
  });

  it('响应 JSON 含 initiative_id (string)', async () => {
    const resp = await fetch(`${BRAIN_URL}/api/brain/harness/initiative/${testTaskId}/detail`);
    expect(resp.status).toBe(200);
    const body = await resp.json() as Record<string, unknown>;
    expect(typeof body.initiative_id).toBe('string');
    expect(body.initiative_id).toBe(testTaskId);
  });

  it('响应含 step_timing (array) 和 screenshot_urls (array)', async () => {
    const resp = await fetch(`${BRAIN_URL}/api/brain/harness/initiative/${testTaskId}/detail`);
    expect(resp.status).toBe(200);
    const body = await resp.json() as Record<string, unknown>;
    expect(Array.isArray(body.step_timing)).toBe(true);
    expect(Array.isArray(body.screenshot_urls)).toBe(true);
  });

  it('schema 完整性 — 顶层 keys 完全等于 PRD 定义 6 字段（字母升序）', async () => {
    const resp = await fetch(`${BRAIN_URL}/api/brain/harness/initiative/${testTaskId}/detail`);
    expect(resp.status).toBe(200);
    const body = await resp.json() as Record<string, unknown>;
    const actualKeys = Object.keys(body).sort();
    const expectedKeys = ['contract_content', 'gan_rounds', 'initiative_id', 'prd_content', 'screenshot_urls', 'step_timing'];
    expect(actualKeys).toEqual(expectedKeys);
  });

  it('禁用字段不出现（steps/timeline/result/data/details/info/report）', async () => {
    const resp = await fetch(`${BRAIN_URL}/api/brain/harness/initiative/${testTaskId}/detail`);
    expect(resp.status).toBe(200);
    const body = await resp.json() as Record<string, unknown>;
    const bannedFields = ['steps', 'timeline', 'result', 'data', 'details', 'info', 'report'];
    for (const field of bannedFields) {
      expect(body).not.toHaveProperty(field);
    }
  });

  it('prd_content/contract_content 为 string|null，gan_rounds 为 number|null', async () => {
    const resp = await fetch(`${BRAIN_URL}/api/brain/harness/initiative/${testTaskId}/detail`);
    expect(resp.status).toBe(200);
    const body = await resp.json() as Record<string, unknown>;
    expect(body.prd_content === null || typeof body.prd_content === 'string').toBe(true);
    expect(body.contract_content === null || typeof body.contract_content === 'string').toBe(true);
    expect(body.gan_rounds === null || typeof body.gan_rounds === 'number').toBe(true);
  });

  it('不存在的 initiative → HTTP 404 + error 字段 (string)', async () => {
    const resp = await fetch(`${BRAIN_URL}/api/brain/harness/initiative/00000000-0000-0000-0000-000000000099/detail`);
    expect(resp.status).toBe(404);
    const body = await resp.json() as Record<string, unknown>;
    expect(typeof body.error).toBe('string');
  });
});
