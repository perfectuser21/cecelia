#!/usr/bin/env bash
# Smoke: line-strategist-dispatch — task 落终态后按 line 派发 strategist_decision
# 验证：
#   1. line-strategist-dispatch.js 存在且含核心导出 + 关键 SQL 结构（含自排除防死循环）
#   2. line-strategist-loop.js 存在且含 start/stop 导出
#   3. tick-loop.js 已接入 startLineStrategistLoop / stopLineStrategistLoop（真正生效的 live 路径）
#   4. task-router.js 四张表均已注册 strategist_decision
set -euo pipefail

echo "[line-strategist-dispatch-smoke] 1. line-strategist-dispatch.js 结构正确"
node -e "
const fs = require('fs');
const src = fs.readFileSync('packages/brain/src/line-strategist-dispatch.js', 'utf8');
const checks = [
  ['export async function dispatchStrategistDecisions', 'dispatchStrategistDecisions 导出'],
  [\"status IN ('completed', 'failed')\", '扫描终态任务'],
  [\"task_type <> 'strategist_decision'\", '排除自身 task_type，防止死循环'],
  [\"payload->>'journey_id'\", '按 journey_id（line）分组'],
  ['strategist_dispatched', '已处理标记去重'],
  [\"'brain_auto'\", 'trigger_source 系统自产白名单'],
];
const missing = checks.filter(([p]) => !src.includes(p));
if (missing.length > 0) {
  console.error('FAIL: line-strategist-dispatch.js 缺少:');
  missing.forEach(([,desc]) => console.error('  - ' + desc));
  process.exit(1);
}
console.log('line-strategist-dispatch.js 结构正确 ✓');
"

echo "[line-strategist-dispatch-smoke] 2. line-strategist-loop.js 存在且含 start/stop 导出"
node -e "
const fs = require('fs');
const src = fs.readFileSync('packages/brain/src/line-strategist-loop.js', 'utf8');
const checks = [
  ['export function startLineStrategistLoop', 'startLineStrategistLoop 导出'],
  ['export function stopLineStrategistLoop', 'stopLineStrategistLoop 导出'],
  ['export async function runLineStrategistDispatchOnce', 'runLineStrategistDispatchOnce 导出'],
  ['dispatchStrategistDecisions', '消费 line-strategist-dispatch.js 核心逻辑'],
];
const missing = checks.filter(([p]) => !src.includes(p));
if (missing.length > 0) {
  console.error('FAIL: line-strategist-loop.js 缺少:');
  missing.forEach(([,desc]) => console.error('  - ' + desc));
  process.exit(1);
}
console.log('line-strategist-loop.js 结构正确 ✓');
"

echo "[line-strategist-dispatch-smoke] 3. tick-loop.js 已接入独立 loop（真正生效路径，非废弃 executeTick）"
node -e "
const fs = require('fs');
const src = fs.readFileSync('packages/brain/src/tick-loop.js', 'utf8');
const checks = [
  ['startLineStrategistLoop', 'startTickLoop 内启动 line-strategist 独立循环'],
  ['stopLineStrategistLoop', 'stopTickLoop 内停止 line-strategist 独立循环'],
];
const missing = checks.filter(([p]) => !src.includes(p));
if (missing.length > 0) {
  console.error('FAIL: tick-loop.js 缺少:');
  missing.forEach(([,desc]) => console.error('  - ' + desc));
  process.exit(1);
}
console.log('tick-loop.js 已接入 line-strategist 独立循环 ✓');
"

echo "[line-strategist-dispatch-smoke] 4. task-router.js 四张表均已注册 strategist_decision"
node -e "
const fs = require('fs');
const src = fs.readFileSync('packages/brain/src/task-router.js', 'utf8');
const checks = [
  [\"'strategist_decision',\", 'VALID_TASK_TYPES 含 strategist_decision'],
  [\"'strategist_decision': '/line-strategist',\", 'SKILL_WHITELIST 路由到 /line-strategist'],
  [\"'strategist_decision': 'us',\", 'LOCATION_MAP 定位 us'],
  [\"'strategist_decision':['has_git'],\", 'TASK_REQUIREMENTS 要求 has_git'],
];
const missing = checks.filter(([p]) => !src.includes(p));
if (missing.length > 0) {
  console.error('FAIL: task-router.js 缺少:');
  missing.forEach(([,desc]) => console.error('  - ' + desc));
  process.exit(1);
}
console.log('task-router.js 四张表注册完整 ✓')
"

echo "[line-strategist-dispatch-smoke] 全部检查通过 ✓"
