#!/usr/bin/env bash
# internal-auth-token-format.test.sh — token 文件格式坑的可诊断性
#
# 背景(2026-09-23 P0 9dfd873a④)：MMV 侧 rebuild 步骤即使 token 文件存在扫描仍 FAIL，
# 排查发现 load_cecelia_internal_token 加载失败时是完全静默的
# （run-all-scans.sh 里 `load_cecelia_internal_token ... || true` 只吞返回码，
# 而函数本身任何失败路径都不打一行日志），团队只能靠猜。本测试锁死两件事：
#   1) 常见格式坑（CRLF/引号/export前缀/行尾注释/重复键）确实会导致加载失败
#      （证明"token 文件存在但格式不对"是真实可复现的失败模式，不是臆测）；
#   2) 加载失败时必须在 stderr 打印可定位原因的 WARN，且绝不泄漏 token 值本身。
set -uo pipefail

ERRORS=0
PASS=0
pass() { echo "✅ $1"; PASS=$((PASS + 1)); }
fail() { echo "❌ $1"; ERRORS=$((ERRORS + 1)); }

REPO_ROOT=$(git rev-parse --show-toplevel 2>/dev/null || pwd)
HELPER="$REPO_ROOT/scripts/lib/internal-auth-token.sh"
TMPD=$(mktemp -d "${TMPDIR:-/tmp}/internal-auth-format.XXXXXX")
trap 'rm -rf "$TMPD"' EXIT

if [[ ! -f "$HELPER" ]]; then
  fail "找不到 $HELPER"
  echo "结果: PASS=$PASS FAIL=$ERRORS"
  exit 1
fi

TOK="0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcd"

try_load() {
  # $1 = env file；打印 "rc=<code>\n<stderr>"
  local env_file="$1"
  local out rc
  out=$(bash -c 'source "$1"; load_cecelia_internal_token "$2"' _ "$HELPER" "$env_file" 2>&1 1>/dev/null)
  rc=$?
  printf 'rc=%s\n%s' "$rc" "$out"
}

echo "=== 正常格式：加载成功，不产出 WARN ==="
NORMAL_ENV="$TMPD/normal.env"
printf 'CECELIA_INTERNAL_TOKEN=%s\n' "$TOK" > "$NORMAL_ENV"
RESULT=$(try_load "$NORMAL_ENV")
if [[ "$RESULT" == rc=0* ]]; then
  pass "正常 KEY=VALUE 单行格式加载成功"
else
  fail "正常格式意外加载失败: $RESULT"
fi

declare -A BAD_FILES
BAD_FILES[crlf]=$'CECELIA_INTERNAL_TOKEN='"$TOK"$'\r\n'
BAD_FILES[quoted]='CECELIA_INTERNAL_TOKEN="'"$TOK"'"'$'\n'
BAD_FILES[export_prefix]='export CECELIA_INTERNAL_TOKEN='"$TOK"$'\n'
BAD_FILES[trailing_comment]='CECELIA_INTERNAL_TOKEN='"$TOK"' # rotated'$'\n'
BAD_FILES[duplicate]='CECELIA_INTERNAL_TOKEN='"$TOK"$'\nCECELIA_INTERNAL_TOKEN='"$TOK"$'\n'
BAD_FILES[missing_file]='__MISSING__'

echo ""
echo "=== 已知格式坑：加载失败 + stderr 给出可定位原因、绝不泄漏 token ==="
for case_name in crlf quoted export_prefix trailing_comment duplicate missing_file; do
  ENV_FILE="$TMPD/$case_name.env"
  if [[ "${BAD_FILES[$case_name]}" == '__MISSING__' ]]; then
    ENV_FILE="$TMPD/does-not-exist.env"
  else
    printf '%s' "${BAD_FILES[$case_name]}" > "$ENV_FILE"
  fi

  RESULT=$(try_load "$ENV_FILE")
  RC_LINE=$(printf '%s' "$RESULT" | head -1)
  STDERR_BODY=$(printf '%s' "$RESULT" | tail -n +2)

  if [[ "$RC_LINE" == "rc=1" ]]; then
    pass "[$case_name] 加载失败返回非零"
  else
    fail "[$case_name] 未按预期失败($RC_LINE)"
  fi

  if [[ -n "$STDERR_BODY" && "$STDERR_BODY" == *"WARN"* ]]; then
    pass "[$case_name] stderr 产出 WARN 诊断行"
  else
    fail "[$case_name] 失败但 stderr 静默，无法定位原因"
  fi

  if [[ "$STDERR_BODY" != *"$TOK"* ]]; then
    pass "[$case_name] 诊断信息不泄漏 token 值"
  else
    fail "[$case_name] 诊断信息意外泄漏了 token 值"
  fi
done

echo ""
echo "结果: PASS=$PASS FAIL=$ERRORS"
[[ $ERRORS -eq 0 ]] || exit 1
