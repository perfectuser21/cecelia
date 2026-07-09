#!/bin/bash
# smoke: evaluator PASS 后 runStagingE2E 内 fire-and-forget 启动 review 预览环境
# 死图迁移说明：原 harness-task.graph.js reviewGateNode 已废弃（skill-relay 架构下不再
# 被 invoke），review 预览环境的启动逻辑真实生产者是 staging-e2e-runner.js
# runStagingE2E 内 verdict==='PASS' 分支的 fire-and-forget IIFE（见该文件 ~L802-824）。
set -e

RUNNER="packages/brain/src/staging-e2e-runner.js"

fail() { echo "❌ FAIL: $1"; exit 1; }
pass() { echo "✅ PASS: $1"; }

# 1. 引入 preview-manager（allocatePort 来源）
grep -q 'preview-manager' "$RUNNER" && \
  pass "staging-e2e-runner.js: preview-manager import 存在" || \
  fail "staging-e2e-runner.js: 缺少 preview-manager import"

# 2. allocatePort 调用
grep -q 'allocatePort' "$RUNNER" && \
  pass "staging-e2e-runner.js: allocatePort 调用存在" || \
  fail "staging-e2e-runner.js: 缺少 allocatePort 调用"

# 3. spawnReviewPreview 调用
grep -q 'spawnReviewPreview' "$RUNNER" && \
  pass "staging-e2e-runner.js: spawnReviewPreview 调用存在" || \
  fail "staging-e2e-runner.js: 缺少 spawnReviewPreview 调用"

# 4. review 预览地址（含端口）通过 sendBark 传给通知函数
grep -q 'sendBark' "$RUNNER" && grep -q '38.23.47.81:\${port}' "$RUNNER" && \
  pass "staging-e2e-runner.js: preview 地址(含port)传给 sendBark 通知存在" || \
  fail "staging-e2e-runner.js: 缺少 preview 地址传递给通知函数"

# 5. fire-and-forget：review 环境部署异常被 catch，不影响已返回的 verdict='PASS'
grep -q "review env deploy 失败（不影响 PASS）" "$RUNNER" && \
  pass "staging-e2e-runner.js: review 环境部署异常不阻塞 verdict 存在" || \
  fail "staging-e2e-runner.js: 缺少 review 环境部署异常隔离（应 catch 且不影响 verdict）"

echo ""
echo "review-gate-preview smoke: 全部通过"
