#!/usr/bin/env bash
# Smoke: protocol-hygiene — 协议卫生包三件套（作战清单 T2，PR #3686）
# 验证：
#   1. retry-policy.js SSOT 结构正确（四类 backoff + isTransientClass + retry-circuit 豁免）
#   2. quarantine.js 已拆 TIMEOUT/SERVER_ERROR 且 getRetryStrategy 返回结构不变
#   3. migration 326 side_effect_dedupe 表 + dedupe.js fail-open
#   4. alert-debounce opt-in 接入 raise()
#   5. 入口接线存在（createTask / notifier）；executor spawn 入口随 Claude 通道退役（决策 067867c8），改证明退役
#   6. dispatcher 对 spawn_deduplicated 不计熔断
set -euo pipefail

echo "[protocol-hygiene-smoke] 1. retry-policy.js SSOT 结构"
node -e "
const fs = require('fs');
const src = fs.readFileSync('packages/brain/src/lib/retry-policy.js', 'utf8');
const checks = [
  ['rate_limit:', 'rate_limit 策略'],
  ['network:', 'network 策略'],
  ['timeout:', 'timeout 独立策略'],
  ['server_error:', 'server_error 独立策略'],
  ['isTransientClass', 'isTransientClass 集中判定'],
  ['retry-circuit', 'retry-circuit 豁免注释'],
];
const missing = checks.filter(([p]) => !src.includes(p));
if (missing.length > 0) { console.error('FAIL: retry-policy.js 缺少:'); missing.forEach(([,d]) => console.error('  - ' + d)); process.exit(1); }
console.log('retry-policy.js 结构正确 ✓');
"

echo "[protocol-hygiene-smoke] 2. quarantine.js 拆类 + 返回结构"
node -e "
const fs = require('fs');
const src = fs.readFileSync('packages/brain/src/quarantine.js', 'utf8');
const checks = [
  [\"TIMEOUT: 'timeout'\", 'FAILURE_CLASS.TIMEOUT'],
  [\"SERVER_ERROR: 'server_error'\", 'FAILURE_CLASS.SERVER_ERROR'],
  ['SERVER_ERROR_PATTERNS', '5xx 独立 pattern 组'],
  ['TIMEOUT_PATTERNS', 'timeout 独立 pattern 组'],
  ['getBackoffMs', 'getRetryStrategy 查表化'],
  ['should_retry', '返回字段 should_retry'],
  ['next_run_at', '返回字段 next_run_at'],
];
const missing = checks.filter(([p]) => !src.includes(p));
if (missing.length > 0) { console.error('FAIL: quarantine.js 缺少:'); missing.forEach(([,d]) => console.error('  - ' + d)); process.exit(1); }
console.log('quarantine.js 拆类正确 ✓');
"

echo "[protocol-hygiene-smoke] 3. migration 326 + dedupe.js fail-open"
node -e "
const fs = require('fs');
const mig = fs.readFileSync('packages/brain/migrations/326_side_effect_dedupe.sql', 'utf8');
if (!mig.includes('UNIQUE (kind, dedupe_key)')) { console.error('FAIL: migration 326 缺 UNIQUE(kind, dedupe_key)'); process.exit(1); }
const src = fs.readFileSync('packages/brain/src/lib/dedupe.js', 'utf8');
const checks = [
  ['ON CONFLICT (kind, dedupe_key)', '原子抢占 SQL'],
  ['expires_at < NOW()', '过期重占条件'],
  ['degraded: true', 'fail-open 降级返回'],
  ['dedupe_degraded', 'P2 降级告警'],
  ['releaseDedupeKey', '失败释放函数'],
];
const missing = checks.filter(([p]) => !src.includes(p));
if (missing.length > 0) { console.error('FAIL: dedupe.js 缺少:'); missing.forEach(([,d]) => console.error('  - ' + d)); process.exit(1); }
console.log('migration 326 + dedupe.js 正确 ✓');
"

echo "[protocol-hygiene-smoke] 4. alert-debounce opt-in 接入 raise()"
node -e "
const fs = require('fs');
const ad = fs.readFileSync('packages/brain/src/lib/alert-debounce.js', 'utf8');
if (!ad.includes('shouldFire') || !ad.includes('resetDebounce')) { console.error('FAIL: alert-debounce 缺核心导出'); process.exit(1); }
const al = fs.readFileSync('packages/brain/src/alerting.js', 'utf8');
if (!al.includes('opts.debounce')) { console.error('FAIL: raise() 未接 debounce opt-in'); process.exit(1); }
console.log('alert-debounce opt-in 正确 ✓');
"

echo "[protocol-hygiene-smoke] 5. 入口接线（createTask / notifier）+ executor claude 入口退役"
node -e "
const fs = require('fs');
const actions = fs.readFileSync('packages/brain/src/actions.js', 'utf8');
if (!actions.includes('dedupe_key_hit')) { console.error('FAIL: createTask 未接 dedupe_key'); process.exit(1); }
// executor 的 spawn dedupe 只挂在 US → cecelia-bridge（claude -p / claude 容器）派发段上，
// 防的是同一任务被 tick 重入双拉起 claude。Claude 无头通道已退役（任务 76a160b3，决策 067867c8），
// 该段不再 spawn 任何进程，dedupe 随之消失、无等价实现；改为证明该入口已退役：
// triggerCeceliaRun 落到 claude 段时返回 claude_channel_retired，且不再 fetch /trigger-cecelia。
const executor = fs.readFileSync('packages/brain/src/executor.js', 'utf8');
const segStart = executor.indexOf('// 3. US → Claude Code');
if (segStart < 0) { console.error('FAIL: executor 找不到 US → Claude Code 段'); process.exit(1); }
const seg = executor.slice(segStart, executor.indexOf('\n}\n', segStart));
if (!seg.includes('reason: CLAUDE_CHANNEL_RETIRED_CODE')) { console.error('FAIL: executor claude 段未返回 claude_channel_retired'); process.exit(1); }
if (/\bfetch\(|\bspawn\(|claimDedupeKey/.test(seg)) { console.error('FAIL: executor claude 段仍在拉起/派发（fetch/spawn/dedupe 残留）'); process.exit(1); }
if (executor.includes('/trigger-cecelia\`')) { console.error('FAIL: executor 仍 fetch cecelia-bridge /trigger-cecelia'); process.exit(1); }
const notifier = fs.readFileSync('packages/brain/src/notifier.js', 'utf8');
if (!notifier.includes('dedupeKey')) { console.error('FAIL: notifier 未接 dedupeKey'); process.exit(1); }
console.log('入口接线正确（executor spawn 入口已退役）✓');
"

echo "[protocol-hygiene-smoke] 6. dispatcher spawn_deduplicated 不计熔断"
node -e "
const fs = require('fs');
const src = fs.readFileSync('packages/brain/src/dispatcher.js', 'utf8');
if (!src.includes('spawn_deduplicated')) { console.error('FAIL: dispatcher 未对 spawn_deduplicated 做熔断豁免'); process.exit(1); }
console.log('dispatcher 熔断豁免正确 ✓');
"

echo "[protocol-hygiene-smoke] ✅ 全部通过"
