#!/usr/bin/env bash
# 安装全局 git pre-commit hook
# 执行一次，之后所有 git repo 的 commit 都受保护
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CECELIA_HOOKS="$SCRIPT_DIR/../packages/engine/hooks"
GIT_HOOKS_DIR="$HOME/.git-hooks"

echo "安装全局 git pre-commit hook..."

mkdir -p "$GIT_HOOKS_DIR"
ln -sf "$(realpath "$CECELIA_HOOKS/pre-commit")" "$GIT_HOOKS_DIR/pre-commit"
chmod +x "$GIT_HOOKS_DIR/pre-commit"
git config --global core.hooksPath "$GIT_HOOKS_DIR"

echo ""
echo "✅ 安装完成"
echo "   core.hooksPath → $GIT_HOOKS_DIR"
echo "   pre-commit → $(realpath "$CECELIA_HOOKS/pre-commit")"
echo ""
echo "验证："
echo "  git config --global core.hooksPath"
echo "  ls -la $GIT_HOOKS_DIR"
