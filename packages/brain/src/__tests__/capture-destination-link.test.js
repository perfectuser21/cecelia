/**
 * capture-destination-link.test.js
 * F6-S3 真断言：capture 去向链双向验证
 * - backlinks 含 navigate_url（tasks/golden_paths/journeys）
 * - done API 返回 navigate_url 并写 done_at
 * - aging 哨兵返回超期 captures
 */

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import { Router } from 'express';

// ── 构造 mock pool ──────────────────────────────────────────────────────────

const MOCK_CAPTURE = {
  id: 'aaa00000-0000-0000-0000-000000000001',
  content: '测试内容',
  source: 'harness',
  nature: 'learning',
  repo: null,
  lane: null,
  ref_task_id: null,
  ref_journey_id: null,
  ref_pr_url: null,
  dedupe_key: 'test-dk-001',
  status: 'clarified',
  done_at: null,
  created_at: new Date('2020-01-01').toISOString(),
  updated_at: new Date('2020-01-01').toISOString(),
};

const MOCK_ATOM_TASK = {
  id: 'bbb00000-0000-0000-0000-000000000001',
  content: '测试内容',
  target_type: 'learning',
  target_subtype: null,
  status: 'confirmed',
  ai_reason: '[triage:line_backlog] 自动建 task',
  routed_to_table: 'tasks',
  routed_to_id: 'ccc00000-0000-0000-0000-000000000001',
  confidence: 0.9,
  retry_count: 0,
  created_at: new Date('2020-01-01').toISOString(),
  updated_at: new Date('2020-01-01').toISOString(),
};

const MOCK_ATOM_GP = {
  ...MOCK_ATOM_TASK,
  id: 'bbb00000-0000-0000-0000-000000000002',
  routed_to_table: 'golden_paths',
  routed_to_id: 'ddd00000-0000-0000-0000-000000000001',
  ai_reason: '[triage:capability] 收编 GP 候选',
};

function makeMockPool(overrides = {}) {
  const defaults = {
    captureRow: MOCK_CAPTURE,
    atomRows: [MOCK_ATOM_TASK],
    doneRow: { id: MOCK_CAPTURE.id, status: 'done', done_at: new Date().toISOString() },
    agingRows: [],
  };
  const cfg = { ...defaults, ...overrides };

  return {
    query: vi.fn(async (sql) => {
      const s = sql.trim().toUpperCase();
      if (s.startsWith('SELECT') && s.includes('FROM CAPTURES WHERE')) {
        return { rows: cfg.captureRow ? [cfg.captureRow] : [] };
      }
      if (s.startsWith('SELECT') && s.includes('FROM CAPTURE_ATOMS')) {
        return { rows: cfg.atomRows };
      }
      if (s.startsWith('UPDATE CAPTURES')) {
        return { rows: cfg.doneRow ? [cfg.doneRow] : [] };
      }
      if (s.includes('INSERT INTO CAPTURES')) {
        return { rows: [{ id: 'new-001', status: 'captured', dedupe_key: null, created_at: new Date().toISOString() }] };
      }
      if (s.includes('COUNT(*)')) {
        return { rows: [{ captured: '1', clarified: '0', done: '0', dropped: '0', count: '1' }] };
      }
      if (s.includes('NOW() - ')) {
        return { rows: cfg.agingRows };
      }
      return { rows: [] };
    }),
  };
}

async function buildApp(pool) {
  // 动态 mock db.js（vitest 路径隔离）
  vi.doMock('../db.js', () => ({ default: pool }));
  const { default: capturesRouter } = await import('../routes/captures.js');
  const app = express();
  app.use(express.json());
  app.use('/api/brain/captures', capturesRouter);
  return app;
}

// ── 测试组 ──────────────────────────────────────────────────────────────────

describe('capture-destination-link: GET /:id backlinks with navigate_url', () => {
  it('tasks 路由 → navigate_url=/tasks/:id/prd', async () => {
    const pool = makeMockPool({ atomRows: [MOCK_ATOM_TASK] });
    const app = await buildApp(pool);

    const res = await request(app)
      .get(`/api/brain/captures/${MOCK_CAPTURE.id}`)
      .expect(200);

    expect(res.body.backlinks).toHaveLength(1);
    expect(res.body.backlinks[0].navigate_url).toBe(`/tasks/${MOCK_ATOM_TASK.routed_to_id}/prd`);
  });

  it('golden_paths 路由 → navigate_url=/warroom/gp/:id', async () => {
    const pool = makeMockPool({ atomRows: [MOCK_ATOM_GP] });
    const app = await buildApp(pool);

    const res = await request(app)
      .get(`/api/brain/captures/${MOCK_CAPTURE.id}`)
      .expect(200);

    expect(res.body.backlinks[0].navigate_url).toBe(`/warroom/gp/${MOCK_ATOM_GP.routed_to_id}`);
  });

  it('无 routed atom → backlinks 为空', async () => {
    const pool = makeMockPool({ atomRows: [] });
    const app = await buildApp(pool);

    const res = await request(app)
      .get(`/api/brain/captures/${MOCK_CAPTURE.id}`)
      .expect(200);

    expect(res.body.backlinks).toHaveLength(0);
  });
});

describe('capture-destination-link: PATCH /:id/done', () => {
  it('归位完成写 done_at，tasks 路由返回 navigate_url', async () => {
    const pool = makeMockPool({ atomRows: [MOCK_ATOM_TASK] });
    const app = await buildApp(pool);

    const res = await request(app)
      .patch(`/api/brain/captures/${MOCK_CAPTURE.id}/done`)
      .expect(200);

    expect(res.body.status).toBe('done');
    expect(res.body.done_at).toBeTruthy();
    expect(res.body.navigate_url).toBe(`/tasks/${MOCK_ATOM_TASK.routed_to_id}/prd`);
  });

  it('无路由 atom → navigate_url 为 null', async () => {
    const pool = makeMockPool({ atomRows: [] });
    const app = await buildApp(pool);

    const res = await request(app)
      .patch(`/api/brain/captures/${MOCK_CAPTURE.id}/done`)
      .expect(200);

    expect(res.body.navigate_url).toBeNull();
  });
});

describe('capture-destination-link: GET /aging 账龄哨兵', () => {
  it('返回 overdue + count + threshold_days', async () => {
    const agingRow = {
      id: MOCK_CAPTURE.id,
      content: '超期内容',
      source: 'harness',
      status: 'captured',
      created_at: new Date('2020-01-01').toISOString(),
      age_days: 30,
    };
    const pool = makeMockPool({ agingRows: [agingRow] });
    const app = await buildApp(pool);

    const res = await request(app)
      .get('/api/brain/captures/aging?days=7')
      .expect(200);

    expect(res.body).toHaveProperty('overdue');
    expect(res.body).toHaveProperty('count');
    expect(res.body.threshold_days).toBe(7);
  });
});
