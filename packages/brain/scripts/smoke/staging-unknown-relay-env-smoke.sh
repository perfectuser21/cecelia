#!/usr/bin/env bash
# staging-unknown-relay-env-smoke.sh
# 验证：
#   1. staging-e2e-runner: unknown base_repo 时存在显式 early-return，不进 deploy 逻辑
#   2. harness-skill-relay: spawn env 含 HARNESS_WORKTREE_HOST（宿主 worktree 路径注入）
#
# 两项均为源码结构性断言（行为已被 vitest 单测覆盖）+ node 模块可导入检查。
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/../../../.." && pwd)"
BRAIN_SRC="$ROOT_DIR/packages/brain/src"
FAIL=0
pass() { printf '✓ %s\n' "$1"; }
fail() { printf '✗ %s\n' "$1"; FAIL=1; }

printf '%s\n' "▶️  smoke: staging-unknown-relay-env-smoke.sh"

# ── 1. staging-e2e-runner: unknown_repo guard 存在 ───────────────────────────
RUNNER="$BRAIN_SRC/staging-e2e-runner.js"
if [ ! -f "$RUNNER" ]; then
  fail "staging-e2e-runner.js 文件缺失: $RUNNER"
else
  # unknown 线 early-return: 必须有 line === 'unknown' 判断
  if grep -qE "line\s*===\s*['\"]unknown['\"]" "$RUNNER"; then
    pass "staging-e2e-runner: 含 line==='unknown' 显式判断"
  else
    fail "staging-e2e-runner: 缺少 line==='unknown' guard（unknown repo 会误跑 staging-deploy.sh）"
  fi

  # 必须在 unknown 判断内有 unknown_repo reason 返回
  if grep -qE "unknown_repo" "$RUNNER"; then
    pass "staging-e2e-runner: 含 unknown_repo reason（SKIP 路径标识符）"
  else
    fail "staging-e2e-runner: 缺少 unknown_repo reason"
  fi

  # unknown 路径必须有 notify（飞书通知），不能静默跳过
  # grep 范围：unknown 判断块内（取文件中 unknown 块截片来查）
  UNKNOWN_BLOCK=$(awk '/line.*===.*unknown/,/^    \}/' "$RUNNER" 2>/dev/null || true)
  if printf '%s\n' "$UNKNOWN_BLOCK" | grep -qE 'notify\('; then
    pass "staging-e2e-runner: unknown 路径含飞书通知调用"
  else
    fail "staging-e2e-runner: unknown 路径缺少 notify（飞书通知），主理人不知情"
  fi
fi

# ── 2. harness-skill-relay: HARNESS_WORKTREE_HOST 注入 ───────────────────────
RELAY="$BRAIN_SRC/harness-skill-relay.js"
if [ ! -f "$RELAY" ]; then
  fail "harness-skill-relay.js 文件缺失: $RELAY"
else
  if grep -qE "HARNESS_WORKTREE_HOST\s*:" "$RELAY"; then
    pass "harness-skill-relay: env 含 HARNESS_WORKTREE_HOST"
  else
    fail "harness-skill-relay: 缺少 HARNESS_WORKTREE_HOST（controller Step 5 curl judge 无法获取宿主路径）"
  fi

  # 必须是 worktreePath（不是硬编码路径）
  if grep -qE "HARNESS_WORKTREE_HOST\s*:\s*worktreePath" "$RELAY"; then
    pass "harness-skill-relay: HARNESS_WORKTREE_HOST 值为 worktreePath（动态路径，不是硬编码）"
  else
    fail "harness-skill-relay: HARNESS_WORKTREE_HOST 未绑定 worktreePath（可能硬编码，违反铁律）"
  fi
fi

# ── 3. 模块可导入（语法合规）────────────────────────────────────────────────
cd "$ROOT_DIR"
if node --input-type=module -e "
  import { runStagingE2E, deployStaging } from './packages/brain/src/staging-e2e-runner.js';
  import { spawnSkillRelaySession } from './packages/brain/src/harness-skill-relay.js';
  if (typeof runStagingE2E !== 'function') throw new Error('runStagingE2E not exported');
  if (typeof spawnSkillRelaySession !== 'function') throw new Error('spawnSkillRelaySession not exported');
  console.log('modules ok');
" 2>/dev/null; then
  pass "模块可导入（staging-e2e-runner + harness-skill-relay 语法正常）"
else
  fail "模块导入失败（语法错误或 export 缺失）"
fi

printf '%s\n' "----------------------------------------"
if [ "$FAIL" -eq 0 ]; then
  printf '%s\n' "✅ staging-unknown-relay-env-smoke PASS"
  exit 0
else
  printf '%s\n' "❌ staging-unknown-relay-env-smoke FAIL"
  exit 1
fi
