#!/usr/bin/env bash
# dev-preview.sh — 固定的 dev 即时预览：把"当前手头的草稿"build 起来，跑在 perfect21:5225，
# 右上角一面【蓝色 DEV 斜角旗】（区别于 staging 的橙旗、生产的无旗）。
#
# 用途：开发中（Claude Code 改代码）想立刻看效果时跑一下——不走 PR、不等 CI、不碰 staging/生产。
# 看的是"未必提交、未必过 CI 的草稿"，合适了再走 PR → CI → staging → 放行 → 生产。
#
# 与 deploy-local.sh(staging) / promote-dashboard.sh(生产) 完全独立：
#   - 独立端口 5225、独立产物目录 .dist-dev，绝不碰 live dist/(5211) 和 .dist-staging(5251)。
#
# 用法：
#   bash scripts/dev-preview.sh              # build 当前 dashboard → 起 5225 蓝 DEV 旗
#   DEV_PREVIEW_PORT=5226 bash scripts/dev-preview.sh
#   DEV_FIXTURE_DIST=<dir> bash scripts/dev-preview.sh   # 测试钩子：跳过 vite build

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
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
DEV_DIST="$DASH_DIR/.dist-dev"
SLOT_SERVER="$MAIN_ROOT/scripts/dashboard-slot-server.cjs"
PID_FILE="$DASH_DIR/.dev-preview.pid"
LOG_FILE="$DASH_DIR/.dev-preview.log"
PORT="${DEV_PREVIEW_PORT:-5225}"

echo "=== Cecelia dev 即时预览（perfect21:${PORT} · 蓝 DEV 旗）==="

# ── build 当前草稿到 .dist-dev（不碰 dist/ 和 .dist-staging）──────────────────
rm -rf "$DEV_DIST"
if [[ -n "${DEV_FIXTURE_DIST:-}" ]]; then
    echo "  [test] DEV_FIXTURE_DIST → 复制 fixture（跳过 vite build）"
    cp -R "$DEV_FIXTURE_DIST" "$DEV_DIST"
else
    echo "  🔨 build 当前 dashboard 草稿 → .dist-dev"
    cd "$MAIN_ROOT"
    npm install --prefer-offline --cache /tmp/.npm-cache --silent 2>/dev/null || true
    cd "$DASH_DIR"
    NODE_OPTIONS="--max-old-space-size=3072" npm run build -- --outDir "$DEV_DIST"
    cd "$MAIN_ROOT"
fi
if [[ ! -f "$DEV_DIST/index.html" ]]; then
    echo "❌ build 未产出 .dist-dev/index.html"; exit 1
fi

# ── 起常驻预览服务（杀旧起新）──────────────────────────────────────────────────
if [[ -f "$PID_FILE" ]]; then
    kill "$(cat "$PID_FILE" 2>/dev/null)" 2>/dev/null || true
    rm -f "$PID_FILE"
fi
DEV_COMMIT=$(git -C "$MAIN_ROOT" rev-parse --short HEAD 2>/dev/null || echo draft)
DIST_DIR="$DEV_DIST" SLOT_PORT="$PORT" STAGING_BANNER=1 \
    STAGING_FLAG_TEXT=DEV STAGING_FLAG_COLOR='#3b82f6' STAGING_COMMIT="$DEV_COMMIT" \
    nohup node "$SLOT_SERVER" > "$LOG_FILE" 2>&1 &
DEV_PID=$!
echo "$DEV_PID" > "$PID_FILE"

UP=0
for _ in $(seq 1 15); do
    curl -sf "http://localhost:${PORT}/" -o /dev/null 2>/dev/null && { UP=1; break; }
    kill -0 "$DEV_PID" 2>/dev/null || break
    sleep 1
done
if [[ "$UP" -ne 1 ]]; then
    echo "❌ dev 预览起不来"; sed 's/^/  /' "$LOG_FILE" 2>/dev/null | tail -10; exit 1
fi

echo "✅ dev 预览已起 → 打开 http://perfect21:${PORT}/ （蓝 DEV 旗 · 当前草稿 commit ${DEV_COMMIT}）"
echo "   这是开发草稿（未必提交/未过 CI）。定稿后走 PR → CI → staging(橙旗) → 放行 → 生产 5211。"
exit 0
