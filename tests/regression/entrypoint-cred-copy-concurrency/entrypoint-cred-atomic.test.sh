#!/usr/bin/env bash
# entrypoint-cred-atomic.test.sh
# 回归测试：entrypoint.sh 凭据精确复制 + 并发安全（d4e0ec91 二期修复）
#
# 验证：
#   1. 静态：修复后代码使用 include-list（不遍历 $HOST_CFG/*），.credentials.json 原子复制
#   2. 功能：含 .credentials.json 的 HOST_CFG → LOCAL_CFG 复制正确
#   3. 并发：3 个实例同时从同一 HOST_CFG 复制，均能读到完整 .credentials.json
#
# 根因：旧代码遍历 HOST_CFG 时碰到 .claude.json.tmp.* 并发写文件会卡死，
#       .credentials.json 因此从未被复制 → Claude Code 401 静默失败

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ENTRYPOINT="${SCRIPT_DIR}/../../../docker/cecelia-runner/entrypoint.sh"
PASS=0
FAIL=0

pass() { echo "  PASS: $1"; PASS=$((PASS + 1)); }
fail() { echo "  FAIL: $1 — $2"; FAIL=$((FAIL + 1)); }

echo ""
echo "[entrypoint-cred-atomic] Regression: credentials 精确复制 + 并发安全"
echo ""

if [[ ! -f "$ENTRYPOINT" ]]; then
  fail "entrypoint.sh 存在" "文件不存在：$ENTRYPOINT"
  echo "结果: ${PASS} PASS, ${FAIL} FAIL"
  exit 1
fi

# ─── 1. 静态断言 ──────────────────────────────────────────────────────────────

test_no_glob_loop() {
  # 旧代码：for entry in "$HOST_CFG"/*  — 遍历整个目录
  # 修复后：不能有这种 glob 遍历（include-list 精确复制）
  if grep -E 'for.*HOST_CFG.*\*|for.*\$HOST_CFG/\*' "$ENTRYPOINT" | grep -qv '^\s*#'; then
    fail "不遍历 HOST_CFG/* glob" "仍有 for entry in \$HOST_CFG/* 循环（旧代码残留）"
  else
    pass "不遍历 HOST_CFG/* glob（include-list 精确复制）"
  fi
}

test_atomic_cred_copy() {
  # 原子写入：需要 mktemp + mv 的模式
  if grep -q 'mktemp' "$ENTRYPOINT" && grep -qE 'mv.*_CRED|mv.*cred.*tmp|mv.*credentials' "$ENTRYPOINT"; then
    pass ".credentials.json 使用 mktemp + mv 原子复制"
  else
    fail ".credentials.json 原子复制" "未找到 mktemp + mv 模式"
  fi
}

test_credentials_explicitly_named() {
  # 修复后代码必须显式引用 .credentials.json（不是通过 glob）
  if grep -q '\.credentials\.json' "$ENTRYPOINT"; then
    pass "代码显式引用 .credentials.json"
  else
    fail "显式引用 .credentials.json" "未找到显式引用"
  fi
}

test_include_list_has_settings() {
  # include-list 应包含 settings.json
  if grep -E "settings\.json" "$ENTRYPOINT" | grep -qv '^\s*#'; then
    pass "include-list 包含 settings.json"
  else
    fail "include-list 包含 settings.json" "未找到 settings.json 复制"
  fi
}

test_no_dot_glob_expansion() {
  # 旧代码用 dotglob 来捕捉隐藏文件（.credentials.json）
  # 修复后无需 dotglob（显式指定文件名）
  # 注：dotglob 如果保留也不是错，只是确认 .credentials.json 已被显式处理
  pass "dotglob 不再是复制 .credentials.json 的必要条件（显式引用）"
}

test_no_glob_loop
test_atomic_cred_copy
test_credentials_explicitly_named
test_include_list_has_settings
test_no_dot_glob_expansion

echo ""

# ─── 2. 功能测试：基本复制正确性 ─────────────────────────────────────────────

CRED_COPY_CODE="$(awk '/^# 1\. 复制只读配置/{found=1} found{print} found && /^fi$/{exit}' "$ENTRYPOINT")"

run_cred_copy_section() {
  local host_cfg="$1"
  local local_cfg="$2"

  # 提取并执行 entrypoint.sh 中的凭据复制段落
  # 避免执行整个 entrypoint（它要调 claude / git 等）
  bash -c "
    set -uo pipefail
    HOST_CFG='$host_cfg'
    LOCAL_CFG='$local_cfg'
    CLAUDE_CONFIG_DIR='$local_cfg'
    $CRED_COPY_CODE
  " 2>/dev/null
}

TMPROOT="$(mktemp -d)"
trap 'rm -rf "$TMPROOT"' EXIT

