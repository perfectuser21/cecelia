#!/usr/bin/env bash
# Contract 合同测试 — 刀0.5 僵尸文档清尸
# Task ID: 35cb771b-82bf-4d24-b1c4-b7a7b40af79f
#
# 用途：验证所有 [BEHAVIOR] 条目均已满足。
# 执行：bash sprints/08041713-doc-zombie-cleanup/tests/contract-behaviors.test.sh
# 期望：exit 0，所有 PASS 行，无 FAIL 行

set -uo pipefail

# 切换到仓库根目录
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
cd "$REPO_ROOT"

FAILED=0
PASS_COUNT=0
FAIL_COUNT=0

pass() { echo "  PASS: $1"; ((PASS_COUNT++)); }
fail() { echo "  FAIL: $1"; ((FAIL_COUNT++)); FAILED=1; }

echo "========================================"
echo "Contract Behaviors — 僵尸文档清尸"
echo "Task: 35cb771b-82bf-4d24-b1c4-b7a7b40af79f"
echo "========================================"
echo ""

# ------------------------------------------------
# [BEHAVIOR-1] 退役文件不在原路径
# ------------------------------------------------
echo "[BEHAVIOR-1] 退役文件不在原路径"
retired_files=(
  ".agent-knowledge/skills-index.md"
  ".agent-knowledge/CURRENT_STATE.md"
  "scripts/write-current-state.sh"
  "scripts/__tests__/write-current-state.test.sh"
  "packages/engine/tests/write-current-state.test.ts"
  "packages/engine/tests/integration/cleanup-write-state.test.ts"
  "packages/engine/tests/integration/current-state-format.test.ts"
)
for f in "${retired_files[@]}"; do
  if [ -f "$f" ]; then
    fail "$f 仍在原路径（应已 git mv 到 docs/archive/）"
  else
    pass "$f 已从原路径移除"
  fi
done
echo ""

# ------------------------------------------------
# [BEHAVIOR-2] @import 死链和 PATROL-REGISTRY 引用已清除
# ------------------------------------------------
echo "[BEHAVIOR-2] @import 死链和 PATROL-REGISTRY 引用已清除"
if grep -q "@.agent-knowledge/skills-index.md" .claude/CLAUDE.md; then
  fail ".claude/CLAUDE.md 仍含 @import skills-index.md"
else
  pass ".claude/CLAUDE.md: @import skills-index.md 已删除"
fi
if grep -q "@.agent-knowledge/CURRENT_STATE.md" .claude/CLAUDE.md; then
  fail ".claude/CLAUDE.md 仍含 @import CURRENT_STATE.md"
else
  pass ".claude/CLAUDE.md: @import CURRENT_STATE.md 已删除"
fi
if grep -q "PATROL-REGISTRY" docs/current/README.md; then
  fail "docs/current/README.md 仍含 PATROL-REGISTRY"
else
  pass "docs/current/README.md: PATROL-REGISTRY 已清除"
fi
echo ""

# ------------------------------------------------
# [BEHAVIOR-3] 全仓 write-current-state 零命中（archive 外）
# ------------------------------------------------
echo "[BEHAVIOR-3] 全仓 write-current-state 零命中（archive 外）"
wcs_hits=$(grep -r "write-current-state" . \
  --exclude-dir=docs/archive \
  --exclude-dir=.git \
  --exclude-dir=sprints \
  --exclude="doc-zombie-retired.test.sh" \
  --exclude="contract-behaviors.test.sh" \
  --exclude="contract-draft.md" \
  --exclude="contract-dod.md" \
  -l 2>/dev/null || true)
if [ -z "$wcs_hits" ]; then
  pass "write-current-state 在 archive 外零命中"
else
  fail "write-current-state 仍存在于以下文件（archive 外）：$(echo "$wcs_hits" | tr '\n' ' ')"
fi
echo ""

# ------------------------------------------------
# [BEHAVIOR-4] AGENTS.md 快照内容已清除，HARD_RULES 完整
# ------------------------------------------------
echo "[BEHAVIOR-4] AGENTS.md 快照内容已清除，HARD_RULES 完整"
if grep -q "38.23.47.81:9998" AGENTS.md; then
  fail "AGENTS.md 仍含 IP 38.23.47.81:9998"
else
  pass "AGENTS.md: IP 引用已删除"
