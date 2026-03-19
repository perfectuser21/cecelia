#!/usr/bin/env bash
# ZenithJoy Engine - 生成任务质检报告
# 在 cleanup 前调用，生成 txt 和 json 两种格式的报告
#
# 用法: bash skills/dev/scripts/generate-report.sh <cp-分支名> <base-分支名>
# 例如: bash skills/dev/scripts/generate-report.sh cp-01191030-task develop

set -euo pipefail

# 参数
CP_BRANCH="${1:-}"
BASE_BRANCH="${2:-develop}"
PROJECT_ROOT="${3:-$(pwd)}"
# L3 fix: 环境变量文档化
# CLAUDE_MODE: 运行模式，可选值:
#   - interactive: 有头模式（默认），用户交互
#   - headless: 无头模式（Cecelia），自动执行
MODE="${CLAUDE_MODE:-interactive}"

if [[ -z "$CP_BRANCH" ]]; then
    echo "错误: 请提供 cp-* 分支名"
    echo "用法: bash generate-report.sh <cp-分支名> [base-分支名] [project-root]"
    exit 1
fi

# 创建 .dev-runs 目录
mkdir -p "$PROJECT_ROOT/.dev-runs"

# 获取任务信息
TASK_ID="$CP_BRANCH"
TIMESTAMP=$(date '+%Y-%m-%d %H:%M')
DATE_ONLY=$(date '+%Y-%m-%d')

# ============================================================================
# 从执行日志生成质检数据（替代原来全是 unknown 的 .quality-report.json）
# ============================================================================
EXEC_LOG="$PROJECT_ROOT/.dev-execution-log.${CP_BRANCH}.jsonl"
EXEC_LOGGER="$PROJECT_ROOT/packages/engine/lib/execution-logger.sh"

# source execution-logger.sh 获取 _devlog_summary 函数
if [[ -f "$EXEC_LOGGER" ]]; then
    source "$EXEC_LOGGER"
fi

# 生成摘要
if [[ -f "$EXEC_LOG" ]] && command -v jq &>/dev/null; then
    SUMMARY_JSON=$(_devlog_summary "$EXEC_LOG" 2>/dev/null || echo '{}')
    EXEC_SCORE=$(echo "$SUMMARY_JSON" | jq -r '.score // 0')
    VERIFY_FAIL_COUNT=$(echo "$SUMMARY_JSON" | jq -r '[.verify_fails | to_entries[] | .value | length] | add // 0')
    CI_FAIL_COUNT=$(echo "$SUMMARY_JSON" | jq -r '.ci_fail_count // 0')
    BLOCKED_COUNT=$(echo "$SUMMARY_JSON" | jq -r '.blocked_count // 0')
    TOTAL_EVENTS=$(echo "$SUMMARY_JSON" | jq -r '.total_events // 0')

    # 从执行日志推导 L1/L2/L3 状态
    # L1（自动化测试）：verify-step step2 是否 pass（包含 npm test）
    if echo "$SUMMARY_JSON" | jq -e '.verify_fails.step2' &>/dev/null 2>&1; then
        L1_STATUS="fail (step2 验证失败 $(echo "$SUMMARY_JSON" | jq -r '.verify_fails.step2 | length') 次)"
    elif jq -e 'select(.source=="verify-step" and .step=="step2" and .event=="pass")' "$EXEC_LOG" &>/dev/null 2>&1; then
        L1_STATUS="pass"
    else
        L1_STATUS="not_run"
    fi

    # L2（CI 验证）：CI 是否通过
    if [[ "$CI_FAIL_COUNT" -gt 0 ]]; then
        L2_STATUS="fail (CI 失败 ${CI_FAIL_COUNT} 次)"
    elif jq -e 'select(.step=="ci" and .event=="pass")' "$EXEC_LOG" &>/dev/null 2>&1; then
        L2_STATUS="pass"
    else
        L2_STATUS="not_run"
    fi

    # L3（需求验收）：step1 Task Card 验证是否通过
    if echo "$SUMMARY_JSON" | jq -e '.verify_fails.step1' &>/dev/null 2>&1; then
        L3_STATUS="fail (TaskCard 验证失败 $(echo "$SUMMARY_JSON" | jq -r '.verify_fails.step1 | length') 次)"
    elif jq -e 'select(.source=="verify-step" and .step=="step1" and .event=="pass")' "$EXEC_LOG" &>/dev/null 2>&1; then
        L3_STATUS="pass"
    else
        L3_STATUS="not_run"
    fi

    # 总体状态
    if [[ "$L1_STATUS" == "pass" && "$L2_STATUS" == "pass" && "$L3_STATUS" == "pass" ]]; then
        OVERALL_STATUS="pass (${EXEC_SCORE}/10)"
    elif [[ "$L1_STATUS" == *"fail"* || "$L2_STATUS" == *"fail"* || "$L3_STATUS" == *"fail"* ]]; then
        OVERALL_STATUS="issues_found (${EXEC_SCORE}/10)"
    else
        OVERALL_STATUS="partial (${EXEC_SCORE}/10)"
    fi
