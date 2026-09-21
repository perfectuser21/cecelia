#!/usr/bin/env bash
# 回归守卫：janitor 误伤豁免 + kill 复查（2026-08-05，决策 e8427238，issue ab1da1d7）
# 背景：fleet-worker(/usr/local/libexec/cecelia/)被当 node 孤儿，kill EPERM 静默失败仍谎报 killed。

set -uo pipefail
PASS=0; FAIL=0
ok() { echo "PASS: $1"; PASS=$((PASS + 1)); }
fail() { echo "FAIL: $1"; FAIL=$((FAIL + 1)); }

JANITOR="$(dirname "$0")/../../janitor.sh"
[ -f "$JANITOR" ] || { echo "ERROR: janitor.sh not found"; exit 1; }

# 1. 豁免判据存在，且两个 kill 函数都走它
#    2026-09-21 起豁免抽成单一函数 is_exempt_resident_service（原来是两处重复的
#    case 字面量）。断言随之改为「字面量至少 1 处 + 两个 kill 函数各调用一次」——
#    比原来的「字面量 ≥2 处」更强：原断言只能证明字符串在，证明不了它被调用。
EXEMPT_COUNT=$(grep -c '/usr/local/libexec/cecelia/' "$JANITOR")
if [ "$EXEMPT_COUNT" -ge 1 ]; then
  ok "cecelia 常驻路径豁免存在（${EXEMPT_COUNT}处）"
else
  fail "cecelia 常驻路径豁免缺失（当前${EXEMPT_COUNT}处）"
fi

CALL_COUNT=$(grep -c 'is_exempt_resident_service "\$pid" "\$cmd" && return' "$JANITOR")
if [ "$CALL_COUNT" -ge 2 ]; then
  ok "两个 kill 函数都调用豁免判据（${CALL_COUNT}处）"
else
  fail "豁免判据未被两个 kill 函数调用（当前${CALL_COUNT}处）——豁免写了但没接线等于没写"
fi

# 2. 禁用过宽匹配：不得出现裸 *cecelia* 匹配（会误豁免 perfect21/cecelia* 开发目录）
if grep -qE 'in \*cecelia\*' "$JANITOR"; then
  fail "检测到过宽的 *cecelia* 裸匹配"
else
  ok "无过宽裸匹配"
fi

# 3. kill-failed 复查分支存在（两处）
KF_COUNT=$(grep -c '\[frequent\] kill-failed' "$JANITOR")
if [ "$KF_COUNT" -ge 2 ]; then
  ok "kill-failed 复查分支存在（${KF_COUNT}处）"
else
  fail "kill-failed 复查分支缺失或不足两处（当前${KF_COUNT}处）"
fi

# 4. 行序：每个 KILLED 自增之前必须先有 kill-failed 复查（用 awk 检查每个
#    'KILLED=$((KILLED + 1))' 行号之前 12 行内出现过 kill-failed）。
#    行序正则只认 KILLED=$((KILLED + 1)) 精确形态，重构计数写法须同步本断言。
ORDER_OK=$(awk '
  /^[[:space:]]*#/ { next }
  /kill-failed/ { last_kf = NR }
  /KILLED=\$\(\(KILLED \+ 1\)\)/ { if (last_kf == 0 || NR - last_kf > 12) bad = 1 }
  END { print (bad ? "BAD" : "OK") }
' "$JANITOR")
if [ "$ORDER_OK" = "OK" ]; then
  ok "KILLED 计数均在 kill-failed 复查之后"
else
  fail "存在未经复查即计数的 KILLED 自增"
fi

echo "结果: PASS=$PASS FAIL=$FAIL"
[ "$FAIL" -eq 0 ] || exit 1
exit 0
