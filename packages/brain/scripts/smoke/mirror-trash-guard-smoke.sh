#!/usr/bin/env bash
# Smoke: mirror-trash-guard — 旧镜子库停推 + 镜子库探活（决策 24a37029，任务 6ae72edd）
# 验证（全程假 pool / 假 notionReq，不打 Notion 不连库）：
#   1. 停推：注册表无 active 推送行 → pushJourneys / pushJourneyFeatures / pushAdvancementItems 不捞行不调 Notion；两轮只 info 一次
#   2. 探活：GET /databases in_trash:true / 404 → mirror_db_reachable 红并带 lost；200 → 绿；503 → degraded 不红
#   3. 渲染：有失联 → 晨报 🔴 RED「镜子库失联：<title>×N」+ 日报板块；无失联 → 无行无板块
#   4. 接线：迁移 480 归档两行；push-sync 不再含回收站库 id；晨报/日报接 mirror-db-report；守夜接 probeMirrorDbs
set -euo pipefail
cd "$(dirname "$0")/../.."

echo "[mirror-trash-guard-smoke] 1. 停推判据（archived 登记 → resolveDbId 为 null → 不推；A9 常量表摘两表）"
# 无 NOTION 凭据时 runNotionPushSync 在 getToken 处直接返回，主链走不到 pushJourneys；停推的完整行为
# （不捞行 / 不调 Notion / 两轮只 info 一次）由 src/__tests__/notion-push-sync.test.js 用 mock token 锁住，这里钉判据与常量表。
node --input-type=module -e "
const calls = [];
const pool = { query: async (sql, p = []) => { calls.push({ sql: String(sql), p }); return { rows: [] }; } };
const { resolveDbId } = await import('./src/lib/notion-projection-engine.js');
const id = await resolveDbId(pool, 'journeys');
if (id !== null) { console.error('FAIL 无 active 行应返回 null'); process.exit(1); }
const q = calls.find(c => /FROM notion_projection_map/.test(c.sql) && c.p[0] === 'journeys');
if (!q || !/status = 'active'/.test(q.sql) || !/direction IN \('push','both'\)/.test(q.sql)) { console.error('FAIL resolveDbId 判据应为 active + push/both'); process.exit(1); }
const mod = await import('./src/notion-push-sync.js');
if ('journeys' in mod.LEGACY_DB_CONSTANTS || 'journey_features' in mod.LEGACY_DB_CONSTANTS) { console.error('FAIL 守夜 A9 常量表不应再含 journeys/journey_features'); process.exit(1); }
console.log('resolveDbId 判据 active+push/both / A9 常量表已摘两表 ✓');
"

echo "[mirror-trash-guard-smoke] 2. 探活断言（in_trash / 404 / 200 / 503）"
node --input-type=module -e "
import { probeMirrorDbs } from './src/lib/notion-projection-watch.js';
const rows = [
  { notion_db_id: 'db-a', title: 'AI Journey', brain_table: 'journeys', direction: 'push', status: 'active' },
  { notion_db_id: 'db-b', title: 'Issues', brain_table: 'issues', direction: 'push', status: 'active' },
  { notion_db_id: 'db-c', title: 'Tasks', brain_table: 'tasks', direction: 'both', status: 'active' },
];
const mk = (byDb) => async (t, path, m) => { const id = path.replace('/databases/', ''); const v = byDb[id]; if (v instanceof Error) throw v; return v ?? { in_trash: false, archived: false }; };
let a = await probeMirrorDbs(rows, { notionReq: mk({ 'db-a': { in_trash: true }, 'db-b': new Error('404: Could not find database') }), token: 't' });
if (a.ok || a.lost.length !== 2 || a.lost[0].reason !== 'in_trash' || a.lost[1].reason !== '404' || !/AI Journey/.test(a.detail)) { console.error('FAIL in_trash/404 应红: ' + JSON.stringify(a)); process.exit(1); }
a = await probeMirrorDbs(rows, { notionReq: mk({}), token: 't' });
if (!a.ok || a.lost.length || !/3 个/.test(a.detail)) { console.error('FAIL 全 200 应绿: ' + JSON.stringify(a)); process.exit(1); }
a = await probeMirrorDbs(rows, { notionReq: mk({ 'db-a': new Error('Notion 503') }), token: 't' });
if (!a.ok || !a.degraded) { console.error('FAIL 503 应 degraded 不红: ' + JSON.stringify(a)); process.exit(1); }
console.log('in_trash/404 红 / 200 绿 / 503 degraded ✓');
"

