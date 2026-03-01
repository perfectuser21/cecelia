#!/bin/bash
#
# 更新 RNA KR 进度 - 基于 learnings 表数据量化
#
# 使用方式:
#   bash scripts/update-rna-kr-progress.sh          # 实际更新
#   bash scripts/update-rna-kr-progress.sh --dry-run  # 模拟运行

set -euo pipefail

# 配置
RNA_KR_ID="12d516c9-a2cf-4c7b-87b7-1e49ce71b6a7"
TARGET_LEARNINGS=100  # 目标 learnings 数（7 天内累积）
DB_CONTAINER="cecelia-postgres"
DB_USER="cecelia"
DB_NAME="cecelia"

DRY_RUN=false
if [[ "${1:-}" == "--dry-run" ]]; then
    DRY_RUN=true
    echo "[DRY RUN] 模拟运行模式"
fi

# 检查依赖
if ! docker ps --filter "name=$DB_CONTAINER" --format "{{.Names}}" | grep -q "^${DB_CONTAINER}$"; then
    echo "❌ PostgreSQL 容器未运行: $DB_CONTAINER"
    echo "   当前运行的容器："
    docker ps --format "{{.Names}}" | grep postgres || echo "   无 PostgreSQL 容器"
    exit 1
fi

# 查询 learnings 数据
echo "📊 查询 learnings 表数据..."
LEARNINGS_COUNT=$(docker exec "$DB_CONTAINER" psql -U "$DB_USER" -d "$DB_NAME" -t -c \
    "SELECT COUNT(*) FROM learnings WHERE created_at > NOW() - INTERVAL '7 days'" | xargs)

if [[ -z "$LEARNINGS_COUNT" || "$LEARNINGS_COUNT" -lt 0 ]]; then
    echo "❌ 无法读取 learnings 数据"
    exit 1
fi

echo "  7 天内 learnings: $LEARNINGS_COUNT 条"

# 计算进度
PROGRESS=$(awk "BEGIN {printf \"%.0f\", ($LEARNINGS_COUNT / $TARGET_LEARNINGS) * 100}")

# 上限 100%
if [[ "$PROGRESS" -gt 100 ]]; then
    PROGRESS=100
fi

echo "  计算进度: $PROGRESS% (目标: $TARGET_LEARNINGS 条)"

# 查询当前 KR 进度
echo ""
echo "📋 查询当前 RNA KR 状态..."
CURRENT_PROGRESS=$(docker exec "$DB_CONTAINER" psql -U "$DB_USER" -d "$DB_NAME" -t -c \
    "SELECT progress FROM goals WHERE id = '$RNA_KR_ID'" | xargs)

if [[ -z "$CURRENT_PROGRESS" ]]; then
    echo "❌ RNA KR 不存在（ID: $RNA_KR_ID）"
    exit 1
fi

echo "  当前进度: $CURRENT_PROGRESS%"
echo "  目标进度: $PROGRESS%"

# 更新进度
if [[ "$DRY_RUN" == "true" ]]; then
    echo ""
    echo "✅ [DRY RUN] 模拟完成 - 实际运行时会更新 RNA KR 进度到 $PROGRESS%"
    exit 0
fi

echo ""
echo "🔄 更新 RNA KR 进度..."
docker exec "$DB_CONTAINER" psql -U "$DB_USER" -d "$DB_NAME" -c \
    "UPDATE goals SET progress = $PROGRESS, status = 'in_progress', updated_at = NOW() WHERE id = '$RNA_KR_ID'" > /dev/null

# 验证更新
NEW_PROGRESS=$(docker exec "$DB_CONTAINER" psql -U "$DB_USER" -d "$DB_NAME" -t -c \
    "SELECT progress FROM goals WHERE id = '$RNA_KR_ID'" | xargs)

if [[ "$NEW_PROGRESS" == "$PROGRESS" ]]; then
    echo "✅ RNA KR 进度已更新: $CURRENT_PROGRESS% → $NEW_PROGRESS%"
    echo ""
    echo "📈 RNA Learning 闭环量化完成："
    echo "   - learnings 总数: $LEARNINGS_COUNT 条（7 天内）"
    echo "   - 目标: $TARGET_LEARNINGS 条"
    echo "   - KR 进度: $NEW_PROGRESS%"
    echo "   - KR 状态: in_progress"
else
    echo "❌ 进度更新失败（预期: $PROGRESS%, 实际: $NEW_PROGRESS%）"
    exit 1
fi
