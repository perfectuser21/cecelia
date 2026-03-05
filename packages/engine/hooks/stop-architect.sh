#!/usr/bin/env bash
# ============================================================================
# Stop Hook for /architect (v1.0.0)
# ============================================================================
# 检查 .architect-lock.* 文件，验证架构设计完成条件：
#
# Mode 1 (scan):
#   - .architect-scan-done 存在（系统说明书已生成）
#
# Mode 2 (design):
#   - .architect-design-done 存在（技术设计 + Tasks 注册完成）
#
# 完成 -> exit 0（允许会话结束）
# 未完成 -> exit 2（阻止会话结束，继续执行）
# ============================================================================

set -euo pipefail

PROJECT_ROOT="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"

# ===== 检测 Mode =====
SCAN_LOCK="$PROJECT_ROOT/.architect-lock.scan"
DESIGN_LOCK="$PROJECT_ROOT/.architect-lock.design"

# 如果没有任何 architect lock 文件，不是 architect 模式
if [[ ! -f "$SCAN_LOCK" ]] && [[ ! -f "$DESIGN_LOCK" ]]; then
    exit 0
fi

echo "=== /architect Stop Hook: 检查完成条件 ==="

# ===== Mode 1: Scan =====
if [[ -f "$SCAN_LOCK" ]]; then
    echo "Mode: scan"

    SCAN_DONE="$PROJECT_ROOT/.architect-scan-done"
    if [[ ! -f "$SCAN_DONE" ]]; then
        echo "  system_modules 未完成（.architect-scan-done 不存在）"
        echo "  继续执行 /architect scan"
        exit 2
    fi

    echo "  .architect-scan-done 存在"
    echo "  /architect scan 完成"
    rm -f "$SCAN_LOCK"
    exit 0
fi

# ===== Mode 2: Design =====
if [[ -f "$DESIGN_LOCK" ]]; then
    echo "Mode: design"

    DESIGN_DONE="$PROJECT_ROOT/.architect-design-done"
    if [[ ! -f "$DESIGN_DONE" ]]; then
        echo "  技术设计未完成（.architect-design-done 不存在）"
        echo "  继续执行 /architect design"
        exit 2
    fi

    ARCH_MD="$PROJECT_ROOT/architecture.md"
    if [[ ! -f "$ARCH_MD" ]]; then
        echo "  architecture.md 不存在"
        echo "  继续执行 /architect design"
        exit 2
    fi

    echo "  .architect-design-done 存在"
    echo "  architecture.md 存在"
    echo "  /architect design 完成"
    rm -f "$DESIGN_LOCK"
    exit 0
fi
