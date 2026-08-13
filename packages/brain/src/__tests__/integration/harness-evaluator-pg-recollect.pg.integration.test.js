/**
 * harness-evaluator-pg-recollect.pg.integration.test.js —— Harness Evaluator 真环境取证闭环，真库实证。
 *
 * B-04: Evaluator 执行位真跑 PG（真实 psql 建隔离库表 + 查行），留 stdout/exit code。
 * B-06: Judge evidence_insufficient 缺证清单结构化落库（真 orchestrator_decision_log）→
 *       真实 dispatcher.buildInputs 组装下一轮 Evaluator bundle，inputs.judge_feedback 非空。
 *
 * 禁 mock 被改的边：evaluator 执行位 ↔ PostgreSQL（真 psql / 真 Pool，不 mock pg/Pool）；
 *   harness-judge ↔ DB judge verdict 落库表（真 orchestrator_decision_log INSERT/SELECT，不 mock pool/client）；
 *   dispatcher(evaluator buildInputs) ↔ Evaluator TaskBundle.inputs（真实 buildInputs 组装，不 mock）。
 *
 * 会话独享隔离库（INV 多租户/禁写死环境）：库名含 process.pid + uuid，单一 databaseName 变量
 *   贯穿建库/psql 连接/销毁（写入侧=校验侧同一变量）；afterAll DROP DATABASE（attempt 独享、用完销毁）。
 */
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DB_DEFAULTS } from '../../db-config.js';
import { appendHop } from '../../orchestrator/decision-log.js';
import { resolveAction, __test__ as dispatcherTest } from '../../orchestrator/dispatcher.js';

const { Pool } = pg;
const { buildInputs } = dispatcherTest;

// 会话独享隔离库名：单一 databaseName 变量贯穿建库/连接/psql/销毁（禁写死库名，写入侧=校验侧同一变量）
const databaseName = `harness_pg_recollect_${process.pid}_${randomUUID().replaceAll('-', '')}`;
let adminPool;
let testPool;

function quotedIdentifier(value) {
  if (!/^harness_pg_recollect_[a-z0-9_]+$/.test(value)) {
    throw new Error(`unsafe test database identifier: ${value}`);
  }
  return `"${value}"`;
}

// 最小真实 schema（orchestrator_decision_log 真表 + 上游 FK）：与 migration 312 的 decision log
// 结构对齐（run_id FK → initiative_runs、UNIQUE(run_id,hop)），但不跑全量 migrate（其含 pgvector
// 依赖，Fleet PG 不一定装 vector 扩展）。落的仍是真 PostgreSQL 行，禁 mock pg/Pool 的要求满足。
const MINIMAL_SCHEMA_SQL = `
CREATE TABLE tasks (id uuid PRIMARY KEY, title text, status text);
CREATE TABLE initiative_runs (
  id uuid PRIMARY KEY,
  initiative_id uuid,
  phase text,
  current_task_id uuid,
  orchestrator_version text,
  created_source text,
  record_trust_status text
);
CREATE TABLE orchestrator_decision_log (
  id bigserial PRIMARY KEY,
  run_id uuid NOT NULL REFERENCES initiative_runs(id),
  hop int NOT NULL,
  observed jsonb NOT NULL,
  derived_phase text,
  gate_verdict text,
  action text NOT NULL,
  detail jsonb,
  created_at timestamptz DEFAULT now(),
  CONSTRAINT uq_orchestrator_decision_log_run_hop UNIQUE (run_id, hop)
);`;

beforeAll(async () => {
  // CI 上（dod-behavior-dynamic）Brain server 并发占用连接，CREATE DATABASE 偶发阻塞。
  // fail-fast 连接 + 每次尝试 statement_timeout 上限 + 有限重试，整段稳收在 hook 30s 内。
  adminPool = new Pool({ ...DB_DEFAULTS, database: 'postgres', max: 1, connectionTimeoutMillis: 6000 });
  let created = false;
  for (let attempt = 0; attempt < 3 && !created; attempt += 1) {
    const client = await adminPool.connect();
    try {
      await client.query('SET statement_timeout = 6000');
      await client.query(`CREATE DATABASE ${quotedIdentifier(databaseName)}`);
      created = true;
    } catch (err) {
      if (!/timeout|deadlock|too many|being accessed|canceling statement/i.test(String(err.message))) {
        throw err;
      }
      await new Promise((resolve) => setTimeout(resolve, 300));
    } finally {
      client.release();
    }
  }
  if (!created) throw new Error(`CREATE DATABASE ${databaseName} 多次重试仍失败（CI 连接争用）`);
  testPool = new Pool({ ...DB_DEFAULTS, database: databaseName, max: 4, connectionTimeoutMillis: 6000 });
  await testPool.query(MINIMAL_SCHEMA_SQL);
}, 60_000);

afterAll(async () => {
  if (testPool) await testPool.end();
  if (adminPool) {
    let activeSessions = 1;
    for (let attempt = 0; attempt < 250 && activeSessions > 0; attempt += 1) {
      const result = await adminPool.query(
        `SELECT COUNT(*)::int AS count FROM pg_stat_activity WHERE datname = $1`,
        [databaseName],
      );
      activeSessions = result.rows[0].count;
      if (activeSessions > 0) await new Promise((resolve) => setTimeout(resolve, 20));
    }
    await adminPool.query(`DROP DATABASE IF EXISTS ${quotedIdentifier(databaseName)}`);
    await adminPool.end();
  }
}, 30_000);

