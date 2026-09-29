/**
 * 注册表对账迁移（任务 a7a6b8b4，交接单第 3 步）：notion_projection_map 与现实对齐。
 *   一、补登记确实在被写的库：OPC 经营对象 / OPC 日报（us-vps cron 镜子）、Key Results（KR Current 回写 + OKR 下行）、
 *       旧 Cecelia Tasks / Cecelia Projects（projection/outbox.js 曾写，决策 71e0087b 已停用 → archived）。
 *   二、「部门日报」推送方待核 → opc-daily-page.py upsert_dept_rows。
 *   三、unmapped:acceptance_criteria / unmapped:features_registry 是迁移 391 的视图别名，归档并写明真表。
 * 迁移号撞号会改，测试按文件名后缀定位。
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const migDir = fileURLToPath(new URL('../../migrations/', import.meta.url));
const SUFFIX = '_projection_map_reconcile';
const upName = readdirSync(migDir).find((f) => f.endsWith(`${SUFFIX}.sql`)) || '';
const version = upName.split('_')[0];
const read = (p) => { try { return readFileSync(p, 'utf8'); } catch { return ''; } };
const sql = read(`${migDir}${upName}`).replace(/^\s*--.*$/gm, '');
const downSql = read(`${migDir}rollback/${version}${SUFFIX}.down.sql`).replace(/^\s*--.*$/gm, '');

const OPC_OBJECTS = '3d6c40c2-ba63-811f-a83e-f981a044617d';
const OPC_DAILY = '3dbc40c2-ba63-81eb-b0c8-c571370b0f68';
const KEY_RESULTS = '684c40c2-ba63-83a7-b6ba-8161f110a18c';
const OLD_TASKS = '3b7c40c2-ba63-814b-b713-c350e5c5e356';
const OLD_PROJECTS = '3b7c40c2-ba63-8101-a1d1-e48a975a4204';
const DEPT_DAILY = '3dbc40c2-ba63-8168-8ec5-ea3aba0f25b9';

/** 取 VALUES 里含某 id 的那一行元组文本 */
const tupleOf = (id) => (sql.match(new RegExp(`\\('${id}'[^\\n]*`)) || [''])[0];

describe('migration-projection-map-reconcile 注册表对账迁移', () => {
  it('迁移文件存在且版本号为三位数', () => {
    expect(upName).toMatch(/^\d{3}_projection_map_reconcile\.sql$/);
    expect(sql).toMatch(new RegExp(`INSERT INTO schema_version[\\s\\S]*'${version}'[\\s\\S]*ON CONFLICT \\(version\\) DO NOTHING`));
  });

  it('补登记 OPC 两库为 us-vps cron 推送的镜子（真身飞书，无 Brain 表）', () => {
    expect(tupleOf(OPC_OBJECTS)).toMatch(/'OPC 经营对象', 'mirror', NULL, 'push', '[^']*opc-objects-sync\.py[^']*', 'active'/);
    expect(tupleOf(OPC_DAILY)).toMatch(/'OPC 日报', 'mirror', NULL, 'push', '[^']*opc-daily-page\.py[^']*', 'active'/);
  });

  it('补登记 Key Results 为入口：Current 列机器回写、Target 归主理人', () => {
    expect(tupleOf(KEY_RESULTS)).toMatch(/'Key Results', 'inlet', NULL, 'both', '[^']*opc-kr-current\.py[^']*opc-okr-sync\.py[^']*', 'active'/);
  });

  it('旧 Cecelia Tasks / Cecelia Projects 登记为已停写的归档镜子（写入方 projection/outbox.js，决策 71e0087b）', () => {
    const t = tupleOf(OLD_TASKS);
    expect(t).toMatch(/'Cecelia Tasks', 'mirror', 'tasks', 'none', '[^']*projection\/outbox\.js[^']*', 'archived'/);
    expect(t).toContain('71e0087b');
    expect(tupleOf(OLD_PROJECTS)).toMatch(/'Cecelia Projects', 'mirror', 'okr_projects', 'none', '[^']*projection\/outbox\.js[^']*', 'archived'/);
  });

  it('INSERT 幂等：ON CONFLICT DO NOTHING', () => {
    const insert = (sql.match(/INSERT INTO notion_projection_map[\s\S]*?;\n/) || [''])[0];
    for (const id of [OPC_OBJECTS, OPC_DAILY, KEY_RESULTS, OLD_TASKS, OLD_PROJECTS]) expect(insert).toContain(id);
    expect(insert).toMatch(/ON CONFLICT DO NOTHING;\n$/);
  });

  it('部门日报推送方核实为 opc-daily-page.py（仅改仍是「待核」的行）', () => {
    expect(sql).toMatch(new RegExp(`UPDATE notion_projection_map[^;]*opc-daily-page\\.py[^;]*WHERE notion_db_id = '${DEPT_DAILY}'[^;]*vessel = '\\(推送方待核\\)'`));
  });

  it('acceptance_criteria / features_registry 视图别名行归档，notes 写明真表，已归档不重复动', () => {
    for (const [view, real] of [['acceptance_criteria', 'journey_step_links'], ['features_registry', 'journey_features']]) {
      const re = new RegExp(`UPDATE notion_projection_map\\s+SET status = 'archived'[^;]*是视图别名[^;]*${real}[^;]*WHERE notion_db_id = 'unmapped:${view}'[^;]*status <> 'archived'`);
      expect(sql).toMatch(re);
    }
  });

  it('不碰 value_streams / backbone_activities（别的任务负责）', () => {
    expect(sql).not.toMatch(/unmapped:value_streams|unmapped:backbone_activities/);
  });

  it('回滚：删补登记行、两视图行回 pending_vessel、部门日报回待核、删版本', () => {
    const del = (downSql.match(/DELETE FROM notion_projection_map[\s\S]*?;/) || [''])[0];
    for (const id of [OPC_OBJECTS, OPC_DAILY, KEY_RESULTS, OLD_TASKS, OLD_PROJECTS]) expect(del).toContain(id);
    expect(downSql).toMatch(/status = 'pending_vessel'[^;]*unmapped:acceptance_criteria/);
    expect(downSql).toMatch(/status = 'pending_vessel'[^;]*unmapped:features_registry/);
    expect(downSql).toMatch(/vessel = '\(推送方待核\)'/);
    expect(downSql).toMatch(new RegExp(`DELETE FROM schema_version WHERE version = '${version}'`));
  });
});