else
    L1_STATUS="no_log"
    L2_STATUS="no_log"
    L3_STATUS="no_log"
    OVERALL_STATUS="no_log"
    EXEC_SCORE="N/A"
    VERIFY_FAIL_COUNT="0"
    CI_FAIL_COUNT="0"
    BLOCKED_COUNT="0"
    TOTAL_EVENTS="0"
    SUMMARY_JSON='{}'
fi

# 读取项目信息（从 package.json）
if [[ -f "$PROJECT_ROOT/package.json" ]]; then
    PROJECT_NAME=$(jq -r '.name // "unknown"' "$PROJECT_ROOT/package.json" 2>/dev/null || echo "unknown")
else
    PROJECT_NAME=$(basename "$PROJECT_ROOT")
fi

# L2 fix: 获取 git 信息，区分无 PR 和 API 错误
PR_URL=""
PR_MERGED="false"
PR_API_ERROR=""

# 尝试获取已合并的 PR
PR_RESULT=$(gh pr list --head "$CP_BRANCH" --state merged --json url -q '.[0].url' 2>&1)
PR_EXIT=$?
if [[ $PR_EXIT -eq 0 && -n "$PR_RESULT" && "$PR_RESULT" != "null" ]]; then
    PR_URL="$PR_RESULT"
    PR_MERGED="true"
elif [[ $PR_EXIT -ne 0 ]]; then
    PR_API_ERROR="$PR_RESULT"
fi

# 如果没有已合并的 PR，检查是否有任何 PR
if [[ -z "$PR_URL" && -z "$PR_API_ERROR" ]]; then
    PR_RESULT=$(gh pr list --head "$CP_BRANCH" --state all --json url -q '.[0].url' 2>&1)
    PR_EXIT=$?
    if [[ $PR_EXIT -eq 0 && -n "$PR_RESULT" && "$PR_RESULT" != "null" ]]; then
        PR_URL="$PR_RESULT"
    elif [[ $PR_EXIT -ne 0 ]]; then
        PR_API_ERROR="$PR_RESULT"
    fi
fi

# 设置默认值
if [[ -z "$PR_URL" ]]; then
    if [[ -n "$PR_API_ERROR" ]]; then
        PR_URL="API Error: $PR_API_ERROR"
    else
        PR_URL="N/A"
    fi
fi

# v8: 不再使用步骤状态机，报告在 cleanup 阶段生成表示流程已完成

# L2 fix: 获取变更文件，处理 git diff 失败
FILES_CHANGED=""
GIT_DIFF_ERROR=""

if git rev-parse --verify "$CP_BRANCH" &>/dev/null; then
    # 检查 BASE_BRANCH 是否存在
    if git rev-parse --verify "$BASE_BRANCH" &>/dev/null; then
        DIFF_RESULT=$(git diff --name-only "$BASE_BRANCH"..."$CP_BRANCH" 2>&1)
        DIFF_EXIT=$?
        if [[ $DIFF_EXIT -eq 0 ]]; then
            FILES_CHANGED=$(echo "$DIFF_RESULT" | head -20)
        else
            GIT_DIFF_ERROR="$DIFF_RESULT"
        fi
    else
        GIT_DIFF_ERROR="Base branch $BASE_BRANCH not found"
    fi
fi

