#!/bin/bash
# smoke: reviewGateNode interrupt 前启动 review 预览环境
set -e

GRAPH="packages/brain/src/workflows/harness-task.graph.js"

fail() { echo "❌ FAIL: $1"; exit 1; }
pass() { echo "✅ PASS: $1"; }

# 1. reviewGateNode 引入 preview-manager
grep -q 'preview-manager' "$GRAPH" && \
  pass "harness-task.graph.js: preview-manager import 存在" || \
  fail "harness-task.graph.js: 缺少 preview-manager import"

# 2. reviewGateNode 引入 staging-e2e-runner
grep -q 'staging-e2e-runner' "$GRAPH" && \
  pass "harness-task.graph.js: staging-e2e-runner import 存在" || \
  fail "harness-task.graph.js: 缺少 staging-e2e-runner import"

# 3. allocatePort 调用
grep -q 'allocatePort' "$GRAPH" && \
  pass "harness-task.graph.js: allocatePort 调用存在" || \
  fail "harness-task.graph.js: 缺少 allocatePort 调用"

# 4. spawnReviewPreview 调用
grep -q 'spawnReviewPreview' "$GRAPH" && \
  pass "harness-task.graph.js: spawnReviewPreview 调用存在" || \
  fail "harness-task.graph.js: 缺少 spawnReviewPreview 调用"

# 5. preview_url 传给通知函数
grep -q 'preview_url' "$GRAPH" && \
  pass "harness-task.graph.js: preview_url 传递存在" || \
  fail "harness-task.graph.js: 缺少 preview_url 传递"

# 6. opts.notifyFn 注入（测试可 mock）
grep -q 'opts\.notifyFn' "$GRAPH" && \
  pass "harness-task.graph.js: opts.notifyFn 注入存在" || \
  fail "harness-task.graph.js: 缺少 opts.notifyFn 注入"

echo ""
echo "review-gate-preview smoke: 全部通过"
