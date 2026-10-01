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
  if [ "${1:-}" = "-0" ]; then
    [ "${JANITOR_TEST_KILL_ALIVE:-0}" = 1 ] && return 0
    return 1
  fi
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
  local entry="${6:-$JANITOR_FIXTURE_ROOT/repo/scripts/ops/janitor.sh}"
  : > "$JANITOR_EFFECT_LOG"
  if [ "$mode" = dry ]; then
    KALLOC_KB="$kb" KALLOC_HOUR="$hour" KALLOC_SAFE_TZ="$tz" \
      bash "$entry" --mode frequent --dry-run > "$out" 2>&1
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
    JANITOR_TEST_KILL_ALIVE=$([ "$mode" = apply_alive ] && printf 1 || printf 0) \
      KALLOC_KB="$kb" KALLOC_HOUR="$hour" KALLOC_SAFE_TZ="$tz" \
      bash "$entry" --mode frequent > "$out" 2>&1
    for effect in 'kill 900001' 'kill 900002' 'taskpolicy' 'renice' 'container prune' 'curl-write'; do
      if ! grep -q "$effect" "$JANITOR_EFFECT_LOG"; then
        printf 'FAIL: 正常模式丢失既有模拟动作 %s\n' "$effect"
        FAIL=$((FAIL + 1))
      fi
    done
    if [ "$mode" = apply_alive ]; then
      if [ "$(grep -c 'kill-failed' "$out")" != 2 ] || grep -q '清理完成' "$out"; then
        printf 'FAIL: 进程仍存活却计为清理成功\n'; FAIL=$((FAIL + 1))
      fi
    else
      grep -q 'killed 2 个孤儿进程' "$out" || { printf 'FAIL: 正常清理计数\n'; FAIL=$((FAIL + 1)); }
    fi
    printf 'PASS: 正常模式执行受控模拟动作\n'
  fi
  if grep -q 'command not found' "$out"; then
    printf 'FAIL: %s 执行依赖缺失\n' "$label"; FAIL=$((FAIL + 1))
  fi
}
mkdir -p "$JANITOR_FIXTURE_ROOT/bin"
ln -s "$JANITOR_FIXTURE_ROOT/repo/scripts/ops/janitor.sh" "$JANITOR_FIXTURE_ROOT/bin/janitor.sh"
run_case symlink "$((5*1024*1024))" 10 Asia/Shanghai dry "$JANITOR_FIXTURE_ROOT/bin/janitor.sh"
run_case alert "$((5*1024*1024))" 10 Asia/Shanghai dry
run_case critical_unsafe "$((7*1024*1024))" 10 Asia/Shanghai dry
run_case critical_safe "$((7*1024*1024))" 04 Asia/Shanghai dry
run_case invalid_timezone "$((7*1024*1024))" '' Invalid/JanitorFixture dry
run_case normal "$((5*1024*1024))" 10 Asia/Shanghai apply
run_case alive "$((5*1024*1024))" 10 Asia/Shanghai apply_alive

# 即使被独立调用，孤儿回执的PATCH/POST也必须服从观察模式。
source "$JANITOR_SOURCE/janitor-effects.sh"
eval "$(sed -n '/^  notify_brain_orphan_killed() {$/,/^  }$/p' "$JANITOR_SOURCE/janitor.sh")"
mkdir -p "$JANITOR_FIXTURE_ROOT/notify"
for task_line in 'task_id: fixture-task' ''; do
  printf 'branch: cp-fixture\n%s\n' "$task_line" > "$JANITOR_FIXTURE_ROOT/notify/.dev-lock.fixture"
  : > "$JANITOR_EFFECT_LOG"
  DRY_RUN=true notify_brain_orphan_killed 900002 "$JANITOR_FIXTURE_ROOT/notify"
  [ ! -s "$JANITOR_EFFECT_LOG" ] || { printf 'FAIL: 观察模式写入孤儿回执\n'; FAIL=$((FAIL + 1)); }
done

# 观察挡板加载失败必须退出，不能穿透执行。
mkdir -p "$JANITOR_FIXTURE_ROOT/missing/scripts/ops"
cp "$JANITOR_SOURCE/janitor.sh" "$JANITOR_FIXTURE_ROOT/missing/scripts/ops/"
: > "$JANITOR_EFFECT_LOG"
if bash "$JANITOR_FIXTURE_ROOT/missing/scripts/ops/janitor.sh" --mode frequent --dry-run > /dev/null 2>&1; then
  printf 'FAIL: 缺失观察挡板仍继续运行\n'; FAIL=$((FAIL + 1))
fi
[ ! -s "$JANITOR_EFFECT_LOG" ] || { printf 'FAIL: 缺失挡板发生写动作\n'; FAIL=$((FAIL + 1)); }
[ "$FAIL" -eq 0 ]
