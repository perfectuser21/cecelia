#!/usr/bin/env bash
# check-harness-terminal-failure-class.test.sh — harness terminal 失败可观测机械闸自测。
#
# 合同: sprints/08101830-harness-failure-observability/contract-draft.md（Step 4 / B-06）
# 证明两件事（proven-to-fire）：
#   1. 真树扫描 → exit 0（现存全部 terminal 写入点已合规或已显式豁免）
#   2. 注入一处「裸 terminal 写入（不写 failure_class、无豁免注解）」→ lint exit 1（拦截成立）
#   3. 注入的裸写补上 failure_class → lint 恢复 exit 0（正向对照，防止 lint 恒为 1 的假拦截）
set -uo pipefail
ERRORS=0; PASS=0
pass() { echo "✅ $1"; PASS=$((PASS+1)); }
fail() { echo "❌ $1"; ERRORS=$((ERRORS+1)); }

REPO_ROOT=$(git rev-parse --show-toplevel 2>/dev/null || pwd)
LINT="$REPO_ROOT/scripts/check-harness-terminal-failure-class.mjs"
TMPD=$(mktemp -d -t harness-fc-lint-test.XXXXXX)
trap 'rm -rf "$TMPD"' EXIT

echo "=== check-harness-terminal-failure-class 自测 ==="

# 场景1：真树扫描默认白名单 → exit 0
if (cd "$REPO_ROOT" && node "$LINT" >/dev/null 2>&1); then
  pass "真树扫描 exit 0（现存写入点全合规/已豁免）"
else
  fail "真树扫描应 exit 0，实际非零"
fi

# 场景2：注入裸 terminal 写入（无 failure_class、无豁免） → lint exit 1
BARE_FIXTURE="$TMPD/bare-terminal-write.js"
cat > "$BARE_FIXTURE" <<'EOF'
// 故意的裸 terminal 写入 —— 机械闸必须拦下
async function markBad(pool, id) {
  await pool.query(
    `UPDATE tasks SET status='failed', completed_at=NOW(), error_message=$2 WHERE id=$1`,
    [id, 'boom']
  );
}
EOF
if node "$LINT" "$BARE_FIXTURE" >/dev/null 2>&1; then
  fail "注入裸 terminal 写入后 lint 仍 exit 0（拦截失效）"
else
  pass "注入裸 terminal 写入 → lint exit 1（拦截成立）"
fi

# 场景3：给注入的裸写补上 result.failure_class → lint 恢复 exit 0（正向对照）
FIXED_FIXTURE="$TMPD/fixed-terminal-write.js"
cat > "$FIXED_FIXTURE" <<'EOF'
async function markGood(pool, id) {
  await pool.query(
    `UPDATE tasks SET status='failed', completed_at=NOW(),
       result = COALESCE(result,'{}'::jsonb) || jsonb_build_object('failure_class','unknown')
     WHERE id=$1`,
    [id]
  );
}
EOF
if node "$LINT" "$FIXED_FIXTURE" >/dev/null 2>&1; then
  pass "补上 failure_class 后 lint exit 0（正向对照，非恒为 1 的假拦截）"
else
  fail "补上 failure_class 后 lint 仍 exit 1（假拦截）"
fi

echo "=== 通过 $PASS / 失败 $ERRORS ==="
[ "$ERRORS" -eq 0 ]
