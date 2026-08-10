#!/usr/bin/env bash
# E2E 验收脚本 — janitor-devops-homecoming
# Sprint: 08101632-janitor-devops-homecoming
# Task ID: 61f7a4dd-4635-4bbd-a80d-eae1e91cbbe5
# 执行环境: 本地（local_api），在 cecelia 仓根目录执行
# 使用方式: bash sprints/08101632-janitor-devops-homecoming/tests/e2e-acceptance.sh

set -euo pipefail

PASS=0
FAIL=0
JANITOR="scripts/ops/janitor.sh"
REPO_ROOT="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
cd "$REPO_ROOT"

ok()   { echo "[PASS] $1"; PASS=$((PASS+1)); }
fail() { echo "[FAIL] $1"; FAIL=$((FAIL+1)); }

echo "═══════════════════════════════════════════════════════"
echo "E2E 验收 — janitor-devops-homecoming"
echo "执行路径: $REPO_ROOT"
echo "═══════════════════════════════════════════════════════"

# ── E2E-1: 脚本存在且可执行 ──────────────────────────────────────────────────
[ -f "$JANITOR" ] \
  && ok "janitor.sh 存在于 scripts/ops/" \
  || fail "janitor.sh 不存在于 scripts/ops/"

[ -x "$JANITOR" ] \
  && ok "janitor.sh 可执行（chmod +x）" \
  || fail "janitor.sh 不可执行（需要 chmod +x）"

# ── E2E-2: bash 语法检查 ──────────────────────────────────────────────────────
if bash -n "$JANITOR" 2>/dev/null; then
  ok "janitor.sh bash 语法检查通过（bash -n）"
else
  fail "janitor.sh 存在 bash 语法错误"
fi

# ── E2E-3: 无 branch-gc.sh 引用（步骤8内联化） ───────────────────────────────
if ! grep -q "branch-gc.sh" "$JANITOR"; then
  ok "步骤8 无 branch-gc.sh 引用（内联实现）"
else
  fail "步骤8 仍引用 branch-gc.sh，违反 PRD（移除外部依赖要求）"
fi

# ── E2E-4: 步骤8 含内联分支删除逻辑 ──────────────────────────────────────────
if grep -qE "git branch (-d|--delete|--merged)" "$JANITOR"; then
  ok "步骤8 含内联 git branch 删除逻辑"
else
  fail "步骤8 缺少内联 git branch 删除逻辑"
fi

# ── E2E-5: 无硬编码用户路径 ──────────────────────────────────────────────────
if ! grep -qE '/Users/administrator|/home/[a-z]+/(cecelia|zenithjoy|perfect21)' "$JANITOR"; then
  ok "脚本无硬编码用户路径（符合 Invariant: 禁写死环境假设）"
else
  fail "脚本含硬编码用户路径（违反 Invariant: 禁写死环境假设）"
fi

# ── E2E-6: Guard A 三查实现 ───────────────────────────────────────────────────
GUARD_OK=0
grep -q "git worktree list" "$JANITOR" && GUARD_OK=$((GUARD_OK+1))
grep -q "git status" "$JANITOR" && GUARD_OK=$((GUARD_OK+1))
grep -q ".dev-lock" "$JANITOR" && GUARD_OK=$((GUARD_OK+1))
if [ "$GUARD_OK" -ge 2 ]; then
  ok "Guard A 三查实现存在（worktree list + status/dev-lock，命中 $GUARD_OK/3）"
else
  fail "Guard A 三查实现不完整（仅命中 $GUARD_OK/3 关键词）"
fi

# ── E2E-7: FAIL 显式化 ────────────────────────────────────────────────────────
if grep -qE "FAILED_STEPS|FAIL\b" "$JANITOR"; then
  ok "FAIL 显式化实现存在（FAILED_STEPS 变量或 FAIL 标志）"
else
  fail "FAIL 显式化实现缺失（无 FAILED_STEPS 或 FAIL 标志）"
fi

# ── E2E-8: 台账 ledger.csv 写入 ──────────────────────────────────────────────
if grep -q "janitor-ledger.csv" "$JANITOR"; then
  ok "台账 janitor-ledger.csv 写入逻辑存在"
else
  fail "台账 janitor-ledger.csv 写入逻辑缺失"
fi

# ── E2E-9: Brain 告警 description 字段 ────────────────────────────────────────
if grep -qE '"description"|description=' "$JANITOR"; then
  ok "Brain 告警 description 字段赋值逻辑存在"
else
  fail "Brain 告警 description 字段缺失（pre-flight 会拒收空 description）"
fi

# ── E2E-10: dry-run 模式实现 ─────────────────────────────────────────────────
if grep -qE "dry.run|DRY_RUN|dry_run" "$JANITOR"; then
  ok "dry-run 模式实现存在"
else
  fail "dry-run 模式实现缺失"
fi

# ── E2E-11: 磁盘水位 70% 阈值 ────────────────────────────────────────────────
if grep -q "70" "$JANITOR"; then
  ok "磁盘水位 70% 阈值存在"
else
  fail "磁盘水位 70% 阈值缺失"
fi

# ── E2E-12: 步骤9 扫描正确路径（worktrees/cecelia + worktrees/zenithjoy） ────
if grep -qE 'worktrees/(cecelia|zenithjoy)|\$HOME/worktrees' "$JANITOR"; then
  ok "步骤9 扫描路径含 worktrees/ 目录引用"
else
  fail "步骤9 扫描路径未引用 worktrees/ 目录（可能扫错目录）"
fi

# ── E2E-13: 死化石目录已从 git 删除 ──────────────────────────────────────────
JANITOR_FOSSIL_COUNT=$(git ls-files packages/workflows/skills/janitor/ 2>/dev/null | wc -l | tr -d ' ')
if [ "$JANITOR_FOSSIL_COUNT" -eq 0 ]; then
  ok "packages/workflows/skills/janitor/ 已从 git 中删除（死化石清除）"
else
  fail "packages/workflows/skills/janitor/ 仍有 $JANITOR_FOSSIL_COUNT 个文件在 git 中"
fi

# ── E2E-14: 测试文件存在于新路径 ─────────────────────────────────────────────
TEST_COUNT=$(find scripts/ops/__tests__/janitor/ -name "*.sh" 2>/dev/null | wc -l | tr -d ' ')
if [ "$TEST_COUNT" -gt 0 ]; then
  ok "测试文件已迁入 scripts/ops/__tests__/janitor/（$TEST_COUNT 个 .sh 文件）"
else
  fail "scripts/ops/__tests__/janitor/ 下无测试文件"
fi

# ── E2E-15: dry-run 实际运行退出码 0 ─────────────────────────────────────────
if DRY_RUN_OUT=$(DISK_PCT=50 bash "$JANITOR" --mode daily --dry-run 2>&1); then
  ok "dry-run 实际运行退出码 0"
else
  DRY_EXIT=$?
  fail "dry-run 运行失败（exit code: $DRY_EXIT）"
fi

echo ""
echo "═══════════════════════════════════════════════════════"
echo "E2E 验收结果: $PASS 通过 / $FAIL 失败"
echo "═══════════════════════════════════════════════════════"
[ "$FAIL" -eq 0 ] && exit 0 || exit 1
