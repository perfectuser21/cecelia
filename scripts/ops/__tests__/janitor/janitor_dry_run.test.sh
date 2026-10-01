#!/usr/bin/env bash
# 运行真实入口，所有进程/容器/网络动作均由导出函数隔离，绝不运行生产清理。
set -euo pipefail
JANITOR_SOURCE="$(cd "$(dirname "$0")/../.." && pwd)"
JANITOR_FIXTURE_ROOT=$(mktemp -d)
trap 'rm -rf "$JANITOR_FIXTURE_ROOT"' EXIT
mkdir -p "$JANITOR_FIXTURE_ROOT/repo/scripts/ops"
cp "$JANITOR_SOURCE/janitor.sh" "$JANITOR_FIXTURE_ROOT/repo/scripts/ops/"
if [ -f "$JANITOR_SOURCE/janitor-effects.sh" ]; then
  cp "$JANITOR_SOURCE/janitor-effects.sh" "$JANITOR_FIXTURE_ROOT/repo/scripts/ops/"
fi
export JANITOR_EFFECT_LOG="$JANITOR_FIXTURE_ROOT/effects"

record_effect() { printf '%s\n' "$*" >> "$JANITOR_EFFECT_LOG"; }
kill() {
  if [ "${1:-}" = "-0" ]; then return 1; fi
  record_effect "kill $*"
}
sudo() { record_effect "sudo $*"; }
docker() {
  if [ "${1:-}" = "info" ]; then return 0; fi
  record_effect "docker $*"
  printf 'Total reclaimed space: 1MB\n'
}
curl() {
  case " $* " in
    *' -X '*|*' --request '*|*' -d '*) record_effect "curl-write $*"; printf '{}\n' ;;
    *) printf '[]\n' ;;
  esac
}
sleep() { :; }
lsof() { :; }
launchctl() { :; }
pgrep() { [ "${2:-}" = audiomxd ] && printf '900003\n'; return 0; }
sysctl() {
  case "${2:-}" in
    hw.memsize) printf '16777216\n' ;;
    hw.pagesize) printf '4096\n' ;;
    hw.logicalcpu) printf '4\n' ;;
    vm.loadavg) printf '{ 10 10 10 }\n' ;;
  esac
}
vm_stat() { printf 'Pages free: 100.\nPages speculative: 0.\n'; }
ps() {
  case "$*" in
    aux) printf 'user 900001 0 0 0 0 ?? S 0 0 node /fixture/worker.js\nuser 900002 0 0 0 0 ?? S 0 0 claude -p fixture\n' ;;
    *etime=*) printf '20:00\n' ;;
    *tty=*) printf '??\n' ;;
    *ppid=*) printf '1\n' ;;
    *command=*) printf 'one-off\n' ;;
    *%cpu=*) printf '95.0\n' ;;
    *nice=*) printf '0\n' ;;
    *comm=*) printf 'launchd\n' ;;
  esac
}
export -f record_effect kill sudo docker curl sleep lsof launchctl pgrep sysctl vm_stat ps
export JANITOR_LAUNCHD_PIDS=900099 JANITOR_PPID_MAP='900001:1 900002:1'
export JANITOR_NO_REBOOT=1 BRAIN_URL='http://127.0.0.1:1'

FAIL=0
run_case() {
  local label="$1" kb="$2" hour="$3" tz="$4" mode="$5"
  local out="$JANITOR_FIXTURE_ROOT/$label.log"
  : > "$JANITOR_EFFECT_LOG"
  if [ "$mode" = dry ]; then
    KALLOC_KB="$kb" KALLOC_HOUR="$hour" KALLOC_SAFE_TZ="$tz" \
      bash "$JANITOR_FIXTURE_ROOT/repo/scripts/ops/janitor.sh" --mode frequent --dry-run > "$out" 2>&1
    if [ -s "$JANITOR_EFFECT_LOG" ]; then
      printf 'FAIL: %s dry-run执行了写动作\n' "$label"
      cat "$JANITOR_EFFECT_LOG"
      FAIL=$((FAIL + 1))
    else
      # 必须确实看到了候选，防止扫描被短路而产生假绿。
      for marker in 'node/vitest' 'claude' 'audiomxd' 'prune' 'CPU' 'kalloc'; do
        if ! grep -q "$marker" "$out"; then
          printf 'FAIL: %s 缺少候选观察 %s\n' "$label" "$marker"
          FAIL=$((FAIL + 1))
        fi
      done
      printf 'PASS: %s 真实入口零写动作\n' "$label"
    fi
  else
    KALLOC_KB="$kb" KALLOC_HOUR="$hour" KALLOC_SAFE_TZ="$tz" \
      bash "$JANITOR_FIXTURE_ROOT/repo/scripts/ops/janitor.sh" --mode frequent > "$out" 2>&1
    for effect in 'kill 900001' 'kill 900002' 'taskpolicy' 'renice' 'container prune' 'curl-write'; do
      if ! grep -q "$effect" "$JANITOR_EFFECT_LOG"; then
        printf 'FAIL: 正常模式丢失既有模拟动作 %s\n' "$effect"
        FAIL=$((FAIL + 1))
      fi
    done
    grep -q 'killed 2 个孤儿进程' "$out" || { printf 'FAIL: 正常清理计数\n'; FAIL=$((FAIL + 1)); }
    printf 'PASS: 正常模式执行受控模拟动作\n'
  fi
}
run_case alert "$((5*1024*1024))" 10 Asia/Shanghai dry
run_case critical_unsafe "$((7*1024*1024))" 10 Asia/Shanghai dry
run_case critical_safe "$((7*1024*1024))" 04 Asia/Shanghai dry
run_case invalid_timezone "$((7*1024*1024))" '' Invalid/JanitorFixture dry
run_case normal "$((5*1024*1024))" 10 Asia/Shanghai apply
[ "$FAIL" -eq 0 ]
