#!/usr/bin/env bash
# dod-execution-gate.sh
#
# DoD Execution Gate — 实际执行 Task Card 中 [BEHAVIOR] 条目的 Test 命令
#
# 用法:
#   bash scripts/devgate/dod-execution-gate.sh [task-card-file]
#   bash scripts/devgate/dod-execution-gate.sh --help
#
# 默认: 自动寻找 .task-cp-*.md 文件（优先按 GITHUB_HEAD_REF 或当前分支查找）
#
# 执行策略:
#   manual:bash <cmd>   → 直接执行 bash 命令
#   manual:node <cmd>   → 直接执行 node 命令
#   manual:curl ...     → DEFERRED（需要服务，跳过）
#   manual:chrome:...   → DEFERRED（需要浏览器，跳过）
#   tests/<path>        → 检查文件是否存在于项目中
#   contract:<id>       → DEFERRED（合约验证，跳过执行）
#
# 退出码:
#   0 - 所有可执行 Test 通过（DEFERRED 不算失败）
#   1 - 至少一个 Test 执行失败
#   2 - Task Card 文件无效（传入参数时）

set -euo pipefail

# ─── 颜色 ───────────────────────────────────────────────────────────────────
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

# ─── 帮助 ───────────────────────────────────────────────────────────────────
if [[ "${1:-}" == "--help" || "${1:-}" == "-h" ]]; then
  echo "DoD Execution Gate"
  echo "用法: bash scripts/devgate/dod-execution-gate.sh [task-card-file]"
  echo ""
  echo "执行策略:"
  echo "  manual:bash/node  → 直接执行"
  echo "  manual:curl       → DEFERRED（需要运行服务）"
  echo "  manual:chrome:    → DEFERRED（需要浏览器）"
  echo "  tests/<path>      → 检查文件存在性"
  echo "  contract:<id>     → DEFERRED（合约验证）"
  echo ""
  echo "只执行 [BEHAVIOR] 条目的 Test，[ARTIFACT] 和 [GATE] 跳过。"
  exit 0
fi

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  DoD Execution Gate"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

# ─── 定位 Task Card 文件 ────────────────────────────────────────────────────
TASK_CARD=""

if [[ -n "${1:-}" && "${1:-}" != "--"* ]]; then
  # 显式传入文件路径
  TASK_CARD="$1"
  if [[ ! -f "$TASK_CARD" ]]; then
    echo -e "${RED}❌ 指定的文件不存在: $TASK_CARD${NC}"
    exit 2
  fi
else
  # 自动寻找，优先用 GITHUB_HEAD_REF（CI 传入）
  if [[ -n "${GITHUB_HEAD_REF:-}" ]]; then
    CANDIDATE=".task-${GITHUB_HEAD_REF}.md"
    if [[ -f "$CANDIDATE" ]]; then
      TASK_CARD="$CANDIDATE"
    fi
  fi

  # 按当前 git 分支查找
  if [[ -z "$TASK_CARD" ]]; then
    CURRENT_BRANCH=$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo "")
    if [[ -n "$CURRENT_BRANCH" && -f ".task-${CURRENT_BRANCH}.md" ]]; then
      TASK_CARD=".task-${CURRENT_BRANCH}.md"
    fi
  fi

  # Glob 匹配（取第一个）
  if [[ -z "$TASK_CARD" ]]; then
    FOUND=$(ls .task-cp-*.md 2>/dev/null | head -1 || true)
    if [[ -n "$FOUND" ]]; then
      TASK_CARD="$FOUND"
    fi
  fi
fi

if [[ -z "$TASK_CARD" ]]; then
  echo -e "${YELLOW}⚠️  未找到 Task Card 文件（.task-cp-*.md），跳过执行${NC}"
  echo ""
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  echo -e "  ${GREEN}✅ DoD Execution Gate PASSED (no task card)${NC}"
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  exit 0
fi

echo "Task Card: $TASK_CARD"
echo ""

# ─── 解析并执行 [BEHAVIOR] 条目 ─────────────────────────────────────────────
# 格式示例（已勾选或未勾选均执行）:
#   - [ ] [BEHAVIOR] 描述文字
#     Test: manual:bash -c "grep -c 'pattern' file"
#
# 脚本逐行读取，状态机跟踪 IN_BEHAVIOR 标志

TOTAL=0
PASSED=0
FAILED=0
DEFERRED=0
FAILED_ITEMS=()

IN_BEHAVIOR=false
BEHAVIOR_DESC=""

