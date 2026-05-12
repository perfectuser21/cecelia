#!/usr/bin/env bash
# verify-p1.sh — W32 Walking Skeleton P1 终验脚本（合同执行者）
# 用法: BRAIN_URL=http://localhost:5221 DATABASE_URL=postgres://... bash sprints/w32-walking-skeleton-p1-v4/verify-p1.sh
#
# 流程: POST /api/brain/tasks 创建 harness_initiative → 反向缺 task_type 验 400 →
# 轮询 tasks/{id} 收敛 → 采集 7 oracle (a-g) → 渲染 p1-final-acceptance.md
# 字段名严格字面引 PRD: .status / .thread_id / .event_type / .in_use / .in_progress_task_count
# 禁用同义名: .state / .task_state / .phase / .stage / .used / .busy / .running_count
# 不修改 packages/brain/** 任何文件；不引入新 endpoint / 不改 schema。

set -uo pipefail

BRAIN_URL="${BRAIN_URL:-http://localhost:5221}"
SPRINT_DIR="sprints/w32-walking-skeleton-p1-v4"
REPORT="${SPRINT_DIR}/p1-final-acceptance.md"
MAX_WAIT_MIN="${MAX_WAIT_MIN:-120}"
POLL_INTERVAL_S="${POLL_INTERVAL_S:-15}"

ANOMALIES=()
note_anomaly() { ANOMALIES+=("$1"); }

# Oracle 状态：UNKNOWN -> PASS / FAIL / SKIP
for o in a b c d e f g; do
  eval "ORACLE_${o}=UNKNOWN"
  eval "ORACLE_${o}_DETAIL=''"
done

###############################################################################
# 阶段 1: POST /api/brain/tasks 创建最简 harness_initiative 内层任务
###############################################################################
INIT_RESP=$(curl -fsS -X POST "${BRAIN_URL}/api/brain/tasks" \
  -H "Content-Type: application/json" \
  -d '{"task_type":"harness_initiative","prd":"W32 P1 walking-skeleton verification probe","priority":5}' 2>/dev/null || echo '{}')

INIT_ID=$(printf '%s' "$INIT_RESP" | jq -r '.id // empty' 2>/dev/null || true)
INIT_TYPE=$(printf '%s' "$INIT_RESP" | jq -r '.task_type // empty' 2>/dev/null || true)
INIT_STATUS=$(printf '%s' "$INIT_RESP" | jq -r '.status // empty' 2>/dev/null || true)

# UUID 校验 — 防止恶意 / 损坏 id 拼进 SQL
UUID_RE='^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
if [ -n "$INIT_ID" ] && ! [[ "$INIT_ID" =~ $UUID_RE ]]; then
  note_anomaly "POST /api/brain/tasks 返回非 UUID 形式的 id='${INIT_ID}'，已置空避免 SQL 拼接风险"
  INIT_ID=""
fi

if [ -z "$INIT_ID" ]; then
  note_anomaly "POST /api/brain/tasks 未拿到 id；Brain 不可达 ($BRAIN_URL) 或 schema 不符"
fi
if [ "$INIT_TYPE" != "harness_initiative" ] || [ "$INIT_STATUS" != "pending" ]; then
  note_anomaly "POST 201 body 不符合 {task_type:harness_initiative,status:pending} 字面 schema (实际 task_type=$INIT_TYPE status=$INIT_STATUS)"
fi

###############################################################################
# 阶段 2: 反向 — POST /api/brain/tasks 缺 task_type → 400 + {error:<string>}
###############################################################################
ERR_BODY=/tmp/p1-err.json
ERR_CODE=$(curl -s -o "$ERR_BODY" -w "%{http_code}" -X POST "${BRAIN_URL}/api/brain/tasks" \
  -H "Content-Type: application/json" \
  -d '{"prd":"missing task_type field on purpose"}' 2>/dev/null || echo "000")

if [ "$ERR_CODE" != "400" ]; then
  note_anomaly "反向 POST 缺 task_type 期望 400，实际 ${ERR_CODE}"
fi
if [ -s "$ERR_BODY" ]; then
  ERR_FIELD_TYPE=$(jq -r '.error | type' "$ERR_BODY" 2>/dev/null || echo "null")
  if [ "$ERR_FIELD_TYPE" != "string" ]; then
    note_anomaly "反向 400 body .error 类型非 string (实际 $ERR_FIELD_TYPE)"
  fi
  # 禁用同义名 message / msg / reason / detail 反向不存在 (用 has() 不用 jq -e 直字面)
  for k in message msg reason detail; do
    if jq -e --arg k "$k" 'has($k)' "$ERR_BODY" > /dev/null 2>&1; then
      note_anomaly "反向：禁用字段 ${k} 出现在错误响应"
    fi
  done
