#!/usr/bin/env bash
# 永久回归：system LaunchDaemon 托管服务及其子孙不应被误当孤儿。
# 原任务 3362c876-447a-49ef-a2df-b0773d880d88；仅调用真实Janitor判据，不执行清理。

set -uo pipefail
PASS=0; FAIL=0
ok()   { echo "PASS: $1"; PASS=$((PASS + 1)); }
fail() { echo "FAIL: $1"; FAIL=$((FAIL + 1)); }

JANITOR="$(dirname "$0")/../../janitor.sh"
[ -f "$JANITOR" ] || { echo "ERROR: janitor.sh not found"; exit 1; }

# ── 提取被测函数（顶层定义，闭合 } 在第 0 列）────────────────────────────
EXTRACT="$(awk '
  /^(launchd_managed_pids|_ppid_of|is_exempt_resident_service)\(\)[[:space:]]*\{/ { on = 1 }
  on { print }
  on && /^\}/ { on = 0 }
' "$JANITOR")"

if [ -z "$EXTRACT" ]; then
  fail "janitor.sh 未定义顶层函数 launchd_managed_pids / _ppid_of / is_exempt_resident_service"
  echo "--- 测试结果：PASS=$PASS FAIL=$FAIL ---"
  exit 1
fi

assert() {
  local want="$1" got="$2" desc="$3"
  # 必须用 ${desc} 花括号：紧跟其后的全角括号是多字节字符，bash 会把首字节吃进
  # 变量名，set -u 下报 "desc?: unbound variable"。这条 bug 只在断言失败时才触发，
  # 首次写完全绿所以一直没暴露 —— 失败分支本身也要被执行过才算数。
  if [ "$want" = "$got" ]; then ok "${desc}"; else fail "${desc}（期望 ${want}，实得 ${got}）"; fi
}

# ── F. 真实launchctl输出结构：user域无Gateway，system服务表才有它 ─────────
# 不注入PID白名单：必须实际调用生产发现函数，metadata里的PID不能算服务。
run_domain_case() (
  eval "$EXTRACT"
  _LAUNCHD_PIDS_CACHE=""
  JANITOR_LAUNCHD_PIDS=""
  JANITOR_PPID_MAP='55007:1 55008:55007 55009:55008 88001:1 5500:1 99991:1'
  launchctl() {
    case "$*" in
      list) printf 'PID\tStatus\tLabel\n12345\t0\tai.user.service\n-\t0\tai.idle.service\n' ;;
      'print system') cat <<'SYSTEM'
system = {
    other_metadata = {
        99991 0 not.a.service
    }
    services = {
        55007 -9 ai.openclaw.gateway
        0 - com.apple.not.running
        - 0 com.apple.idle
    }
    endpoints = {
        88001 0 must.not.be.exempt
    }
}
SYSTEM
      ;;
      *) return 1 ;;
    esac
  }
  if is_exempt_resident_service "$1" 'node /fixture/process.js'; then echo EXEMPT; else echo KILLABLE; fi
)
assert EXEMPT "$(run_domain_case 55007)" "system域Gateway从真实服务表发现，不依赖user域list"
assert EXEMPT "$(run_domain_case 55008)" "system域Gateway直接子进程豁免"
assert EXEMPT "$(run_domain_case 55009)" "system域Gateway孙进程豁免"
assert EXEMPT "$(run_domain_case 12345)" "user域服务保持兼容"
assert KILLABLE "$(run_domain_case 88001)" "system域表外PID不能误豁免，真正孤儿仍可回收"
assert KILLABLE "$(run_domain_case 99991)" "metadata数值不能当托管服务PID"
assert KILLABLE "$(run_domain_case 5500)" "system域PID保持精确匹配"

echo "--- 测试结果：PASS=$PASS FAIL=$FAIL ---"
[ "$FAIL" -eq 0 ]
