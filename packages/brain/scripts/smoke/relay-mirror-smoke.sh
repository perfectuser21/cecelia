#!/usr/bin/env bash
# relay-mirror-smoke — 接力棒 PR3 投影真库火：注册表两行、快照/属性/正文可拼、pushTasks 排除 project 根、决策推送排除 pending、调度已接。
set -euo pipefail
pass() { printf 'PASS: %s\n' "$1"; }
fail() { printf 'FAIL: %s\n' "$1" >&2; exit 1; }
: "${DATABASE_URL:?DATABASE_URL is required and must target a test or scratch database}"
PSQL="$(command -v psql)"; NODE="$(command -v node)"
DB_NAME="$("$NODE" -e "const u=new URL(process.argv[1]); process.stdout.write(decodeURIComponent(u.pathname.slice(1)))" "$DATABASE_URL")"
[[ "$DB_NAME" =~ (_test|_scratch)$ ]] || fail "refuse non-test db: ${DB_NAME:-empty}"
q() { "$PSQL" "$DATABASE_URL" -v ON_ERROR_STOP=1 -qAtc "$1"; }
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"; BRAIN_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"

[[ "$(q "SELECT count(*) FROM notion_projection_map WHERE notion_db_id='d83c40c2-ba63-8323-8dc7-01cc291c4d9b' AND brain_table='tasks' AND direction='push'")" == "1" ]] || fail "Projects←tasks(project 根) 未登记"
[[ "$(q "SELECT direction FROM notion_projection_map WHERE notion_db_id='f93e1918-56c1-4f31-9a41-36aa76a1c9c2' AND brain_table='decisions'")" == "both" ]] || fail "「决策」库方向未改 both"
pass "migration 459：Projects 多一根推送血管；「决策」库 direction=both"

TAG="$RANDOM$RANDOM"
ROOT="$(q "INSERT INTO tasks (title, description, task_type, status) VALUES ('smoke 投影根 $TAG', '目标：看得见', 'project', 'in_progress') RETURNING id")"
C1="$(q "INSERT INTO tasks (title, task_type, status, parent_task_id, sequence_no, result) VALUES ('smoke 第一棒 $TAG', 'data', 'completed', '$ROOT', 1, '{\"handoff_log\":[{\"at\":\"2026-09-23T00:00:00Z\",\"title\":\"第一棒\",\"verdict\":\"PASS\",\"done\":[\"铺了脊柱\"]}]}'::jsonb) RETURNING id")"
DEC="$(q "INSERT INTO decisions (category, topic, decision, status, trigger, author, made_by, priority, source_ref, context) VALUES ('decision', 'smoke 拍板 $TAG', '待定', 'pending', 'handoff', 'cecelia', 'cecelia', 'P2', '$C1', '{\"kind\":\"relay_pending\",\"root_task_id\":\"$ROOT\",\"task_id\":\"$C1\"}'::jsonb) RETURNING id")"
trap 'q "DELETE FROM decisions WHERE id=$$'"$DEC"'$$; DELETE FROM tasks WHERE id IN ($$'"$C1"'$$,$$'"$ROOT"'$$)" >/dev/null 2>&1 || true' EXIT

"$NODE" --input-type=module -e "
import pg from 'pg';
import { buildProjectSnapshot, buildProjectProps, buildProjectBody, pushProjectRoots, pushPendingDecisions } from '$BRAIN_DIR/src/notion-relay-projection.js';
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const root = (await pool.query('SELECT id, title, description, status, notion_id, notion_props FROM tasks WHERE id=\$1', ['$ROOT'])).rows[0];
const snap = await buildProjectSnapshot(pool, root);
if (snap.children.length !== 1 || snap.pending.length !== 1 || snap.log.length !== 1) { console.error('快照不对', snap); process.exit(1); }
const props = buildProjectProps(root, snap);
if (props.Status.status.name !== 'In Progress' || !props.Remark.rich_text[0].text.content.includes('1/1 棒完成') || !props.Remark.rich_text[0].text.content.includes('待拍板 1')) { console.error('属性不对', props); process.exit(1); }
const body = buildProjectBody(root, snap);
const txt = JSON.stringify(body);
if (!txt.includes('目标：看得见') || !txt.includes('smoke 第一棒') || !txt.includes('smoke 拍板') || !txt.includes('铺了脊柱')) { console.error('正文缺段', txt.slice(0,400)); process.exit(1); }
// 假 Notion：POST 建页 → 存 notion_id + 指纹；再推一次 → 指纹相同跳过
const calls = [];
const fakeReq = async (t, path, method, bodyx) => { calls.push([method, path]); if (method==='POST' && path==='/pages') return { id: 'page-$TAG-' + calls.length + '-' + Math.random().toString(16).slice(2, 8) }; if (method==='GET') return { results: [] }; return {}; };
const s1 = await pushProjectRoots(pool, 'tok', { notionReq: fakeReq, log: { warn: (m) => { console.error(m); process.exit(1); } } });
const s2 = await pushProjectRoots(pool, 'tok', { notionReq: fakeReq });
const after = (await pool.query('SELECT notion_id, notion_props->>\'project_digest\' AS d FROM tasks WHERE id=\$1', ['$ROOT'])).rows[0];
if (!after.notion_id || !after.d || s1.pushed < 1 || s2.skipped < 1) { console.error('指纹/建页不对', s1, s2, after); process.exit(1); }
const d1 = await pushPendingDecisions(pool, 'tok', { notionReq: fakeReq });
const dec = (await pool.query('SELECT notion_id FROM decisions WHERE id=\$1', ['$DEC'])).rows[0];
if (d1.pushed < 1 || !dec.notion_id) { console.error('待拍板未推', d1, dec); process.exit(1); }
const postDec = calls.filter(([m,p]) => m==='POST' && p==='/pages').length;
if (postDec < 2) { console.error('应各建一页', calls); process.exit(1); }
await pool.end();
" || fail "投影链路失败"
pass "根一页：快照/属性/正文齐；建页存指纹，重推跳过；待拍板推草案并回存 notion_id"

grep -q "task_type <> 'project'" "$BRAIN_DIR/src/notion-push-sync.js" || fail "pushTasks 未排除 project 根"
grep -q "d.status <> 'pending'" "$BRAIN_DIR/src/notion-push-sync.js" || fail "pushDecisions 未排除 pending"
grep -q "runRelayProjection" "$BRAIN_DIR/src/notion-push-sync.js" || fail "legacy 推送未挂 runRelayProjection"
grep -q "relay_pending" "$BRAIN_DIR/src/notion-inlet-ingest.js" || fail "入口回灌未接待拍板→已决定"
pass "pushTasks 排除根；pushDecisions 排除 pending；调度已接；回灌已接"

echo "ALL PASS: relay-mirror"
