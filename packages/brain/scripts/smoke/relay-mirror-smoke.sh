#!/usr/bin/env bash
# relay-mirror-smoke — 接力棒 PR3 投影真库火：注册表两行、快照/属性/正文可拼、pushTasks 排除 project 根、决策推送排除 pending、调度已接。
# 棒1（决策 ee4842a6/3feeae3e）更新：链根从 tasks(task_type='project') 改成 projects 表真身行，
# 本脚本的种子数据/断言跟着改（Notion 页 id/指纹挪进 projects.notion_props；决策 context 带 project_id）。
set -euo pipefail
if ! node "$(dirname "${BASH_SOURCE[0]}")/../lib/smoke-production-guard.mjs" "${BRAIN_URL:-${BRAIN:-http://localhost:5221}}" "${DATABASE_URL:-postgresql://localhost/cecelia}"; then
  exit 0
fi
pass() { printf 'PASS: %s\n' "$1"; }
fail() { printf 'FAIL: %s\n' "$1" >&2; exit 1; }
: "${DATABASE_URL:?DATABASE_URL is required and must target a test or scratch database}"
PSQL="$(command -v psql)"; NODE="$(command -v node)"
DB_NAME="$("$NODE" -e "const u=new URL(process.argv[1]); process.stdout.write(decodeURIComponent(u.pathname.slice(1)))" "$DATABASE_URL")"
[[ "$DB_NAME" =~ (_test|_scratch)$ ]] || fail "refuse non-test db: ${DB_NAME:-empty}"
q() { "$PSQL" -X "$DATABASE_URL" -v ON_ERROR_STOP=1 -qAtc "$1"; }
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"; BRAIN_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"

[[ "$(q "SELECT count(*) FROM notion_projection_map WHERE notion_db_id='d83c40c2-ba63-8323-8dc7-01cc291c4d9b' AND brain_table='tasks' AND direction='push'")" == "1" ]] || fail "Projects←tasks(project 根) 未登记"
[[ "$(q "SELECT direction FROM notion_projection_map WHERE notion_db_id='f93e1918-56c1-4f31-9a41-36aa76a1c9c2' AND brain_table='decisions'")" == "both" ]] || fail "「决策」库方向未改 both"
pass "migration 459：Projects 多一根推送血管；「决策」库 direction=both"

TAG="$RANDOM$RANDOM"
ROOT="$(q "INSERT INTO projects (name, description, status) VALUES ('smoke 投影根 $TAG', '目标：看得见', 'in_progress') RETURNING id")"
C1="$(q "INSERT INTO tasks (title, task_type, status, project_id, sequence_no, result) VALUES ('smoke 第一棒 $TAG', 'data', 'completed', '$ROOT', 1, '{\"handoff_log\":[{\"at\":\"2026-09-23T00:00:00Z\",\"title\":\"第一棒\",\"verdict\":\"PASS\",\"done\":[\"铺了脊柱\"]}]}'::jsonb) RETURNING id")"
DEC="$(q "INSERT INTO decisions (category, topic, decision, status, trigger, author, made_by, priority, source_ref, context) VALUES ('decision', 'smoke 拍板 $TAG', '待定', 'pending', 'handoff', 'cecelia', 'cecelia', 'P2', '$C1', '{\"kind\":\"relay_pending\",\"project_id\":\"$ROOT\",\"root_task_id\":null,\"task_id\":\"$C1\"}'::jsonb) RETURNING id")"
trap 'q "DELETE FROM decisions WHERE id=$$'"$DEC"'$$; DELETE FROM tasks WHERE id IN ($$'"$C1"'$$); DELETE FROM projects WHERE id=$$'"$ROOT"'$$" >/dev/null 2>&1 || true' EXIT

