#!/usr/bin/env bash
# 回归守卫：kalloc.1024 内核内存泄漏哨兵（2026-09-18 事故）
# 事故：mmv 本机 kalloc.1024 从正常几 MB 涨到 12.7GB，占满 wired 内存，
# kernel_task CPU 91%，机器卡死，必须重启才能回收（zprint -g 触发 zone GC 回收不掉，
# 证实是真泄漏非缓存）。Apple Silicon + SIP enabled，无法远程开 boot-arg zlog1
# 做函数级泄漏追踪定位元凶，只能"早发现早处理"：三档阈值
# WARN(3G,仅日志) / ALERT(5G,Brain P1告警) / CRITICAL(7G,安全时段自动重启止损)。
# 用户明确要求复用 janitor 既有清扫机制而非新建独立 launchd 哨兵（决策 64d38870）。
#
# 本测试从 janitor.sh 实文件提取函数体执行（同 etime_to_secs 测试先例），
# 用 KALLOC_KB/KALLOC_HOUR 环境变量注入真实值（同 DISK_PCT 约定）。
#
# ⚠️ 绝不能真重启这台生产机。三道防线：
#   ① 子 shell 里 sudo/curl/sleep 是 shell 函数（拦住 `sudo ...` 写法）
#   ② PATH 前置 stub 目录（拦住 `command sudo` / 绝对路径 / osascript 等绕过函数的写法）
#   ③ 代码里的 JANITOR_NO_REBOOT 闸（最后一道，不依赖测试文件怎么写）
#
# 2026-09-25 新增（决策 c70beb74）：时区独立性 / 非法时区 fail-closed / title 粗桶不嵌
# 精确值 / 文案取常量 / --dry-run 拦重启 / JANITOR_NO_REBOOT 闸 / CPU 告警同病灶。
# 教训：旧版所有 CRITICAL 用例都注入 KALLOC_HOUR，恰好绕开 `date +%H`——
# 被注入的那个变量正是藏着 bug 的那个，于是时区从未被测过。

set -uo pipefail

PASS=0
FAIL=0

ok() { echo "PASS: $1"; PASS=$((PASS + 1)); }
fail() { echo "FAIL: $1"; FAIL=$((FAIL + 1)); }

JANITOR="$(dirname "$0")/../../janitor.sh"
if [ ! -f "${JANITOR}" ]; then
  echo "ERROR: janitor.sh not found at ${JANITOR}"
  exit 1
fi

# ── 防线②：PATH stub，拦住绕过 shell 函数 mock 的所有写法 ──────────────
STUB_DIR=$(mktemp -d)
trap 'rm -rf "${STUB_DIR}"' EXIT
for c in sudo shutdown osascript reboot halt; do
  printf '#!/bin/sh\necho "STUB:%s $*"\n' "${c}" > "${STUB_DIR}/${c}"
  chmod +x "${STUB_DIR}/${c}"
done

# 源码级断言：KALLOC_KB 注入支持 + 合法 task_type
if grep -q 'KALLOC_KB' "${JANITOR}"; then
  ok "janitor.sh 支持 KALLOC_KB 环境变量注入"
else
  fail "janitor.sh 缺少 KALLOC_KB 环境变量注入支持"
fi

KALLOC_BLOCK=$(sed -n '/^  check_kalloc_guard() {$/,/^  }$/p' "${JANITOR}")
if [ -z "${KALLOC_BLOCK}" ]; then
  fail "无法从 janitor.sh 提取 check_kalloc_guard 函数体"
  echo "结果: PASS=${PASS} FAIL=${FAIL}"
  exit 1
fi
ok "成功提取 check_kalloc_guard 函数体"

if echo "${KALLOC_BLOCK}" | grep -q 'task_type\\":\\"alert\\"'; then
  fail "check_kalloc_guard 函数体里用了非法 task_type=\"alert\""
else
  ok "check_kalloc_guard 函数体无非法 task_type=\"alert\""
fi
if echo "${KALLOC_BLOCK}" | grep -q 'task_type\\":\\"harness_intervention\\"'; then
  ok "check_kalloc_guard 函数体使用合法 task_type=harness_intervention"
else
  fail "check_kalloc_guard 函数体缺少合法 task_type=harness_intervention"
fi

# 阈值常量必须定义在【函数体内】。本脚本全文无 set -u，若常量定义在函数外而
# 提取出的块看不见它，$((UNDEF*1024*1024)) 静默取 0 → [ kb -ge 0 ] 恒真 →
# 任何微小 kalloc 都判 CRITICAL 并每 15 分钟重启一次。实测已确认该行为。
for cname in KALLOC_CRITICAL_GB KALLOC_ALERT_GB KALLOC_WARN_GB; do
  if echo "${KALLOC_BLOCK}" | grep -q "${cname}"; then
    ok "阈值常量 ${cname} 定义在 check_kalloc_guard 函数体内"
  else
    fail "阈值常量 ${cname} 不在函数体内（放函数外会因无 set -u 使阈值静默变 0）"
  fi
