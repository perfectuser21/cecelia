/**
 * TDD: GET /api/brain/journey_steps/:step_id/ledger
 *
 * Product Golden Path ledger reads journey_step_links directly. It must never
 * apply Brain internal brain_modules health fields to journey_features.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockQuery = vi.fn();
vi.mock('../../db.js', () => ({ default: { query: mockQuery } }));

async function makeApp() {
  const { default: router } = await import('../journeys.js');
  const express = (await import('express')).default;
  const app = express();
  app.use(express.json());
  app.use('/api/brain', router);
  return app;
}

async function request() {
  return (await import('supertest')).default;
}

describe('GET /api/brain/journey_steps/:step_id/ledger', () => {
  beforeEach(() => mockQuery.mockReset());

  it('[JSL-1] 直接返回四区格子、NFR home 与 readiness', async () => {
    mockQuery
      .mockResolvedValueOnce({
        rows: [{
          id: 'step-1',
          name: '消息被感知',
          step_number: 1,
          promise: '数秒内看到，一条不漏、一条不重',
          journey_id: 'journey-1',
          journey_name: '智能客服 · GP-B 被动接待',
          home: 'biz',
          domain: '智能客服',
        }],
      })
      .mockResolvedValueOnce({
        rows: [
          {
            link_id: 'cell-1',
            cell_kind: 'element',
            cell_key: 'NFR',
            cell_status: 'green',
            assertion_ref: 'tests/customer-message.test.js',
            na_reason: null,
            feature_id: null,
            feature_name: null,
            unit_test_path: null,
            workflow_ref: null,
            guard_ref: null,
          },
          {
            link_id: 'cell-2',
            cell_kind: 'scenario',
            cell_key: '断网',
            cell_status: 'red',
            assertion_ref: null,
            na_reason: null,
            feature_id: null,
            feature_name: null,
            unit_test_path: null,
            workflow_ref: null,
            guard_ref: null,
          },
        ],
      })
      .mockResolvedValueOnce({
        rows: [{
          id: 'nfr-1',
          topic: '消息感知时效与完整性',
          decision: '数秒内感知，不漏不重',
          source_ref: 'gp-ledger-phase3:nfr:gp-b:s1',
        }],
      });

    const app = await makeApp();
    const res = await (await request())(app).get('/api/brain/journey_steps/step-1/ledger');

    expect(res.status).toBe(200);
    expect(res.body.step).toMatchObject({
      id: 'step-1',
      journey_id: 'journey-1',
      home: 'biz',
    });
    expect(res.body.zones.element).toHaveLength(1);
    expect(res.body.zones.scenario).toHaveLength(1);
    expect(res.body.zones.capability).toEqual([]);
    expect(res.body.zones.base_ref).toEqual([]);
    expect(res.body.zones.element[0]).toMatchObject({
      cell_key: 'NFR',
      assertion_state: 'test',
      runnable: true,
      needs_assertion: false,
    });
    expect(res.body.nfr_decisions).toHaveLength(1);
    expect(res.body.readiness).toEqual({
      total: 2,
      runnable: 1,
      semantic: 0,
      not_applicable: 0,
      missing: 1,
      positive_missing: 0,
      ready: true,
    });
  });

  it('[JSL-2] step 存在但没有格子 → 空四区，不报错', async () => {
    mockQuery
      .mockResolvedValueOnce({
        rows: [{
          id: 'step-empty',
          name: '空步骤',
          step_number: 1,
          promise: null,
          journey_id: 'journey-1',
          journey_name: '空旅程',
          home: 'biz',
          domain: null,
        }],
      })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] });

    const app = await makeApp();
    const res = await (await request())(app).get('/api/brain/journey_steps/step-empty/ledger');

    expect(res.status).toBe(200);
    expect(res.body.zones).toEqual({
      capability: [],
      element: [],
      scenario: [],
      base_ref: [],
    });
    expect(res.body.readiness.total).toBe(0);
  });

  it('[JSL-3] step 不存在 → 404', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });
    const app = await makeApp();
    const res = await (await request())(app).get('/api/brain/journey_steps/missing/ledger');
    expect(res.status).toBe(404);
    expect(res.body.error).toBe('step not found');
  });

  it('[JSL-4] DB 错误 → 500', async () => {
    mockQuery.mockRejectedValueOnce(new Error('DB connection refused'));
    const app = await makeApp();
    const res = await (await request())(app).get('/api/brain/journey_steps/step-any/ledger');
    expect(res.status).toBe(500);
  });

  it('[JSL-5] product ledger 不再导入 Brain internal ledger calculator', async () => {
    const { readFileSync } = await import('fs');
    const { dirname, join } = await import('path');
    const { fileURLToPath } = await import('url');
    const here = dirname(fileURLToPath(import.meta.url));
    const source = readFileSync(join(here, '../journeys.js'), 'utf8');
    expect(source).not.toContain("import { computeLedgerStatus }");
    expect(source).not.toContain("eleven-elements-ledger");
  });
});
