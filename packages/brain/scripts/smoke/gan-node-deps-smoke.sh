#!/usr/bin/env bash
# 案卷式 GAN PR-C（角色工作区依赖安装）结构 smoke：
# 守住四个接线点——bundle 默认开 / provision 剥离防线 / npm ci 沙箱与缓存参数 / 超时预算。
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/../.."

echo "[gan-node-deps-smoke] 1. dispatcher 对 proposer/reviewer 默认开 node_deps"
node -e "
const s = require('fs').readFileSync('src/orchestrator/dispatcher.js','utf8');
if (!s.includes('node_deps')) process.exit(1);
"
echo "dispatcher 接线 ✓"

echo "[gan-node-deps-smoke] 2. provision 剥离防线（node_deps 不得进 resourceManager）"
node -e "
const s = require('fs').readFileSync('scripts/fleet-worker/attempt-runner.cjs','utf8');
if (!s.includes('node_deps')) process.exit(1);
"
echo "attempt-runner 分流在位 ✓"

echo "[gan-node-deps-smoke] 3. npm ci 带 --ignore-scripts（沙箱防线）+ 缓存目录"
node -e "
const s = require('fs').readFileSync('scripts/fleet-worker/workspace-manager.cjs','utf8');
if (!s.includes('--ignore-scripts')) { console.error('缺 --ignore-scripts 沙箱防线'); process.exit(1); }
if (!s.includes('npm_config_cache')) { console.error('缺 npm_config_cache'); process.exit(1); }
"
echo "npm ci 参数防线 ✓"

echo "[gan-node-deps-smoke] 4. 超时预算存在"
node -e "
const s = require('fs').readFileSync('scripts/fleet-worker/workspace-manager.cjs','utf8');
if (!/timeout/i.test(s)) process.exit(1);
"
echo "超时预算在位 ✓"

echo "[gan-node-deps-smoke] 全部检查通过 ✓"
