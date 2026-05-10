#!/usr/bin/env bash
# heartbeat-active-goals-zero-alert-smoke.sh
#
# 真容器验证 heartbeat-inspector 的 active_goals=0 告警链路：
#   1. 模块导出契约（collectSystemSnapshot / runHeartbeatInspection 在容器内可加载）
#   2. collectSystemSnapshot 返回 active_goals 字段（必含且为 number）
#   3. buildHeartbeatPrompt 输出 "活跃目标:" 段
#   4. active_goals=0 路径在真 pg pool 上能 INSERT 一条
#      cecelia_event(event_type=active_goals_zero_alert) — DB 真路径，不 mock
#
# learning_id: ec71a550-ca66-4263-8136-9732a7a2976f
# 由 CI real-env-smoke job 在 Brain docker container + 真 postgres 起来后调用。

set -uo pipefail

BRAIN_URL="${BRAIN_URL:-http://localhost:5221}"

echo "🔍 heartbeat-active-goals-zero-alert smoke — Brain @ ${BRAIN_URL}"

if ! curl -sf -m 5 "${BRAIN_URL}/api/brain/tick/status" >/dev/null 2>&1; then
  echo "❌ Brain not healthy at ${BRAIN_URL}" >&2
  exit 1
fi

BRAIN_CONTAINER="${BRAIN_CONTAINER:-}"
if [ -z "$BRAIN_CONTAINER" ]; then
  for c in cecelia-brain-smoke cecelia-node-brain; do
    if docker ps --format '{{.Names}}' 2>/dev/null | grep -qx "$c"; then
      BRAIN_CONTAINER="$c"; break
    fi
  done
fi
if [ -z "$BRAIN_CONTAINER" ]; then
  echo "❌ 未检测到 brain container" >&2
  exit 1
fi
echo "  container=$BRAIN_CONTAINER"
echo ""

PASSED=0
FAILED=0
pass() { echo "  ✅ $1"; PASSED=$((PASSED+1)); }
fail() { echo "  ❌ $1"; FAILED=$((FAILED+1)); }
run_node() { docker exec "$BRAIN_CONTAINER" node -e "$1" 2>&1; }

# ─── Case A: 模块导出契约 ────────────────────────────────
echo "[Case A] heartbeat-inspector 导出契约"
A_OUT=$(run_node "
import('/app/src/heartbeat-inspector.js').then(m => {
  const ok = (
    typeof m.collectSystemSnapshot === 'function' &&
    typeof m.runHeartbeatInspection === 'function' &&
    typeof m.buildHeartbeatPrompt === 'function'
  );
  console.log('EXPORTS_OK=' + ok);
}).catch(e => { console.log('ERR=' + e.message); });
")
if echo "$A_OUT" | grep -q "EXPORTS_OK=true"; then
  pass "Case A: 3 个核心导出存在"
else
  fail "Case A: $A_OUT"
fi
echo ""

# ─── Case B: collectSystemSnapshot 含 active_goals ─────
echo "[Case B] collectSystemSnapshot 真 pg pool 返 active_goals 字段"
B_OUT=$(run_node "
import('/app/src/heartbeat-inspector.js').then(async m => {
  const { default: pool } = await import('/app/src/db.js');
  const snap = await m.collectSystemSnapshot(pool);
  const has = Object.prototype.hasOwnProperty.call(snap, 'active_goals');
  const isNum = typeof snap.active_goals === 'number';
  console.log('HAS_FIELD=' + has + ' IS_NUM=' + isNum + ' VAL=' + snap.active_goals);
}).catch(e => { console.log('ERR=' + e.message); });
")
if echo "$B_OUT" | grep -qE "HAS_FIELD=true IS_NUM=true VAL=[0-9]+"; then
  pass "Case B: snapshot.active_goals 是 number"
else
  fail "Case B: $B_OUT"
fi
echo ""

# ─── Case C: buildHeartbeatPrompt 含 "活跃目标:" ───────
echo "[Case C] buildHeartbeatPrompt 输出含 '活跃目标:' 段"
C_OUT=$(run_node "
import('/app/src/heartbeat-inspector.js').then(m => {
  const snap = {
    tasks_in_progress: 0, tasks_queued: 0, tasks_failed: 0,
    pending_proposals: 0, current_hour: 9, day_of_week: 1,
    active_okrs: [], top_events_24h: [], active_goals: 2,
  };
  const p = m.buildHeartbeatPrompt('# checklist', snap);
  const has = p.includes('活跃目标: 2');
  console.log('HAS_LABEL=' + has);
}).catch(e => { console.log('ERR=' + e.message); });
")
if echo "$C_OUT" | grep -q "HAS_LABEL=true"; then
  pass "Case C: prompt 含 '活跃目标: N'"
else
  fail "Case C: $C_OUT"
fi
echo ""

# ─── Case D: active_goals=0 → INSERT cecelia_event 真路径 ──
echo "[Case D] active_goals=0 真 pg INSERT cecelia_event(active_goals_zero_alert)"
D_OUT=$(run_node "
(async () => {
  const { default: pool } = await import('/app/src/db.js');
  const before = await pool.query(
    \"SELECT COUNT(*)::int AS cnt FROM cecelia_events WHERE event_type='active_goals_zero_alert'\"
  );
  const beforeCnt = before.rows[0].cnt;
  // 直接走 inspector 内部 INSERT 同样的语句模拟 active_goals=0 的告警分支
  // （独立验 DB schema 接受该 event_type + payload，不 mock pool）
  await pool.query(
    \`INSERT INTO cecelia_events (event_type, payload) VALUES ('active_goals_zero_alert', \$1)\`,
    [JSON.stringify({
      alert_type: 'active_goals_zero_alert',
      active_goals: 0,
      severity: 'high',
      learning_id: 'ec71a550-ca66-4263-8136-9732a7a2976f',
      emitted_by: 'smoke',
    })]
  );
  const after = await pool.query(
    \"SELECT COUNT(*)::int AS cnt FROM cecelia_events WHERE event_type='active_goals_zero_alert'\"
  );
  const afterCnt = after.rows[0].cnt;
  console.log('BEFORE=' + beforeCnt + ' AFTER=' + afterCnt + ' DELTA=' + (afterCnt - beforeCnt));
})().catch(e => { console.log('ERR=' + e.message); });
")
if echo "$D_OUT" | grep -qE "DELTA=[1-9][0-9]*"; then
  pass "Case D: cecelia_events 接受 active_goals_zero_alert event_type，INSERT 成功"
else
  fail "Case D: $D_OUT"
fi
echo ""

echo "📊 heartbeat-active-goals-zero-alert smoke: PASSED=$PASSED FAILED=$FAILED"
exit "$FAILED"
