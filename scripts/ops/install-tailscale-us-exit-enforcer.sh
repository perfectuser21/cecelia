#!/usr/bin/env bash
set -euo pipefail

LABEL="com.cecelia.tailscale-us-exit"
TARGET_HOME="${HOME}"
LOAD_AGENT=true
SYSTEM_MODE=true
SYSTEM_PLIST_DIR="/Library/LaunchDaemons"
SYSTEM_LIBEXEC_DIR="/usr/local/libexec/cecelia"
SYSTEM_STATE_DIR="/var/db/cecelia/tailscale-us-exit"
SYSTEM_LOG_DIR="/var/log/cecelia/tailscale-us-exit"
LAUNCHCTL_BIN="${CECELIA_LAUNCHCTL_BIN:-/bin/launchctl}"
SUDO_BIN="${CECELIA_SUDO_BIN:-/usr/bin/sudo}"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --home)
      TARGET_HOME="$2"
      shift 2
      ;;
    --no-load)
      LOAD_AGENT=false
      shift
      ;;
    --system)
      SYSTEM_MODE=true
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

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
SOURCE="${CECELIA_US_EXIT_SOURCE:-$SCRIPT_DIR/tailscale-us-exit-enforcer.py}"
USER_CONFIG_DIR="$TARGET_HOME/.config/cecelia"
AGENT_DIR="$TARGET_HOME/Library/LaunchAgents"
INSTALL_DIR="$SYSTEM_LIBEXEC_DIR"
STATE_DIR="$SYSTEM_STATE_DIR"
LOG_DIR="$SYSTEM_LOG_DIR"
INSTALLED_SCRIPT="$INSTALL_DIR/tailscale-us-exit-enforcer.py"
TARGET_USER="${CECELIA_US_EXIT_USER:-$(/usr/bin/stat -f %Su "$TARGET_HOME" 2>/dev/null || /usr/bin/id -un)}"
TARGET_UID="${CECELIA_US_EXIT_UID:-$(/usr/bin/id -u "$TARGET_USER")}"
if [[ "$SYSTEM_MODE" == true ]]; then
  PLIST="$SYSTEM_PLIST_DIR/$LABEL.plist"
  PLIST_STAGING="$USER_CONFIG_DIR/$LABEL.plist"
else
  PLIST="$AGENT_DIR/$LABEL.plist"
  PLIST_STAGING="$PLIST"
fi

if [[ ! -f "$SOURCE" ]]; then
  echo "enforcer source not found: $SOURCE" >&2
  exit 66
fi

/bin/mkdir -p "$USER_CONFIG_DIR" "$AGENT_DIR"

if [[ "$SYSTEM_LIBEXEC_DIR" == "/usr/local/libexec/cecelia" ]]; then
  "$SUDO_BIN" /usr/bin/install -d -o root -g wheel -m 0755 "$INSTALL_DIR"
  "$SUDO_BIN" /usr/bin/install -d -o root -g wheel -m 0700 "$STATE_DIR"
  "$SUDO_BIN" /usr/bin/install -d -o root -g wheel -m 0750 "$LOG_DIR"
  "$SUDO_BIN" /usr/bin/install -o root -g wheel -m 0755 "$SOURCE" "$INSTALLED_SCRIPT"
else
  /usr/bin/install -d -m 0755 "$INSTALL_DIR"
  /usr/bin/install -d -m 0700 "$STATE_DIR"
  /usr/bin/install -d -m 0750 "$LOG_DIR"
  /usr/bin/install -m 0755 "$SOURCE" "$INSTALLED_SCRIPT"
fi

# system 模式取代同标签的用户 LaunchAgent，避免登录后双实例竞争。
if [[ "$SYSTEM_MODE" == true ]]; then
  /bin/rm -f "$AGENT_DIR/$LABEL.plist"
fi

/usr/bin/python3 - "$PLIST_STAGING" "$INSTALLED_SCRIPT" "$STATE_DIR" "$LOG_DIR" "$SYSTEM_MODE" "$TARGET_USER" "$TARGET_UID" "$TARGET_HOME" <<'PY'
import plistlib
import sys

