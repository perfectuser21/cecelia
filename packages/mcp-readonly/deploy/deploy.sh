#!/bin/bash
# packages/mcp-readonly/deploy/deploy.sh
#
# 部署 cecelia-mcp-readonly 为 LaunchDaemon 常驻服务。
#
# REPO_ROOT 指向生产 checkout（/Users/administrator/perfect21/cecelia，与
# packages/brain/deploy/com.cecelia.brain.plist 用的是同一个生产仓库路径），
# 不是开发用的 per-session worktree（worktree 会话结束会被清理，plist 里
# 写死 worktree 路径服务会随 worktree 删除而炸）。
set -euo pipefail

REPO_ROOT="/Users/administrator/perfect21/cecelia"
PLIST_SRC="$REPO_ROOT/packages/mcp-readonly/deploy/com.cecelia.mcp-readonly.plist"
PLIST_DST="/Library/LaunchDaemons/com.cecelia.mcp-readonly.plist"

echo "1. 安装依赖"
cd "$REPO_ROOT/packages/mcp-readonly" && npm install --production

echo "2. 确保日志目录存在"
mkdir -p "$REPO_ROOT/logs"

echo "3. 部署前 smoke：现有 5211/5221 响应时间基线"
curl -s -o /dev/null -w "5211 baseline: %{time_total}s\n" http://localhost:5211/ || true
curl -s -o /dev/null -w "5221 baseline: %{time_total}s\n" http://localhost:5221/health || true

echo "4. 安装 LaunchDaemon"
sudo cp "$PLIST_SRC" "$PLIST_DST"
sudo launchctl bootstrap system "$PLIST_DST" || (sudo launchctl bootout system "$PLIST_DST" && sudo launchctl bootstrap system "$PLIST_DST")

echo "5. 部署后 smoke：确认新服务健康 + 现有服务无劣化"
sleep 2
curl -sf http://localhost:8787/health
curl -s -o /dev/null -w "5211 after: %{time_total}s\n" http://localhost:5211/ || true
curl -s -o /dev/null -w "5221 after: %{time_total}s\n" http://localhost:5221/health || true

echo "部署完成。下一步：在 Cloudflare Zero Trust 后台给现有 Tunnel 加一条 public hostname ingress 规则，指向 localhost:8787"
