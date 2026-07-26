import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import express from 'express';
import request from 'supertest';
import { describe, expect, it } from 'vitest';

import { resolveAction } from '../../../packages/brain/src/orchestrator/dispatcher.js';
import harnessRoutesRouter from '../../../packages/brain/src/routes/harness.routes.js';

const SPRINT_DIR = 'sprints/07251915-kernel-a1fa8636';
const MIGRATION = 'packages/brain/migrations/361_kernel_attempt_telemetry.sql';
const QUERY_MODULE = 'packages/brain/src/orchestrator/attempt-telemetry.js';

const REQUIRED_TIMED_ROLES = [
  'planner',
  'generator',
  'reviewer',
  'evaluator',
  'judge',
  'reporter',
];

describe('kernel attempt telemetry frozen contract [BEHAVIOR]', () => {
  it('migration 361 与独立 telemetry query module 存在', () => {
    expect(existsSync(MIGRATION), `${MIGRATION} 必须由 generator 新增`).toBe(true);
    expect(existsSync(QUERY_MODULE), `${QUERY_MODULE} 必须由 generator 新增`).toBe(true);
  });

  it('GET /tasks/:task_id/attempt-telemetry 已注册到真实 harness router', () => {
    const paths = harnessRoutesRouter.stack
      .map((layer: any) => layer.route?.path)
      .filter(Boolean);
    expect(paths).toContain('/tasks/:task_id/attempt-telemetry');
  });

  it('GET telemetry 缺 x-tenant-id 时返回 400 + error string 而非通用 404', async () => {
    const app = express();
    app.use('/api/brain/harness', harnessRoutesRouter);
    const response = await request(app).get(
      '/api/brain/harness/tasks/11111111-1111-4111-8111-111111111111/attempt-telemetry',
    );
    expect(response.status).toBe(400);
    expect(typeof response.body.error).toBe('string');
  });

  it('时间公式冻结为 wall = active + wait，负区间归零且不允许空数组假绿', async () => {
    if (!existsSync(QUERY_MODULE)) {
      expect.fail(`${QUERY_MODULE} 尚未实现`);
      return;
    }
    const module = await import(`../../../${QUERY_MODULE}`);
    expect(typeof module.calculateAttemptTime).toBe('function');

    expect(module.calculateAttemptTime({
      created_at: '2026-07-25T00:00:00.000Z',
      started_at: '2026-07-25T00:00:00.500Z',
      completed_at: '2026-07-25T00:00:01.500Z',
      updated_at: '2026-07-25T00:00:01.500Z',
      status: 'completed',
      time_derived: false,
    })).toEqual({
      active_time_ms: 1000,
      wait_time_ms: 500,
      wall_time_ms: 1500,
      derived: false,
    });

    expect(module.calculateAttemptTime({
      created_at: '2026-07-25T00:00:01.000Z',
      started_at: '2026-07-25T00:00:00.500Z',
      completed_at: '2026-07-25T00:00:00.250Z',
      updated_at: '2026-07-25T00:00:00.250Z',
      status: 'completed',
      time_derived: true,
    })).toEqual({
      active_time_ms: 0,
      wait_time_ms: 0,
      wall_time_ms: 0,
      derived: true,
    });
  });

  it('Kernel action 路由元数据与 telemetry 改动前完全等价', () => {
    expect([
      'spawn:planner',
      'spawn:proposer',
      'spawn:reviewer',
      'spawn:generator',
      'spawn:generator-fix',
      'spawn:evaluator',
      'spawn:evaluator-evidence-repair',
      'spawn:judge',
    ].map((action) => [action, resolveAction(action)])).toEqual([
      ['spawn:planner', {
        role: 'planner', skill: 'harness-planner', readOnly: false,
        expectedOutput: 'harness-result/planner-v1',
      }],
      ['spawn:proposer', {
        role: 'proposer', skill: 'harness-contract-proposer', readOnly: false,
        expectedOutput: 'harness-result/proposer-v1',
      }],
      ['spawn:reviewer', {
        role: 'reviewer', skill: 'harness-contract-reviewer', readOnly: true,
        expectedOutput: 'harness-result/reviewer-v1',
      }],
      ['spawn:generator', {
        role: 'generator', skill: 'harness-generator', readOnly: false,
        expectedOutput: 'harness-result/generator-v1',
      }],
      ['spawn:generator-fix', {
        role: 'generator', skill: 'harness-generator', readOnly: false,
        expectedOutput: 'harness-result/generator-v1',
      }],
      ['spawn:evaluator', {
        role: 'evaluator', skill: 'harness-evaluator', readOnly: false,
        expectedOutput: 'harness-result/evaluator-v1',
      }],
      ['spawn:evaluator-evidence-repair', {
        role: 'evaluator', skill: 'harness-evaluator', readOnly: false,
        expectedOutput: 'harness-result/evaluator-v1',
      }],
      ['spawn:judge', {
        role: 'judge', skill: null, readOnly: true,
        expectedOutput: 'harness-result/judge-v1',
      }],
    ]);
  });

  it('合同冻结、Kernel 决策与 callback 路径既有回归继续通过', () => {
    execFileSync('../../node_modules/.bin/vitest', [
      'run',
      'src/orchestrator/__tests__/derive.test.js',
      'src/orchestrator/__tests__/contract-store.test.js',
      'src/orchestrator/__tests__/kernel-handlers.test.js',
      'src/orchestrator/__tests__/kernel-callback-flow.integration.test.js',
      '--reporter=dot',
    ], {
      cwd: `${process.cwd()}/packages/brain`,
      env: {
        ...process.env,
        NODE_ENV: 'test',
        DB_NAME: process.env.DB_NAME || 'cecelia_test',
        DB_HOST: process.env.DB_HOST || 'host.docker.internal',
      },
      stdio: 'pipe',
    });
  });

  it('scope guard 禁止触碰 Commander/Memory/Directive/Actor Inbox/唤醒/第二流程账本', () => {
    const base = process.env.CONTRACT_BASE_SHA;
    expect(base, 'CONTRACT_BASE_SHA 必须由 generator/evaluator 注入').toBeTruthy();
    if (!base) return;

    const changed = execFileSync('git', ['diff', '--name-only', `${base}...HEAD`], {
      encoding: 'utf8',
    }).trim().split('\n').filter(Boolean);
    const forbidden = changed.filter((file) =>
      /commander|memory|directive|actor[-_]?inbox|wake|wakeup/i.test(file)
      || /migrations\/.*(run_events|process_ledger|actor_inbox)/i.test(file));
    expect(forbidden).toEqual([]);

    const migration = existsSync(MIGRATION) ? readFileSync(MIGRATION, 'utf8') : '';
    expect(migration).not.toMatch(
      /CREATE\s+TABLE[\s\S]{0,80}(commander|memory|directive|actor_inbox|run_events|process_ledger)/i,
    );
  });

  it('六类计时 role 常量冻结且 judge/reporter 必须有 derived oracle', async () => {
    if (!existsSync(QUERY_MODULE)) {
      expect.fail(`${QUERY_MODULE} 尚未实现`);
      return;
    }
    const module = await import(`../../../${QUERY_MODULE}`);
    expect(module.REQUIRED_TIMED_ROLES).toEqual(REQUIRED_TIMED_ROLES);
    expect(module.DERIVED_TIME_ROLES).toEqual(expect.arrayContaining(['judge', 'reporter']));
  });
});
