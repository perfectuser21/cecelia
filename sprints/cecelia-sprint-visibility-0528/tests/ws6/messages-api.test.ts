import { describe, it, expect } from 'vitest';
import { randomUUID } from 'node:crypto';

// harness-v5-checks 在 CI 里把 Brain 起在 5221；本地自验可用 BRAIN_URL 覆盖到备用端口
const BRAIN_URL = process.env.BRAIN_URL || 'http://localhost:5221';

// brain-unit CI 不启动 Brain，网络连接失败时跳过所有测试
let BRAIN_AVAILABLE = false;
try {
  const r = await fetch(`${BRAIN_URL}/api/brain/health`, { signal: AbortSignal.timeout(2000) });
  BRAIN_AVAILABLE = r.ok;
} catch { BRAIN_AVAILABLE = false; }
const msgUrl = (init: string, sub: string) =>
  `${BRAIN_URL}/api/brain/harness/messages/${init}/${sub}`;

// harness_messages 表由 WS1 migration（PR #3162）提供。表未就绪时：
//   - GET 优雅降级为 { messages: [] }（200，绝不 404/500）
//   - POST 返回 503（依赖未就绪，类比 WS1 Notion 不可达的 502）
// 表就绪后（生产 / #3162 合并后）POST 返回 201，round-trip 被完整断言。

describe.skipIf(!BRAIN_AVAILABLE)('Workstream 6 — Harness Messages API [BEHAVIOR]', () => {
  it('GET 不存在的 initiativeId 返回 200 + {messages: []}（不是 404）', async () => {
    const resp = await fetch(msgUrl(randomUUID(), 'ws6'));
    expect(resp.status).toBe(200);
    const body: any = await resp.json();
    expect(Array.isArray(body.messages)).toBe(true);
    expect(body.messages).toEqual([]);
  });

  it('GET 响应顶层 keys 完全等于 ["messages"]，无禁用字段 data/items/results/payload/list', async () => {
    const resp = await fetch(msgUrl(randomUUID(), 'ws6'));
    expect(resp.status).toBe(200);
    const body: any = await resp.json();
    expect(Object.keys(body)).toEqual(['messages']);
    for (const banned of ['data', 'items', 'results', 'payload', 'list']) {
      expect(banned in body).toBe(false);
    }
  });

  it('POST 缺 message 字段返回 4xx', async () => {
    const resp = await fetch(msgUrl(randomUUID(), 'ws6'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    expect(resp.status).toBeGreaterThanOrEqual(400);
    expect(resp.status).toBeLessThan(500);
  });

  it('POST 端点已注册（非 404），合法请求返回 201 或 503（表未就绪）', async () => {
    const resp = await fetch(msgUrl(randomUUID(), 'ws6'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: 'hello ws6' }),
    });
    expect([201, 503]).toContain(resp.status);
  });

  it('POST 返回 201 时 schema 为 {id, message, created_at}，keys 完全相等，无禁用字段 data/result/payload/body', async () => {
    const resp = await fetch(msgUrl(randomUUID(), 'ws6'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: 'schema-check-ws6' }),
    });
    if (resp.status === 201) {
      const body: any = await resp.json();
      expect(typeof body.id).toBe('string');
      expect(body.message).toBe('schema-check-ws6');
      expect('created_at' in body).toBe(true);
      expect(Object.keys(body).sort()).toEqual(['created_at', 'id', 'message']);
      for (const banned of ['data', 'result', 'payload', 'body']) {
        expect(banned in body).toBe(false);
      }
    }
    expect([201, 503]).toContain(resp.status);
  });

  it('POST 后 GET 能读回同一条消息，consumed_at = null', async () => {
    const initiativeId = randomUUID();
    const subTaskId = 'ws6';
    const unique = `roundtrip-${randomUUID()}`;
    const postResp = await fetch(msgUrl(initiativeId, subTaskId), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: unique }),
    });
    expect([201, 503]).toContain(postResp.status);
    if (postResp.status === 201) {
      const getResp = await fetch(msgUrl(initiativeId, subTaskId));
      expect(getResp.status).toBe(200);
      const body: any = await getResp.json();
      expect(Array.isArray(body.messages)).toBe(true);
      const found = body.messages.find((m: any) => m.message === unique);
      expect(found).toBeTruthy();
      expect(found.consumed_at).toBeNull();
    }
  });
});
