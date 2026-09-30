// 价值流建模③ 冻结回归测试（决策 3e867cad 第 4-5 张表；决策 752b7166 Workflow=某渠道可执行链条）
//
// 禁 mock 边（v9.12）：本单是 DB 写路径 + 跨表建模，测试必须打真实 Postgres，
// 严禁 mock pg / db.js —— 被改的边（代码↔workflows/journey_steps/ops_workflows、workflow↔activity 桥）
// 只有真库才能验出接缝断裂（列缺失/约束缺失/种子未灌/物理副本重复）。
//
// RED 依据：迁移 493 未落地前，workflows 表 / journey_steps 新列 / ops_workflows.workflow_id
// 全部不存在，下列查询会抛错（relation/column does not exist）→ 测试红。
// 迁移 493 + 种子落地并被 node src/migrate.js 应用后 → 全绿。
//
// DB 连接：优先 TEST_DATABASE_URL（harness "Sprint Tests 实跑" job 的 cecelia_test 全量迁移库），
// 回退 DATABASE_URL / DB / DB_URL。无任何连接串 = 环境未就绪 = 失败（不静默 skip）。
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import pg from 'pg';

const CONN =
  process.env.TEST_DATABASE_URL ||
  process.env.DATABASE_URL ||
  process.env.DB ||
  process.env.DB_URL;

const KEYWORD_CAP = 'keyword_acquisition';
const WF_PRIMARY = '抖音·关键词获客';
const WF_BENCHMARK = '对标获客';

let client: pg.Client;

beforeAll(async () => {
  if (!CONN) {
    throw new Error(
      'FAIL: 无 DB 连接串（需 TEST_DATABASE_URL / DATABASE_URL / DB / DB_URL），环境未就绪'
    );
  }
  client = new pg.Client({ connectionString: CONN });
  await client.connect();
});

afterAll(async () => {
  if (client) await client.end();
});

describe('价值流建模③: workflows + backbone_activities 改挂 + ops_workflows.workflow_id [BEHAVIOR]', () => {
  it('workflows 表存在且含 capability_id channel version status 列', async () => {
    const { rows } = await client.query(
      `SELECT column_name FROM information_schema.columns
        WHERE table_name = 'workflows'`
    );
    const cols = rows.map((r) => r.column_name);
    for (const c of ['capability_id', 'channel', 'version', 'status']) {
      expect(cols).toContain(c);
    }
  });

  it('journey_steps 含 workflow_id executor_kind enabler_id 三列', async () => {
    const { rows } = await client.query(
      `SELECT column_name, is_nullable FROM information_schema.columns
        WHERE table_name = 'journey_steps'
          AND column_name IN ('workflow_id','executor_kind','enabler_id')`
    );
    const byName = Object.fromEntries(rows.map((r) => [r.column_name, r.is_nullable]));
    expect(Object.keys(byName).sort()).toEqual(['enabler_id', 'executor_kind', 'workflow_id']);
    // enabler_id 必须可空（Call Activity 不调用共用件时为 NULL）
    expect(byName.enabler_id).toBe('YES');
  });

  it('executor_kind CHECK 拒绝非法值', async () => {
    // 取一个 keyword_acquisition 活动，试图写非法 executor_kind，期望被 CHECK 拒绝；事务回滚不留痕
    const { rows } = await client.query(
      `SELECT id FROM journey_steps WHERE capability_key = $1 LIMIT 1`,
      [KEYWORD_CAP]
    );
    expect(rows.length).toBe(1);
    const id = rows[0].id;
    await client.query('BEGIN');
    let rejected = false;
    try {
      await client.query(
        `UPDATE journey_steps SET executor_kind = 'illegal_kind' WHERE id = $1`,
        [id]
      );
    } catch {
      rejected = true;
    } finally {
      await client.query('ROLLBACK');
    }
    expect(rejected).toBe(true);
    // 合法值 code|agent|human 三者都应被接受（回滚，不留痕）
    for (const legal of ['code', 'agent', 'human']) {
      await client.query('BEGIN');
      await client.query(`UPDATE journey_steps SET executor_kind = $2 WHERE id = $1`, [id, legal]);
      await client.query('ROLLBACK');
    }
  });

  it('抖音·关键词获客 workflow 下挂 8 个 keyword_acquisition 活动', async () => {
    const wf = await client.query(`SELECT id FROM workflows WHERE name = $1`, [WF_PRIMARY]);
    expect(wf.rows.length).toBe(1);
    const wfId = wf.rows[0].id;
    // 8 个骨干活动 workflow_id 已回填到该 workflow，且 executor_kind 合法非空
    const acts = await client.query(
      `SELECT id, executor_kind FROM journey_steps
        WHERE capability_key = $1 AND workflow_id = $2`,
      [KEYWORD_CAP, wfId]
    );
    expect(acts.rows.length).toBe(8);
    for (const r of acts.rows) {
      expect(['code', 'agent', 'human']).toContain(r.executor_kind);
    }
  });

  it('对标获客 workflow 共用 7 个活动且无物理副本', async () => {
    const wf = await client.query(`SELECT id FROM workflows WHERE name = $1`, [WF_BENCHMARK]);
    expect(wf.rows.length).toBe(1);
    const wfId = wf.rows[0].id;
    // 共用 = 桥表 workflow_activities 为对标获客登记 7 条链接，且这 7 条指向的活动
    // 就是 keyword_acquisition 的既有行（非新插入的物理副本）
    const links = await client.query(
      `SELECT wa.activity_id FROM workflow_activities wa WHERE wa.workflow_id = $1`,
      [wfId]
    );
    expect(links.rows.length).toBe(7);
    const shared = await client.query(
      `SELECT count(*)::int AS n FROM workflow_activities wa
        JOIN journey_steps js ON js.id = wa.activity_id
       WHERE wa.workflow_id = $1 AND js.capability_key = $2`,
      [wfId, KEYWORD_CAP]
    );
    expect(shared.rows[0].n).toBe(7);
    // 未因共用而复制物理行：keyword_acquisition 骨干活动仍是 8 行（最新 backbone_version）
    const total = await client.query(
      `SELECT count(*)::int AS n FROM journey_steps
        WHERE capability_key = $1
          AND backbone_version = (
            SELECT max(backbone_version) FROM journey_steps WHERE capability_key = $1
          )`,
      [KEYWORD_CAP]
    );
    expect(total.rows[0].n).toBe(8);
  });

  it('ops_workflows 含可空 workflow_id 列', async () => {
    const { rows } = await client.query(
      `SELECT is_nullable FROM information_schema.columns
        WHERE table_name = 'ops_workflows' AND column_name = 'workflow_id'`
    );
    expect(rows.length).toBe(1);
    expect(rows[0].is_nullable).toBe('YES');
  });

  it('schema_version 含 493 记录', async () => {
    const { rows } = await client.query(`SELECT version FROM schema_version WHERE version = '493'`);
    expect(rows.length).toBe(1);
  });
});
