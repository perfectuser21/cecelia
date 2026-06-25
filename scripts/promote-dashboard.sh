#!/usr/bin/env bash
# promote-dashboard.sh — Cecelia dashboard「人工放行」步骤
#
# deploy-local.sh 把新版本停在 staging（perfect21:52xx 私密预览）+ 写 .staging-pending 标记后，
# 主理人开 staging 看一眼满意 → 手动跑本脚本，才把新版本 promote 到两个生产实例：
#   1) 原子换入本机 live dist/（OrbStack 容器挂载 → perfect21:5211 立即生效）
#   2) tar+ssh 同步到 HK VPS（autopilot 公网生产实例）+ reload nginx
# 然后停掉常驻 staging 服务、清掉放行标记（防重复 promote）。
#
# 没有 .staging-pending（没东西待放行）→ 拒绝运行，避免误把陈旧/不存在的产物推上生产。
#
# 用法：
#   bash scripts/promote-dashboard.sh
#   CECELIA_SKIP_HK=1 bash scripts/promote-dashboard.sh   # 只换本机、跳过 HK（测试/离线用）
#
# 退出码： 0=promote 成功  1=无待放行 / promote 失败

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

# 部署根：测试钩子 CECELIA_DEPLOY_ROOT 优先，否则按 worktree/主仓库解析（与 deploy-local.sh 一致）
if [[ -n "${CECELIA_DEPLOY_ROOT:-}" ]]; then
    MAIN_ROOT="$(cd "$CECELIA_DEPLOY_ROOT" && pwd)"
else
    GIT_COMMON=$(git rev-parse --git-common-dir 2>/dev/null || echo ".git")
    if [[ "$GIT_COMMON" == ".git" ]]; then
        MAIN_ROOT="$(cd "$(dirname "$SCRIPT_DIR")" && pwd)"
    else
        MAIN_ROOT="$(cd "$(dirname "$GIT_COMMON")" && pwd)"
    fi
fi

DASH_DIR="$MAIN_ROOT/apps/dashboard"
DIST_DIR="$DASH_DIR/dist"
STAGING_DIST="$DASH_DIR/.dist-staging"
PENDING_FILE="$DASH_DIR/.staging-pending"
SLOT_PID_FILE="$DASH_DIR/.staging-slot.pid"
SLOT_LOG_FILE="$DASH_DIR/.staging-slot.log"

echo "=== Cecelia Dashboard 人工放行 promote ==="
echo "  部署根: $MAIN_ROOT"
echo ""

# ── 前置：必须有待放行的 staging ──────────────────────────────────────────────
if [[ ! -f "$PENDING_FILE" ]]; then
    echo "❌ 无 .staging-pending —— 没有待放行的 staging。"
    echo "   先跑一次 dashboard 部署（deploy-local.sh）把新版本停到 staging，再回来放行。"
    exit 1
fi

# 读放行标记（staging_dist / staging_port / slot_pid）
STAGED_DIST=""; STAGED_PORT=""; STAGED_PID=""
while IFS='=' read -r k v; do
    case "$k" in
        staging_dist) STAGED_DIST="$v" ;;
        staging_port) STAGED_PORT="$v" ;;
        slot_pid)     STAGED_PID="$v" ;;
    esac
done < "$PENDING_FILE"
[[ -z "$STAGED_DIST" ]] && STAGED_DIST="$STAGING_DIST"

echo "📋 待放行：$STAGED_DIST"
sed 's/^/   /' "$PENDING_FILE"
echo ""

if [[ ! -d "$STAGED_DIST" || ! -f "$STAGED_DIST/index.html" ]]; then
    echo "❌ 待放行的 staging 产物不存在或残缺：$STAGED_DIST"
    echo "   放行标记已失效，重新跑一次 dashboard 部署。"
    exit 1
fi

# ── 1) 原子换入本机 live dist/（perfect21:5211 立即生效）──────────────────────
# 先 dist.old 备份，rename staging→dist，成功删 old；失败回滚。
echo "🟢 Promote → 原子换入本机 live dist/（5211）"
if [[ -d "$DIST_DIR" ]]; then
    rm -rf "${DIST_DIR}.old" 2>/dev/null || true
    mv "$DIST_DIR" "${DIST_DIR}.old"
fi
if mv "$STAGED_DIST" "$DIST_DIR"; then
    rm -rf "${DIST_DIR}.old" 2>/dev/null || true
    echo "✅ 本机 5211 已指向新版本"
else
    echo "❌ Promote 换入失败，回滚 live dist/"
    [[ -d "${DIST_DIR}.old" ]] && mv "${DIST_DIR}.old" "$DIST_DIR"
    exit 1
fi
echo ""

# ── 2) 同步到 HK VPS（autopilot 公网生产实例）────────────────────────────────
# 用 Tailscale IP 而非主机名别名——Brain 跑在 Docker 容器里，容器的 ~ 是 /root，
# SSH config 里的 hk-vps 别名找不到。
if [[ -n "${CECELIA_SKIP_HK:-}" ]]; then
    echo "⏭️  CECELIA_SKIP_HK 已设置，跳过 HK 同步（仅本机 promote）"
else
    HK_IP="${CECELIA_HK_IP:-100.86.118.99}"
    HK_USER="${CECELIA_HK_USER:-root}"
    HK_SSH_KEY="${CECELIA_HK_SSH_KEY:-/Users/administrator/.ssh/id_rsa}"
    HK_SSH_OPTS="-i $HK_SSH_KEY -o StrictHostKeyChecking=no -o ConnectTimeout=15"
    HK_REMOTE_DIR="/opt/cecelia/frontend"
    echo "🚀 同步 Dashboard 到 HK VPS ($HK_USER@$HK_IP:$HK_REMOTE_DIR)..."
    ssh $HK_SSH_OPTS "$HK_USER@$HK_IP" "mkdir -p $HK_REMOTE_DIR/dist" 2>/dev/null || true
    if tar -czf - -C "$DIST_DIR" . \
        | ssh $HK_SSH_OPTS "$HK_USER@$HK_IP" "tar -xzf - -C $HK_REMOTE_DIR/dist/"; then
        ssh $HK_SSH_OPTS "$HK_USER@$HK_IP" "docker exec cecelia-core-hk nginx -s reload 2>/dev/null" || true
        echo "✅ HK VPS 同步完成"
    else
        echo "⚠️  tar+ssh 同步到 HK 失败，Dashboard 仅本机 promote 成功（HK 保持旧版）"
    fi
fi
echo ""

# ── 3) 停常驻 staging 服务 + 清放行标记（防重复 promote）──────────────────────
if [[ -n "$STAGED_PID" ]]; then
    kill "$STAGED_PID" 2>/dev/null || true
fi
if [[ -f "$SLOT_PID_FILE" ]]; then
    kill "$(cat "$SLOT_PID_FILE" 2>/dev/null)" 2>/dev/null || true
    rm -f "$SLOT_PID_FILE"
fi
rm -f "$PENDING_FILE" "$SLOT_LOG_FILE" 2>/dev/null || true

echo "🎉 放行完成：5211 + HK 已上线新版本，staging 已停、标记已清。"
exit 0
