#!/usr/bin/env bash
# 回归守卫：kalloc.1024 内核内存泄漏哨兵（2026-09-18 事故）
# 事故：mmv 本机 kalloc.1024 从正常几 MB 涨到 12.7GB，占满 wired 内存，
# kernel_task CPU 91%，机器卡死，必须重启才能回收（zprint -g 触发 zone GC 回收不掉，
# 证实是真泄漏非缓存）。Apple Silicon + SIP enabled，无法远程开 boot-arg zlog1
# 做函数级泄漏追踪定位元凶，只能"早发现早处理"：三档阈值 WARN(4G,仅日志) /
# ALERT(8G,Brain P1告警) / CRITICAL(11G,凌晨3-5点安全时段自动重启止损)。
# 用户明确要求复用 janitor 既有清扫机制而非新建独立 launchd 哨兵（决策 64d38870）。
#
# 本测试从 janitor.sh 实文件提取 check_kalloc_guard 函数体执行（同 etime_to_secs
# 测试先例），用 KALLOC_KB/KALLOC_HOUR 环境变量注入真实值（同 DISK_PCT 约定）
# proven-to-fire 验证三档分支真能触发。curl/sudo/sleep 全部 mock 掉——
# 绝不能在测试中真的打 Brain API 或真的执行 shutdown/等待 30 秒。

set -uo pipefail

PASS=0
FAIL=0

ok() { echo "PASS: $1"; PASS=$((PASS + 1)); }
fail() { echo "FAIL: $1"; FAIL=$((FAIL + 1)); }

JANITOR="$(dirname "$0")/../../janitor.sh"
if [ ! -f "$JANITOR" ]; then
  echo "ERROR: janitor.sh not found at $JANITOR"
  exit 1
fi

# 源码级断言：KALLOC_KB 注入支持 + 合法 task_type
if grep -q 'KALLOC_KB' "$JANITOR"; then
  ok "janitor.sh 支持 KALLOC_KB 环境变量注入"
else
  fail "janitor.sh 缺少 KALLOC_KB 环境变量注入支持"
fi

KALLOC_BLOCK=$(sed -n '/^  check_kalloc_guard() {$/,/^  }$/p' "$JANITOR")
if [ -z "$KALLOC_BLOCK" ]; then
  fail "无法从 janitor.sh 提取 check_kalloc_guard 函数体"
  echo "结果: PASS=$PASS FAIL=$FAIL"
  exit 1
fi
ok "成功提取 check_kalloc_guard 函数体"

if echo "$KALLOC_BLOCK" | grep -q 'task_type\\":\\"alert\\"'; then
  fail "check_kalloc_guard 函数体里用了非法 task_type=\"alert\""
else
  ok "check_kalloc_guard 函数体无非法 task_type=\"alert\""
fi
if echo "$KALLOC_BLOCK" | grep -q 'task_type\\":\\"harness_intervention\\"'; then
  ok "check_kalloc_guard 函数体使用合法 task_type=harness_intervention"
else
  fail "check_kalloc_guard 函数体缺少合法 task_type=harness_intervention"
fi

# ── 行为级断言：mock curl/sudo/sleep 后 eval 函数体，逐档注入真实值 ──
run_guard() {
  local kb="$1" hour="${2:-}"
  (
    # mock：curl 只回显被调用过，sudo 只回显被调用过（绝不真发请求/真重启），
    # sleep 直接跳过（绝不真等 30 秒）
    curl() { echo "MOCK_CURL"; }
    sudo() { echo "MOCK_SUDO: $*"; }
    sleep() { :; }
    BRAIN_URL="http://mock-brain-url"
    eval "$KALLOC_BLOCK"
    KALLOC_KB="$kb"
    [ -n "$hour" ] && KALLOC_HOUR="$hour"
    check_kalloc_guard
  ) 2>&1
}

# 正常值：无告警输出
OUT_NORMAL=$(run_guard 10000)
if ! echo "$OUT_NORMAL" | grep -qE 'kalloc\.1024'; then
  ok "正常值(10000KB≈0.01GB)不触发任何 kalloc 日志"
else
  fail "正常值不应有 kalloc 日志，实际输出: $OUT_NORMAL"
