#!/usr/bin/env bash
# Smoke: 阶段2 Slice 1 — harness merge 后 staging 部署 + 自动 E2E（本地可验证检查）
#
# 验证这条链路真正搭好、不是占位符：
#   1. staging-e2e-runner.js 存在，且皇冠断言成立：E2E target 钉死 staging:5222
#      （resolveStagingTarget 返回 :5222 而非 production:5221 / PR 分支活宿主）。
#   2. mergePrNode 两条 merged 分支都 best-effort 建 staging_e2e 任务，try/catch 永不 throw。
#   3. executor 有 staging_e2e 内部 handler 分支，且排在 retired 短路块之前不被拦截。
#   4. migration 304 建 staging_e2e_results 且 pr_url 加 UNIQUE（DB 级幂等）。
#   5. runStagingE2e 真实跑：staging 不可达时优雅降级 verdict=skipped 落库，绝不抛错
#      （不是 echo 占位 —— 真 import 模块跑编排逻辑）。
#
# 失败 = 链路没真正搭好（silent-success 防线漏了 / 碰了 interrupt / 不幂等）。
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
BRAIN_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"
SRC="$BRAIN_DIR/src"
RUNNER="$SRC/staging-e2e-runner.js"
GRAPH="$SRC/workflows/harness-task.graph.js"
EXECUTOR="$SRC/executor.js"
MIGRATION="$BRAIN_DIR/migrations/304_staging_e2e_results.sql"

FAIL=0
pass() { printf '✓ %s\n' "$1"; }
fail() { printf '✗ %s\n' "$1"; FAIL=1; }

printf '%s\n' "▶️  smoke: staging-e2e-smoke.sh"

# ── 1. runner 存在 + 皇冠断言（target=staging:5222）──────────────────────────
if [ -f "$RUNNER" ]; then
  pass "runner 存在: src/staging-e2e-runner.js"
else
  fail "runner 缺失: src/staging-e2e-runner.js"
fi

if [ -f "$RUNNER" ]; then
  CROWN=$(cd "$BRAIN_DIR" && node --input-type=module -e "
    import('./src/staging-e2e-runner.js').then(m => {
      const t = m.resolveStagingTarget({ id: 'x', payload: {} });
      if (m.STAGING_PORT !== 5222) { console.log('BAD_PORT'); process.exit(0); }
      if (!t.brainUrl.includes(':5222') || t.brainUrl.includes(':5221')) { console.log('NOT_STAGING'); process.exit(0); }
      console.log('OK');
    }).catch(e => { console.log('ERR:' + e.message); });
  " 2>&1)
  if [ "$CROWN" = "OK" ]; then
    pass "皇冠断言：E2E target 钉死 staging:5222（非 production:5221 / 活宿主）"
  else
    fail "皇冠断言失败（target 不是 staging:5222）：$CROWN"
  fi
fi

# ── 2. mergePrNode 两条 merged 分支都建任务 + best-effort 永不 throw ─────────
if [ -f "$GRAPH" ]; then
  N=$(grep -oF '_spawnStagingE2eTask(state, opts)' "$GRAPH" 2>/dev/null | wc -l | awk '{print $1}')
  : "${N:=0}"
  if [ "$N" -ge 2 ]; then
    pass "mergePrNode 两条 merged 分支都建 staging_e2e 任务（spawns=${N}）"
  else
    fail "mergePrNode 未在两条 merged 分支都建任务（spawns=${N}，应>=2）"
  fi
  if grep -q 'async function _spawnStagingE2eTask' "$GRAPH"; then
    pass "_spawnStagingE2eTask helper 存在"
  else
    fail "_spawnStagingE2eTask helper 缺失"
  fi
fi

# ── 3. executor staging_e2e 内部 handler 分支，排在 retired 短路块之前 ───────
if [ -f "$EXECUTOR" ]; then
  if grep -q "task.task_type === 'staging_e2e'" "$EXECUTOR"; then
    S=$(grep -n "task.task_type === 'staging_e2e'" "$EXECUTOR" | head -1 | cut -d: -f1)
    R=$(grep -n 'if (_RETIRED_HARNESS_TYPES.has(task.task_type)) {' "$EXECUTOR" | head -1 | cut -d: -f1)
    if [ -n "$S" ] && [ -n "$R" ] && [ "$S" -lt "$R" ]; then
      pass "executor staging_e2e 分支排在 retired 短路块之前（不被拦截）"
    else
      fail "executor staging_e2e 分支位置错误（S=$S R=$R，应 S<R）"
    fi
  else
    fail "executor 缺 staging_e2e 内部 handler 分支"
  fi
fi

# ── 4. migration 304 建表 + pr_url UNIQUE（DB 级幂等）────────────────────────
if [ -f "$MIGRATION" ]; then
  if grep -q 'CREATE TABLE IF NOT EXISTS staging_e2e_results' "$MIGRATION" \
     && grep -qiE 'UNIQUE INDEX.*staging_e2e_results' "$MIGRATION"; then
    pass "migration 304 建 staging_e2e_results 且 pr_url UNIQUE（幂等）"
  else
    fail "migration 304 缺表或 pr_url UNIQUE 约束"
  fi
else
  fail "migration 缺失: migrations/304_staging_e2e_results.sql"
fi

# ── 5. runStagingE2e 真跑：staging 不可达 → 优雅降级 verdict=skipped 不抛错 ──
if [ -f "$RUNNER" ]; then
  DEGRADE=$(cd "$BRAIN_DIR" && node --input-type=module -e "
    import('./src/staging-e2e-runner.js').then(async m => {
      const task = { id: 's', payload: { pr_url: 'https://x/pull/SMOKE' } };
      const res = await m.runStagingE2e(task, {
        deployStaging: async () => ({ ok: false, skipReason: 'no_docker' }),
        runE2eOnStaging: async () => { throw new Error('should not be called'); },
        dbQuery: async () => ({ rows: [] }),
      });
      console.log(res.verdict === 'skipped' ? 'OK' : 'BAD:' + res.verdict);
    }).catch(e => { console.log('THREW:' + e.message); });
  " 2>&1)
  if [ "$DEGRADE" = "OK" ]; then
    pass "runStagingE2e 在 staging 不可达时优雅降级 verdict=skipped（不抛错）"
  else
    fail "runStagingE2e 降级行为错误（应 skipped 不抛错）：$DEGRADE"
  fi
fi

printf '%s\n' "----------------------------------------"
if [ "$FAIL" -eq 0 ]; then
  printf '%s\n' "✅ staging-e2e-smoke PASS"
  exit 0
else
  printf '%s\n' "❌ staging-e2e-smoke FAIL"
  exit 1
fi
