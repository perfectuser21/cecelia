#!/usr/bin/env bash
# ============================================================================
# sprint-contract-loop.sh — Sprint Contract Gate 收敛判断
# ============================================================================
# 用途：读取 Generator 和 Evaluator 的 seal 文件，机械判断是否收敛
#
# 参数：
#   $1  BRANCH        分支名（必须）
#   $2  PROJECT_ROOT  项目根目录（可选，默认 pwd）
#
# 返回：
#   exit 0  收敛（blocker_count == 0）— 主 agent 可进入 Stage 2
#   exit 1  未收敛（还有 blocker）   — 主 agent 展示差异给双方，重跑一轮
#   exit 2  前置条件缺失（seal 文件不存在或格式错误）
#
# 状态持久化：
#   .sprint-contract-state.{branch}  — 当前轮次/divergence 写磁盘
#   格式：JSON { round, timestamp, blocker_count, divergence[] }
#
# 依赖：node（用于解析 JSON seal 文件）
# State persists across sessions via disk files
# ============================================================================

set -euo pipefail

BRANCH="${1:-}"
PROJECT_ROOT="${2:-$(pwd)}"

if [[ -z "$BRANCH" ]]; then
  echo "❌ 用法: bash sprint-contract-loop.sh <BRANCH> [PROJECT_ROOT]" >&2
  exit 2
fi

EVAL_SEAL="${PROJECT_ROOT}/.dev-gate-spec.${BRANCH}"
GEN_SEAL="${PROJECT_ROOT}/.dev-gate-generator-sprint.${BRANCH}"
STATE_FILE="${PROJECT_ROOT}/.sprint-contract-state.${BRANCH}"

# ── 前置条件检查 ─────────────────────────────────────────────────────────────

if [[ ! -f "$EVAL_SEAL" ]]; then
  echo "❌ Evaluator seal 文件不存在: $EVAL_SEAL" >&2
  echo "   请先执行 Evaluator subagent（spec_review）再调用此脚本" >&2
  exit 2
fi

if [[ ! -f "$GEN_SEAL" ]]; then
  echo "❌ Generator seal 文件不存在: $GEN_SEAL" >&2
  echo "   请先执行 Generator subagent（sprint-contract-generator）再调用此脚本" >&2
  exit 2
fi

# ── 读取当前 round（从状态文件，默认 0）───────────────────────────────────────

CURRENT_ROUND=0
if [[ -f "$STATE_FILE" ]]; then
  CURRENT_ROUND=$(node -e "
    try {
      const s = JSON.parse(require('fs').readFileSync('${STATE_FILE}', 'utf8'));
      process.stdout.write(String(s.round || 0));
    } catch(e) { process.stdout.write('0'); }
  " 2>/dev/null || echo "0")
fi
NEXT_ROUND=$(( CURRENT_ROUND + 1 ))

# ── 解析 Evaluator seal，统计 blocker ─────────────────────────────────────────

PARSE_RESULT=$(node -e "
const fs = require('fs');

let evalSeal, genSeal;
try {
  evalSeal = JSON.parse(fs.readFileSync('${EVAL_SEAL}', 'utf8'));
} catch(e) {
  process.stderr.write('❌ Evaluator seal JSON 解析失败: ' + e.message + '\n');
  process.exit(2);
}

try {
  genSeal = JSON.parse(fs.readFileSync('${GEN_SEAL}', 'utf8'));
} catch(e) {
  process.stderr.write('❌ Generator seal JSON 解析失败: ' + e.message + '\n');
  process.exit(2);
}

// 检查 independent_test_plans 存在性
const plans = evalSeal.independent_test_plans || [];
if (plans.length === 0) {
  process.stderr.write('⚠️  Evaluator seal independent_test_plans 为空，需要重跑 Evaluator\n');
  process.exit(2);
}

// 统计 blocker：consistent==false 的条目
const divergence = plans
  .filter(p => p.consistent === false)
  .map(p => ({
    dod_item: p.dod_item || p.item || '(unknown)',
    eval_test: p.my_test || '',
    gen_test: (genSeal.proposals || []).find(g =>
      (g.dod_item || '').substring(0, 30) === (p.dod_item || '').substring(0, 30)
    )?.proposed_test || '(not found)',
    severity: 'blocker'
  }));

const blocker_count = divergence.length;

process.stdout.write(JSON.stringify({
  blocker_count,
  divergence,
  plans_count: plans.length
}));
" 2>/tmp/sprint-contract-parse-err.txt)

PARSE_EXIT=$?
if [[ $PARSE_EXIT -ne 0 ]]; then
  cat /tmp/sprint-contract-parse-err.txt >&2
  exit 2
fi

BLOCKER_COUNT=$(node -e "process.stdout.write(String(JSON.parse(process.argv[1]).blocker_count))" "$PARSE_RESULT" 2>/dev/null || echo "999")
PLANS_COUNT=$(node -e "process.stdout.write(String(JSON.parse(process.argv[1]).plans_count))" "$PARSE_RESULT" 2>/dev/null || echo "0")

# ── 写状态到磁盘 ──────────────────────────────────────────────────────────────

TIMESTAMP=$(TZ=Asia/Shanghai date +%Y-%m-%dT%H:%M:%S+08:00 2>/dev/null || date -u +%Y-%m-%dT%H:%M:%SZ)

node -e "
const fs = require('fs');
const result = JSON.parse(process.argv[1]);
const state = {
  branch: '${BRANCH}',
  round: ${NEXT_ROUND},
  timestamp: '${TIMESTAMP}',
  blocker_count: result.blocker_count,
  plans_count: result.plans_count,
  divergence: result.divergence
};
fs.writeFileSync('${STATE_FILE}', JSON.stringify(state, null, 2));
" "$PARSE_RESULT"

# ── 输出结果 ─────────────────────────────────────────────────────────────────

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  Sprint Contract Loop — Round ${NEXT_ROUND}"
echo "  Branch: ${BRANCH}"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  Evaluator 审查了 ${PLANS_COUNT} 条 DoD 条目"
echo "  Blocker 数量: ${BLOCKER_COUNT}"
echo ""

if [[ "$BLOCKER_COUNT" -eq 0 ]]; then
  echo "  ✅ 收敛！blocker_count == 0，可进入 Stage 2"
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  exit 0
else
  echo "  ❌ 未收敛，${BLOCKER_COUNT} 条 blocker 需要解决："
  echo ""

  # 输出每条 divergence 给主 agent 展示
  node -e "
const result = JSON.parse(process.argv[1]);
result.divergence.forEach((d, i) => {
  console.log('  [' + (i+1) + '] ' + d.dod_item);
  console.log('      Generator 方案: ' + d.gen_test);
  console.log('      Evaluator 方案: ' + d.eval_test);
  console.log('');
});
" "$PARSE_RESULT"

  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  echo "  → 将以上差异展示给 Generator 和 Evaluator 各自修正"
  echo "  → 删除两个 seal 文件后重新执行 Step 2 + Step 3"
  echo "  → 然后再次调用 sprint-contract-loop.sh"
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  exit 1
fi
