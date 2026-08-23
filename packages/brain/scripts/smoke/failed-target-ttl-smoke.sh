#!/usr/bin/env bash
# failed-target-ttl-smoke.sh — capability preflight failed_targets 时效窗口豁免真验
#
# 验证 listFailedExecutionTargets 只统计最近 N 小时（默认 2h，可 HARNESS_FAILED_TARGET_TTL_HOURS
# 覆盖）内 created_at 的失败记录：用 stub pool 捕获真实发往 Postgres 的 SQL 文本与绑定参数，
# 断言 created_at make_interval 时效窗口谓词 + 第三绑定参数（默认 2 / env 覆盖 / 非法回退 2）。
# 纯读逻辑，无副作用；不依赖运行中的 Brain / DB（stub pool 直接消费 SQL 契约）。
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../../.." && pwd)"
STORE_URL="file://${REPO_ROOT}/packages/brain/src/orchestrator/attempt-store.js"

echo "🔬 failed-target-ttl-smoke — 断言时效窗口 SQL 契约"
echo "   module: ${STORE_URL}"

STORE_URL="$STORE_URL" node --input-type=module <<'NODE'
import assert from 'node:assert/strict';

const { createAttemptStore } = await import(process.env.STORE_URL);
const RUN_ID = '11111111-1111-4111-8111-111111111111';

function stubPool() {
  const calls = [];
  return {
    calls,
    query: async (sql, params) => { calls.push({ sql, params }); return { rows: [], rowCount: 0 }; },
  };
}

// 默认 2 小时窗口：SQL 含 created_at make_interval 过滤，第三参数为 2
delete process.env.HARNESS_FAILED_TARGET_TTL_HOURS;
let pool = stubPool();
await createAttemptStore(pool).listFailedExecutionTargets(RUN_ID, 'generator');
assert.match(pool.calls[0].sql, /created_at\s*>=\s*NOW\(\)\s*-\s*make_interval\s*\(\s*hours\s*=>\s*\$3\s*\)/i,
  'SQL 缺 created_at make_interval 时效窗口谓词');
assert.deepEqual(pool.calls[0].params, [RUN_ID, 'generator', 2], '默认第三参数应为 2');

// env 覆盖：HARNESS_FAILED_TARGET_TTL_HOURS=5 → 第三参数 5
process.env.HARNESS_FAILED_TARGET_TTL_HOURS = '5';
pool = stubPool();
await createAttemptStore(pool).listFailedExecutionTargets(RUN_ID, 'generator');
assert.deepEqual(pool.calls[0].params, [RUN_ID, 'generator', 5], 'env 覆盖第三参数应为 5');

// 非法 env → 回退默认 2
process.env.HARNESS_FAILED_TARGET_TTL_HOURS = 'not-a-number';
pool = stubPool();
await createAttemptStore(pool).listFailedExecutionTargets(RUN_ID, 'generator');
assert.deepEqual(pool.calls[0].params, [RUN_ID, 'generator', 2], '非法 env 应回退 2');

// 窗口内含语义使用 >= 而非 >
assert.match(pool.calls[0].sql, /created_at\s*>=/i, '窗口边界应为 >=');
assert.ok(!/created_at\s*>\s*NOW/i.test(pool.calls[0].sql), '窗口边界不得写成 >');

console.log('✅ failed-target-ttl-smoke PASS: 时效窗口 SQL 契约与绑定参数均符合');
NODE