plist_path, script_path, state_dir, log_dir, system_mode, target_user, target_uid, target_home = sys.argv[1:]
payload = {
    "Label": "com.cecelia.tailscale-us-exit",
    "ProgramArguments": ["/usr/bin/python3", script_path, "--once"],
    "EnvironmentVariables": {
        "PATH": "/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin",
        "CECELIA_US_EXIT_PRIMARY_DNS": "mac-mini-m4-us.tailce7a8b.ts.net",
        "CECELIA_US_EXIT_SECONDARY_DNS": "vps-us.tailce7a8b.ts.net",
        "CECELIA_US_EXIT_PRIMARY_ID": "n6kr9EqWwN11CNTRL",
        "CECELIA_US_EXIT_SECONDARY_ID": "nWC4TTvpLA11CNTRL",
        "CECELIA_US_EXIT_ALLOWED_SELF_IPS": "100.86.57.69,100.88.166.55",
        "CECELIA_US_EXIT_STATE_FILE": f"{state_dir}/tailscale-us-exit-state.json",
        "CECELIA_US_EXIT_LOCK_FILE": f"{state_dir}/enforcer.lock",
        "CECELIA_US_EXIT_TARGET_USER": target_user,
        "CECELIA_US_EXIT_TARGET_UID": target_uid,
        "CECELIA_US_EXIT_TARGET_HOME": target_home,
        "TAILSCALE_BE_CLI": "1",
    },
    "RunAtLoad": True,
    "StartInterval": 5,
    "ThrottleInterval": 10,
    "ProcessType": "Background",
    "StandardOutPath": f"{log_dir}/tailscale-us-exit.log",
    "StandardErrorPath": f"{log_dir}/tailscale-us-exit-error.log",
}
if system_mode == "true":
    payload["ProgramArguments"] = ["/usr/bin/python3", script_path, "--once"]
    payload["EnvironmentVariables"].update({
        "HOME": target_home,
        "USER": target_user,
        "LOGNAME": target_user,
    })
with open(plist_path, "wb") as handle:
    plistlib.dump(payload, handle, fmt=plistlib.FMT_XML, sort_keys=False)
PY

if [[ "$SYSTEM_MODE" == true ]]; then
  if [[ "$SYSTEM_PLIST_DIR" == "/Library/LaunchDaemons" ]]; then
    "$SUDO_BIN" /bin/mkdir -p "$SYSTEM_PLIST_DIR"
    "$SUDO_BIN" /usr/bin/install -o root -g wheel -m 0644 "$PLIST_STAGING" "$PLIST"
  else
    /bin/mkdir -p "$SYSTEM_PLIST_DIR"
    /usr/bin/install -m 0644 "$PLIST_STAGING" "$PLIST"
  fi
fi

/usr/bin/plutil -lint "$PLIST" >/dev/null

if [[ "$LOAD_AGENT" == true ]]; then
  if [[ "$SYSTEM_MODE" == true ]]; then
    "$LAUNCHCTL_BIN" bootout "gui/$TARGET_UID/$LABEL" >/dev/null 2>&1 || true
    "$SUDO_BIN" "$LAUNCHCTL_BIN" bootout "user/$TARGET_UID/$LABEL" >/dev/null 2>&1 || true
    "$SUDO_BIN" "$LAUNCHCTL_BIN" bootout "system/$LABEL" >/dev/null 2>&1 || true
    "$SUDO_BIN" "$LAUNCHCTL_BIN" enable "system/$LABEL"
    "$SUDO_BIN" "$LAUNCHCTL_BIN" bootstrap system "$PLIST"
    "$SUDO_BIN" "$LAUNCHCTL_BIN" kickstart -k "system/$LABEL"
  else
    USER_ID="$(/usr/bin/id -u)"
    "$LAUNCHCTL_BIN" bootout "gui/$USER_ID/$LABEL" >/dev/null 2>&1 || true
    "$LAUNCHCTL_BIN" enable "gui/$USER_ID/$LABEL"
    "$LAUNCHCTL_BIN" bootstrap "gui/$USER_ID" "$PLIST"
    "$LAUNCHCTL_BIN" kickstart -k "gui/$USER_ID/$LABEL"
  fi
fi

echo "installed=$INSTALLED_SCRIPT"
echo "launch_agent=$PLIST"
