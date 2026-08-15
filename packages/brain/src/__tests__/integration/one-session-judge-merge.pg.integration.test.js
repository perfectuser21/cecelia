import { execFileSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { DB_DEFAULTS } from '../../db-config.js';
import { contractArtifactManifestDigest } from '../../orchestrator/contract-artifacts.js';
import { persistOneSessionJudgeReceipt } from '../../orchestrator/one-session-judge-receipt.js';
import { executeOneSessionMerge } from '../../orchestrator/one-session-merge.js';

const { Pool } = pg;
const BRAIN_ROOT = fileURLToPath(new URL('../../../', import.meta.url));
let adminPool;
let pool;
let databaseName;

function quoteIdentifier(value) {
  if (!/^one_session_authority_[a-z0-9_]+$/.test(value)) throw new Error('unsafe database');
  return `"${value}"`;
}

beforeAll(async () => {
  databaseName = `one_session_authority_${process.pid}_${randomUUID().replaceAll('-', '')}`;
  adminPool = new Pool({ ...DB_DEFAULTS, database: 'postgres', max: 1 });
  await adminPool.query(`CREATE DATABASE ${quoteIdentifier(databaseName)}`);
  execFileSync(process.execPath, ['src/migrate.js'], {
    cwd: BRAIN_ROOT,
    env: {
      ...process.env,
      NODE_ENV: 'test',
      DB_HOST: DB_DEFAULTS.host,
      DB_PORT: String(DB_DEFAULTS.port),
      DB_USER: DB_DEFAULTS.user,
      DB_PASSWORD: DB_DEFAULTS.password,
      DB_NAME: databaseName,
    },
    stdio: 'pipe',
  });
  pool = new Pool({ ...DB_DEFAULTS, database: databaseName, max: 6 });
}, 60_000);

afterAll(async () => {
  if (pool) await pool.end();
  if (adminPool && databaseName) {
    await adminPool.query(`DROP DATABASE IF EXISTS ${quoteIdentifier(databaseName)}`);
  }
  if (adminPool) await adminPool.end();
}, 30_000);

async function seedAuthority() {
  const taskId = randomUUID();
  const runId = randomUUID();
  const initiativeId = randomUUID();
  const contractId = randomUUID();
  const controllerSessionId = randomUUID();
  const sprintDir = `sprints/one-session-${taskId.slice(0, 8)}`;
  const sourceRevision = 'c'.repeat(40);
  const artifact = (path, content) => ({
    path,
    content,
    sha256: createHash('sha256').update(content).digest('hex'),
    byte_length: Buffer.byteLength(content),
    source_revision: sourceRevision,
  });
  const artifacts = [
    artifact(`${sprintDir}/contract-dod.md`, '# DoD'),
    artifact(`${sprintDir}/contract-draft.md`, '# Contract'),
    artifact(`${sprintDir}/sprint-prd.md`, '# PRD'),
    artifact(`${sprintDir}/tests/acceptance.test.mjs`, 'export default true;'),
  ];
  const manifestSha256 = contractArtifactManifestDigest(artifacts);
  await pool.query(
    `INSERT INTO initiative_contracts
       (id,initiative_id,version,status,prd_content,contract_content,approved_sha,approved_at)
     VALUES($1,$2,1,'approved','# PRD','# Contract',$3,NOW())`,
    [contractId, initiativeId, sourceRevision],
  );
  for (const row of artifacts) {
    await pool.query(
      `INSERT INTO initiative_contract_artifacts
         (contract_id,path,content,sha256,byte_length,source_revision)
       VALUES($1,$2,$3,$4,$5,$6)`,
      [contractId, row.path, row.content, row.sha256, row.byte_length, row.source_revision],
    );
  }
  await pool.query(
    `INSERT INTO initiative_contract_artifact_seals
       (contract_id,artifact_count,manifest_sha256,source_revision)
     VALUES($1,$2,$3,$4)`,
    [contractId, artifacts.length, manifestSha256, sourceRevision],
  );
  await pool.query(
    `INSERT INTO tasks(id,title,status,task_type,priority,trigger_source,payload)
     VALUES($1,$2,'in_progress','harness_initiative','P2','api',$3::jsonb)`,
    [taskId, `one-session-${taskId}`, JSON.stringify({ sprint_dir: sprintDir })],
  );
  await pool.query(
    `INSERT INTO kernel_controller_sessions
       (id,task_id,generation,source,status,last_heartbeat_at,lease_expires_at)
     VALUES($1,$2,1,'one-session-test','active',NOW(),NOW()+INTERVAL '1 hour')`,
    [controllerSessionId, taskId],
  );
  await pool.query(
    `INSERT INTO initiative_runs
       (id,initiative_id,contract_id,current_task_id,phase,orchestrator_version,
        created_source,record_trust_status,controller_session_id,controller_generation,
        controller_lease_expires_at,pr_url)
     VALUES($1,$2,$3,$4,'evaluate','v2','kernel_dispatch','trusted',$5,1,
       (SELECT lease_expires_at FROM kernel_controller_sessions WHERE id=$5),
       'https://github.com/example/repo/pull/1')`,
    [runId, initiativeId, contractId, taskId, controllerSessionId],
  );
  await pool.query(
    'UPDATE kernel_controller_sessions SET run_id=$2 WHERE id=$1',
    [controllerSessionId, runId],
  );
  return {
    taskId,
    runId,
    contractIdentity: {
      contract_id: contractId,
      manifest_sha256: manifestSha256,
      source_revision: sourceRevision,
    },
  };
}

describe.sequential('one-session Judge receipt and merge authority [real PostgreSQL]', () => {
  it('原子封存 exact verdict receipt，重试幂等，再由服务端 merge gate 消费', async () => {
    const fixture = await seedAuthority();
    const receiptInput = {
      runId: fixture.runId,
      taskId: fixture.taskId,
      prHeadSha: 'a'.repeat(40),
      contractIdentity: fixture.contractIdentity,
      evaluatorVerdict: 'PASS',
      evaluatorFeedback: 'human acceptance complete',
      evaluatorEvidenceSha256: 'd'.repeat(64),
      judgeResult: {
        judged: true,
        verdict: 'PASS',
        feedback: 'independent evidence accepted',
        failure_class: null,
        failure_signature: null,
        coverage: [{ step: 'accept', passed: true, deferred: false, evidence: 'verified' }],
      },
    };
    expect(await persistOneSessionJudgeReceipt(pool, receiptInput))
      .toMatchObject({ persisted: true });
    expect(await persistOneSessionJudgeReceipt(pool, receiptInput))
      .toMatchObject({ persisted: false });

    const decisionLog = (await pool.query(
      'SELECT hop,action,observed,detail FROM orchestrator_decision_log WHERE run_id=$1 ORDER BY hop',
      [fixture.runId],
    )).rows;
    expect(decisionLog.map((row) => row.action)).toEqual([
      'verdict:evaluate',
      'verdict:judge',
    ]);
    expect(decisionLog.every((row) => (
      row.detail.contract_identity.manifest_sha256
        === fixture.contractIdentity.manifest_sha256
    ))).toBe(true);

    const baseObserved = {
      run: { id: fixture.runId, phase: 'review', cost_usd: 0 },
      task: { id: fixture.taskId, status: 'in_progress', payload: {} },
      prdExists: true,
      contract: { approved: true, identity: fixture.contractIdentity },
      pr: {
        url: 'https://github.com/example/repo/pull/1',
        state: 'OPEN', merged: false, ci: 'pass', head_sha: 'a'.repeat(40),
        mergeStateStatus: 'CLEAN',
      },
      candidate: null,
      inflight: { attempts: [], containers: [], host_pids: [] },
      lastAgentExit: { code: null, auth_failed: false },
      proposeBranchRn: 1,
      ganLatestRoundVerdict: { verdict: 'APPROVED' },
      generatorSpawned: true,
      evaluateVerdict: decisionLog[0].detail,
      judgeVerdict: decisionLog[1].detail,
      evaluateResult: null,
      reviewRequired: false,
      reviewApproved: false,
      decisionLog,
    };
    const dispatch = vi.fn(async () => ({ status: 'DONE', detail: 'merge requested' }));
    const result = await executeOneSessionMerge({
      pool,
      taskId: fixture.taskId,
      runId: fixture.runId,
      collect: async () => baseObserved,
      impactGate: { beforeMerge: async () => ({ gate: 'pass' }) },
      dispatch,
    });
    expect(result).toMatchObject({ status: 'DONE' });
    expect(dispatch).toHaveBeenCalledOnce();
    const actions = (await pool.query(
      'SELECT action FROM orchestrator_decision_log WHERE run_id=$1 ORDER BY hop',
      [fixture.runId],
    )).rows.map((row) => row.action);
    expect(actions).toEqual([
      'verdict:evaluate',
      'verdict:judge',
      'merge_pr',
      'result:dispatch',
    ]);
  });
});
