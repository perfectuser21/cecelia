#!/usr/bin/env bash
# Smoke: notion-map-value-streams — 结构地图价值流 → Notion「价值流 Value Streams」只读镜子（决策 e00d9cc3 / 9d5fce74）
# 验证（假池 + 假 notionReq，不打真 Notion、不连库）：
#   1. 首推：每条价值流 POST 一页，按 (scope,node_key) 写记账表；能力列按 order 逐行
#   2. 二推：指纹相同 → 不打 Notion 写接口
#   3. 节点从 active run 消失 → 页面状态 PATCH 为已归档（不删页）；再推不重复归档
#   4. 接线：runNotionPushSync 挂 runValueStreamMirror；迁移 487 与回滚存在；新库登记 push/active
set -euo pipefail
cd "$(dirname "$0")/../.."

echo "[notion-map-value-streams-smoke] 1-3. 推送/去重/归档（假池 + 假 Notion）"
node --input-type=module -e "
import { pushMapValueStreams } from './src/notion-map-value-streams.js';

const calls = [];
const notionReq = async (token, path, method, body) => {
  calls.push({ path, method, body });
  if (method === 'GET') return { properties: {} };
  if (path === '/pages' && method === 'POST') return { id: 'page-' + calls.length };
  return {};
};
let nodes = [
  { scope_key: 'cecelia', manifest_version: 7, manifest_digest: 'a'.repeat(64), node_key: 'factory', name: '工厂',
    attributes: { order: 1, perceiver: '待造软件' }, capabilities: [{ key: 'MJ5', name: '账本', order: 2 }, { key: 'F0', name: '需求入口', order: 1 }] },
  { scope_key: 'zenithjoy-workspace', manifest_version: 6, manifest_digest: 'b'.repeat(64), node_key: 'line01', name: 'Line 01',
    attributes: { order: 1 }, capabilities: [] },
];
const ledger = new Map();
const pool = { query: async (sql, p = []) => {
  if (/FROM notion_projection_map/.test(sql)) return { rows: p[0] === 'notion_map_node_pages' ? [{ notion_db_id: 'db-vs' }] : [] };
  if (/FROM map_projection_runs/.test(sql)) return { rows: nodes };
  if (/INSERT INTO notion_map_node_pages/.test(sql)) { ledger.set(p[0] + '/' + p[1], { scope: p[0], node_key: p[1], notion_id: p[2], notion_digest: p[3], archived_at: null }); return { rows: [] }; }
  if (/UPDATE notion_map_node_pages/.test(sql)) { const r = ledger.get(p[0] + '/' + p[1]); r.archived_at = 'now'; r.notion_digest = p[2]; return { rows: [] }; }
  if (/FROM notion_map_node_pages/.test(sql)) return { rows: [...ledger.values()].map((r) => ({ ...r })) };
  return { rows: [] };
} };
const writes = () => calls.filter((c) => c.path.startsWith('/pages')).length;

let st = await pushMapValueStreams(pool, 't', { notionReq });
if (st.created !== 2 || ledger.size !== 2) { console.error('FAIL 首推应 created=2: ' + JSON.stringify(st)); process.exit(1); }
const fp = calls.find((c) => c.method === 'POST' && c.body.properties.Key.rich_text[0].text.content === 'factory').body.properties;
if (fp['能力'].rich_text[0].text.content !== 'F0 需求入口\nMJ5 账本' || fp['能力数'].number !== 2 || fp.Persona.rich_text[0].text.content !== '待造软件') { console.error('FAIL factory props: ' + JSON.stringify(fp)); process.exit(1); }
console.log('首推：建页/记账/能力逐行 ✓');

const before = writes();
st = await pushMapValueStreams(pool, 't', { notionReq });
if (st.skipped !== 2 || writes() !== before) { console.error('FAIL 二推指纹相同应不打 Notion: ' + JSON.stringify(st)); process.exit(1); }
console.log('二推：指纹去重 ✓');

nodes = nodes.slice(0, 1);
st = await pushMapValueStreams(pool, 't', { notionReq });
const arch = calls[calls.length - 1];
if (st.archived !== 1 || arch.method !== 'PATCH' || arch.body.properties['状态'].select.name !== '已归档') { console.error('FAIL 消失节点应 PATCH 已归档: ' + JSON.stringify(st)); process.exit(1); }
if (calls.some((c) => c.method === 'DELETE')) { console.error('FAIL 不许删页'); process.exit(1); }
const b2 = writes();
st = await pushMapValueStreams(pool, 't', { notionReq });
if (st.archived !== 0 || writes() !== b2) { console.error('FAIL 已归档不应重复 PATCH'); process.exit(1); }
console.log('归档：状态标记不删页、不重复 ✓');
"

echo "[notion-map-value-streams-smoke] 4. 接线与迁移"
# 价值流库已由六层目录投影接管：结构地图镜子不得再挂进推送轮（否则会把 Persona/Scope/地图版本 等旧列补回来）
! grep -q "runValueStreamMirror(" src/notion-push-sync.js || { echo "FAIL 结构地图镜子仍挂在推送轮，会和目录投影抢写价值流库"; exit 1; }
test -f migrations/487_notion_map_value_streams.sql || { echo "FAIL 缺迁移 487"; exit 1; }
test -f migrations/rollback/487_notion_map_value_streams.down.sql || { echo "FAIL 缺回滚 487"; exit 1; }
grep -q "'notion_map_node_pages', 'push', 'notion-map-value-streams.pushMapValueStreams', 'active'" migrations/487_notion_map_value_streams.sql \
  || { echo "FAIL 新库未登记 push/active"; exit 1; }
echo "✅ notion-map-value-streams smoke PASS"
