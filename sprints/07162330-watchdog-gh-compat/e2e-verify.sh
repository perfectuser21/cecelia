#!/usr/bin/env bash
# ============================================================
# E2E 验收脚本 — watchdog-gh-compat
# target_environment: local_api
# 运行方式: bash sprints/07162330-watchdog-gh-compat/e2e-verify.sh
# ============================================================
set -euo pipefail

SPRINT_DIR="$(cd "$(dirname "$0")" && pwd)"
BRAIN_ROOT="$(cd "$SPRINT_DIR/../.." && pwd)"
# 测试已毕业进 regression 池
REGRESSION_TEST="$BRAIN_ROOT/tests/regression/watchdog-gh-compat/harness-relay-watchdog-ghcompat.test.js"

echo "=== [E2E-1] 运行合同测试（12 项，B1/B2/B3/回归）==="
cd "$BRAIN_ROOT/packages/brain"
npx vitest run "$REGRESSION_TEST" --reporter=verbose
echo "=== [E2E-1] PASS ==="

echo "=== [E2E-2] 单元断言：_parseBaseRepo zenithjoy-skills ==="
node -e "
import { _parseBaseRepo } from './src/harness-relay-watchdog.js';
const result = _parseBaseRepo('/Users/administrator/perfect21/zenithjoy-skills');
if (result !== 'perfectuser21/zenithjoy-skills') {
  console.error('FAIL: got', result);
  process.exit(1);
}
console.log('PASS: _parseBaseRepo returned', result);
" --input-type=module
echo "=== [E2E-2] PASS ==="

echo "=== [E2E-3] B1 fallback 路径手动断言 ==="
node -e "
import { resumeStalledRelayRuns } from './src/harness-relay-watchdog.js';
const mockTask = { id: 'e2e-task-b1', status: 'in_progress', payload: { orchestrator: 'skill-relay' }, pr_url: null, title: 'test' };
const mockPool = {
  query: async (sql) => {
    if (sql.includes('SELECT DISTINCT')) return { rows: [{ initiative_id: 'e2e-task-b1', phase: 'running', pr_url: 'https://github.com/perfectuser21/cecelia/pull/999', orchestrator_host: 'skill-relay-session', attempts: 1, deadline_at: null, started_at: new Date().toISOString(), completed_at: null, tmux_killed_at: null }] };
    if (sql.includes('SELECT id, status')) return { rows: [mockTask] };
    return { rows: [] };
  }
};
const mockExecFn = (cmd) => {
  if (cmd.includes('gh pr view') && cmd.includes('statusCheckRollup')) return JSON.stringify({ statusCheckRollup: [{ state: 'FAILURE' }], mergeStateStatus: 'DIRTY' });
  if (cmd.includes('gh pr checks') && cmd.includes('--json')) { const err = new Error('unknown flag: --json'); err.stdout = ''; throw err; }
  if (cmd.includes('gh pr view') && cmd.includes('state')) return JSON.stringify({ state: 'OPEN' });
  if (cmd.includes('docker ps')) return '';
  throw new Error('Unexpected: ' + cmd);
};
const out = await resumeStalledRelayRuns({ pool: mockPool, execFn: mockExecFn, spawnFn: async () => ({ ok: true, containerId: 'e2e-container' }) });
if (out.resumed !== 1) { console.error('FAIL: expected resumed=1, got', out.resumed); process.exit(1); }
console.log('PASS: B1 fallback → resumed=1（老版gh --json报错 → pr view statusCheckRollup → CI红 → 触发重点火）');
" --input-type=module
echo "=== [E2E-3] PASS ==="

echo ""
echo "=== 所有 E2E 验收通过 ==="
