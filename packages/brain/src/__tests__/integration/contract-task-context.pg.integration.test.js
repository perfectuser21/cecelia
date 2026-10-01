import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import pg from 'pg';
import { DB_DEFAULTS } from '../../db-config.js';
import { materializeApprovedContract } from '../../orchestrator/contract-store.js';

const pool = new pg.Pool(DB_DEFAULTS);
let client;
const taskId = '11111111-1111-4111-8111-111111111111';
const runId = '22222222-2222-4222-8222-222222222222';
const initiativeId = '33333333-3333-4333-8333-333333333333';
const revision = 'a'.repeat(40);
const originalPayload = {
  branch: 'cp-original', base_sha: 'b'.repeat(40), routing_receipt_id: 'receipt',
  target_environment: 'local_api', lane: 'AI', nested: { retained: true },
};
function artifact(path, content) {
  return { path, content, sha256: createHash('sha256').update(content).digest('hex'),
    byte_length: Buffer.byteLength(content), source_revision: revision };
}
function options(root = 'sprints/context') {
  const draft = `# Contract\n\n## Test Contract\n\n| 功能 | Test File | BEHAVIOR | 红证据 |\n|---|---|---|---|\n| context | \`${root}/tests/context.test.mjs\` | \`context\` | FAIL |`;
  return {
    runId, version: 1, branch: 'cp-approved', prdContent: '# PRD',
    contractContent: `${draft}\n\n# DoD`,
    artifacts: [artifact(`${root}/contract-dod.md`, '# DoD'),
      artifact(`${root}/contract-draft.md`, draft), artifact(`${root}/sprint-prd.md`, '# PRD'),
      artifact(`${root}/tests/context.test.mjs`, 'test("context", () => {})')],
  };
}
// Only pool ownership is adapted: every statement, commit and rollback uses real PostgreSQL.
const transactionalPool = { connect: async () => ({
  query: (...args) => client.query(...args), release() {},
}) };
async function task() {
  return (await client.query('SELECT payload, status FROM tasks WHERE id=$1', [taskId])).rows[0];
}
async function setPayload(payload) {
  await client.query('UPDATE tasks SET payload=$2::jsonb WHERE id=$1', [taskId, JSON.stringify(payload)]);
}
async function state() {
  return (await client.query(`SELECT
    (SELECT contract_id FROM initiative_runs WHERE id=$1) AS contract_id,
    (SELECT count(*)::integer FROM initiative_contracts) AS contracts,
    (SELECT count(*)::integer FROM initiative_contract_artifact_seals) AS seals`, [runId])).rows[0];
}

