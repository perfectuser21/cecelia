#!/usr/bin/env bash
# install.sh — 将 cecelia-run.sh 和 plist 安装到系统
# 运行：sudo bash packages/brain/deploy/install.sh
#
# 做三件事：
#   1. ~/bin/cecelia-run → symlink 指向 git 源文件
#   2. 安装 plist 到 /Library/LaunchDaemons/（需要 root）
#   3. 重新加载 launchd 服务

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
GIT_SCRIPT="$REPO_ROOT/packages/brain/scripts/cecelia-run.sh"
PLIST_SRC="$REPO_ROOT/packages/brain/deploy/com.cecelia.brain.plist"
PLIST_DST="/Library/LaunchDaemons/com.cecelia.brain.plist"
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

# 3. 安装 plist（需要 root）
if [[ "$(id -u)" != "0" ]]; then
  echo "❌ 安装 plist 需要 root 权限，请用 sudo 运行此脚本"
  exit 1
fi

cp "$PLIST_SRC" "$PLIST_DST"
chown root:wheel "$PLIST_DST"
chmod 644 "$PLIST_DST"
echo "✅ plist 已安装：$PLIST_DST"

# 4. 重新加载服务
if launchctl list com.cecelia.brain &>/dev/null; then
  launchctl unload "$PLIST_DST" 2>/dev/null || true
  echo "✅ 旧服务已卸载"
fi
launchctl load "$PLIST_DST"
echo "✅ 服务已重新加载"

echo ""
echo "=== 安装完成 ==="
echo "CECELIA_RUN_PATH 现在指向: $GIT_SCRIPT"
echo "~/bin/cecelia-run 是 symlink，指向同一文件"
echo "Brain 服务已重启"
