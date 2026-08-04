/**
 * gan-case-file.pg.integration.test.js —— 案卷式 GAN 写读全链，真库实证。
 *
 * recordCallbackTerminal（真实同事务 INSERT gan_case_file）→ loadCaseFile
 * （真实 SELECT 全量历轮行）。不 mock pool/client——上面两层各自的单测已经
 * 覆盖了分支逻辑，这里只证明"两层拼起来在真实 PostgreSQL 上确实写得进去、
 * 读得出来，且 UNIQUE(run_id,round,author_role) 约束真实生效"。
 */
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DB_DEFAULTS } from '../../db-config.js';
import { createAttemptStore } from '../../orchestrator/attempt-store.js';
import { loadCaseFile } from '../../orchestrator/case-file-store.js';

const { Pool } = pg;
const BRAIN_ROOT = fileURLToPath(new URL('../../../', import.meta.url));

let adminPool;
let testPool;
let databaseName;

function quotedIdentifier(value) {
  if (!/^gan_case_file_[a-z0-9_]+$/.test(value)) {
    throw new Error(`unsafe test database identifier: ${value}`);
  }
  return `"${value}"`;
}

beforeAll(async () => {
  databaseName = `gan_case_file_${process.pid}_${randomUUID().replaceAll('-', '')}`;
  adminPool = new Pool({ ...DB_DEFAULTS, database: 'postgres', max: 1 });
  await adminPool.query(`CREATE DATABASE ${quotedIdentifier(databaseName)}`);
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
  testPool = new Pool({ ...DB_DEFAULTS, database: databaseName, max: 4 });
}, 30_000);

afterAll(async () => {
  if (testPool) await testPool.end();
  if (adminPool && databaseName) {
    let activeSessions = 1;
    for (let attempt = 0; attempt < 250 && activeSessions > 0; attempt += 1) {
      const result = await adminPool.query(
        `SELECT COUNT(*)::int AS count FROM pg_stat_activity WHERE datname = $1`,
        [databaseName],
      );
      activeSessions = result.rows[0].count;
      if (activeSessions > 0) await new Promise((resolve) => setTimeout(resolve, 20));
    }
    if (activeSessions > 0) {
      throw new Error(`test database still has ${activeSessions} active sessions`);
    }
    await adminPool.query(`DROP DATABASE IF EXISTS ${quotedIdentifier(databaseName)}`);
  }
  if (adminPool) await adminPool.end();
}, 30_000);

async function seedRunWithAttempt(pool, { role, hop, phase, taskBundleInputs }) {
  const taskId = randomUUID();
  const runId = randomUUID();
  const attemptId = randomUUID();
  await pool.query(
    `INSERT INTO tasks (id, title, status) VALUES ($1, $2, 'in_progress')`,
    [taskId, `gan case file pg test ${taskId}`],
  );
  await pool.query(
    `INSERT INTO initiative_runs (
       id, initiative_id, phase, current_task_id, orchestrator_version,
       created_source, record_trust_status
     ) VALUES ($1, $2, $3, $4, 'v2', 'kernel_dispatch', 'trusted')`,
    [runId, randomUUID(), phase, taskId],
  );
  const store = createAttemptStore(pool);
  await store.createAttempt({
    id: attemptId,
    runId,
    hop,
    phase,
    role,
    provider: 'auto',
    bundle: { inputs: taskBundleInputs },
    callbackSecretHash: 'a'.repeat(64),
  });
  await pool.query(
    `UPDATE harness_attempts
        SET status = 'running', lease_owner = 'pg-case-file-worker',
            lease_expires_at = NOW() + INTERVAL '2 minutes'
      WHERE id = $1`,
    [attemptId],
  );
  return { taskId, runId, attemptId, store };
}

