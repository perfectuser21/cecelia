#!/usr/bin/env bash
# slot-admission-smoke.sh
#
# Smoke：harness 派发判定换轨 slot-allocator 动态 cap（beeba317 T4-T6 + 终审 Fix 1/3）
#
# 验证清单：
#   1. slot-allocator.js 导出 harnessSlotCheck 且是函数（动态 cap 判定入口）
#   2. machine-vitals.js 导出 sampleMachineVitals / getMachineVitals
#   3. getMachineVitals() 冷态（未采样）返回 error:'never_sampled' 语义
#   4. dispatcher.js 含 HARNESS_TASK_CAP_BACKSTOP 兜底常量，且旧的
#      MAX_CONCURRENT_HARNESS_INITIATIVES 静态硬编码已删除（换轨完成）
#
# 纯 Node 断言，不碰 docker/DB — CI 干净环境可跑。
#
# 退出码：0=PASS，非 0=FAIL
set -euo pipefail

SMOKE_NAME="slot-admission"
log()  { echo "[smoke:$SMOKE_NAME] $*"; }
fail() { log "FAIL $*"; exit 1; }

cd "$(git rev-parse --show-toplevel)"

# ── 1. harnessSlotCheck 已导出且是函数 ──────────────────────────────────
log "1. 验证 slot-allocator.js 导出 harnessSlotCheck（函数）"
node -e "
const mod = await import('./packages/brain/src/slot-allocator.js');
if (typeof mod.harnessSlotCheck !== 'function') {
  console.error('FAIL: harnessSlotCheck 未导出或不是函数');
  process.exit(1);
}
console.log('harnessSlotCheck 已导出且是函数 ✓');
" --input-type=module || fail "harnessSlotCheck 导出校验失败"

# ── 2. machine-vitals 导出 sampleMachineVitals / getMachineVitals ───────
log "2. 验证 machine-vitals.js 导出 sampleMachineVitals / getMachineVitals"
node -e "
const mod = await import('./packages/brain/src/machine-vitals.js');
if (typeof mod.sampleMachineVitals !== 'function') {
  console.error('FAIL: sampleMachineVitals 未导出或不是函数');
  process.exit(1);
}
if (typeof mod.getMachineVitals !== 'function') {
  console.error('FAIL: getMachineVitals 未导出或不是函数');
  process.exit(1);
}
console.log('sampleMachineVitals / getMachineVitals 均已导出 ✓');
" --input-type=module || fail "machine-vitals 导出校验失败"

# ── 3. getMachineVitals() 冷态语义（未采样 → never_sampled）──────────────
log "3. 验证 getMachineVitals() 冷态（未采样）返回 never_sampled 语义"
node -e "
const mod = await import('./packages/brain/src/machine-vitals.js');
const v = mod.getMachineVitals();
if (v.error !== 'never_sampled') {
  console.error('FAIL: 冷态 getMachineVitals() 期望 error=never_sampled，实际:', JSON.stringify(v));
  process.exit(1);
}
if (v.stale !== true) {
  console.error('FAIL: 冷态 getMachineVitals() 期望 stale=true，实际:', v.stale);
  process.exit(1);
}
console.log('冷态 getMachineVitals() 语义正确（never_sampled + stale=true）✓');
" --input-type=module || fail "getMachineVitals 冷态语义校验失败"

# ── 4. dispatcher.js 换轨完成：HARNESS_TASK_CAP_BACKSTOP 存在 + 旧常量已删 ──
log "4. 验证 dispatcher.js 换轨：HARNESS_TASK_CAP_BACKSTOP 存在 / MAX_CONCURRENT_HARNESS_INITIATIVES 已删"
grep -q "HARNESS_TASK_CAP_BACKSTOP" packages/brain/src/dispatcher.js \
  || fail "dispatcher.js 缺少 HARNESS_TASK_CAP_BACKSTOP 兜底常量"
if grep -q "MAX_CONCURRENT_HARNESS_INITIATIVES" packages/brain/src/dispatcher.js; then
  fail "dispatcher.js 仍残留 MAX_CONCURRENT_HARNESS_INITIATIVES（应已换轨到 slot-allocator 动态 cap）"
fi
log "dispatcher.js 换轨校验通过 ✓"

log "全部检查通过 ✓"
exit 0
