#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

# ── 参数解析 ─────────────────────────────────────────────────────────────────
BRAIN_ONLY=false
DASHBOARD_ONLY=false
SKIP_SMOKE=false

for arg in "$@"; do
    case $arg in
        --brain-only)     BRAIN_ONLY=true ;;
        --dashboard-only) DASHBOARD_ONLY=true ;;
        --skip-smoke)     SKIP_SMOKE=true ;;
        *)
            echo "Usage: $0 [--brain-only | --dashboard-only] [--skip-smoke]"
            exit 1
            ;;
    esac
done

if [[ "$BRAIN_ONLY" == true && "$DASHBOARD_ONLY" == true ]]; then
    echo "Error: --brain-only and --dashboard-only are mutually exclusive"
    exit 1
fi

# ── 改动检测 ─────────────────────────────────────────────────────────────────
detect_changes() {
    local path="$1"
    local changed=""
    if git rev-parse "origin/main" >/dev/null 2>&1; then
        changed=$(git diff --name-only "origin/main~1..origin/main" -- "$path" 2>/dev/null || true)
    fi
    if [[ -z "$changed" ]]; then
        changed=$(git diff --name-only "HEAD~1..HEAD" -- "$path" 2>/dev/null || true)
    fi
    [[ -n "$changed" ]]
}

BRAIN_CHANGED=false
DASHBOARD_CHANGED=false

if [[ "$DASHBOARD_ONLY" == false ]]; then
    detect_changes "packages/brain/" && BRAIN_CHANGED=true || true
fi
if [[ "$BRAIN_ONLY" == false ]]; then
    detect_changes "apps/dashboard/" && DASHBOARD_CHANGED=true || true
fi

[[ "$BRAIN_ONLY"     == true ]] && BRAIN_CHANGED=true
[[ "$DASHBOARD_ONLY" == true ]] && DASHBOARD_CHANGED=true

echo "=== Cecelia deploy ==="
echo "  brain changed:     $BRAIN_CHANGED"
echo "  dashboard changed: $DASHBOARD_CHANGED"
echo ""

if [[ "$BRAIN_CHANGED" == false && "$DASHBOARD_CHANGED" == false ]]; then
    echo "[skip] 无改动，跳过 rebuild，只跑 smoke 验活"
    echo ""
fi

# ── Brain 部署 ───────────────────────────────────────────────────────────────
if [[ "$BRAIN_CHANGED" == true ]]; then
    echo "--- Deploying Brain ---"
    bash "$SCRIPT_DIR/brain-deploy.sh" || {
        echo ""
        echo "[FAIL] brain-deploy.sh 失败，中止部署"
        exit 1
    }
    echo ""
fi

# ── Dashboard 构建 ──────────────────────────────────────────────────────────
if [[ "$DASHBOARD_CHANGED" == true ]]; then
    echo "--- Building Dashboard ---"
    bash "$SCRIPT_DIR/rebuild-dashboard.sh" || {
        echo ""
        echo "[FAIL] rebuild-dashboard.sh 失败"
        exit 1
    }
    echo ""

    if [[ "$DASHBOARD_ONLY" == true ]]; then
        echo "--- Promoting Dashboard to US/HK ---"
        bash "$SCRIPT_DIR/promote-dashboard.sh" || {
            echo ""
            echo "[FAIL] promote-dashboard.sh 失败，中止部署"
            exit 1
        }
        echo ""
    fi
fi

# ── Smoke ────────────────────────────────────────────────────────────────────
if [[ "$SKIP_SMOKE" == true ]]; then
    echo "[skip-smoke] 跳过 smoke 检查"
    echo ""
    echo "=== Cecelia deployed ==="
    exit 0
fi

echo "--- Smoke ---"
BRAIN_VERSION=""
SMOKE_FAIL=false

if curl -sf --max-time 10 "http://localhost:5221/api/brain/version" >/tmp/cecelia-smoke-brain.json 2>/dev/null; then
    BRAIN_VERSION=$(node -e "try{console.log(require('/tmp/cecelia-smoke-brain.json').version||'ok')}catch(e){console.log('ok')}" 2>/dev/null || echo "ok")
    echo "  ✅ Brain: v${BRAIN_VERSION}"
else
    echo "  ❌ Brain smoke 失败 (localhost:5221/api/brain/version)"
    SMOKE_FAIL=true
fi

if curl -sf --max-time 10 "http://localhost:5211" >/dev/null 2>&1; then
    echo "  ✅ Dashboard: ok"
else
    echo "  ❌ Dashboard smoke 失败 (localhost:5211)"
    SMOKE_FAIL=true
fi

echo ""

if [[ "$SMOKE_FAIL" == true ]]; then
    echo "[FAIL] smoke 未全通过"
    exit 1
fi

echo "=== ✅ Cecelia deployed: brain=${BRAIN_VERSION} dashboard=ok ==="
