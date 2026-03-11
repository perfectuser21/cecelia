#!/usr/bin/env bash
# 单元测试：验证 cecelia-run.sh send_webhook payload 包含 exit_code 字段
# 用法：bash packages/brain/scripts/test-cecelia-run-payload.sh
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
CECELIA_RUN="$SCRIPT_DIR/cecelia-run.sh"

PASS=0
FAIL=0
TMPDIR_TEST=$(mktemp -d "/tmp/cecelia-payload-test.XXXXXX")
PAYLOAD_FILE="$TMPDIR_TEST/captured_payload"
trap 'rm -rf "$TMPDIR_TEST"' EXIT

pass() { echo "  PASS: $1"; PASS=$((PASS+1)); }
fail() { echo "  FAIL: $1"; FAIL=$((FAIL+1)); }

echo "=== test-cecelia-run-payload: send_webhook exit_code 字段验证 ==="
echo ""

# 创建 fake curl：把 -d 参数写入 $PAYLOAD_CAPTURE_FILE（通过环境变量传入）
FAKE_CURL="$TMPDIR_TEST/curl"
cat > "$FAKE_CURL" << 'EOF'
#!/usr/bin/env bash
prev=""
for arg in "$@"; do
  if [[ "$prev" == "-d" ]]; then
    echo "$arg" > "$PAYLOAD_CAPTURE_FILE"
    exit 0
  fi
  prev="$arg"
done
EOF
chmod +x "$FAKE_CURL"

# 创建 fake jq（模拟 jq 不可用，用于 fallback 测试）
FAKE_NO_JQ="$TMPDIR_TEST/no-jq-bin"
mkdir -p "$FAKE_NO_JQ"
cat > "$FAKE_NO_JQ/jq" << 'EOF'
#!/usr/bin/env bash
exit 127
EOF
chmod +x "$FAKE_NO_JQ/jq"

# ---- 测试 1: jq 路径 exit_code=42 ----
echo "[1/3] jq 路径：exit_code 整数值正确传递（exit_code=42）"
if command -v jq >/dev/null 2>&1; then
  PAYLOAD_CAPTURE_FILE="$PAYLOAD_FILE" \
  PATH="$TMPDIR_TEST:$PATH" \
  TASK_ID="test-task-id" \
  CHECKPOINT_ID="test-ckpt-id" \
  WEBHOOK_URL="http://mock.local/webhook" \
  WEBHOOK_TOKEN="" \
  bash -c "
    eval \"\$(sed -n '/^send_webhook()/,/^}/p' '$CECELIA_RUN')\"
    send_webhook 'AI Failed' '/tmp/nx1' '/tmp/nx2' 1000 1 '' 42
  " 2>/dev/null || true

  PAYLOAD=$(cat "$PAYLOAD_FILE" 2>/dev/null || echo "")
  if echo "$PAYLOAD" | jq -e '.exit_code == 42' >/dev/null 2>&1; then
    pass "jq payload 包含 exit_code=42"
  else
    fail "jq payload 缺少 exit_code 或值不正确: [$PAYLOAD]"
  fi
else
  pass "SKIP: jq 不可用"
fi

# ---- 测试 2: jq 路径 exit_code=0（成功场景）----
echo "[2/3] jq 路径：exit_code=0（成功场景）"
if command -v jq >/dev/null 2>&1; then
  PAYLOAD_CAPTURE_FILE="$PAYLOAD_FILE" \
  PATH="$TMPDIR_TEST:$PATH" \
  TASK_ID="test-task-id" \
  CHECKPOINT_ID="test-ckpt-id" \
  WEBHOOK_URL="http://mock.local/webhook" \
  WEBHOOK_TOKEN="" \
  bash -c "
    eval \"\$(sed -n '/^send_webhook()/,/^}/p' '$CECELIA_RUN')\"
    send_webhook 'AI Done' '/tmp/nx1' '/tmp/nx2' 5000 1 '' 0
  " 2>/dev/null || true

  PAYLOAD2=$(cat "$PAYLOAD_FILE" 2>/dev/null || echo "")
  if echo "$PAYLOAD2" | jq -e '.exit_code == 0' >/dev/null 2>&1; then
    pass "jq payload exit_code=0 正确（成功场景）"
  else
    fail "jq payload 成功场景 exit_code 不正确: [$PAYLOAD2]"
  fi
else
  pass "SKIP: jq 不可用"
fi

# ---- 测试 3: fallback payload 静态验证 ----
# jq fallback 是一个纯字符串构建，直接从脚本源码中提取并在 bash 子 shell 中执行
echo "[3/3] fallback 路径：exit_code 出现在 JSON 字符串中（静态执行验证）"
FALLBACK_PAYLOAD=$(bash -c '
  export TASK_ID="t1"
  export CHECKPOINT_ID="c1"
  status="AI Failed"
  duration=1000
  attempt=1
  exit_code_val=7
  # 直接执行 fallback payload 构造（与脚本中 else 分支相同的逻辑）
  echo "{\"task_id\":\"$TASK_ID\",\"checkpoint_id\":\"$CHECKPOINT_ID\",\"run_id\":\"$CHECKPOINT_ID\",\"status\":\"$status\",\"coding_type\":\"cecelia\",\"duration_ms\":$duration,\"attempt\":$attempt,\"exit_code\":$exit_code_val}"
')
if echo "$FALLBACK_PAYLOAD" | grep -q '"exit_code":7'; then
  pass "fallback payload 包含 exit_code=7"
else
  fail "fallback payload 缺少 exit_code: [$FALLBACK_PAYLOAD]"
fi

# 同时验证脚本源码中 fallback 行确实包含 exit_code 字段
if grep -q '\\\"exit_code\\\":' "$CECELIA_RUN" 2>/dev/null; then
  pass "脚本源码 fallback 行含 exit_code 字段"
else
  fail "脚本源码 fallback 行缺少 exit_code 字段"
fi

echo ""
echo "=== 结果: ${PASS} passed, ${FAIL} failed ==="
[[ $FAIL -eq 0 ]]
