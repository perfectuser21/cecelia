#!/bin/bash
# 安装 tailscale-login-watchdog，并卸载失效的旧 watchdog。
#
# 旧的 com.cecelia.tailscale-watchdog 执行 `pgrep -x Tailscale || open -a Tailscale`，
# 但本机跑 brew 版 tailscaled，/Applications/Tailscale.app 不存在，因此它每 60 秒
# 失败一次（launchctl list 状态码恒为 1）；且只看进程存活，抓不到 node key 过期
# 那类「进程活着但认证失效」的故障（2026-09-06 slot1-10 全断即此因）。
#
# 脚本安装到 /usr/local/libexec/cecelia（与 tailscale-us-exit-enforcer 同惯例），
# 而非直接指向仓库路径——从 worktree 安装时仓库目录会在合并后消失。
#
# 幂等：可重复执行。
set -euo pipefail

SOURCE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/tailscale-login-watchdog.py"
INSTALL_DIR="/usr/local/libexec/cecelia"
INSTALLED_SCRIPT="$INSTALL_DIR/tailscale-login-watchdog.py"
STATE_DIR="/var/db/cecelia/tailscale-login-watchdog"
LOG_FILE="/tmp/tailscale-login-watchdog.log"
OLD_LABEL="com.cecelia.tailscale-watchdog"
NEW_LABEL="com.cecelia.tailscale-login-watchdog"
AGENTS_DIR="$HOME/Library/LaunchAgents"
OLD_PLIST="$AGENTS_DIR/$OLD_LABEL.plist"
NEW_PLIST="$AGENTS_DIR/$NEW_LABEL.plist"
UID_NUM="$(id -u)"
HOST_NAME="$(scutil --get LocalHostName 2>/dev/null || hostname -s)"

[ -f "$SOURCE" ] || { echo "❌ 找不到 $SOURCE"; exit 1; }
python3 -c "import ast,sys;ast.parse(open(sys.argv[1]).read())" "$SOURCE" \
  || { echo "❌ watchdog 脚本语法错误，中止安装"; exit 1; }

echo "▸ 卸载旧 watchdog（${OLD_LABEL}）"
launchctl bootout "gui/$UID_NUM/$OLD_LABEL" 2>/dev/null || true
if [ -f "$OLD_PLIST" ]; then
  mv "$OLD_PLIST" "$OLD_PLIST.disabled-$(date +%Y%m%d%H%M%S)"
  echo "  已备份并移除旧 plist"
else
  echo "  旧 plist 不存在，跳过"
fi

echo "▸ 安装脚本到 $INSTALLED_SCRIPT"
sudo /usr/bin/install -d -m 0755 "$INSTALL_DIR"
sudo /usr/bin/install -m 0755 "$SOURCE" "$INSTALLED_SCRIPT"

echo "▸ 准备状态目录 $STATE_DIR"
sudo /usr/bin/install -d -o "$UID_NUM" -m 0700 "$STATE_DIR"

echo "▸ 写入 $NEW_PLIST"
mkdir -p "$AGENTS_DIR"
/usr/bin/python3 - "$NEW_PLIST" "$NEW_LABEL" "$INSTALLED_SCRIPT" "$LOG_FILE" "$HOST_NAME" <<'PY'
import plistlib
import sys

plist_path, label, script_path, log_file, host_name = sys.argv[1:6]
payload = {
    "Label": label,
    "ProgramArguments": ["/usr/bin/python3", script_path, "--once"],
    "StartInterval": 60,
    "RunAtLoad": True,
    "StandardOutPath": log_file,
    "StandardErrorPath": log_file,
    "EnvironmentVariables": {
        "PATH": "/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin",
        "CECELIA_TS_WATCHDOG_HOSTNAME": host_name,
    },
}
with open(plist_path, "wb") as handle:
    plistlib.dump(payload, handle)
print(f"  plist 已写入（hostname={host_name}）")
PY

echo "▸ 加载新 watchdog"
launchctl bootout "gui/$UID_NUM/$NEW_LABEL" 2>/dev/null || true
launchctl bootstrap "gui/$UID_NUM" "$NEW_PLIST"
launchctl kickstart -k "gui/$UID_NUM/$NEW_LABEL"

sleep 3
echo
echo "▸ 当前状态（第二列为上次退出码，0 = 正常）"
launchctl list | grep -i tailscale || echo "  （未找到 tailscale 相关 agent）"
echo
echo "▸ 最近日志"
tail -5 "$LOG_FILE" 2>/dev/null || echo "  （暂无日志）"
echo
echo "✅ 安装完成。安全隔离场景下停用自动重认证：touch $STATE_DIR/DISABLED"
