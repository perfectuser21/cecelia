#!/usr/bin/env bash
# Smoke: wave2 — tick-scheduler.js + consciousness-loop.js 真环境验证
# 验证：两模块文件存在、导出符号正确、tick-loop 已切到 runScheduler、
#       Brain 健康（说明 setInterval 链路无 import 错误）
set -euo pipefail

BRAIN_URL="${BRAIN_URL:-http://localhost:5221}"

echo "[wave2-smoke] 1. 文件存在 + 语法 OK"
node --check packages/brain/src/tick-scheduler.js
node --check packages/brain/src/consciousness-loop.js
node --check packages/brain/src/tick-loop.js
echo "[wave2-smoke] 三文件 node --check 通过 ✓"

echo "[wave2-smoke] 2. tick-scheduler 导出 EXECUTOR_ROUTING + runScheduler"
node -e "
import('./packages/brain/src/tick-scheduler.js').then(m => {
  if (typeof m.runScheduler !== 'function') { console.error('FAIL: runScheduler 未导出'); process.exit(1); }
  if (!m.EXECUTOR_ROUTING || m.EXECUTOR_ROUTING.dev_task !== 'cecelia_bridge') {
    console.error('FAIL: EXECUTOR_ROUTING 缺 dev_task'); process.exit(1);
  }
  for (const k of ['dev_task','code_review','arch_review','research','harness']) {
    if (m.EXECUTOR_ROUTING[k] !== 'cecelia_bridge') {
      console.error('FAIL: EXECUTOR_ROUTING.'+k+' 不是 cecelia_bridge'); process.exit(1);
    }
  }
  console.log('tick-scheduler 导出齐全 ✓');
});
"

echo "[wave2-smoke] 3. consciousness-loop 导出 startConsciousnessLoop / stopConsciousnessLoop / _runConsciousnessOnce"
node -e "
import('./packages/brain/src/consciousness-loop.js').then(m => {
  for (const fn of ['startConsciousnessLoop','stopConsciousnessLoop','_runConsciousnessOnce']) {
    if (typeof m[fn] !== 'function') { console.error('FAIL: '+fn+' 未导出'); process.exit(1); }
  }
  console.log('consciousness-loop 导出齐全 ✓');
});
"

echo "[wave2-smoke] 4. CONSCIOUSNESS_ENABLED=false 时 startConsciousnessLoop 返回 false 不建定时器"
CONSCIOUSNESS_ENABLED=false node -e "
import('./packages/brain/src/consciousness-loop.js').then(m => {
  const r = m.startConsciousnessLoop();
  if (r !== false) { console.error('FAIL: 期望 false，实际 '+r); process.exit(1); }
  console.log('CONSCIOUSNESS_ENABLED=false 不启动 ✓');
});
"

echo "[wave2-smoke] 5. tick-loop.js 已切到 runScheduler（源码扫描）"
node -e "
const fs = require('fs');
const src = fs.readFileSync('packages/brain/src/tick-loop.js', 'utf8');
if (!src.includes(\"from './tick-scheduler.js'\")) {
  console.error('FAIL: tick-loop 未 import tick-scheduler'); process.exit(1);
}
if (!src.includes(\"from './consciousness-loop.js'\")) {
  console.error('FAIL: tick-loop 未 import consciousness-loop'); process.exit(1);
}
if (!src.includes('doTick = tickFn || runScheduler')) {
  console.error('FAIL: tick-loop runTickSafe 未切到 runScheduler'); process.exit(1);
}
if (!src.includes('startConsciousnessLoop()')) {
  console.error('FAIL: tick-loop startTickLoop 未启动 consciousness-loop'); process.exit(1);
}
console.log('tick-loop 集成符合预期 ✓');
"

echo "[wave2-smoke] 6. tick-scheduler.js 不含任何 LLM 调用关键字（硬性约束）"
node -e "
const fs = require('fs');
const src = fs.readFileSync('packages/brain/src/tick-scheduler.js', 'utf8');
for (const banned of ['thalamusProcessEvent','generateDecision','runRumination','planNextTask']) {
  if (src.includes(banned)) { console.error('FAIL: tick-scheduler 含 '+banned); process.exit(1); }
}
console.log('tick-scheduler 纯净无 LLM ✓');
"

echo "[wave2-smoke] 7. Brain API 健康（如 Brain 已起）"
if curl -sf --max-time 3 "${BRAIN_URL}/api/brain/health" > /dev/null 2>&1; then
  STATUS=$(curl -sf "${BRAIN_URL}/api/brain/health" | node -e "const d=JSON.parse(require('fs').readFileSync('/dev/stdin','utf8'));console.log(d.status||'unknown')")
  if [[ "$STATUS" != "ok" && "$STATUS" != "healthy" ]]; then
    echo "[wave2-smoke] FAIL: Brain 不健康，status=${STATUS}"
    exit 1
  fi
  echo "[wave2-smoke] Brain 健康 ✓"
else
  echo "[wave2-smoke] Brain 未启动，跳过 health 检查（CI 真环境会拉起）"
fi

echo "[wave2-smoke] 全部检查通过 ✓"
