#!/usr/bin/env bash
# Smoke: harness initiative health 端点 — GET /api/brain/harness/initiative/:id/health
# 真环境验证（real-env-smoke 起 cecelia-brain 容器 + postgres 后执行）：
#   注入受控随机 initiative_id 的 run + events → curl 健康端点 → 断言裁决 → psql 比对 → 用后即删。
#   覆盖 running / stuck / zombie / completed / failed / no_data 六态 + schema 严格 + 400/404。
set -euo pipefail

BRAIN_URL="${BRAIN_URL:-http://localhost:5221}"
DB="${DATABASE_URL:-postgresql://${DB_USER:-cecelia}:${DB_PASSWORD:-cecelia}@${DB_HOST:-localhost}:${DB_PORT:-5432}/${DB_NAME:-cecelia}}"
BASE="$BRAIN_URL/api/brain/harness/initiative"
NOW=$(date +%s)
newid() { cat /proc/sys/kernel/random/uuid; }

IID_RUN=$(newid); IID_STUCK=$(newid); IID_ZOMBIE=$(newid)
IID_DONE=$(newid); IID_FAIL=$(newid); IID_NODATA=$(newid)
ALL="'$IID_RUN','$IID_STUCK','$IID_ZOMBIE','$IID_DONE','$IID_FAIL','$IID_NODATA'"

cleanup() {
  psql "$DB" -c "DELETE FROM initiative_run_events WHERE initiative_id IN ($ALL)" >/dev/null 2>&1 || true
  psql "$DB" -c "DELETE FROM initiative_runs WHERE initiative_id IN ($ALL)" >/dev/null 2>&1 || true
}
trap cleanup EXIT

echo "[health-smoke] 注入受控数据"
psql "$DB" -c "INSERT INTO initiative_runs (initiative_id,phase) VALUES ('$IID_RUN','B_task_loop')"
psql "$DB" -c "INSERT INTO initiative_run_events (initiative_id,node,status,attempt,ts) VALUES ('$IID_RUN','generator','running',1,$((NOW-60)))"
psql "$DB" -c "INSERT INTO initiative_runs (initiative_id,phase) VALUES ('$IID_STUCK','B_task_loop')"
psql "$DB" -c "INSERT INTO initiative_run_events (initiative_id,node,status,attempt,ts) VALUES ('$IID_STUCK','prep','failed',1,$((NOW-2400))),('$IID_STUCK','prep','failed',2,$((NOW-1800)))"
psql "$DB" -c "INSERT INTO initiative_runs (initiative_id,phase) VALUES ('$IID_ZOMBIE','A_contract')"
psql "$DB" -c "INSERT INTO initiative_run_events (initiative_id,node,status,attempt,ts) VALUES ('$IID_ZOMBIE','planner','running',1,$((NOW-7200)))"
psql "$DB" -c "INSERT INTO initiative_runs (initiative_id,phase) VALUES ('$IID_DONE','done')"
psql "$DB" -c "INSERT INTO initiative_run_events (initiative_id,node,status,attempt,ts) VALUES ('$IID_DONE','report','completed',1,$((NOW-120)))"
psql "$DB" -c "INSERT INTO initiative_runs (initiative_id,phase,failure_reason) VALUES ('$IID_FAIL','failed','eval FAIL x3')"
psql "$DB" -c "INSERT INTO initiative_run_events (initiative_id,node,status,attempt,ts) VALUES ('$IID_FAIL','evaluator','failed',3,$((NOW-300)))"
psql "$DB" -c "INSERT INTO initiative_runs (initiative_id,phase) VALUES ('$IID_NODATA','A_contract')"

echo "[health-smoke] 断言六态裁决"
R=$(curl -sf "$BASE/$IID_RUN/health");    echo "$R" | jq -e '.state=="running" and .healthy==true and .last_node=="generator" and .stuck_minutes<15' >/dev/null || { echo "FAIL running: $R"; exit 1; }
R=$(curl -sf "$BASE/$IID_STUCK/health");  echo "$R" | jq -e '.state=="stuck" and .healthy==false and .last_node=="prep" and .retries==1 and .interrupts==2 and .stuck_minutes>=15 and .stuck_minutes<60' >/dev/null || { echo "FAIL stuck: $R"; exit 1; }
R=$(curl -sf "$BASE/$IID_ZOMBIE/health"); echo "$R" | jq -e '.state=="zombie" and .healthy==false and .stuck_minutes>=60' >/dev/null || { echo "FAIL zombie: $R"; exit 1; }
R=$(curl -sf "$BASE/$IID_DONE/health");   echo "$R" | jq -e '.state=="completed" and .healthy==true' >/dev/null || { echo "FAIL completed: $R"; exit 1; }
R=$(curl -sf "$BASE/$IID_FAIL/health");   echo "$R" | jq -e '.state=="failed" and .healthy==false' >/dev/null || { echo "FAIL failed: $R"; exit 1; }
R=$(curl -sf "$BASE/$IID_NODATA/health"); echo "$R" | jq -e '.state=="no_data" and .last_node==null and .retries==0 and .interrupts==0 and .stuck_minutes==0 and (.reason|length>0)' >/dev/null || { echo "FAIL no_data: $R"; exit 1; }

echo "[health-smoke] 断言 schema 严格 + 禁用字段反向"
R=$(curl -sf "$BASE/$IID_RUN/health")
echo "$R" | jq -e 'keys == ["healthy","interrupts","last_node","reason","retries","state","stuck_minutes"]' >/dev/null || { echo "FAIL schema: $R"; exit 1; }
echo "$R" | jq -e '(has("status")|not) and (has("node")|not) and (has("health")|not) and (has("message")|not)' >/dev/null || { echo "FAIL banned: $R"; exit 1; }

echo "[health-smoke] 断言 400 / 404 区分"
C=$(curl -s -o /tmp/hs400.json -w "%{http_code}" "$BASE/not-a-uuid/health"); [ "$C" = "400" ] || { echo "FAIL 400 got $C"; exit 1; }; jq -e '.error|type=="string"' /tmp/hs400.json >/dev/null || { echo "FAIL 400 body"; exit 1; }
C=$(curl -s -o /tmp/hs404.json -w "%{http_code}" "$BASE/00000000-0000-0000-0000-0000000000ff/health"); [ "$C" = "404" ] || { echo "FAIL 404 got $C"; exit 1; }; jq -e '.error|type=="string"' /tmp/hs404.json >/dev/null || { echo "FAIL 404 body"; exit 1; }

echo "[health-smoke] ✅ 全部通过（六态 + schema + 400/404）"
