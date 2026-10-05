/**
 * 迁移 519 结构断言（框架标准 v2.0 · 流程层登记，任务 6741b288）：
 * 旧树 journey_features 里的 ability（能力×平台/渠道）其实就是标准里的「流程（workflow）」，
 * 本迁移把它们登记进 workflows（挂到 部门→价值流→能力 下），为每个有闹钟的能力补默认流程，
 * 并把闹钟总账 ops_schedule_entries.workflow_id 回填；旧树只标 deprecated 不删。
 * CI 用空库跑全量迁移，所以所有 INSERT 必须守卫（能力不存在就跳过），不能裸 VALUES。
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const up = fileURLToPath(new URL('../../migrations/519_workflow_layer_registration.sql', import.meta.url));
const down = fileURLToPath(new URL('../../migrations/rollback/519_workflow_layer_registration.down.sql', import.meta.url));
const sql = existsSync(up) ? readFileSync(up, 'utf8') : '';
const downSql = existsSync(down) ? readFileSync(down, 'utf8') : '';

// workflows.key 合法形状（494 定下：小写字母开头，只许 a-z 0-9 _ . -）
const KEY_RE = /^[a-z][a-z0-9_.-]{0,99}$/;

// 旧 ability → 新流程（feature_id, key, capability_id）
const CONVERTED = [
  ['ae16ed67-1e1a-47fb-9f31-b6bfec165480', 'bilibili_video_publish.android', '24987ee5-53a0-4c37-946f-1b749954cac7'],
  ['f4f56de0-a51c-4778-a458-d9abb863f01a', 'toutiao_video_publish.android', '24987ee5-53a0-4c37-946f-1b749954cac7'],
  ['c34f7f5a-8338-48c3-b043-77c3ddf5ff78', 'xiaohongshu_video_publish.android', '24987ee5-53a0-4c37-946f-1b749954cac7'],
  ['8bfacdbd-c44c-4e35-bdab-83ce8f726afb', 'wechat_channels_video_publish.android', '24987ee5-53a0-4c37-946f-1b749954cac7'],
  ['cf668390-b068-4250-9404-038aaa0ba810', 'weibo_video_publish.android', '24987ee5-53a0-4c37-946f-1b749954cac7'],
  ['2fd81a59-b1e8-4105-b49b-a1dcbf842c48', 'kuaishou_video_publish.android', '24987ee5-53a0-4c37-946f-1b749954cac7'],
  ['d82e0352-ebf9-4879-8982-c0e4858552dc', 'douyin_video_publish.android', '24987ee5-53a0-4c37-946f-1b749954cac7'],
  ['c071614b-1562-4332-9c0b-937d845ed4d6', 'zhihu_video_publish.android', '24987ee5-53a0-4c37-946f-1b749954cac7'],
  ['1e4ee48d-365d-4373-a4bc-86a20a917289', 'wechat_cs_reply_delivery', 'ac2e35bc-849a-48cd-917f-79d15c5ac886'],
  ['f2913c7a-3da8-4d03-bb8f-0068c9a9d711', 'wechat_moments_compose_publish', '016459f9-98e0-40a2-a89e-92f8d34bb661'],
  ['ee0b211c-46fc-4bdb-aaa4-cab6c46832e4', 'cs_ops_report', '3ae2414e-3e92-4471-9908-892245b4e37a'],
  ['82a9cd0e-fb32-4498-a6a9-0e74402dc63a', 'wechat_moments_engagement', 'b6a73832-b42b-4678-87ca-3ce00a6d70dd'],
  ['03dee814-e720-4b59-b5c2-61a6c426d8bd', 'wechat_group_ops', '8fe9ed6b-999a-4041-8126-8567f68d3dea'],
  ['0c78270b-0204-409e-9bef-466328c96c83', 'knowledge_collab_notes', '4c1c7271-b31d-46a6-9492-5a39ff9ca490'],
  ['6c142e76-0b0c-4134-96e8-8e7c62b54a0e', 'knowledge_experience_qa', 'c61db58c-7423-4cd5-b58d-6363cf9a49ea'],
  ['e8031829-4b2e-4fc5-802b-1734ee7c3431', 'knowledge_structured_workbench', '23a91349-18bf-4901-8e8f-ee0438e4c6db'],
  ['52f8ce0a-348c-4d87-9b4d-013525657a5e', 'shopify_product_draft_listing', '6bd7e841-14bf-4630-b667-418c39a64918'],
  ['028570eb-b461-4bfe-802a-d450ab59de73', 'video_batch_remix', '8cb5e709-1c6d-4f1a-9320-94b51a91ed3b'],
  ['5d019e98-5a97-4291-943e-9050d4bf88b7', 'video_remake_pipeline', '3cb652ee-2756-4bff-8fa2-27ef94da1555'],
  ['c36467aa-c59a-4319-af21-b36c16b8d82b', 'owner_dialog_loop', '8bb8252f-29b4-4c34-acb9-1accda7ddfcf'],
  ['228e77c0-4016-4936-9283-63c723c677b0', 'task_intake_and_dispatch', 'fad72424-8ca2-4587-979a-86aff1b6aceb'],
  ['d7b8b3c6-7ba3-4798-a9fa-2902e680a0de', 'delivery_human_acceptance', 'e6f803f2-8c48-4cce-a7a1-5b1bda5e9c29'],
];

// 有闹钟但没有流程的能力 → 默认定时作业流程（key）
const DEFAULT_OPS = [
  'content_calendar_ops', 'factory_f0_ops', 'factory_f1_ops', 'factory_f2_ops', 'factory_f3_ops', 'factory_f4_ops',
  'factory_mj5_ops', 'skill_lifecycle_ops', 'customer_first_success_ops', 'publish_account_session_ops',
  'butler_g1_cockpit_ops', 'butler_g2_inbox_ops', 'butler_g4_memory_ops', 'okr_kr_sync_ops',
  'infra_distribution_sync_ops', 'infra_backup_restore_ops', 'infra_runner_pool_ops', 'infra_data_projection_ops',
  'infra_cleanup_capacity_ops', 'infra_monitoring_alerting_ops', 'infra_network_ingress_ops',
  'infra_device_phone_ledger_ops', 'infra_account_credentials_ops',
  'biz_rhythm_meetings_ops', 'biz_object_ledger_ops', 'biz_broadcast_ops',
];

// PC 端发布套 21 条（决策 117660b0 整套淘汰）
const PC_PUBLISH = [
  '1bbf5d4b-35f4-49a2-84f7-f5666163df90', '8677b2d1-8887-4b7c-88ed-eea4e6a8afa9', 'fef041e5-4a8e-4c3d-9dbd-0842bc03325a',
  '74335c04-78b5-438c-983a-32db3ce52881', '116a9fc6-0e93-423e-8a2c-b0e7664c6f12', '01c89148-a084-4de1-8582-b474a38a726a',
  'fdb7c6e3-47da-4903-b990-75090c4a7153', '3acfe778-b20d-4e83-a237-cb96fddb1fdf', '4c736fe3-af2f-4a40-9787-e172a05e0e18',
  '2e65234b-fc45-42b0-b6f2-f0eefd7950d9', '99d14f48-d229-4fed-86db-2530fab01fca', '6a64605a-39dd-4931-a2e4-77640c57a513',
  '01321fec-0491-42a4-b2f1-32a73d674e3a', '87a1b506-f472-4e89-9e43-0ecc6b7f3632', 'e82e5d65-913d-4bb5-a209-f184c3ebfc1b',
  '927f6ea0-f3a2-4b3b-99e0-8f5f07dafada', '9906ba78-12d5-44dd-ab94-8a641323c1b4', 'f8d1f8a2-1fd0-4adf-b006-e6762e4950fb',
  'f02caa3a-6968-484d-8a2e-3deae7951789', 'eb80afc2-c231-4569-ab5c-4fd40a55b7f2', 'd7f8619e-2545-4033-b55c-81ff8ae6b1af',
];

// 与能力重名的 GP-B~F 五条 + 已转换行的重复行 + Canvas 骨架（并入 video_remake_pipeline）
const DUPLICATES = [
  'b6f99758-ac17-48b8-82e2-98f95bcd5d49', 'de0a5313-94cb-476c-8de8-384971362164', 'cc3cef4d-4c61-4aa1-8e11-3a50011ca739',
  '74d1faac-c811-4462-a212-b73f711e00c1', '49c7414c-8f5f-4581-b3f8-7882b483f501',
  '1611c212-ff10-4680-930a-eded862a0d28', 'c379bf9f-e6c4-470f-b45c-66a767c81eb7', '80e78da8-6e53-409e-bc01-3231f9be8a21',
  '83c23dd0-ce04-4aa6-8f7f-6f5b03a309f3', '1fd3c05d-0280-4fc3-a08f-709d5284a4d5', '19e427c8-237f-4d1f-85b1-f33e0481b56c',
];

// 昨日误建的两条重复能力（已有同义能力 协同笔记/经验沉淀/结构化工作台、批量混剪/视频剪辑流水线）
const DUP_CAPABILITIES = ['b8268218-920f-4a49-827b-4f739d8ea705', 'f41c3921-8fb7-408c-978f-1e02ee66ced1'];

const section = (name) => {
  const m = sql.match(new RegExp(`-- ===+ ${name}[\\s\\S]*?(?=\\n-- ===+ |\\nINSERT INTO schema_version)`));
  return m ? m[0] : '';
};

describe('migration 519 — 流程层登记：旧 ability → workflows，闹钟回填 workflow_id', () => {
  it('文件存在（含回滚脚本）', () => {
    expect(existsSync(up)).toBe(true);
    expect(existsSync(down)).toBe(true);
  });

  it('workflows 加 legacy_feature_id 溯源列（指向 journey_features，删旧行只置空）', () => {
    expect(sql).toMatch(/ALTER TABLE workflows ADD COLUMN IF NOT EXISTS legacy_feature_id uuid[^;]*REFERENCES journey_features\(id\) ON DELETE SET NULL/);
    expect(downSql).toMatch(/ALTER TABLE workflows DROP COLUMN IF EXISTS legacy_feature_id/);
  });

  it('所有 INSERT INTO workflows 都走 FROM (VALUES …) + 能力存在守卫 + ON CONFLICT (key) DO NOTHING，没有裸 VALUES', () => {
    const inserts = sql.match(/INSERT INTO workflows[\s\S]*?;/g) || [];
    expect(inserts.length).toBeGreaterThanOrEqual(2);
    for (const stmt of inserts) {
      expect(stmt).toMatch(/FROM \(VALUES/);
      expect(stmt).toMatch(/WHERE EXISTS \(SELECT 1 FROM journeys j WHERE j\.id = v\.capability_id(::uuid)? AND j\.parent_journey_id IS NOT NULL\)/);
      expect(stmt).toMatch(/ON CONFLICT \(key\) DO NOTHING/);
    }
    expect(sql).not.toMatch(/INSERT INTO workflows\s*\([^)]*\)\s*VALUES/);
  });

  it('22 条旧 ability 逐条转成流程：feature_id / key / 能力 id 同行出现，key 形状合法且全文件唯一', () => {
    const keys = [...sql.matchAll(/^\s*\('([a-z][a-z0-9_.-]*)',/gm)].map((m) => m[1]);
    expect(new Set(keys).size).toBe(keys.length);
    for (const k of keys) expect(k).toMatch(KEY_RE);
    for (const [featureId, key, capId] of CONVERTED) {
      const row = sql.split('\n').find((l) => l.includes(`'${key}'`) && l.includes(capId));
      expect(row, `${key} 必须挂到能力 ${capId}`).toBeTruthy();
      expect(row).toContain(featureId);
    }
  });

  it('为每个有闹钟但没流程的能力建默认定时作业流程；关键词获客复用既有 douyin_keyword_leadgen 不新建', () => {
    for (const key of DEFAULT_OPS) expect(sql, key).toContain(`'${key}'`);
    expect(sql).not.toMatch(/\('[a-z0-9_.-]+',[^\n]*'a1000000-0000-4000-8000-000000000001'/);
    expect(sql).toContain(`'douyin_keyword_leadgen'`);
  });

  it('闹钟先归位能力（含 11 条挂在经营节奏价值流上的 OKR 闹钟 → G5），再按能力→流程回填 workflow_id，只填空值', () => {
    expect(sql).toMatch(/UPDATE ops_schedule_entries[\s\S]*?SET journey_id = 'dddddddd-f0f0-4000-8000-000000000004'[\s\S]*?WHERE journey_id = 'c5cb480f-f7f7-4b4e-8871-bd65ff65b668'/);
    expect(sql).toMatch(/UPDATE ops_schedule_entries e\s+SET workflow_id = w\.id[\s\S]*?JOIN workflows w ON w\.key = m\.key[\s\S]*?WHERE e\.journey_id = m\.capability_id(::uuid)?\s+AND e\.workflow_id IS NULL/);
    // 收盘报告 64600 → 经营播报；热点推送×2 / 天气 保持「个人区（不进公司树）」不碰
    expect(sql).toMatch(/64600[\s\S]{0,400}01368ac4-4b6f-4628-b8be-ac7a82542913|01368ac4-4b6f-4628-b8be-ac7a82542913[\s\S]{0,400}64600/);
    for (const id of ['64604', '64607', '64610']) expect(sql).not.toMatch(new RegExp(`\\b${id}\\b`));
    // 投资系统 run_daily.py 是个人区
    expect(sql).toMatch(/71957[\s\S]{0,200}个人区（不进公司树）|个人区（不进公司树）[\s\S]{0,200}71957/);
  });

  it('旧树只标 deprecated 不删：PC 21 条、重复 11 条、已转换 22 条（带 workflow_ref 指向新 key）、smoke 垃圾', () => {
    expect(sql).not.toMatch(/DELETE FROM journey_features/);
    expect(sql).not.toMatch(/DELETE FROM journeys/);
    const dep = section('journey_features 退役');
    expect(dep).toMatch(/SET status = 'deprecated'/);
    for (const id of [...PC_PUBLISH, ...DUPLICATES]) expect(dep, id).toContain(id);
    for (const [featureId, key] of CONVERTED) {
      expect(dep, featureId).toContain(featureId);
      expect(dep, key).toContain(`'workflow:${key}'`);
    }
    expect(dep).toMatch(/name LIKE '\[smoke\]%'/);
    expect(dep).toMatch(/name LIKE 'gp-agg-smoke%'/);
    expect(dep).toMatch(/name LIKE 'e2e-%'/);
    expect(dep).toMatch(/status <> 'deprecated'/);
  });

  it('昨日误建的两条重复能力标 deprecated（仅当其下没有流程/闹钟/activity）', () => {
    const cap = section('重复能力退役');
    for (const id of DUP_CAPABILITIES) expect(cap, id).toContain(id);
    expect(cap).toMatch(/UPDATE journeys SET status = 'deprecated'/);
    expect(cap).toMatch(/NOT EXISTS \(SELECT 1 FROM workflows/);
    expect(cap).toMatch(/NOT EXISTS \(SELECT 1 FROM ops_schedule_entries/);
    expect(cap).toMatch(/NOT EXISTS \(SELECT 1 FROM journey_steps/);
  });

  it('改前先把 journey_features / journeys / ops_schedule_entries 原值存进 migration_519_backup，回滚按备份还原并删表', () => {
    expect(sql).toMatch(/CREATE TABLE IF NOT EXISTS migration_519_backup/);
    for (const t of ['journey_features', 'journeys', 'ops_schedule_entries']) {
      expect(sql, t).toMatch(new RegExp(`INSERT INTO migration_519_backup[\\s\\S]*?'${t}'`));
      expect(downSql, t).toMatch(new RegExp(`UPDATE ${t}[\\s\\S]*?FROM migration_519_backup b[\\s\\S]*?b\\.table_name = '${t}'`));
    }
    expect(downSql).toMatch(/DELETE FROM workflows WHERE legacy_feature_id IS NOT NULL OR key IN \(/);
    for (const key of DEFAULT_OPS) expect(downSql, key).toContain(`'${key}'`);
    expect(downSql).not.toContain(`'douyin_keyword_leadgen'`);
    expect(downSql).toMatch(/DROP TABLE IF EXISTS migration_519_backup/);
  });

  it('登记 schema_version 519 并在回滚中删除；两端都在事务里', () => {
    expect(sql).toMatch(/INSERT INTO schema_version[\s\S]*'519'/);
    expect(downSql).toMatch(/DELETE FROM schema_version WHERE version = '519'/);
    expect(sql.trim().startsWith('--') || sql.trim().startsWith('BEGIN')).toBe(true);
    expect(sql).toMatch(/\nBEGIN;/);
    expect(sql.trim().endsWith('COMMIT;')).toBe(true);
    expect(downSql.trim().endsWith('COMMIT;')).toBe(true);
  });
});
