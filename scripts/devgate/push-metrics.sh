#!/usr/bin/env bash
# ============================================================================
# push-metrics.sh - 推送 DevGate Metrics 到 Core
# ============================================================================
#
# 收集 metrics 并推送到 Core API
#
# 用法:
#   bash scripts/devgate/push-metrics.sh [OPTIONS]
#
# 选项:
#   --month YYYY-MM       指定月份（默认当前月）
#   --dry-run             只生成数据，不推送
#   --verbose             详细输出
#   --help                显示帮助
#
# 环境变量:
#   DEVGATE_API_TOKEN     API 认证 token（必需）
#   CORE_API_URL          Core API 地址（默认 http://localhost:5212）
#
# 示例:
#   DEVGATE_API_TOKEN=xxx bash scripts/devgate/push-metrics.sh
#   bash scripts/devgate/push-metrics.sh --dry-run
#   bash scripts/devgate/push-metrics.sh --month 2026-01
#
# ============================================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ENGINE_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

# 默认值
MONTH=""
DRY_RUN=false
VERBOSE=false
CORE_API_URL="${CORE_API_URL:-http://localhost:5212}"

# 参数解析
while [[ $# -gt 0 ]]; do
    case $1 in
        --month)
            MONTH="$2"
            shift 2
            ;;
        --dry-run)
            DRY_RUN=true
            shift
            ;;
        --verbose)
            VERBOSE=true
            shift
            ;;
        --help)
            head -30 "$0" | grep "^#" | sed 's/^# //' | sed 's/^#//'
            exit 0
            ;;
        *)
            echo "未知参数: $1" >&2
            exit 1
            ;;
    esac
done

# 检查 token
if [[ -z "${DEVGATE_API_TOKEN:-}" ]]; then
    # 尝试从 credentials 文件读取
    if [[ -f "$HOME/.credentials/devgate.env" ]]; then
        source "$HOME/.credentials/devgate.env"
    fi
fi

if [[ -z "${DEVGATE_API_TOKEN:-}" && "$DRY_RUN" == "false" ]]; then
    echo "错误: DEVGATE_API_TOKEN 未设置" >&2
    echo "请设置环境变量或创建 ~/.credentials/devgate.env" >&2
    exit 1
fi

# L1 fix: 使用数组避免空格拆分问题
METRICS_ARGS=("--format" "json")
if [[ -n "$MONTH" ]]; then
    METRICS_ARGS+=("--month" "$MONTH")
fi

# 收集 metrics
cd "$ENGINE_ROOT"
echo "[INFO] 收集 DevGate metrics..."
RAW_METRICS=$(node scripts/devgate/metrics.cjs "${METRICS_ARGS[@]}" 2>/dev/null)

if [[ -z "$RAW_METRICS" ]]; then
    echo "错误: metrics 收集失败" >&2
    exit 1
fi

# 转换为 Core API 格式
# Core API 期望的格式:
# {
#   "window": { "since": "ISO", "until": "ISO" },
#   "summary": { "total_tests": N, "p0_count": N, "p1_count": N, "rci_coverage": {...}, "manual_tests": N },
#   "new_rci": [...]
# }

PAYLOAD=$(echo "$RAW_METRICS" | node -e '
const data = JSON.parse(require("fs").readFileSync(0, "utf-8"));
const payload = {
    window: {
        since: data.window.since + "T00:00:00Z",
        until: data.window.until + "T00:00:00Z"
    },
    summary: {
        total_tests: data.prs.total,
        p0_count: data.prs.p0,
        p1_count: data.prs.p1,
        rci_coverage: {
            total: data.rci_coverage.total,
            covered: data.rci_coverage.updated,
            pct: data.rci_coverage.pct
        },
        manual_tests: data.dod.manual_tests
    },
    new_rci: data.rci_growth.new_ids.map(id => ({
        file: "regression-contract.yaml",
        function: id,
        reason: "New RCI entry added in " + data.window.since.substring(0,7)
    }))
};
console.log(JSON.stringify(payload, null, 2));
')

if [[ "$VERBOSE" == "true" ]]; then
    echo "📦 Payload:"
    echo "$PAYLOAD"
    echo ""
fi

# L2 fix: 检查 jq 是否安装
check_jq() {
    if ! command -v jq &>/dev/null; then
        echo "[WARN] jq not installed, showing raw JSON" >&2
        cat
    else
        jq .
    fi
}

# Dry run 模式
if [[ "$DRY_RUN" == "true" ]]; then
    echo "[INFO] Dry run mode, data will not be pushed"
    echo "$PAYLOAD" | check_jq
    exit 0
fi

# 推送到 Core
echo "[INFO] Pushing to $CORE_API_URL/api/devgate/metrics..."
RESPONSE=$(curl -s -w "\n%{http_code}" -X POST "$CORE_API_URL/api/devgate/metrics" \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer $DEVGATE_API_TOKEN" \
    -d "$PAYLOAD")

HTTP_CODE=$(echo "$RESPONSE" | tail -n1)
BODY=$(echo "$RESPONSE" | sed '$d')

if [[ "$HTTP_CODE" == "200" ]]; then
    echo "[OK] Push successful!"
    echo "$BODY" | check_jq
else
    echo "[ERROR] Push failed (HTTP $HTTP_CODE)" >&2
    echo "$BODY" >&2
    exit 1
fi