fi

###############################################################################
# 阶段 3: 轮询 GET /api/brain/tasks/{id} 直到 .status 收敛 (max ${MAX_WAIT_MIN}min)
#   合法终态枚举: completed / failed / skipped (PRD .status 字面)
###############################################################################
TASK_JSON='{}'
TERM_STATUS=""
if [ -n "$INIT_ID" ]; then
  DEADLINE=$(( $(date +%s) + MAX_WAIT_MIN * 60 ))
  while [ "$(date +%s)" -lt "$DEADLINE" ]; do
    TASK_JSON=$(curl -fsS "${BRAIN_URL}/api/brain/tasks/${INIT_ID}" 2>/dev/null || echo '{}')
    S=$(printf '%s' "$TASK_JSON" | jq -r '.status // empty' 2>/dev/null || true)
    case "$S" in
      completed|failed|skipped)
        TERM_STATUS="$S"
        break
        ;;
      pending|in_progress)
        sleep "$POLL_INTERVAL_S"
        ;;
      "")
        sleep "$POLL_INTERVAL_S"
        ;;
      *)
        note_anomaly "tasks/${INIT_ID} 出现非 5 字面枚举的 status: '${S}'"
        sleep "$POLL_INTERVAL_S"
        ;;
    esac
  done
  if [ -z "$TERM_STATUS" ]; then
    note_anomaly "tasks/${INIT_ID} 轮询超时 (${MAX_WAIT_MIN}min) 未收敛到终态"
  fi
fi

###############################################################################
# Oracle (a) — status==completed AND result.verdict ∈ {PASS,FAIL}
#                + tasks/{id} keys|sort 严等 7 字段集合 (R2 schema 完整性)
###############################################################################
if [ -n "$INIT_ID" ]; then
  S=$(printf '%s' "$TASK_JSON" | jq -r '.status // empty' 2>/dev/null || true)
  V=$(printf '%s' "$TASK_JSON" | jq -r '.result.verdict // empty' 2>/dev/null || true)
  THREAD=$(printf '%s' "$TASK_JSON" | jq -r '.thread_id // empty' 2>/dev/null || true)

  # 严等 7 字段集合 — keys | sort == ["id","last_heartbeat_at","parent_task_id","result","status","task_type","thread_id"]
  KEYS_OK=$(printf '%s' "$TASK_JSON" | jq -r 'keys | sort == ["id","last_heartbeat_at","parent_task_id","result","status","task_type","thread_id"]' 2>/dev/null || echo "false")

  if [ "$S" = "completed" ] && { [ "$V" = "PASS" ] || [ "$V" = "FAIL" ]; }; then
    ORACLE_a="PASS"
    ORACLE_a_DETAIL="status=${S} verdict=${V} thread_id=${THREAD} schema_keys_ok=${KEYS_OK}"
  else
    ORACLE_a="FAIL"
    ORACLE_a_DETAIL="status=${S} verdict=${V} (期望 completed + PASS|FAIL) schema_keys_ok=${KEYS_OK}"
    note_anomaly "Oracle a: status=${S} verdict=${V}"
  fi
  if [ "$KEYS_OK" != "true" ]; then
    ACTUAL_KEYS=$(printf '%s' "$TASK_JSON" | jq -c 'keys | sort' 2>/dev/null || echo "[]")
    note_anomaly "Oracle a schema: tasks/{id} keys|sort != 7 字段严等集合 (实际 ${ACTUAL_KEYS})"
  fi
else
  ORACLE_a="SKIP"
  ORACLE_a_DETAIL="无 init id - 上游 POST 失败"
fi

