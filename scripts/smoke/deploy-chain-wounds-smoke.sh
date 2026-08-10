#!/usr/bin/env bash
# deploy-chain-wounds-smoke.sh — 刀3-T3 四伤口回归守卫
#
# A1: deploy-local.sh npm install 失败时中止部署（loud-fail，不再 || true）
# A2: npm cache 不再写 /tmp/.npm-cache（改用 $MAIN_ROOT/.npm-cache）
# A3: promote-dashboard.sh 含 HK rsync 步骤
# A4: frontend-proxy.js STATIC_DIR 默认 /app（非主仓库绝对路径）
# A5: check-deploy-fingerprint.sh 存在且可执行
# A7: promote 后强制重新绑定 frontend，且 --no-deps 不重启 Brain

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
PASS=0; FAIL=0

ok()   { echo "  ✅ $*"; PASS=$((PASS+1)); }
fail() { echo "  ❌ $*"; FAIL=$((FAIL+1)); }

echo "=== deploy-chain-wounds-smoke ==="

# ── A1: deploy-local.sh npm install 失败时中止（不含 || true）────────────────
echo ""
echo "A1: npm install loud-fail"
DEPLOY_LOCAL="$REPO_ROOT/scripts/deploy-local.sh"
if grep -q '|| true' "$DEPLOY_LOCAL"; then
    # 检查是否是 npm install 那行有 || true
    if grep -A2 'npm install' "$DEPLOY_LOCAL" | grep -q '|| true'; then
        fail "deploy-local.sh: npm install 后仍有 '|| true'（伤口1未修）"
    else
        ok "deploy-local.sh: '|| true' 在其他上下文，npm install 处已修复"
    fi
else
    ok "deploy-local.sh: 无 '|| true'（npm install loud-fail 已生效）"
fi

# ── A2: npm cache 不写 /tmp/.npm-cache ──────────────────────────────────────
echo ""
echo "A2: npm cache 不用 /tmp"
if grep -q '/tmp/.npm-cache\|/tmp/\.npm-cache' "$DEPLOY_LOCAL"; then
    fail "deploy-local.sh: npm cache 仍写 /tmp（伤口2未修）"
else
    ok "deploy-local.sh: npm cache 已移出 /tmp"
fi

# A2 补：确认使用 MAIN_ROOT 下的 cache
if grep -q 'MAIN_ROOT.*npm-cache\|npm-cache.*MAIN_ROOT\|NPM_CACHE_DIR' "$DEPLOY_LOCAL"; then
    ok "deploy-local.sh: npm cache 指向 MAIN_ROOT（bind-mounted volume）"
else
    fail "deploy-local.sh: 未找到 MAIN_ROOT npm cache 路径"
fi

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

# ── A7: 原子替换 dist 后重新绑定 frontend，不连带重启 Brain ─────────────────
echo ""
echo "A7: promote 后 frontend bind mount 重绑"
if grep -Eq 'up -d --force-recreate --no-deps frontend' "$PROMOTE"; then
    ok "promote-dashboard.sh: 只重建 frontend 并重新绑定 live dist"
else
    fail "promote-dashboard.sh: 缺少 --force-recreate --no-deps frontend（5211 会继续读旧 inode）"
fi

echo ""
echo "A8: Dashboard promote 不部署 Brain"
if grep -Eq 'brain-deploy\.sh|BRAIN_DEPLOY' "$PROMOTE"; then
    fail "promote-dashboard.sh: 仍调用 Brain 部署（Dashboard 发布会中断任务调度）"
else
    ok "promote-dashboard.sh: 只负责 Dashboard，不调用 Brain 部署"
fi

echo ""
echo "=== 结果：PASS=$PASS  FAIL=$FAIL ==="
[[ $FAIL -eq 0 ]]
