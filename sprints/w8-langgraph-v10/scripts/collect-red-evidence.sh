#!/bin/bash
# scripts/collect-red-evidence.sh
# Round 2 红证据采集器（Reviewer 现场验证：所有 ws 测试确实红）
#
# 用法：
#   bash sprints/w8-langgraph-v10/scripts/collect-red-evidence.sh
#
# 退出码：
#   0 = 三个 ws 全部"合法红"（numFailedTests 数与合同 Test Contract 表声明一致）
#   1 = 任一 ws 红证据无效（数量不符 / suite 加载失败 / 无法运行）
#
# 实现 ↔ 合同 Test Contract 表声明一致：WS1=2 / WS2=3 / WS3=2
# Generator 实现完成后此脚本会失败（数量从 N → 0），届时改用同目录绿证据脚本/CI 校验
set -u

SPRINT_DIR="sprints/w8-langgraph-v10"
declare -A EXPECTED=(
  ["1:inject-initiative"]="2"
  ["2:wait-lib"]="3"
  ["3:render-report"]="2"
)

OUT_DIR="${OUT_DIR:-/tmp}"
FAILED=0

for key in "1:inject-initiative" "2:wait-lib" "3:render-report"; do
  N="${key%%:*}"
  FILE_BASE="${key##*:}"
  EXPECT="${EXPECTED[$key]}"
  TEST_FILE="${SPRINT_DIR}/tests/ws${N}/${FILE_BASE}.test.ts"
  OUT_JSON="${OUT_DIR}/ws${N}-red.json"

  npx vitest run "${TEST_FILE}" --reporter=json > "${OUT_JSON}" 2>/dev/null || true

  if [ ! -s "${OUT_JSON}" ]; then
    echo "❌ WS${N} 红证据无效：vitest 未产出 JSON（${OUT_JSON} 空或缺失）"
    FAILED=1
    continue
  fi

  if ! jq -e --argjson expect "${EXPECT}" \
       '.success == false and .numFailedTests == $expect and .numPassedTests == 0' \
       "${OUT_JSON}" >/dev/null; then
    ACTUAL=$(jq -c '{success,numFailedTests,numPassedTests}' "${OUT_JSON}" 2>/dev/null || echo "<bad-json>")
    echo "❌ WS${N} 红证据无效：期望 numFailedTests=${EXPECT}/numPassedTests=0/success=false，实际 ${ACTUAL}"
    FAILED=1
    continue
  fi

  echo "✅ WS${N} 红证据合格（numFailedTests=${EXPECT}）"
done

if [ "${FAILED}" -eq 0 ]; then
  echo ""
  echo "✅ Round 2 红证据全部合格（WS1=2 / WS2=3 / WS3=2）"
fi

exit "${FAILED}"
