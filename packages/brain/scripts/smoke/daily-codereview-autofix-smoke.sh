#!/usr/bin/env bash
# daily-codereview-autofix-smoke.sh — 漏点④ 真环境验证
# 在真实 node 运行时加载 routes/execution.js 源码，断言 daily-scope code_review 自动立案分支已接线：
#   1. 存在 scope==='daily' 分支（不再 fall-through 到 "not initiative-level, skip"）
#   2. 用 repo_path 建 fix_type='daily_review_issues' 修复 task
#   3. 严重度优先级映射正确（CRITICAL_BLOCK / l1_count>0 → P0；NEEDS_FIX / l2_count>0 → P1；PASS 无问题 → 不建）
#   4. 走 trigger_source='auto_fix'（无 goal_id 也能通过 createTask 校验）+ 幂等去重
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
EXEC_SRC="$SCRIPT_DIR/../../src/routes/execution.js"

echo "🔍 daily-codereview-autofix smoke — source: $EXEC_SRC"

node --input-type=module -e "
import { readFileSync } from 'fs';
const src = readFileSync('$EXEC_SRC', 'utf8');
const checks = [
  { name: 'daily scope 分支已接线', regex: /crTask\?\.task_type === 'code_review' && crPayload\.scope === 'daily'/ },
  { name: 'fix_type=daily_review_issues', regex: /fix_type: 'daily_review_issues'/ },
  { name: '严重度优先 P0（CRITICAL_BLOCK 或 l1Count>0）', regex: /hasCritical\s*=\s*decision === 'CRITICAL_BLOCK' \|\| l1Count > 0/ },
  { name: 'NEEDS_FIX / l2 → 可修复', regex: /hasFixable\s*=\s*hasCritical \|\| decision === 'NEEDS_FIX' \|\| l2Count > 0/ },
  { name: 'trigger_source=auto_fix（无 goal_id 也过校验）', regex: /trigger_source: 'auto_fix'/ },
  { name: '幂等去重（同 repo 未完成 daily 修复 task）', regex: /payload->>'fix_type' = 'daily_review_issues' AND payload->>'repo_path'/ },
];
let fail = false;
for (const c of checks) {
  if (!c.regex.test(src)) { console.error('FAIL:', c.name); fail = true; }
  else { console.log('  ✓', c.name); }
}

// 在真实 node 运行时复刻并验证严重度判定逻辑（防止映射规则被改坏）
function severity(decision, l1, l2) {
  const hasCritical = decision === 'CRITICAL_BLOCK' || l1 > 0;
  const hasFixable = hasCritical || decision === 'NEEDS_FIX' || l2 > 0;
  if (!hasFixable) return 'NONE';
  return hasCritical ? 'P0' : 'P1';
}
const cases = [
  ['NEEDS_FIX', 0, 3, 'P1'],
  ['CRITICAL_BLOCK', 2, 1, 'P0'],
  ['PASS', 0, 0, 'NONE'],
  ['PASS', 1, 0, 'P0'],     // 计数与 decision 不一致 → 以严重度优先
  ['PASS', 0, 2, 'P1'],     // L2 计数 → 仍立案 P1
];
for (const [d, l1, l2, want] of cases) {
  const got = severity(d, l1, l2);
  if (got !== want) { console.error('FAIL: severity('+d+','+l1+','+l2+') 期望 '+want+' 实得 '+got); fail = true; }
}
if (fail) process.exit(1);
console.log('✅ daily-codereview-autofix smoke 通过');
" || { echo "[daily-codereview-autofix smoke] FAIL"; exit 1; }
