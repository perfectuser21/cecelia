#!/usr/bin/env bash
# skill-registry-projection-smoke — Skill 台账投影 PR1b（任务 47def5bb）CI 可跑冒烟：
# 真测试库 + 假 Notion 跑 runSkillRegistryProjection：
# ① 首轮补建新列、建页、基线与指纹真落库 ② 没变化第二轮零推送 ③ 人在 Notion 改过的人管列，Brain 改了也不覆盖
# ④ 人删掉的列不补建。真 Notion 效果属部署后验收（CI 无 NOTION_API_KEY）。
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
q() { "$PSQL" -X "$DATABASE_URL" -v ON_ERROR_STOP=1 -Atc "$1"; }
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
BRAIN_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"
TAG="skproj-smoke-$$"
cleanup() {
  q "DELETE FROM skill_registry WHERE name = '${TAG}'" >/dev/null 2>&1 || true
  q "DELETE FROM working_memory WHERE key IN ('skill_registry_notion_columns','skill_registry_projection_state')" >/dev/null 2>&1 || true
}
trap cleanup EXIT
cleanup

q "INSERT INTO skill_registry (name, description, status, presence, platforms_installed, source_kind, category, updated_at)
   VALUES ('${TAG}', '冒烟描述', 'active', 'present', ARRAY['claude-code'], 'repo', '运维', NOW() + INTERVAL '1 day')" >/dev/null

OUT="$(cd "$BRAIN_DIR" && "$NODE" --input-type=module -e "
import pg from 'pg';
import { runSkillRegistryProjection } from './src/skill-registry-projection.js';
import { SKILL_REGISTRY_DB } from './src/lib/skill-registry-notion-props.js';
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 2 });
const db = { description: [{ plain_text: '🔒 只读镜子' }], properties: {
  Name: { id: 'title', name: 'Name', type: 'title' }, Description: { id: 'd', name: 'Description', type: 'rich_text' },
  Status: { id: 's', name: 'Status', type: 'select' }, Source: { id: 'src', name: 'Source', type: 'select' } } };
const pages = new Map(); const calls = []; let seq = 0;
const norm = (props) => Object.fromEntries(Object.entries(props || {}).map(([k, v]) => {
  const t = Object.keys(v)[0]; const val = v[t];
  return [k, { type: t, [t]: Array.isArray(val) && (t === 'title' || t === 'rich_text') ? val.map((x) => ({ plain_text: x.text.content })) : val }];
}));
const notionReq = async (_t, path, method = 'GET', body) => {
  calls.push({ path, method });
  if (path === '/databases/' + SKILL_REGISTRY_DB && method === 'GET') return { ...db };
  if (path === '/databases/' + SKILL_REGISTRY_DB && method === 'PATCH') {
    for (const [n, d] of Object.entries(body.properties || {})) db.properties[n] = { id: 'c_' + n, name: n, type: Object.keys(d)[0] };
    if (body.description) db.description = [{ plain_text: body.description[0].text.content }];
    return { ...db };
  }
  if (path.endsWith('/query')) return { results: [...pages.values()].filter((p) => !body?.filter || p.properties.Name?.title?.[0]?.plain_text === body.filter.title.equals), has_more: false };
  if (path === '/pages' && method === 'POST') { const id = 'pg-' + (++seq); const p = { id, created_by: { id: 'bot' }, created_time: 't', properties: norm(body.properties) }; pages.set(id, p); return p; }
  const m = /^\/pages\/(.+)$/.exec(path); const p = m && pages.get(m[1]);
  if (!p) throw new Error('Notion ' + method + ' ' + path + ' → 404');
  if (method === 'PATCH') Object.assign(p.properties, norm(body.properties));
  return p;
};
const run = () => runSkillRegistryProjection(pool, { token: 't', notionReq, force: true, botUserId: 'bot', names: ['${TAG}'], sweepOrphans: false });
const res = {};
res.r1 = await run();
res.cols = Object.keys(db.properties);
res.page = pages.get('pg-1');
const n1 = calls.length;
res.r2 = await run();
res.pagePatchesRun2 = calls.slice(n1).filter((c) => c.method === 'PATCH' && c.path.startsWith('/pages/')).length;
pages.get('pg-1').properties['备注'] = { type: 'rich_text', rich_text: [{ plain_text: '人写的' }] };
await pool.query(\"UPDATE skill_registry SET note = 'Brain 写的', updated_at = NOW() + INTERVAL '2 day' WHERE name = '${TAG}'\");
delete db.properties['存在性'];
res.r3 = await run();
res.noteAfter = pages.get('pg-1').properties['备注'].rich_text[0].plain_text;
res.colsAfter = Object.keys(db.properties);
console.log(JSON.stringify(res));
await pool.end();
")"

echo "$OUT" | "$NODE" -e "
const r = JSON.parse(require('fs').readFileSync(0, 'utf8'));
const need = ['已装平台','存在性','最后扫描','原件路径','分配Agent','评测分','不一致副本数','目标平台','转OpenClaw难度','业务线','负责人','分类','备注'];
const miss = need.filter((n) => !r.cols.includes(n));
if (!r.r1.ok || miss.length) { console.error('首轮建列失败', JSON.stringify({ r1: r.r1, miss })); process.exit(1); }
if (!r.page || r.page.properties['分类']?.select?.name !== '运维') { console.error('首轮建页/人管列初值不对', JSON.stringify(r.page)); process.exit(1); }
if (r.pagePatchesRun2 !== 0) { console.error('没变化却又推了', r.pagePatchesRun2); process.exit(1); }
if (r.noteAfter !== '人写的') { console.error('人改的备注被覆盖', r.noteAfter); process.exit(1); }
if (r.colsAfter.includes('存在性')) { console.error('人删的列被补建'); process.exit(1); }
" || fail "投影行为断言失败: ${OUT:0:400}"
pass "首轮补建 13 列 + 建页 + 人管列初值；没变化零推送；人改的不覆盖；人删的列不补建"

ROW="$(q "SELECT notion_id || '|' || (notion_baseline->>'note') || '|' || (metadata ? 'pushed_digest')::text FROM skill_registry WHERE name = '${TAG}'")"
[[ "$ROW" == "pg-1|Brain 写的|true" ]] || fail "基线/指纹未真落库：$ROW"
pass "notion_id、人管列基线、推送指纹真落库（基线跟上 Brain 值，人改的留待回拉）"

echo "ALL PASS: skill-registry-projection"
