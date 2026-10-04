#!/bin/bash
# opc-watchdog.sh — OPC Dead-man Watchdog（独立故障域：us-vps）
# V1.2 §3.6 落地：不依赖 OpenClaw/Brain/HK 消息链路；5 分钟探测；
# 连续 3 次失败经独立飞书 webhook 告警（冷却 1h）；每日北京 09:00 存活报到。
# 端点固化为 /api/brain/health——禁止退化为 /api/health（假阴性前科，红线11案例）。
# 真身在本仓库 scripts/ops/us-vps/opc-watchdog.sh；部署到 us-vps /opt/opc-watchdog/watchdog.sh
#（由 opc-watchdog.timer 每 5 分钟调用）。禁止在 us-vps 上直接改，改这里再同步。
set -uo pipefail

BASE=/opt/opc-watchdog
STATE=$BASE/state
LOG=$BASE/watchdog.log
# shellcheck disable=SC1091
source /root/.credentials/feishu.env 2>/dev/null || true
# shellcheck disable=SC1091
source /root/.credentials/bark.env 2>/dev/null || true
BRAIN_URL="http://100.71.151.105:5221/api/brain/health"
GATEWAY_HOST=hk-ts
BRIEF_JOB=f5e9d665-adeb-4a74-8c25-fc9e26c91cf7
FAIL_THRESHOLD=3
COOLDOWN_S=3600

mkdir -p $STATE
log(){ echo "[$(date -u '+%F %T')Z] $*" >> $LOG; }

send(){ # $1=text ；主通道 Bark（独立 APNs），副通道飞书 webhook；校验 API 返回码（红线11）
  local text=$1 ok=1 resp
  if [ -n "${BARK_TOKEN:-}" ]; then
    resp=$(curl -s -m 10 -X POST "https://api.day.app/push" -H 'Content-Type: application/json' \
      -d "$(python3 -c "import json,sys;print(json.dumps({'title':'OPC-Watchdog','body':sys.argv[1],'device_key':'$BARK_TOKEN','group':'opc-watchdog','level':'timeSensitive'}))" "$text")" 2>/dev/null)
    echo "$resp" | grep -q '"code":200' && ok=0 || log "bark send failed: $resp"
  fi
  if [ -n "${FEISHU_WEBHOOK:-}" ]; then
    resp=$(curl -s -m 10 -X POST "$FEISHU_WEBHOOK" -H 'Content-Type: application/json' \
      -d "$(python3 -c "import json,sys;print(json.dumps({'msg_type':'text','content':{'text':sys.argv[1]}}))" "$text")" 2>/dev/null)
    echo "$resp" | grep -q '"code":0' && ok=0 || log "feishu send failed: $resp"
  fi
  return $ok
}

alert(){ # $1=probe $2=text
  local probe=$1 text=$2 now last=0
  now=$(date +%s)
  [ -f "$STATE/lastalert.$probe" ] && last=$(cat "$STATE/lastalert.$probe")
  if [ $((now-last)) -ge $COOLDOWN_S ]; then
    if send "🔴 [OPC-Watchdog] $text"; then
      echo "$now" > "$STATE/lastalert.$probe"; log "ALERT sent: $probe | $text"
    else
      log "ALERT SEND FAILED: $probe"
    fi
  else
    log "alert suppressed (cooldown): $probe"
  fi
}

check(){ # $1=probe $2=ok(0=好/1=坏) $3=failtext
  local probe=$1 ok=$2 failtext=$3 n=0
  [ -f "$STATE/failcount.$probe" ] && n=$(cat "$STATE/failcount.$probe")
  if [ "$ok" = 0 ]; then
    [ "$n" != 0 ] && log "probe RECOVERED: $probe"
    echo 0 > "$STATE/failcount.$probe"
  else
    n=$((n+1)); echo "$n" > "$STATE/failcount.$probe"
    log "probe FAIL($n): $probe"
    [ "$n" -ge $FAIL_THRESHOLD ] && alert "$probe" "$failtext（连续 $n 次探测失败）"
  fi
}

