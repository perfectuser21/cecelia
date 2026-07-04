#!/bin/bash
# e2e-verify-android.sh — 安卓真机 E2E 验证模板
# 由 Sprint Generator 复制到 sprints/<run-dir>/ 并按任务需求修改
#
# 运行环境：Mac mini self-hosted runner（已通过 Tailscale + ADB TCP 连通 Honor 测试机）
# 所需环境变量（由 e2e-android-realdevice.yml 注入）：
#   DEVICE_SERIAL  — ADB 设备标识符，如 "100.x.x.x:5555"
#   TASK_ID        — Brain 任务 ID（用于日志/回调标记）
#   SPRINT_DIR     — 本 sprint 目录路径
set -euo pipefail

DEVICE="${DEVICE_SERIAL:?DEVICE_SERIAL not set}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SCREENSHOTS_DIR="$(pwd)/screenshots"
mkdir -p "$SCREENSHOTS_DIR"

log() { echo "[$(date '+%H:%M:%S')] $*"; }
fail() { log "❌ FAIL: $*"; exit 1; }
pass() { log "✅ PASS: $*"; }

# ── 1. 设备确认 ────────────────────────────────────────────────────────────────
log "Step 1/5: 确认设备在线"
adb -s "$DEVICE" get-state | grep -q "device" || fail "Device offline"
MODEL=$(adb -s "$DEVICE" shell getprop ro.product.model | tr -d '\r')
ANDROID=$(adb -s "$DEVICE" shell getprop ro.build.version.release | tr -d '\r')
pass "Device: $MODEL  Android: $ANDROID"

# ── 2. 安装 APK ────────────────────────────────────────────────────────────────
log "Step 2/5: 安装 APK"
APK_PATH=""
# 优先 sprint_dir/apk/*.apk，其次 sprint_dir/apk/ 下任何 .apk
for candidate in "$SCRIPT_DIR/apk/"*.apk; do
  [ -f "$candidate" ] && APK_PATH="$candidate" && break
done
if [ -z "$APK_PATH" ]; then
  fail "No APK found in $SCRIPT_DIR/apk/"
fi
log "Installing $APK_PATH ..."
adb -s "$DEVICE" install -r "$APK_PATH" || fail "APK install failed"
pass "APK installed"

# ── 3. 清除旧数据（可选，避免残留状态干扰）──────────────────────────────────────
APP_PKG="com.ss.android.ugc.aweme"   # 抖音包名 — 按实际 APK 改
log "Step 3/5: 重置应用状态"
adb -s "$DEVICE" shell pm clear "$APP_PKG" 2>/dev/null || true

# ── 4. 启动抖音 + 采集流程 ─────────────────────────────────────────────────────
log "Step 4/5: 唤起抖音采集流程"

# 启动主 Activity
adb -s "$DEVICE" shell am start -n "${APP_PKG}/.launch.activity.MainActivity" \
  --ez skip_splash true 2>/dev/null || true
sleep 3

# 截图确认启动
adb -s "$DEVICE" shell screencap -p /sdcard/step4-launch.png
adb -s "$DEVICE" pull /sdcard/step4-launch.png "$SCREENSHOTS_DIR/step4-launch.png" 2>/dev/null || true

# ── TODO: 在这里插入 uiautomator / ADB shell input 采集步骤 ──────────────────
# 示例（按实际 uiautomator 测试 APK / instrumentation 改）：
#
#   adb -s "$DEVICE" shell am instrument -w \
#     -e class com.example.collector.CollectTest \
#     com.example.collector.test/androidx.test.runner.AndroidJUnitRunner
#
# 或者纯 ADB shell 交互：
#   adb -s "$DEVICE" shell input tap 540 1200   # 按采集按钮坐标
#   sleep 2
#   adb -s "$DEVICE" shell screencap -p /sdcard/step4-collect.png
#   adb -s "$DEVICE" pull /sdcard/step4-collect.png "$SCREENSHOTS_DIR/"

pass "抖音已启动（Step 4 截图已保存）"

# ── 5. 验收断言 ────────────────────────────────────────────────────────────────
log "Step 5/5: 验收断言"

# 断言：进程仍在运行（未崩溃）
RUNNING=$(adb -s "$DEVICE" shell pidof "$APP_PKG" 2>/dev/null | tr -d '\r')
[ -n "$RUNNING" ] || fail "抖音进程已不存在（崩溃或未启动）"
pass "进程在线 PID=$RUNNING"

# 断言：没有 FATAL EXCEPTION 出现在近期 logcat
CRASHES=$(adb -s "$DEVICE" logcat -d -s AndroidRuntime | grep -c "FATAL EXCEPTION" || true)
[ "$CRASHES" -eq 0 ] || fail "检测到 $CRASHES 次 FATAL EXCEPTION（见 screenshots/logcat.txt）"
pass "无崩溃"

# 最终截图
adb -s "$DEVICE" shell screencap -p /sdcard/step5-final.png
adb -s "$DEVICE" pull /sdcard/step5-final.png "$SCREENSHOTS_DIR/step5-final.png" 2>/dev/null || true

log "✅ All steps passed. Screenshots: $SCREENSHOTS_DIR"
