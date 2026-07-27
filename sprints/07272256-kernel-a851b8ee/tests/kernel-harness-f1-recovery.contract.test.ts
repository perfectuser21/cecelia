import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import express from 'express';
import request from 'supertest';
import { describe, expect, it } from 'vitest';

import approvalRouter from '../../../packages/brain/src/routes/harness-kernel-approvals.js';

const MIGRATION = 'packages/brain/migrations/366_kernel_harness_f1_baseline.sql';
const SMOKE = 'packages/brain/scripts/smoke/kernel-harness-f1-baseline-smoke.sh';
const INTEGRATION = 'packages/brain/src/__tests__/integration/migration-365-kernel-harness-f1-baseline.integration.test.js';
const EXECUTOR_KIND = 'packages/brain/src/__tests__/integration/migration-365-executor-kind-kernel-process.integration.test.js';

describe('kernel harness F1 recovery contract [BEHAVIOR]', () => {
  it('migration 366 双跑与隔离库收据', () => {
    if (!existsSync(MIGRATION)) {
      expect.fail(`${MIGRATION} 尚未实现`);
      return;
    }
    if (!existsSync(INTEGRATION)) {
      expect.fail(`${INTEGRATION} 尚未实现`);
      return;
    }
    expect(existsSync(EXECUTOR_KIND), `${EXECUTOR_KIND} 必须继续保留`).toBe(true);

    const migration = readFileSync(MIGRATION, 'utf8');
    expect(migration).toContain('journey_steps');
    expect(migration).toContain('journey_step_links');
    expect(migration).not.toContain('CREATE TABLE kernel_steps');
    expect(migration).not.toContain('Kernel Harness Delivery');
  });

  it('same-SHA authority 与 approve reject schema', async () => {
    const app = express();
    app.use(express.json());
    app.set('pool', {
      query: async (sql: string, params: unknown[] = []) => {
        const normalized = String(sql).trim();
        if (normalized.includes('FROM initiative_runs r')) {
          return {
            rows: [{
              run_id: '11111111-1111-4111-8111-111111111111',
              task_id: '22222222-2222-4222-8222-222222222222',
              pr_url: 'https://github.com/perfectuser21/cecelia/pull/4372',
            }],
          };
        }
        if (normalized.includes("action='effect:human_review_requested'")) {
          return {
            rows: [{
              hop: 3,
              observed: { pr: { head_sha: 'a'.repeat(40) } },
              detail: { review_reason: 'awaiting_human_review' },
              created_at: new Date('2026-07-27T00:00:00.000Z'),
            }],
          };
        }
        throw new Error(`unexpected pool query: ${normalized} params=${JSON.stringify(params)}`);
      },
      connect: async () => ({
        query: async (sql: string, params: unknown[] = []) => {
          const normalized = String(sql).trim();
          if (['BEGIN', 'COMMIT', 'ROLLBACK'].includes(normalized)) return { rows: [], rowCount: 0 };
          if (normalized.includes('pg_advisory_xact_lock')) return { rows: [{}], rowCount: 1 };
          if (normalized.includes("action='verdict:human_review'") && normalized.includes('SELECT 1')) {
            return { rows: [], rowCount: 0 };
          }
          if (normalized.includes('SELECT COALESCE(MAX(hop), 0) + 1 AS next_hop')) {
            return { rows: [{ next_hop: 4 }], rowCount: 1 };
          }
          if (normalized.includes('UPDATE initiative_runs') && normalized.includes('deadline_at')) {
            return { rows: [], rowCount: 1 };
          }
          if (normalized.includes('INSERT INTO orchestrator_decision_log')) {
            const detail = JSON.parse(String(params[4]));
            expect(detail.pr_head_sha).toBe('a'.repeat(40));
            expect(detail.review_request_hop).toBe(3);
            return { rows: [], rowCount: 1 };
          }
          throw new Error(`unexpected tx query: ${normalized}`);
        },
        release() {},
      }),
    });
    app.set('kernelPrHeadResolver', async () => 'a'.repeat(40));
    app.use('/api/brain/harness/kernel-reviews', approvalRouter);

    process.env.HARNESS_REVIEW_APPROVER_TOKEN = 'recovery-token';

    const approve = await request(app)
      .post('/api/brain/harness/kernel-reviews/11111111-1111-4111-8111-111111111111/approve')
      .set('x-approver-token', 'recovery-token')
      .send({
        task_id: '22222222-2222-4222-8222-222222222222',
        pr_head_sha: 'a'.repeat(40),
        review_request_hop: 3,
        approved_by: 'review-owner',
      });

    expect(approve.status).toBe(202);
    expect(Object.keys(approve.body).sort()).toEqual([
      'approved_at',
      'approved_by',
      'ok',
      'pr_head_sha',
      'review_class',
      'review_request_hop',
      'run_id',
      'task_id',
    ].sort());

    const smokeContent = existsSync(SMOKE) ? readFileSync(SMOKE, 'utf8') : '';
    for (const mode of [
      'unique-journey',
      'history-and-backbone',
      'cells-and-evidence',
      'legacy-baseline',
      'assertion-refs',
      'endpoint-semantics',
      'runtime-nonregression',
    ]) {
      expect(smokeContent.includes(mode), `缺少 smoke mode ${mode}`).toBe(true);
    }
  });
});