describe('B-04 Evaluator 执行位真跑 PG，留 exit code', () => {
  it('PG 真跑留 exit code', () => {
    // 真实 psql（非 pg driver）建/查隔离库表，采集真实退出码 —— INV-1 真环境验证
    const sql = 'CREATE TABLE harness_pg_probe(id int);'
      + 'INSERT INTO harness_pg_probe VALUES (1);'
      + 'SELECT count(*) AS n FROM harness_pg_probe;';
    let exitCode = -1;
    let stdout = '';
    try {
      stdout = execFileSync(
        'psql',
        ['-v', 'ON_ERROR_STOP=1', '-tA', '-c', sql],
        {
          env: {
            ...process.env,
            PGHOST: DB_DEFAULTS.host,
            PGPORT: String(DB_DEFAULTS.port),
            PGUSER: DB_DEFAULTS.user,
            PGPASSWORD: DB_DEFAULTS.password,
            PGDATABASE: databaseName,
          },
          encoding: 'utf8',
        },
      );
      exitCode = 0;
    } catch (err) {
      exitCode = typeof err.status === 'number' ? err.status : 1;
      stdout = String(err.stdout ?? '') + String(err.stderr ?? '');
    }
    // 真实 psql exit_code=0，隔离库真实建成、查得到写入行（count=1）
    expect(exitCode).toBe(0);
    expect(stdout.trim().split('\n').pop().trim()).toBe('1');
  });
});

describe('B-06 Judge evidence_insufficient 落库 missing_evidence 非空 + recollect 回灌', () => {
  it('judge evidence_insufficient 落库 missing_evidence 非空', async () => {
    const taskId = randomUUID();
    const runId = randomUUID();
    const headSha = 'b'.repeat(40);
    await testPool.query(
      `INSERT INTO tasks (id, title, status) VALUES ($1, $2, 'in_progress')`,
      [taskId, `harness pg recollect ${taskId}`],
    );
    await testPool.query(
      `INSERT INTO initiative_runs (
         id, initiative_id, phase, current_task_id, orchestrator_version,
         created_source, record_trust_status
       ) VALUES ($1, $2, 'evaluate', $3, 'v2', 'kernel_dispatch', 'trusted')`,
      [runId, randomUUID(), taskId],
    );

    const missingEvidence = [
      '缺 PG 必验项 psql exit code（behavior_tests 无真跑证据）',
      '缺隔离库写入行回读证据',
    ];
    const rawFeedback = '合同要求 postgres 真跑，但证据缺 psql stdout/exit code —— 请补真环境取证';
    const judgeDetail = {
      verdict: 'FAIL',
      pr_head_sha: headSha,
      failure_class: 'evidence_insufficient',
      missing_evidence: missingEvidence,
      feedback: rawFeedback,
    };

    // 真库落库 judge evidence_insufficient verdict（含结构化 missing_evidence）
    await appendHop(testPool, {
      runId,
      hop: 5,
      observed: { pr: { head_sha: headSha } },
      derivedPhase: 'evaluate',
      action: 'verdict:judge',
      detail: judgeDetail,
    });

    // 回读：missing_evidence 结构化落库、非空
    const { rows } = await testPool.query(
      `SELECT detail FROM orchestrator_decision_log WHERE run_id = $1 AND action = 'verdict:judge'`,
      [runId],
    );
    expect(rows).toHaveLength(1);
    const persisted = rows[0].detail;
    expect(Array.isArray(persisted.missing_evidence)).toBe(true);
    expect(persisted.missing_evidence.length).toBeGreaterThan(0);
    expect(persisted.missing_evidence).toEqual(missingEvidence);

    // recollect：真实 dispatcher.buildInputs 组装下一轮 Evaluator bundle，
    // inputs.judge_feedback 携带缺证清单 + 原始反馈（打破同构重跑）
    const spec = resolveAction('spawn:evaluator');
    const inputs = buildInputs(
      'spawn:evaluator',
      spec,
      {
        taskId,
        runId,
        hop: 6,
        decision: { phase: 'evaluate', reason: 'judge_evidence_insufficient_recollect' },
        observed: {
          task: { id: taskId, title: 'recollect', payload: { sprint_dir: 'sprints/pg', worktree_path: '/tmp/w' } },
          run: { id: runId, phase: 'evaluate' },
          contract: { approved: true, row: { branch: 'cp-approved' } },
          pr: { url: 'https://github.com/perfectuser21/cecelia/pull/1', head_ref: 'cp-approved', head_sha: headSha },
          judgeVerdict: persisted,
        },
      },
      { logicalCycleId: 'lc-1', attemptKind: 'initial', workstreamKey: 'ws1' },
    );

    expect(inputs.judge_feedback).toBeTruthy();
    expect(inputs.judge_feedback.missing_evidence).toEqual(missingEvidence);
    expect(inputs.judge_feedback.raw_feedback).toBe(rawFeedback);
    expect(inputs.judge_feedback.raw_feedback.length).toBeGreaterThan(0);
  });
});