done

# ── 行为级断言：mock curl/sudo/sleep 后 eval 函数体，逐档注入真实值 ──
run_guard() {
  local kb="$1" hour="${2:-}"
  (
    PATH="${STUB_DIR}:${PATH}"
    # mock：curl 回显完整入参（要断言 payload 里 title/description 长什么样），
    # sudo 只回显被调用过（绝不真重启），sleep 直接跳过（绝不真等 30 秒）
    curl() { echo "MOCK_CURL: $*"; }
    sudo() { echo "MOCK_SUDO: $*"; }
    sleep() { :; }
    BRAIN_URL="http://mock-brain-url"
    DRY_RUN="${DRY_RUN:-false}"
    eval "${KALLOC_BLOCK}"
    KALLOC_KB="${kb}"
    [ -n "${hour}" ] && KALLOC_HOUR="${hour}"
    check_kalloc_guard
  ) 2>&1
}

# 找一个"当地小时正好等于目标值"的时区（Etc/GMT 符号与直觉相反：GMT-3 = UTC+3）
pick_tz_with_hour() {
  local want="$1" off z h
  for off in $(seq -14 14); do
    if [ "${off}" -ge 0 ]; then z="Etc/GMT-${off}"; else z="Etc/GMT+$(( -off ))"; fi
    h=$(TZ="${z}" date +%H 2>/dev/null) || continue
    [ -n "${h}" ] || continue
    if [ "$((10#${h}))" -eq "${want}" ]; then echo "${z}"; return 0; fi
  done
  return 1
}

# 正常值：无告警输出（同时也是"阈值没被静默变成 0"的行为级守卫）
OUT_NORMAL=$(run_guard 10000)
if ! echo "${OUT_NORMAL}" | grep -qE 'kalloc\.1024'; then
  ok "正常值(10000KB≈0.01GB)不触发任何 kalloc 日志"
else
  fail "正常值不应有 kalloc 日志，实际输出: ${OUT_NORMAL}"
fi

# 边界下侧：3GB 差 1KB → 仍静默（验证 WARN 线的下边界）
KB_BELOW_WARN=$((3*1024*1024 - 1))
OUT_BELOW=$(run_guard "${KB_BELOW_WARN}")
if ! echo "${OUT_BELOW}" | grep -qE 'kalloc\.1024'; then
  ok "WARN 线下方(3GB-1KB)不触发任何 kalloc 日志"
else
  fail "WARN 线下方不应有 kalloc 日志，实际输出: ${OUT_BELOW}"
fi

# WARN 档：正好 3GB（边界等号侧），仅记日志，不调用 curl
KB_WARN=$((3*1024*1024))
OUT_WARN=$(run_guard "${KB_WARN}")
if echo "${OUT_WARN}" | grep -q '早期预警' && ! echo "${OUT_WARN}" | grep -q 'MOCK_CURL'; then
  ok "WARN 档(3GB，边界等号侧)仅记日志，未调用 Brain 告警"
else
  fail "WARN 档预期'早期预警'且无 curl 调用，实际输出: ${OUT_WARN}"
fi

# ALERT 档：正好 5GB（边界等号侧），触发'偏高'日志 + 调用 curl
OUT_ALERT=$(run_guard $((5*1024*1024)))
if echo "${OUT_ALERT}" | grep -q 'kalloc\.1024 偏高' && echo "${OUT_ALERT}" | grep -q 'MOCK_CURL'; then
  ok "ALERT 档(5GB，边界等号侧)触发'kalloc.1024 偏高'并调用 Brain 告警"
else
  fail "ALERT 档预期'偏高'+curl调用，实际输出: ${OUT_ALERT}"
fi

# CRITICAL 档，非安全时段（10点）：仅告警，不触发重启
OUT_CRIT_UNSAFE=$(run_guard $((7*1024*1024)) 10)
if echo "${OUT_CRIT_UNSAFE}" | grep -q 'kalloc\.1024 危险.*非安全时段仅告警' \
   && echo "${OUT_CRIT_UNSAFE}" | grep -q 'MOCK_CURL' \
   && ! echo "${OUT_CRIT_UNSAFE}" | grep -q 'shutdown -r now'; then
  ok "CRITICAL 档(7GB，边界等号侧)非安全时段(10点)仅告警，未触发重启"
else
  fail "CRITICAL 非安全时段预期仅告警不重启，实际输出: ${OUT_CRIT_UNSAFE}"
