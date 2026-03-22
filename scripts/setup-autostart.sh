#!/usr/bin/env bash
# setup-autostart.sh — 系统级自启动配置（可重放）
#
# 解决的问题：
#   机器 kernel panic 重启后，PG17 和 Brain 不自动恢复，原因：
#   - com.cecelia.brain LaunchDaemon 处于 disabled 状态
#   - homebrew.mxcl.postgresql@17 只在 ~/Library/LaunchAgents（用户级，SSH 重启不触发）
#
# 用法：sudo bash scripts/setup-autostart.sh
# 幂等：重复运行安全

set -e

BRAIN_PLIST="/Library/LaunchDaemons/com.cecelia.brain.plist"
PG17_PLIST="/Library/LaunchDaemons/homebrew.mxcl.postgresql@17.plist"
PG17_BIN="/opt/homebrew/opt/postgresql@17/bin/postgres"
PG17_DATA="/opt/homebrew/var/postgresql@17"
PG17_LOG="/opt/homebrew/var/log/postgresql@17.log"

log() { echo "[setup-autostart] $*"; }

# ── 1. 检查 sudo ──────────────────────────────────────────────
if [[ $EUID -ne 0 ]]; then
  echo "错误：需要 sudo 权限" >&2
  echo "用法：sudo bash scripts/setup-autostart.sh" >&2
  exit 1
fi

# ── 2. Brain LaunchDaemon：确保已启用 ─────────────────────────
if [[ -f "$BRAIN_PLIST" ]]; then
  log "启用 Brain LaunchDaemon..."
  launchctl enable system/com.cecelia.brain 2>/dev/null || true
  # 如果已加载则跳过，否则 bootstrap
  if ! launchctl list com.cecelia.brain &>/dev/null; then
    launchctl bootstrap system "$BRAIN_PLIST" 2>/dev/null || \
      log "Brain bootstrap 跳过（可能已加载）"
  fi
  log "✅ com.cecelia.brain 已启用"
else
  log "⚠️  Brain plist 不存在：$BRAIN_PLIST（跳过）"
fi

# ── 3. PG17 LaunchDaemon：如不存在则从 homebrew plist 生成 ────
if [[ ! -f "$PG17_PLIST" ]]; then
  log "创建 PG17 系统级 LaunchDaemon..."
  cat > "$PG17_PLIST" << PLIST_EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>EnvironmentVariables</key>
  <dict>
    <key>LC_ALL</key>
    <string>en_US.UTF-8</string>
  </dict>
  <key>KeepAlive</key>
  <true/>
  <key>Label</key>
  <string>homebrew.mxcl.postgresql@17</string>
  <key>ProgramArguments</key>
  <array>
    <string>$PG17_BIN</string>
    <string>-D</string>
    <string>$PG17_DATA</string>
  </array>
  <key>RunAtLoad</key>
  <true/>
  <key>StandardErrorPath</key>
  <string>$PG17_LOG</string>
  <key>StandardOutPath</key>
  <string>$PG17_LOG</string>
  <key>ThrottleInterval</key>
  <integer>10</integer>
  <key>UserName</key>
  <string>administrator</string>
  <key>WorkingDirectory</key>
  <string>/opt/homebrew</string>
</dict>
</plist>
PLIST_EOF
  chown root:wheel "$PG17_PLIST"
  chmod 644 "$PG17_PLIST"
  log "✅ PG17 LaunchDaemon plist 已创建"
else
  log "PG17 LaunchDaemon 已存在，跳过创建"
fi

# 启用并加载 PG17
log "启用 PG17 LaunchDaemon..."
launchctl enable system/homebrew.mxcl.postgresql@17 2>/dev/null || true
if ! launchctl list homebrew.mxcl.postgresql@17 &>/dev/null; then
  launchctl bootstrap system "$PG17_PLIST" 2>/dev/null || \
    log "PG17 bootstrap 跳过（可能已加载）"
fi
log "✅ homebrew.mxcl.postgresql@17 已启用"

# ── 4. 验证 ──────────────────────────────────────────────────
echo ""
echo "=== 自启动状态 ==="
launchctl print-disabled system 2>/dev/null | grep -E "brain|postgresql@17" || true
echo ""
log "✅ 完成。重启后 PG17 + Brain 将自动拉起。"