"$NODE" --input-type=module -e "
import pg from 'pg';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { buildProjectSnapshot, buildProjectProps, buildProjectBody, pushProjectRoots, pushPendingDecisions, PROJECTS_DB } from '$BRAIN_DIR/src/notion-relay-projection.js';
import { notionText } from '$BRAIN_DIR/src/lib/project-notion-human.js';
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const client = await pool.connect();
try {
// 新推送遍历全量项目；smoke 只允许修改自己创建的项目和决策记账。
const db = { query(sql, args) {
  if (sql === 'SELECT *, name AS title FROM projects ORDER BY updated_at DESC, id') {
    return client.query('SELECT *, name AS title FROM projects WHERE id=\$1', ['$ROOT']);
  }
  if (sql.includes('FROM decisions d') && sql.includes('ORDER BY d.created_at LIMIT 20')) {
    return client.query(sql.replace('ORDER BY d.created_at LIMIT 20', 'AND d.id = \$1 ORDER BY d.created_at LIMIT 20'), ['$DEC']);
  }
  return client.query(sql, args);
} };
const root = (await client.query('SELECT *, name AS title FROM projects WHERE id=\$1', ['$ROOT'])).rows[0];
const snap = await buildProjectSnapshot(db, root);
assert.equal(snap.children.length, 1); assert.equal(snap.pending.length, 1); assert.equal(snap.log.length, 1);
const props = buildProjectProps(root, snap);
assert.equal(props.Status.status.name, 'In Progress');
assert.ok(notionText(props['AI 进展'].rich_text).includes('1/1 棒完成'));
assert.ok(notionText(props['AI 进展'].rich_text).includes('待拍板 1'));
assert.equal(notionText(props.Remark.rich_text), '');
const body = buildProjectBody(root, snap);
const txt = JSON.stringify(body);
for (const expected of ['目标：看得见', 'smoke 第一棒', 'smoke 拍板', '铺了脊柱']) assert.ok(txt.includes(expected));
// 有状态 Notion 边界：页面读取保留完整属性，PATCH 合并，正文读/删/追加真实作用在同一页。
const calls = [], pages = new Map();
const fakeReq = async (_token, path, method, request) => {
  calls.push([method, path]);
  if (method === 'POST' && path.endsWith('/query')) {
    const matched = [...pages.values()].filter(page => page.parent.database_id === PROJECTS_DB &&
      notionText(page.properties['Run ID']?.rich_text) === request.filter.rich_text.equals);
    return structuredClone({ results: matched, has_more: false, next_cursor: null });
  }
  if (method === 'POST' && path === '/pages') {
    const page = { id: randomUUID(), archived: false, parent: structuredClone(request.parent),
      properties: structuredClone(request.properties),
      children: (request.children || []).map(block => ({ ...structuredClone(block), id: randomUUID() })) };
    pages.set(page.id, page); return structuredClone(page);
  }
  if (path.startsWith('/pages/')) {
    const page = pages.get(path.slice('/pages/'.length));
    if (!page) throw new Error('Notion 404: page not found');
    if (method === 'PATCH') Object.assign(page.properties, structuredClone(request.properties));
    else assert.equal(method, 'GET');
    return structuredClone(page);
  }
  if (path.startsWith('/blocks/') && path.includes('/children')) {
    const page = pages.get(path.split('/')[2]);
    assert.ok(page, '正文所属页面必须存在');
    if (method === 'GET') return structuredClone({ results: page.children, has_more: false });
    assert.equal(method, 'PATCH');
    page.children.push(...request.children.map(block => ({ ...structuredClone(block), id: randomUUID() })));
    return { results: [] };
  }
  if (method === 'DELETE' && path.startsWith('/blocks/')) {
    const id = path.split('/')[2];
    for (const page of pages.values()) page.children = page.children.filter(block => block.id !== id);
    return {};
  }
  throw new Error('未定义的 Notion 调用: ' + method + ' ' + path);
};
const opts = { notionReq: fakeReq };
const s1 = await pushProjectRoots(db, 'tok', opts);
const s2 = await pushProjectRoots(db, 'tok', opts);
const after = (await client.query('SELECT notion_props FROM projects WHERE id=\$1', ['$ROOT'])).rows[0].notion_props;
assert.ok(after.notion_id); assert.ok(after.project_digest);
assert.equal(s1.pushed, 1); assert.equal(s1.failed, 0); assert.equal(s2.skipped, 1); assert.equal(s2.failed, 0);
const page = pages.get(after.notion_id), originalBlocks = page.children.map(block => block.id);
// 人改与 Brain 改冲突：读取既有页、事务回灌、摘要独立、正文更新后再次幂等。
page.properties.Status = { status: { name: 'Completed' } };
page.properties.Remark = { rich_text: [{ type: 'text', text: { content: '人工 smoke 备注' } }] };
await client.query('UPDATE projects SET status=\$2,description=\$3 WHERE id=\$1', ['$ROOT', 'paused', '目标：更新后可见']);
const s3 = await pushProjectRoots(db, 'tok', opts);
assert.equal(s3.pushed, 1); assert.equal(s3.failed, 0);
const merged = (await client.query('SELECT * FROM projects WHERE id=\$1', ['$ROOT'])).rows[0];
assert.equal(merged.status, 'completed'); assert.equal(merged.custom_props.remark, '人工 smoke 备注');
assert.equal(notionText(page.properties.Remark.rich_text), '人工 smoke 备注');
assert.ok(notionText(page.properties['AI 进展'].rich_text).includes('1/1 棒完成'));
assert.ok(JSON.stringify(page.children).includes('目标：更新后可见'));
assert.ok(page.children.every(block => !originalBlocks.includes(block.id)), '旧机器正文必须真正删除');
assert.equal((await pushProjectRoots(db, 'tok', opts)).skipped, 1);
const d1 = await pushPendingDecisions(db, 'tok', opts);
const dec = (await client.query('SELECT notion_id FROM decisions WHERE id=\$1', ['$DEC'])).rows[0];
assert.equal(d1.pushed, 1); assert.equal(d1.failed, 0); assert.ok(dec.notion_id);
const postDec = calls.filter(([m,p]) => m==='POST' && p==='/pages').length;
assert.equal(postDec, 2); assert.equal(pages.size, 2);
console.log('RELAY_MIRROR_PROJECTION_PASS');
} finally { client.release(); await pool.end(); }
" || fail "投影链路失败"
pass "根一页：快照/属性/正文齐；建页存指纹，重推跳过；待拍板推草案并回存 notion_id"

grep -q "task_type <> 'project'" "$BRAIN_DIR/src/notion-push-sync.js" || fail "pushTasks 未排除 project 根"
grep -q "d.status <> 'pending'" "$BRAIN_DIR/src/notion-push-sync.js" || fail "pushDecisions 未排除 pending"
grep -q "runRelayProjection" "$BRAIN_DIR/src/notion-push-sync.js" || fail "legacy 推送未挂 runRelayProjection"
grep -q "relay_pending" "$BRAIN_DIR/src/notion-inlet-ingest.js" || fail "入口回灌未接待拍板→已决定"
pass "pushTasks 排除根；pushDecisions 排除 pending；调度已接；回灌已接"

echo "ALL PASS: relay-mirror"