fi

# CRITICAL 档，安全时段（4点）：触发 mock 重启
OUT_CRIT_SAFE=$(run_guard $((7*1024*1024)) 04)
if echo "${OUT_CRIT_SAFE}" | grep -q 'kalloc\.1024 危险.*安全时段内自动重启止损' \
   && echo "${OUT_CRIT_SAFE}" | grep -q 'MOCK_CURL' \
   && echo "${OUT_CRIT_SAFE}" | grep -q 'MOCK_SUDO: -n shutdown -r now'; then
  ok "CRITICAL 档(7GB，边界等号侧)安全时段(4点)触发自动重启止损"
else
  fail "CRITICAL 安全时段预期触发重启，实际输出: ${OUT_CRIT_SAFE}"
fi

# 八进制炸弹回归：hour="08"/"09" 前导零若未加 10# 前缀，bash 算术解析会报错
# （同 etime_to_secs 教训，本仓库已实证复现过一次）
STDERR_08=$(mktemp)
OUT_CRIT_OCTAL=$(run_guard $((7*1024*1024)) 08 2>"${STDERR_08}")
ERR_08=$(cat "${STDERR_08}"); rm -f "${STDERR_08}"
if [ -z "${ERR_08}" ] && echo "${OUT_CRIT_OCTAL}" | grep -q '非安全时段仅告警'; then
  ok "hour=08 无八进制解析错误，正确判定为非安全时段"
else
  fail "hour=08 触发八进制解析错误或误判，stderr='${ERR_08}' 输出=${OUT_CRIT_OCTAL}"
fi

echo "--- 以下为 2026-09-25 新增（决策 c70beb74）---"

# ① 时区独立性：不注入 KALLOC_HOUR，改变【环境时区】不得改变重启判定。
# 这是本次真 bug：cron 无 TZ → 回落 /etc/localtime(America/Los_Angeles) → PDT，
# 判定 3<=hour<5 实为北京 18:00-20:00，会在傍晚重启生产机。
TZ_IN=$(pick_tz_with_hour 4 || true)
TZ_OUT=$(pick_tz_with_hour 12 || true)
if [ -z "${TZ_IN}" ] || [ -z "${TZ_OUT}" ]; then
  fail "找不到当地小时为 4 / 12 的时区，无法测时区独立性"
else
  OUT_TZ_A=$(TZ="${TZ_IN}" run_guard $((7*1024*1024)))
  OUT_TZ_B=$(TZ="${TZ_OUT}" run_guard $((7*1024*1024)))
  A_REBOOT=$(echo "${OUT_TZ_A}" | grep -c 'shutdown -r now' || true)
  B_REBOOT=$(echo "${OUT_TZ_B}" | grep -c 'shutdown -r now' || true)
  if [ "${A_REBOOT}" = "${B_REBOOT}" ]; then
    ok "时区独立性：环境 TZ=${TZ_IN}(当地4点) 与 TZ=${TZ_OUT}(当地12点) 重启判定一致"
  else
    fail "时区独立性破：TZ=${TZ_IN} 重启=${A_REBOOT} 次，TZ=${TZ_OUT} 重启=${B_REBOOT} 次（守卫吃了环境时区）"
  fi
fi

# ② 非法/不可解析时区必须 fail-closed 不重启。实测 TZ=Bogus/NoSuchZone date +%H
# 静默回落 UTC 且 exit 0 —— 若不校验，安全时段会悄悄变成 UTC 3-5 = 北京 11-13 点。
if [ -n "${TZ_IN}" ]; then
  OUT_BADTZ=$(TZ="${TZ_IN}" KALLOC_SAFE_TZ="Bogus/NoSuchZone" run_guard $((7*1024*1024)))
  if ! echo "${OUT_BADTZ}" | grep -q 'shutdown -r now'; then
    ok "非法时区 fail-closed：不执行自动重启"
  else
    fail "非法时区仍执行了重启（应 fail-closed），实际输出: ${OUT_BADTZ}"
  fi
  if echo "${OUT_BADTZ}" | grep -qE '时区.*(不可用|无法|不可信)'; then
    ok "非法时区有显式告警输出（不是静默 no-op）"
  else
    fail "非法时区未给出显式告警，实际输出: ${OUT_BADTZ}"
  fi
fi

# ③ title 不得嵌精确 GB 值（打穿 Brain 既有的按 title 去重，实测已造成 ~81 条 kalloc
# 垃圾单）。改为粗桶 title，精确值放 description。
KB_5_50=$((5*1024*1024 + 512*1024))
OUT_BUCKET=$(run_guard "${KB_5_50}")
CURL_LINE=$(echo "${OUT_BUCKET}" | grep 'MOCK_CURL' || true)
if echo "${CURL_LINE}" | grep -q '偏高 5\.5'; then
  fail "ALERT title 仍嵌精确 GB 值（会打穿 Brain title 去重）: ${CURL_LINE}"