describe('案卷式 GAN 写读全链（真库）', () => {
  it('reviewer callback 落库案卷行，loadCaseFile 原样读回', async () => {
    const { runId, attemptId, store } = await seedRunWithAttempt(testPool, {
      role: 'reviewer',
      hop: 2,
      phase: 'gan',
      taskBundleInputs: { contract_round: 2, contract_sha: 'a'.repeat(40) },
    });

    const callbackResult = {
      status: 'completed_with_concerns',
      summary: 'contract mostly covers the PRD',
      artifacts: [],
      provider_metadata: { provider: 'codex' },
      decision: {
        outcome: 'REVISION_REQUESTED',
        reason: 'one blocker open',
        rubric_scores: { correctness: 8, coverage: 6 },
      },
      case_file: {
        blockers: [{ id: 'R2-1', dimension: 'coverage', status: 'open' }],
        feedback_md: '# Round 2\n\nR2-1 still open.',
      },
    };

    const outcome = await store.recordCallbackTerminal({
      attemptId,
      runId,
      leaseOwner: 'pg-case-file-worker',
      leaseGeneration: 0,
      result: callbackResult,
    });
    expect(outcome.deduped).toBe(false);
    expect(outcome.attempt.status).toBe('completed_with_concerns');

    const rows = await loadCaseFile(testPool, runId);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      run_id: runId,
      round: 2,
      author_role: 'reviewer',
      attempt_id: attemptId,
      contract_sha: 'a'.repeat(40),
      rubric_scores: { correctness: 8, coverage: 6 },
      blockers: [{ id: 'R2-1', dimension: 'coverage', status: 'open' }],
      // P2-4 复审修正：feedback_md 只过 redactSecrets（secret 脱敏），
      // 不折行不截断——完整反馈原文（含换行）原样落库。
      feedback_md: '# Round 2\n\nR2-1 still open.',
    });
  });

  it('同一 (run_id,round,author_role) 二次终态写入不产生第二行（callback 重试幂等）', async () => {
    const { runId, attemptId, store } = await seedRunWithAttempt(testPool, {
      role: 'proposer',
      hop: 1,
      phase: 'gan',
      taskBundleInputs: { contract_round: 1 },
    });
    const callbackResult = {
      status: 'completed',
      summary: 'contract proposed',
      artifacts: [],
      provider_metadata: { provider: 'codex' },
      decision: null,
      case_file: {
        blockers: [{ id: 'R1-1', closure: 'n/a first round' }],
        feedback_md: '# Round 1 proposal',
      },
    };

    const first = await store.recordCallbackTerminal({
      attemptId,
      runId,
      leaseOwner: 'pg-case-file-worker',
      leaseGeneration: 0,
      result: callbackResult,
    });
    expect(first.deduped).toBe(false);

    // 精确重放同一 callback payload：attempt 层判定 exactDuplicate 走
    // isTerminal 早退分支，不会重跑案卷 INSERT（也不该跑——UNIQUE 约束会拦，
    // 但设计上这条路径根本不会到 INSERT 语句）。
    const retry = await store.recordCallbackTerminal({
      attemptId,
      runId,
      leaseOwner: 'pg-case-file-worker',
      leaseGeneration: 0,
      result: callbackResult,
    });
    expect(retry.deduped).toBe(true);

    const rows = await loadCaseFile(testPool, runId);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ round: 1, author_role: 'proposer' });
  });

  it('同 run 跨轮 proposer/reviewer 交替写入，loadCaseFile 按 round,author_role 升序返回全量案卷', async () => {
    const taskId = randomUUID();
    const runId = randomUUID();
    await testPool.query(
      `INSERT INTO tasks (id, title, status) VALUES ($1, $2, 'in_progress')`,
      [taskId, `gan case file multi-round ${taskId}`],
    );
    await testPool.query(
      `INSERT INTO initiative_runs (
         id, initiative_id, phase, current_task_id, orchestrator_version,
         created_source, record_trust_status
       ) VALUES ($1, $2, 'gan', $3, 'v2', 'kernel_dispatch', 'trusted')`,
      [runId, randomUUID(), taskId],
    );
    const store = createAttemptStore(testPool);

    const rounds = [
      { hop: 1, role: 'proposer', round: 1 },
      { hop: 2, role: 'reviewer', round: 1 },
      { hop: 3, role: 'proposer', round: 2 },
      { hop: 4, role: 'reviewer', round: 2 },
    ];
    for (const { hop, role, round } of rounds) {
      const attemptId = randomUUID();
      await store.createAttempt({
        id: attemptId,
        runId,
        hop,
        phase: 'gan',
        role,
        provider: 'auto',
        bundle: { inputs: { contract_round: round } },
        callbackSecretHash: 'b'.repeat(64),
      });
      await testPool.query(
        `UPDATE harness_attempts
            SET status = 'running', lease_owner = 'pg-case-file-worker',
                lease_expires_at = NOW() + INTERVAL '2 minutes'
          WHERE id = $1`,
        [attemptId],
      );
      await store.recordCallbackTerminal({
        attemptId,
        runId,
        leaseOwner: 'pg-case-file-worker',
        leaseGeneration: 0,
        result: {
          status: 'completed',
          summary: `${role} round ${round}`,
          artifacts: [],
          provider_metadata: { provider: 'codex' },
          decision: role === 'reviewer'
            ? { outcome: round === 2 ? 'APPROVED' : 'REVISION_REQUESTED', reason: 'ok' }
            : null,
          case_file: { blockers: [], feedback_md: `${role}-r${round}` },
        },
      });
    }

    const rows = await loadCaseFile(testPool, runId);
    expect(rows.map((row) => [row.round, row.author_role])).toEqual([
      [1, 'proposer'],
      [1, 'reviewer'],
      [2, 'proposer'],
      [2, 'reviewer'],
    ]);
  });

  it('P1：failed reviewer 不占位，同一 (run,round,role) 槽位换成第二个权威 completed reviewer 仍能落行', async () => {
    const taskId = randomUUID();
    const runId = randomUUID();
    await testPool.query(
      `INSERT INTO tasks (id, title, status) VALUES ($1, $2, 'in_progress')`,
      [taskId, `gan case file failed-then-authoritative ${taskId}`],
    );
    await testPool.query(
      `INSERT INTO initiative_runs (
         id, initiative_id, phase, current_task_id, orchestrator_version,
         created_source, record_trust_status
       ) VALUES ($1, $2, 'gan', $3, 'v2', 'kernel_dispatch', 'trusted')`,
      [runId, randomUUID(), taskId],
    );
    const store = createAttemptStore(testPool);

    // 第一次：reviewer attempt 基础设施崩溃，status=failed（即使意外带了
    // decision 也不该落案卷行，不能抢占槽位）。
    const firstAttemptId = randomUUID();
    await store.createAttempt({
      id: firstAttemptId,
      runId,
      hop: 1,
      phase: 'gan',
      role: 'reviewer',
      provider: 'auto',
      bundle: { inputs: { contract_round: 2 } },
      callbackSecretHash: 'a'.repeat(64),
    });
    await testPool.query(
      `UPDATE harness_attempts
          SET status = 'running', lease_owner = 'pg-case-file-worker',
              lease_expires_at = NOW() + INTERVAL '2 minutes'
        WHERE id = $1`,
      [firstAttemptId],
    );
    const firstOutcome = await store.recordCallbackTerminal({
      attemptId: firstAttemptId,
      runId,
      leaseOwner: 'pg-case-file-worker',
      leaseGeneration: 0,
      result: {
        status: 'failed',
        summary: 'infra crash',
        artifacts: [],
        provider_metadata: { provider: 'codex' },
        decision: { outcome: 'REVISION_REQUESTED', reason: 'incomplete' },
        error: { code: 'provider_exit', message: 'boom' },
      },
    });
    expect(firstOutcome.deduped).toBe(false);
    expect(await loadCaseFile(testPool, runId)).toEqual([]);

    // 第二次：同一 round 的权威 reviewer attempt 真正跑完，completed——如果第
    // 一次意外占了槽位，这里的 INSERT 会撞 ON CONFLICT DO NOTHING 被静默丢弃。
    const secondAttemptId = randomUUID();
    await store.createAttempt({
      id: secondAttemptId,
      runId,
      hop: 2,
      phase: 'gan',
      role: 'reviewer',
      provider: 'auto',
      bundle: { inputs: { contract_round: 2, contract_sha: 'b'.repeat(40) } },
      callbackSecretHash: 'b'.repeat(64),
    });
    await testPool.query(
      `UPDATE harness_attempts
          SET status = 'running', lease_owner = 'pg-case-file-worker',
              lease_expires_at = NOW() + INTERVAL '2 minutes'
        WHERE id = $1`,
      [secondAttemptId],
    );
    const secondOutcome = await store.recordCallbackTerminal({
      attemptId: secondAttemptId,
      runId,
      leaseOwner: 'pg-case-file-worker',
      leaseGeneration: 0,
      result: {
        status: 'completed',
        summary: 'contract approved',
        artifacts: [],
        provider_metadata: { provider: 'codex' },
        decision: { outcome: 'APPROVED', reason: 'covers the PRD' },
        case_file: { blockers: [], feedback_md: '# round 2 approved' },
      },
    });
    expect(secondOutcome.deduped).toBe(false);

    const rows = await loadCaseFile(testPool, runId);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      round: 2,
      author_role: 'reviewer',
      attempt_id: secondAttemptId,
    });
  });

  it('P2-3 膨胀闸1：loadCaseFile 只让最近 fullTextRounds 轮带 feedback_md 全文，更早轮次截断为 null', async () => {
    const taskId = randomUUID();
    const runId = randomUUID();
    await testPool.query(
      `INSERT INTO tasks (id, title, status) VALUES ($1, $2, 'in_progress')`,
      [taskId, `gan case file full-text-window ${taskId}`],
    );
    await testPool.query(
      `INSERT INTO initiative_runs (
         id, initiative_id, phase, current_task_id, orchestrator_version,
         created_source, record_trust_status
       ) VALUES ($1, $2, 'gan', $3, 'v2', 'kernel_dispatch', 'trusted')`,
      [runId, randomUUID(), taskId],
    );
    const store = createAttemptStore(testPool);

    for (const round of [1, 2, 3]) {
      const attemptId = randomUUID();
      await store.createAttempt({
        id: attemptId,
        runId,
        hop: round,
        phase: 'gan',
        role: 'reviewer',
        provider: 'auto',
        bundle: { inputs: { contract_round: round } },
        callbackSecretHash: 'c'.repeat(64),
      });
      await testPool.query(
        `UPDATE harness_attempts
            SET status = 'running', lease_owner = 'pg-case-file-worker',
                lease_expires_at = NOW() + INTERVAL '2 minutes'
          WHERE id = $1`,
        [attemptId],
      );
      await store.recordCallbackTerminal({
        attemptId,
        runId,
        leaseOwner: 'pg-case-file-worker',
        leaseGeneration: 0,
        result: {
          status: 'completed',
          summary: `round ${round}`,
          artifacts: [],
          provider_metadata: { provider: 'codex' },
          decision: { outcome: round === 3 ? 'APPROVED' : 'REVISION_REQUESTED', reason: 'ok' },
          case_file: { blockers: [], feedback_md: `full text round ${round}` },
        },
      });
    }

    const rows = await loadCaseFile(testPool, runId, { fullTextRounds: 2 });
    const byRound = Object.fromEntries(rows.map((row) => [row.round, row.feedback_md]));
    expect(byRound[1]).toBeNull(); // 最旧一轮，超出窗口，只留结构化字段
    expect(byRound[2]).toBe('full text round 2');
    expect(byRound[3]).toBe('full text round 3');

    // 全量读（无窗口限制，K 足够大）时三轮 feedback_md 都在——证明截断是
    // loadCaseFile 的可选投影，不是写入时就丢了数据。
    const untruncated = await loadCaseFile(testPool, runId, { fullTextRounds: 99 });
    const untruncatedByRound = Object.fromEntries(untruncated.map((row) => [row.round, row.feedback_md]));
    expect(untruncatedByRound[1]).toBe('full text round 1');
  });
});
