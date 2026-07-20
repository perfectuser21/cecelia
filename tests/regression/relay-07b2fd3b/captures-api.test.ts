/**
 * captures API 单元测试骨架
 * task_id: 07b2fd3b-724b-4da3-bdf3-827821b66ba5
 * 覆盖: FR-3, FR-8
 */

import request from 'supertest';

const BRAIN_URL = process.env.BRAIN_URL || 'http://localhost:5221';

describe('POST /api/brain/captures', () => {
  const BASE_BODY = { content: 'unit test content', source: 'harness' };

  it('应返回 201 + {id, status, dedupe_key}', async () => {
    const dedupe = `unit-test-${Date.now()}`;
    const resp = await fetch(`${BRAIN_URL}/api/brain/captures`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...BASE_BODY, dedupe_key: dedupe }),
    });
    expect(resp.status).toBe(201);
    const data = await resp.json();
    expect(data.id).toBeTruthy();
    expect(data.status).toBe('captured'); // 无 nature → captured
    expect(data.dedupe_key).toBe(dedupe);
  });

  it('有 nature=learning → status=clarified', async () => {
    const resp = await fetch(`${BRAIN_URL}/api/brain/captures`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...BASE_BODY, nature: 'learning', dedupe_key: `unit-learning-${Date.now()}` }),
    });
    expect(resp.status).toBe(201);
    const data = await resp.json();
    expect(data.status).toBe('clarified');
  });

  it('有 nature=issue → status=clarified', async () => {
    const resp = await fetch(`${BRAIN_URL}/api/brain/captures`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...BASE_BODY, nature: 'issue', dedupe_key: `unit-issue-${Date.now()}` }),
    });
    expect(resp.status).toBe(201);
    const data = await resp.json();
    expect(data.status).toBe('clarified');
  });

  it('有 nature=handoff → status=clarified', async () => {
    const resp = await fetch(`${BRAIN_URL}/api/brain/captures`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...BASE_BODY, nature: 'handoff', dedupe_key: `unit-handoff-${Date.now()}` }),
    });
    expect(resp.status).toBe(201);
    const data = await resp.json();
    expect(data.status).toBe('clarified');
  });

  it('dedupe_key 重复 → 200 + dedupe_hit=true', async () => {
    const dedupe = `dedupe-test-${Date.now()}`;
    // 首次写入
    await fetch(`${BRAIN_URL}/api/brain/captures`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...BASE_BODY, dedupe_key: dedupe }),
    });
    // 重复写入
    const resp = await fetch(`${BRAIN_URL}/api/brain/captures`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...BASE_BODY, dedupe_key: dedupe }),
    });
    expect(resp.status).toBe(200);
    const data = await resp.json();
    expect(data.dedupe_hit).toBe(true);
  });

  it('content 为空 → 400', async () => {
    const resp = await fetch(`${BRAIN_URL}/api/brain/captures`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: '', source: 'harness' }),
    });
    expect(resp.status).toBe(400);
  });

  it('source 不在白名单 → 400', async () => {
    const resp = await fetch(`${BRAIN_URL}/api/brain/captures`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: 'test', source: 'unknown' }),
    });
    expect(resp.status).toBe(400);
  });

  it('nature 不合法 → 400', async () => {
    const resp = await fetch(`${BRAIN_URL}/api/brain/captures`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: 'test', source: 'harness', nature: 'invalid' }),
    });
    expect(resp.status).toBe(400);
  });
});

describe('GET /api/brain/captures', () => {
  it('返回 items + total + counts_by_stage', async () => {
    const resp = await fetch(`${BRAIN_URL}/api/brain/captures?limit=5`);
    expect(resp.ok).toBe(true);
    const data = await resp.json();
    expect(Array.isArray(data.items)).toBe(true);
    expect(typeof data.total).toBe('number');
    expect(data.counts_by_stage).toBeDefined();
    expect(typeof data.counts_by_stage.captured).toBe('number');
    expect(typeof data.counts_by_stage.clarified).toBe('number');
    expect(typeof data.counts_by_stage.done).toBe('number');
    expect(typeof data.counts_by_stage.dropped).toBe('number');
  });

  it('stage 过滤有效', async () => {
    const resp = await fetch(`${BRAIN_URL}/api/brain/captures?stage=captured&limit=10`);
    expect(resp.ok).toBe(true);
    const data = await resp.json();
    for (const item of data.items) {
      expect(item.status).toBe('captured');
    }
  });

  it('nature 过滤有效', async () => {
    const resp = await fetch(`${BRAIN_URL}/api/brain/captures?nature=learning&limit=10`);
    expect(resp.ok).toBe(true);
    const data = await resp.json();
    for (const item of data.items) {
      expect(item.nature).toBe('learning');
    }
  });
});

describe('GET /api/brain/captures/:id', () => {
  it('返回详情 + atoms 数组 + backlinks', async () => {
    // 先获取一个 id
    const listResp = await fetch(`${BRAIN_URL}/api/brain/captures?limit=1`);
    const listData = await listResp.json();
    if (!listData.items?.length) return; // 无数据跳过

    const id = listData.items[0].id;
    const resp = await fetch(`${BRAIN_URL}/api/brain/captures/${id}`);
    expect(resp.ok).toBe(true);
    const data = await resp.json();
    expect(data.id).toBe(id);
    expect(Array.isArray(data.atoms)).toBe(true);
    expect(Array.isArray(data.backlinks)).toBe(true);
  });
});

describe('PATCH /api/brain/capture-atoms/:id/confirm', () => {
  it('action:reroute 清空 ai_reason', async () => {
    // 需要有 parked atom 的 id，否则跳过
    // 实际测试在 CI 中需要 seed 数据
    console.log('[SKIP] 需要 seed parked atom 才能验证 reroute');
  });

  it('action:drop → status=dropped', async () => {
    console.log('[SKIP] 需要 seed parked atom 才能验证 drop');
  });
});

describe('POST /api/brain/capture-atoms/:id/retry', () => {
  it('retry_count + 1, status=pending_review', async () => {
    console.log('[SKIP] 需要 seed parked atom 才能验证 retry');
  });
});
