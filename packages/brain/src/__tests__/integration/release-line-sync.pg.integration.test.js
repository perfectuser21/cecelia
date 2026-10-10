/**
 * 发布线 × 真实合同同步（迁移 513 夹具 + 538 + 540）：
 * 合同同步写构建的同时登记内容版本、冷启动动生产指针、刷新流程生产配方；
 * 发布线挂钩出错（这里用触发器制造）只回滚到 savepoint，定义同步照常提交，current 照常前进。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { versionsDatabase, seedWorkflows } from '../fixtures/definition-versions-db.js';
import { contractsFixture } from '../fixtures/shared-activity-contracts.js';
import { migrationSql } from '../fixtures/minimum-definition-schema.js';
import { syncActivityContracts } from '../../activity-contract-sync.js';

vi.mock('../../alerting.js', () => ({ raise: vi.fn(async () => {}) }));

let fixture, db;
beforeEach(async () => {
  fixture = await versionsDatabase(); db = fixture.db; await seedWorkflows(db);
  await fixture.migrate();
  await fixture.client.query(migrationSql('538_activity_judgments.sql'));
  await fixture.client.query(migrationSql('540_release_line.sql'));
});
afterEach(async () => { if (fixture) await fixture.close(); });

const count = async (table) => (await db.query(`SELECT count(*)::int n FROM ${table}`)).rows[0].n;

describe('发布线 × 合同同步', () => {
  it('首次同步建版本与指针；重同步不出新版本；内容变化 bootstrap；配方随之追加', async () => {
    const f = contractsFixture();
    await syncActivityContracts(db, f);
    const builds = await count('activity_definition_versions');
    expect(await count('activity_versions')).toBe(builds);
    expect(await count('activity_release_state')).toBe(builds);
    expect(await count('workflow_production_recipes')).toBe(2);
    // 每个 Activity 生产指针 = current 所在构建的内容版本（执行端拿到的定义不变）
    const mismatch = (await db.query(`SELECT count(*)::int n FROM activities a JOIN activity_release_state s ON s.activity_id=a.id
      JOIN activity_version_builds m ON m.build_id=a.current_definition_version_id WHERE m.activity_version_id<>s.production_version_id`)).rows[0].n;
    expect(mismatch).toBe(0);

    await syncActivityContracts(db, f);
    expect(await count('activity_versions')).toBe(builds);
    expect(await count('workflow_production_recipes')).toBe(2);

    f.docs.keyword_acquisition.activities[0].name = '新版预检'; f.refresh();
    await syncActivityContracts(db, f);
    expect(await count('activity_versions')).toBe(builds + 1);
    const boot = (await db.query("SELECT reason FROM activity_release_events WHERE kind='bootstrap'")).rows;
    expect(boot).toEqual([{ reason: 'bootstrap_no_converged_baseline' }]);
    expect(await count('workflow_production_recipes')).toBeGreaterThan(2);
    expect((await db.query(`SELECT count(*)::int n FROM activities a JOIN activity_release_state s ON s.activity_id=a.id
      JOIN activity_version_builds m ON m.build_id=a.current_definition_version_id WHERE m.activity_version_id<>s.production_version_id`)).rows[0].n).toBe(0);
  });

  it('发布线挂钩出错 → 定义同步照常提交（fail-open），漏掉的由补账补上', async () => {
    await db.query(`CREATE FUNCTION rl_boom() RETURNS trigger AS $$BEGIN RAISE EXCEPTION '发布线炸了';END$$ LANGUAGE plpgsql;
      CREATE TRIGGER rl_boom BEFORE INSERT ON activity_versions FOR EACH ROW EXECUTE FUNCTION rl_boom()`);
    const f = contractsFixture();
    await expect(syncActivityContracts(db, f)).resolves.toBeDefined();
    expect(await count('activity_definition_versions')).toBeGreaterThan(0);
    expect(await count('activity_versions')).toBe(0);
    expect((await db.query('SELECT count(*)::int n FROM activities WHERE current_definition_version_id IS NOT NULL')).rows[0].n).toBeGreaterThan(0);
  });
});
