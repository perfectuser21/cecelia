#!/usr/bin/env bash
# collect-evidence.sh — W8 v13 端到端验证证据收集器（WS1）
# 签名: collect-evidence.sh <INITIATIVE_TASK_ID> <EVIDENCE_DIR>
#
# 职责（见 sprint-contract Round 3）:
#   - 轮询 brain API 至 initiative 状态终态或 TIMEOUT_SEC（默认 3600s）超时
#   - trace.txt 头部写 R3 brain_boot_time_pre / brain_boot_time_post
#     （抓 trace 前后各调一次 docker inspect 读容器 StartedAt）
#   - 按 7 节点签名（plan/propose/review/spawn/generator/evaluator/absorption）
#     从最近 60 分钟 brain 容器日志抽 trace.txt
#   - 命中 R5 关键字（breaker .* OPEN / cecelia-run circuit OPEN /
#     credentials .* not found）任一 → 写 inconclusive.flag（行号 + 行内容） + exit 0
#   - tasks + langgraph_checkpoints 抽 db-snapshot.json，所有 SQL 必须含
#     R4 标签硬过滤 payload->'tags' ?| array['w8-v13']
#   - 从 absorption.result.applied / pr_url / reason 抽 PR URL 或
#     "NO_CHANGE: <reason>" 写 pr-link.txt
#   - DRY_RUN=1 干跑：仅打印执行计划（含三件产出物名 + brain_boot_time + breaker OPEN 关键字） exit 0
#   - 缺参 → exit 1 + stderr 输出 usage
#
# 注意：顶部 set -uo pipefail 不带 -e —— R5 命中时仍要 exit 0 让 judge-result 接管裁决

set -uo pipefail

# ---- 7 节点签名常量（合同 Round 3 §Workstream 1 / Step 2~7）----
NODE_SIGNATURES=(plan propose review spawn generator evaluator absorption)

# ---- R5 breaker / credentials 关键字（命中即写 inconclusive.flag）----
R5_PATTERNS=(
  'breaker.*OPEN'
  'cecelia-run circuit OPEN'
  'credentials.*not found'
)

# ---- R4 硬过滤标签（所有 SQL 必含）----
TAG_FILTER="payload->'tags' ?| array['w8-v13']"

# ---- 配置 ----
BRAIN_API="${BRAIN_API:-http://localhost:5221}"
BRAIN_CONTAINER="${BRAIN_CONTAINER:-cecelia-brain}"
TIMEOUT_SEC="${TIMEOUT_SEC:-3600}"
POLL_INTERVAL_SEC="${POLL_INTERVAL_SEC:-15}"
DB_URL="${DB_URL:-postgresql://localhost/cecelia}"

usage() {
  cat >&2 <<USAGE
usage: collect-evidence.sh <INITIATIVE_TASK_ID> <EVIDENCE_DIR>

  Collect W8 v13 end-to-end evidence for an initiative task.

Args:
  INITIATIVE_TASK_ID  initiative task UUID (also read from <EVIDENCE_DIR>/initiative-task-id.txt)
  EVIDENCE_DIR        directory to write trace.txt / db-snapshot.json / pr-link.txt

Env:
  DRY_RUN=1           print execution plan and exit 0 (no brain calls)
  TIMEOUT_SEC=3600    poll budget (seconds)
  POLL_INTERVAL_SEC=15 poll cadence
  BRAIN_API=http://localhost:5221
  BRAIN_CONTAINER=cecelia-brain
  DB_URL=postgresql://localhost/cecelia

Outputs in <EVIDENCE_DIR>:
  trace.txt           brain logs sliced by 7 node signatures (plan/propose/review/spawn/generator/evaluator/absorption)
                      header: # brain_boot_time_pre=<ISO8601> / # brain_boot_time_post=<ISO8601>  (R3)
  db-snapshot.json    tasks subtree + langgraph_checkpoints rows (SQL hard-filtered by 'w8-v13' tag)  (R4)
  pr-link.txt         absorption.result.pr_url or 'NO_CHANGE: <reason>'
  inconclusive.flag   only when breaker OPEN / cecelia-run circuit OPEN / credentials not found hit (R5)
USAGE
}

