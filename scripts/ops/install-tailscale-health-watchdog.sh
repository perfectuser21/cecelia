#!/usr/bin/env bash
# 安装 tailscale-health-watchdog（root LaunchDaemon，每 60 秒一次 --once）。
#
# 与 tailscale-us-exit-enforcer 同惯例：脚本落到 /usr/local/libexec/cecelia
# （不指向仓库路径——从 worktree 安装时目录会在合并后消失），plist 用 plistlib
# 生成，加载走 bootout → enable → bootstrap → kickstart。
#
# 必须是 root daemon：二级自愈要 pkill 系统扩展进程，普通用户权限杀不动。
# 正因为它会强杀网络扩展，安装前有两道闸：脚本语法预检 + --check-client
# 目标机白名单校验，两者都在任何目录创建/文件落盘之前。
#
# 幂等：可重复执行。所有路径均可用参数覆盖，便于 CI 里不 sudo 跑通。
set -euo pipefail

LABEL="com.cecelia.tailscale-health-watchdog"
LOAD_DAEMON=true
SYSTEM_PLIST_DIR="/Library/LaunchDaemons"
SYSTEM_LIBEXEC_DIR="/usr/local/libexec/cecelia"
SYSTEM_STATE_DIR="/var/db/cecelia/tailscale-health-watchdog"
SYSTEM_LOG_DIR="/var/log/cecelia/tailscale-health-watchdog"
LAUNCHCTL_BIN="${CECELIA_LAUNCHCTL_BIN:-/bin/launchctl}"
SUDO_BIN="${CECELIA_SUDO_BIN:-/usr/bin/sudo}"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --no-load)
      LOAD_DAEMON=false
      shift
      ;;
    --system-plist-dir)
      SYSTEM_PLIST_DIR="$2"
      shift 2
      ;;
    --system-libexec-dir)
      SYSTEM_LIBEXEC_DIR="$2"
      shift 2
      ;;
    --system-state-dir)
      SYSTEM_STATE_DIR="$2"
      shift 2
      ;;
    --system-log-dir)
      SYSTEM_LOG_DIR="$2"
      shift 2
      ;;
    *)
      echo "unknown argument: $1" >&2
      exit 64
      ;;
  esac
done

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SOURCE="${CECELIA_TS_HEALTH_SOURCE:-$SCRIPT_DIR/tailscale-health-watchdog.py}"
INSTALLED_SCRIPT="$SYSTEM_LIBEXEC_DIR/tailscale-health-watchdog.py"
PLIST="$SYSTEM_PLIST_DIR/$LABEL.plist"
PLIST_STAGING="$(/usr/bin/mktemp -t "$LABEL")"
trap '/bin/rm -f "$PLIST_STAGING"' EXIT

if [[ ! -f "$SOURCE" ]]; then
  echo "watchdog source not found: $SOURCE" >&2
  exit 66
fi

# 闸一：语法预检。坏脚本装上去等于 60 秒失败一次，而且真出事时救不了。
/usr/bin/python3 -c "import ast,sys;ast.parse(open(sys.argv[1]).read())" "$SOURCE" \
  || { echo "watchdog script syntax error: $SOURCE" >&2; exit 65; }

# 闸二：目标机白名单。只读 Tailscale 身份，必须在任何落盘动作之前。
TAILSCALE_BE_CLI=1 /usr/bin/python3 "$SOURCE" --check-client

if [[ "$SYSTEM_LIBEXEC_DIR" == "/usr/local/libexec/cecelia" ]]; then
  "$SUDO_BIN" /usr/bin/install -d -o root -g wheel -m 0755 "$SYSTEM_LIBEXEC_DIR"
  "$SUDO_BIN" /usr/bin/install -d -o root -g wheel -m 0700 "$SYSTEM_STATE_DIR"
  "$SUDO_BIN" /usr/bin/install -d -o root -g wheel -m 0750 "$SYSTEM_LOG_DIR"
  "$SUDO_BIN" /usr/bin/install -o root -g wheel -m 0755 "$SOURCE" "$INSTALLED_SCRIPT"
else
  /usr/bin/install -d -m 0755 "$SYSTEM_LIBEXEC_DIR"
  /usr/bin/install -d -m 0700 "$SYSTEM_STATE_DIR"
  /usr/bin/install -d -m 0750 "$SYSTEM_LOG_DIR"
  /usr/bin/install -m 0755 "$SOURCE" "$INSTALLED_SCRIPT"
fi

/usr/bin/python3 - "$PLIST_STAGING" "$LABEL" "$INSTALLED_SCRIPT" "$SYSTEM_STATE_DIR" "$SYSTEM_LOG_DIR" <<'PY'
import plistlib
import sys

plist_path, label, script_path, state_dir, log_dir = sys.argv[1:6]
payload = {
    "Label": label,
    "ProgramArguments": ["/usr/bin/python3", script_path, "--once"],
    "EnvironmentVariables": {
        "PATH": "/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin",
        "CECELIA_TS_HEALTH_STATE_FILE": f"{state_dir}/state.json",
        "CECELIA_TS_HEALTH_LOCK_FILE": f"{state_dir}/watchdog.lock",
        "CECELIA_TS_HEALTH_DISABLED_FILE": f"{state_dir}/DISABLED",
        "TAILSCALE_BE_CLI": "1",
    },
    # 60 秒一轮：3 次失败判定卡死 ≈ 3 分钟，赶在 enforcer 的
    # daemon_absent 10 分钟 fail-closed 拉闸之前完成自愈。
    "StartInterval": 60,
    "RunAtLoad": True,
    "ThrottleInterval": 10,
    "ProcessType": "Background",
    "StandardOutPath": f"{log_dir}/tailscale-health-watchdog.log",
    "StandardErrorPath": f"{log_dir}/tailscale-health-watchdog-error.log",
}
with open(plist_path, "wb") as handle:
    plistlib.dump(payload, handle, fmt=plistlib.FMT_XML, sort_keys=False)
PY

if [[ "$SYSTEM_PLIST_DIR" == "/Library/LaunchDaemons" ]]; then
  "$SUDO_BIN" /bin/mkdir -p "$SYSTEM_PLIST_DIR"
  "$SUDO_BIN" /usr/bin/install -o root -g wheel -m 0644 "$PLIST_STAGING" "$PLIST"
else
  /bin/mkdir -p "$SYSTEM_PLIST_DIR"
  /usr/bin/install -m 0644 "$PLIST_STAGING" "$PLIST"
fi

/usr/bin/plutil -lint "$PLIST" >/dev/null

if [[ "$LOAD_DAEMON" == true ]]; then
  # 未加载时 bootout 返回非零，属正常情况，不能让 set -e 中止安装。
  "$SUDO_BIN" "$LAUNCHCTL_BIN" bootout "system/$LABEL" >/dev/null 2>&1 || true
  "$SUDO_BIN" "$LAUNCHCTL_BIN" enable "system/$LABEL"
  "$SUDO_BIN" "$LAUNCHCTL_BIN" bootstrap system "$PLIST"
  "$SUDO_BIN" "$LAUNCHCTL_BIN" kickstart -k "system/$LABEL"
fi

echo "installed=$INSTALLED_SCRIPT"
echo "launch_daemon=$PLIST"
echo "停用自愈（事故处置时人工接管）：sudo touch $SYSTEM_STATE_DIR/DISABLED"
