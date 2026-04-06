#!/usr/bin/env bash
# install-git-hooks.sh — 将 scripts/git-hooks/ 安装到 .git/hooks/
#
# 用法：bash scripts/install-git-hooks.sh
#
# 效果：为 scripts/git-hooks/ 下的每个文件创建 .git/hooks/ 对应条目（复制 + 可执行权限）
# 幂等：重复运行安全

set -euo pipefail

REPO_ROOT="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
SRC_DIR="$REPO_ROOT/scripts/git-hooks"
# git worktree 下 hooks 目录在主仓库
GIT_COMMON_DIR="$(git rev-parse --git-common-dir 2>/dev/null || echo "$REPO_ROOT/.git")"
HOOKS_DIR="$GIT_COMMON_DIR/hooks"

if [ ! -d "$SRC_DIR" ]; then
    echo "❌ $SRC_DIR 目录不存在" >&2
    exit 1
fi

mkdir -p "$HOOKS_DIR"

INSTALLED=0
for src in "$SRC_DIR"/*; do
    [ -f "$src" ] || continue
    name=$(basename "$src")
    dst="$HOOKS_DIR/$name"
    cp "$src" "$dst"
    chmod +x "$dst"
    echo "✅ 安装 $name → $dst"
    INSTALLED=$((INSTALLED + 1))
done

echo ""
echo "✅ 共安装 ${INSTALLED} 个 git hook"
echo "   提示：git push --no-verify 可跳过 quickcheck"