describe('approved contract task context PostgreSQL', () => {
  beforeAll(async () => {
    client = await pool.connect();
    await client.query(`
      CREATE TEMP TABLE tasks (id uuid PRIMARY KEY, payload jsonb, status text);
      CREATE TEMP TABLE initiative_runs (
        id uuid PRIMARY KEY, initiative_id uuid NOT NULL, current_task_id uuid NOT NULL,
        contract_id uuid, updated_at timestamptz DEFAULT now());
      CREATE TEMP TABLE initiative_contracts (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(), initiative_id uuid NOT NULL,
        version integer NOT NULL, status text DEFAULT 'draft', prd_content text,
        contract_content text, approval_provenance jsonb, approved_sha text,
        frozen_artifacts jsonb DEFAULT '[]', review_rounds integer DEFAULT 0, approved_at timestamptz, branch text,
        created_at timestamptz DEFAULT now(), updated_at timestamptz DEFAULT now(),
        UNIQUE (initiative_id, version));
      CREATE TEMP TABLE initiative_contract_artifacts (
        contract_id uuid REFERENCES initiative_contracts(id), path text, content text,
        sha256 text, byte_length integer, source_revision text,
        created_at timestamptz DEFAULT now(), PRIMARY KEY (contract_id,path));
      CREATE TEMP TABLE initiative_contract_artifact_seals (
        contract_id uuid PRIMARY KEY REFERENCES initiative_contracts(id), artifact_count integer,
        manifest_sha256 text, source_revision text, sealed_at timestamptz DEFAULT now());
    `);
  });
  beforeEach(async () => {
    await client.query('TRUNCATE initiative_contract_artifacts, initiative_contract_artifact_seals, initiative_contracts, initiative_runs, tasks');
    await client.query("INSERT INTO tasks VALUES ($1,$2::jsonb,'in_progress')", [taskId, JSON.stringify(originalPayload)]);
    await client.query('INSERT INTO initiative_runs (id,initiative_id,current_task_id) VALUES ($1,$2,$3)', [runId, initiativeId, taskId]);
  });
  afterAll(async () => {
    client?.release();
    await pool.end();
  });

  it('fills missing sprint_dir from sealed artifacts and preserves task authority', async () => {
    const sealed = await materializeApprovedContract(transactionalPool, options());
    expect(await task()).toEqual({ payload: { ...originalPayload, sprint_dir: 'sprints/context' }, status: 'in_progress' });
    expect(await state()).toEqual({ contract_id: sealed.id, contracts: 1, seals: 1 });
  });
  it('repairs missing context on an already approved identical seal', async () => {
    const first = await materializeApprovedContract(transactionalPool, options());
    await setPayload(originalPayload);
    const second = await materializeApprovedContract(transactionalPool, options());
    expect(second.id).toBe(first.id);
    expect((await task()).payload.sprint_dir).toBe('sprints/context');
    expect((await state()).contracts).toBe(1);
  });
  it('keeps same-root reseals idempotent', async () => {
    await setPayload({ ...originalPayload, sprint_dir: 'sprints/context' });
    const first = await materializeApprovedContract(transactionalPool, options());
    const second = await materializeApprovedContract(transactionalPool, options());
    expect(second.id).toBe(first.id);
    expect((await task()).payload).toEqual({ ...originalPayload, sprint_dir: 'sprints/context' });
    expect((await state()).seals).toBe(1);
  });
  it('rejects conflicting task context without creating or attaching a contract', async () => {
    const payload = { ...originalPayload, sprint_dir: 'sprints/other' };
    await setPayload(payload);
    await expect(materializeApprovedContract(transactionalPool, options())).rejects.toThrow('sprint_dir');
    expect((await task()).payload).toEqual(payload);
    expect(await state()).toEqual({ contract_id: null, contracts: 0, seals: 0 });
  });
  it('rejects conflicting context on an already approved identical seal', async () => {
    await materializeApprovedContract(transactionalPool, options());
    const before = await state();
    await setPayload({ ...originalPayload, sprint_dir: 'sprints/other' });
    await expect(materializeApprovedContract(transactionalPool, options())).rejects.toThrow('sprint_dir');
    expect(await state()).toEqual(before);
    expect((await task()).payload.sprint_dir).toBe('sprints/other');
  });
  it('rejects multiple draft roots before persisting any task context', async () => {
    const input = options();
    input.artifacts = [...input.artifacts, artifact('sprints/second/contract-draft.md', '# Other')]
      .sort((a, b) => a.path.localeCompare(b.path));
    await expect(materializeApprovedContract(transactionalPool, input)).rejects.toThrow('contract_root');
    expect((await task()).payload).toEqual(originalPayload);
    expect(await state()).toEqual({ contract_id: null, contracts: 0, seals: 0 });
  });
  it('rolls back task context if seal persistence fails', async () => {
    await client.query('ALTER TABLE initiative_contract_artifact_seals ADD CONSTRAINT forced_failure CHECK (artifact_count < 0)');
    try {
      await expect(materializeApprovedContract(transactionalPool, options())).rejects.toThrow();
      expect((await task()).payload).toEqual(originalPayload);
      expect(await state()).toEqual({ contract_id: null, contracts: 0, seals: 0 });
    } finally {
      await client.query('ALTER TABLE initiative_contract_artifact_seals DROP CONSTRAINT forced_failure');
    }
  });
  it('does not backfill context when attached approved evidence mismatches', async () => {
    await materializeApprovedContract(transactionalPool, options());
    await setPayload(originalPayload);
    const input = options();
    input.branch = 'cp-wrong';
    await expect(materializeApprovedContract(transactionalPool, input)).rejects.toThrow('evidence mismatch');
    expect((await task()).payload).toEqual(originalPayload);
  });
  it('preserves legacy artifact-less sealing without inventing a sprint root', async () => {
    const input = options();
    delete input.artifacts;
    await materializeApprovedContract(transactionalPool, input);
    expect((await task()).payload).toEqual(originalPayload);
  });
  it('rolls back the approved contract if task context persistence fails', async () => {
    await client.query("ALTER TABLE tasks ADD CONSTRAINT reject_context CHECK (NOT (payload ? 'sprint_dir'))");
    try {
      await expect(materializeApprovedContract(transactionalPool, options())).rejects.toThrow();
      expect((await task()).payload).toEqual(originalPayload);
      expect(await state()).toEqual({ contract_id: null, contracts: 0, seals: 0 });
    } finally {
      await client.query('ALTER TABLE tasks DROP CONSTRAINT reject_context');
    }
  });
  it('repairs SQL null and an empty sprint_dir without changing other payload fields', async () => {
    await client.query('UPDATE tasks SET payload=NULL WHERE id=$1', [taskId]);
    await materializeApprovedContract(transactionalPool, options());
    expect((await task()).payload).toEqual({ sprint_dir: 'sprints/context' });
    await setPayload({ ...originalPayload, sprint_dir: '' });
    await materializeApprovedContract(transactionalPool, options());
    expect((await task()).payload).toEqual({ ...originalPayload, sprint_dir: 'sprints/context' });
  });
  it('repairs a null payload with only the verified sprint root', async () => {
    await setPayload(null);
    await materializeApprovedContract(transactionalPool, options());
    expect((await task()).payload).toEqual({ sprint_dir: 'sprints/context' });
  });
  it('rejects malformed task payload instead of overwriting it', async () => {
    await setPayload(['sprints/other']);
    await expect(materializeApprovedContract(transactionalPool, options())).rejects.toThrow('task_payload');
    expect((await task()).payload).toEqual(['sprints/other']);
    expect((await state()).contracts).toBe(0);
  });
});
