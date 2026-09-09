#!/usr/bin/env bash
# db-slim 冒烟：9 条清理规则 SQL 对真实 schema 可执行 + check 模式双向验火。
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../../.." && pwd)"
cd "$ROOT_DIR"

pass() { printf 'PASS: %s\n' "$1"; }
fail() { printf 'FAIL: %s\n' "$1" >&2; exit 1; }

: "${DATABASE_URL:?DATABASE_URL is required and must target a test or scratch database}"
NODE_EXECUTABLE="$(command -v node)"
DATABASE_NAME="$("$NODE_EXECUTABLE" -e "const u=new URL(process.argv[1]); process.stdout.write(decodeURIComponent(u.pathname.slice(1)))" "$DATABASE_URL")"
[[ "$DATABASE_NAME" =~ (_test|_scratch)$ ]] \
  || fail "拒绝连接非测试库: ${DATABASE_NAME:-<empty>}"

# 1) dry-run：9 条规则的 archiveWhere/preAssert 全部真跑一遍（对 schema 的存在性/列名/类型校验）
DRY_OUT="$("$NODE_EXECUTABLE" packages/brain/scripts/db-slim.mjs 2>&1)" \
  || fail "dry-run 执行失败: $DRY_OUT"
RULE_COUNT="$(printf '%s\n' "$DRY_OUT" | grep -c '命中 .* 行' || true)"
[[ "$RULE_COUNT" -eq 9 ]] || fail "dry-run 应报告 9 条规则，实际 $RULE_COUNT: $DRY_OUT"
pass "dry-run 9 条规则 SQL 对真实 schema 可执行"

# 2) check 守卫双向验火：大阈值放行、极小阈值报红
"$NODE_EXECUTABLE" packages/brain/scripts/db-slim.mjs --check --max-db-gb 999999 >/dev/null \
  || fail "check 大阈值应放行（exit 0）"
pass "check 大阈值放行"

if "$NODE_EXECUTABLE" packages/brain/scripts/db-slim.mjs --check --max-db-gb 0.0000001 >/dev/null 2>&1; then
  fail "check 极小阈值应报红（exit 1），实际放行"
fi
pass "check 极小阈值报红（proven-to-fire）"

echo "db-slim-smoke: ALL PASS"
