#!/usr/bin/env bash
# self-model-lock-smoke.sh
#
# 真环境验证 self_model 写入代码层锁。
# 不连数据库（用 mock pool），只验证 caller-allowlist 拒绝/通过逻辑在真 node 进程下成立。
#
# 三档验证：
#  1) 未授权外部脚本调用 updateSelfModel → 必须抛 SelfModelWriteDeniedError
#  2) ACTION_WHITELIST 不再包含 write_self_model
#  3) validateDecision 拒绝 write_self_model action
#
# 退出码：0 = 全部通过，非 0 = 某项失败

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../../../.." && pwd)"
cd "$REPO_ROOT"

echo "🔒 self-model-lock-smoke：验证 self_model 写入代码层锁"
echo "  repo: $REPO_ROOT"
echo ""

PASS=0
FAIL=0

run_case() {
  local name="$1"
  local cmd="$2"
  echo "▶ $name"
  if eval "$cmd"; then
    echo "  ✅ PASS"
    PASS=$((PASS + 1))
  else
    echo "  ❌ FAIL"
    FAIL=$((FAIL + 1))
  fi
  echo ""
}

run_case "未授权脚本调用 updateSelfModel → 必须拒绝" \
  "node $SCRIPT_DIR/self-model-lock-fixture.mjs"

run_case "ACTION_WHITELIST 不含 write_self_model" \
  "node --input-type=module -e \"
    import('$REPO_ROOT/packages/brain/src/thalamus.js').then(m => {
      if (m.ACTION_WHITELIST.write_self_model !== undefined) {
        console.error('write_self_model 仍在白名单');
        process.exit(1);
      }
      console.log('  whitelist 中无 write_self_model');
    }).catch(e => { console.error(e); process.exit(1); });
  \""

run_case "validateDecision 拒绝 write_self_model action" \
  "node --input-type=module -e \"
    import('$REPO_ROOT/packages/brain/src/thalamus.js').then(m => {
      const r = m.validateDecision({
        level: 1,
        actions: [{ type: 'write_self_model', params: {} }],
        rationale: 'haiku attack',
        confidence: 0.9,
        safety: false
      });
      if (r.valid) { console.error('validateDecision 居然通过了'); process.exit(1); }
      if (!r.errors.join(' ').includes('write_self_model')) {
        console.error('错误信息未提及 write_self_model:', r.errors);
        process.exit(1);
      }
      console.log('  validateDecision 拒绝成功:', r.errors.join('; '));
    }).catch(e => { console.error(e); process.exit(1); });
  \""

echo "─────────────────────────────"
echo "通过: $PASS"
echo "失败: $FAIL"

if [ "$FAIL" -gt 0 ]; then
  exit 1
fi
exit 0