else
  ok "ALERT title 未嵌精确 GB 值"
fi
if echo "${CURL_LINE}" | grep -q '5G 档'; then
  ok "ALERT title 使用粗桶标识（5G 档）"
else
  fail "ALERT title 缺少粗桶标识（5G 档），实际: ${CURL_LINE}"
fi
if echo "${CURL_LINE}" | grep -q '5\.50GB'; then
  ok "精确 GB 值仍保留在 description 里（运维看得到真实数值）"
else
  fail "description 丢了精确 GB 值，实际: ${CURL_LINE}"
fi

# ④ CRITICAL 文案必须取自常量，不得残留硬编码旧阈值 11GB
OUT_TEXT=$(run_guard $((7*1024*1024)) 12)
if echo "${OUT_TEXT}" | grep -q '11GB'; then
  fail "CRITICAL description 残留硬编码 11GB（阈值早已改 7G）: ${OUT_TEXT}"
else
  ok "CRITICAL description 无残留硬编码 11GB"
fi
if echo "${OUT_TEXT}" | grep -q '7GB'; then
  ok "CRITICAL description 阈值取自常量（出现 7GB）"
else
  fail "CRITICAL description 未体现当前阈值 7GB，实际: ${OUT_TEXT}"
fi

# ⑤ --dry-run 必须拦住自动重启。现状 DRY_RUN 只在 daily 分支生效，
# 跑 `janitor.sh --mode frequent --dry-run` 会真重启生产机（文件头注释却说"只检测不清理"）。
OUT_DRY=$(DRY_RUN=true run_guard $((7*1024*1024)) 04)
if ! echo "${OUT_DRY}" | grep -q 'shutdown -r now'; then
  ok "--dry-run 下不执行自动重启"
else
  fail "--dry-run 下仍执行了重启，实际输出: ${OUT_DRY}"
fi
if echo "${OUT_DRY}" | grep -q 'DRY-RUN'; then
  ok "--dry-run 下有显式 DRY-RUN 标记"
else
  fail "--dry-run 下缺少 DRY-RUN 标记，实际输出: ${OUT_DRY}"
fi

# ⑥ JANITOR_NO_REBOOT 闸（第三道防线，写在代码里而非测试文件里：
# 即使将来有人把重启改成 `command sudo` / osascript 等绕过 mock 的写法，这道闸仍然拦得住）
OUT_GATE=$(JANITOR_NO_REBOOT=1 run_guard $((7*1024*1024)) 04)
if ! echo "${OUT_GATE}" | grep -q 'shutdown -r now'; then
  ok "JANITOR_NO_REBOOT=1 拦住自动重启"
else
  fail "JANITOR_NO_REBOOT=1 未拦住重启，实际输出: ${OUT_GATE}"
fi

# ⑦ CPU 高压告警同病灶：title 里嵌百分比同样打穿去重（实测已造成 ~15 条垃圾单）
CPU_BLOCK=$(sed -n '/^  check_cpu_pressure_alert() {$/,/^  }$/p' "${JANITOR}")
if [ -z "${CPU_BLOCK}" ]; then
  fail "无法提取 check_cpu_pressure_alert 函数体（CPU 告警需抽成函数才能行为级测试）"
else
  ok "成功提取 check_cpu_pressure_alert 函数体"
  OUT_CPU=$(
    (
      PATH="${STUB_DIR}:${PATH}"
      curl() { echo "MOCK_CURL: $*"; }
      BRAIN_URL="http://mock-brain-url"
      eval "${CPU_BLOCK}"
      CPU_PCT=97
      CPU_ALERT_THRESHOLD=85
      check_cpu_pressure_alert
    ) 2>&1
  )
  CPU_CURL=$(echo "${OUT_CPU}" | grep 'MOCK_CURL' || true)
  if echo "${CPU_CURL}" | grep -q '告警 97%'; then
    fail "CPU 告警 title 仍嵌百分比（打穿 title 去重）: ${CPU_CURL}"
  else
    ok "CPU 告警 title 未嵌百分比"
  fi
  if echo "${CPU_CURL}" | grep -q '97%'; then
    ok "CPU 精确百分比仍保留在 description 里"
  else
    fail "CPU description 丢了精确百分比，实际: ${CPU_CURL}"
  fi
fi

echo "结果: PASS=${PASS} FAIL=${FAIL}"
[ "${FAIL}" -eq 0 ] || exit 1
exit 0
