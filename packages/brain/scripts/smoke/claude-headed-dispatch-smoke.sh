#!/usr/bin/env bash
# claude-headed-dispatch-smoke.sh
# 验证 mode=headed 白名单校验接口行为（Brain API smoke，与 codex-headed-dispatch-smoke.sh 对称）
# Sprint: sprints/07130939-relay-4bb31ef5
set -euo pipefail

BRAIN="${BRAIN_URL:-http://localhost:5221}"
DB="${DATABASE_URL:-postgresql://cecelia:cecelia@localhost:5432/cecelia}"
SMOKE_TAG="claude-headed-dispatch-${GITHUB_RUN_ID:-local}-$$-$RANDOM"
BASE_SHA="$(git rev-parse HEAD)"
PASS=0; FAIL=0
ok()   { echo "  ✅ $1"; ((PASS++)) || true; }
fail() { echo "  ❌ $1"; ((FAIL++)) || true; }
cleanup() {
  psql "$DB" \
    -c "UPDATE tasks SET status='cancelled', updated_at=NOW() WHERE payload->>'smoke_tag' = '$SMOKE_TAG' AND status NOT IN ('completed','cancelled')" \
    >/dev/null 2>&1 || true
}
trap cleanup EXIT

echo "── claude headed dispatch smoke ──"

# 1. POST tasks(mode=headed, executor=claude) → 200 + id
RESP=$(curl -sf -X POST "$BRAIN/api/brain/tasks" \
  -H "Content-Type: application/json" \
  -d "{\"task_type\":\"harness_initiative\",\"title\":\"headed-smoke-test\",\"change_kind\":\"bugfix\",\"base_sha\":\"$BASE_SHA\",\"payload\":{\"executor\":\"claude\",\"mode\":\"headed\",\"journey_id\":\"bb8cc561-b3ee-4fec-b74d-2255694bd963\",\"smoke_tag\":\"$SMOKE_TAG\"}}" 2>/dev/null) || { fail "POST tasks(mode=headed) 不可达"; RESP="{}"; }
echo "$RESP" | python3 -c "import sys,json;d=json.load(sys.stdin);exit(0 if isinstance(d.get('id'),str) else 1)" 2>/dev/null \
  && ok "POST tasks(mode=headed) → 200 + id 字段存在" \
  || fail "POST tasks(mode=headed) 响应异常: $RESP"

# 2. POST tasks(mode=headed, executor=codex) → 200/201（对称验证另一 executor 同样放行）
CODE=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$BRAIN/api/brain/tasks" \
  -H "Content-Type: application/json" \
  -d "{\"task_type\":\"harness_initiative\",\"title\":\"codex-headed-smoke\",\"change_kind\":\"bugfix\",\"base_sha\":\"$BASE_SHA\",\"payload\":{\"executor\":\"codex\",\"mode\":\"headed\",\"journey_id\":\"bb8cc561-b3ee-4fec-b74d-2255694bd963\",\"smoke_tag\":\"$SMOKE_TAG\"}}" 2>/dev/null || echo "000")
[ "$CODE" = "200" ] || [ "$CODE" = "201" ] \
  && ok "POST tasks(executor=codex, mode=headed) → 200/201 放行" \
  || fail "POST tasks(executor=codex, mode=headed) 应返 200/201，实际 $CODE"

# 3. POST tasks(mode=headless) → 200（合法模式）
CODE2=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$BRAIN/api/brain/tasks" \
  -H "Content-Type: application/json" \
  -d "{\"task_type\":\"harness_initiative\",\"title\":\"headless-smoke\",\"change_kind\":\"bugfix\",\"base_sha\":\"$BASE_SHA\",\"payload\":{\"executor\":\"claude\",\"mode\":\"headless\",\"smoke_tag\":\"$SMOKE_TAG\"}}" 2>/dev/null || echo "000")
[ "$CODE2" = "201" ] || [ "$CODE2" = "200" ] \
  && ok "POST tasks(mode=headless) → 200/201 合法" \
  || fail "POST tasks(mode=headless) 应返 200/201，实际 $CODE2"

# 4. POST tasks(mode=invalid) → 400
CODE3=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$BRAIN/api/brain/tasks" \
  -H "Content-Type: application/json" \
  -d "{\"task_type\":\"harness_initiative\",\"title\":\"invalid-mode\",\"change_kind\":\"bugfix\",\"base_sha\":\"$BASE_SHA\",\"payload\":{\"executor\":\"claude\",\"mode\":\"turbo\",\"smoke_tag\":\"$SMOKE_TAG\"}}" 2>/dev/null || echo "000")
[ "$CODE3" = "400" ] \
  && ok "POST tasks(mode=invalid) → 400 拒绝" \
  || fail "POST tasks(mode=invalid) 应返 400，实际 $CODE3"

# 5. initiative_runs 表含 tmux_killed_at 字段（migration 316）
COL=$(psql "$DB" -t -c "SELECT column_name FROM information_schema.columns WHERE table_name='initiative_runs' AND column_name='tmux_killed_at'" 2>/dev/null | tr -d ' ' || echo "")
[ "$COL" = "tmux_killed_at" ] \
  && ok "initiative_runs.tmux_killed_at 字段存在（migration 316）" \
  || fail "initiative_runs.tmux_killed_at 字段不存在（migration 316 未跑？）"

echo ""
echo "PASS: $PASS  FAIL: $FAIL"
[[ $FAIL -eq 0 ]] && echo "✅ 全部通过" || { echo "❌ 有 $FAIL 项失败"; exit 1; }