# 如果 git diff 为空或失败，从 PR API 获取
if [[ -z "$FILES_CHANGED" ]]; then
    PR_FILES=$(gh pr list --head "$CP_BRANCH" --state all --json files -q '.[0].files[].path' 2>/dev/null | head -20 || echo "")
    if [[ -n "$PR_FILES" ]]; then
        FILES_CHANGED="$PR_FILES"
    elif [[ -n "$GIT_DIFF_ERROR" ]]; then
        # 如果 git diff 失败且 PR API 也没数据，记录错误
        FILES_CHANGED="(Error: $GIT_DIFF_ERROR)"
    fi
fi

# 获取版本变更（从 package.json）
CURRENT_VERSION=$(jq -r '.version // "unknown"' "$PROJECT_ROOT/package.json" 2>/dev/null || echo "unknown")

# 生成步骤问题详情（从执行日志提取 fail 事件）
STEP_ISSUES=""
if [[ -f "$EXEC_LOG" ]] && command -v jq &>/dev/null; then
    STEP_ISSUES=$(jq -r 'select(.event == "fail" or (.event == "blocked" and (.detail | test("失败|FAIL|failure"; "i")))) | "  [\(.ts | split("T")[1] | split("+")[0])] \(.source)/\(.step): \(.detail | split("\n")[0] | .[0:120])"' "$EXEC_LOG" 2>/dev/null || echo "  (无问题记录)")
    if [[ -z "$STEP_ISSUES" ]]; then
        STEP_ISSUES="  (无问题记录)"
    fi
else
    STEP_ISSUES="  (无执行日志)"
fi

# 生成 TXT 报告
TXT_REPORT="$PROJECT_ROOT/.dev-runs/${TASK_ID}-report.txt"
cat > "$TXT_REPORT" << EOF
================================================================================
                          任务完成报告
================================================================================

任务ID:     $TASK_ID
项目:       $PROJECT_NAME
分支:       $CP_BRANCH -> $BASE_BRANCH
模式:       $MODE
时间:       $TIMESTAMP

--------------------------------------------------------------------------------
执行质量评分: ${EXEC_SCORE}/10
--------------------------------------------------------------------------------

Layer 1: 本地测试 (verify-step step2)
  - 状态: $L1_STATUS

Layer 2: CI 验证
  - 状态: $L2_STATUS

Layer 3: 需求验收 (verify-step step1)
  - 状态: $L3_STATUS

总体结论: $OVERALL_STATUS

统计:
  - 总事件数: $TOTAL_EVENTS
  - verify-step 失败次数: $VERIFY_FAIL_COUNT
  - CI 失败次数: $CI_FAIL_COUNT
  - 阻塞次数: $BLOCKED_COUNT

--------------------------------------------------------------------------------
过程中发现的问题（按时间排序）
--------------------------------------------------------------------------------
$STEP_ISSUES

--------------------------------------------------------------------------------
CI/CD
--------------------------------------------------------------------------------
PR:         $PR_URL
PR 状态:    $([ "$PR_MERGED" = "true" ] && echo "已合并" || echo "未合并")

--------------------------------------------------------------------------------
变更文件
--------------------------------------------------------------------------------
$FILES_CHANGED

--------------------------------------------------------------------------------
版本
--------------------------------------------------------------------------------
当前版本:   $CURRENT_VERSION

================================================================================
EOF

echo "已生成报告: $TXT_REPORT"

# 生成 JSON 报告（供 Cecelia 读取）
JSON_REPORT="$PROJECT_ROOT/.dev-runs/${TASK_ID}-report.json"