# ── 1. Brain（经 Tailscale，pf 允许 utun 入站）
BJSON=$(curl -s -m 10 "$BRAIN_URL" 2>/dev/null || true)
BSTATUS=$(echo "$BJSON" | python3 -c 'import json,sys;print(json.load(sys.stdin).get("status",""))' 2>/dev/null || echo "")
if [ "$BSTATUS" = healthy ] || [ "$BSTATUS" = degraded ]; then
  check brain 0 x
else
  check brain 1 "Brain /api/brain/health 不可达或状态异常 (got: ${BSTATUS:-无响应})"
fi
echo "${BSTATUS:-unreachable}" > $STATE/last.brain

# ── 2. 网关探针已移除（2026-10-04，决策 b08a085c）：openclaw-gateway 09-21 起已从 us-vps 退役（网关在 MMV），
#    原探针连败 3600+ 次、每小时假告警。

# ── 2.5 HK 根盘水位（红线：80% Amber / 90% Red；88% 起告警）
HKDISK=$(timeout 20 ssh -o BatchMode=yes $GATEWAY_HOST "df --output=pcent / | tail -1" 2>/dev/null | tr -dc "0-9")
if [ -n "$HKDISK" ]; then
  echo "$HKDISK" > $STATE/last.hkdisk
  if [ "$HKDISK" -ge 88 ]; then
    alert hkdisk "HK 根盘已达 ${HKDISK}%（红线90%），需要立即清理或扩容"
  fi
fi

H=$((10#$(date -u +%H%M))); DOW=$(date -u +%u); TODAY=$(date -u +%F)

# ── 3. 晨报时限（工作日北京 09:20-09:30 = UTC 01:20-01:30 检查一次）
if [ "$DOW" -le 5 ] && [ "$H" -ge 120 ] && [ "$H" -lt 130 ] && [ ! -f "$STATE/briefchecked.$TODAY" ]; then
  touch "$STATE/briefchecked.$TODAY"
  BR=$(timeout 25 bash -c \
      "docker exec openclaw-gateway openclaw cron get $BRIEF_JOB 2>/dev/null" 2>/dev/null | \
      python3 -c '
import json,sys,datetime
j=json.load(sys.stdin); st=j.get("state",{})
ts=st.get("lastRunAtMs",0)/1000
d=datetime.datetime.utcfromtimestamp(ts).strftime("%Y-%m-%d") if ts else ""
print(st.get("lastRunStatus","?")+"|"+d)' 2>/dev/null || echo "unreachable|")
  BSTAT=${BR%%|*}; BDATE=${BR##*|}
  if [ "$BSTAT" != ok ] || [ "$BDATE" != "$TODAY" ]; then
    alert brief "OPC 晨报未按时成功：status=$BSTAT run_date=${BDATE:-无}（应于北京 08:45 起跑并成功）"
  else
    log "brief check ok"
  fi
  find $STATE -name 'briefchecked.*' -mtime +2 -delete 2>/dev/null
fi

# ── 4. 每日存活报到（北京 09:00-09:10 = UTC 01:00-01:10）
if [ "$H" -ge 100 ] && [ "$H" -lt 110 ] && [ ! -f "$STATE/reported.$TODAY" ]; then
  touch "$STATE/reported.$TODAY"
  if send "🟢 [OPC-Watchdog] 每日报到：watchdog 存活于 us-vps。Brain=$(cat $STATE/last.brain 2>/dev/null || echo '?') | HK盘=$(cat $STATE/last.hkdisk 2>/dev/null || echo '?')%"; then
    log "daily report sent"
  else
    log "daily report SEND FAILED"
  fi
  find $STATE -name 'reported.*' -mtime +2 -delete 2>/dev/null
fi
