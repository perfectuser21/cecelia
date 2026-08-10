#!/usr/bin/env bash
# 回归守卫：etime_to_secs 八进制换算炸弹（2026-08-05，决策 616183dc）
# 根因：ps -o etime 的 DD- 前缀 days=08/09（进程运行满 8~9 天）被 bash 按八进制解析，
# 致命算术错误 → $() 子 shell 退出 → 函数返回空串 → 调用点阈值比较 fail-open 穿透。
# 本测试从 janitor.sh 实文件提取函数体执行——实现改回旧写法必然报红。

set -uo pipefail

PASS=0
FAIL=0

ok() { echo "PASS: $1"; PASS=$((PASS + 1)); }
fail() { echo "FAIL: $1"; FAIL=$((FAIL + 1)); }

JANITOR="$(dirname "$0")/../janitor.sh"
if [ ! -f "$JANITOR" ]; then
  echo "ERROR: janitor.sh not found at $JANITOR"
  exit 1
fi

# 从实文件提取 etime_to_secs 函数体（两空格缩进定义）
FN_SRC=$(sed -n '/^  etime_to_secs() {/,/^  }/p' "$JANITOR")
if [ -z "$FN_SRC" ]; then
  fail "无法从 janitor.sh 提取 etime_to_secs 函数体"
  echo "结果: PASS=$PASS FAIL=$FAIL"
  exit 1
fi
eval "$FN_SRC"

# 断言：样本 → 期望秒数，且 stderr 必须干净（八进制炸弹的症状就是 stderr 报错 + 返回空串）
assert_secs() {
  local sample="$1" expected="$2"
  local stderr_file got err
  stderr_file=$(mktemp)
  got=$(etime_to_secs "$sample" 2>"$stderr_file")
  err=$(cat "$stderr_file")
  rm -f "$stderr_file"
  if [ "$got" = "$expected" ] && [ -z "$err" ]; then
    ok "etime_to_secs '$sample' → $expected"
  else
    fail "etime_to_secs '$sample' → got='$got' expected='$expected' stderr='$err'"
  fi
}

assert_secs "08-16:10:29" 749429   # 真实触发形态：days=08 八进制炸点（2026-08 现场 pid 64880）
assert_secs "09-00:00:01" 777601   # days=09 炸点
assert_secs "3-08:00:00" 288000    # 单位数 days + HH=08
assert_secs "1-02:03:04" 93784     # 正常 days 回归
assert_secs "00:08:30" 510         # HH=00 + MM=08
assert_secs "08:09" 489            # MM:SS 两段形态
assert_secs "45" 45                # 单段形态
assert_secs "" 0                   # 空串兜底出口
assert_secs "garbage" 0            # 非法输入兜底出口

echo "结果: PASS=$PASS FAIL=$FAIL"
[ "$FAIL" -eq 0 ] || exit 1
exit 0
