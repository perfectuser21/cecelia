#!/usr/bin/env bash
# staging-unknown-line-smoke.sh — 刀3 cecelia 侧冒烟（CI 兼容纯检查，不需要 live 服务）：
#   1) staging-e2e-runner.js 含 unknown 线早退分支（第三方 repo 不 deploy，置 pending_promote）
#   2) harness-skill-relay.js spawn env 注入 HARNESS_WORKTREE_HOST（宿主 worktree 绝对路径）
#   3) 两文件语法可解析 + 对应单测文件含新断言
# proven-to-fire 验证法：把下面任一 grep 模式改成不存在的字符串跑一次，必须报红。
set -uo pipefail
ROOT="$(cd "$(dirname "$0")/../../../.." && pwd)"
RUNNER="$ROOT/packages/brain/src/staging-e2e-runner.js"
RELAY="$ROOT/packages/brain/src/harness-skill-relay.js"
fail=0

node --check "$RUNNER" || { echo "❌ staging-e2e-runner.js 语法错误"; fail=1; }
node --check "$RELAY" || { echo "❌ harness-skill-relay.js 语法错误"; fail=1; }

grep -q "line === 'unknown' && baseRepo" "$RUNNER" \
  || { echo "❌ runner 缺 unknown 线早退分支（line === 'unknown' && baseRepo）"; fail=1; }
grep -q "'unknown_line'" "$RUNNER" \
  || { echo "❌ runner 缺 unknown_line reason"; fail=1; }
grep -q "HARNESS_WORKTREE_HOST: worktreePath" "$RELAY" \
  || { echo "❌ relay env 缺 HARNESS_WORKTREE_HOST 注入"; fail=1; }
grep -q "HARNESS_WORKTREE_HOST" "$ROOT/packages/brain/src/__tests__/harness-skill-relay.test.js" \
  || { echo "❌ relay 单测缺 HARNESS_WORKTREE_HOST 断言"; fail=1; }
grep -q "unknown_line" "$ROOT/packages/brain/src/__tests__/staging-e2e-runner.test.js" \
  || { echo "❌ runner 单测缺 unknown_line 断言"; fail=1; }

if [ "$fail" = "0" ]; then echo "✅ staging-unknown-line smoke 通过（早退分支 + env 注入 + 单测断言齐备）"; fi
exit $fail