while IFS= read -r line; do
  # ─── 检测新条目行（重置状态）────────────────────────────────────────────
  if echo "$line" | grep -qE '^\s*-\s+\[(x| )\]\s+\['; then
    # 重置 IN_BEHAVIOR（遇到新条目头部）
    IN_BEHAVIOR=false
    BEHAVIOR_DESC=""

    # 判断是否是 [BEHAVIOR] 条目
    if echo "$line" | grep -qE '^\s*-\s+\[(x| )\]\s+\[BEHAVIOR\]'; then
      IN_BEHAVIOR=true
      BEHAVIOR_DESC=$(echo "$line" | sed 's/^[[:space:]]*-[[:space:]]*\[.\][[:space:]]*\[BEHAVIOR\][[:space:]]*//')
    fi
    continue
  fi

  # ─── 在 [BEHAVIOR] 条目内：检测 Test: 行 ──────────────────────────────
  if [[ "$IN_BEHAVIOR" == true ]]; then
    if echo "$line" | grep -qE '^[[:space:]]+Test:[[:space:]]+'; then
      TEST_REF=$(echo "$line" | sed 's/^[[:space:]]*Test:[[:space:]]*//')
      TOTAL=$((TOTAL + 1))

      echo -e "  ${CYAN}[BEHAVIOR]${NC} $BEHAVIOR_DESC"
      echo "  Test: $TEST_REF"

      # ── 执行策略 ──────────────────────────────────────────────────────

      # 1. DEFERRED: manual:curl（需要服务）
      if echo "$TEST_REF" | grep -qE '^manual:curl\b'; then
        echo -e "  ${YELLOW}⏭  DEFERRED${NC} (需要运行服务: curl)"
        DEFERRED=$((DEFERRED + 1))
        echo ""
        IN_BEHAVIOR=false
        continue
      fi

      # 2. DEFERRED: manual:chrome:（需要浏览器）
      if echo "$TEST_REF" | grep -qE '^manual:chrome:'; then
        echo -e "  ${YELLOW}⏭  DEFERRED${NC} (需要浏览器: chrome)"
        DEFERRED=$((DEFERRED + 1))
        echo ""
        IN_BEHAVIOR=false
        continue
      fi

      # 3. DEFERRED: contract:（合约验证，无需执行）
      if echo "$TEST_REF" | grep -qE '^contract:'; then
        echo -e "  ${YELLOW}⏭  DEFERRED${NC} (合约验证，跳过执行)"
        DEFERRED=$((DEFERRED + 1))
        echo ""
        IN_BEHAVIOR=false
        continue
      fi

      # 4. tests/<path> → 检查文件存在性
      if echo "$TEST_REF" | grep -qE '^tests/'; then
        TEST_PATH="$TEST_REF"
        if [[ -f "$TEST_PATH" ]]; then
          echo -e "  ${GREEN}✅ PASS${NC} (文件存在: $TEST_PATH)"
          PASSED=$((PASSED + 1))
        else
          echo -e "  ${RED}❌ FAIL${NC} (文件不存在: $TEST_PATH)"
          FAILED=$((FAILED + 1))
          FAILED_ITEMS+=("[BEHAVIOR] $BEHAVIOR_DESC → 文件不存在: $TEST_PATH")
        fi
        echo ""
        IN_BEHAVIOR=false
        continue
      fi

      # 5. manual:<cmd> → 提取并执行命令
      if echo "$TEST_REF" | grep -qE '^manual:'; then
        CMD=$(echo "$TEST_REF" | sed 's/^manual://')

        # 再次判断是否为服务依赖命令（兜底）
        if echo "$CMD" | grep -qE '\bcurl\b|\bchrome\b|\bselenium\b|\bpuppeteer\b'; then
          echo -e "  ${YELLOW}⏭  DEFERRED${NC} (需要外部服务)"
          DEFERRED=$((DEFERRED + 1))
          echo ""
          IN_BEHAVIOR=false
          continue
        fi

        set +e
        OUTPUT=$(eval "$CMD" 2>&1)
        EXIT_CODE=$?
        set -e

        if [[ $EXIT_CODE -eq 0 ]]; then
          echo -e "  ${GREEN}✅ PASS${NC} (exit 0)"
          if [[ -n "$OUTPUT" ]]; then
            echo "  输出: $(echo "$OUTPUT" | head -2)"
          fi
          PASSED=$((PASSED + 1))
        else
          echo -e "  ${RED}❌ FAIL${NC} (exit $EXIT_CODE)"
          if [[ -n "$OUTPUT" ]]; then
            echo "  输出: $(echo "$OUTPUT" | head -3)"
          fi
          FAILED=$((FAILED + 1))
          FAILED_ITEMS+=("[BEHAVIOR] $BEHAVIOR_DESC → exit $EXIT_CODE: $CMD")
        fi
        echo ""
        IN_BEHAVIOR=false
        continue
      fi

      # 6. 未匹配的格式：DEFERRED（保守处理）
      echo -e "  ${YELLOW}⏭  DEFERRED${NC} (未知格式，跳过: $TEST_REF)"
      DEFERRED=$((DEFERRED + 1))
      echo ""
      IN_BEHAVIOR=false
    fi
  fi
done < "$TASK_CARD"

# ─── 汇总结果 ───────────────────────────────────────────────────────────────
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  结果汇总"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  [BEHAVIOR] Test 总数: $TOTAL"
echo -e "  ${GREEN}✅ 通过: $PASSED${NC}"
echo -e "  ${YELLOW}⏭  延迟: $DEFERRED${NC} (curl/chrome/contract 等服务相关)"
echo -e "  ${RED}❌ 失败: $FAILED${NC}"

if [[ $TOTAL -eq 0 ]]; then
  echo ""
  echo -e "  ${YELLOW}⚠️  Task Card 中无 [BEHAVIOR] 条目，跳过执行${NC}"
fi

if [[ $FAILED -gt 0 ]]; then
  echo ""
  echo "失败详情:"
  for item in "${FAILED_ITEMS[@]}"; do
    echo -e "  ${RED}❌${NC} $item"
  done
  echo ""
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  echo -e "  ${RED}❌ DoD Execution Gate FAILED${NC} ($FAILED/$TOTAL 条目失败)"
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  exit 1
fi

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo -e "  ${GREEN}✅ DoD Execution Gate PASSED${NC}"
if [[ $DEFERRED -gt 0 ]]; then
  echo "  注: $DEFERRED 条 DEFERRED（服务相关命令已跳过，需人工验证）"
fi
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
exit 0
