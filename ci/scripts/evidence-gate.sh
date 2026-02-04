#!/usr/bin/env bash
# =============================================================================
# evidence-gate.sh - 验证 Evidence 的"事实"而非仅"格式"
# =============================================================================
#
# v2.0.0 - P0-1 修复：
#   1. 验证 required checks 全存在
#   2. 验证所有 checks.ok == true
#   3. 验证文件 hash 防篡改
#   4. 验证 qa_gate_passed 与 checks 一致
#
# =============================================================================

set -euo pipefail

CHECKS_DIR="ci/out/checks"
HEAD_SHA=$(git rev-parse HEAD)
FILE=".quality-evidence.${HEAD_SHA}.json"

# 必需的 checks（必须与 generate-evidence.sh 一致）
REQUIRED_CHECKS=(
  "typecheck"
  "test"
  "build"
  "shell-check"
)

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  Evidence Gate（v2.0 - 验证事实）"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

# 1. 检查 Evidence 文件存在
if [[ ! -f "$FILE" ]]; then
  echo "❌ Evidence 文件不存在: $FILE"
  exit 1
fi

# 2. 校验 JSON 格式
if ! jq empty "$FILE" 2>/dev/null; then
  echo "❌ Evidence JSON 格式无效"
  exit 1
fi

# 3. 校验 version（必须是 v2）
VERSION=$(jq -r '.version // "1.0.0"' "$FILE")
if [[ "$VERSION" != "2.0.0" ]]; then
  echo "❌ Evidence 版本不兼容: $VERSION (需要 2.0.0)"
  echo "   请使用新版 generate-evidence.sh 重新生成"
  exit 1
fi
echo "  ✅ 版本: $VERSION"

# 4. 校验 SHA
E_SHA=$(jq -r '.sha' "$FILE")
if [[ "$E_SHA" != "$HEAD_SHA" ]]; then
  echo "❌ Evidence SHA 不匹配"
  echo "   期望: $HEAD_SHA"
  echo "   实际: $E_SHA"
  exit 1
fi
echo "  ✅ SHA 匹配"

# 5. 校验必需字段
for key in sha ci_run_id timestamp qa_gate_passed audit_decision checks; do
  if ! jq -e ".$key" "$FILE" >/dev/null 2>&1; then
    echo "❌ 缺少必需字段: $key"
    exit 1
  fi
done
echo "  ✅ 必需字段完整"

# 6. 验证 checks 数组
CHECKS_COUNT=$(jq '.checks | length' "$FILE")
if [[ "$CHECKS_COUNT" -lt "${#REQUIRED_CHECKS[@]}" ]]; then
  echo "❌ checks 数量不足: $CHECKS_COUNT (需要 ${#REQUIRED_CHECKS[@]})"
  exit 1
fi

# 7. 验证每个 required check 存在且通过
FAILED=0
for check_name in "${REQUIRED_CHECKS[@]}"; do
  # 检查 evidence 中是否有此 check
  CHECK_EXISTS=$(jq --arg name "$check_name" '.checks[] | select(.name == $name) | .name' "$FILE")
  if [[ -z "$CHECK_EXISTS" ]]; then
    echo "  ❌ 缺少必需 check: $check_name"
    FAILED=1
    continue
  fi

  # 检查 ok 状态
  CHECK_OK=$(jq -r --arg name "$check_name" '.checks[] | select(.name == $name) | .ok' "$FILE")
  if [[ "$CHECK_OK" != "true" ]]; then
    echo "  ❌ check 失败: $check_name"
    FAILED=1
    continue
  fi

  # 验证文件 hash（checks 目录必须存在）
  # Bug fix: 如果 checks 目录不存在，hash 验证被绕过，可能导致篡改
  if [[ ! -d "$CHECKS_DIR" ]]; then
    echo "  ❌ checks 目录不存在: $CHECKS_DIR"
    echo "     无法验证 check 文件 hash，可能是篡改或配置错误"
    FAILED=1
    continue
  fi

  check_file="$CHECKS_DIR/${check_name}.json"
  if [[ -f "$check_file" ]]; then
    EXPECTED_HASH=$(jq -r --arg name "$check_name" '.checks[] | select(.name == $name) | .file_hash' "$FILE")
    ACTUAL_HASH=$(sha256sum "$check_file" | cut -d' ' -f1)
    if [[ "$EXPECTED_HASH" != "$ACTUAL_HASH" ]]; then
      echo "  ❌ check 文件被篡改: $check_name"
      echo "     期望 hash: $EXPECTED_HASH"
      echo "     实际 hash: $ACTUAL_HASH"
      FAILED=1
      continue
    fi
  fi

  echo "  ✅ $check_name"
done

if [[ "$FAILED" -eq 1 ]]; then
  echo ""
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  echo "  ❌ Evidence Gate 失败"
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  exit 1
fi

# 8. 验证 qa_gate_passed 与 checks 一致
QA_GATE_PASSED=$(jq -r '.qa_gate_passed' "$FILE")
ALL_CHECKS_PASS=$(jq '[.checks[].ok] | all' "$FILE")

if [[ "$QA_GATE_PASSED" != "$ALL_CHECKS_PASS" ]]; then
  echo "  ⚠️  qa_gate_passed 与 checks 不一致"
  echo "     qa_gate_passed: $QA_GATE_PASSED"
  echo "     all checks ok: $ALL_CHECKS_PASS"
  # 以 checks 为准
  if [[ "$ALL_CHECKS_PASS" != "true" ]]; then
    echo ""
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    echo "  ❌ Evidence Gate 失败（有 check 未通过）"
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    exit 1
  fi
fi

# 9. 验证 audit_decision
AUDIT_DECISION=$(jq -r '.audit_decision' "$FILE")
if [[ "$AUDIT_DECISION" != "PASS" ]]; then
  echo "  ❌ audit_decision: $AUDIT_DECISION"
  echo ""
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  echo "  ❌ Evidence Gate 失败（审计未通过）"
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  exit 1
fi

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  ✅ Evidence Gate 通过"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo "  qa_gate_passed: $QA_GATE_PASSED"
echo "  audit_decision: $AUDIT_DECISION"
echo "  checks: $CHECKS_COUNT"
