-- Migration 487: 价值流镜子接线（决策 e00d9cc3 / 9d5fce74）
--
-- 价值流以 Brain 结构地图为准（map_projection_runs status='active' 的 value_stream 节点 + contains→capability）。
-- 一、记账表 notion_map_node_pages：map_projection_nodes 每次重投影换新 run_id，记账列不能挂真身表，
--     另立表按跨 run 稳定身份 (scope, node_key) 记 Notion 页 id / 指纹 / 同步时间 / 归档时间。
-- 二、notion_projection_map 登记总台账下新建的「价值流 Value Streams」库（scripts/ops/create-value-stream-notion-db.js 建）：
--     mirror / push / active，血管 notion-map-value-streams.pushMapValueStreams。
-- 三、旧「Value Streams」库 902b…（2026-09-26 Notion AI 手建，7 行是产品方向不是价值流）已改名「产品方向（人工维护）」，
--     登记为 truth / none：人工维护真身，大脑不推不拉。
-- 四、453 占位行 unmapped:value_streams（旧 value_streams 表，无血管）归档：价值流镜子改由地图投影承担。

CREATE TABLE IF NOT EXISTS notion_map_node_pages (
  scope text NOT NULL,
  node_key text NOT NULL,
  notion_id text,
  notion_digest text,
  notion_synced_at timestamptz,
  archived_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (scope, node_key)
);

COMMENT ON TABLE notion_map_node_pages IS
  '结构地图价值流节点 → Notion「价值流 Value Streams」库页面记账（迁移 487，决策 e00d9cc3）；archived_at 非空 = 节点已不在 active run，页面状态标已归档';

INSERT INTO notion_projection_map (notion_db_id, title, face, brain_table, direction, vessel, status, space, notes)
VALUES
  ('3eac40c2-ba63-817f-a964-f071c78cb711', '价值流 Value Streams', 'mirror', 'map_projection_nodes', 'push', 'notion-map-value-streams.pushMapValueStreams', 'active', 'system',
   '只读镜子：结构地图 active run 的价值流（一行一条，能力列 = contains→capability）；按 (scope,node_key) 记账在 notion_map_node_pages；改结构改 manifest（迁移 487，决策 e00d9cc3 / 9d5fce74）'),
  ('902b85550fb54ae0bdf89b0d7a23a3f2', '产品方向（人工维护）', 'truth', NULL, 'none', NULL, 'active', 'system',
   '2026-09-26 Notion AI 手建，原名 Value Streams；7 行是产品方向不是价值流，2026-09-29 改名为产品方向、人工维护，大脑不推不拉（迁移 487，决策 e00d9cc3）')
ON CONFLICT DO NOTHING;

UPDATE notion_projection_map
   SET status = 'archived',
       notes = COALESCE(notes, '') || '；迁移 487 归档：价值流镜子改由结构地图投影（「价值流 Value Streams」库，决策 e00d9cc3）',
       updated_at = NOW()
 WHERE notion_db_id = 'unmapped:value_streams' AND brain_table = 'value_streams' AND status <> 'archived';

INSERT INTO schema_version (version, description)
VALUES ('487', '价值流镜子：notion_map_node_pages 记账表 + 登记价值流库/产品方向库 + 归档 value_streams 占位行')
ON CONFLICT (version) DO NOTHING;
