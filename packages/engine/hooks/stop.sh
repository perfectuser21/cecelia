#!/usr/bin/env bash
# ============================================================================
# Stop Hook 路由器 v14.0.0
# ============================================================================
# 检查不同的 mode 文件，调用对应的检查脚本
#
# 支持的模式：
# - .dev-lock.<branch>  → stop-dev.sh    (/dev 工作流，per-branch 格式)
# - .architect-lock.*   → stop-architect.sh (/architect 架构设计)
# - .decomp-mode        → stop-decomp.sh (/decomp 拆解流程)
# - .quality-mode       → stop-quality.sh (/quality 质检流程) [将来]
#
# v14.0.0 清理：
#   删除所有旧格式兼容代码（.dev-lock/.dev-mode 无后缀）。
#   只保留 per-branch 格式（.dev-lock.<branch> + .dev-mode.<branch> + .dev-sentinel.<branch>）。
#   旧格式不支持并行多 /dev 会话，且导致 ~200 行冗余兼容代码。
#
# 没有任何 mode/lock 文件 → exit 0（普通对话，允许结束）
# ============================================================================

set -euo pipefail

# ===== 获取项目根目录 =====
PROJECT_ROOT="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# ===== 检查 .dev-lock.<branch>（per-branch 硬钥匙）→ 调用 stop-dev.sh =====
_DEV_LOCK_FOUND=false
for _f in "$PROJECT_ROOT"/.dev-lock.*; do
    [[ -f "$_f" ]] && _DEV_LOCK_FOUND=true && break
done

if [[ "$_DEV_LOCK_FOUND" == "true" ]]; then
    bash "$SCRIPT_DIR/stop-dev.sh"
    exit $?
fi

# ===== 检查 .architect-lock.* → 调用 stop-architect.sh =====
_ARCHITECT_LOCK_FOUND=false
for _f in "$PROJECT_ROOT"/.architect-lock.*; do
    [[ -f "$_f" ]] && _ARCHITECT_LOCK_FOUND=true && break
done

if [[ "$_ARCHITECT_LOCK_FOUND" == "true" ]]; then
    bash "$SCRIPT_DIR/stop-architect.sh"
    exit $?
fi

# ===== 检查 .decomp-mode → 调用 stop-decomp.sh =====
if [[ -f "$PROJECT_ROOT/.decomp-mode" ]]; then
    bash "$SCRIPT_DIR/stop-decomp.sh"
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
