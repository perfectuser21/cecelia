#!/usr/bin/env bash
# generate-sprint-report.sh — Stage 4 自动生成 Sprint Report
#
# 功能：汇总本次 /dev Pipeline 的全程执行数据，生成持久化报告
#       报告保存到 docs/reports/{branch}.md，随 PR commit 进 git
#
# 数据来源（本地 .seal 文件，不依赖外部服务）：
#   .dev-gate-planner.{branch}             — Planner 隔离验证
#   .dev-gate-generator-sprint.{branch}    — Generator 提案
#   .dev-gate-spec.{branch}                — Evaluator 裁决（含轮次/分歧）
#   .sprint-contract-state.{branch}        — 对抗轮次和 blocker 历史
#   .dev-mode 或 .dev-mode.{branch}        — 各 Stage 完成状态
#
# 用法：
#   bash packages/engine/scripts/devgate/generate-sprint-report.sh
#   bash packages/engine/scripts/devgate/generate-sprint-report.sh [branch] [project_root]
#
# v1.0.0

set -euo pipefail

# ─── 参数解析 ─────────────────────────────────────────────────────────────────

BRANCH="${1:-}"
PROJECT_ROOT="${2:-$(pwd)}"

# 若未传入 branch，从 git 读取
if [[ -z "$BRANCH" ]]; then
  BRANCH=$(git -C "$PROJECT_ROOT" rev-parse --abbrev-ref HEAD 2>/dev/null || echo "")
fi

if [[ -z "$BRANCH" ]]; then
  echo "❌ 无法确定分支名，请传入 branch 参数" >&2
  exit 1
fi

# ─── 文件路径 ─────────────────────────────────────────────────────────────────

PLANNER_SEAL="${PROJECT_ROOT}/.dev-gate-planner.${BRANCH}"
GENERATOR_SEAL="${PROJECT_ROOT}/.dev-gate-generator-sprint.${BRANCH}"
EVALUATOR_SEAL="${PROJECT_ROOT}/.dev-gate-spec.${BRANCH}"
CONTRACT_STATE="${PROJECT_ROOT}/.sprint-contract-state.${BRANCH}"
DEV_MODE="${PROJECT_ROOT}/.dev-mode.${BRANCH}"

# 兼容新格式（单一 .dev-mode 文件）
if [[ ! -f "$DEV_MODE" && -f "${PROJECT_ROOT}/.dev-mode" ]]; then
  DEV_MODE="${PROJECT_ROOT}/.dev-mode"
fi

REPORT_DIR="${PROJECT_ROOT}/docs/reports"
REPORT_FILE="${REPORT_DIR}/${BRANCH}.md"

mkdir -p "$REPORT_DIR"

# ─── 读取数据 ─────────────────────────────────────────────────────────────────

TIMESTAMP=$(TZ=Asia/Shanghai date "+%Y-%m-%d %H:%M:%S %Z" 2>/dev/null || date -u "+%Y-%m-%d %H:%M:%S UTC")

