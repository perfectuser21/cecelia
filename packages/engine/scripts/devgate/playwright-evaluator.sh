#!/usr/bin/env bash
# ============================================================================
# playwright-evaluator.sh — Playwright Evaluator（Stage 3 CI 通过后）
# ============================================================================
# 从 Task Card 提取 [BEHAVIOR] 条目的 Test 字段，逐条执行验证。
# 内置 Brain API /health 健康检查。
#
# 用法：
#   bash playwright-evaluator.sh <TASK_CARD_PATH> <BRANCH> [PROJECT_ROOT]
#
# 返回码：
#   0 - 全部通过
#   1 - 有失败
#   2 - 参数错误
#
# seal 文件输出：
#   .dev-gate-evaluator.{branch}（JSON: verdict/branch/timestamp/issues）
# ============================================================================

set -euo pipefail

# ===== 参数 =====
TASK_CARD_PATH="${1:-}"
BRANCH="${2:-}"
PROJECT_ROOT="${3:-$(git rev-parse --show-toplevel 2>/dev/null || pwd)}"

if [[ -z "$TASK_CARD_PATH" || -z "$BRANCH" ]]; then
    echo "用法: playwright-evaluator.sh <TASK_CARD_PATH> <BRANCH> [PROJECT_ROOT]" >&2
    exit 2
fi

if [[ ! -f "$TASK_CARD_PATH" ]]; then
    echo "错误: Task Card 不存在: $TASK_CARD_PATH" >&2
    exit 2
fi

# ===== 常量 =====
SEAL_FILE="${PROJECT_ROOT}/.dev-gate-evaluator.${BRANCH}"
BRAIN_URL="${BRAIN_URL:-http://localhost:5221}"
PASS_COUNT=0
FAIL_COUNT=0
SKIP_COUNT=0
ISSUES=()

# ===== 颜色 =====
RED="\033[31m"
GREEN="\033[32m"
YELLOW="\033[33m"
RESET="\033[0m"

# ===== Brain /health 健康检查 =====
echo "=========================================="
echo "Playwright Evaluator — 开始验证"
echo "=========================================="
echo ""
echo "--- Brain API 健康检查 ---"

HEALTH_STATUS=$(curl -s -o /dev/null -w "%{http_code}" "${BRAIN_URL}/health" --max-time 5 2>/dev/null || echo "000")
if [[ "$HEALTH_STATUS" == "200" ]]; then
    echo -e "${GREEN}PASS${RESET}: Brain API /health 返回 200"
    PASS_COUNT=$((PASS_COUNT + 1))
else
    echo -e "${YELLOW}SKIP${RESET}: Brain API /health 不可达（HTTP ${HEALTH_STATUS}），跳过在线验证"
    SKIP_COUNT=$((SKIP_COUNT + 1))
    # Brain 不可达不算失败（CI 环境无 Brain）
fi

echo ""
echo "--- 提取 [BEHAVIOR] 条目 ---"

# ===== 从 Task Card 提取 [BEHAVIOR] 条目 =====
# 格式: - [x] [BEHAVIOR] 描述\n  Test: <command>
BEHAVIOR_TESTS=()
IN_BEHAVIOR=false
CURRENT_DESC=""

while IFS= read -r line; do
    # 匹配 [BEHAVIOR] 条目行
    if echo "$line" | grep -qE '^\s*-\s+\[.\]\s+\[BEHAVIOR\]'; then
        IN_BEHAVIOR=true
        CURRENT_DESC=$(echo "$line" | sed 's/.*\[BEHAVIOR\][[:space:]]*//')
        continue
    fi

    # 如果在 BEHAVIOR 条目内，查找 Test 字段
    if [[ "$IN_BEHAVIOR" == true ]]; then
        if echo "$line" | grep -qE '^\s+Test:\s+'; then
            TEST_CMD=$(echo "$line" | sed 's/.*Test:[[:space:]]*//')
            BEHAVIOR_TESTS+=("${CURRENT_DESC}|||${TEST_CMD}")
            IN_BEHAVIOR=false
            CURRENT_DESC=""
        elif echo "$line" | grep -qE '^\s*-\s+\['; then
            # 新条目开始，上一个 BEHAVIOR 没有 Test
            IN_BEHAVIOR=false
            CURRENT_DESC=""
            # 重新检查这行是否也是 BEHAVIOR
            if echo "$line" | grep -qE '^\s*-\s+\[.\]\s+\[BEHAVIOR\]'; then
                IN_BEHAVIOR=true
                CURRENT_DESC=$(echo "$line" | sed 's/.*\[BEHAVIOR\][[:space:]]*//')
            fi
        fi
    fi
done < "$TASK_CARD_PATH"

