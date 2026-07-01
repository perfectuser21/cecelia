#!/usr/bin/env bash
# run-core-regression.test.sh — 纯 bash 断言（四种退出码守卫）
set -u
SCRIPT="$(dirname "$0")/../run-core-regression.sh"
TMP=$(mktemp -d)
fail=0
mk(){ cat > "$TMP/c.yaml"; }

# 1) 全绿 → 0
mk <<E
golden_paths:
  - {id: T1, priority: P0, trigger: [PR], method: auto, test_command: "true"}
E
bash "$SCRIPT" --tier pr --contract "$TMP/c.yaml" >/dev/null 2>&1
[ $? -eq 0 ] || { echo "FAIL: 全绿应 0"; fail=1; }

# 2) 一条 fail → 非0
mk <<E
golden_paths:
  - {id: T2, priority: P0, trigger: [PR], method: auto, test_command: "false"}
E
bash "$SCRIPT" --tier pr --contract "$TMP/c.yaml" >/dev/null 2>&1
[ $? -ne 0 ] || { echo "FAIL: 有失败应非0"; fail=1; }

# 3) 空 release 集 → 非0（空契约守卫）
mk <<E
golden_paths:
  - {id: T3, priority: P0, trigger: [PR], method: auto, test_command: "true"}
E
bash "$SCRIPT" --tier release --contract "$TMP/c.yaml" >/dev/null 2>&1
[ $? -ne 0 ] || { echo "FAIL: 空release应非0"; fail=1; }

rm -rf "$TMP"
[ $fail -eq 0 ] && echo "ALL PASS" || exit 1
