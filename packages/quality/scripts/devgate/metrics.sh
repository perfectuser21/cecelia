#!/usr/bin/env bash
# ============================================================================
# metrics.sh - DevGate Metrics 入口脚本
# ============================================================================
#
# DevGate 闭环指标面板。
#
# 用法:
#   bash scripts/devgate/metrics.sh [OPTIONS]
#
# 选项:
#   --since YYYY-MM-DD    开始日期
#   --until YYYY-MM-DD    结束日期
#   --month YYYY-MM       指定月份（默认当前月）
#   --format human|json   输出格式（默认 human）
#   --verbose             详细输出
#   --help                显示帮助
#
# 示例:
#   bash scripts/devgate/metrics.sh
#   bash scripts/devgate/metrics.sh --month 2026-01
#   bash scripts/devgate/metrics.sh --format json
#   bash scripts/devgate/metrics.sh --since 2026-01-01 --until 2026-01-31
#
# 指标说明:
#   - P0/P1 PR 数：本月高优先级 PR 数量
#   - RCI 覆盖率：P0/P1 PR 中更新了 regression-contract.yaml 的比例（目标 100%）
#   - 新增 RCI：本月新增的回归契约条目
#   - DoD 条目：归档的 DoD 验收条目总数
#
# 返回码:
#   0 - 成功（P0/P1 覆盖率 >= 100% 或无 P0/P1）
#   1 - P0/P1 覆盖率 < 100%（需要关注）
#
# ============================================================================

set -euo pipefail

# 找脚本所在目录
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
METRICS_CJS="$SCRIPT_DIR/metrics.cjs"

# 检查 Node.js
if ! command -v node &>/dev/null; then
    echo "错误: 需要 Node.js 来运行 metrics" >&2
    echo "请安装 Node.js: https://nodejs.org/" >&2
    exit 2
fi

# 检查核心脚本存在
if [[ ! -f "$METRICS_CJS" ]]; then
    echo "错误: 找不到 metrics.cjs: $METRICS_CJS" >&2
    exit 2
fi

# L3 fix: 不使用 exec，以便可以捕获退出码（如需要）
node "$METRICS_CJS" "$@"
exit $?
