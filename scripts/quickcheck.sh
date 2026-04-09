#!/usr/bin/env bash
# quickcheck.sh — git push 前本地快速检查
#
# 逻辑：改了哪个包就跑哪个包的测试，4个包全覆盖
# 用法：bash scripts/quickcheck.sh
# 退出码：0 = 通过，1 = 失败

set -uo pipefail

REPO_ROOT="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
cd "$REPO_ROOT"

# worktree 兼容：二进制在主仓库根目录 node_modules/.bin/
_GIT_COMMON_DIR="$(git rev-parse --git-common-dir 2>/dev/null || echo "$REPO_ROOT/.git")"
MAIN_REPO_ROOT="$(dirname "$(cd "$REPO_ROOT" && cd "$_GIT_COMMON_DIR" && pwd)")"
ROOT_NM="$MAIN_REPO_ROOT/node_modules"

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; BOLD='\033[1m'; RESET='\033[0m'

START_TIME=$(date +%s)
echo -e "\n${BOLD}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${RESET}"
echo -e "${BOLD}  🔍 QuickCheck — push 前本地预检${RESET}"
echo -e "${BOLD}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${RESET}\n"

git fetch origin main --quiet 2>/dev/null || true
BASE_REF="origin/main"
CHANGED_FILES=$(git diff --name-only "${BASE_REF}...HEAD" 2>/dev/null || \
                git diff --name-only HEAD~1...HEAD 2>/dev/null || echo "")

if [[ -z "$CHANGED_FILES" ]]; then
  echo -e "${YELLOW}⏭  无改动文件，跳过${RESET}"
  echo -e "${GREEN}${BOLD}✅ QuickCheck 通过${RESET}\n"; exit 0
fi

echo -e "📂 改动文件数：$(echo "$CHANGED_FILES" | grep -c . 2>/dev/null || echo 0)\n"

PASS=true

# 改了哪个包就跑哪个包的测试（4个包全覆盖）
for PKG in packages/engine packages/brain apps/api apps/dashboard; do
  if echo "$CHANGED_FILES" | grep -q "^$PKG/"; then
    echo -e "${BOLD}▶ $PKG${RESET}"
    if [[ ! -x "$ROOT_NM/.bin/vitest" ]]; then
      echo -e "  ${YELLOW}⚠️  vitest 未安装，跳过${RESET}"
    elif (cd "$PKG" && PATH="$ROOT_NM/.bin:$PATH" NODE_OPTIONS='--max-old-space-size=2048' vitest run 2>&1); then
      echo -e "  ${GREEN}✅ 通过${RESET}"
    else
      echo -e "  ${RED}❌ 失败 — 修复后重新 push${RESET}"
      PASS=false
    fi
    echo ""
  fi
done

END_TIME=$(date +%s)
echo -e "${BOLD}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${RESET}"
if [[ "$PASS" == true ]]; then
  echo -e "${GREEN}${BOLD}✅ QuickCheck 通过（耗时 $((END_TIME - START_TIME))s）${RESET}"
else
  echo -e "${RED}${BOLD}❌ QuickCheck 失败 — push 被阻止${RESET}"
  echo -e "${YELLOW}   请修复错误后重新 push${RESET}"
fi
echo -e "${BOLD}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${RESET}\n"

[[ "$PASS" == true ]] && exit 0 || exit 1
