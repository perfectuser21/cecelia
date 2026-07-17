#!/usr/bin/env bash
# dispatch-worker-relay-smoke.sh — worker-pool executor 路由最小冒烟
# 覆盖：FR-5 白名单外 executor 拒绝 + FR-4 核心任务护栏
# task_id: 1f50b6ac-8076-47c5-bff6-cc6bdb79bcd1
set -euo pipefail

PASS=0
FAIL=0

check() {
  local label="$1"
  local expected="$2"
  local actual="$3"
  if [[ "$actual" == *"$expected"* ]]; then
    echo "  PASS: $label"
    PASS=$((PASS + 1))
  else
    echo "  FAIL: $label — expected '$expected'"
    echo "         actual: $actual"
    FAIL=$((FAIL + 1))
  fi
}

SMOKE_DIR=$(mktemp -d /tmp/smoke-relay-XXXXXX)
trap 'rm -rf "$SMOKE_DIR"' EXIT

echo "[smoke] dispatch-worker-relay: FR-5 + FR-4"

# FR-5: 白名单外 executor 拒绝
cat > "$SMOKE_DIR/t3.mjs" << 'T3EOF'
import { spawnSkillRelaySession } from '/workspace/packages/brain/src/harness-skill-relay.js';
const r = await spawnSkillRelaySession(
  { id: 'smoke-t3', task_type: 'dev', title: 'smoke', payload: { orchestrator: 'skill-relay', executor: 'unknown-bot' } },
  {
    pool: { query: async () => ({ rows: [] }) },
    execFn: () => '',
    spawnFn: () => { throw new Error('should not call'); },
    dispatchWorkerFn: () => { throw new Error('should not call'); }
  }
);
process.stdout.write(JSON.stringify(r) + '\n');
T3EOF

OUT=$(node "$SMOKE_DIR/t3.mjs" 2>/dev/null | grep '^{' | head -1 || true)
check "unknown executor rejected (ok:false)" '"ok":false' "$OUT"
check "unknown executor has error field" '"error"' "$OUT"

# FR-4: 核心任务护栏
cat > "$SMOKE_DIR/t2.mjs" << 'T2EOF'
import { spawnSkillRelaySession } from '/workspace/packages/brain/src/harness-skill-relay.js';
const r = await spawnSkillRelaySession(
  {
    id: 'smoke-t2',
    task_type: 'dev',
    title: 'core patch',
    payload: {
      orchestrator: 'skill-relay',
      executor: 'worker-pool',
      base_repo: '/Users/administrator/perfect21/cecelia',
      contract_paths: ['packages/brain/src/tick.js'],
      sprint_dir: 'sprints/smoke-core'
    }
  },
  {
    pool: { query: async () => ({ rows: [] }) },
    execFn: () => '',
    ensureWt: async () => '/tmp/smoke-wt',
    loadSkill: () => 'SKILL',
    dispatchWorkerFn: () => { throw new Error('should not call dispatch-worker'); }
  }
);
process.stdout.write(JSON.stringify(r) + '\n');
T2EOF

OUT=$(node "$SMOKE_DIR/t2.mjs" 2>/dev/null | grep '^{' | head -1 || true)
check "core task guard triggered (ok:false)" '"ok":false' "$OUT"
check "core task guard has correct error" 'feedback_no_core_tasks_to_codex' "$OUT"

echo ""
echo "[smoke] PASS=$PASS FAIL=$FAIL"
[ "$FAIL" -eq 0 ] || exit 1
