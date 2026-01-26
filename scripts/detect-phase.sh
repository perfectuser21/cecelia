#!/usr/bin/env bash
# ============================================================================
# detect-phase.sh - 阶段检测脚本
# ============================================================================
# 检测当前开发阶段，用于 Stop Hook 和 /dev 流程判断
#
# 阶段定义:
#   p0:      无 PR（Published 阶段 - 发 PR 前）
#   p1:      PR + CI fail（修复阶段 - 轮询修复）
#   p2:      PR + CI pass（已完成 - GitHub 自动合并）
#   pending: PR + CI pending（等待中 - 不介入）
#   unknown: gh API 错误或无法检测（安全退出 - 不误判）
#
# 输出格式:
#   PHASE: <p0|p1|p2|pending|unknown>
#   DESCRIPTION: <阶段描述>
#   ACTION: <下一步动作>
# ============================================================================

set -euo pipefail

# ===== 获取当前分支 =====
CURRENT_BRANCH=$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo "")

if [[ -z "$CURRENT_BRANCH" ]]; then
    echo "PHASE: unknown"
    echo "DESCRIPTION: 无法获取当前分支"
    echo "ACTION: 确保在 git 仓库中运行"
    exit 0
fi

# ===== 检查 gh 命令 =====
if ! command -v gh &>/dev/null; then
    echo "PHASE: unknown"
    echo "DESCRIPTION: gh 命令不可用"
    echo "ACTION: 安装 GitHub CLI: https://cli.github.com"
    exit 0
fi

# ===== 检查是否有 PR =====
PR_NUMBER=$(gh pr list --head "$CURRENT_BRANCH" --state open --json number -q '.[0].number' 2>/dev/null || echo "")

if [[ -z "$PR_NUMBER" ]]; then
    # 无 PR -> p0 阶段
    echo "PHASE: p0"
    echo "DESCRIPTION: Published 阶段（无 PR）"
    echo "ACTION: 质检通过后创建 PR，创建后立即结束（不等 CI）"
    exit 0
fi

# ===== 有 PR，检查 CI 状态 =====
# 使用 gh pr checks 获取 CI 状态
# 可能的状态: SUCCESS, FAILURE, PENDING, QUEUED, IN_PROGRESS, ERROR 等
CI_STATUS=$(gh pr checks "$PR_NUMBER" --json state -q '.[].state' 2>/dev/null | head -1 || echo "")

if [[ -z "$CI_STATUS" ]]; then
    # gh API 错误或无法获取状态 -> unknown
    echo "PHASE: unknown"
    echo "DESCRIPTION: 无法获取 CI 状态（gh API 错误）"
    echo "ACTION: 稍后重试或检查 gh 认证状态"
    exit 0
fi

# ===== 判断阶段 =====
case "$CI_STATUS" in
    SUCCESS|PASS)
        # CI 通过 -> p2 阶段
        echo "PHASE: p2"
        echo "DESCRIPTION: CI pass（已完成）"
        echo "ACTION: GitHub 自动合并，直接退出"
        ;;

    FAILURE|ERROR)
        # CI 失败 -> p1 阶段
        echo "PHASE: p1"
        echo "DESCRIPTION: CI fail（修复阶段）"
        echo "ACTION: 轮询循环 - 检查 CI → 失败则修复并继续 → 成功则合并"
        ;;

    PENDING|QUEUED|IN_PROGRESS|WAITING)
        # CI 运行中 -> pending 阶段
        echo "PHASE: pending"
        echo "DESCRIPTION: CI pending（等待中）"
        echo "ACTION: 等待 CI 结果，不介入"
        ;;

    *)
        # 未知状态 -> unknown
        echo "PHASE: unknown"
        echo "DESCRIPTION: CI 状态未知: $CI_STATUS"
        echo "ACTION: 手动检查 PR #$PR_NUMBER 的 CI 状态"
        ;;
esac

exit 0
