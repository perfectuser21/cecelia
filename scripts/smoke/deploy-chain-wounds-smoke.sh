#!/usr/bin/env bash
# deploy-chain-wounds-smoke.sh — 部署链剩余接线守卫
#
# A3: promote-dashboard.sh 含 HK rsync 步骤
# A4: frontend-proxy.js STATIC_DIR 默认 /app（非主仓库绝对路径）
# A5: check-deploy-fingerprint.sh 存在且可执行

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
PASS=0; FAIL=0

ok()   { echo "  ✅ $*"; PASS=$((PASS+1)); }
fail() { echo "  ❌ $*"; FAIL=$((FAIL+1)); }

echo "=== deploy-chain-wounds-smoke ==="

# ── A3: promote-dashboard.sh 含 HK rsync ────────────────────────────────────
echo ""
echo "A3: promote-dashboard.sh HK rsync"
PROMOTE="$REPO_ROOT/scripts/promote-dashboard.sh"
if grep -q 'rsync' "$PROMOTE" && grep -q 'hk-vps' "$PROMOTE"; then
    ok "promote-dashboard.sh: 含 HK rsync 步骤"
else
    fail "promote-dashboard.sh: 缺少 HK rsync（伤口3未修）"
fi

if grep -q 'CECELIA_SKIP_HK' "$PROMOTE"; then
    ok "promote-dashboard.sh: HK rsync 有测试跳过开关（CECELIA_SKIP_HK）"
else
    fail "promote-dashboard.sh: HK rsync 缺少测试跳过开关"
fi

# ── A4: frontend-proxy.js STATIC_DIR 默认 /app ──────────────────────────────
echo ""
echo "A4: frontend-proxy.js 服务根"
PROXY="$REPO_ROOT/frontend-proxy.js"
if grep -q "|| '/app'" "$PROXY" || grep -q '"/app"' "$PROXY"; then
    ok "frontend-proxy.js: STATIC_DIR 默认 /app（deploy-main dist）"
else
    fail "frontend-proxy.js: STATIC_DIR 未指向 /app（伤口4未修）"
fi

if grep -q '/Users/administrator/perfect21/cecelia/apps/dashboard/dist' "$PROXY"; then
    fail "frontend-proxy.js: 仍含主仓库绝对路径硬编码"
else
    ok "frontend-proxy.js: 无主仓库绝对路径硬编码"
fi

# ── A5: check-deploy-fingerprint.sh 存在且可执行 ────────────────────────────
echo ""
echo "A5: 指纹校验脚本"
FP="$REPO_ROOT/scripts/check-deploy-fingerprint.sh"
if [[ -f "$FP" ]]; then
    ok "check-deploy-fingerprint.sh 存在"
else
    fail "check-deploy-fingerprint.sh 不存在"
fi

if [[ -x "$FP" ]]; then
    ok "check-deploy-fingerprint.sh 可执行"
else
    fail "check-deploy-fingerprint.sh 不可执行"
fi

# 指纹脚本含 Bark 推送逻辑
if grep -q 'BARK_TOKEN\|send_bark\|_send_bark' "$FP" 2>/dev/null; then
    ok "check-deploy-fingerprint.sh: 含 Bark 告警"
else
    fail "check-deploy-fingerprint.sh: 缺少 Bark 告警"
fi

# promote 调用了指纹脚本
if grep -q 'check-deploy-fingerprint' "$PROMOTE"; then
    ok "promote-dashboard.sh: 部署后调用指纹校验"
else
    fail "promote-dashboard.sh: 未调用指纹校验脚本"
fi

# ── docker-compose.yml 已移除冗余旧路径 mount ────────────────────────────────
echo ""
echo "A6: docker-compose.yml 冗余 volume"
COMPOSE="$REPO_ROOT/docker-compose.yml"
if grep -q '/Users/administrator/perfect21/cecelia/apps/dashboard/dist.*ro' "$COMPOSE"; then
    fail "docker-compose.yml: 仍含旧 cecelia 路径只读 mount（漂移根因未清）"
else
    ok "docker-compose.yml: 已移除旧 cecelia dist 只读 mount"
fi

# npm 失败中止由 deploy-local-npm-cache fixture 验证；
# frontend 重绑与 Brain 隔离由 dashboard-release-promote fixture 验证。
echo ""
echo "=== 结果：PASS=$PASS  FAIL=$FAIL ==="
[[ $FAIL -eq 0 ]]
