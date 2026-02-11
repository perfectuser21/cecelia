#!/usr/bin/env bash
# ============================================================================
# Stop Hook 路由器 v13.0.0
# ============================================================================
# 检查不同的 mode 文件，调用对应的检查脚本
#
# 支持的模式：
# - .dev-mode     → stop-dev.sh    (/dev 工作流)
# - .okr-mode     → stop-okr.sh    (/okr 拆解流程)
# - .quality-mode → stop-quality.sh (/quality 质检流程) [将来]
#
# 没有任何 mode 文件 → exit 0（普通对话，允许结束）
# ============================================================================

set -euo pipefail

# ===== 无头模式：直接退出，让外部循环控制 =====
if [[ "${CECELIA_HEADLESS:-false}" == "true" ]]; then
    exit 0
fi

# ===== 获取项目根目录 =====
PROJECT_ROOT="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# ===== 检查 .dev-mode → 调用 stop-dev.sh =====
if [[ -f "$PROJECT_ROOT/.dev-mode" ]]; then
    bash "$SCRIPT_DIR/stop-dev.sh"
    exit $?
fi

# ===== 检查 .okr-mode → 调用 stop-okr.sh =====
if [[ -f "$PROJECT_ROOT/.okr-mode" ]]; then
    bash "$SCRIPT_DIR/stop-okr.sh"
    exit $?
fi

# ===== 检查 .exploratory-mode → 调用 stop-exploratory.sh =====
if [[ -f "$PROJECT_ROOT/.exploratory-mode" ]]; then
    bash "$SCRIPT_DIR/stop-exploratory.sh"
    exit $?
fi

# ===== 检查 .quality-mode → 调用 stop-quality.sh =====
# 将来添加
# if [[ -f "$PROJECT_ROOT/.quality-mode" ]]; then
#     bash "$SCRIPT_DIR/stop-quality.sh"
#     exit $?
# fi

# ===== 没有任何 mode 文件 → 普通对话，允许结束 =====
exit 0
