import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import { Client } from 'pg';
import {
  ELEMENT_KEYS,
  applyKernelHarnessF1Baseline,
  buildKernelHarnessF1BaselineReport,
} from '../../../packages/brain/src/lib/kernel-harness-f1-baseline.js';

const JOURNEY_ID = 'bb8cc561-b3ee-4fec-b74d-2255694bd963';
const HISTORY = [
  ['c5bae104-da5e-483d-b5ea-c295c90a3f28', 'Planner', 1, '374c40c2-ba63-81a0-8f93-f138607751f5'],
  ['d6dcdfaf-4b98-4717-bbe3-522f03f70757', 'GAN Proposer', 2, '374c40c2-ba63-8140-bf6d-e45c61375a6b'],
  ['e2bd9263-87ef-4461-a1d5-5ff07a38b8a8', 'GAN Reviewer', 3, '374c40c2-ba63-8197-9aa6-ef9da511d853'],
  ['0cdadc1a-e3a0-46a1-8333-ebbc102883f7', 'Generator', 4, '374c40c2-ba63-8159-8ce3-e2f1bd34c5ec'],
  ['1a738e05-99a7-421c-a52d-c2bb80bf19be', 'Evaluator', 5, '374c40c2-ba63-8133-8795-f21ca8576508'],
  ['a6888ef3-2482-4655-8703-cf3b9f037cb9', 'Final E2E', 6, '374c40c2-ba63-8149-81f6-ea2909746d5d'],
] as const;

let client: Client;
let runtimeBefore: unknown;

async function seedHistoricalFixture() {
  await client.query(`DELETE FROM journey_step_links WHERE journey_id=$1`, [JOURNEY_ID]);
  await client.query(`DELETE FROM journey_steps WHERE journey_id=$1`, [JOURNEY_ID]);
  await client.query(
    `INSERT INTO journeys
       (id, name, journey_type, maturity, status, home, domain, trigger, endpoint, notion_id)
     VALUES ($1,'Cecelia Harness Pipeline','dev_pipeline','skeleton','active','factory','工厂',
             '一个任务要做（主理人开口/Brain自派）',
             '合格PR合并+账本格子变绿+handoff可查',
             '35ac40c2-ba63-81db-a6fb-f0c3cb4f1ad4')
     ON CONFLICT (id) DO UPDATE SET
       name=EXCLUDED.name, endpoint=EXCLUDED.endpoint, notion_id=EXCLUDED.notion_id`,
    [JOURNEY_ID],
  );
  for (const [id, name, stepNumber, notionId] of HISTORY) {
    await client.query(
      `INSERT INTO journey_steps
         (id, journey_id, name, step_number, status, backbone_version, notion_id)
       VALUES ($1,$2,$3,$4,'done','1.0',$5)`,
      [id, JOURNEY_ID, name, stepNumber, notionId],
    );
  }
}

async function runtimeFingerprint() {
  const { rows } = await client.query(`
    SELECT
      (SELECT COUNT(*)::int FROM tasks) AS tasks_count,
      (SELECT COUNT(*)::int FROM initiative_runs) AS runs_count,
      (SELECT COUNT(*)::int FROM staging_e2e_results) AS staging_count
  `);
  return rows[0];
}

beforeAll(async () => {
  const databaseUrl = process.env.HARNESS_TEST_DATABASE_URL;
  if (!databaseUrl) throw new Error('HARNESS_TEST_DATABASE_URL 必须指向隔离测试库');
  client = new Client({ connectionString: databaseUrl });
  await client.connect();
  const { rows } = await client.query(`SELECT current_database() AS name`);
  if (!/(?:_test$|^preview_)/.test(rows[0].name)) {
    throw new Error(`拒绝写非隔离数据库: ${rows[0].name}`);
  }
  await client.query('BEGIN');
  await seedHistoricalFixture();
  runtimeBefore = await runtimeFingerprint();
  await applyKernelHarnessF1Baseline(client, { repoRoot: process.cwd() });
  await applyKernelHarnessF1Baseline(client, { repoRoot: process.cwd() });
});

afterAll(async () => {
  if (client) {
    await client.query('ROLLBACK');
    await client.end();
  }
});

