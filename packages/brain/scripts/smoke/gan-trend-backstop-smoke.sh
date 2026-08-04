#!/usr/bin/env bash
# 案卷式 GAN 趋势兜底（PR-B）结构 smoke：
# 守住四个接线点——纯函数导出 / deriveGan 趋势闸与护栏 / loop 消费与持久化事件 / action 登记。
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/../.."

echo "[gan-trend-backstop-smoke] 1. rubric-trend 纯函数导出"
node -e "
const s = require('fs').readFileSync('src/orchestrator/rubric-trend.js','utf8');
if (!/export function detectRubricTrend/.test(s)) process.exit(1);
"
echo "detectRubricTrend 导出 ✓"

echo "[gan-trend-backstop-smoke] 2. deriveGan 趋势闸 + 双护栏"
node -e "
const s = require('fs').readFileSync('src/orchestrator/derive.js','utf8');
if (!s.includes('detectRubricTrend')) process.exit(1);
if (!s.includes('validation_identity_policy')) { console.error('缺 identity 让路护栏'); process.exit(1); }
if (!/FORCE_APPROVE_CONTRACT/.test(s)) process.exit(1);
"
echo "趋势闸与护栏在位 ✓"

echo "[gan-trend-backstop-smoke] 3. loop 消费 force action + 持久化事件"
node -e "
const s = require('fs').readFileSync('src/orchestrator/loop.js','utf8');
if (!/FORCE_APPROVE_CONTRACT/.test(s)) process.exit(1);
if (!s.includes('gan_forced_approval')) { console.error('缺 cecelia_events 持久化事件'); process.exit(1); }
"
echo "loop 消费与事件在位 ✓"

echo "[gan-trend-backstop-smoke] 4. ACTION 常量登记"
node -e "
const s = require('fs').readFileSync('src/orchestrator/constants.js','utf8');
if (!/FORCE_APPROVE_CONTRACT/.test(s)) process.exit(1);
"
echo "action 登记 ✓"

echo "[gan-trend-backstop-smoke] 全部检查通过 ✓"
