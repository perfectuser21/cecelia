#!/usr/bin/env bash
# ============================================================================
# Stop Hook 路由器 v13.1.0
# ============================================================================
# 检查不同的 mode 文件，调用对应的检查脚本
#
# 支持的模式：
# - .dev-mode     → stop-dev.sh    (/dev 工作流)
# - .okr-mode     → stop-okr.sh    (/okr 拆解流程)
# - .quality-mode → stop-quality.sh (/quality 质检流程) [将来]
#
# 已移除：
# - .exploratory-mode (exploratory skill 已废弃，2026-02-25)
# - CECELIA_HEADLESS 绕过（v13.1.0，Bug 修复）
#   无头模式与有头模式走同一套状态机，stop-dev.sh 已处理无头兼容性
#
# 没有任何 mode 文件 → exit 0（普通对话，允许结束）
# ============================================================================

set -euo pipefail

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

# ===== 检查 .quality-mode → 调用 stop-quality.sh =====
# 将来添加
# if [[ -f "$PROJECT_ROOT/.quality-mode" ]]; then
#     bash "$SCRIPT_DIR/stop-quality.sh"
#     exit $?
# fi

# ===== 没有任何 mode 文件 → 普通对话，允许结束 =====
exit 0
