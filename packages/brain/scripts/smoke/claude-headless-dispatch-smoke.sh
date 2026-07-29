#!/usr/bin/env bash
# claude-headless-dispatch-smoke.sh
# 验证 executor=claude + mode=headless + orchestrator=skill-relay dispatch chain 关键行为
# 与 claude-headed-dispatch-smoke.sh 对称，补齐 headless 路径专项验收
# Sprint: sprints/07212143-relay-0e242225
# Task: 0e242225-151d-4bea-a920-9ea51d803269
set -euo pipefail

BRAIN="${BRAIN_URL:-http://localhost:5221}"
DB="${DATABASE_URL:-postgresql://cecelia:cecelia@localhost:5432/cecelia}"
TASK_ID="0e242225-151d-4bea-a920-9ea51d803269"
PASS=0; FAIL=0

ok()   { echo "  ✅ $1"; ((PASS++)) || true; }
fail() { echo "  ❌ $1"; ((FAIL++)) || true; }

echo "── claude headless dispatch smoke ──"
echo "   BRAIN=$BRAIN"
echo ""

# ── 1. POST tasks(mode=headless, executor=claude) → 200/201 + id ─────────────
echo "[1] POST tasks(mode=headless, executor=claude) → 200/201 + id"
RESP=$(curl -sf --max-time 10 -X POST "$BRAIN/api/brain/tasks" \
  -H "Content-Type: application/json" \
  -d '{"task_type":"harness_initiative","title":"headless-smoke-test","payload":{"executor":"claude","mode":"headless","orchestrator":"skill-relay"}}' 2>/dev/null) || { fail "POST tasks(mode=headless) 不可达"; RESP="{}"; }
CREATED_ID=$(echo "$RESP" | python3 -c "import sys,json;d=json.load(sys.stdin);print(d.get('id',''))" 2>/dev/null || echo "")
echo "$RESP" | python3 -c "import sys,json;d=json.load(sys.stdin);exit(0 if isinstance(d.get('id'),str) else 1)" 2>/dev/null \
  && ok "POST tasks(mode=headless, executor=claude) → 200/201 + id 字段存在" \
  || fail "POST tasks(mode=headless) 响应异常: $RESP"

# ── 2. POST tasks(mode=invalid) → 400 拒绝 ───────────────────────────────────
echo "[2] POST tasks(mode=turbo/invalid) → 400 拒绝"
CODE=$(curl -s --max-time 10 -o /dev/null -w "%{http_code}" -X POST "$BRAIN/api/brain/tasks" \
  -H "Content-Type: application/json" \
  -d '{"task_type":"harness_initiative","title":"invalid-mode-smoke","payload":{"executor":"claude","mode":"turbo"}}' 2>/dev/null || echo "000")
[ "$CODE" = "400" ] \
  && ok "POST tasks(mode=turbo) → 400 拒绝" \
  || fail "POST tasks(mode=turbo) 应返 400，实际 $CODE"

# ── 3. GET task — payload 三元组完整且无敏感字段（用 Test 1 动态创建的任务）────
echo "[3] GET /api/brain/tasks/<created_id> — payload 三元组 + 凭据安全"
if [ -z "$CREATED_ID" ]; then
  fail "GET task 无法执行：Test 1 未返回有效 id"
  TASK_RESP="{}"
else
  TASK_RESP=$(curl -sf --max-time 10 "$BRAIN/api/brain/tasks/$CREATED_ID" 2>/dev/null) || { fail "GET task 不可达（id=$CREATED_ID）"; TASK_RESP="{}"; }
fi
echo "$TASK_RESP" | python3 -c "
import sys, json
d = json.load(sys.stdin)
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
        errs.append('payload 含敏感字段 ' + k + '（凭据泄漏！）')
if errs:
    print('FAIL: ' + '; '.join(errs)); sys.exit(1)
print('PASS: payload 三元组正确且无敏感字段')
" \
  && ok "GET task payload 三元组正确，无敏感字段" \
  || fail "GET task payload 校验失败"

# ── 4. DB initiative_runs — headless dispatch 所需列存在（schema 可达性验证）───
# CI 环境无法真实派发任务等待 dispatcher 写入记录；改为校验表结构支撑能力。
echo "[4] DB initiative_runs — headless dispatch 所需列存在（orchestrator_host / phase / initiative_id）"
COLS=$(psql "$DB" -t -c \
  "SELECT column_name FROM information_schema.columns WHERE table_name='initiative_runs' AND column_name IN ('orchestrator_host','phase','initiative_id') ORDER BY column_name" \
  2>/dev/null | tr -d ' \n' || echo "")
[ "$COLS" = "initiative_idorchestrator_hostphase" ] \
  && ok "initiative_runs 含 headless dispatch 所需列（initiative_id/orchestrator_host/phase）" \
  || fail "initiative_runs 缺少 headless dispatch 所需列，实际: '$COLS'（期望 initiative_id/orchestrator_host/phase）"

# ── 5. DB schema — initiative_runs.tmux_killed_at 存在（migration 316）──────
echo "[5] initiative_runs.tmux_killed_at 字段存在（migration 316）"
COL=$(psql "$DB" -t -c \
  "SELECT column_name FROM information_schema.columns WHERE table_name='initiative_runs' AND column_name='tmux_killed_at'" \
  2>/dev/null | tr -d ' \n' || echo "")
[ "$COL" = "tmux_killed_at" ] \
  && ok "initiative_runs.tmux_killed_at 字段存在（migration 316 已跑）" \
  || fail "initiative_runs.tmux_killed_at 字段不存在（migration 316 未跑？）"

# ── 6. smoke 脚本结构合法（自检） ────────────────────────────────────────────
echo "[6] smoke 脚本文件结构合法 + allowlist 已登记（自检）"
SCRIPT_PATH="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/claude-headless-dispatch-smoke.sh"
# 脚本位于 packages/brain/scripts/smoke/，向上 4 级到仓库根
ALLOWLIST_PATH="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../../.." && pwd)/packages/quality/smoke-allowlist.txt"
# 备用路径（兼容从仓库根目录直接引用的场景）
if [ ! -f "$ALLOWLIST_PATH" ]; then
  ALLOWLIST_PATH="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)/packages/quality/smoke-allowlist.txt"
fi
[ -f "$SCRIPT_PATH" ] \
  && ok "smoke 脚本文件存在: $SCRIPT_PATH" \
  || fail "smoke 脚本文件不存在: $SCRIPT_PATH"

if [ -f "$ALLOWLIST_PATH" ]; then
  grep -q "claude-headless-dispatch-smoke.sh" "$ALLOWLIST_PATH" \
    && ok "smoke 脚本已在 smoke-allowlist.txt 登记" \
    || fail "smoke 脚本未在 smoke-allowlist.txt 登记"
else
  fail "smoke-allowlist.txt 不存在: $ALLOWLIST_PATH"
fi

echo ""
echo "PASS: $PASS  FAIL: $FAIL"
[[ $FAIL -eq 0 ]] && echo "✅ 全部通过 — headless dispatch chain smoke 完成" || { echo "❌ 有 $FAIL 项失败"; exit 1; }
