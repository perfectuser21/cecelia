#!/usr/bin/env bash
# 原脚本副本仅重定位固定路径；所有系统/网络命令都是record-only替身。
set -euo pipefail
ROOT=$(cd "$(dirname "$0")/../../../.." && pwd)
T=$(mktemp -d)
trap 'rm -rf "$T"' EXIT
mkdir -p "$T/bin" "$T/home" "$T/repo/scripts/ops"
export CALLS="$T/calls" FIXTURE_DIR="$T" FIXTURE_MODE=healthy FIXTURE_NOW=1800000000
for cmd in launchctl pkill nohup docker orbctl curl sleep; do
 cat > "$T/bin/$cmd" <<'SH'
#!/bin/bash
cmd=${0##*/}
printf '%s %s\n' "$cmd" "$*" >> "$CALLS"
case "$cmd" in
 sleep|pkill|nohup|orbctl) exit 0 ;;
 launchctl) [[ "$FIXTURE_MODE" = launch_fail ]] && exit 1; touch "$FIXTURE_DIR/restarted"; exit 0 ;;
 curl) [[ "$FIXTURE_MODE" = healthy || -f "$FIXTURE_DIR/restarted" ]] && exit 0; exit 22 ;;
 docker)
  [[ "$1" = info ]] && exit 0
  if [[ "$1" = inspect ]]; then
   if [[ "$FIXTURE_MODE" = healthy || -f "$FIXTURE_DIR/restarted" ]]; then echo running; else echo exited; fi
  elif [[ "$1" = compose ]]; then touch "$FIXTURE_DIR/restarted"; fi
  exit 0 ;;
esac
exit 99
SH
 chmod +x "$T/bin/$cmd"
done
# 共享固定时钟：stat与date不能各读真实秒，否则301秒边界会跨秒退成300。
cat > "$T/bin/date" <<'SH'
#!/bin/bash
[[ "$*" = +%s ]] || exit 99
printf '%s\n' "$FIXTURE_NOW"
SH
chmod +x "$T/bin/date"
# 年龄由替身提供，不依赖BSD/GNU stat差异，也不等待真实TTL。
cat > "$T/bin/stat" <<'SH'
#!/bin/bash
now=$FIXTURE_NOW
echo "$((now - ${FIXTURE_AGE:-0}))"
SH
chmod +x "$T/bin/stat"
export FIXTURE_AGE=0
sed -e "s|/tmp/bridge-keepalive|$T/bridge-keepalive|g" \
 "$ROOT/scripts/ops/bridge-keepalive-check.sh" > "$T/repo/scripts/ops/bridge.sh"
cp "$ROOT/scripts/ops/brain-keepalive-check.sh" "$T/repo/scripts/ops/brain.sh"
run_keeper() {
 env -i HOME="$T/home" PATH="$T/bin:/usr/bin:/bin" FIXTURE_MODE="$FIXTURE_MODE" \
  FIXTURE_DIR="$T" CALLS="$CALLS" FIXTURE_AGE="$FIXTURE_AGE" FIXTURE_NOW="$FIXTURE_NOW" \
  BRAIN_KEEPALIVE_PATH="$T/bin" BRAIN_KEEPALIVE_STATE_DIR="$T" \
  BRAIN_KEEPALIVE_RESTART_WAIT_SECONDS=0 BRAIN_KEEPALIVE_ORBCTL="$T/bin/orbctl" \
  FEISHU_BOT_WEBHOOK='' bash "$T/repo/scripts/ops/$1.sh" > "$T/out" 2>&1
}
reset_case() { : > "$CALLS"; rm -f "$T/restarted" "$T/bridge-keepalive.alerting" "$T/brain-keepalive.alerting"; }
for keeper in brain bridge; do
 reset_case; FIXTURE_MODE=healthy; run_keeper "$keeper"
 ! grep -Eq '^(launchctl|pkill|nohup|docker compose|orbctl) ' "$CALLS"
 reset_case; FIXTURE_MODE=unhealthy; FIXTURE_AGE=0
 touch "$T/$keeper-keepalive.alerting"
 FIXTURE_AGE=300; run_keeper "$keeper"
 grep -q SILENCED "$T/out"
 ! grep -Eq '^(launchctl|pkill|nohup|docker compose) ' "$CALLS"
 FIXTURE_AGE=301; : > "$CALLS"; run_keeper "$keeper"
 if [[ "$keeper" = brain ]]; then
  grep -Fq "docker compose --env-file $T/repo/.env.docker -f $T/repo/docker-compose.yml up -d node-brain" "$CALLS"
 else
  grep -Fxq 'launchctl kickstart system/com.cecelia.bridge' "$CALLS"
  ! grep -Eq '^(pkill|nohup) ' "$CALLS"
 fi
 test ! -e "$T/$keeper-keepalive.alerting"
done
reset_case; FIXTURE_MODE=launch_fail; FIXTURE_AGE=0; run_keeper bridge
# nohup后台记录可能在主脚本退出后一瞬完成，仅轮询本地record文件。
for i in {1..50}; do grep -q '^nohup ' "$CALLS" && break; /bin/sleep 0.01; done
grep -Fxq 'launchctl kickstart system/com.cecelia.bridge' "$CALLS"
grep -Fxq 'pkill -f cecelia-bridge.cjs' "$CALLS"
grep -q '^nohup .*cecelia-bridge.cjs' "$CALLS"
test -f "$T/bridge-keepalive.alerting"
! grep -q 'gui/' "$CALLS"
echo '保活隔离：健康零重启、TTL抑制/过期、生产env-file、system域与失败fallback，通过'
