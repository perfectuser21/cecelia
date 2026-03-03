#!/usr/bin/env bash
# ============================================================================
# Stop Hook 路由器 v13.2.0
# ============================================================================
# 检查不同的 mode 文件，调用对应的检查脚本
#
# 支持的模式：
# - .dev-lock.<branch> 或 .dev-lock → stop-dev.sh    (/dev 工作流，per-branch 格式优先)
# - .dev-mode          → stop-dev.sh    (/dev 工作流，旧格式兜底)
# - .decomp-mode       → stop-decomp.sh (/decomp 拆解流程)
# - .quality-mode      → stop-quality.sh (/quality 质检流程) [将来]
#
# 已移除：
# - .exploratory-mode (exploratory skill 已废弃，2026-02-25)
# - CECELIA_HEADLESS 绕过（v13.1.0，Bug 修复）
#   无头模式与有头模式走同一套状态机，stop-dev.sh 已处理无头兼容性
#
# v13.2.0 修复（Bug）：
#   PR #418 (Engine v12.36.0) 将状态文件改为 per-branch 格式（.dev-lock.<branch>），
#   但路由器仍只检查旧格式 .dev-mode，导致 .dev-mode 被 cleanup 删除后
#   stop-dev.sh 完全不被调用，Step 10 LEARNINGS 检查被绕过，LEARNINGS 落入单独 PR。
#   修复：以 .dev-lock（硬钥匙，per-branch 或旧格式）为路由触发条件，.dev-mode 为兜底。
#
# 没有任何 mode/lock 文件 → exit 0（普通对话，允许结束）
# ============================================================================

set -euo pipefail

# ===== 获取项目根目录 =====
PROJECT_ROOT="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# ===== 检查 .dev-lock（硬钥匙）→ 调用 stop-dev.sh =====
# per-branch 格式（.dev-lock.<branch>）优先，旧格式（.dev-lock）次之
# stop-dev.sh 内部自己根据 TTY/session_id 匹配具体的 lock 文件
_DEV_LOCK_FOUND=false
for _f in "$PROJECT_ROOT"/.dev-lock.*; do
    [[ -f "$_f" ]] && _DEV_LOCK_FOUND=true && break
done
[[ -f "$PROJECT_ROOT/.dev-lock" ]] && _DEV_LOCK_FOUND=true

if [[ "$_DEV_LOCK_FOUND" == "true" ]]; then
    bash "$SCRIPT_DIR/stop-dev.sh"
    exit $?
fi

# ===== 旧格式兜底：.dev-mode（无 .dev-lock 时）→ 调用 stop-dev.sh =====
if [[ -f "$PROJECT_ROOT/.dev-mode" ]]; then
    bash "$SCRIPT_DIR/stop-dev.sh"
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
