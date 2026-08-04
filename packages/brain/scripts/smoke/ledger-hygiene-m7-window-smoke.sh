#!/usr/bin/env bash
# Smoke: ledger-hygiene-m7-window — m7 探针口径修正 + 自主循环产出登记覆盖（task 78e812c0）
# 验证（source inspection，CI 无 DB 可跑；行为级由回归测试
# src/__tests__/integration/ledger-hygiene-m7-beijing-window.integration.test.ts 等守护）：
#   1. m7 统计窗为上一完整北京日（Asia/Shanghai）且排除探针自产 atoms（lane）
#   2. raiseBreachAlerts 自产 atom 带 lane='ledger-hygiene'，debt 持平文案不写"上升"
#   3. capture-inbox.js 签名恢复：atom INSERT 含 routed_to_table/routed_to_id/lane，无丢弃形态
#   4. auto-learning VALUABLE_TASK_TYPES 含 harness_initiative
#   5. handoff.js 导出 pushHandoffAtom 且 routes/tasks.js PATCH 已接线
set -euo pipefail

echo "[ledger-hygiene-m7-window-smoke] 1. m7 北京日窗口 + 自产排除"
node -e "
const fs = require('fs');
const src = fs.readFileSync('packages/brain/src/ledger-hygiene.js', 'utf8');
const checks = [
  [\"AT TIME ZONE 'Asia/Shanghai'\", 'strategist 子项统计窗按 Asia/Shanghai 北京日推导'],
  ['getM7CaptureWindow', 'capture 子项参数化北京昨日自然日窗口（#4597 骨架）'],
  ['LEDGER_SELF_ATOM_PREFIX', 'm7 排除探针自产 atoms（content 前缀分类）'],
];
const missing = checks.filter(([p]) => !src.includes(p));
if (missing.length > 0) {
  missing.forEach(([, d]) => console.error('FAIL: ledger-hygiene.js 缺少 ' + d));
  process.exit(1);
}
if (/capture_atoms[\s\S]{0,200}INTERVAL '24 hours'/.test(src)) {
  console.error('FAIL: m7 capture 子项仍用 NOW()-24h 滑窗');
  process.exit(1);
}
console.log('m7 窗口/排除口径正确 ✓');
"

echo "[ledger-hygiene-m7-window-smoke] 2. 自产打标 + 持平文案"
node -e "
const fs = require('fs');
const src = fs.readFileSync('packages/brain/src/ledger-hygiene.js', 'utf8');
if (!src.includes(\"lane: 'ledger-hygiene'\")) {
  console.error('FAIL: raiseBreachAlerts 自产 atom 未带 lane 标识');
  process.exit(1);
}
if (!src.includes('欠账持平')) {
  console.error('FAIL: debt 持平文案分支缺失');
  process.exit(1);
}
console.log('自产打标 + 持平文案正确 ✓');
"

echo "[ledger-hygiene-m7-window-smoke] 3. capture-inbox 签名恢复"
node -e "
const fs = require('fs');
const src = fs.readFileSync('packages/brain/src/capture-inbox.js', 'utf8');
if (src.includes('_routedToTable') || src.includes('_routedToId')) {
  console.error('FAIL: 丢弃形态签名 _routedToTable/_routedToId 仍在');
  process.exit(1);
}
const m = src.match(/INSERT INTO capture_atoms[\s\S]*?RETURNING id/);
if (!m || !/routed_to_table/.test(m[0]) || !/routed_to_id/.test(m[0]) || !/lane/.test(m[0])) {
  console.error('FAIL: atom INSERT 未含 routed_to_table/routed_to_id/lane 溯源列');
  process.exit(1);
}
console.log('capture-inbox 溯源列落库 ✓');
"

echo "[ledger-hygiene-m7-window-smoke] 4. auto-learning 覆盖 harness_initiative"
node -e "
const fs = require('fs');
const src = fs.readFileSync('packages/brain/src/auto-learning.js', 'utf8');
const m = src.match(/VALUABLE_TASK_TYPES\s*=\s*\[[^\]]*\]/);
if (!m || !m[0].includes('harness_initiative')) {
  console.error('FAIL: VALUABLE_TASK_TYPES 未含 harness_initiative');
  process.exit(1);
}
if (m[0].includes('code_review')) {
  console.error('FAIL: VALUABLE_TASK_TYPES 不应纳入 code_review');
  process.exit(1);
}
console.log('VALUABLE_TASK_TYPES 覆盖正确 ✓');
"

echo "[ledger-hygiene-m7-window-smoke] 5. pushHandoffAtom 导出 + PATCH 接线"
node -e "
const fs = require('fs');
const h = fs.readFileSync('packages/brain/src/handoff.js', 'utf8');
if (!/export\s+(async\s+)?function\s+pushHandoffAtom/.test(h)) {
  console.error('FAIL: handoff.js 未导出 pushHandoffAtom');
  process.exit(1);
}
const t = fs.readFileSync('packages/brain/src/routes/tasks.js', 'utf8');
if (!t.includes('pushHandoffAtom')) {
  console.error('FAIL: routes/tasks.js PATCH 未接线 pushHandoffAtom');
  process.exit(1);
}
console.log('pushHandoffAtom 导出与接线正确 ✓');
"

echo "[ledger-hygiene-m7-window-smoke] ALL PASS"
