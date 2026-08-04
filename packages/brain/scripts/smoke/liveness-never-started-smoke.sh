#!/usr/bin/env bash
# Smoke: liveness-never-started — watchdog liveness「从未启动」误判 liveness_dead 修复（1dfa40f7 防复发）
# Sprint: 08041147-relay-2c1a4771（合同分支 cp-08041244-harness-propose-r3-2c1a4771）
# 验证：
#   1. dev-failure-classifier 真实分类：never_started 失败文本不落 transient 环境重试假通道
#   2. executor.js never_started 分类链结构在位（isNeverStarted 三信号判定 + process_disappeared 收窄 + learning 真根因）
#   3. 毕业回归测试已落位且已登记 POSTGRES_INTEGRATION_TESTS（永久入 CI）
set -euo pipefail

echo "[liveness-never-started-smoke] 1. classifier 真实分类：never_started 不落 transient"
node -e "
import('./packages/brain/src/dev-failure-classifier.js').then((m) => {
  const r = m.classifyDevFailure({
    error: '[watchdog] liveness_probe_failed reason=never_started 进程从未启动（S2锚点执法拒绝点火）',
  });
  if (r.class === 'transient') {
    console.error('FAIL: never_started 文本仍被 [watchdog] 宽松规则误判 transient');
    process.exit(1);
  }
  if (r.retryable !== false) {
    console.error('FAIL: never_started 不应走环境重试通道（retryable=' + r.retryable + '）');
    process.exit(1);
  }
  console.log('classifier class=' + r.class + ' retryable=' + r.retryable + ' ✓');
});
"

echo "[liveness-never-started-smoke] 2. executor.js never_started 分类链结构在位"
node -e "
const fs = require('fs');
const src = fs.readFileSync('packages/brain/src/executor.js', 'utf8');
const checks = [
  ['function isNeverStarted(task, entry)', 'isNeverStarted 三信号判定函数'],
  [\"reason === 'process_disappeared' && isNeverStarted(task, entry)\", 'process_disappeared 兜底收窄分支'],
  [\"reason = 'never_started'\", 'never_started 分类赋值'],
  ['const rootCause = evidence?.reason || reason', 'failure learning 真根因取值（非通道参数）'],
  ['error_message', 'probeTaskLiveness 查询含 error_message 信号列'],
];
const missing = checks.filter(([p]) => !src.includes(p));
if (missing.length > 0) {
  console.error('FAIL: executor.js 缺少:');
  missing.forEach(([, d]) => console.error('  - ' + d));
  process.exit(1);
}
console.log('executor.js 分类链结构正确 ✓');
"

echo "[liveness-never-started-smoke] 3. 毕业回归测试落位 + POSTGRES_INTEGRATION_TESTS 登记"
node -e "
const fs = require('fs');
const t = 'packages/brain/src/__tests__/integration/liveness-never-started.integration.test.js';
if (!fs.existsSync(t)) {
  console.error('FAIL: 毕业回归测试不存在: ' + t);
  process.exit(1);
}
const c = fs.readFileSync(t, 'utf8');
if (!c.includes('never_started') || !c.includes('process_disappeared') || c.includes('vi.mock(')) {
  console.error('FAIL: 毕业测试内容不符（缺断言或含 vi.mock）');
  process.exit(1);
}
const cfg = fs.readFileSync('packages/brain/vitest.config.js', 'utf8');
if (!cfg.includes('liveness-never-started.integration.test.js')) {
  console.error('FAIL: 未登记 POSTGRES_INTEGRATION_TESTS');
  process.exit(1);
}
console.log('毕业测试落位且已登记 ✓');
"

echo "[liveness-never-started-smoke] PASS"