TOTAL=${#BEHAVIOR_TESTS[@]}
echo "找到 ${TOTAL} 条 [BEHAVIOR] Test 命令"
echo ""

if [[ $TOTAL -eq 0 ]]; then
    echo -e "${YELLOW}WARNING${RESET}: Task Card 中无 [BEHAVIOR] Test 条目，跳过验证"
    # 无条目不算失败，写入 PASS seal
    TIMESTAMP=$(TZ=Asia/Shanghai date +%Y-%m-%dT%H:%M:%S+08:00 2>/dev/null || date -u +%Y-%m-%dT%H:%M:%SZ)
    cat > "$SEAL_FILE" <<EOF
{
  "verdict": "PASS",
  "branch": "${BRANCH}",
  "timestamp": "${TIMESTAMP}",
  "total": 0,
  "passed": ${PASS_COUNT},
  "failed": 0,
  "skipped": ${SKIP_COUNT},
  "issues": [],
  "note": "no BEHAVIOR tests found in task card"
}
EOF
    echo ""
    echo "seal 文件已写入: ${SEAL_FILE}"
    exit 0
fi

# ===== 逐条执行 Test 命令 =====
echo "--- 执行验证 ---"
INDEX=0

for entry in "${BEHAVIOR_TESTS[@]}"; do
    INDEX=$((INDEX + 1))
    DESC="${entry%%|||*}"
    TEST_CMD="${entry##*|||}"

    echo ""
    echo "[$INDEX/$TOTAL] ${DESC}"
    echo "  命令: ${TEST_CMD}"

    # 解析 Test 命令类型
    if echo "$TEST_CMD" | grep -qE '^manual:'; then
        ACTUAL_CMD="${TEST_CMD#manual:}"
    elif echo "$TEST_CMD" | grep -qE '^tests/'; then
        # 测试文件引用 — 检查文件存在即可（实际测试由 CI 执行）
        if [[ -f "${PROJECT_ROOT}/${TEST_CMD}" ]]; then
            echo -e "  ${GREEN}PASS${RESET}: 测试文件存在"
            PASS_COUNT=$((PASS_COUNT + 1))
        else
            echo -e "  ${RED}FAIL${RESET}: 测试文件不存在: ${TEST_CMD}"
            FAIL_COUNT=$((FAIL_COUNT + 1))
            ISSUES+=("测试文件不存在: ${TEST_CMD}")
        fi
        continue
    elif echo "$TEST_CMD" | grep -qE '^contract:'; then
        # contract 引用 — 跳过（由 RCI 系统处理）
        echo -e "  ${YELLOW}SKIP${RESET}: contract 引用，由 RCI 系统验证"
        SKIP_COUNT=$((SKIP_COUNT + 1))
        continue
    else
        ACTUAL_CMD="$TEST_CMD"
    fi

    # 执行命令（在 PROJECT_ROOT 目录下）
    if (cd "$PROJECT_ROOT" && eval "$ACTUAL_CMD") > /dev/null 2>&1; then
        echo -e "  ${GREEN}PASS${RESET}"
        PASS_COUNT=$((PASS_COUNT + 1))
    else
        echo -e "  ${RED}FAIL${RESET}"
        FAIL_COUNT=$((FAIL_COUNT + 1))
        ISSUES+=("验证失败: ${DESC} (命令: ${TEST_CMD})")
    fi
done

# ===== 汇总 =====
echo ""
echo "=========================================="
echo "验证完成: ${PASS_COUNT} pass / ${FAIL_COUNT} fail / ${SKIP_COUNT} skip"
echo "=========================================="

# ===== 写入 seal 文件 =====
TIMESTAMP=$(TZ=Asia/Shanghai date +%Y-%m-%dT%H:%M:%S+08:00 2>/dev/null || date -u +%Y-%m-%dT%H:%M:%SZ)

if [[ $FAIL_COUNT -eq 0 ]]; then
    VERDICT="PASS"
else
    VERDICT="FAIL"
fi

# 构建 issues JSON 数组
ISSUES_JSON="["
for i in "${!ISSUES[@]}"; do
    [[ $i -gt 0 ]] && ISSUES_JSON+=","
    # 转义双引号
    ESCAPED=$(echo "${ISSUES[$i]}" | sed 's/"/\\"/g')
    ISSUES_JSON+="\"${ESCAPED}\""
done
ISSUES_JSON+="]"

cat > "$SEAL_FILE" <<EOF
{
  "verdict": "${VERDICT}",
  "branch": "${BRANCH}",
  "timestamp": "${TIMESTAMP}",
  "total": ${TOTAL},
  "passed": ${PASS_COUNT},
  "failed": ${FAIL_COUNT},
  "skipped": ${SKIP_COUNT},
  "issues": ${ISSUES_JSON}
}
EOF

echo ""
echo "seal 文件已写入: ${SEAL_FILE}"

if [[ $FAIL_COUNT -gt 0 ]]; then
    echo -e "${RED}有 ${FAIL_COUNT} 条验证失败${RESET}"
    exit 1
else
    echo -e "${GREEN}全部通过${RESET}"
    exit 0
fi