fi

# 边界下侧：3GB 差 1KB → 仍静默（验证 WARN 线的下边界）
KB_BELOW_WARN=$((3*1024*1024 - 1))
OUT_BELOW=$(run_guard "$KB_BELOW_WARN")
if ! echo "$OUT_BELOW" | grep -qE 'kalloc\.1024'; then
  ok "WARN 线下方(3GB-1KB)不触发任何 kalloc 日志"
else
  fail "WARN 线下方不应有 kalloc 日志，实际输出: $OUT_BELOW"
fi

# WARN 档：正好 3GB（边界等号侧），仅记日志，不调用 curl
KB_WARN=$((3*1024*1024))
OUT_WARN=$(run_guard "$KB_WARN")
if echo "$OUT_WARN" | grep -q '早期预警' && ! echo "$OUT_WARN" | grep -q 'MOCK_CURL'; then
  ok "WARN 档(3GB，边界等号侧)仅记日志，未调用 Brain 告警"
else
  fail "WARN 档预期'早期预警'且无 curl 调用，实际输出: $OUT_WARN"
fi

# ALERT 档：正好 5GB（边界等号侧），触发'偏高'日志 + 调用 curl
OUT_ALERT=$(run_guard $((5*1024*1024)))
if echo "$OUT_ALERT" | grep -q 'kalloc\.1024 偏高' && echo "$OUT_ALERT" | grep -q 'MOCK_CURL'; then
  ok "ALERT 档(5GB，边界等号侧)触发'kalloc.1024 偏高'并调用 Brain 告警"
else
  fail "ALERT 档预期'偏高'+curl调用，实际输出: $OUT_ALERT"
fi

# CRITICAL 档，非安全时段（10点）：仅告警，不 mock 到 sudo shutdown 调用
OUT_CRIT_UNSAFE=$(run_guard $((7*1024*1024)) 10)
if echo "$OUT_CRIT_UNSAFE" | grep -q 'kalloc\.1024 危险.*非安全时段仅告警' \
   && echo "$OUT_CRIT_UNSAFE" | grep -q 'MOCK_CURL' \
   && ! echo "$OUT_CRIT_UNSAFE" | grep -q 'MOCK_SUDO'; then
  ok "CRITICAL 档(7GB，边界等号侧)非安全时段(10点)仅告警，未触发重启"
else
  fail "CRITICAL 非安全时段预期仅告警不重启，实际输出: $OUT_CRIT_UNSAFE"
fi

# CRITICAL 档，安全时段（4点）：触发 mock 重启（sudo shutdown 被调用）
OUT_CRIT_SAFE=$(run_guard $((7*1024*1024)) 04)
if echo "$OUT_CRIT_SAFE" | grep -q 'kalloc\.1024 危险.*安全时段内自动重启止损' \
   && echo "$OUT_CRIT_SAFE" | grep -q 'MOCK_CURL' \
   && echo "$OUT_CRIT_SAFE" | grep -q 'MOCK_SUDO: -n shutdown -r now'; then
  ok "CRITICAL 档(7GB，边界等号侧)安全时段(4点)触发自动重启止损"
else
  fail "CRITICAL 安全时段预期触发重启，实际输出: $OUT_CRIT_SAFE"
fi

# 八进制炸弹回归：hour="08"/"09" 前导零若未加 10# 前缀，bash 算术解析会报错
# （同 etime_to_secs 教训，本仓库已实证复现过一次）
STDERR_08=$(mktemp)
OUT_CRIT_OCTAL=$(run_guard $((7*1024*1024)) 08 2>"$STDERR_08")
ERR_08=$(cat "$STDERR_08"); rm -f "$STDERR_08"
if [ -z "$ERR_08" ] && echo "$OUT_CRIT_OCTAL" | grep -q '非安全时段仅告警'; then
  ok "hour=08 无八进制解析错误，正确判定为非安全时段"
else
  fail "hour=08 触发八进制解析错误或误判，stderr='$ERR_08' 输出=$OUT_CRIT_OCTAL"
fi

echo "结果: PASS=$PASS FAIL=$FAIL"
[ "$FAIL" -eq 0 ] || exit 1
exit 0
