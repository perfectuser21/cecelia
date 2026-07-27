import { randomUUID } from 'node:crypto';

import { afterEach, beforeAll, describe, expect, it } from 'vitest';

import pool from '../../../packages/brain/src/db.js';
import {
  loadActiveHarnessAccountOccupancy,
} from '../../../packages/brain/src/harness-capacity-accounting.js';

const createdRunIds: string[] = [];

async function seedRun() {
  const runId = randomUUID();
  const initiativeId = randomUUID();
  createdRunIds.push(runId);
  await pool.query(
    `INSERT INTO initiative_runs (id, initiative_id, phase, orchestrator_version, started_at, created_at, updated_at)
     VALUES ($1, $2, 'generate', 'v2', NOW(), NOW(), NOW())`,
    [runId, initiativeId],
  );
  return runId;
}

async function seedAttempt(runId: string, hop: number, over: Record<string, unknown>) {
  await pool.query(
    `INSERT INTO harness_attempts (
       id, run_id, hop, phase, role, provider, account_id, machine_id,
       task_bundle, callback_secret_hash, status, started_at, created_at, updated_at
     ) VALUES (
       $1, $2, $3, $4, $5, $6, $7, $8,
       $9::jsonb, $10, $11, NOW(), NOW(), NOW()
     )`,
    [
      randomUUID(),
      runId,
      hop,
      over.phase ?? 'generate',
      over.role ?? 'generator',
      over.provider ?? 'auto',
      over.account_id ?? null,
      over.machine_id ?? 'us-mac-m4',
      JSON.stringify(over.task_bundle ?? {}),
      `contract-secret-${hop}`,
      over.status ?? 'running',
    ],
  );
}

afterEach(async () => {
  while (createdRunIds.length) {
    const runId = createdRunIds.pop();
    await pool.query('DELETE FROM harness_attempts WHERE run_id = $1', [runId]);
    await pool.query('DELETE FROM initiative_runs WHERE id = $1', [runId]);
  }
});

describe('provider/account active attempt occupancy uses real PostgreSQL', () => {
  beforeAll(() => {
    if (!process.env.DB_URL && !process.env.DATABASE_URL) {
      process.env.DB_URL = 'postgresql://localhost/cecelia';
    }
  });

  it('真实 harness_attempts 非终态占用按 provider account 计数且终态不占用', async () => {
    const runId = await seedRun();
    const roleAssignmentBundle = {
      observed: {
        task: {
          payload: {
            role_assignments: {
              generator: { provider: 'codex', account: 'team2' },
              evaluator: { provider: 'claude', account: 'account1' },
            },
          },
        },
      },
    };

    await seedAttempt(runId, 1, {
      role: 'generator',
      provider: 'auto',
      account_id: null,
      status: 'queued',
      task_bundle: roleAssignmentBundle,
    });
    await seedAttempt(runId, 2, {
      role: 'generator',
      provider: 'codex',
      account_id: 'team2',
      status: 'running',
      task_bundle: roleAssignmentBundle,
    });
    await seedAttempt(runId, 3, {
      role: 'evaluator',
      provider: 'auto',
      account_id: null,
      status: 'starting',
      task_bundle: roleAssignmentBundle,
    });
    await seedAttempt(runId, 4, {
      role: 'generator',
      provider: 'codex',
      account_id: 'team2',
      status: 'completed',
      task_bundle: roleAssignmentBundle,
    });
    await seedAttempt(runId, 5, {
      role: 'reviewer',
      provider: 'claude',
      account_id: 'account2',
      status: 'failed',
      task_bundle: roleAssignmentBundle,
    });

    const occupancy = await loadActiveHarnessAccountOccupancy(pool, { run_ids: [runId] });

    expect(occupancy.by_account['codex:team2']).toMatchObject({
      provider: 'codex',
      account: 'team2',
      active: 2,
    });
    expect(occupancy.by_account['claude:account1']).toMatchObject({
      provider: 'claude',
      account: 'account1',
      active: 1,
    });
    expect(occupancy.by_account['claude:account2']).toBeUndefined();
    expect(occupancy.by_account['codex:team2'].attempt_ids).toHaveLength(2);
    expect(occupancy.total_active).toBe(3);
  });
});
