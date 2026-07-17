#!/usr/bin/env bash
# admission-report-smoke.sh
#
# Smoke：作战日报 Harness admission 吞吐段（de6d3582，beeba317 观察哨）
#
# 验证清单：
#   1. battle-report.js 导出 ADMISSION_DENY_REASONS（10 项白名单，含 cap_reached / task_cap_backstop）
#   2. renderBattleReportMarkdown 对含 admission 数据的输入渲染出段标题与拒发分布
#   3. admission 全空时段内渲染"暂无"（降级路径）
#
# 纯 Node 断言，不碰 docker/DB — CI 干净环境可跑。
#
# 退出码：0=PASS，非 0=FAIL
set -euo pipefail

SMOKE_NAME="admission-report"
log()  { echo "[smoke:$SMOKE_NAME] $*"; }
fail() { log "FAIL $*"; exit 1; }

cd "$(git rev-parse --show-toplevel)"

# ── 1. ADMISSION_DENY_REASONS 白名单 ────────────────────────────────────
log "1. 验证 battle-report.js 导出 ADMISSION_DENY_REASONS 白名单"
node -e "
const mod = await import('./packages/brain/src/battle-report.js');
const r = mod.ADMISSION_DENY_REASONS;
if (!Array.isArray(r) || r.length !== 10) {
  console.error('FAIL: ADMISSION_DENY_REASONS 期望 10 项数组，实际:', JSON.stringify(r));
  process.exit(1);
}
for (const must of ['cap_reached', 'task_cap_backstop', 'vitals_stale']) {
  if (!r.includes(must)) { console.error('FAIL: 白名单缺', must); process.exit(1); }
}
console.log('ADMISSION_DENY_REASONS 10 项白名单 ✓');
" --input-type=module || fail "白名单校验失败"

# ── 2. 有数据渲染段落 ────────────────────────────────────────────────────
log "2. 验证 renderBattleReportMarkdown 渲染 admission 段"
node -e "
const mod = await import('./packages/brain/src/battle-report.js');
const md = mod.renderBattleReportMarkdown({
  mergedPrs: [], journeyRuns: [], userDecisions: [], goldenPathMode: null,
  unconfirmedActions: [], sentinels: [],
  admission: { dispatched_24h: 12, denies: [{ reason: 'cap_reached', count: 3 }], peak: { date: '2026-07-17', peak: 4 }, vitals: null },
});
if (!md.includes('Harness admission 吞吐')) { console.error('FAIL: 缺段标题'); process.exit(1); }
if (!md.includes('派发 12 次')) { console.error('FAIL: 缺派发计数'); process.exit(1); }
if (!md.includes('cap_reached: 3')) { console.error('FAIL: 缺拒发分布'); process.exit(1); }
if (!md.includes('容器峰值 4')) { console.error('FAIL: 缺峰值'); process.exit(1); }
console.log('admission 段渲染 ✓');
" --input-type=module || fail "有数据渲染校验失败"

# ── 3. 全空降级"暂无" ────────────────────────────────────────────────────
log "3. 验证 admission 全空渲染 暂无"
node -e "
const mod = await import('./packages/brain/src/battle-report.js');
const md = mod.renderBattleReportMarkdown({
  mergedPrs: [], journeyRuns: [], userDecisions: [], goldenPathMode: null,
  unconfirmedActions: [], sentinels: [],
  admission: { dispatched_24h: 0, denies: [], peak: null, vitals: null },
});
const seg = md.split('Harness admission 吞吐')[1] || '';
if (!seg.includes('暂无')) { console.error('FAIL: 全空未渲染 暂无'); process.exit(1); }
console.log('全空降级 暂无 ✓');
" --input-type=module || fail "全空降级校验失败"

log "全部检查通过 ✓"