describe.sequential('Kernel Harness F1 账本归位（真 PostgreSQL，禁 mock）', () => {
  it('唯一 F1 Journey 且二次应用不重复', async () => {
    const { rows } = await client.query(
      `SELECT id, name FROM journeys
       WHERE id=$1 OR name IN ('Cecelia Harness Pipeline','Kernel Harness Delivery')`,
      [JOURNEY_ID],
    );
    expect(rows).toEqual([{ id: JOURNEY_ID, name: 'Cecelia Harness Pipeline' }]);
    const { rows: duplicates } = await client.query(`
      SELECT lifecycle_stage, COUNT(*)::int AS count
      FROM journey_steps
      WHERE journey_id=$1 AND is_backbone=true
      GROUP BY lifecycle_stage HAVING COUNT(*) <> 1
    `, [JOURNEY_ID]);
    expect(duplicates).toEqual([]);
  });

  it('历史 ID 与 Notion 关联保留且 S0-S12 骨干完整', async () => {
    const { rows: history } = await client.query(
      `SELECT id, notion_id FROM journey_steps WHERE id = ANY($1::uuid[]) ORDER BY id`,
      [HISTORY.map(([id]) => id)],
    );
    expect(history).toHaveLength(6);
    for (const [id, , , notionId] of HISTORY) {
      expect(history).toContainEqual({ id, notion_id: notionId });
    }
    const { rows: stages } = await client.query(
      `SELECT lifecycle_stage FROM journey_steps
       WHERE journey_id=$1 AND is_backbone=true ORDER BY step_number`,
      [JOURNEY_ID],
    );
    expect(stages.map((row) => row.lifecycle_stage)).toEqual(
      Array.from({ length: 13 }, (_, index) => `S${index}`),
    );
  });

  it('每个 S0-S12 骨干 Step 恰有 11 个合法 element cells', async () => {
    expect(ELEMENT_KEYS).toEqual([
      'FR', 'NFR', '不变量', '判定点', '保质期', '死亡告警',
      '失败语义', '效果确认', '对抗面', '账本保鲜', '两轴衔接',
    ]);
    const { rows } = await client.query(`
      SELECT s.lifecycle_stage,
             COUNT(*)::int AS count,
             ARRAY_AGG(l.cell_key ORDER BY l.cell_key) AS keys,
             BOOL_AND(l.cell_status IN ('gray','red','pending','green','na')) AS statuses_ok
      FROM journey_steps s
      JOIN journey_step_links l ON l.step_id=s.id AND l.cell_kind='element'
      WHERE s.journey_id=$1 AND s.is_backbone=true
      GROUP BY s.lifecycle_stage ORDER BY MIN(s.step_number)
    `, [JOURNEY_ID]);
    expect(rows).toHaveLength(13);
    expect(rows.every((row) => row.count === 11 && row.statuses_ok)).toBe(true);
    expect(rows.flatMap((row) => row.keys)).toHaveLength(143);
  });

  it('green 只接受真实 assertion_ref 且引用存在', async () => {
    const report = await buildKernelHarnessF1BaselineReport(client, { repoRoot: process.cwd() });
    expect(report.invalid_assertion_refs).toEqual([]);
    expect(report.false_green_cells).toEqual([]);
    expect(report.cells.every((cell) =>
      ['gray', 'red', 'pending', 'green', 'na'].includes(cell.cell_status),
    )).toBe(true);
  });

  it('legacy P0/P1 基线字段完整且状态合法', async () => {
    const report = await buildKernelHarnessF1BaselineReport(client, { repoRoot: process.cwd() });
    expect(report.authoritative).toBe(false);
    expect(report.legacy_baseline.length).toBeGreaterThan(0);
    const statuses = ['active', 'shadowed', 'retired', 'drifted', 'unknown'];
    for (const item of report.legacy_baseline) {
      expect(item.legacy_owner).toBeTruthy();
      expect(statuses).toContain(item.audit_status);
      expect(item.unified_owner).toBeTruthy();
      expect(typeof item.gap).toBe('string');
      expect(item.next_knife_order).toBeGreaterThan(0);
    }
  });

  it('endpoint 延伸到 production verified 与 report learning', async () => {
    const { rows } = await client.query(`SELECT endpoint FROM journeys WHERE id=$1`, [JOURNEY_ID]);
    expect(rows[0].endpoint).toMatch(/production verified/i);
    expect(rows[0].endpoint).toMatch(/rollback anchor/i);
    expect(rows[0].endpoint).toMatch(/report\/learning/i);
    expect(rows[0].endpoint).not.toBe('合格PR合并+账本格子变绿+handoff可查');
  });

  it('不新增平行账本且运行时表状态不被迁移改写', async () => {
    const { rows } = await client.query(`
      SELECT table_name FROM information_schema.tables
      WHERE table_schema='public'
        AND table_name IN ('kernel_steps','behavior_ledger','kernel_harness_delivery')
    `);
    expect(rows).toEqual([]);
    expect(await runtimeFingerprint()).toEqual(runtimeBefore);
  });
});