# 读取 Planner seal
PLANNER_ALL_TODO="unknown"
PLANNER_DOD_COUNT=0
if [[ -f "$PLANNER_SEAL" ]]; then
  PLANNER_ALL_TODO=$(node -e "
    try {
      const d = JSON.parse(require('fs').readFileSync('${PLANNER_SEAL}', 'utf8'));
      process.stdout.write(String(d.all_tests_todo === true ? 'true' : 'false'));
    } catch(e) { process.stdout.write('error'); }
  " 2>/dev/null || echo "error")
  PLANNER_DOD_COUNT=$(node -e "
    try {
      const d = JSON.parse(require('fs').readFileSync('${PLANNER_SEAL}', 'utf8'));
      process.stdout.write(String((d.dod_items || []).length));
    } catch(e) { process.stdout.write('0'); }
  " 2>/dev/null || echo "0")
fi

# 读取 Sprint Contract State
CONTRACT_ROUNDS=0
CONTRACT_FINAL_BLOCKERS=0
CONTRACT_DIVERGENCE_LIST=""
if [[ -f "$CONTRACT_STATE" ]]; then
  CONTRACT_ROUNDS=$(node -e "
    try {
      const d = JSON.parse(require('fs').readFileSync('${CONTRACT_STATE}', 'utf8'));
      process.stdout.write(String(d.round || 0));
    } catch(e) { process.stdout.write('0'); }
  " 2>/dev/null || echo "0")
  CONTRACT_FINAL_BLOCKERS=$(node -e "
    try {
      const d = JSON.parse(require('fs').readFileSync('${CONTRACT_STATE}', 'utf8'));
      process.stdout.write(String(d.blocker_count || 0));
    } catch(e) { process.stdout.write('0'); }
  " 2>/dev/null || echo "0")
  CONTRACT_DIVERGENCE_LIST=$(node -e "
    try {
      const d = JSON.parse(require('fs').readFileSync('${CONTRACT_STATE}', 'utf8'));
      const divs = d.divergence || [];
      if (divs.length === 0) { process.stdout.write('无'); return; }
      const list = divs.map((v,i) => (i+1) + '. ' + (v.dod_item || '').substring(0,60)).join('\n');
      process.stdout.write(list);
    } catch(e) { process.stdout.write('(读取失败)'); }
  " 2>/dev/null || echo "(读取失败)")
fi

# 读取 Evaluator seal
EVALUATOR_VERDICT="unknown"
EVALUATOR_CONSISTENT_COUNT=0
EVALUATOR_DIVERGENCE_COUNT=0
EVALUATOR_PLANS_COUNT=0
EVALUATOR_SUMMARY=""
if [[ -f "$EVALUATOR_SEAL" ]]; then
  EVALUATOR_VERDICT=$(node -e "
    try {
      const d = JSON.parse(require('fs').readFileSync('${EVALUATOR_SEAL}', 'utf8'));
      process.stdout.write(d.verdict || 'unknown');
    } catch(e) { process.stdout.write('error'); }
  " 2>/dev/null || echo "error")
  EVALUATOR_CONSISTENT_COUNT=$(node -e "
    try {
      const d = JSON.parse(require('fs').readFileSync('${EVALUATOR_SEAL}', 'utf8'));
      process.stdout.write(String((d.negotiation_result || {}).consistent_count || 0));
    } catch(e) { process.stdout.write('0'); }
  " 2>/dev/null || echo "0")
  EVALUATOR_DIVERGENCE_COUNT=$(node -e "
    try {
      const d = JSON.parse(require('fs').readFileSync('${EVALUATOR_SEAL}', 'utf8'));
      process.stdout.write(String((d.negotiation_result || {}).divergence_count || 0));
    } catch(e) { process.stdout.write('0'); }
  " 2>/dev/null || echo "0")
  EVALUATOR_PLANS_COUNT=$(node -e "
    try {
      const d = JSON.parse(require('fs').readFileSync('${EVALUATOR_SEAL}', 'utf8'));
      process.stdout.write(String((d.independent_test_plans || []).length));
    } catch(e) { process.stdout.write('0'); }
  " 2>/dev/null || echo "0")
  EVALUATOR_SUMMARY=$(node -e "
    try {
      const d = JSON.parse(require('fs').readFileSync('${EVALUATOR_SEAL}', 'utf8'));
      process.stdout.write(d.summary || '');
    } catch(e) { process.stdout.write(''); }
  " 2>/dev/null || echo "")
fi

# 读取 .dev-mode Stage 完成状态
STAGE1_STATUS="unknown"
STAGE2_STATUS="unknown"
STAGE3_STATUS="unknown"
STAGE4_STATUS="unknown"
if [[ -f "$DEV_MODE" ]]; then
  STAGE1_STATUS=$(grep "^step_1_spec:" "$DEV_MODE" 2>/dev/null | awk '{print $2}' || echo "unknown")
  STAGE2_STATUS=$(grep "^step_2_code:" "$DEV_MODE" 2>/dev/null | awk '{print $2}' || echo "unknown")
  STAGE3_STATUS=$(grep "^step_3_integrate:" "$DEV_MODE" 2>/dev/null | awk '{print $2}' || echo "unknown")
  STAGE4_STATUS=$(grep "^step_4_ship:" "$DEV_MODE" 2>/dev/null | awk '{print $2}' || echo "unknown")
fi

# 读取 CI 结果（通过 gh CLI）
CI_RUNS_COUNT=0
CI_PASS_COUNT=0
CI_FAIL_COUNT=0
CI_STATUS_LINE="（CI 数据不可用）"
if command -v gh &>/dev/null; then
  CI_JSON=$(gh run list --branch "$BRANCH" --json conclusion,status --limit 20 2>/dev/null || echo "[]")
  CI_RUNS_COUNT=$(node -e "
    try {
      const runs = JSON.parse(process.argv[1]);
      process.stdout.write(String(runs.length));
    } catch(e) { process.stdout.write('0'); }
  " "$CI_JSON" 2>/dev/null || echo "0")
  CI_PASS_COUNT=$(node -e "
    try {
      const runs = JSON.parse(process.argv[1]);
      process.stdout.write(String(runs.filter(r => r.conclusion === 'success').length));
    } catch(e) { process.stdout.write('0'); }
  " "$CI_JSON" 2>/dev/null || echo "0")
  CI_FAIL_COUNT=$(node -e "
    try {
      const runs = JSON.parse(process.argv[1]);
      process.stdout.write(String(runs.filter(r => r.conclusion === 'failure').length));
    } catch(e) { process.stdout.write('0'); }
  " "$CI_JSON" 2>/dev/null || echo "0")
  if [[ "$CI_RUNS_COUNT" -gt 0 ]]; then
    CI_STATUS_LINE="总计 ${CI_RUNS_COUNT} 次 | 通过 ${CI_PASS_COUNT} 次 | 失败 ${CI_FAIL_COUNT} 次"
  fi
fi

# ─── 评分计算 ─────────────────────────────────────────────────────────────────

# 评分 1：Planner 隔离度（0-10）
SCORE_PLANNER=0
if [[ "$PLANNER_ALL_TODO" == "true" ]]; then
  SCORE_PLANNER=10
elif [[ "$PLANNER_ALL_TODO" == "false" ]]; then
  SCORE_PLANNER=0
else
  SCORE_PLANNER=5  # seal 文件缺失，给中间分
fi

# 评分 2：对抗深度（0-10）
# 1轮0分歧 → 4/10（最低有效），每增加1轮+2，每发现1分歧+1（上限10）
SCORE_ADVERSARIAL=0
if [[ "$CONTRACT_ROUNDS" -gt 0 ]]; then
  SCORE_ADVERSARIAL=4
  EXTRA_ROUNDS=$(( CONTRACT_ROUNDS - 1 ))
  EXTRA_FROM_ROUNDS=$(( EXTRA_ROUNDS * 2 ))
  EXTRA_FROM_DIVS=$EVALUATOR_DIVERGENCE_COUNT
  TOTAL_EXTRA=$(( EXTRA_FROM_ROUNDS + EXTRA_FROM_DIVS ))
  SCORE_ADVERSARIAL=$(( 4 + TOTAL_EXTRA ))
  if [[ "$SCORE_ADVERSARIAL" -gt 10 ]]; then SCORE_ADVERSARIAL=10; fi
fi

# 评分 3：CI 健康度（0-10）
SCORE_CI=10
if [[ "$CI_FAIL_COUNT" -gt 0 ]]; then
  SCORE_CI=$(( 10 - CI_FAIL_COUNT * 2 ))
  if [[ "$SCORE_CI" -lt 0 ]]; then SCORE_CI=0; fi
fi
if [[ "$CI_RUNS_COUNT" -eq 0 ]]; then SCORE_CI=5; fi

# 评分 4：留痕完整度（0-10）
SCORE_TRACE=0
SEAL_FILES_FOUND=0
[[ -f "$PLANNER_SEAL" ]] && SEAL_FILES_FOUND=$(( SEAL_FILES_FOUND + 1 ))
[[ -f "$GENERATOR_SEAL" ]] && SEAL_FILES_FOUND=$(( SEAL_FILES_FOUND + 1 ))
[[ -f "$EVALUATOR_SEAL" ]] && SEAL_FILES_FOUND=$(( SEAL_FILES_FOUND + 1 ))
[[ -f "$CONTRACT_STATE" ]] && SEAL_FILES_FOUND=$(( SEAL_FILES_FOUND + 1 ))
[[ -f "$DEV_MODE" ]] && SEAL_FILES_FOUND=$(( SEAL_FILES_FOUND + 1 ))
SCORE_TRACE=$(( SEAL_FILES_FOUND * 2 ))
if [[ "$SCORE_TRACE" -gt 10 ]]; then SCORE_TRACE=10; fi

TOTAL_SCORE=$(( SCORE_PLANNER + SCORE_ADVERSARIAL + SCORE_CI + SCORE_TRACE ))

# ─── 生成报告（heredoc，章节标题精确格式）────────────────────────────────────

{
  echo "# Sprint Report: ${BRANCH}"
  echo ""
  echo "**生成时间**: ${TIMESTAMP}"
  echo "**Branch**: \`${BRANCH}\`"
  echo "**总分**: ${TOTAL_SCORE}/40"
  echo ""
  echo "---"
  echo ""
  echo "## Planner Isolation"
  echo ""
  echo "> Planner subagent 是否真正隔离，只输出 WHAT（行为描述），不预填 Test 命令"
  echo ""
  echo "| 指标 | 状态 |"
  echo "|------|------|"
  if [[ -f "$PLANNER_SEAL" ]]; then
    echo "| Seal 文件存在 | ✅ 存在 |"
  else
    echo "| Seal 文件存在 | ❌ 缺失 |"
  fi
  echo "| DoD 条目数量 | ${PLANNER_DOD_COUNT} |"
  if [[ "$PLANNER_ALL_TODO" == "true" ]]; then
    echo "| 所有 Test 字段为 TODO | ✅ 是（隔离有效） |"
  else
    echo "| 所有 Test 字段为 TODO | ❌ 否（Planner 预填了 Test） |"
  fi
  echo ""
  echo "**Planner 隔离评分**: ${SCORE_PLANNER}/10"
  echo ""
  echo "---"
  echo ""
  echo "## Sprint Contract"
  echo ""
  echo "> Generator 和 Evaluator 双独立提案的对抗过程"
  echo ""
  echo "| 指标 | 状态 |"
  echo "|------|------|"
  if [[ -f "$CONTRACT_STATE" ]]; then
    echo "| Contract State 文件 | ✅ 存在 |"
  else
    echo "| Contract State 文件 | ❌ 缺失 |"
  fi
  echo "| 对抗总轮次 | ${CONTRACT_ROUNDS} 轮 |"
  echo "| 最终 blocker 数 | ${CONTRACT_FINAL_BLOCKERS} |"
  echo "| Evaluator 提案数 | ${EVALUATOR_PLANS_COUNT} |"
  if [[ "$EVALUATOR_VERDICT" == "PASS" ]]; then
    echo "| 最终裁决 | ✅ ${EVALUATOR_VERDICT} |"
  else
    echo "| 最终裁决 | ❌ ${EVALUATOR_VERDICT} |"
  fi
  echo "| 一致条目数 | ${EVALUATOR_CONSISTENT_COUNT} |"
  echo "| 分歧条目数 | ${EVALUATOR_DIVERGENCE_COUNT} |"
  echo ""
  if [[ -n "$EVALUATOR_SUMMARY" ]]; then
    echo "**Evaluator 总结**: ${EVALUATOR_SUMMARY}"
    echo ""
  fi
  if [[ -n "$CONTRACT_DIVERGENCE_LIST" && "$CONTRACT_DIVERGENCE_LIST" != "无" ]]; then
    echo "**最后一轮分歧列表**:"
    echo ""
    echo "$CONTRACT_DIVERGENCE_LIST" | while IFS= read -r line; do
      echo "- ${line}"
    done
    echo ""
  fi
  echo "**对抗深度评分**: ${SCORE_ADVERSARIAL}/10"
  echo ""
  echo "---"
  echo ""
  echo "## CI Gate"
  echo ""
  echo "> Push 后各轮 CI 执行结果"
  echo ""
  echo "| 指标 | 状态 |"
  echo "|------|------|"
  echo "| CI 统计 | ${CI_STATUS_LINE} |"
  if [[ "$STAGE1_STATUS" == "done" ]]; then
    echo "| Stage 1 Spec | ✅ done |"
  else
    echo "| Stage 1 Spec | ⏳ ${STAGE1_STATUS} |"
  fi
  if [[ "$STAGE2_STATUS" == "done" ]]; then
    echo "| Stage 2 Code | ✅ done |"
  else
    echo "| Stage 2 Code | ⏳ ${STAGE2_STATUS} |"
  fi
  if [[ "$STAGE3_STATUS" == "done" ]]; then
    echo "| Stage 3 Integrate | ✅ done |"
  else
    echo "| Stage 3 Integrate | ⏳ ${STAGE3_STATUS} |"
  fi
  if [[ "$STAGE4_STATUS" == "done" ]]; then
    echo "| Stage 4 Ship | ✅ done |"
  else
    echo "| Stage 4 Ship | ⏳ ${STAGE4_STATUS} |"
  fi
  echo ""
  echo "**CI 健康度评分**: ${SCORE_CI}/10"
  echo ""
  echo "---"
  echo ""
  echo "## Scores"
  echo ""
  echo "> 四维度执行质量评分"
  echo ""
  echo "| 维度 | 说明 | 得分 |"
  echo "|------|------|------|"
  echo "| Planner 隔离 | 所有 Test=TODO → 10/10 | ${SCORE_PLANNER}/10 |"
  echo "| 对抗深度 | 轮次×分歧综合，最低 4（1轮0分歧） | ${SCORE_ADVERSARIAL}/10 |"
  echo "| CI 健康度 | 一次通过 → 10/10，每失败 -2 | ${SCORE_CI}/10 |"
  echo "| 留痕完整度 | Seal 文件数量（5个=满分） | ${SCORE_TRACE}/10 |"
  echo "| **总分** | | **${TOTAL_SCORE}/40** |"
  echo ""
  echo "---"
  echo ""
  echo "*此报告由 \`generate-sprint-report.sh\` 在 Stage 4 Ship 时自动生成。*"
} > "$REPORT_FILE"

echo "✅ Sprint Report 已生成: ${REPORT_FILE}"
echo "   总分: ${TOTAL_SCORE}/40（Planner:${SCORE_PLANNER} 对抗:${SCORE_ADVERSARIAL} CI:${SCORE_CI} 留痕:${SCORE_TRACE}）"
