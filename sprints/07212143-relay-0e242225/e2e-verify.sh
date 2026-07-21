#!/usr/bin/env bash
# e2e-verify.sh
# 锚定 TASK_ID=0e242225-151d-4bea-a920-9ea51d803269 的回归验证脚本
# 专项验证 executor=claude + mode=headless + orchestrator=skill-relay dispatch chain
# Sprint: sprints/07212143-relay-0e242225
set -euo pipefail

BRAIN="${BRAIN_URL:-http://localhost:5221}"
DB="${DATABASE_URL:-postgresql://cecelia:cecelia@localhost:5432/cecelia}"
TASK_ID="${TASK_ID:-0e242225-151d-4bea-a920-9ea51d803269}"
PASS=0; FAIL=0

ok()   { echo "  [PASS] $1"; ((PASS++)) || true; }
fail() { echo "  [FAIL] $1"; ((FAIL++)) || true; }

echo "════════════════════════════════════════════════════════"
echo "  E2E Verify — headless dispatch chain (0e242225)"
echo "  BRAIN=$BRAIN"
echo "  TASK_ID=$TASK_ID"
echo "════════════════════════════════════════════════════════"
echo ""

# ── E2E-1: GET task 三元组 + 无敏感字段 ──────────────────────────────────────
echo "[E2E-1] GET /api/brain/tasks/$TASK_ID — payload 三元组 + 凭据安全"
HTTP_CODE=$(curl -s -o /tmp/e2e-task-resp.json -w "%{http_code}" "$BRAIN/api/brain/tasks/$TASK_ID" 2>/dev/null || echo "000")
if [ "$HTTP_CODE" = "200" ]; then
  python3 -c "
import sys, json
with open('/tmp/e2e-task-resp.json') as f:
    d = json.load(f)
p = d.get('payload', {})
errs = []
if p.get('mode') != 'headless':
    errs.append('payload.mode=' + str(p.get('mode')) + '（期望 headless）')
if p.get('executor') != 'claude':
    errs.append('payload.executor=' + str(p.get('executor')) + '（期望 claude）')
if p.get('orchestrator') != 'skill-relay':
    errs.append('payload.orchestrator=' + str(p.get('orchestrator')) + '（期望 skill-relay）')
for k in ['token','github_token','anthropic_token']:
    if k in p:
        errs.append('payload 含敏感字段 ' + k)
if errs:
    print('[E2E-1] FAIL: ' + '; '.join(errs))
    sys.exit(1)
print('[E2E-1] payload: mode=' + str(p.get('mode')) + ' executor=' + str(p.get('executor')) + ' orchestrator=' + str(p.get('orchestrator')))
" \
    && ok "E2E-1: GET task payload 三元组正确 + 无凭据字段" \
    || fail "E2E-1: GET task payload 校验失败"
else
  fail "E2E-1: GET task 返回 $HTTP_CODE（期望 200）"
fi

# ── E2E-2: initiative_runs 落行验证 ──────────────────────────────────────────
echo "[E2E-2] DB initiative_runs — orchestrator_host=skill-relay-session, phase!=failed"
RUN_INFO=$(psql "$DB" -t -c \
  "SELECT orchestrator_host, phase FROM initiative_runs WHERE initiative_id='$TASK_ID' AND orchestrator_host='skill-relay-session' AND phase!='failed' ORDER BY created_at DESC LIMIT 1" \
  2>/dev/null | tr -d ' ' || echo "")
if [ -n "$RUN_INFO" ]; then
  ok "E2E-2: initiative_runs 有合法记录（$RUN_INFO）"
else
  # 检查是否有任何记录（含 failed 的）
  ALL_RUNS=$(psql "$DB" -t -c \
    "SELECT orchestrator_host, phase FROM initiative_runs WHERE initiative_id='$TASK_ID' LIMIT 5" \
    2>/dev/null || echo "DB不可达")
  fail "E2E-2: initiative_runs 无合法记录 orchestrator_host=skill-relay-session phase!=failed（所有记录: $ALL_RUNS）"