# 用 jq 安全构建 JSON（避免 heredoc 中的特殊字符问题）
if command -v jq &>/dev/null; then
    FILES_JSON=$(
        if [[ -n "$FILES_CHANGED" ]]; then
            echo "$FILES_CHANGED" | jq -R -s 'split("\n") | map(select(length > 0))'
        else
            echo "[]"
        fi
    )

    jq -n \
        --arg task_id "$TASK_ID" \
        --arg project "$PROJECT_NAME" \
        --arg branch "$CP_BRANCH" \
        --arg base_branch "$BASE_BRANCH" \
        --arg mode "$MODE" \
        --arg timestamp "$TIMESTAMP" \
        --arg date "$DATE_ONLY" \
        --arg l1 "$L1_STATUS" \
        --arg l2 "$L2_STATUS" \
        --arg l3 "$L3_STATUS" \
        --arg overall "$OVERALL_STATUS" \
        --arg score "$EXEC_SCORE" \
        --argjson verify_fails "${VERIFY_FAIL_COUNT:-0}" \
        --argjson ci_fails "${CI_FAIL_COUNT:-0}" \
        --argjson blocked "${BLOCKED_COUNT:-0}" \
        --argjson total_events "${TOTAL_EVENTS:-0}" \
        --arg pr_url "$PR_URL" \
        --argjson pr_merged "$PR_MERGED" \
        --arg version "$CURRENT_VERSION" \
        --argjson files "$FILES_JSON" \
        --argjson execution_summary "$SUMMARY_JSON" \
        '{
            task_id: $task_id,
            project: $project,
            branch: $branch,
            base_branch: $base_branch,
            mode: $mode,
            timestamp: $timestamp,
            date: $date,
            quality_report: {
                L1_local_test: $l1,
                L2_ci_verification: $l2,
                L3_requirements: $l3,
                overall: $overall,
                score: $score,
                verify_fail_count: $verify_fails,
                ci_fail_count: $ci_fails,
                blocked_count: $blocked,
                total_events: $total_events
            },
            ci_cd: {
                pr_url: $pr_url,
                pr_merged: $pr_merged
            },
            version: $version,
            files_changed: $files,
            execution_summary: $execution_summary
        }' > "$JSON_REPORT"
else
    # jq 不可用时的 fallback
    cat > "$JSON_REPORT" << JSONEOF
{
  "task_id": "$TASK_ID",
  "project": "$PROJECT_NAME",
  "branch": "$CP_BRANCH",
  "quality_report": {
    "overall": "$OVERALL_STATUS",
    "score": "$EXEC_SCORE"
  },
  "ci_cd": {
    "pr_url": "$PR_URL",
    "pr_merged": $PR_MERGED
  }
}
JSONEOF
fi

echo "已生成报告: $JSON_REPORT"

# ============================================================================
# POST 报告到 Brain dev_execution_logs（/api/brain/dev-logs）
# ============================================================================
BRAIN_URL="http://localhost:5221/api/brain/dev-logs"

# 推导 status 字段
if [[ "$OVERALL_STATUS" == pass* ]]; then
    POST_STATUS="success"
elif [[ "$OVERALL_STATUS" == issues_found* ]]; then
    POST_STATUS="failure"
else
    POST_STATUS="partial"
fi

# 生成唯一 run_id（优先用 uuidgen，fallback 时间戳）
RUN_ID=$(uuidgen 2>/dev/null | tr '[:upper:]' '[:lower:]' || echo "${CP_BRANCH}-$(date +%s)")

# 读取 JSON 报告内容作为 metadata
REPORT_CONTENT=$(cat "$JSON_REPORT" 2>/dev/null || echo '{}')

# POST 到 Brain（失败只警告，不中断 cleanup）
if command -v curl &>/dev/null; then
    POST_RESPONSE=$(curl -s -w "\n%{http_code}" -X POST "$BRAIN_URL" \
        -H "Content-Type: application/json" \
        -d "$(jq -n \
            --arg task_id "$CP_BRANCH" \
            --arg run_id "$RUN_ID" \
            --arg phase "complete" \
            --arg status "$POST_STATUS" \
            --argjson metadata "$REPORT_CONTENT" \
            --arg completed_at "$(TZ=Asia/Shanghai date -u +%Y-%m-%dT%H:%M:%SZ 2>/dev/null || date -u +%Y-%m-%dT%H:%M:%SZ)" \
            '{task_id: $task_id, run_id: $run_id, phase: $phase, status: $status, metadata: $metadata, completed_at: $completed_at}'
        )" 2>/dev/null || echo -e "\n000")
    HTTP_CODE=$(echo "$POST_RESPONSE" | tail -1)
    if [[ "$HTTP_CODE" == "201" ]]; then
        echo "✅ 已上传报告到 Brain dev-logs（task_id: $CP_BRANCH, status: $POST_STATUS）"
    else
        echo "⚠️  上传 Brain dev-logs 失败（HTTP $HTTP_CODE），本地报告已保存"
    fi
else
    echo "⚠️  curl 不可用，跳过 Brain dev-logs 上传"
fi
