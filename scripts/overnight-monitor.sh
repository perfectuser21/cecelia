#!/bin/bash
# 过夜监控脚本 - 每5分钟记录系统状态
LOG=/tmp/overnight-monitor.log
echo "=== 过夜监控开始 $(date) ===" >> $LOG

while true; do
  TS=$(date '+%H:%M:%S')
  SLOTS=$(curl -s localhost:5221/api/brain/slots 2>/dev/null)
  HEADLESS=$(echo $SLOTS | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('headless_count',0))" 2>/dev/null)
  PRESSURE=$(echo $SLOTS | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('pressure',{}).get('max',0))" 2>/dev/null)
  DISPATCH=$(echo $SLOTS | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('dispatch_allowed','?'))" 2>/dev/null)

  IN_PROG=$(curl -s 'localhost:5221/api/brain/tasks?status=in_progress' 2>/dev/null | python3 -c "import sys,json; print(len(json.load(sys.stdin)))" 2>/dev/null)
  QUEUED=$(curl -s 'localhost:5221/api/brain/tasks?status=queued' 2>/dev/null | python3 -c "import sys,json; print(len(json.load(sys.stdin)))" 2>/dev/null)

  LINE="$TS | headless=$HEADLESS pressure=$PRESSURE dispatch=$DISPATCH | in_progress=$IN_PROG queued=$QUEUED"
  echo "$LINE" >> $LOG
  echo "$LINE"

  # 警告
  if [ "$HEADLESS" -gt 8 ] 2>/dev/null; then
    echo "WARNING: 进程过多 headless=$HEADLESS" | tee -a $LOG
  fi

  sleep 300
done
