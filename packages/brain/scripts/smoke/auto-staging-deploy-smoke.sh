#!/usr/bin/env bash
# Smoke: auto-staging-deploy workflow 的本地可验证检查（E2E-first）
#
# 验证"main push → 自动部署到常驻 staging(5222) + 跑 staging smoke"这条链路
# 真正存在且不是占位符：
#   1. 新 workflow 文件 .github/workflows/auto-staging-deploy.yml 存在
#   2. workflow 在 main push 触发，且**只**打 staging（staging:true），绝不调
#      production /deploy 分支、绝不 promote。
#   3. smoke 脚本 scripts/auto-staging-smoke.sh 存在，且在 staging 不健康时
#      硬失败（exit 1），不是 `exit 0` 占位 —— 否则 workflow 永远绿、smoke 形同虚设。
#
# 失败 = 链路没真正搭好。
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/../../../.." && pwd)"
WF="$ROOT_DIR/.github/workflows/auto-staging-deploy.yml"
SMOKE="$ROOT_DIR/scripts/auto-staging-smoke.sh"
WAIT_SHA="$ROOT_DIR/scripts/wait-for-production-sha.sh"

FAIL=0
pass() { printf '✓ %s\n' "$1"; }
fail() { printf '✗ %s\n' "$1"; FAIL=1; }

printf '%s\n' "▶️  smoke: auto-staging-deploy-smoke.sh"

# ── 1. workflow 存在 ──────────────────────────────────────────────────────────
if [ -f "$WF" ]; then
  pass "workflow 存在: .github/workflows/auto-staging-deploy.yml"
else
  fail "workflow 缺失: .github/workflows/auto-staging-deploy.yml"
fi

# ── 2. main push 触发 ─────────────────────────────────────────────────────────
if [ -f "$WF" ] && grep -qE 'push:' "$WF" && grep -qE 'branches:' "$WF" && grep -qE '\bmain\b' "$WF"; then
  pass "workflow 在 main push 触发"
else
  fail "workflow 未在 main push 触发（缺 push/branches/main）"
fi

# ── 3. 只打 staging，绝不碰 production / 绝不 promote ─────────────────────────
if [ -f "$WF" ]; then
  if grep -qE '"staging"[[:space:]]*:[[:space:]]*true|staging.*true' "$WF"; then
    pass "workflow 以 staging:true 触发 staging 部署"
  else
    fail "workflow 未以 staging:true 触发（可能误打 production）"
  fi

  # 绝不出现 production 提升的**动作**：只看去掉 YAML 注释后的实体行，
  # 避免把解释边界的注释文字（含 promote/production 字样）误判为动作。
  WF_CODE=$(sed -E 's/(^|[^"'\''])#.*$/\1/' "$WF")
  if printf '%s\n' "$WF_CODE" | grep -qiE 'uses:.*deploy\.yml|workflow_call|"staging"[[:space:]]*:[[:space:]]*false|mode"?[[:space:]]*:[[:space:]]*"?production'; then
    fail "workflow 含 production/promote 动作（必须 staging-only）"
  else
    pass "workflow 不含 production/promote 动作（staging-only）"
  fi
fi

# ── 4. staging 触发前必须先等 production 同 SHA 就绪 ─────────────────────────
if [ -f "$WAIT_SHA" ]; then
  pass "同 SHA 就绪等待脚本存在"
else
  fail "缺少 scripts/wait-for-production-sha.sh"
fi
if [ -f "$WF" ] && grep -q 'wait-for-production-sha.sh' "$WF" && grep -q 'EXPECTED_SHA.*GITHUB_SHA' "$WF"; then
  WAIT_LINE=$(grep -n 'wait-for-production-sha.sh' "$WF" | head -1 | cut -d: -f1)
  TRIGGER_LINE=$(grep -n '触发 Staging 部署（staging:true' "$WF" | head -1 | cut -d: -f1)
  if [ -n "$WAIT_LINE" ] && [ -n "$TRIGGER_LINE" ] && [ "$WAIT_LINE" -lt "$TRIGGER_LINE" ]; then
    pass "workflow 在 staging 触发前等待 production 同 SHA"
  else
    fail "同 SHA 等待步骤必须位于 staging 触发之前"
  fi
else
  fail "workflow 未用 GITHUB_SHA 调同 SHA 就绪等待脚本"
fi

# ── 5. smoke 脚本存在 ─────────────────────────────────────────────────────────
if [ -f "$SMOKE" ]; then
  pass "smoke 脚本存在: scripts/auto-staging-smoke.sh"
else
  fail "smoke 脚本缺失: scripts/auto-staging-smoke.sh"
fi

# ── 6. smoke 不是占位符：staging 不可达时必须硬失败（exit 1）─────────────────
if [ -f "$SMOKE" ]; then
  # 指向一个必然连不上的端口，smoke 必须返回非 0
  if STAGING_PORT=59999 STAGING_HOST=127.0.0.1 bash "$SMOKE" > /tmp/auto-staging-smoke-neg.log 2>&1; then
    fail "smoke 在 staging 不可达时仍 exit 0（占位符，形同虚设）"
  else
    pass "smoke 在 staging 不可达时硬失败（exit 非 0）"
  fi

  # smoke 必须含真实链路调用（curl staging health），不是 echo 占位
  if grep -qE 'curl' "$SMOKE" && grep -qE '/api/brain/health|/api/brain/tick/status' "$SMOKE"; then
    pass "smoke 含真实 staging 健康检查调用"
  else
    fail "smoke 不含真实 staging 健康检查（curl + /api/brain/health）"
  fi
fi

printf '%s\n' "----------------------------------------"
if [ "$FAIL" -eq 0 ]; then
  printf '%s\n' "✅ auto-staging-deploy-smoke PASS"
  exit 0
else
  printf '%s\n' "❌ auto-staging-deploy-smoke FAIL"
  exit 1
fi