fi

# ── E2E-3: mode 白名单双向校验 ───────────────────────────────────────────────
echo "[E2E-3] mode 白名单双向校验（headless 放行 / turbo 拒绝）"

# 3a: headless 放行
CODE_HEADLESS=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$BRAIN/api/brain/tasks" \
  -H "Content-Type: application/json" \
  -d '{"task_type":"harness_initiative","title":"e2e-headless-check","payload":{"executor":"claude","mode":"headless","orchestrator":"skill-relay"}}' 2>/dev/null || echo "000")
[ "$CODE_HEADLESS" = "200" ] || [ "$CODE_HEADLESS" = "201" ] \
  && ok "E2E-3a: POST tasks(mode=headless) → $CODE_HEADLESS 放行" \
  || fail "E2E-3a: POST tasks(mode=headless) 应返 200/201，实际 $CODE_HEADLESS"

# 3b: turbo 拒绝
CODE_TURBO=$(curl -s -o /tmp/e2e-400-resp.json -w "%{http_code}" -X POST "$BRAIN/api/brain/tasks" \
  -H "Content-Type: application/json" \
  -d '{"task_type":"harness_initiative","title":"e2e-invalid-mode","payload":{"executor":"claude","mode":"turbo"}}' 2>/dev/null || echo "000")
[ "$CODE_TURBO" = "400" ] \
  && ok "E2E-3b: POST tasks(mode=turbo) → 400 拒绝" \
  || fail "E2E-3b: POST tasks(mode=turbo) 应返 400，实际 $CODE_TURBO"

# ── E2E-4: DB schema — tmux_killed_at 字段存在 ───────────────────────────────
echo "[E2E-4] initiative_runs.tmux_killed_at 字段存在（migration 316）"
COL=$(psql "$DB" -t -c \
  "SELECT column_name FROM information_schema.columns WHERE table_name='initiative_runs' AND column_name='tmux_killed_at'" \
  2>/dev/null | tr -d ' \n' || echo "")
[ "$COL" = "tmux_killed_at" ] \
  && ok "E2E-4: initiative_runs.tmux_killed_at 字段存在" \
  || fail "E2E-4: initiative_runs.tmux_killed_at 字段不存在（migration 316 未跑？）"

# ── E2E-5: smoke 脚本已登记 ──────────────────────────────────────────────────
echo "[E2E-5] claude-headless-dispatch-smoke.sh 在 smoke-allowlist.txt 登记"
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
ALLOWLIST="$REPO_ROOT/packages/quality/smoke-allowlist.txt"
SMOKE_FILE="$REPO_ROOT/packages/brain/scripts/smoke/claude-headless-dispatch-smoke.sh"

[ -f "$SMOKE_FILE" ] \
  && ok "E2E-5a: smoke 脚本文件存在" \
  || fail "E2E-5a: smoke 脚本文件不存在: $SMOKE_FILE"

if [ -f "$ALLOWLIST" ]; then
  grep -q "claude-headless-dispatch-smoke.sh" "$ALLOWLIST" \
    && ok "E2E-5b: smoke 脚本已在 allowlist 登记" \
    || fail "E2E-5b: smoke 脚本未在 allowlist 登记"
else
  fail "E2E-5b: smoke-allowlist.txt 不存在: $ALLOWLIST"
fi

# ── 汇总 ─────────────────────────────────────────────────────────────────────
echo ""
echo "════════════════════════════════════════════════════════"
echo "  E2E 汇总 — PASS: $PASS  FAIL: $FAIL"
echo "════════════════════════════════════════════════════════"
[[ $FAIL -eq 0 ]] \
  && echo "  ✅ 全部通过 — headless dispatch chain E2E 验证完成" \
  || { echo "  ❌ 有 $FAIL 项失败 — 请检查上方 [FAIL] 条目"; exit 1; }
