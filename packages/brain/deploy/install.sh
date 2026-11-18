#!/usr/bin/env bash
# install.sh — 安装 cecelia-run 链接
# 运行：sudo bash packages/brain/deploy/install.sh
#
# 安装内容：
#   1. ~/bin/cecelia-run → symlink 指向 git 源文件

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
GIT_SCRIPT="$REPO_ROOT/packages/brain/scripts/cecelia-run.sh"
SYMLINK="/Users/administrator/bin/cecelia-run"

echo "=== Cecelia Brain 安装脚本 ==="
echo "REPO_ROOT: $REPO_ROOT"

# 1. 确保 git 源文件可执行
chmod +x "$GIT_SCRIPT"
echo "✅ cecelia-run.sh 已设置可执行权限"

# 2. 创建/更新 symlink
mkdir -p "$(dirname "$SYMLINK")"
if [[ -L "$SYMLINK" ]]; then
  rm "$SYMLINK"
elif [[ -f "$SYMLINK" ]]; then
  echo "⚠️  备份旧的 ~/bin/cecelia-run 到 ~/bin/cecelia-run.bak"
  mv "$SYMLINK" "${SYMLINK}.bak"
fi
ln -s "$GIT_SCRIPT" "$SYMLINK"
echo "✅ symlink 创建：$SYMLINK → $GIT_SCRIPT"

echo ""
echo "=== 安装完成 ==="
echo "CECELIA_RUN_PATH 现在指向: $GIT_SCRIPT"
echo "~/bin/cecelia-run 是 symlink，指向同一文件"
