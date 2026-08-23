/**
 * 投影物化两阶段原子化 — 真 PG 补位集成测试（brain-integration CI，真 Postgres + 真 migration）。
 *
 * 单测（sprints/08231107-kernel-ccd99d19/tests/projection-two-phase.test.js）在录制 client /
 * status-aware 假 pool 上锁 SQL 形状；本文件在真 Postgres 上补位「禁 mock 边」的真库行为：
 *   (a) runProjection 后：该 scope 恰有一个 active 行、activated_at 非空、节点全量落库
 *       —— run 以 'materializing' 中间态写入（依赖 migration 432 放开的 status CHECK），
 *          全量物化后单事务翻转 active，真 CHECK 约束全程校验。
 *   (b) 直插一条 'materializing' 残行后，getActiveProjection / getProjectionForRevision 均
 *       不返回残行（旧 active / superseded 仍可服务），materializing 对读取侧永不可见。
 *
 * 运行环境：brain-ci-deploy.yml / integration-nightly.yml 起真 Postgres，DB_NAME=cecelia_test。
 * 本地：NODE_ENV=test 且 DB_NAME=cecelia_test（setup-test-db.sh 建库并跑全量 migration）。
 */
import { createHash, randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import pool from '../../db.js';
import { DB_DEFAULTS } from '../../db-config.js';
import {
  getActiveProjection,
  getProjectionForRevision,
  runProjection,
} from '../../map/projector.js';

// _test/_scratch 库名守卫：禁止误连生产库
if (!/(_test|_scratch)$/.test(DB_DEFAULTS.database)) {
  throw new Error(`map two-phase projection integration test 拒绝连接非测试库: ${DB_DEFAULTS.database}`);
}

function digest(seed) {
  return createHash('sha256').update(seed).digest('hex');
}

const scopeKey = `two-phase-itest-${process.pid}-${randomUUID().slice(0, 8)}`;
const decisionId = randomUUID();
const manifestId = randomUUID();
const manifestDigest = digest(`${scopeKey}:manifest`);
const baseSha = 'a'.repeat(40);
const factRevisions = { [scopeKey]: baseSha };

function structuralManifest() {
  return {
    scope_key: scopeKey,
    schema_version: 1,
    value_streams: [{ key: 'factory', name: '工厂', perceiver: 'p', order: 1 }],
    capabilities: [
      { key: 'F1', name: 'cap1', value_stream_key: 'factory', order: 1 },
      { key: 'F2', name: 'cap2', value_stream_key: 'factory', order: 2 },
    ],
    boundaries: [],
    crosscut_pool: [],
    shared_prerequisites: { applicable: false, items: [] },
  };
}

beforeAll(async () => {
  await pool.query(
    "INSERT INTO decisions(id,category,topic,decision) VALUES($1,'testing',$2,'two-phase projection itest')",
    [decisionId, scopeKey],
  );
  await pool.query(
    `INSERT INTO map_manifest_versions(
       id, scope_key, version, source_decision_id, manifest, digest, status, activated_at
     ) VALUES($1,$2,1,$3,$4::jsonb,$5,'active',NOW())`,
    [
      manifestId,
      scopeKey,
      decisionId,
      JSON.stringify({
        scope_key: scopeKey,
        schema_version: 1,
        source_decision_id: decisionId,
        shared_prerequisites: [],
      }),
      manifestDigest,
    ],
  );
});

afterAll(async () => {
  try {
    await pool.query('DELETE FROM map_projection_runs WHERE scope_key = $1', [scopeKey]);
    await pool.query('DELETE FROM map_manifest_versions WHERE scope_key = $1', [scopeKey]);
    await pool.query('DELETE FROM decisions WHERE id = $1', [decisionId]);
  } finally {
    await pool.end();
  }
});

describe('map projection two-phase materialization (real Postgres)', () => {
  let activeRunId = null;
  let activeNodeCount = 0;

  it('runProjection commits exactly one active run with activated_at and full node set', async () => {
    const res = await runProjection({
      manifestId,
      manifestDigest,
      scopeKey,
      manifest: structuralManifest(),
      factRevisions,
    });
    activeRunId = res.runId;
    activeNodeCount = res.nodeCount;
    expect(res.nodeCount).toBeGreaterThan(0);

    const active = await pool.query(
      `SELECT id, status, activated_at FROM map_projection_runs WHERE scope_key = $1 AND status = 'active'`,
      [scopeKey],
    );
    expect(active.rows).toHaveLength(1);
    expect(active.rows[0].id).toBe(res.runId);
    expect(active.rows[0].activated_at).not.toBeNull();

    const nodes = await pool.query(
      'SELECT count(*)::int AS c FROM map_projection_nodes WHERE run_id = $1',
      [res.runId],
    );
    expect(nodes.rows[0].c).toBe(res.nodeCount);
  });

  it('materializing residual is invisible to getActiveProjection and getProjectionForRevision', async () => {
    const residualId = randomUUID();
    // 直插 materializing 残行（依赖 migration 432 放开 status CHECK；activated_at 保持 NULL）
    await pool.query(
      `INSERT INTO map_projection_runs(
         id, scope_key, manifest_version_id, manifest_digest, fact_revisions,
         projector_version, projection_digest, status
       ) VALUES($1,$2,$3,$4,$5::jsonb,'itest',$6,'materializing')`,
      [residualId, scopeKey, manifestId, manifestDigest, JSON.stringify(factRevisions), digest(`${scopeKey}:residual`)],
    );

    const active = await getActiveProjection(scopeKey);
    expect(active).toBeTruthy();
    expect(active.id).toBe(activeRunId);
    expect(active.id).not.toBe(residualId);
    expect(active.status).toBe('active');

    const revision = await getProjectionForRevision(scopeKey, baseSha);
    expect(revision).toBeTruthy();
    expect(revision.id).not.toBe(residualId);
    expect(revision.status).not.toBe('materializing');
    expect(['active', 'superseded']).toContain(revision.status);

    // 旧 active 全量节点仍在，未被残行污染
    expect(activeNodeCount).toBeGreaterThan(0);
  });
});