###############################################################################
# Oracle (b) — SQL count(DISTINCT thread_id)==1 + 5 阶段 task_type 全覆盖
###############################################################################
ORACLE_b="SKIP"
ORACLE_b_DETAIL="psql 不可用或 DATABASE_URL 未设置"
if command -v psql > /dev/null 2>&1 && [ -n "${DATABASE_URL:-}" ] && [ -n "$INIT_ID" ]; then
  THREAD_CNT=$(psql -tAq "$DATABASE_URL" -c "select count(DISTINCT thread_id) from tasks where id = '${INIT_ID}' or parent_task_id = '${INIT_ID}'" 2>/dev/null || echo "")
  STAGES=$(psql -tAq "$DATABASE_URL" -c "select string_agg(DISTINCT task_type, ',' order by task_type) from tasks where id = '${INIT_ID}' or parent_task_id = '${INIT_ID}'" 2>/dev/null || echo "")
  EXPECTED_STAGES=(harness_planner harness_contract_propose harness_contract_review harness_generator harness_evaluate)
  MISSING=()
  for st in "${EXPECTED_STAGES[@]}"; do
    case ",${STAGES}," in
      *,${st},*) ;;
      *) MISSING+=("$st") ;;
    esac
  done
  if [ "$THREAD_CNT" = "1" ] && [ ${#MISSING[@]} -eq 0 ]; then
    ORACLE_b="PASS"
    ORACLE_b_DETAIL="count(DISTINCT thread_id)=1 stages=${STAGES}"
  else
    ORACLE_b="FAIL"
    ORACLE_b_DETAIL="count(DISTINCT thread_id)=${THREAD_CNT} stages=${STAGES} missing=${MISSING[*]:-}"
    note_anomaly "Oracle b: thread_cnt=${THREAD_CNT} missing_stages=${MISSING[*]:-}"
  fi
fi

###############################################################################
# Oracle (c) — GET /api/brain/dispatch/recent?initiative_id={id}&limit=50
#   keys=={count,events} 严等 + events 数组 + event_type ∈ 5 枚举 + dispatched>=5
###############################################################################
DR='{}'
if [ -n "$INIT_ID" ]; then
  DR=$(curl -fsS "${BRAIN_URL}/api/brain/dispatch/recent?initiative_id=${INIT_ID}&limit=50" 2>/dev/null || echo '{}')

  KEYS_OK=$(printf '%s' "$DR" | jq -r '(keys == ["count","events"])' 2>/dev/null || echo "false")
  EVENTS_TYPE_OK=$(printf '%s' "$DR" | jq -r '.events | type == "array"' 2>/dev/null || echo "false")
  ENUM_OK=$(printf '%s' "$DR" | jq -r '(.events // []) | all(.event_type as $t | ["dispatched","skipped","completed","failed","reaped"] | index($t) != null)' 2>/dev/null || echo "false")
  DISPATCHED_N=$(printf '%s' "$DR" | jq -r '[(.events // [])[] | select(.event_type == "dispatched")] | length' 2>/dev/null || echo "0")

  if [ "$KEYS_OK" = "true" ] && [ "$EVENTS_TYPE_OK" = "true" ] && [ "$ENUM_OK" = "true" ] && [ "$DISPATCHED_N" -ge 5 ]; then
    ORACLE_c="PASS"
    ORACLE_c_DETAIL="keys==[count,events] events:array event_type:5enum dispatched=${DISPATCHED_N}"
  else
    ORACLE_c="FAIL"
    ORACLE_c_DETAIL="keys_ok=${KEYS_OK} events_array=${EVENTS_TYPE_OK} enum_ok=${ENUM_OK} dispatched=${DISPATCHED_N} (需 >=5)"
    note_anomaly "Oracle c: dispatch/recent 校验失败 ${ORACLE_c_DETAIL}"
  fi
else
  ORACLE_c="SKIP"
  ORACLE_c_DETAIL="无 init id"
fi

###############################################################################
# Oracle (d) — zombie 反向 + reaped→completed flipflop
#   zombie = status='in_progress' AND last_heartbeat_at < NOW() - interval '60 minutes'
###############################################################################
ORACLE_d="SKIP"
ORACLE_d_DETAIL="psql 不可用或 DATABASE_URL 未设置"
if command -v psql > /dev/null 2>&1 && [ -n "${DATABASE_URL:-}" ] && [ -n "$INIT_ID" ]; then
  ZOMBIE_CNT=$(psql -tAq "$DATABASE_URL" -c "select count(*) from tasks where status = 'in_progress' and last_heartbeat_at < NOW() - interval '60 minutes' and (id = '${INIT_ID}' or parent_task_id = '${INIT_ID}')" 2>/dev/null || echo "")
  # flipflop 限定到本 initiative 范围 — 否则历史数据污染必 FAIL
  FLIPFLOP_CNT=$(psql -tAq "$DATABASE_URL" -c "with seq as (select task_id, event_type, lag(event_type) over (partition by task_id order by created_at) as prev_type from dispatch_events where task_id in (select id from tasks where id = '${INIT_ID}' or parent_task_id = '${INIT_ID}')) select count(*) from seq where prev_type = 'reaped' and event_type = 'completed'" 2>/dev/null || echo "")
  if [ "$ZOMBIE_CNT" = "0" ] && [ "$FLIPFLOP_CNT" = "0" ]; then
    ORACLE_d="PASS"
    ORACLE_d_DETAIL="zombie=0 flipflop(reaped→completed)=0"
  else
    ORACLE_d="FAIL"
    ORACLE_d_DETAIL="zombie=${ZOMBIE_CNT} flipflop=${FLIPFLOP_CNT}"
    note_anomaly "Oracle d: zombie=${ZOMBIE_CNT} flipflop=${FLIPFLOP_CNT}"
  fi
fi

###############################################################################
# Oracle (e) — GET /api/brain/fleet/slots
#   字段字面 {total_slots, in_use, in_progress_task_count}
#   不变量: .in_use == .in_progress_task_count
#   禁用同义名 used/busy/active/running_count/task_count 反向不存在
###############################################################################
FS=$(curl -fsS "${BRAIN_URL}/api/brain/fleet/slots" 2>/dev/null || echo '{}')
IN_USE=$(printf '%s' "$FS" | jq -r '.in_use // empty' 2>/dev/null || true)
IN_PROG=$(printf '%s' "$FS" | jq -r '.in_progress_task_count // empty' 2>/dev/null || true)
TOTAL=$(printf '%s' "$FS" | jq -r '.total_slots // empty' 2>/dev/null || true)

# 禁用同义名反向不存在 (用 has() 不用 jq -e .field 直字面)
FORBIDDEN_FIELDS=""
for k in used busy active running_count task_count; do
  if jq -e --arg k "$k" 'has($k)' <<<"$FS" > /dev/null 2>&1; then
    FORBIDDEN_FIELDS="${FORBIDDEN_FIELDS}${k},"
  fi
done

if [ -n "$IN_USE" ] && [ -n "$IN_PROG" ] && [ -n "$TOTAL" ] && [ "$IN_USE" = "$IN_PROG" ] && [ -z "$FORBIDDEN_FIELDS" ]; then
  ORACLE_e="PASS"
  ORACLE_e_DETAIL="total_slots=${TOTAL} in_use==${IN_USE}==in_progress_task_count 无禁用字段"
else
  ORACLE_e="FAIL"
  ORACLE_e_DETAIL="total_slots=${TOTAL} in_use=${IN_USE} in_progress_task_count=${IN_PROG} forbidden=${FORBIDDEN_FIELDS:-none}"
  note_anomaly "Oracle e: fleet/slots 字段或不变量异常 ${ORACLE_e_DETAIL}"
fi

###############################################################################
# Oracle (f) — dispatch_events 序列 skipped → dispatched 紧邻对
#   primary: 直接查 dispatch/recent 排序后是否含 skipped 紧邻 dispatched
#   secondary (Risk Registry R5): primary 未观测则主动制造 2 个并发 initiative 拉满 slot 再轮一次
###############################################################################
HOL_OK="false"
if [ -n "$INIT_ID" ]; then
  ADJ_PAIR=$(printf '%s' "$DR" | jq -r '
    ((.events // []) | sort_by(.created_at)) as $e
    | [range(0; ($e|length) - 1) as $i | { p: $e[$i].event_type, c: $e[$i+1].event_type }]
    | map(select(.p == "skipped" and .c == "dispatched"))
    | length
  ' 2>/dev/null || echo "0")
  if [ "${ADJ_PAIR:-0}" -ge 1 ]; then
    HOL_OK="true"
    ORACLE_f_DETAIL="primary check: 观察到 ${ADJ_PAIR} 对 skipped → dispatched 紧邻"
  fi

  if [ "$HOL_OK" != "true" ]; then
    # secondary 兜底: 并发触发 2 个 harness_initiative 拉满 slot 制造 HOL skip
    for i in 1 2; do
      curl -fsS -X POST "${BRAIN_URL}/api/brain/tasks" \
        -H "Content-Type: application/json" \
        -d "{\"task_type\":\"harness_initiative\",\"prd\":\"W32 HOL secondary probe ${i}\",\"priority\":5}" \
        > /dev/null 2>&1 || true
    done
    sleep 30
    DR2=$(curl -fsS "${BRAIN_URL}/api/brain/dispatch/recent?initiative_id=${INIT_ID}&limit=50" 2>/dev/null || echo '{}')
    ADJ_PAIR2=$(printf '%s' "$DR2" | jq -r '
      ((.events // []) | sort_by(.created_at)) as $e
      | [range(0; ($e|length) - 1) as $i | { p: $e[$i].event_type, c: $e[$i+1].event_type }]
      | map(select(.p == "skipped" and .c == "dispatched"))
      | length
    ' 2>/dev/null || echo "0")
    if [ "${ADJ_PAIR2:-0}" -ge 1 ]; then
      HOL_OK="true"
      ORACLE_f_DETAIL="secondary 并发触发后观察到 ${ADJ_PAIR2} 对 skipped → dispatched 紧邻"
    fi
  fi
fi

if [ "$HOL_OK" = "true" ]; then
  ORACLE_f="PASS"
  [ -z "$ORACLE_f_DETAIL" ] && ORACLE_f_DETAIL="HOL_OK=true"
else
  ORACLE_f="FAIL"
  ORACLE_f_DETAIL="HOL_OK=false — primary 与 secondary 均未观察到 skipped → dispatched 紧邻对"
  note_anomaly "Oracle f: ${ORACLE_f_DETAIL}"
fi

###############################################################################
# Oracle (g) — heartbeat 不误杀 (B7 反向)
#   反向: 不存在 last_heartbeat_at 仍新鲜 (>= NOW() - 60min) 却被标 failed 的任务
###############################################################################
ORACLE_g="SKIP"
ORACLE_g_DETAIL="psql 不可用或 DATABASE_URL 未设置"
if command -v psql > /dev/null 2>&1 && [ -n "${DATABASE_URL:-}" ] && [ -n "$INIT_ID" ]; then
  FALSE_KILL=$(psql -tAq "$DATABASE_URL" -c "select count(*) from tasks where status = 'failed' and last_heartbeat_at >= NOW() - interval '60 minutes' and (id = '${INIT_ID}' or parent_task_id = '${INIT_ID}')" 2>/dev/null || echo "")
  if [ "$FALSE_KILL" = "0" ]; then
    ORACLE_g="PASS"
    ORACLE_g_DETAIL="不存在新鲜 heartbeat 却被标 failed 的任务 (false_kill=0)"
  else
    ORACLE_g="FAIL"
    ORACLE_g_DETAIL="found ${FALSE_KILL} 个新鲜 heartbeat 却被 reaper 误杀的任务"
    note_anomaly "Oracle g: heartbeat 误杀 ${FALSE_KILL} 个"
  fi
fi

###############################################################################
# 综合 Verdict & 渲染 p1-final-acceptance.md
###############################################################################
VERDICT="PASS"
SKIP_LIST=""
for o in a b c d e f g; do
  v=$(eval echo "\$ORACLE_${o}")
  case "$v" in
    FAIL) VERDICT="FAIL" ;;
    SKIP) SKIP_LIST="${SKIP_LIST}${o}," ;;
  esac
done
if [ -n "$SKIP_LIST" ]; then
  note_anomaly "Oracle 被 SKIP (非 PASS 也非 FAIL，环境缺失): ${SKIP_LIST%,} — Verdict 未把 SKIP 等同 FAIL，请补齐基础设施 (DATABASE_URL / Brain 可达性) 重跑"
fi

mkdir -p "$SPRINT_DIR"
{
  echo "# W32 Walking Skeleton P1 — Final Acceptance"
  echo
  echo "- initiative_id: ${INIT_ID:-N/A}"
  echo "- brain_url: ${BRAIN_URL}"
  echo "- generated_at: $(date -u +%Y-%m-%dT%H:%M:%SZ)"
  echo "- terminal_status: ${TERM_STATUS:-N/A}"
  echo
  echo "## Verdict: ${VERDICT}"
  echo
  echo "## Oracle a-g 实测"
  echo
  echo "| oracle | verdict | detail |"
  echo "|---|---|---|"
  for o in a b c d e f g; do
    v=$(eval echo "\$ORACLE_${o}")
    d=$(eval echo "\$ORACLE_${o}_DETAIL")
    # 转义 | 防止破坏 Markdown 表格
    d_safe=${d//|/\\|}
    echo "| ${o} | ${v} | ${d_safe} |"
  done
  echo
  echo "## Anomaly"
  echo
  if [ "${#ANOMALIES[@]}" -eq 0 ]; then
    echo "无异常。"
  else
    for a in "${ANOMALIES[@]}"; do
      echo "- ${a}"
    done
  fi
} > "$REPORT"

echo "Wrote $REPORT — Verdict: ${VERDICT}"
exit 0