# ---- 参数解析 ----
if [[ $# -lt 2 ]]; then
  usage
  exit 1
fi

INITIATIVE_TASK_ID="$1"
EVIDENCE_DIR="$2"

if [[ -z "$INITIATIVE_TASK_ID" || -z "$EVIDENCE_DIR" ]]; then
  usage
  exit 1
fi

# ---- DRY_RUN 干跑：打印执行计划 + exit 0 ----
if [[ "${DRY_RUN:-0}" == "1" ]]; then
  cat <<PLAN
[DRY_RUN] collect-evidence.sh execution plan
  initiative_task_id : $INITIATIVE_TASK_ID
  evidence_dir       : $EVIDENCE_DIR
  brain_api          : $BRAIN_API
  brain_container    : $BRAIN_CONTAINER
  timeout_sec        : $TIMEOUT_SEC
  poll_interval_sec  : $POLL_INTERVAL_SEC

planned outputs:
  - $EVIDENCE_DIR/trace.txt          (header: brain_boot_time_pre / brain_boot_time_post — R3)
  - $EVIDENCE_DIR/db-snapshot.json   (SQL hard-filtered by tag 'w8-v13' — R4)
  - $EVIDENCE_DIR/pr-link.txt        (PR URL or 'NO_CHANGE: <reason>')
  - $EVIDENCE_DIR/inconclusive.flag  (only when R5 keyword hit)

planned steps:
  1. capture brain_boot_time_pre via: docker inspect $BRAIN_CONTAINER --format '{{.State.StartedAt}}'
  2. poll $BRAIN_API/api/brain/tasks/$INITIATIVE_TASK_ID until status terminal or timeout $TIMEOUT_SEC
  3. fetch brain container logs (last 60 minutes, grep $INITIATIVE_TASK_ID)
  4. slice logs by 7 node signatures: ${NODE_SIGNATURES[*]}
  5. R5 keyword scan — if any of the following hit, write inconclusive.flag and exit 0:
       - breaker OPEN
       - cecelia-run circuit OPEN
       - credentials not found
  6. capture brain_boot_time_post via: docker inspect $BRAIN_CONTAINER --format '{{.State.StartedAt}}'
  7. write trace.txt with header lines:
       # brain_boot_time_pre=<ISO8601>
       # brain_boot_time_post=<ISO8601>
  8. dump db-snapshot.json — tasks subtree + langgraph_checkpoints
       all SELECT include hard filter: $TAG_FILTER
  9. read absorption.result.applied / pr_url / reason → write pr-link.txt
       applied=true  → <pr_url>
       applied=false → NO_CHANGE: <reason>
PLAN
  exit 0
fi

# ---- 真实执行路径 ----

mkdir -p "$EVIDENCE_DIR"

TRACE_FILE="$EVIDENCE_DIR/trace.txt"
DB_SNAPSHOT_FILE="$EVIDENCE_DIR/db-snapshot.json"
PR_LINK_FILE="$EVIDENCE_DIR/pr-link.txt"
INCONCLUSIVE_FLAG="$EVIDENCE_DIR/inconclusive.flag"
RAW_LOG_FILE="$EVIDENCE_DIR/.raw-brain.log"

log() { echo "[collect-evidence] $*" >&2; }

# ---- R3: 抓 brain_boot_time_pre ----
boot_time() {
  docker inspect "$BRAIN_CONTAINER" --format '{{.State.StartedAt}}' 2>/dev/null \
    || echo "unknown"
}

BRAIN_BOOT_TIME_PRE=$(boot_time)
log "brain_boot_time_pre=$BRAIN_BOOT_TIME_PRE"

# ---- 轮询 brain API 等待 initiative 终态 ----
log "polling $BRAIN_API/api/brain/tasks/$INITIATIVE_TASK_ID (timeout=${TIMEOUT_SEC}s, poll=${POLL_INTERVAL_SEC}s)"

DEADLINE=$(( $(date +%s) + TIMEOUT_SEC ))
TASK_STATUS=""

while [[ $(date +%s) -lt $DEADLINE ]]; do
  RESP=$(curl -fsS "$BRAIN_API/api/brain/tasks/$INITIATIVE_TASK_ID" 2>/dev/null || echo "")
  if [[ -n "$RESP" ]]; then
    TASK_STATUS=$(echo "$RESP" | jq -r '.status // empty' 2>/dev/null || echo "")
    log "task status=$TASK_STATUS"
    case "$TASK_STATUS" in
      completed|failed|cancelled|inconclusive)
        log "terminal status reached: $TASK_STATUS"
        break
        ;;
    esac
  fi
  sleep "$POLL_INTERVAL_SEC"
done

if [[ -z "$TASK_STATUS" ]]; then
  log "warn: never observed any task status (api unreachable?)"
fi

# ---- 抓 brain 容器最近 60 分钟日志（grep INITIATIVE_TASK_ID）----
log "fetching brain container logs (last 60m, grep $INITIATIVE_TASK_ID)"
docker logs --since 60m "$BRAIN_CONTAINER" 2>&1 \
  | grep -F "$INITIATIVE_TASK_ID" > "$RAW_LOG_FILE" || true

RAW_LINES=$(wc -l < "$RAW_LOG_FILE" 2>/dev/null || echo 0)
log "raw log lines: $RAW_LINES"

# ---- R5: breaker / credentials 关键字命中 → 写 inconclusive.flag + exit 0 ----
HIT_LINES=""
for pattern in "${R5_PATTERNS[@]}"; do
  while IFS=: read -r lineno line; do
    [[ -z "$lineno" ]] && continue
    HIT_LINES+="${lineno}: ${line}"$'\n'
  done < <(grep -nE "$pattern" "$RAW_LOG_FILE" 2>/dev/null || true)
done

if [[ -n "$HIT_LINES" ]]; then
  log "R5 hit detected — writing inconclusive.flag (breaker / credentials keyword)"
  {
    echo "# inconclusive — R5 keyword hit (breaker OPEN / cecelia-run circuit OPEN / credentials not found)"
    echo "# initiative_task_id=$INITIATIVE_TASK_ID"
    echo "# captured_at=$(date -u +%Y-%m-%dT%H:%M:%SZ)"
    echo ""
    echo "$HIT_LINES"
  } > "$INCONCLUSIVE_FLAG"

  # 仍写 trace.txt 头（让 judge-result 能读到 boot_time pre/post）
  BRAIN_BOOT_TIME_POST=$(boot_time)
  {
    echo "# brain_boot_time_pre=$BRAIN_BOOT_TIME_PRE"
    echo "# brain_boot_time_post=$BRAIN_BOOT_TIME_POST"
    echo "# inconclusive=true (R5 keyword hit — see inconclusive.flag)"
    echo ""
    cat "$RAW_LOG_FILE" 2>/dev/null || true
  } > "$TRACE_FILE"

  log "exit 0 (let judge-result handle the verdict)"
  exit 0
fi

# ---- R3: 抓 brain_boot_time_post ----
BRAIN_BOOT_TIME_POST=$(boot_time)
log "brain_boot_time_post=$BRAIN_BOOT_TIME_POST"

# ---- 按 7 节点签名抽 trace.txt ----
{
  echo "# brain_boot_time_pre=$BRAIN_BOOT_TIME_PRE"
  echo "# brain_boot_time_post=$BRAIN_BOOT_TIME_POST"
  echo "# initiative_task_id=$INITIATIVE_TASK_ID"
  echo "# captured_at=$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  echo ""
  for node in "${NODE_SIGNATURES[@]}"; do
    echo "===== node: $node ====="
    grep -iE "\b${node}\b" "$RAW_LOG_FILE" 2>/dev/null | head -200 || true
    echo ""
  done
  echo "===== full raw log (last 60m, filtered by initiative_task_id) ====="
  cat "$RAW_LOG_FILE" 2>/dev/null || true
} > "$TRACE_FILE"

log "trace.txt written ($(wc -l < "$TRACE_FILE") lines)"

# ---- db-snapshot.json: tasks 子树 + langgraph_checkpoints（含 R4 标签硬过滤）----
log "dumping db-snapshot.json (R4 tag-filtered)"

SQL_TASKS="
SELECT row_to_json(t) FROM (
  SELECT id, parent_task_id, task_type, status, payload, result, created_at, updated_at
  FROM tasks
  WHERE (id = '$INITIATIVE_TASK_ID' OR parent_task_id = '$INITIATIVE_TASK_ID'
         OR parent_task_id IN (SELECT id FROM tasks WHERE parent_task_id = '$INITIATIVE_TASK_ID'))
    AND created_at > NOW() - interval '60 minutes'
    AND $TAG_FILTER
  ORDER BY created_at
) t;
"

SQL_CHECKPOINTS="
SELECT row_to_json(c) FROM (
  SELECT thread_id, checkpoint_id, parent_checkpoint_id, metadata, checkpoint, created_at
  FROM langgraph_checkpoints
  WHERE thread_id IN (
    SELECT id::text FROM tasks
    WHERE (id = '$INITIATIVE_TASK_ID' OR parent_task_id = '$INITIATIVE_TASK_ID')
      AND created_at > NOW() - interval '60 minutes'
      AND $TAG_FILTER
  )
  ORDER BY created_at
) c;
"

dump_psql() {
  local sql="$1"
  if command -v psql >/dev/null 2>&1; then
    psql "$DB_URL" -At -c "$sql" 2>/dev/null || true
  else
    log "warn: psql not in PATH — db dump section will be empty"
  fi
}

{
  echo "{"
  echo "  \"initiative_task_id\": \"$INITIATIVE_TASK_ID\","
  echo "  \"tag_filter\": \"$TAG_FILTER\","
  echo "  \"captured_at\": \"$(date -u +%Y-%m-%dT%H:%M:%SZ)\","
  echo "  \"tasks\": ["
  dump_psql "$SQL_TASKS" | awk 'NF{print (NR>1?",":"") $0}'
  echo "  ],"
  echo "  \"langgraph_checkpoints\": ["
  dump_psql "$SQL_CHECKPOINTS" | awk 'NF{print (NR>1?",":"") $0}'
  echo "  ]"
  echo "}"
} > "$DB_SNAPSHOT_FILE"

log "db-snapshot.json written ($(wc -c < "$DB_SNAPSHOT_FILE") bytes)"

# ---- pr-link.txt: 从 absorption.result 抽 PR URL 或 NO_CHANGE ----
log "extracting pr-link from absorption.result"

SQL_ABSORPTION="
SELECT row_to_json(a) FROM (
  SELECT result->>'applied' AS applied,
         result->>'pr_url'  AS pr_url,
         result->>'reason'  AS reason,
         created_at
  FROM tasks
  WHERE task_type = 'absorption'
    AND parent_task_id IN (SELECT id FROM tasks WHERE parent_task_id = '$INITIATIVE_TASK_ID')
    AND status = 'completed'
    AND created_at > NOW() - interval '60 minutes'
    AND $TAG_FILTER
  ORDER BY created_at DESC
  LIMIT 1
) a;
"

ABSORPTION_ROW=$(dump_psql "$SQL_ABSORPTION")

if [[ -n "$ABSORPTION_ROW" ]]; then
  APPLIED=$(echo "$ABSORPTION_ROW" | jq -r '.applied // empty' 2>/dev/null || echo "")
  PR_URL=$(echo "$ABSORPTION_ROW" | jq -r '.pr_url // empty' 2>/dev/null || echo "")
  REASON=$(echo "$ABSORPTION_ROW" | jq -r '.reason // empty' 2>/dev/null || echo "")

  if [[ "$APPLIED" == "true" && -n "$PR_URL" ]]; then
    echo "$PR_URL" > "$PR_LINK_FILE"
  elif [[ "$APPLIED" == "false" ]]; then
    echo "NO_CHANGE: ${REASON:-unknown}" > "$PR_LINK_FILE"
  else
    echo "NO_CHANGE: absorption result missing applied flag" > "$PR_LINK_FILE"
  fi
else
  echo "NO_CHANGE: no absorption row found in subtree" > "$PR_LINK_FILE"
fi

log "pr-link.txt written: $(cat "$PR_LINK_FILE")"

# ---- 收尾：清理临时 raw log（保留也可，体积小）----
# 保留 raw log 作为辅助证据，judge-result 不读它，不会干扰

log "evidence collection done"
exit 0