fi
if grep -q "最后更新：2026-03-16" AGENTS.md; then
  fail "AGENTS.md 仍含快照日期 2026-03-16"
else
  pass "AGENTS.md: 快照日期已删除"
fi
if grep -q "63 个 Skills" AGENTS.md; then
  fail "AGENTS.md 仍含硬编码数字 '63 个 Skills'"
else
  pass "AGENTS.md: 硬编码数字已删除"
fi
if grep -q "skills-index.md" AGENTS.md; then
  fail "AGENTS.md 仍含已退役文件链接 skills-index.md"
else
  pass "AGENTS.md: 退役文件链接已删除"
fi
begin_count=$(grep -c "HARD_RULES:BEGIN" AGENTS.md || true)
end_count=$(grep -c "HARD_RULES:END" AGENTS.md || true)
if [ "$begin_count" -eq 1 ] && [ "$end_count" -eq 1 ]; then
  pass "AGENTS.md: HARD_RULES 区块完整 (BEGIN=1 END=1)"
else
  fail "AGENTS.md: HARD_RULES 区块损坏 (BEGIN=$begin_count END=$end_count)"
fi
echo ""

# ------------------------------------------------
# [BEHAVIOR-5] engine.md 死路径已修正
# ------------------------------------------------
echo "[BEHAVIOR-5] engine.md 死路径已修正"
if grep -q "node packages/engine/scripts/devgate/check-dod-mapping.cjs" .agent-knowledge/engine.md; then
  fail "engine.md 仍含旧路径 packages/engine/scripts/devgate/check-dod-mapping.cjs"
else
  pass "engine.md: 旧 check-dod-mapping.cjs 路径已修正"
fi
if grep -q "node scripts/devgate/scan-rci-coverage.cjs" .agent-knowledge/engine.md; then
  fail "engine.md 仍含旧路径 scripts/devgate/scan-rci-coverage.cjs"
else
  pass "engine.md: 旧 scan-rci-coverage.cjs 路径已修正"
fi
if grep -q "bash scripts/devgate/require-rci-update-if-p0p1.sh" .agent-knowledge/engine.md; then
  fail "engine.md 仍含旧路径 scripts/devgate/require-rci-update-if-p0p1.sh"
else
  pass "engine.md: 旧 require-rci-update-if-p0p1.sh 路径已修正"
fi
if grep -q "packages/quality/scripts/devgate/check-dod-mapping.cjs" .agent-knowledge/engine.md; then
  pass "engine.md: 正确路径 packages/quality/scripts/devgate/ 已写入"
else
  fail "engine.md: 正确路径 packages/quality/scripts/devgate/ 未找到"
fi
echo ""

# ------------------------------------------------
# [BEHAVIOR-6] CI 工作流不含 write-current-state step
# ------------------------------------------------
echo "[BEHAVIOR-6] CI 工作流不含 write-current-state step"
if grep -q "write-current-state" .github/workflows/ci.yml; then
  fail "ci.yml 仍含 write-current-state 引用"
else
  pass "ci.yml: write-current-state step 已删除"
fi
if grep -q "write-current-state" .github/workflows/nightly-regression.yml; then
  fail "nightly-regression.yml 仍含 write-current-state 引用"
else
  pass "nightly-regression.yml: write-current-state step 已删除"
fi
echo ""

# ------------------------------------------------
# [BEHAVIOR-7] cleanup.sh 不含 write-current-state 调用
# ------------------------------------------------
echo "[BEHAVIOR-7] cleanup.sh 不含 write-current-state 调用"
if grep -q "write-current-state" packages/engine/skills/dev/scripts/cleanup.sh; then
  fail "cleanup.sh 仍含 write-current-state 调用（Section 2.6 未删除）"
else
  pass "cleanup.sh: write-current-state 调用已删除"
fi
echo ""

# ------------------------------------------------
# 汇总
# ------------------------------------------------
echo "========================================"
echo "结果汇总"
echo "  PASS: $PASS_COUNT"
echo "  FAIL: $FAIL_COUNT"
echo "========================================"

if [ $FAILED -eq 0 ]; then
  echo "ALL PASS — 合同验收通过"
  exit 0
else
  echo "FAILED — $FAIL_COUNT 条断言未通过，需修复后重跑"
  exit 1
fi
