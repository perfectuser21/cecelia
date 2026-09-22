#!/usr/bin/env bash
# notion-inlet-ingest-smoke — 三面模型 PR②b 真库火：收据表落地、两条入口血管在注册表接通、映射对齐 CHECK 白名单。
set -euo pipefail
pass() { printf 'PASS: %s\n' "$1"; }
fail() { printf 'FAIL: %s\n' "$1" >&2; exit 1; }
: "${DATABASE_URL:?DATABASE_URL is required and must target a test or scratch database}"
PSQL="$(command -v psql)"; NODE="$(command -v node)"
DB_NAME="$("$NODE" -e "const u=new URL(process.argv[1]); process.stdout.write(decodeURIComponent(u.pathname.slice(1)))" "$DATABASE_URL")"
[[ "$DB_NAME" =~ (_test|_scratch)$ ]] || fail "refuse non-test db: ${DB_NAME:-empty}"
q() { "$PSQL" "$DATABASE_URL" -v ON_ERROR_STOP=1 -Atc "$1"; }
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"; BRAIN_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"

[[ "$(q "SELECT count(*) FROM information_schema.tables WHERE table_name='notion_ingest_receipts'")" == "1" ]] || fail "收据表不存在"
pass "migration 452：notion_ingest_receipts 落表"

n="$(q "SELECT count(*) FROM notion_projection_map WHERE face='inlet' AND direction IN ('ingest','both') AND status='active' AND vessel LIKE 'notion-inlet-ingest%'")"
[[ "$n" == "2" ]] || fail "注册表接通的入口血管应为 2，得 $n"
pass "注册表：「决策」库(both) + 员工 Skill 库(ingest) 两条入口血管 active"

# 类型→category 映射值必须全在 decisions.category 的 CHECK 白名单内（否则收账必 23514）
"$NODE" --input-type=module -e "
import { NOTION_TYPE_TO_CATEGORY, mapDecisionPage } from '$BRAIN_DIR/src/notion-inlet-ingest.js';
const allow = new Set(['architecture','bug-fix','decision','deferred','deployment','feature','general','governance','infra','invariant','issue','judgment','known-limitation','kr3-config','learning','nfr','ops-cleanup','process','process-exception','product-model','release-gate','scope-decision','small-change','technical','test','testing']);
for (const [k,v] of Object.entries(NOTION_TYPE_TO_CATEGORY)) if (!allow.has(v)) { console.error('非法 category 映射', k, v); process.exit(1); }
const r = mapDecisionPage({ id:'p', last_edited_time:'2026-01-01T00:00:00Z', properties:{ '决策':{type:'title',title:[{plain_text:'t'}]}, '状态':{type:'select',select:{name:'已决定'}}, '类型':{type:'select',select:{name:'不存在的类型'}} } });
if (r.category !== 'decision') { console.error('未知类型应回退 decision'); process.exit(1); }
if (mapDecisionPage({ id:'p', properties:{ '决策':{type:'title',title:[{plain_text:'t'}]}, '状态':{type:'select',select:{name:'草案'}} } }) !== null) { console.error('草案不该收'); process.exit(1); }
" || fail "映射不对齐 CHECK 白名单"
pass "类型→category 全在 decisions CHECK 白名单内；草案不收；未知类型回退 decision"

# 收据幂等：同键二次写不重复
q "INSERT INTO notion_ingest_receipts (notion_page_id, notion_db_id, brain_table, brain_id, last_edited_time) VALUES ('smoke-$$','db','decisions','x',NOW()) ON CONFLICT (notion_page_id) DO UPDATE SET ingested_at=NOW()" >/dev/null
q "INSERT INTO notion_ingest_receipts (notion_page_id, notion_db_id, brain_table, brain_id, last_edited_time) VALUES ('smoke-$$','db','decisions','y',NOW()) ON CONFLICT (notion_page_id) DO UPDATE SET brain_id=EXCLUDED.brain_id" >/dev/null
[[ "$(q "SELECT count(*)||'|'||max(brain_id) FROM notion_ingest_receipts WHERE notion_page_id='smoke-$$'")" == "1|y" ]] || fail "收据幂等失败"
q "DELETE FROM notion_ingest_receipts WHERE notion_page_id='smoke-$$'" >/dev/null
pass "收据表幂等：同页二次收账只一条且取新值"

grep -q "name: 'notion-inlet-ingest'" "$BRAIN_DIR/src/scheduler-jobs.js" || fail "调度层未挂 notion-inlet-ingest"
pass "scheduler 已挂 notion-inlet-ingest（自 gate 5min）"
echo "ALL PASS: notion-inlet-ingest"
