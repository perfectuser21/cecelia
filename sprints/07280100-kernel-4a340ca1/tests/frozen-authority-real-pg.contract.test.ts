import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { collectGroundTruth } from '../../../packages/brain/src/orchestrator/ground-truth.js';

const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL
  ?? 'postgresql://postgres@host.docker.internal:55439/harness_controller_bootstrap';

const initiativeId = randomUUID();
const taskId = randomUUID();
const runId = randomUUID();
const contractId = randomUUID();

function realSchemaProbe() {
  return execFileSync(
    'psql',
    [
      TEST_DATABASE_URL,
      '-At',
      '-c',
      'select current_database()',
    ],
    { encoding: 'utf8' },
  ).trim();
}

function fakePool() {
  return {
    async query(sql: string) {
      if (sql.includes('FROM initiative_runs WHERE id')) {
        return {
          rows: [{
            id: runId,
            initiative_id: initiativeId,
            contract_id: contractId,
            phase: 'generate',
            current_task_id: taskId,
            pr_url: 'https://github.com/perfectuser21/cecelia/pull/9999',
          }],
        };
      }
      if (sql.includes('FROM initiative_contracts WHERE id')) {
        return {
          rows: [{
            id: contractId,
            initiative_id: initiativeId,
            status: 'approved',
            branch: 'cp-harness-propose-r1-4a340ca1-a2',
            contract_content: 'contract',
            prd_content: 'prd',
          }],
        };
      }
      if (sql.includes('SELECT * FROM tasks WHERE id')) {
        return {
          rows: [{
            id: taskId,
            status: 'in_progress',
            title: 'Kernel Test Environment Controller Recovery 4 authority contract',
            payload: {
              sprint_dir: 'sprints/07280100-kernel-4a340ca1',
              review_required: true,
              database_backed: false,
              db_url: 'postgresql://evil/override',
            },
          }],
        };
      }
      if (sql.includes('FROM orchestrator_decision_log')) return { rows: [] };
      if (sql.includes("FROM harness_attempts") && sql.includes("role = 'evaluator'")) return { rows: [] };
      if (sql.includes('FROM harness_attempts')) return { rows: [] };
      if (sql.includes('FROM account_usage_cache')) return { rows: [] };
      return { rows: [] };
    },
  };
}

describe('Kernel controller frozen authority on real PostgreSQL', () => {
  it('collectGroundTruth 只从 initiative_contracts 与 initiative_runs 派生 authority', async () => {
    expect(realSchemaProbe()).toBe('harness_controller_bootstrap');

    const observed = await collectGroundTruth(
      {
        pool: fakePool() as any,
        execCmd: () => '',
        fileExists: () => false,
        readFile: () => '',
      },
      { taskId, runId },
    );

    expect(
      (observed as any).contractAuthority,
      '当前主干没有把 frozen-contract authority 物化到 observed.contractAuthority',
    ).toBeTruthy();
    expect((observed as any).contractAuthority?.database_backed).toBe(true);
    expect((observed as any).contractAuthority?.contract_id).toBe(contractId);
    expect((observed as any).contractAuthority?.run_id).toBe(runId);
  });

  it('attempt 持久化后才允许 provisioning real PG capability', async () => {
    expect(realSchemaProbe()).toBe('harness_controller_bootstrap');

    const mod = await import(
      '../../../packages/brain/src/orchestrator/kernel-test-environment-controller.js'
    ).catch(() => null);

    expect(
      mod?.provisionAttemptEnvironment,
      '当前主干还没有 attempt-scoped PG provisioning controller',
    ).toBeTypeOf('function');
  });
});
