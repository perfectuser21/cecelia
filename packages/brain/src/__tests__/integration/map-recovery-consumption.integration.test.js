import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import pool from '../../db.js';
import { canonicalAssertionCommandText } from '../../lib/gp-assertion-command.js';
import { assertionDigest } from '../../lib/journey-assertion-receipt.js';
import { createAttemptStore } from '../../orchestrator/attempt-store.js';
import { ensureMapImpactPreflight } from '../../orchestrator/preflight/map-impact-contract.js';

const databaseName = process.env.DB_NAME ?? '';
const allowed = databaseName === 'cecelia_test' || databaseName.endsWith('_scratch');
const describeDb = allowed ? describe : describe.skip;

describeDb('map recovery PostgreSQL consumption', () => {
  let client;

  beforeAll(async () => {
    client = await pool.connect();
    await client.query('BEGIN');
  });

  afterAll(async () => {
    if (client) {
      await client.query('ROLLBACK');
      client.release();
    }
    await pool.end();
  });

  it('persists an immutable recovery contract and consumes it with exactly one generator attempt', async () => {
    const taskId = randomUUID();
    const receiptId = randomUUID();
    const runId = randomUUID();
    const attemptId = randomUUID();
    const baseSha = 'a'.repeat(40);
    const assertionId = 'packages/brain/src/orchestrator/preflight/map-impact-contract.test.js';
    const digest = assertionDigest(assertionId);
    const linkId = randomUUID();
    await client.query(
      `INSERT INTO tasks (id,title,task_type,status,payload,trigger_source)
       VALUES ($1,'map recovery integration','harness_initiative','in_progress',$2::jsonb,'test')`,
      [taskId, JSON.stringify({
        initiative_id: taskId,
        change_kind: 'bugfix',
        map_recovery: true,
        changed_files: ['packages/brain/src/lib/map-read-service.js'],
        routing_receipt_id: receiptId,
      })],
    );
    await client.query(
      `INSERT INTO work_routing_receipts (
         id,task_id,source,source_id,work_kind,change_kind,pipeline,
         canonical_task_type,default_execution_profile,repo,map_scope,
         impact_contract_required,orchestrator,router_version,route_reason,evidence
       ) VALUES (
         $1,$2,'api',$3,'coding_mutation','bugfix','harness',
         'harness_initiative','hotfix-v1','cecelia',$4::jsonb,
         true,'kernel-harness-v2','work-router-v1','integration',$5::jsonb
       )`,
      [receiptId, taskId, `integration:${taskId}`, JSON.stringify(['cap-map']), JSON.stringify({
        branch: 'cp-map-recovery-integration', base_sha: baseSha,
      })],
    );
    const lkgBody = {
      schema_version: 1,
      task_id: taskId,
      change_kind: 'bugfix',
      repo: 'cecelia',
      base_revision: baseSha,
      manifest_digest: 'b'.repeat(64),
      projection_digest: 'c'.repeat(64),
      affected_capabilities: [{ capability_id: 'cap-map', capability_name: 'Map', impact_level: 'direct' }],
      required_assertions: [{
        assertion_id: assertionId,
        command: canonicalAssertionCommandText(assertionId),
        covers_capability_ids: ['cap-map'],
        journey_step_link_id: linkId,
        assertion_revision: 1,
        assertion_digest: digest,
        source_bindings: [{
          journey_step_link_id: linkId, assertion_revision: 1, assertion_digest: digest,
        }],
      }],
      inapplicable_items: [],
    };
    await client.query(
      `INSERT INTO harness_impact_contracts (
         task_id,version,status,schema_version,change_kind,repo,base_revision,
         manifest_digest,projection_digest,contract_hash,contract_body
       ) VALUES ($1,1,'active',1,'bugfix','cecelia',$2,$3,$4,$5,$6::jsonb)`,
      [taskId, baseSha, 'b'.repeat(64), 'c'.repeat(64), 'd'.repeat(64), JSON.stringify(lkgBody)],
    );

    const preflight = await ensureMapImpactPreflight(client, {
      task: { id: taskId, payload: {
        map_recovery: true,
        changed_files: ['packages/brain/src/lib/map-read-service.js'],
      } },
      receipt: {
        id: receiptId, task_id: taskId, repo: 'cecelia', change_kind: 'bugfix',
        map_scope: ['cap-map'],
        evidence: { branch: 'cp-map-recovery-integration', base_sha: baseSha },
      },
    }, {
      readMap: async () => { throw Object.assign(new Error('offline'), { code: 'map_unavailable' }); },
    });

    await client.query(
      `INSERT INTO initiative_runs (
         id,initiative_id,phase,current_task_id,orchestrator_version,
         created_source,record_trust_status,impact_contract_policy,
         impact_contract_policy_reason,map_recovery_contract_id
       ) VALUES ($1,$2,'generate',$2,'v2','kernel_dispatch','trusted','required',$3,$4)`,
      [runId, taskId, 'map recovery integration', preflight.recovery_contract.id],
    );
    const attempt = await createAttemptStore(client).createAttempt({
      id: attemptId,
      runId,
      hop: 1,
      phase: 'generate',
      role: 'generator',
      provider: 'codex',
      accountId: null,
      machineId: 'integration',
      callbackSecretHash: 'e'.repeat(64),
      bundle: {},
    });
    const consumed = await client.query(
      `SELECT contract_id,attempt_id FROM map_recovery_consumptions WHERE contract_id=$1`,
      [preflight.recovery_contract.id],
    );

    expect(attempt.id).toBe(attemptId);
    expect(consumed.rows).toEqual([{
      contract_id: preflight.recovery_contract.id,
      attempt_id: attemptId,
    }]);
    await expect(createAttemptStore(client).createAttempt({
      id: randomUUID(), runId, hop: 2, phase: 'generate', role: 'generator',
      provider: 'codex', accountId: null, machineId: 'integration',
      callbackSecretHash: 'f'.repeat(64), bundle: {},
    })).rejects.toThrow(`Kernel run is terminal or missing: ${runId}`);
  });
});
