#!/usr/bin/env bash
# Smoke: rpa-dev-verify — RPA 开发快验通道 Brain 侧端点（T1）
# 验证：
#   1. routes/rpa-dev-verify.js 存在且含白名单/超时上限/AbortSignal 关键结构
#   2. server.js 已挂载 /api/brain/rpa 路由
#   3. 白名单不含任意命令执行动作（shell/exec/eval/run_script 红线）
set -euo pipefail

echo "[rpa-dev-verify-smoke] 1. 路由文件结构正确"
node -e "
const fs = require('fs');
const src = fs.readFileSync('packages/brain/src/routes/rpa-dev-verify.js', 'utf8');
const checks = [
  ['ACTION_WHITELIST', '按 line 隔离的动作白名单'],
  ['MAX_TIMEOUT_MS', '超时上限（60s 强制截断）'],
  ['AbortSignal.timeout', '代理请求超时中断'],
  ['action_not_allowed', '白名单拒绝错误码'],
  ['agent_unreachable', 'Agent 不可达错误码'],
  ['RPA_DEV_VERIFY_ENABLED', '生产关闭开关'],
];
const missing = checks.filter(([p]) => !src.includes(p));
if (missing.length > 0) {
  console.error('FAIL: rpa-dev-verify.js 缺少:');
  missing.forEach(([,d]) => console.error('  - ' + d));
  process.exit(1);
}
console.log('rpa-dev-verify.js 结构正确 ✓');
"

echo "[rpa-dev-verify-smoke] 2. server.js 已挂载 /api/brain/rpa"
node -e "
const fs = require('fs');
const src = fs.readFileSync('packages/brain/server.js', 'utf8');
if (!src.includes(\"app.use('/api/brain/rpa', rpaDevVerifyRouter)\")) {
  console.error('FAIL: server.js 未挂载 rpaDevVerifyRouter（路由是死代码）');
  process.exit(1);
}
console.log('server.js 挂载正确 ✓');
"

echo "[rpa-dev-verify-smoke] 3. 白名单无任意命令执行动作"
node -e "
const fs = require('fs');
const src = fs.readFileSync('packages/brain/src/routes/rpa-dev-verify.js', 'utf8');
const wl = src.match(/ACTION_WHITELIST = \{[\s\S]*?\};/);
if (!wl) { console.error('FAIL: 找不到 ACTION_WHITELIST 定义'); process.exit(1); }
for (const bad of [\"'shell'\", \"'exec'\", \"'eval'\", \"'run_script'\"]) {
  if (wl[0].includes(bad)) { console.error('FAIL: 白名单含禁止动作 ' + bad); process.exit(1); }
}
console.log('白名单红线干净 ✓');
"

echo "[rpa-dev-verify-smoke] ALL PASS"
