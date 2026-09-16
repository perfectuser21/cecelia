#!/usr/bin/env bash
# preview-agent-install.sh — 把 MMV 预览代理装成常驻服务
#
# 为什么是 LaunchAgent 而不是 nohup：2026 年多次事故（zenithjoy-api / staging）都栽在
# "手起的进程没人拉"——机器重启、进程崩溃后无人知晓，等到用时才发现早就死了。
# 常驻服务必须交给系统托管（KeepAlive），并且有办法验证它真活着。
#
# 为什么是 LaunchAgent（用户域）而不是 LaunchDaemon（系统域）：
# 代理要读 ~/.credentials、跑 git/npm/psql，全部依赖当前用户的环境与权限；
# 系统域跑会因为 HOME/PATH/keychain 不对而以各种隐蔽方式失败。
#
# 用法：bash scripts/preview-agent-install.sh
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
LABEL="com.cecelia.preview-agent"
PLIST="$HOME/Library/LaunchAgents/${LABEL}.plist"

# 代理必须跑在部署根（主 checkout），与 capacity-gate 同一个 repo——
# 否则 capacity-gate 按自己的位置算 REPO_ROOT，会去另一个目录找采样文件，
# 报 sample_missing（2026-09-17 在 worktree 里实测到过这个差异）。
if [[ "$REPO_ROOT" != "/Users/administrator/perfect21/cecelia" ]]; then
  echo "⚠️  当前不在部署根（${REPO_ROOT}）"
  echo "   代理必须与 capacity-gate 同 repo，请在 /Users/administrator/perfect21/cecelia 下执行"
  exit 1
fi

if [[ -z "${DEPLOY_TOKEN:-}" ]]; then
  echo "❌ 缺 DEPLOY_TOKEN —— 必须与 GitHub Actions 的 DEPLOY_TOKEN secret 同值"
  echo "   取法：source ~/.credentials/<对应文件>.env 后重跑"
  exit 1
fi

mkdir -p "$HOME/Library/LaunchAgents" "$HOME/Library/Logs"

cat > "$PLIST" <<PLISTEOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>${LABEL}</string>
  <key>ProgramArguments</key>
  <array>
    <string>/usr/bin/env</string>
    <string>node</string>
    <string>${REPO_ROOT}/scripts/preview-agent.mjs</string>
  </array>
  <key>WorkingDirectory</key><string>${REPO_ROOT}</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>DEPLOY_TOKEN</key><string>${DEPLOY_TOKEN}</string>
    <key>PREVIEW_AGENT_PORT</key><string>5241</string>
    <!-- 绑 Tailscale 地址：CI 经内网进来，不暴露公网 -->
    <key>PREVIEW_AGENT_HOST</key><string>100.71.151.105</string>
    <!-- 代理自身连的库。db-config.js 默认连 'cecelia'，而执行机上根本没有这个库
         （生产库在 us-vps）——不注入这项，/preview/start 会 500
         database "cecelia" does not exist（2026-09-17 实测）。
         preview_environments 记录就落在这个库里。 -->
    <key>DB_NAME</key><string>cecelia_staging</string>
    <!-- 克隆源：执行机上没有生产库 cecelia，用 staging（schema 443 > 最低要求 430） -->
    <key>PREVIEW_SOURCE_DB</key><string>cecelia_staging</string>
    <key>PATH</key><string>/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin</string>
  </dict>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>StandardOutPath</key><string>${HOME}/Library/Logs/preview-agent.log</string>
  <key>StandardErrorPath</key><string>${HOME}/Library/Logs/preview-agent.err</string>
</dict>
</plist>
PLISTEOF

chmod 600 "$PLIST"
launchctl bootout "gui/$(id -u)/${LABEL}" 2>/dev/null || true
launchctl bootstrap "gui/$(id -u)" "$PLIST"
launchctl kickstart -k "gui/$(id -u)/${LABEL}"

echo "✅ 已装载 ${LABEL}"
echo "   验证：curl -s http://100.71.151.105:5241/api/brain/health"
echo "   日志：~/Library/Logs/preview-agent.log"