echo "[mirror-trash-guard-smoke] 3. 晨报行 / 日报板块两态"
node --input-type=module -e "
import { readMirrorDbState, renderMirrorDbLine, renderMirrorDbSection } from './src/lib/mirror-db-report.js';
const lost = [{ title: 'AI Journey', table: 'journeys', dbId: 'a', reason: 'in_trash' }, { title: 'AI Feature', table: 'journey_features', dbId: 'b', reason: 'in_trash' }];
const poolWith = (results) => ({ query: async () => ({ rows: [{ value_json: { last_run_at: '2026-09-27T02:00:00.000Z', results } }] }) });
const red = await readMirrorDbState(poolWith([{ key: 'mirror_db_reachable', ok: false, lost }]));
const line = renderMirrorDbLine(red);
if (line !== '🔴 RED 镜子库失联：AI Journey、AI Feature ×2（Notion 回收站/404，推送已停）') { console.error('FAIL 晨报行: ' + line); process.exit(1); }
if (!/== 镜子库失联 ==/.test(renderMirrorDbSection(red))) { console.error('FAIL 日报板块缺标题'); process.exit(1); }
const green = await readMirrorDbState(poolWith([{ key: 'mirror_db_reachable', ok: true, lost: [] }]));
if (green !== null || renderMirrorDbLine(green) !== null || renderMirrorDbSection(green) !== '') { console.error('FAIL 无失联应无行无板块'); process.exit(1); }
const broken = await readMirrorDbState({ query: async () => { throw new Error('down'); } });
if (broken !== null) { console.error('FAIL 读取失败应 null'); process.exit(1); }
console.log('有失联出行出板块 / 无失联不出 / 读取失败不拖垮 ✓');
"

echo "[mirror-trash-guard-smoke] 4. 接线钉子"
node -e "
const fs = require('fs');
const checks = [
  ['migrations/480_archive_journey_mirrors.sql', [\"'358c40c2-ba63-8148-bde7-e313d789931a' AND brain_table = 'journeys'\", \"'358c40c2-ba63-81e3-96c5-d762b3d34dff' AND brain_table = 'journey_features'\", \"status = 'archived'\", \"direction = 'none'\", '24a37029', \"'480'\"]],
  ['migrations/rollback/480_archive_journey_mirrors.down.sql', [\"DELETE FROM schema_version WHERE version = '480'\"]],
  ['src/notion-push-sync.js', [\"activePushDbId(pool, 'journeys')\", \"activePushDbId(pool, 'journey_features')\", 'stopNoticed']],
  ['src/lib/notion-projection-watch.js', ['probeMirrorDbs(active', \"key: 'mirror_db_reachable'\"]],
  ['src/morning-cockpit-bark.js', ['fetchMirrorDbLine', 'renderMirrorDbLine']],
  ['src/daily-report-generator.js', ['readMirrorDbState(dbPool)', 'renderMirrorDbSection']],
];
let fail = false;
for (const [file, needles] of checks) {
  const src = fs.readFileSync(file, 'utf8');
  for (const n of needles) if (!src.includes(n)) { console.error('FAIL ' + file + ' 缺少: ' + n); fail = true; }
}
const push = fs.readFileSync('src/notion-push-sync.js', 'utf8');
for (const dead of ['358c40c2-ba63-8148-bde7-e313d789931a', '358c40c2-ba63-81e3-96c5-d762b3d34dff']) if (push.includes(dead)) { console.error('FAIL push-sync 仍硬编码回收站库 ' + dead); fail = true; }
if (fail) process.exit(1);
console.log('迁移 480 / push-sync / 守夜 / 晨报 / 日报 全部接线 ✓');
"

echo "[mirror-trash-guard-smoke] PASS"
