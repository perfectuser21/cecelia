#!/usr/bin/env bash
# install-launchers.test.sh
# Contract test — scripts/install-launchers.sh 幂等安装
#
# 验证（INV-9）：
#   - 追加受控 alias block（cecelia-launchers-begin/end）
#   - 重复运行不产生重复 alias
#   - 不覆盖 ~/.zshrc 其他内容
#   - 脚本含 codex-launch.sh 和 grok-launch.sh alias
#
# 运行方式：bash sprints/07222128-codex-grok-launcher-supervisor/tests/install-launchers.test.sh
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TARGET="${SCRIPT_DIR}/../../../scripts/install-launchers.sh"
PASS=0
FAIL=0

pass() { echo "  PASS: $1"; PASS=$((PASS + 1)); }
fail() { echo "  FAIL: $1 — $2"; FAIL=$((FAIL + 1)); }

echo ""
echo "[install-launchers.test] Contract Test: install-launchers.sh 幂等 alias 追加"
echo ""

if [[ ! -f "$TARGET" ]]; then
  fail "scripts/install-launchers.sh 存在" "文件未创建"
  echo "结果: ${PASS} PASS, ${FAIL} FAIL"
  exit 1
fi

# ─── 静态源码断言 ────────────────────────────────────────────────────────────

test_begin_block_exists() {
  if grep -qE 'cecelia-launchers-begin|launchers-begin' "$TARGET"; then
    pass "install-launchers.sh 含受控 block begin 标记（INV-9）"
  else
    fail "install-launchers.sh 含受控 block begin 标记（INV-9）" \
      "cecelia-launchers-begin 未找到"
  fi
}

test_end_block_exists() {
  if grep -qE 'cecelia-launchers-end|launchers-end' "$TARGET"; then
    pass "install-launchers.sh 含受控 block end 标记（INV-9）"
  else
    fail "install-launchers.sh 含受控 block end 标记（INV-9）" \
      "cecelia-launchers-end 未找到"
  fi
}

test_codex_launch_alias() {
  if grep -q 'codex-launch\.sh' "$TARGET"; then
    pass "install-launchers.sh 含 codex-launch.sh alias（FR-R8）"
  else
    fail "install-launchers.sh 含 codex-launch.sh alias（FR-R8）" \
      "codex-launch.sh 未找到"
  fi
}

test_grok_launch_alias() {
  if grep -q 'grok-launch\.sh' "$TARGET"; then
    pass "install-launchers.sh 含 grok-launch.sh alias（FR-R8）"
  else
    fail "install-launchers.sh 含 grok-launch.sh alias（FR-R8）" \
      "grok-launch.sh 未找到"
  fi
}

# ─── 动态幂等性测试 ──────────────────────────────────────────────────────────

test_idempotent_no_duplicate() {
  local TMP
  TMP=$(mktemp -d)
  local FAKE_HOME="$TMP/home"
  mkdir -p "$FAKE_HOME"
  local ZSHRC="$FAKE_HOME/.zshrc"

  # 预填充一些已有内容
  cat >"$ZSHRC" <<'EOF'
# existing content
export FOO=bar
alias ls='ls --color'
EOF

  local ORIGINAL_CONTENT
  ORIGINAL_CONTENT=$(cat "$ZSHRC")

  # 第一次运行
  HOME="$FAKE_HOME" bash "$TARGET" >/tmp/install-launchers-out.$$ 2>&1 || true

  local after_first
  after_first=$(cat "$ZSHRC" 2>/dev/null || echo "")

  # 第二次运行（幂等测试）
  HOME="$FAKE_HOME" bash "$TARGET" >/tmp/install-launchers-out2.$$ 2>&1 || true

  local after_second
  after_second=$(cat "$ZSHRC" 2>/dev/null || echo "")

  # 第二次运行后内容应与第一次相同（无重复追加）
  if [[ "$after_first" == "$after_second" ]]; then
    pass "重复运行 install-launchers.sh 不产生重复内容（INV-9 幂等）"
  else
    # 检查 begin/end block 是否只出现一次
    local begin_count
    begin_count=$(grep -c 'launchers-begin' "$ZSHRC" 2>/dev/null || echo 0)
    if [[ "$begin_count" -le 1 ]]; then
      pass "重复运行 install-launchers.sh begin block 仅出现 1 次（INV-9 幂等宽松）"
    else
      fail "重复运行 install-launchers.sh 不产生重复内容（INV-9 幂等）" \
        "begin block 出现 ${begin_count} 次"
    fi
  fi

  rm -rf "$TMP" /tmp/install-launchers-out.$$ /tmp/install-launchers-out2.$$ 2>/dev/null || true
}

test_existing_content_preserved() {
  local TMP
  TMP=$(mktemp -d)
  local FAKE_HOME="$TMP/home"
  mkdir -p "$FAKE_HOME"
  local ZSHRC="$FAKE_HOME/.zshrc"

  local SENTINEL="# my-unique-sentinel-12345"
  echo "$SENTINEL" >"$ZSHRC"

  HOME="$FAKE_HOME" bash "$TARGET" >/tmp/install-launchers-preserve.$$ 2>&1 || true

  if grep -q "$SENTINEL" "$ZSHRC" 2>/dev/null; then
    pass "install-launchers.sh 不覆盖 ~/.zshrc 已有内容（INV-9）"
  else
    fail "install-launchers.sh 不覆盖 ~/.zshrc 已有内容（INV-9）" \
      "sentinel 内容消失"
  fi

  rm -rf "$TMP" /tmp/install-launchers-preserve.$$ 2>/dev/null || true
}

# ─── 运行所有测试 ────────────────────────────────────────────────────────────
test_begin_block_exists
test_end_block_exists
test_codex_launch_alias
test_grok_launch_alias
test_idempotent_no_duplicate
test_existing_content_preserved

echo ""
echo "结果: ${PASS} PASS, ${FAIL} FAIL"
echo ""

if [[ $FAIL -gt 0 ]]; then
  exit 1
fi
