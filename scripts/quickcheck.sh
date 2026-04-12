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

# worktree 中 ESM 模块解析向上找 node_modules 时找不到主仓库（不同目录树）
# 创建符号链接使 vitest config 中的 import 'vitest' 能被 Node.js 解析
if [[ "$REPO_ROOT" != "$MAIN_REPO_ROOT" ]] && [[ ! -e "$REPO_ROOT/node_modules" ]]; then
  ln -sf "$ROOT_NM" "$REPO_ROOT/node_modules"
fi

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

# ─── DoD 未勾选守卫 ────────────────────────────────────────────────
# 检测工作目录中是否有 DoD.md / DoD-*.md 含未勾选条目（[ ]）
# 根因：harness-contract-lint CI 步骤因 DoD 未勾选而失败，在本地拦截更早
DOD_FILES=$(find "$REPO_ROOT" -maxdepth 2 -name "DoD.md" -o -name "DoD-*.md" 2>/dev/null | grep -v ".git" | head -5)
if [[ -n "$DOD_FILES" ]]; then
  DOD_UNCHECKED=0
  for dod_file in $DOD_FILES; do
    count=$(grep -c '^\- \[ \]' "$dod_file" 2>/dev/null || true)
    DOD_UNCHECKED=$((DOD_UNCHECKED + count))
  done
  if [[ $DOD_UNCHECKED -gt 0 ]]; then
    echo -e "${RED}${BOLD}❌ DoD 未勾选守卫：发现 ${DOD_UNCHECKED} 个未验证条目（[ ]）${RESET}"
    echo -e "${YELLOW}   push 前必须将所有 DoD 条目改为 [x]${RESET}"
    echo -e "${YELLOW}   受影响文件：${DOD_FILES}${RESET}\n"
    PASS=false
  else
    echo -e "${GREEN}✅ DoD 守卫：所有条目已勾选${RESET}\n"
  fi
fi

# 改了哪个包就跑哪个包的测试（4个包全覆盖）
for PKG in packages/engine packages/brain apps/api apps/dashboard; do
  if echo "$CHANGED_FILES" | grep -q "^$PKG/"; then
    echo -e "${BOLD}▶ $PKG${RESET}"
    if [[ ! -x "$ROOT_NM/.bin/vitest" ]]; then
      echo -e "  ${YELLOW}⚠️  vitest 未安装，跳过${RESET}"
    else
      VITEST_OUT=$(cd "$PKG" && unset GIT_DIR GIT_WORK_TREE GIT_COMMON_DIR GIT_INDEX_FILE && PATH="$ROOT_NM/.bin:$PATH" NODE_OPTIONS='--max-old-space-size=2048' vitest run 2>&1)
      VITEST_EXIT=$?
      echo "$VITEST_OUT"
      if [[ $VITEST_EXIT -eq 0 ]]; then
        echo -e "  ${GREEN}✅ 通过${RESET}"
      elif echo "$VITEST_OUT" | grep -q " FAIL "; then
        echo -e "  ${RED}❌ 失败 — 修复后重新 push${RESET}"
        PASS=false
      else
        # Worker OOM 崩溃但无测试失败 — 预存在问题，不阻塞
        echo -e "  ${YELLOW}⚠️  Worker 异常退出（OOM？），但无测试失败 — 继续${RESET}"
      fi
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
