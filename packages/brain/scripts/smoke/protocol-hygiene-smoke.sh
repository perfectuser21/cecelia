#!/usr/bin/env bash
# Smoke: protocol-hygiene — 协议卫生包三件套（作战清单 T2，PR #3686）
# 验证：
#   1. retry-policy.js SSOT 结构正确（四类 backoff + isTransientClass + retry-circuit 豁免）
#   2. quarantine.js 已拆 TIMEOUT/SERVER_ERROR 且 getRetryStrategy 返回结构不变
#   3. migration 326 side_effect_dedupe 表 + dedupe.js fail-open
#   4. alert-debounce opt-in 接入 raise()
#   5. 三入口接线存在（createTask / executor spawn / notifier）
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

echo "[protocol-hygiene-smoke] 5. 三入口接线"
node -e "
const fs = require('fs');
const actions = fs.readFileSync('packages/brain/src/actions.js', 'utf8');
if (!actions.includes('dedupe_key_hit')) { console.error('FAIL: createTask 未接 dedupe_key'); process.exit(1); }
const executor = fs.readFileSync('packages/brain/src/executor.js', 'utf8');
if (!executor.includes(\"claimDedupeKey('spawn'\") || !executor.includes('spawn_deduplicated')) { console.error('FAIL: executor 未接 spawn dedupe'); process.exit(1); }
const notifier = fs.readFileSync('packages/brain/src/notifier.js', 'utf8');
if (!notifier.includes('dedupeKey')) { console.error('FAIL: notifier 未接 dedupeKey'); process.exit(1); }
console.log('三入口接线正确 ✓');
"

echo "[protocol-hygiene-smoke] 6. dispatcher spawn_deduplicated 不计熔断"
node -e "
const fs = require('fs');
const src = fs.readFileSync('packages/brain/src/dispatcher.js', 'utf8');
if (!src.includes('spawn_deduplicated')) { console.error('FAIL: dispatcher 未对 spawn_deduplicated 做熔断豁免'); process.exit(1); }
console.log('dispatcher 熔断豁免正确 ✓');
"

echo "[protocol-hygiene-smoke] ✅ 全部通过"
