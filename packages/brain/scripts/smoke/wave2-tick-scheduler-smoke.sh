#!/usr/bin/env bash
# wave2-tick-scheduler-smoke.sh — Wave 2 调度/意识解耦冒烟验证
# 验证：tick-scheduler.js + consciousness-loop.js 新模块基础行为
set -euo pipefail

PASS=0
FAIL=0

check() {
  local desc="$1"
  shift
  if "$@" 2>/dev/null; then
    echo "  ✅ $desc"
    PASS=$((PASS + 1))
  else
    echo "  ❌ $desc"
    FAIL=$((FAIL + 1))
  fi
}

echo "── Wave 2 smoke: tick-scheduler.js ──"

# 1. 语法检查
check "tick-scheduler.js 语法正确" node --check packages/brain/src/tick-scheduler.js

# 2. EXECUTOR_ROUTING 导出完整
check "EXECUTOR_ROUTING 包含 cecelia_bridge" node -e "
  import('./packages/brain/src/tick-scheduler.js').then(m => {
    const r = m.EXECUTOR_ROUTING;
    const types = ['dev_task','code_review','arch_review','research','harness'];
    for (const t of types) {
      if (r[t] !== 'cecelia_bridge') { console.error('Missing', t); process.exit(1); }
    }
    process.exit(0);
  }).catch(e => { console.error(e.message); process.exit(1); });
"

# 3. runScheduler 导出存在
check "runScheduler 函数存在" node -e "
  import('./packages/brain/src/tick-scheduler.js').then(m => {
    if (typeof m.runScheduler !== 'function') { console.error('runScheduler not a function'); process.exit(1); }
    process.exit(0);
  }).catch(e => { console.error(e.message); process.exit(1); });
"

# 4. 源码不含 LLM 调用
check "tick-scheduler.js 不含 LLM 调用" node -e "
  const { readFileSync } = require('fs');
  const src = readFileSync('packages/brain/src/tick-scheduler.js', 'utf8');
  const banned = ['thalamusProcessEvent', 'generateDecision', 'runRumination', 'planNextTask'];
  for (const b of banned) {
    if (src.includes(b)) { console.error('Found banned:', b); process.exit(1); }
  }
  process.exit(0);
"

echo ""
echo "── Wave 2 smoke: consciousness-loop.js ──"

# 5. 语法检查
check "consciousness-loop.js 语法正确" node --check packages/brain/src/consciousness-loop.js

# 6. startConsciousnessLoop 导出
check "startConsciousnessLoop 函数存在" node -e "
  import('./packages/brain/src/consciousness-loop.js').then(m => {
    if (typeof m.startConsciousnessLoop !== 'function') process.exit(1);
    process.exit(0);
  }).catch(e => { console.error(e.message); process.exit(1); });
"

# 7. CONSCIOUSNESS_ENABLED=false 时返回 false（不启动）
check "CONSCIOUSNESS_ENABLED=false 时不启动循环" \
  bash -c 'CONSCIOUSNESS_ENABLED=false node -e "
    import(\"./packages/brain/src/consciousness-loop.js\").then(m => {
      const r = m.startConsciousnessLoop();
      if (r !== false) { console.error(\"expected false, got\", r); process.exit(1); }
      process.exit(0);
    }).catch(e => { console.error(e.message); process.exit(1); });
  " 2>/dev/null'

echo ""
echo "── Wave 2 smoke: tick-loop.js 集成 ──"

# 8. tick-loop.js 语法正确
check "tick-loop.js 语法正确" node --check packages/brain/src/tick-loop.js

# 9. tick-loop.js 含 runScheduler import
check "tick-loop.js import runScheduler" node -e "
  const { readFileSync } = require('fs');
  const src = readFileSync('packages/brain/src/tick-loop.js', 'utf8');
  if (!src.includes('runScheduler')) { console.error('No runScheduler import'); process.exit(1); }
  if (!src.includes('startConsciousnessLoop')) { console.error('No startConsciousnessLoop'); process.exit(1); }
  process.exit(0);
"

echo ""
echo "📊 Smoke 结果 — 通过: $PASS, 失败: $FAIL"
[ "$FAIL" -eq 0 ]
