#!/usr/bin/env bash
# quickcheck.sh — git pre-push 本地快速检查（60s 内完成）
#
# 检查项（仅针对变更包）：
#   1. TypeCheck  — packages/engine, apps/api（tsc --noEmit）
#   2. ESLint     — packages/brain, apps/api
#   3. Unit test  — packages/engine（parallel 组，无 shell 依赖，可并行）
#
# 用法：
#   bash scripts/quickcheck.sh
#
# 退出码：
#   0 — 通过（或无变更 / node_modules 未安装则跳过）
#   1 — 失败

set -euo pipefail

REPO_ROOT="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
cd "$REPO_ROOT"

START_TIME=$(date +%s)
PASS=true
BASE_REF="origin/main"

GREEN='\033[0;32m'; RED='\033[0;31m'; YELLOW='\033[1;33m'; BOLD='\033[1m'; RESET='\033[0m'

echo ""
echo -e "${BOLD}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${RESET}"
echo -e "${BOLD}  Quickcheck（TypeCheck + ESLint + Test）${RESET}"
echo -e "${BOLD}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${RESET}"
echo ""

# ── 获取变更文件列表 ────────────────────────────────────────────────────────
git fetch origin main --quiet 2>/dev/null || true
CHANGED=$(git diff --name-only "${BASE_REF}...HEAD" 2>/dev/null || echo "")

if [ -z "$CHANGED" ]; then
    echo -e "${GREEN}✅ 无变更，跳过 quickcheck${RESET}"
    echo ""
    exit 0
fi

# ── 检测变更包 ────────────────────────────────────────────────────────────
pkg_changed() { echo "$CHANGED" | grep -qE "^$1" && echo true || echo false; }

ENGINE_CHANGED=$(pkg_changed "packages/engine/")
BRAIN_CHANGED=$(pkg_changed "packages/brain/")
API_CHANGED=$(pkg_changed "apps/api/")

echo -e "变更包: engine=${ENGINE_CHANGED} brain=${BRAIN_CHANGED} api=${API_CHANGED}"
echo ""

# ── 运行单项检查 ───────────────────────────────────────────────────────────
# $1=名称 $2=工作目录 $3=命令 $4=超时秒数
run_check() {
    local name="$1" pkg_dir="$2" cmd="$3" timeout_s="${4:-25}"
    echo -e "${BOLD}► $name${RESET}"
    local output exit_code=0
    output=$(cd "$REPO_ROOT/$pkg_dir" && timeout "$timeout_s" bash -c "$cmd" 2>&1) || exit_code=$?
    if [ $exit_code -eq 124 ]; then
        echo -e "  ${RED}❌ $name 超时（>${timeout_s}s）${RESET}"
        PASS=false
    elif [ $exit_code -ne 0 ]; then
        echo "$output" | sed 's/^/  /'
        echo -e "  ${RED}❌ $name 失败${RESET}"
        PASS=false
    else
        echo -e "  ${GREEN}✅ $name 通过${RESET}"
    fi
    echo ""
}

# ── TypeCheck ─────────────────────────────────────────────────────────────
if [ "$ENGINE_CHANGED" = "true" ]; then
    if [ -f "packages/engine/node_modules/.bin/tsc" ]; then
        run_check "TypeCheck: packages/engine" "packages/engine" "npx tsc --noEmit"
    else
        echo -e "${YELLOW}⏭  TypeCheck engine: node_modules 未安装，跳过${RESET}"
        echo ""
    fi
fi

if [ "$API_CHANGED" = "true" ]; then
    if [ -f "apps/api/node_modules/.bin/tsc" ]; then
        run_check "TypeCheck: apps/api" "apps/api" "npx tsc --noEmit"
    else
        echo -e "${YELLOW}⏭  TypeCheck api: node_modules 未安装，跳过${RESET}"
        echo ""
    fi
fi

# ── ESLint ────────────────────────────────────────────────────────────────
if [ "$BRAIN_CHANGED" = "true" ]; then
    if [ -f "packages/brain/node_modules/.bin/eslint" ]; then
        run_check "ESLint: packages/brain" "packages/brain" "npx eslint src/ --max-warnings=0"
    else
        echo -e "${YELLOW}⏭  ESLint brain: node_modules 未安装，跳过${RESET}"
        echo ""
    fi
fi

if [ "$API_CHANGED" = "true" ]; then
    if [ -f "apps/api/node_modules/.bin/eslint" ]; then
        run_check "ESLint: apps/api" "apps/api" "npx eslint src --ext .ts --max-warnings=0"
    else
        echo -e "${YELLOW}⏭  ESLint api: node_modules 未安装，跳过${RESET}"
        echo ""
    fi
fi

# ── Unit Test（仅 engine parallel 组，速度快）────────────────────────────
if [ "$ENGINE_CHANGED" = "true" ]; then
    if [ -f "packages/engine/node_modules/.bin/vitest" ]; then
        run_check "Tests: packages/engine (parallel)" "packages/engine" \
            "NODE_OPTIONS='--max-old-space-size=2048' npx vitest run --project=parallel --reporter=verbose" 40
    else
        echo -e "${YELLOW}⏭  Tests engine: node_modules 未安装，跳过${RESET}"
        echo ""
    fi
fi

# ── 结果汇总 ──────────────────────────────────────────────────────────────
END_TIME=$(date +%s)
ELAPSED=$((END_TIME - START_TIME))

echo -e "${BOLD}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${RESET}"
if [ "$PASS" = "true" ]; then
    echo -e "${GREEN}${BOLD}✅ Quickcheck 全部通过（${ELAPSED}s）${RESET}"
    echo -e "${BOLD}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${RESET}"
    echo ""
    exit 0
else
    echo -e "${RED}${BOLD}❌ Quickcheck 失败（${ELAPSED}s），请修复后再 push${RESET}"
    echo -e "${BOLD}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${RESET}"
    echo ""
    exit 1
fi
