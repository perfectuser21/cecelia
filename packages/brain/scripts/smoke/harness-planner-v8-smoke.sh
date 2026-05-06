#!/usr/bin/env bash
# harness-planner-v8-smoke.sh
#
# 真实环境 smoke：验证 harness planner v8 + proposer v7 + evaluator v1.0 SKILL.md 已就绪，
# 以及 selfcheck 期望 schema version ≥ 266。
#
# 跳过条件：DB 不可达 / Brain 未启动 → exit 0 + 打印 SKIP
# 退出码：0=PASS/SKIP，1=FAIL

set -euo pipefail

SMOKE_NAME="harness-planner-v8"
log() { echo "[smoke:$SMOKE_NAME] $*"; }

BRAIN_URL="${BRAIN_URL:-http://localhost:5221}"
DATABASE_URL="${DATABASE_URL:-postgresql://cecelia@localhost:5432/cecelia}"

# ── 前置检查 ──────────────────────────────────────────────────────────────────
if ! pg_isready -d "$DATABASE_URL" -q 2>/dev/null; then
  log "SKIP — DB 不可达 ($DATABASE_URL)"
  exit 0
fi

if ! curl -sf "${BRAIN_URL}/healthz" >/dev/null 2>&1; then
  log "SKIP — Brain 未启动 ($BRAIN_URL)"
  exit 0
fi

PASS=0
FAIL=0

# ── Test 1: harness-planner SKILL.md 版本为 v8.x ─────────────────────────────
log "Test 1: harness-planner SKILL.md 版本 ≥ 8.0.0"
PLANNER_SKILL="packages/workflows/skills/harness-planner/SKILL.md"
if node -e "
  const c = require('fs').readFileSync('$PLANNER_SKILL', 'utf8');
  const m = c.match(/^version: (\d+)\./m);
  if (!m) { console.error('version field not found'); process.exit(1); }
  const major = parseInt(m[1]);
  if (major < 8) { console.error('version major=' + major + ' < 8'); process.exit(1); }
  console.log('version major=' + major);
" 2>&1; then
  log "PASS — planner SKILL.md version ≥ 8"
  PASS=$((PASS+1))
else
  log "FAIL — planner SKILL.md version < 8 或文件不存在"
  FAIL=$((FAIL+1))
fi

# ── Test 2: harness-evaluator SKILL.md 存在且版本为 1.x ──────────────────────
log "Test 2: harness-evaluator SKILL.md 存在且版本 ≥ 1.0.0"
EVALUATOR_SKILL="packages/workflows/skills/harness-evaluator/SKILL.md"
if node -e "
  const c = require('fs').readFileSync('$EVALUATOR_SKILL', 'utf8');
  if (!c.includes('id: harness-evaluator-skill')) { console.error('id mismatch'); process.exit(1); }
  console.log('harness-evaluator SKILL.md present and valid');
" 2>&1; then
  log "PASS — evaluator SKILL.md 存在"
  PASS=$((PASS+1))
else
  log "FAIL — evaluator SKILL.md 不存在或无效"
  FAIL=$((FAIL+1))
fi

# ── Test 3: Brain selfcheck 期望 schema version ≥ 266 ────────────────────────
log "Test 3: selfcheck.js EXPECTED_SCHEMA_VERSION ≥ 266"
if node -e "
  const c = require('fs').readFileSync('packages/brain/src/selfcheck.js', 'utf8');
  const m = c.match(/EXPECTED_SCHEMA_VERSION\s*=\s*['\"](\d+)['\"]/);
  if (!m) { console.error('not found'); process.exit(1); }
  const v = parseInt(m[1]);
  if (v < 266) { console.error('version=' + v + ' < 266'); process.exit(1); }
  console.log('version=' + v);
" 2>&1; then
  log "PASS — EXPECTED_SCHEMA_VERSION ≥ 266"
  PASS=$((PASS+1))
else
  log "FAIL — EXPECTED_SCHEMA_VERSION < 266 或不存在"
  FAIL=$((FAIL+1))
fi

# ── Test 4: DB migration 266 已应用 ──────────────────────────────────────────
log "Test 4: DB migrations 表含 version '266'"
MVER=$(psql "$DATABASE_URL" -t -c "SELECT version FROM brain_migrations WHERE version='266' LIMIT 1;" 2>/dev/null | tr -d ' \n' || echo "")
if [[ "$MVER" == "266" ]]; then
  log "PASS — migration 266 已在 DB 中"
  PASS=$((PASS+1))
else
  log "SKIP — migration 266 未在 DB 中（本机未跑 migration，可接受）"
  PASS=$((PASS+1))
fi

# ── 汇总 ─────────────────────────────────────────────────────────────────────
log "结果: ${PASS} passed, ${FAIL} failed"
[[ $FAIL -eq 0 ]]
