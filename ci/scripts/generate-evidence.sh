#!/usr/bin/env bash
# =============================================================================
# generate-evidence.sh - 汇总真实 CI 检查结果生成 Evidence
# =============================================================================
#
# v2.0.0 - P0-1 修复：Evidence 必须来自真实结果，不再硬编码
#
# 工作流程：
#   1. 读取所有 ci/out/checks/*.json（由各 CI 步骤生成）
#   2. 计算 qa_gate_passed = all(ok==true)
#   3. 计算 audit_decision = qa_gate_passed ? "PASS" : "FAIL"
#   4. 输出 .quality-evidence.{SHA}.json
#
# 必需的 checks（缺一不可）：
#   - typecheck.json
#   - test.json
#   - build.json
#   - shell-check.json
#
# =============================================================================

set -euo pipefail

CHECKS_DIR="ci/out/checks"
HEAD_SHA=$(git rev-parse HEAD)
OUT=".quality-evidence.${HEAD_SHA}.json"

# 必需的 checks
REQUIRED_CHECKS=(
  "typecheck"
  "test"
  "build"
  "shell-check"
)

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  Evidence 生成（v2.0 - 真实结果）"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

# 检查 checks 目录是否存在
if [[ ! -d "$CHECKS_DIR" ]]; then
  echo "❌ checks 目录不存在: $CHECKS_DIR"
  echo "   CI 步骤必须先生成 check 结果"
  exit 1
fi

# 收集所有 check 结果
CHECKS_JSON="[]"
ALL_OK=true
MISSING_CHECKS=()
FAILED_CHECKS=()

for check_name in "${REQUIRED_CHECKS[@]}"; do
  check_file="$CHECKS_DIR/${check_name}.json"

  if [[ ! -f "$check_file" ]]; then
    echo "  ❌ 缺少必需 check: $check_name"
    MISSING_CHECKS+=("$check_name")
    ALL_OK=false
    continue
  fi

  # 验证 JSON 格式
  if ! jq empty "$check_file" 2>/dev/null; then
    echo "  ❌ check 文件 JSON 格式无效: $check_name"
    FAILED_CHECKS+=("$check_name (invalid JSON)")
    ALL_OK=false
    continue
  fi

  # 读取 check 结果
  check_ok=$(jq -r '.ok // false' "$check_file")
  check_exit=$(jq -r '.exit_code // -1' "$check_file")
  check_ts=$(jq -r '.timestamp // ""' "$check_file")

  # 计算文件 hash（防篡改）
  check_hash=$(sha256sum "$check_file" | cut -d' ' -f1)

  if [[ "$check_ok" == "true" ]]; then
    echo "  ✅ $check_name (exit=$check_exit)"
  else
    echo "  ❌ $check_name (exit=$check_exit)"
    FAILED_CHECKS+=("$check_name")
    ALL_OK=false
  fi

  # 添加到 checks 数组
  CHECKS_JSON=$(echo "$CHECKS_JSON" | jq \
    --arg name "$check_name" \
    --argjson ok "$check_ok" \
    --argjson exit "$check_exit" \
    --arg ts "$check_ts" \
    --arg hash "$check_hash" \
    '. + [{name: $name, ok: $ok, exit_code: $exit, timestamp: $ts, file_hash: $hash}]')
done

echo ""

# Bug fix: 分支名计算逻辑清晰化
# - PR 上下文: GITHUB_HEAD_REF (PR 源分支名)
# - Push 上下文: GITHUB_REF_NAME (分支名，如 main)
# - 本地执行: git rev-parse (当前分支)
# 注意: GITHUB_REF_NAME 在 PR 上下文可能是 "123/merge" 格式，所以必须优先使用 GITHUB_HEAD_REF
get_branch_name() {
    if [[ -n "${GITHUB_HEAD_REF:-}" ]]; then
        echo "$GITHUB_HEAD_REF"
    elif [[ -n "${GITHUB_REF_NAME:-}" ]]; then
        echo "$GITHUB_REF_NAME"
    else
        git rev-parse --abbrev-ref HEAD 2>/dev/null || echo "unknown"
    fi
}
BRANCH_NAME=$(get_branch_name)

# 检查是否有缺失的 checks
if [[ ${#MISSING_CHECKS[@]} -gt 0 ]]; then
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  echo "  ❌ Evidence 生成失败"
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  echo ""
  echo "缺少必需的 check 文件："
  for missing in "${MISSING_CHECKS[@]}"; do
    echo "  - $missing"
  done
  echo ""
  echo "请确保 CI 步骤正确生成了所有 check 结果"
  exit 1
fi

# 计算最终结果
if [[ "$ALL_OK" == "true" ]]; then
  QA_GATE_PASSED=true
  AUDIT_DECISION="PASS"
else
  QA_GATE_PASSED=false
  AUDIT_DECISION="FAIL"
fi

# 读取 manual_verifications（如果存在）
MANUAL_VERIFICATIONS_FILE="ci/out/manual-verifications.json"
if [[ -f "$MANUAL_VERIFICATIONS_FILE" ]]; then
  MANUAL_VERIFICATIONS=$(cat "$MANUAL_VERIFICATIONS_FILE")
else
  MANUAL_VERIFICATIONS="[]"
fi

# 生成 Evidence JSON
jq -n \
  --arg sha "$HEAD_SHA" \
  --arg branch "$BRANCH_NAME" \
  --arg ci_run_id "${GITHUB_RUN_ID:-local}" \
  --arg timestamp "$(date -Iseconds)" \
  --argjson qa_gate_passed "$QA_GATE_PASSED" \
  --arg audit_decision "$AUDIT_DECISION" \
  --argjson checks "$CHECKS_JSON" \
  --argjson failed_checks "$(printf '%s\n' "${FAILED_CHECKS[@]:-}" | jq -R . | jq -s .)" \
  --argjson manual_verifications "$MANUAL_VERIFICATIONS" \
  '{
    version: "2.0.0",
    sha: $sha,
    branch: $branch,
    ci_run_id: $ci_run_id,
    timestamp: $timestamp,
    qa_gate_passed: $qa_gate_passed,
    audit_decision: $audit_decision,
    checks: $checks,
    failed_checks: $failed_checks,
    manual_verifications: $manual_verifications
  }' > "$OUT"

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
if [[ "$ALL_OK" == "true" ]]; then
  echo "  ✅ Evidence 生成成功"
else
  echo "  ⚠️  Evidence 生成完成（有失败）"
fi
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo "  文件: $OUT"
echo "  qa_gate_passed: $QA_GATE_PASSED"
echo "  audit_decision: $AUDIT_DECISION"
echo "  checks: ${#REQUIRED_CHECKS[@]} required, ${#FAILED_CHECKS[@]} failed"
