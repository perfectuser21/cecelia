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
# 部署令牌不进 plist（任务 6f937566）：plist 只写 DEPLOY_TOKEN_FILE 路径，代理启动时自己读
# 凭据文件（默认 ~/.credentials/cecelia-deploy-token.env，与 coding-workflow runner 同一个文件）。
# 环境里即便有 DEPLOY_TOKEN 也不会写进 plist。
#
# 用法：
#   bash scripts/preview-agent-install.sh             写 plist 并 bootout/bootstrap/kickstart
#   bash scripts/preview-agent-install.sh --no-load   只写 plist，不动 launchd（发布脚本自己管）
#   bash scripts/preview-agent-install.sh --dry-run   只把 plist 打到 stdout，不写文件、不动 launchd
# 环境：
#   PREVIEW_AGENT_ROOT    代理运行目录（默认本脚本所在仓库根）；正式环境由 preview-host-release.sh 传发布目录
#   PREVIEW_RELEASES_DIR  发布目录根（默认 /Users/administrator/perfect21/cecelia-preview-releases）
#   PREVIEW_AGENT_PLIST   plist 路径（默认 ~/Library/LaunchAgents/com.cecelia.preview-agent.plist）
#   DEPLOY_TOKEN_FILE     凭据文件路径（默认 ~/.credentials/cecelia-deploy-token.env）
set -euo pipefail

MODE="load"
for arg in "$@"; do
  case "$arg" in
    --dry-run) MODE="dry-run" ;;
    --no-load) MODE="no-load" ;;
    *) echo "未知参数：${arg}（可用 --dry-run / --no-load）" >&2; exit 2 ;;
  esac
done

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="${PREVIEW_AGENT_ROOT:-$(cd "$SCRIPT_DIR/.." && pwd)}"
REPO_ROOT="${REPO_ROOT%/}"
DEPLOY_ROOT="/Users/administrator/perfect21/cecelia"
RELEASES_DIR="${PREVIEW_RELEASES_DIR:-/Users/administrator/perfect21/cecelia-preview-releases}"
RELEASES_DIR="${RELEASES_DIR%/}"
LABEL="com.cecelia.preview-agent"
PLIST="${PREVIEW_AGENT_PLIST:-$HOME/Library/LaunchAgents/${LABEL}.plist}"
TOKEN_FILE="${DEPLOY_TOKEN_FILE:-$HOME/.credentials/cecelia-deploy-token.env}"

# 代理必须跑在部署根（主 checkout）或预览发布目录（preview-host-release.sh 建的快照），
# 并与 capacity-gate 同一个 repo——否则 capacity-gate 按自己的位置算 REPO_ROOT，会去另一个
# 目录找采样文件，报 sample_missing（2026-09-17 在 worktree 里实测到过这个差异）。
# plist 同时注入 REPO_ROOT / CECELIA_DEPLOY_ROOT 指向同一目录，三者对齐。
if [[ "$MODE" != "dry-run" && "$REPO_ROOT" != "$DEPLOY_ROOT" && "$REPO_ROOT" != "$RELEASES_DIR"/* ]]; then
  echo "⚠️  代理目录 ${REPO_ROOT} 既不是部署根也不在发布目录 ${RELEASES_DIR} 下"
  echo "   正式安装请用 bash scripts/preview-host-release.sh --apply（会建发布快照并装到快照目录）"
  exit 1
fi

if [[ -n "${DEPLOY_TOKEN:-}" ]]; then
  echo "ℹ️  环境里的 DEPLOY_TOKEN 不会写进 plist；代理从 ${TOKEN_FILE} 读取" >&2
fi
# 凭据文件必须真有 DEPLOY_TOKEN 行——否则装上去的代理会以"缺令牌"拒绝启动，KeepAlive 反复重拉
if ! env -u DEPLOY_TOKEN DEPLOY_TOKEN_FILE="$TOKEN_FILE" node "$SCRIPT_DIR/preview-agent/deploy-token.mjs" check >&2; then
  echo "❌ 凭据文件 ${TOKEN_FILE} 缺失或没有 DEPLOY_TOKEN= 行（值须与 GitHub Actions secret DEPLOY_TOKEN 相同，权限 600）" >&2
  exit 1
fi
if [[ -f "$TOKEN_FILE" ]]; then
  TOKEN_MODE=$(stat -c '%a' "$TOKEN_FILE" 2>/dev/null || stat -f '%Lp' "$TOKEN_FILE" 2>/dev/null || echo "?")
  [[ "$TOKEN_MODE" == "600" || "$TOKEN_MODE" == "400" ]] || echo "⚠️  凭据文件权限是 ${TOKEN_MODE}，建议 chmod 600 ${TOKEN_FILE}" >&2
fi

render_plist() {
  cat <<PLISTEOF
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
    <!-- 令牌不进 plist：代理启动时读这个文件里的 DEPLOY_TOKEN= 行（任务 6f937566） -->
    <key>DEPLOY_TOKEN_FILE</key><string>${TOKEN_FILE}</string>
    <!-- routes/preview.js 用 REPO_ROOT 找 preview-env-start.sh；capacity-gate 用
         CECELIA_DEPLOY_ROOT 找 .runtime/host-disk.json——都必须指向代理自己的目录 -->
    <key>REPO_ROOT</key><string>${REPO_ROOT}</string>
    <key>CECELIA_DEPLOY_ROOT</key><string>${REPO_ROOT}</string>
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
  <!-- 预览子进程（preview-env-start.sh 起的 Brain）是 detached 的，重启/重装代理时不连带杀掉 -->
  <key>AbandonProcessGroup</key><true/>
  <key>StandardOutPath</key><string>${HOME}/Library/Logs/preview-agent.log</string>
  <key>StandardErrorPath</key><string>${HOME}/Library/Logs/preview-agent.err</string>
</dict>
</plist>
PLISTEOF
}

if [[ "$MODE" == "dry-run" ]]; then
  render_plist
  exit 0
fi

mkdir -p "$(dirname "$PLIST")" "$HOME/Library/Logs"
TMP_PLIST="$(mktemp "${PLIST}.XXXXXX")"
render_plist > "$TMP_PLIST"
chmod 600 "$TMP_PLIST"
mv -f "$TMP_PLIST" "$PLIST"

if [[ "$MODE" == "no-load" ]]; then
  echo "✅ 已写入 ${PLIST}（未重载 launchd）"
  exit 0
fi

# bootout 是异步的：等卸载完再 bootstrap，失败重试（见 lib/launchd-reload.sh）
# shellcheck source=lib/launchd-reload.sh
source "$SCRIPT_DIR/lib/launchd-reload.sh"
launchd_reload "$LABEL" "$PLIST"

echo "✅ 已装载 ${LABEL}（目录 ${REPO_ROOT}）"
echo "   验证：curl -s http://100.71.151.105:5241/api/brain/health"
echo "   日志：~/Library/Logs/preview-agent.log"
