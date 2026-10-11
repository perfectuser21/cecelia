#!/usr/bin/env bash
# brain-deploy-internal-token-stat.test.sh — 部署时内部 token 文件权限检查在 GNU stat 下误判
#
# 背景（任务 B3 / e2fc7076 次要问题）：ensure_cecelia_internal_token 先跑 BSD 写法 `stat -f '%Lp'`。
# GNU stat 的 -f 是"查文件系统"，'%Lp' 被当成文件名，输出一堆文件系统信息，权限永远读不成 600，
# 于是每次部署都 chmod；token 文件在只读挂载上时日志里每次刷 "Read-only file system"。
# 本测试用假 stat（GNU 行为）+ 假 chmod（记调用）锁死：
#   1) GNU 环境下权限已是 600 → 不调用 chmod；
#   2) 文件不可写（只读挂载）→ 不调用 chmod，照常加载 token 并打印提示。
set -uo pipefail

ERRORS=0
PASS=0
pass() { echo "✅ $1"; PASS=$((PASS + 1)); }
fail() { echo "❌ $1"; ERRORS=$((ERRORS + 1)); }

REPO_ROOT=$(git rev-parse --show-toplevel 2>/dev/null || pwd)
HELPER="$REPO_ROOT/scripts/lib/internal-auth-token.sh"
TMPD=$(mktemp -d "${TMPDIR:-/tmp}/internal-token-stat.XXXXXX")
trap 'chmod -R u+w "$TMPD" 2>/dev/null; rm -rf "$TMPD"' EXIT

TOK="0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcd"
BIN="$TMPD/bin"
mkdir -p "$BIN"
# 假 GNU stat：-c FMT 输出 FAKE_MODE；-f 当作"查文件系统"，把格式串当文件名报错，同时输出文件系统信息
cat > "$BIN/stat" <<'EOF'
#!/usr/bin/env bash
if [[ "$1" == "-c" ]]; then echo "${FAKE_MODE:-600}"; exit 0; fi
if [[ "$1" == "-f" ]]; then
  echo "  File: \"$3\""; echo "    ID: 0        Namelen: 255     Type: overlayfs"
  echo "stat: cannot read file system information for '$2': No such file or directory" >&2
  exit 1
fi
exit 1
EOF
cat > "$BIN/chmod" <<'EOF'
#!/usr/bin/env bash
echo "$*" >> "$CHMOD_LOG"
echo "chmod: changing permissions of '$2': Read-only file system" >&2
exit 1
EOF
chmod +x "$BIN/stat" "$BIN/chmod"

run_case() {
  # $1 = FAKE_MODE；$2 = 是否把文件设为不可写（ro/rw）
  local mode="$1" rw="$2" env_file="$TMPD/token-$1-$2.env"
  printf 'CECELIA_INTERNAL_TOKEN=%s\n' "$TOK" > "$env_file"
  [[ "$rw" == ro ]] && command chmod 444 "$env_file"
  : > "$TMPD/chmod.log"
  OUT=$(PATH="$BIN:$PATH" FAKE_MODE="$mode" CHMOD_LOG="$TMPD/chmod.log" \
    bash -c 'source "$1"; ensure_cecelia_internal_token "$2" && printf "loaded=%s" "${CECELIA_INTERNAL_TOKEN:0:8}"' _ "$HELPER" "$env_file" 2>"$TMPD/err")
  RC=$?
  ERR=$(cat "$TMPD/err")
  CHMOD_CALLS=$(wc -l < "$TMPD/chmod.log" | tr -d ' ')
}

echo "=== GNU stat：权限已是 600 → 不 chmod ==="
run_case 600 rw
[[ $RC -eq 0 && "$OUT" == "loaded=01234567" ]] && pass "token 正常加载" || fail "token 加载失败 rc=$RC out=$OUT"
[[ "$CHMOD_CALLS" == 0 ]] && pass "未调用 chmod" || fail "权限已是 600 仍调用 chmod $CHMOD_CALLS 次（GNU stat 误判）"
[[ "$ERR" != *"Read-only file system"* ]] && pass "stderr 无 Read-only 报错" || fail "stderr 出现 Read-only 报错：$ERR"

if [[ "$(id -u)" != 0 ]]; then
  echo "=== 只读挂载（文件不可写，权限 444）→ 跳过 chmod 并提示 ==="
  run_case 444 ro
  [[ $RC -eq 0 && "$OUT" == "loaded=01234567" ]] && pass "只读文件 token 照常加载" || fail "只读文件 token 加载失败 rc=$RC out=$OUT"
  [[ "$CHMOD_CALLS" == 0 ]] && pass "只读文件未调用 chmod" || fail "只读文件仍调用 chmod $CHMOD_CALLS 次"
  [[ "$ERR" == *"只读"* ]] && pass "stderr 提示文件只读、跳过权限收紧" || fail "stderr 缺少只读提示：$ERR"
fi

echo "=== 可写且权限不是 600 → 仍收紧权限 ==="
run_case 644 rw
[[ "$CHMOD_CALLS" == 1 ]] && pass "调用 chmod 收紧权限" || fail "权限 644 可写却未 chmod（调用 $CHMOD_CALLS 次）"

echo ""
echo "结果: PASS=$PASS FAIL=$ERRORS"
[[ $ERRORS -eq 0 ]] || exit 1
