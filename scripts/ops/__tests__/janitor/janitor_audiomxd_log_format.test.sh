#!/usr/bin/env bash
# 真实执行行为测试（非静态 grep）：验证 audiomxd 兜底清理日志行在 bash 下
# 能正确渲染 PID，不会被"未加花括号的 $var 紧贴全角字符"这个 bash 解析
# 陷阱吃掉（2026-07-28 现场验证 audiomxd 死循环 watchdog 时发现：bash 3.2.57
# 与 5.3.15 均复现——变量值整个丢失，紧跟的多字节字符还被截断首字节，
# bug 严重时甚至把截断后的字节并入变量名，导致 unbound variable 报错）。

set -euo pipefail

PASS=0
FAIL=0

ok() { echo "PASS: $1"; PASS=$((PASS + 1)); }
fail() { echo "FAIL: $1"; FAIL=$((FAIL + 1)); }

JANITOR="$(dirname "$0")/../../janitor.sh"
if [ ! -f "$JANITOR" ]; then
  echo "ERROR: janitor.sh not found at $JANITOR"
  exit 1
fi

# 从 janitor.sh 里原样抽取 audiomxd kill 成功后的那行 echo 语句（不是重新抄一遍逻辑，
# 直接跑文件里真实存在的那行，避免"测试和实现各写一份、实现改了测试没跟着改"）。
ECHO_LINE=$(grep -m1 "jailed audiomxd pid=" "$JANITOR")
if [ -z "$ECHO_LINE" ]; then
  fail "在 janitor.sh 里找不到 audiomxd kill 日志行"
  echo ""
  echo "结果: $PASS 通过 / $FAIL 失败"
  exit 1
fi

# 用假的 PID/CPU 值真实执行这行 echo（不碰真实进程，不需要 sudo/pgrep）。
# set +u：这个 bug 本身可能导致变量名被解析错乱触发 unbound variable，
# 不能让它把整个测试脚本带崩，容错捕获后走 FAIL 分支上报。
audiomxd_pid="738291"
audiomxd_cpu="87"
set +u
ACTUAL_OUTPUT=$(eval "$ECHO_LINE" 2>&1) || true
set -u

if [ -z "$ACTUAL_OUTPUT" ]; then
  fail "日志行执行后无任何输出"
else
  # 验证 1：假 PID 的完整数字必须原样出现在输出里
  if echo "$ACTUAL_OUTPUT" | grep -q "pid=${audiomxd_pid}"; then
    ok "日志行正确渲染出完整 PID（pid=${audiomxd_pid}）"
  else
    fail "日志行未正确渲染 PID，实际输出: $ACTUAL_OUTPUT"
  fi

  # 验证 2：假 CPU 值必须原样出现
  if echo "$ACTUAL_OUTPUT" | grep -q "CPU ${audiomxd_cpu}%"; then
    ok "日志行正确渲染出 CPU 占用（CPU ${audiomxd_cpu}%）"
  else
    fail "日志行未正确渲染 CPU 占用，实际输出: $ACTUAL_OUTPUT"
  fi

  # 验证 3：PID 与紧邻的全角字符之间不能有 bash 变量名边界解析错误
  EXPECTED_SUBSTR="pid=${audiomxd_pid}（CPU ${audiomxd_cpu}%"
  if echo "$ACTUAL_OUTPUT" | grep -qF "$EXPECTED_SUBSTR"; then
    ok "PID 与紧邻的全角字符之间没有发生 bash 变量名边界解析错误"
  else
    fail "PID 与全角字符邻接处仍有解析错误，期望子串: [$EXPECTED_SUBSTR]，实际输出: $ACTUAL_OUTPUT"
  fi
fi

echo ""
echo "结果: $PASS 通过 / $FAIL 失败"
[ "$FAIL" -eq 0 ] && exit 0 || exit 1
