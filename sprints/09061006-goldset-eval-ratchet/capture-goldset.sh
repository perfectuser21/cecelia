#!/usr/bin/env bash
# capture-goldset.sh — 在 xian-m4 上驱动 HONOR MAA-AN00 抓金标集 v0 五类截图
# 类别: user_list(true) / desktop / calculator / search_history / suggest (false)
set -euo pipefail
DEV=ANGYVB4227006983
PKG=com.ss.android.ugc.aweme
OUT=/tmp/goldset-v0
TARGET=langzi63485
TS=$(date +%Y%m%d%H%M%S)
mkdir -p "$OUT"

A() { adb -s "$DEV" "$@"; }
cap() { # cap <label> <n>
  local f="$OUT/goldset-$1-$TS-$2.png"
  A exec-out screencap -p > "$f"
  sips -Z 760 "$f" --out "$f" >/dev/null 2>&1
  echo "captured: $f"
}
# 千分比 tap（wm size 换算）
read W H < <(A shell wm size | grep -oE '[0-9]+x[0-9]+' | tr 'x' ' ')
tapp() { A shell input tap $(( $1 * W / 1000 )) $(( $2 * H / 1000 )); }

echo "== screen ${W}x${H} =="

# 1. 桌面 ×2
A shell am force-stop "$PKG" || true
A shell input keyevent KEYCODE_HOME
sleep 2
cap desktop 1
sleep 1
cap desktop 2

# 2. 计算器 ×2
CALC=$(A shell pm list packages | grep -oE 'com[^[:space:]]*calculator[^[:space:]]*' | head -1 | tr -d '\r')
echo "calculator pkg: $CALC"
A shell monkey -p "$CALC" -c android.intent.category.LAUNCHER 1 >/dev/null 2>&1
sleep 3
cap calculator 1
A shell input tap $(( W / 2 )) $(( H * 3 / 4 ))
sleep 1
cap calculator 2
A shell am force-stop "$CALC" || true

# 3. 抖音搜索历史页 ×2（搜索入口 946,75 千分比,registry 实测值）
A shell input keyevent KEYCODE_HOME
sleep 1
A shell monkey -p "$PKG" -c android.intent.category.LAUNCHER 1 >/dev/null 2>&1
sleep 10
tapp 946 75
sleep 3
cap search_history 1
sleep 1
cap search_history 2

# 4. 搜索联想页 ×2
A shell input text "$TARGET"
sleep 2
cap suggest 1
sleep 1
cap suggest 2

# 5. 用户列表页 ×2（tab_users 256,132 千分比）
A shell input keyevent KEYCODE_ENTER
sleep 4
tapp 256 132
sleep 3
cap user_list 1
sleep 1
cap user_list 2

# 收尾: 退出抖音回桌面
A shell am force-stop "$PKG" || true
A shell input keyevent KEYCODE_HOME
ls -la "$OUT"
