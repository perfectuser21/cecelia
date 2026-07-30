#!/usr/bin/env bash
# Issue cc28d1af 根因D — brain-deploy 必须在 swap 【成功】后也无条件 drain-cancel
# 现状：drain-cancel 仅存在于 green 失败回滚路径；成功路径不取消，而 drain 状态
# 持久化 working_memory（共享DB），新容器 restoreDrainState 恢复 → 派发永久瘫痪
#（0729 16:48 与 0730 10:21 两次实证，均由合并PR触发自动部署引起）
set -uo pipefail
DEPLOY="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)/brain-deploy.sh"
PASS=0; FAIL=0

N=$(grep -c "drain-cancel" "$DEPLOY")
if [[ "$N" -ge 2 ]]; then
  echo "PASS: drain-cancel 出现 ${N} 次（失败回滚路径 + 成功收尾路径）"; PASS=$((PASS+1))
else
  echo "FAIL: drain-cancel 仅出现 ${N} 次——成功路径缺 post-swap 取消，新容器必恢复 draining"; FAIL=$((FAIL+1))
fi

if grep -q "post-swap.*drain\|swap 成功.*drain\|成功.*drain-cancel" "$DEPLOY"; then
  echo "PASS: 含成功路径 drain-cancel 语义标记"; PASS=$((PASS+1))
else
  echo "FAIL: 无成功路径 drain-cancel 语义标记"; FAIL=$((FAIL+1))
fi

echo "结果: $PASS pass / $FAIL fail"
[[ $FAIL -eq 0 ]] || exit 1