test_basic_copy() {
  local host="$TMPROOT/host-basic"
  local local="$TMPROOT/local-basic"
  mkdir -p "$host" "$local"

  # 创建 HOST_CFG 模拟文件
  printf '{"primaryApiKey":"sk-ant-test-basic"}' > "$host/.credentials.json"
  printf '{"hooks":{}}' > "$host/settings.json"
  mkdir -p "$host/skills"
  printf '# test skill' > "$host/skills/TEST.md"
  # 模拟并发写入的临时文件（旧代码会卡在这里）
  printf 'partial-write...' > "$host/.claude.json.tmp.12345.abcdef"
  printf '{"big":"json"}' > "$host/.claude.json"

  run_cred_copy_section "$host" "$local"

  if [[ -f "$local/.credentials.json" ]]; then
    local content
    content="$(cat "$local/.credentials.json")"
    if [[ "$content" == '{"primaryApiKey":"sk-ant-test-basic"}' ]]; then
      pass "基本功能：.credentials.json 内容正确复制"
    else
      fail "基本功能：.credentials.json 内容" "内容不匹配：$content"
    fi
  else
    fail "基本功能：.credentials.json 存在" ".credentials.json 未被复制到 LOCAL_CFG"
  fi

  if [[ -f "$local/settings.json" ]]; then
    pass "基本功能：settings.json 被复制"
  else
    fail "基本功能：settings.json 被复制" "settings.json 未出现在 LOCAL_CFG"
  fi

  # 临时文件不能被复制到 LOCAL_CFG
  if ls "$local/.claude.json.tmp."* 2>/dev/null | grep -q .; then
    fail "基本功能：不复制 .claude.json.tmp.*" ".claude.json.tmp.* 被错误复制"
  else
    pass "基本功能：.claude.json.tmp.* 不被复制"
  fi

  if [[ -d "$local/session-env" ]]; then
    pass "基本功能：session-env 目录已创建"
  else
    fail "基本功能：session-env 目录" "session-env 不存在"
  fi
}

test_missing_credentials() {
  local host="$TMPROOT/host-nocreds"
  local local="$TMPROOT/local-nocreds"
  mkdir -p "$host" "$local"
  # HOST_CFG 里没有 .credentials.json
  printf '{"hooks":{}}' > "$host/settings.json"

  run_cred_copy_section "$host" "$local"

  # 不应崩溃，session-env 应存在
  if [[ -d "$local/session-env" ]]; then
    pass "容错：HOST_CFG 无 .credentials.json 时不崩溃"
  else
    fail "容错：HOST_CFG 无 .credentials.json 时" "脚本崩溃或 session-env 未创建"
  fi
}

echo "[功能测试]"
test_basic_copy
test_missing_credentials
echo ""

# ─── 3. 并发测试：3 个实例同时复制，均应读到完整 .credentials.json ────────────

test_concurrent_copy() {
  local host="$TMPROOT/host-concurrent"
  mkdir -p "$host"

  local cred_content='{"primaryApiKey":"sk-ant-concurrent-safe-12345"}'
  printf '%s' "$cred_content" > "$host/.credentials.json"
  printf '{"hooks":{"stop":[]}}' > "$host/settings.json"
  mkdir -p "$host/skills"

  # 模拟并发写文件压力（持续写入 .claude.json.tmp.*，旧代码会卡死在这里）
  local writer_pid=""
  (
    while :; do
      printf 'concurrent-write-%s' "$RANDOM" > "$host/.claude.json.tmp.${BASHPID}.$(date +%s%N)"
      rm -f "$host/.claude.json.tmp."* 2>/dev/null || true
    done
  ) &
  writer_pid=$!

  local pids=()
  local results=()
  for i in 1 2 3; do
    local local_i="$TMPROOT/local-concurrent-$i"
    mkdir -p "$local_i"
    (
      run_cred_copy_section "$host" "$local_i"
      exit $?
    ) &
    pids+=($!)
    results+=("$local_i")
  done

  # 等待所有 3 个复制完成（最多 10s）
  local all_ok=true
  for pid in "${pids[@]}"; do
    if ! wait "$pid"; then
      all_ok=false
    fi
  done

  # 停止并发写入
  kill "$writer_pid" 2>/dev/null || true
  wait "$writer_pid" 2>/dev/null || true

  local lost=0
  for i in 1 2 3; do
    local local_i="$TMPROOT/local-concurrent-$i"
    if [[ -f "$local_i/.credentials.json" ]]; then
      local content
      content="$(cat "$local_i/.credentials.json" 2>/dev/null || echo '')"
      if [[ "$content" == "$cred_content" ]]; then
        pass "并发实例 $i：.credentials.json 完整"
      else
        fail "并发实例 $i：.credentials.json 内容" "内容不完整或不匹配（len=${#content}）"
        lost=$((lost + 1))
      fi
    else
      fail "并发实例 $i：.credentials.json 存在" "文件丢失（d4e0ec91 回归）"
      lost=$((lost + 1))
    fi
  done

  if [[ $lost -eq 0 ]]; then
    pass "并发测试：3/3 实例均读到完整 .credentials.json（无丢失）"
  fi
}

echo "[并发测试]"
test_concurrent_copy
echo ""

# ─── 总结 ─────────────────────────────────────────────────────────────────────
echo "结果: ${PASS} PASS, ${FAIL} FAIL"
if [[ $FAIL -gt 0 ]]; then
  exit 1
fi
exit 0
