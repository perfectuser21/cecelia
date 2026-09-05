import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import pgPkg from 'pg';

// 禁 mock 边集成测试（真 Postgres）：成熟度回写 DB 写路径 + 幂等跳过 + 终态锚接力。
// RED：writebackStepMaturity / applyRunTerminalMaturity 尚未实现（import 后调用即抛）。
// 无 DB_URL 时（Sprint Tests 无库环境）跳过；brain-integration job 起真 PG 跑。
import {
  writebackStepMaturity,
} from '../../../packages/brain/src/lib/map-projection-store.js';
import {
  applyRunTerminalMaturity,
} from '../../../packages/brain/src/orchestrator/kernel-run-store.js';

const { Pool } = pgPkg;
const DB_URL = process.env.DB_URL || process.env.DATABASE_URL;
const SCOPE = `ZTEST-${Date.now()}`;

let pool: any;

async function seedActiveProjection(scope: string) {
  // 仅用 decisions + map_* 表（本 sprint 精确已读 schema），不 seed 复杂 initiative_run。
  await pool.query(`
    DO $$
    DECLARE d uuid; mvid uuid; runid uuid;
            dg text := encode(sha256(('${scope}-manifest')::bytea),'hex');
            pjg text := encode(sha256(('${scope}-proj')::bytea),'hex');
    BEGIN
      INSERT INTO decisions(category,topic,decision,reason,status)
        VALUES('judgment','writeback-it-${scope}','approved','integration seed','active') RETURNING id INTO d;
      INSERT INTO map_manifest_versions(scope_key,version,source_decision_id,manifest,digest,status,activated_at)
        VALUES('${scope}',1,d, jsonb_build_object('scope_key','${scope}','schema_version','1','source_decision_id',d::text), dg,'active',now())
        RETURNING id INTO mvid;
      INSERT INTO map_projection_runs(scope_key,manifest_version_id,manifest_digest,fact_revisions,projector_version,projection_digest,status,activated_at)
        VALUES('${scope}',mvid,dg,'{}'::jsonb,'map-projector-v1',pjg,'active',now()) RETURNING id INTO runid;
      INSERT INTO map_projection_nodes(run_id,node_id,node_type,node_key,name,attributes)
        VALUES(runid, encode(sha256(('${scope}:canvas:a')::bytea),'hex'),'stage','step-1','步骤1',
               jsonb_build_object('canvas_layer','stage','order_no',1,'maturity','unknown'));
    END $$;
  `);
}

async function maturityOf(scope: string, stepKey: string): Promise<string | null> {
  const { rows } = await pool.query(
    `SELECT n.attributes->>'maturity' AS m
       FROM map_projection_nodes n
       JOIN map_projection_runs r ON r.id = n.run_id
      WHERE r.scope_key=$1 AND r.status='active' AND n.node_type='stage' AND n.node_key=$2`,
    [scope, stepKey],
  );
  return rows[0]?.m ?? null;
}

async function stageCount(scope: string): Promise<number> {
  const { rows } = await pool.query(
    `SELECT count(*)::int AS c
       FROM map_projection_nodes n
       JOIN map_projection_runs r ON r.id = n.run_id
      WHERE r.scope_key=$1 AND r.status='active' AND n.node_type='stage'`,
    [scope],
  );
  return rows[0].c;
}

describe.skipIf(!DB_URL)('成熟度回写（真 Postgres）[BEHAVIOR]', () => {
  beforeAll(async () => {
    pool = new Pool({ connectionString: DB_URL });
    await seedActiveProjection(SCOPE);
  });

  afterAll(async () => {
    if (!pool) return;
    await pool.query("DELETE FROM map_projection_runs WHERE scope_key LIKE 'ZTEST-%'");
    await pool.query("DELETE FROM map_manifest_versions WHERE scope_key LIKE 'ZTEST-%'");
    await pool.query("DELETE FROM decisions WHERE topic LIKE 'writeback-it-ZTEST-%'");
    await pool.end();
  });

  it('回写更新 maturity 落库', async () => {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const res = await writebackStepMaturity(client, { scopeKey: SCOPE, stepKey: 'step-1', outcome: 'done' });
      await client.query('COMMIT');
      expect(res.updated).toBe(true);
      expect(res.skipped).toBe(false);
    } finally {
      client.release();
    }
    expect(await maturityOf(SCOPE, 'step-1')).toBe('passing');
  });

  it('缺失 step 幂等跳过不写脏', async () => {
    const before = await stageCount(SCOPE);
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const res = await writebackStepMaturity(client, { scopeKey: SCOPE, stepKey: 'no-such-step', outcome: 'failed' });
      await client.query('COMMIT');
      expect(res.updated).toBe(false);
      expect(res.skipped).toBe(true);
      expect(res.reason).toBe('step_not_found');
    } finally {
      client.release();
    }
    // 不写脏：stage 行数不变
    expect(await stageCount(SCOPE)).toBe(before);
  });

  it('终态锚接力 applyRunTerminalMaturity 触发回写', async () => {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      // 锚齐备 → 真回写 failed→failing
      const task = { payload: { map_scope: [SCOPE], gp_step_key: 'step-1' } };
      const res = await applyRunTerminalMaturity(client, { task, outcome: 'failed' });
      // 锚缺失 → 跳过 no_anchor（换代 receipt 锚过期语义）
      const noAnchor = await applyRunTerminalMaturity(client, { task: { payload: {} }, outcome: 'done' });
      await client.query('COMMIT');
      expect(res.updated).toBe(true);
      expect(noAnchor.skipped).toBe(true);
      expect(noAnchor.reason).toBe('no_anchor');
    } finally {
      client.release();
    }
    expect(await maturityOf(SCOPE, 'step-1')).toBe('failing');
  });
});
