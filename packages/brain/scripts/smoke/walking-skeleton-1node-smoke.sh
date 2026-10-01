#!/usr/bin/env bash
# Actual Docker -> callback -> PG completion, then persisted interrupt across restart.
set -euo pipefail

if ! node "$(dirname "${BASH_SOURCE[0]}")/../lib/smoke-production-guard.mjs" "http://localhost:5221" --checkpointer; then
  [[ "${SMOKE_ALLOW_WRITE:-}" != '1' ]] && exit 0
  exit 1
fi

CONTAINER="$BRAIN_CONTAINER"
DEADLINE=$((SECONDS + 260))
TARGET='http://localhost:5221/api/brain/walking-skeleton-1node'
fail() { echo "Walking FAIL: $*" >&2; exit 1; }
bounded() {
  local remaining=$((DEADLINE - SECONDS))
  ((remaining > 0)) || fail 'absolute 260s deadline reached'
  timeout "${remaining}s" "$@"
}
instance() { bounded curl -q -fsS --max-time 5 "$TARGET/instance" | jq -er '.instance_id'; }
trigger() { bounded curl -q -fsS --max-time 5 -H 'Content-Type: application/json' \
  -d "$1" "$TARGET/trigger" | jq -er '.thread_id'; }
pg_state() {
  bounded timeout 8s docker exec -e CECELIA_CKPT_QUERY_TIMEOUT_MS=5000 \
    -e CECELIA_CKPT_STATEMENT_TIMEOUT_MS=5000 -e CECELIA_CKPT_CONNECTION_TIMEOUT_MS=5000 \
    "$CONTAINER" node scripts/lib/walking-ci-pg-state.mjs "$1" "$2"
}
wait_state() {
  local mode="$1" thread="$2" until=$((SECONDS + $3)) proof
  while ((SECONDS < until && SECONDS < DEADLINE)); do
    if proof=$(pg_state "$mode" "$thread" 2>/dev/null); then printf '%s\n' "$proof"; return 0; fi
    sleep 1
  done
  pg_state "$mode" "$thread" || true # Only this owned thread; preserve safe failure diagnostics.
  fail "$mode PG proof absent for own thread $thread"
}

# This read-only control verifies the dedicated CI runtime before any graph trigger.
OLD_INSTANCE=$(instance) || fail 'dedicated CI instance unavailable'
[[ "$OLD_INSTANCE" =~ ^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$ ]] || fail 'invalid instance UUID'
bounded docker inspect "$CONTAINER" >/dev/null || fail 'dedicated container absent'

echo '=== Phase 1: actual Docker callback and PG completion ==='
THREAD1=$(trigger '{}') || fail 'Phase 1 trigger failed'
[[ "$THREAD1" =~ ^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$ ]] || fail 'invalid Phase 1 thread UUID'
wait_state completed "$THREAD1" 60
echo "Phase 1 PASS: $THREAD1 actual PG finalized and event count 1"

echo '=== Phase 2: persisted PG interrupt and actual same-container restart ==='
THREAD2=$(trigger '{"wait_for_restart":true}') || fail 'Phase 2 trigger failed'
[[ "$THREAD2" =~ ^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$ ]] || fail 'invalid Phase 2 thread UUID'
[[ "$THREAD1" != "$THREAD2" ]] || fail 'two distinct tracked threads required'
WAITING=$(wait_state waiting "$THREAD2" 30)
printf '%s\n' "$WAITING"
[[ $(jq -er '.restart_instance' <<<"$WAITING") == "$OLD_INSTANCE" ]] || fail 'checkpoint restart instance mismatch'
WORKER2=$(jq -er '.container_id' <<<"$WAITING")
BEFORE_START=$(bounded docker inspect --format '{{.State.StartedAt}}' "$CONTAINER")
bounded timeout 20s docker restart "$CONTAINER"
READY_UNTIL=$((SECONDS + 90))
NEW_INSTANCE=''
while ((SECONDS < READY_UNTIL && SECONDS < DEADLINE)); do
  NEW_INSTANCE=$(instance 2>/dev/null || true)
  if [[ "$NEW_INSTANCE" =~ ^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$ && "$NEW_INSTANCE" != "$OLD_INSTANCE" ]]; then break; fi
  sleep 1
done
[[ "$NEW_INSTANCE" =~ ^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$ && "$NEW_INSTANCE" != "$OLD_INSTANCE" ]] || fail 'new Node instance not observed'
AFTER_START=$(bounded docker inspect --format '{{.State.StartedAt}}' "$CONTAINER")
[[ "$AFTER_START" != "$BEFORE_START" ]] || fail 'actual container restart not observed'
COMPLETED=$(wait_state completed "$THREAD2" 60)
printf '%s\n' "$COMPLETED"
[[ $(jq -er '.container_id' <<<"$COMPLETED") == "$WORKER2" && $(jq -er '.restart_instance' <<<"$COMPLETED") == "$OLD_INSTANCE" ]] || fail 'same worker/checkpoint restart identity lost'
# A late duplicate callback may ACK without finalizing: re-read both real PG outcomes.
pg_state completed "$THREAD1"
pg_state completed "$THREAD2"
echo "Phase 2 PASS: $THREAD2 same PG thread resumed, unique event, new instance $NEW_INSTANCE"
