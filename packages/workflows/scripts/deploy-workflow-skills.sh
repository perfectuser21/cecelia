#!/usr/bin/env bash
# deploy-workflow-skills.sh — 将 packages/workflows/skills/ 中的 skill 软链接到 account 的 skills 目录
#
# 用法：
#   bash packages/workflows/scripts/deploy-workflow-skills.sh [--dry-run] [--account N]
#
# 说明：
#   - 遍历 packages/workflows/skills/ 下的所有 skill 目录
#   - 在 ~/.claude-accountN/skills/ 下创建同名软链接（指向主仓库绝对路径）
#   - 主仓库路径通过 git rev-parse --git-common-dir 获取（兼容 worktree 调用）
#   - 已存在的软链接：跳过（不覆盖用户手动创建的）
#   - 已存在但非软链接的目录：跳过并警告

set -euo pipefail

# ── 参数解析 ──────────────────────────────────────────────────────────────────
DRY_RUN=false
ACCOUNT_NUM=1

for arg in "$@"; do
  case $arg in
    --dry-run) DRY_RUN=true ;;
    --account=*) ACCOUNT_NUM="${arg#*=}" ;;
    --account) shift; ACCOUNT_NUM="$1" ;;
  esac
done

# ── 路径解析 ──────────────────────────────────────────────────────────────────
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

# 找主仓库根目录（兼容 worktree 和直接调用）
GIT_COMMON=$(git rev-parse --git-common-dir 2>/dev/null || echo ".git")
if [[ "$GIT_COMMON" == ".git" ]]; then
  MAIN_ROOT="$(cd "$SCRIPT_DIR/../../.." && pwd)"
else
  MAIN_ROOT="$(cd "$(dirname "$GIT_COMMON")" && pwd)"
fi

SKILLS_SRC="$MAIN_ROOT/packages/workflows/skills"
ACCOUNT_SKILLS="$HOME/.claude-account${ACCOUNT_NUM}/skills"

echo "=== deploy-workflow-skills.sh ==="
echo "  主仓库:   $MAIN_ROOT"
echo "  Skills源: $SKILLS_SRC"
echo "  部署目标: $ACCOUNT_SKILLS"
[[ "$DRY_RUN" == "true" ]] && echo "  模式:     DRY-RUN（不实际创建）"
echo ""

# ── 校验 ──────────────────────────────────────────────────────────────────────
if [[ ! -d "$SKILLS_SRC" ]]; then
  echo "❌ Skills 源目录不存在: $SKILLS_SRC"
  exit 1
fi

if [[ ! -d "$ACCOUNT_SKILLS" ]]; then
  echo "❌ Account skills 目录不存在: $ACCOUNT_SKILLS"
  exit 1
fi

# ── 遍历并创建软链接 ─────────────────────────────────────────────────────────
CREATED=0
SKIPPED=0
WARNED=0

for skill_dir in "$SKILLS_SRC"/*/; do
  skill_name="$(basename "$skill_dir")"
  target_link="$ACCOUNT_SKILLS/$skill_name"
  # 软链接指向主仓库中的绝对路径（不是 worktree 路径）
  link_src="$MAIN_ROOT/packages/workflows/skills/$skill_name"

  if [[ -L "$target_link" ]]; then
    # 已是软链接，跳过（不管目标是否一致）
    SKIPPED=$((SKIPPED + 1))
    echo "  ⏭  已存在软链接: $skill_name → $(readlink "$target_link")"
  elif [[ -d "$target_link" ]]; then
    # 已是真实目录（非软链接），跳过并警告
    WARNED=$((WARNED + 1))
    echo "  ⚠️  已有真实目录（跳过）: $skill_name"
  else
    # 不存在，创建软链接
    if [[ "$DRY_RUN" == "true" ]]; then
      echo "  [DRY] 创建软链接: $skill_name → $link_src"
    else
      ln -s "$link_src" "$target_link"
      echo "  ✅ 创建软链接: $skill_name → $link_src"
    fi
    CREATED=$((CREATED + 1))
  fi
done

echo ""
echo "=== 完成 ==="
echo "  新建: $CREATED | 跳过(已有软链接): $SKIPPED | 警告(真实目录): $WARNED"
