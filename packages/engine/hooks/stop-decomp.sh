#!/usr/bin/env bash
# ============================================================================
# Stop Hook for /decomp 拆解流程 (v1.0.0)
# ============================================================================
# 检查 .decomp-mode 文件，验证拆解完成条件：
# 1. output.json 存在（拆解输出已生成）
# 2. DB 写入成功（store-to-database.sh 已执行）
#
# 完成 → exit 0（允许会话结束）
# 未完成 → exit 2（阻止会话结束，继续执行）
# ============================================================================

set -euo pipefail

PROJECT_ROOT="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
DECOMP_MODE_FILE="$PROJECT_ROOT/.decomp-mode"

# ===== 如果没有 .decomp-mode，不是 decomp 模式，直接允许结束 =====
if [[ ! -f "$DECOMP_MODE_FILE" ]]; then
    exit 0
fi

echo "=== /decomp Stop Hook: 检查完成条件 ==="

# ===== 检查 1: output.json 是否存在 =====
OUTPUT_FILE="$PROJECT_ROOT/output.json"
if [[ ! -f "$OUTPUT_FILE" ]]; then
    echo "❌ output.json 不存在"
    echo "   继续执行 /decomp 拆解，生成 output.json"
    exit 2
fi

echo "✅ output.json 存在"

# ===== 检查 2: DB 写入标记（.decomp-db-done 文件）=====
DB_DONE_FILE="$PROJECT_ROOT/.decomp-db-done"
if [[ ! -f "$DB_DONE_FILE" ]]; then
    echo "❌ DB 写入未完成（.decomp-db-done 不存在）"
    echo "   继续执行 store-to-database.sh"
    exit 2
fi

echo "✅ DB 写入已完成"

# ===== 所有条件满足，清理并退出 =====
echo ""
echo "✅ /decomp 拆解完成"
echo "   删除 .decomp-mode 文件..."
rm -f "$DECOMP_MODE_FILE"
exit 0
