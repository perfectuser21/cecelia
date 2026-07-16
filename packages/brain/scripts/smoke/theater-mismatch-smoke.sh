#!/usr/bin/env bash
# theater-mismatch-smoke.sh — 戏院错配闸 + 元验证补丁 冒烟脚本
# Sprint: 建制W6（sprints/07161900-theater-mismatch-gate）
# Task: b317ae29-9fbc-4d6f-abf0-016141d6c657
#
# 验证 runMechanicalGate 的两条新机械预检：
#   1. theater_mismatch: GP 含真机关键词 + local_api/mac_web → FAIL
#   2. meta_verification_gap: smoke/验证脚本/演习类 PRD + 无 L3/THEATER 断言 → FAIL
set -euo pipefail

PASS=0
FAIL=0

run_case() {
  local desc="$1"
  local result
  result=$(node --input-type=module <<'EOF'
import { runMechanicalGate } from '/workspace/packages/brain/src/harness-judge.js';
const result = await ${CMD};
process.exit(${CHECK});
EOF
  )
  echo "$result"
}

echo "[smoke] theater-mismatch-smoke.sh 启动"

# Case 1: 戏院错配闸 — 微信真机发送 + local_api → FAIL
echo -n "[1] theater_mismatch (微信+local_api)... "
if node -e "
import('./packages/brain/src/harness-judge.js').then(m => m.runMechanicalGate(
  {taskId:'smoke-1',worktreePath:'/tmp',sprintDir:'x1',brainResult:{verdict:'PASS',behavior_tests:[{command:'c',exit_code:0,log_tail:'ok'}]}},
  {readFileFn:async(p)=>{if(p.includes('sprint-prd'))return '## Golden Path\n1. 微信真机发送消息\n';if(p.includes('contract'))return '[BEHAVIOR] cmd\nTest: ok';throw new Error('ENOENT');},listTestFilesFn:async()=>['a.test.ts'],dbPool:{query:async()=>({rows:[{target_environment:'local_api'}]})}}
).then(r=>{if(!r.pass&&r.reasons.join('').includes('theater_mismatch')){process.exit(0);}else{console.error('FAIL',JSON.stringify(r));process.exit(1);}}))" 2>/dev/null; then
  echo "PASS"; PASS=$((PASS+1))
else
  echo "FAIL"; FAIL=$((FAIL+1))
fi

# Case 2: 戏院错配闸 — adb + mac_web → FAIL
echo -n "[2] theater_mismatch (adb+mac_web)... "
if node -e "
import('./packages/brain/src/harness-judge.js').then(m => m.runMechanicalGate(
  {taskId:'smoke-2',worktreePath:'/tmp',sprintDir:'x2',brainResult:{verdict:'PASS',behavior_tests:[{command:'c',exit_code:0,log_tail:'ok'}]}},
  {readFileFn:async(p)=>{if(p.includes('sprint-prd'))return '## Golden Path\n1. adb shell 截图\n';if(p.includes('contract'))return '[BEHAVIOR] adb screenshot';throw new Error('ENOENT');},listTestFilesFn:async()=>['a.test.ts'],dbPool:{query:async()=>({rows:[{target_environment:'mac_web'}]})}}
).then(r=>{if(!r.pass&&r.reasons.join('').includes('theater_mismatch')){process.exit(0);}else{console.error('FAIL',JSON.stringify(r));process.exit(1);}}))" 2>/dev/null; then
  echo "PASS"; PASS=$((PASS+1))
else
  echo "FAIL"; FAIL=$((FAIL+1))
fi

# Case 3: 元验证补丁 — smoke 类 + 无 L3 → FAIL
echo -n "[3] meta_verification_gap (smoke+无L3)... "
if node -e "
import('./packages/brain/src/harness-judge.js').then(m => m.runMechanicalGate(
  {taskId:'smoke-3',worktreePath:'/tmp',sprintDir:'y3',brainResult:{verdict:'PASS',behavior_tests:[{command:'c',exit_code:0,log_tail:'ok'}]}},
  {readFileFn:async(p)=>{if(p.includes('sprint-prd'))return '# Sprint PRD — smoke 验证脚本演习\n## Golden Path\n1. 验证脚本执行\n';if(p.includes('contract'))return '[BEHAVIOR] curl localhost/api\nTest: manual:curl localhost/api';throw new Error('ENOENT');},listTestFilesFn:async()=>['a.test.ts'],dbPool:{query:async()=>({rows:[{target_environment:'local_api'}]})}}
).then(r=>{if(!r.pass&&r.reasons.join('').includes('meta_verification_gap')){process.exit(0);}else{console.error('FAIL',JSON.stringify(r));process.exit(1);}}))" 2>/dev/null; then
  echo "PASS"; PASS=$((PASS+1))
else
  echo "FAIL"; FAIL=$((FAIL+1))
fi

# Case 4: 元验证补丁豁免 — smoke 类 + L3 → 不误判
echo -n "[4] meta_verification_gap 豁免 (smoke+L3)... "
if node -e "
import('./packages/brain/src/harness-judge.js').then(m => m.runMechanicalGate(
  {taskId:'smoke-4',worktreePath:'/tmp',sprintDir:'y4',brainResult:{verdict:'PASS',behavior_tests:[{command:'c',exit_code:0,log_tail:'ok'}]}},
  {readFileFn:async(p)=>{if(p.includes('sprint-prd'))return '# 验证脚本演习\n## Golden Path\n1. 真机验证\n';if(p.includes('contract'))return '[BEHAVIOR] adb check\nverification_level: L3\nTest: manual:adb check';throw new Error('ENOENT');},listTestFilesFn:async()=>['a.test.ts'],dbPool:{query:async()=>({rows:[{target_environment:'local_api'}]})}}
).then(r=>{if(!r.reasons.join('').includes('meta_verification_gap')){process.exit(0);}else{console.error('FAIL',JSON.stringify(r));process.exit(1);}}))" 2>/dev/null; then
  echo "PASS"; PASS=$((PASS+1))
else
  echo "FAIL"; FAIL=$((FAIL+1))
fi

# Case 5: 正常 local_api 合同不误伤
echo -n "[5] 正常合同不误伤 (回归)... "
if node -e "
import('./packages/brain/src/harness-judge.js').then(m => m.runMechanicalGate(
  {taskId:'smoke-5',worktreePath:'/tmp',sprintDir:'z5',brainResult:{verdict:'PASS',behavior_tests:[{command:'npm test',exit_code:0,log_tail:'ok'}]}},
  {readFileFn:async(p)=>{if(p.includes('sprint-prd'))return '## Golden Path\n1. 调用 API 返回 200\n';if(p.includes('contract'))return '[BEHAVIOR] curl localhost/api\nTest: manual:curl localhost/api';throw new Error('ENOENT');},listTestFilesFn:async()=>['a.test.ts'],dbPool:{query:async()=>({rows:[{target_environment:'local_api'}]})}}
).then(r=>{if(r.pass){process.exit(0);}else{console.error('FAIL',JSON.stringify(r));process.exit(1);}}))" 2>/dev/null; then
  echo "PASS"; PASS=$((PASS+1))
else
  echo "FAIL"; FAIL=$((FAIL+1))
fi

echo ""
echo "[smoke] 结果: ${PASS} PASS / ${FAIL} FAIL"
if [ "${FAIL}" -gt 0 ]; then
  echo "[smoke] FAILED"
  exit 1
else
  echo "[smoke] ALL PASS"
  exit 0
fi
