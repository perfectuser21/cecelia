#!/usr/bin/env bash
# harness-death-handlers-smoke.sh
# 验收：四个死因处置器函数可以正确导入并执行基本分支
set -uo pipefail

PASS=0; FAIL=0
ok()   { echo "✅ $1"; ((PASS++)) || true; }
fail() { echo "❌ $1"; ((FAIL++)) || true; }

# 测试1：handleRateLimit → defer_until 写入（不调 spawn）
result=$(node --input-type=module <<'EOF' 2>&1
import { handleRateLimit } from './packages/brain/src/harness-death-handlers.js';
const calls = [];
const pool = { query: async (sql, p) => { calls.push({ sql }); return { rows: [] }; } };
await handleRateLimit(
  { id: 'smoke-rl-001', payload: {} },
  { cause: 'rate_limit', spawnFn: () => { throw new Error('spawn should not be called'); }, pool }
);
const hit = calls.find(c => c.sql.includes('defer_until'));
console.log(hit ? 'defer_until_written' : 'MISSING');
EOF
)
echo "$result" | grep -q "defer_until_written" && ok "handleRateLimit → defer_until 写库" || fail "handleRateLimit 失败 got: $result"

# 测试2：handleGreenWaitingMerge + pr_url → spawn 带 resume_stage=finish
result2=$(node --input-type=module <<'EOF' 2>&1
import { handleGreenWaitingMerge } from './packages/brain/src/harness-death-handlers.js';
let spawnOpts = null;
const pool = { query: async () => ({ rows: [] }) };
await handleGreenWaitingMerge(
  { id: 'smoke-gwm-001', payload: { pr_url: 'https://github.com/org/repo/pull/1' } },
  { cause: 'green_waiting_merge', spawnFn: async (t, o) => { spawnOpts = o; return { ok: true }; }, pool }
);
console.log(spawnOpts?.resume_stage === 'finish' ? 'resume_stage_ok' : 'WRONG:' + spawnOpts?.resume_stage);
EOF
)
echo "$result2" | grep -q "resume_stage_ok" && ok "handleGreenWaitingMerge → resume_stage=finish" || fail "handleGreenWaitingMerge 失败 got: $result2"

# 测试3：shouldSkipDeferredTask → defer_until 未到期返回 true
result3=$(node --input-type=module <<'EOF' 2>&1
import { shouldSkipDeferredTask } from './packages/brain/src/harness-death-handlers.js';
const task = { payload: { defer_until: Date.now() + 60 * 60 * 1000 } };
console.log(shouldSkipDeferredTask(task) ? 'skip_true' : 'skip_false');
EOF
)
echo "$result3" | grep -q "skip_true" && ok "shouldSkipDeferredTask 未到期 → true" || fail "shouldSkipDeferredTask 失败 got: $result3"

# 测试4：scanOrphanedRelayTasks 可以导入
result4=$(node --input-type=module <<'EOF' 2>&1
import { scanOrphanedRelayTasks } from './packages/brain/src/startup-sync.js';
console.log(typeof scanOrphanedRelayTasks === 'function' ? 'fn_ok' : 'MISSING');
EOF
)
echo "$result4" | grep -q "fn_ok" && ok "startup-sync.js scanOrphanedRelayTasks 导出正常" || fail "startup-sync.js 导入失败 got: $result4"

echo ""
echo "smoke: PASS=$PASS FAIL=$FAIL"
[[ $FAIL -eq 0 ]] && exit 0 || exit 1
