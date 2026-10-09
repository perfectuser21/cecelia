#!/usr/bin/env bash
# Smoke: notion-mirror-labels — 镜子库只读说明由注册表生成（任务 a7a6b8b4，交接单第 5 步）
# 验证（不连真库、不发网络；假 pool + 假 Notion）：
#   1. 注册表 → 标签：active 推送镜子写说明、两面库/无 Brain 表跳过；第二轮零写（幂等）；标题不改
#   2. 接线：scheduler JOBS 挂 notion-mirror-labels 且在 scheduler-liveness 之前；迁移 488 + 回滚存在；smoke 登记 allowlist
set -euo pipefail
cd "$(dirname "$0")/../.."

echo "[notion-mirror-labels-smoke] 1. 注册表 → Notion 描述"
node --input-type=module -e "
import { syncMirrorLabels } from './src/notion-mirror-labels.js';
const rows = [
  { notion_db_id: 'a17c40c2-ba63-82fb-9888-8152cefe29ec', title: 'Issues', face: 'mirror', brain_table: 'issues', direction: 'push', vessel: 'notion-push-sync.pushIssues', status: 'active' },
  { notion_db_id: 'd83c40c2-ba63-8323-8dc7-01cc291c4d9b', title: 'Projects', face: 'mirror', brain_table: 'tasks', direction: 'push', vessel: 'x', status: 'active' },
  { notion_db_id: 'd83c40c2-ba63-8323-8dc7-01cc291c4d9b', title: 'Projects', face: 'inlet', brain_table: 'okr_projects', direction: 'both', vessel: 'y', status: 'active' },
  { notion_db_id: '3d6c40c2-ba63-811f-a83e-f981a044617d', title: 'OPC 经营对象', face: 'mirror', brain_table: null, direction: 'push', vessel: 'cron', status: 'active' },
];
const pool = { query: async () => ({ rows }) };
const db = { description: [] };
const writes = [];
const notionReq = async (_t, path, method, body) => {
  if (method === 'PATCH') { writes.push({ path, body }); db.description = body.description.map((x) => ({ ...x, plain_text: x.text.content })); }
  return db;
};
const r1 = await syncMirrorLabels(pool, { notionReq, token: 't' });
if (r1.updated.join() !== 'Issues' || writes.length !== 1) { console.error('FAIL 应只写 Issues', r1); process.exit(1); }
if (Object.keys(writes[0].body).join() !== 'description') { console.error('FAIL 只许改 description'); process.exit(1); }
if (!db.description[0].text.content.startsWith('🔒 只读镜子：由 Brain issues 经 notion-push-sync.pushIssues 推送')) { console.error('FAIL 标签格式'); process.exit(1); }
const reasons = r1.skipped.map((s) => s.title + ':' + s.reason).sort().join();
if (reasons !== 'OPC 经营对象:no_brain_table,Projects:dual_face') { console.error('FAIL 跳过原因', reasons); process.exit(1); }
const r2 = await syncMirrorLabels(pool, { notionReq, token: 't' });
if (writes.length !== 1 || r2.unchanged.join() !== 'Issues') { console.error('FAIL 第二轮应零写'); process.exit(1); }
console.log('写说明 / 只改 description / 两面库与无表跳过 / 第二轮零写 ✓');
"

echo "[notion-mirror-labels-smoke] 2. 接线"
grep -q "name: 'notion-mirror-labels'" src/scheduler-jobs.js || { echo "FAIL JOBS 未挂 notion-mirror-labels"; exit 1; }
node --input-type=module -e "
import { readFileSync } from 'node:fs';
const s = readFileSync('src/scheduler-jobs.js', 'utf8');
if (s.indexOf(\"name: 'notion-mirror-labels'\") > s.indexOf(\"name: 'scheduler-liveness'\")) { console.error('FAIL scheduler-liveness 必须排最后'); process.exit(1); }
"
ls migrations/*_projection_map_reconcile.sql >/dev/null || { echo "FAIL 缺对账迁移"; exit 1; }
ls migrations/rollback/*_projection_map_reconcile.down.sql >/dev/null || { echo "FAIL 缺对账迁移回滚"; exit 1; }
grep -q "notion-mirror-labels-smoke.sh" ../quality/smoke-allowlist.txt || { echo "FAIL smoke 未登记 allowlist"; exit 1; }
echo "[notion-mirror-labels-smoke] PASS"
