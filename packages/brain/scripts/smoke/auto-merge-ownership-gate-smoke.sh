#!/usr/bin/env bash
# auto-merge-ownership-gate-smoke.sh
#
# 验证「auto-merge 归属判据改向 Brain 求证」这条缺陷修复的落地（法源：决策 e8f6134f；
# 事故 PR #4755）。断言：
#   1. should-auto-merge.sh 不再依赖 PR 标题前缀，改为查询 Brain /pr-ownership，且
#      fail-closed（Brain 不可达 → SKIP）。
#   2. harness.js 注册了只读端点 GET /pr-ownership。
#   3. 行为层：已知 harness PR（Brain 有匹配 run）→ owned:true；已知非 harness PR
#      （无匹配 run）→ owned:false。用纯函数 resolvePrOwnership + fake pool 真跑断言，
#      不依赖 live DB。
#
# 用法：bash packages/brain/scripts/smoke/auto-merge-ownership-gate-smoke.sh
# 退出码：0=通过 1=失败
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/../../../.." && pwd)"

GREEN='\033[0;32m'; RED='\033[0;31m'; NC='\033[0m'
FAILED=0
pass() { echo -e "${GREEN}[PASS]${NC} $1"; }
fail() { echo -e "${RED}[FAIL]${NC} $1"; FAILED=$((FAILED + 1)); }

echo "=== auto-merge ownership gate smoke（决策 e8f6134f / 事故 #4755）==="

SHELL_SCRIPT="$ROOT_DIR/.github/workflows/scripts/should-auto-merge.sh"
HARNESS_ROUTE="$ROOT_DIR/packages/brain/src/routes/harness.js"
OWNERSHIP_MOD="$ROOT_DIR/packages/brain/src/harness-pr-ownership.js"

# ── 1. should-auto-merge.sh 向 Brain 求证 + fail-closed ─────────────────────────────
if [[ -f "$SHELL_SCRIPT" ]] && grep -q 'pr-ownership' "$SHELL_SCRIPT" \
   && grep -q 'fail-closed' "$SHELL_SCRIPT"; then
  pass "should-auto-merge.sh 查询 Brain /pr-ownership 且含 fail-closed 分支"
else
  fail "should-auto-merge.sh 未接 Brain /pr-ownership 或缺 fail-closed"
fi

# 归属判据不再依赖 PR 标题：脚本不得再用 feat(harness): 前缀 grep 作决策。
if [[ -f "$SHELL_SCRIPT" ]] && grep -qE "grep .*feat\\\\?\\(harness\\\\?\\):" "$SHELL_SCRIPT"; then
  fail "should-auto-merge.sh 仍用 PR 标题 feat(harness): 前缀作判据（应已废弃）"
else
  pass "should-auto-merge.sh 不再用 PR 标题前缀作归属判据"
fi

# ── 2. harness.js 注册只读端点 GET /pr-ownership ───────────────────────────────────
if [[ -f "$HARNESS_ROUTE" ]] && grep -q "router.get('/pr-ownership'" "$HARNESS_ROUTE" \
   && grep -q "resolvePrOwnership" "$HARNESS_ROUTE"; then
  pass "harness.js 注册 GET /pr-ownership 并调用 resolvePrOwnership"
else
  fail "harness.js 缺 GET /pr-ownership 端点"
fi

# ── 3. fail-closed 行为真跑：Brain 不可达 → SKIP（不 MERGE）──────────────────────────
STUB="$(mktemp)"; printf '#!/usr/bin/env bash\nexit 28\n' > "$STUB"; chmod +x "$STUB"
OUT="$(BRAIN_CURL="$STUB" bash "$SHELL_SCRIPT" "cp-08101107-04e4690d" "fix(orchestrator): whatever" "4755" 2>&1)"
rm -f "$STUB"
if printf '%s' "$OUT" | grep -q '^SKIP:' && ! printf '%s' "$OUT" | grep -qx 'MERGE'; then
  pass "Brain 不可达时 fail-closed 输出 SKIP（不误放 harness PR）"
else
  fail "Brain 不可达时未 fail-closed（输出: $OUT）"
fi

# ── 4. 行为层归属判定（fake pool，无 live DB）──────────────────────────────────────
node --input-type=module -e "
import { resolvePrOwnership } from '$OWNERSHIP_MOD';

// 已知 harness PR：Brain 有匹配 run（fake pool 返回一行）
const ownedPool = async () => ({ rows: [{ id: 'run-42', initiative_id: 'init-9', pr_url: 'https://github.com/perfectuser21/cecelia/pull/4755' }] });
const r1 = await resolvePrOwnership(ownedPool, { branch: 'cp-08101107-04e4690d', prNumber: '4755' });
if (r1.owned !== true || r1.run_id !== 'run-42') {
  console.error('FAIL: 已知 harness PR 应 owned:true，实际 ' + JSON.stringify(r1)); process.exit(1);
}

// 已知非 harness PR：Brain 无匹配 run（fake pool 返回空）
const emptyPool = async () => ({ rows: [] });
const r2 = await resolvePrOwnership(emptyPool, { branch: 'cp-08081317-manual-cd7e0028', prNumber: '9999' });
if (r2.owned !== false) {
  console.error('FAIL: 已知非 harness PR 应 owned:false，实际 ' + JSON.stringify(r2)); process.exit(1);
}
console.log('OK: resolvePrOwnership 已知 harness / 非 harness PR 归属判定正确');
" && pass "resolvePrOwnership 行为层归属判定正确（owned true / false）" \
   || fail "resolvePrOwnership 行为层归属判定错误"

echo ""
if [[ "$FAILED" -eq 0 ]]; then
  echo -e "${GREEN}=== auto-merge ownership gate smoke 全部通过 ===${NC}"
  exit 0
else
  echo -e "${RED}=== auto-merge ownership gate smoke 失败 $FAILED 项 ===${NC}"
  exit 1
fi
