#!/usr/bin/env bash
# harness-death-classifier-smoke.sh
# 验收：死因分类器纯函数可以正确分类
set -uo pipefail

PASS=0; FAIL=0
ok()   { echo "✅ $1"; ((PASS++)) || true; }
fail() { echo "❌ $1"; ((FAIL++)) || true; }

# 测试：exitCode=137 → cause=oom
result=$(node -e "
import('./packages/brain/src/harness-death-classifier.js').then(m => {
  const r = m.classifyDeath({ exitCode: 137, stdoutTail: null, tmuxPane: null });
  console.log(r.cause + ',' + r.action);
}).catch(e => { console.error(e.message); process.exit(1); });
" 2>&1)
[[ "$result" == "oom,oom_upgrade" ]] && ok "exitCode=137 → oom,oom_upgrade" || fail "exitCode=137 期望 oom,oom_upgrade 得 $result"

# 测试：unknown fallback
result2=$(node -e "
import('./packages/brain/src/harness-death-classifier.js').then(m => {
  const r = m.classifyDeath({ exitCode: 1, stdoutTail: '', tmuxPane: null });
  console.log(r.cause + ',' + r.action);
}).catch(e => { console.error(e.message); process.exit(1); });
" 2>&1)
[[ "$result2" == "unknown,log_only" ]] && ok "exitCode=1 空 tail → unknown,log_only" || fail "unknown fallback 失败 got $result2"

echo ""
echo "smoke: PASS=$PASS FAIL=$FAIL"
[[ $FAIL -eq 0 ]] && exit 0 || exit 1
