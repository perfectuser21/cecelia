#!/usr/bin/env bash
# heartbeat-active-goals-alert-smoke.sh
# Smoke：heartbeat-inspector 监控 active_goals 并在归零时发 P0 告警
#
# Cortex Insight: ec71a550-ca66-4263-8136-9732a7a2976f
#   "active_goals=0 是方向性崩溃前置信号，heartbeat 应监控并告警"
#
# 5 case：
#   A: Brain 健康检查（保证有 brain 容器可 docker exec）
#   B: collectSystemSnapshot 返回的 snapshot 含 active_goals 字段（数值类型）
#   C: SQL 实跑 — objectives 表 in_progress 计数与 snapshot.active_goals 一致
#   D: buildHeartbeatPrompt(active_goals=0) 含 "方向性崩溃先兆" 标记
#   E: alerting.raise('P0', 'heartbeat_active_goals_zero', ...) 可调用不抛
#
# 用法：bash heartbeat-active-goals-alert-smoke.sh

set -uo pipefail

BRAIN_URL="${BRAIN_URL:-http://localhost:5221}"

echo "🔍 heartbeat-active-goals-alert — Brain @ ${BRAIN_URL}"

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

# ─── Case A: Brain 健康（已隐含通过上文 curl）─────────────
echo "[Case A] Brain 健康"
pass "Case A: Brain 响应 /api/brain/tick/status"
echo ""

# ─── Case B: snapshot 含 active_goals 字段 ──────────────
echo "[Case B] collectSystemSnapshot 返回 active_goals"
B_OUT=$(run_node "
import('/app/src/heartbeat-inspector.js').then(async m => {
  const pool = (await import('/app/src/db.js')).default;
  const snap = await m.collectSystemSnapshot(pool);
  const has = Object.prototype.hasOwnProperty.call(snap, 'active_goals');
  const ok = has && typeof snap.active_goals === 'number' && Number.isFinite(snap.active_goals);
  console.log('HAS=' + has + ' VAL=' + snap.active_goals + ' OK=' + ok);
}).catch(e => console.log('ERR=' + e.message));
")
if echo "$B_OUT" | grep -q "OK=true"; then
  pass "Case B: snapshot.active_goals 存在且为有限数值"
else
  fail "Case B: $B_OUT"
fi
echo ""

# ─── Case C: SQL 实跑数 vs snapshot 一致 ────────────────
echo "[Case C] objectives in_progress 计数与 snapshot 一致"
C_OUT=$(run_node "
import('/app/src/heartbeat-inspector.js').then(async m => {
  const pool = (await import('/app/src/db.js')).default;
  const snap = await m.collectSystemSnapshot(pool);
  const r = await pool.query(\"SELECT COUNT(*)::int as cnt FROM objectives WHERE status = 'in_progress'\");
  const direct = r.rows[0].cnt;
  console.log('SNAP=' + snap.active_goals + ' DIRECT=' + direct + ' MATCH=' + (snap.active_goals === direct));
}).catch(e => console.log('ERR=' + e.message));
")
if echo "$C_OUT" | grep -q "MATCH=true"; then
  pass "Case C: snapshot 与直查 SQL 计数一致"
else
  fail "Case C: $C_OUT"
fi
echo ""

# ─── Case D: prompt 含先兆标记 ──────────────────────────
echo "[Case D] buildHeartbeatPrompt(active_goals=0) 含先兆标记"
D_OUT=$(run_node "
import('/app/src/heartbeat-inspector.js').then(m => {
  const snap = {
    tasks_in_progress: 0, tasks_queued: 0, tasks_failed: 0,
    pending_proposals: 0, current_hour: 10, day_of_week: 1,
    active_okrs: [], active_goals: 0, top_events_24h: [],
  };
  const prompt = m.buildHeartbeatPrompt('check', snap);
  const hasField = prompt.includes('active_goals): 0');
  const hasMark = prompt.includes('方向性崩溃先兆');
  console.log('FIELD=' + hasField + ' MARK=' + hasMark);
}).catch(e => console.log('ERR=' + e.message));
")
if echo "$D_OUT" | grep -q "FIELD=true MARK=true"; then
  pass "Case D: prompt 含 active_goals=0 + 先兆标记"
else
  fail "Case D: $D_OUT"
fi
echo ""

# ─── Case E: alerting.raise P0 可调用不抛 ───────────────
echo "[Case E] alerting.raise('P0','heartbeat_active_goals_zero',...) 不抛"
E_OUT=$(run_node "
import('/app/src/alerting.js').then(async m => {
  let threw = false;
  try {
    await m.raise('P0', 'heartbeat_active_goals_zero_smoke_test',
      'smoke test — 验证 raise 接口可用，请忽略此告警');
  } catch (e) { threw = true; }
  console.log('NO_THROW=' + (!threw));
}).catch(e => console.log('ERR=' + e.message));
")
if echo "$E_OUT" | grep -q "NO_THROW=true"; then
  pass "Case E: raise P0 调用不抛"
else
  fail "Case E: $E_OUT"
fi
echo ""

echo "📊 heartbeat-active-goals-alert-smoke: PASSED=$PASSED FAILED=$FAILED"
exit "$FAILED"
