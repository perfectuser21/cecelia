#!/usr/bin/env bash
# Issue cc28d1af 根因A — cecelia-run.sh 经软链调用时 launcher 路径必须真实存在
# （BASH_SOURCE 未解析软链 → //scripts/claude-launch.sh → exit 127 秒挂，0730实证）
set -uo pipefail
SCRIPT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)/cecelia-run.sh"
TMP=$(mktemp -d); trap 'rm -rf "$TMP"' EXIT
ln -s "$SCRIPT" "$TMP/cecelia-run"
PASS=0; FAIL=0

OUT=$(bash "$TMP/cecelia-run" --dry-run 00000000-0000-0000-0000-000000000000 2>&1 | head -3)
LAUNCHER=$(echo "$OUT" | grep -oE 'bash [^ ]*claude-launch\.sh' | awk '{print $2}' | head -1)
if [[ -z "$LAUNCHER" ]]; then
  echo "FAIL: dry-run 输出里找不到 claude-launch.sh 调用行：$OUT"; FAIL=$((FAIL+1))
elif [[ -f "$LAUNCHER" ]]; then
  echo "PASS: 软链调用下 launcher 路径真实存在: $LAUNCHER"; PASS=$((PASS+1))
else
  echo "FAIL: 软链调用下 launcher 路径不存在: $LAUNCHER"; FAIL=$((FAIL+1))
fi

echo "结果: $PASS pass / $FAIL fail"
[[ $FAIL -eq 0 ]] || exit 1
