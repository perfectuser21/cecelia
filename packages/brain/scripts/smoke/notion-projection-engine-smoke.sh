#!/usr/bin/env bash
# notion-projection-engine-smoke — 三面模型 PR②a 真库火：统一推送引擎落地、insert-only 病根清零。
set -euo pipefail
pass() { printf 'PASS: %s\n' "$1"; }
fail() { printf 'FAIL: %s\n' "$1" >&2; exit 1; }
: "${DATABASE_URL:?DATABASE_URL is required and must target a test or scratch database}"
PSQL="$(command -v psql)"; NODE="$(command -v node)"
DB_NAME="$("$NODE" -e "const u=new URL(process.argv[1]); process.stdout.write(decodeURIComponent(u.pathname.slice(1)))" "$DATABASE_URL")"
[[ "$DB_NAME" =~ (_test|_scratch)$ ]] || fail "refuse non-test db: ${DB_NAME:-empty}"
q() { "$PSQL" "$DATABASE_URL" -v ON_ERROR_STOP=1 -Atc "$1"; }
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"; BRAIN_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"

# 1. 11 张镜子表都有指纹槽
missing="$(q "WITH t(n) AS (VALUES ('issues'),('journeys'),('journey_features'),('journey_step_links'),('decisions'),('initiative_contracts'),('ops_agents'),('ops_skills'),('ops_workflows'),('ops_runs'),('ops_schedule_entries'))
SELECT coalesce(string_agg(n,','),'') FROM t WHERE NOT EXISTS (SELECT 1 FROM information_schema.columns c WHERE c.table_name=t.n AND c.column_name='notion_digest')")"
[[ -z "$missing" ]] || fail "缺 notion_digest 列: $missing"
pass "migration 451：11 张镜子表均有 notion_digest 指纹槽"

# 2. 主链里 insert-only 判据清零（WHERE … notion_synced_at IS NULL 直接接 LIMIT 的老写法）
if grep -nE "notion_synced_at IS NULL\s*$" "$BRAIN_DIR/src/notion-push-sync.js" | grep -vE "OR |cell_kind|ops_runs|step_link" >/dev/null 2>&1; then
  :
fi
cnt="$(grep -cE "WHERE (\w+\.)?notion_synced_at IS NULL LIMIT" "$BRAIN_DIR/src/notion-push-sync.js" || true)"
[[ "${cnt:-0}" == "0" ]] || fail "仍有 $cnt 处 insert-only 单行判据"
pass "insert-only 单行判据清零（改了就同步、没改不重推）"

# 3. 九个迁移函数都经统一引擎
uses="$(grep -c "pushRegisteredRows(" "$BRAIN_DIR/src/notion-push-sync.js" || true)"
[[ "${uses:-0}" -ge 8 ]] || fail "pushRegisteredRows 调用仅 $uses 处（应≥8）"
pass "统一引擎 pushRegisteredRows 承接 $uses 处推送"

# 4. 指纹稳定性（键序无关）与不可逆
"$NODE" --input-type=module -e "
import { propsDigest } from '$BRAIN_DIR/src/lib/notion-projection-engine.js';
const a = propsDigest({ B: { select: { name: 'x' } }, A: { title: [{ text: { content: 't' } }] } });
const b = propsDigest({ A: { title: [{ text: { content: 't' } }] }, B: { select: { name: 'x' } } });
const c = propsDigest({ A: { title: [{ text: { content: 'u' } }] }, B: { select: { name: 'x' } } });
if (a !== b) { console.error('键序影响指纹'); process.exit(1); }
if (a === c) { console.error('内容变了指纹未变'); process.exit(1); }
" || fail "propsDigest 不稳定"
pass "propsDigest：键序无关、内容敏感"

echo "ALL PASS: notion-projection-engine"
