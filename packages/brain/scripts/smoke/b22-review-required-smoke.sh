#!/bin/bash
# B22 smoke: review_required 相关实现检查
set -e

BRAIN_SRC="packages/brain/src/workflows"
SKILLS_DIR="packages/workflows/skills/harness-planner"

fail() { echo "❌ FAIL: $1"; exit 1; }
pass() { echo "✅ PASS: $1"; }

# 1. post-pr-create.sh 含 HARNESS_NODE 检测
HOOK_FILE="$(find . -path '*/hooks/post-pr-create.sh' | head -1)"
if [[ -n "$HOOK_FILE" ]]; then
  grep -q 'HARNESS_NODE' "$HOOK_FILE" && pass "post-pr-create.sh: HARNESS_NODE 检测存在" || fail "post-pr-create.sh: 缺少 HARNESS_NODE 检测"
else
  echo "⚠️  SKIP: post-pr-create.sh 不在此 repo（zenithjoy-skills repo）"
fi

# 2. harness-planner SKILL.md 含 review_required 字段
grep -q '"review_required"' "$SKILLS_DIR/SKILL.md" && \
  pass "harness-planner SKILL.md: review_required 字段存在" || \
  fail "harness-planner SKILL.md: 缺少 review_required 字段"

# 3. harness-initiative.graph.js: InitiativeState 含 review_required
grep -q 'review_required.*Annotation' "$BRAIN_SRC/harness-initiative.graph.js" && \
  pass "harness-initiative.graph.js: review_required Annotation 存在" || \
  fail "harness-initiative.graph.js: 缺少 review_required Annotation"

# 4. harness-initiative.graph.js: parsePrdNode 提取逻辑
grep -q 'review_required.*rvMatch\|rvMatch.*review_required' "$BRAIN_SRC/harness-initiative.graph.js" && \
  pass "harness-initiative.graph.js: parsePrdNode review_required 提取存在" || \
  fail "harness-initiative.graph.js: parsePrdNode 缺少 review_required 提取"

# 5. harness-task.graph.js: TaskState 含 review_required
grep -q 'review_required.*Annotation' "$BRAIN_SRC/harness-task.graph.js" && \
  pass "harness-task.graph.js: review_required Annotation 存在" || \
  fail "harness-task.graph.js: 缺少 review_required Annotation"

# 6. harness-task.graph.js: mergePrNode 含 interrupt 人工门
grep -q 'await_human_review' "$BRAIN_SRC/harness-task.graph.js" && \
  pass "harness-task.graph.js: mergePrNode 人工门存在" || \
  fail "harness-task.graph.js: mergePrNode 缺少 await_human_review interrupt"

# 7. harness-task.graph.js: opts.interrupt 注入
grep -q 'opts\.interrupt.*interrupt\|interrupt.*opts\.interrupt' "$BRAIN_SRC/harness-task.graph.js" && \
  pass "harness-task.graph.js: opts.interrupt 注入支持存在" || \
  fail "harness-task.graph.js: 缺少 opts.interrupt 注入"

echo ""
echo "B22 smoke: 全部通过"
