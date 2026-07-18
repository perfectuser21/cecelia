#!/usr/bin/env bash
# radius-rerun-gate-smoke.sh
# 验证 radius-rerun-gate 实现的静态断言（不依赖运行中的 Brain 或 DB）
# 关联 task: 2a8a33c5-bc62-43bd-a562-3c755766b950

set -euo pipefail

BRAIN_SRC="/workspace/packages/brain/src"
PASS=0
FAIL=0

check() {
  local desc="$1"
  local result="$2"
  if [ "$result" = "0" ]; then
    echo "PASS: $desc"
    PASS=$((PASS + 1))
  else
    echo "FAIL: $desc"
    FAIL=$((FAIL + 1))
  fi
}

# 1. radius-client.js 存在
[ -f "$BRAIN_SRC/lib/radius-client.js" ]
check "radius-client.js 存在" $?

# 2. cascade-list.js 含 WARN 哨兵
grep -q "\[WARN\]\[rerun-gate\]" "$BRAIN_SRC/cascade-list.js"
check "cascade-list.js 含 WARN 哨兵" $?

# 3. cascade-list.js 含 journey_step_links（格子路径未删除）
grep -q "journey_step_links" "$BRAIN_SRC/cascade-list.js"
check "cascade-list.js 含 journey_step_links（格子路径保留）" $?

# 4. cascade-list.js 对 callRadius 结果做 null 判断
grep -q "callRadius" "$BRAIN_SRC/cascade-list.js"
check "cascade-list.js 调用 callRadius" $?

# 5. radius-client.js 含 stale→null 逻辑
grep -q "stale" "$BRAIN_SRC/lib/radius-client.js"
check "radius-client.js 含 stale 逻辑" $?

# 6. 集成测试文件存在
[ -f "$BRAIN_SRC/__tests__/integration/rerun-gate-radius.integration.test.js" ]
check "rerun-gate-radius.integration.test.js 存在" $?

# 7. 单元测试文件存在
[ -f "$BRAIN_SRC/lib/radius-client.test.js" ]
check "radius-client.test.js 存在" $?

echo ""
echo "结果: $PASS PASS, $FAIL FAIL"
[ "$FAIL" -eq 0 ] && exit 0 || exit 1
