#!/usr/bin/env bash
# zenithjoy-db-compare.sh — 刀1c/1d 双写验证监控脚本
#
# 目的：在3天验证期内对比 cecelia.zenithjoy schema 与独立 zenithjoy 库的关键表数据量，
# 确认新库数据写入正常、旧库不再有新写入后可安全断开。
#
# 使用：bash scripts/zenithjoy-db-compare.sh
# 部署：在 mmv（38.23.47.81）上运行，每小时/每天比对一次
#
# 决策依据：拆库三刀落地（initiative 0935f962）+ 决策 3ac02755

set -euo pipefail

PSQL="psql -q"
CECELIA_DB="cecelia"
ZJ_DB="zenithjoy"

# 要监控的关键表（schema: zenithjoy）
TABLES=(
  "wechat_publish_task"
  "works"
  "publish_logs"
  "agents"
  "tenants"
  "agent_events"
)

echo "=== ZenithJoy 双写验证比对 — $(date '+%Y-%m-%d %H:%M:%S') ==="
echo ""
printf "%-40s %-15s %-15s %-10s\n" "表名" "cecelia库" "zenithjoy库" "差异"
printf "%-40s %-15s %-15s %-10s\n" "----" "------" "------" "----"

ALL_OK=true

for TABLE in "${TABLES[@]}"; do
  # 检查表是否存在
  CECELIA_EXISTS=$($PSQL -d "$CECELIA_DB" -tc \
    "SELECT EXISTS(SELECT 1 FROM information_schema.tables WHERE table_schema='zenithjoy' AND table_name='$TABLE');" \
    2>/dev/null | tr -d ' ')
  ZJ_EXISTS=$($PSQL -d "$ZJ_DB" -tc \
    "SELECT EXISTS(SELECT 1 FROM information_schema.tables WHERE table_schema='zenithjoy' AND table_name='$TABLE');" \
    2>/dev/null | tr -d ' ')

  if [ "$CECELIA_EXISTS" != "t" ] || [ "$ZJ_EXISTS" != "t" ]; then
    printf "%-40s %-15s %-15s %-10s\n" "zenithjoy.$TABLE" \
      "${CECELIA_EXISTS:-ERR}" "${ZJ_EXISTS:-ERR}" "SKIP"
    continue
  fi

  CECELIA_COUNT=$($PSQL -d "$CECELIA_DB" -tc \
    "SELECT count(*) FROM zenithjoy.$TABLE;" 2>/dev/null | tr -d ' ')
  ZJ_COUNT=$($PSQL -d "$ZJ_DB" -tc \
    "SELECT count(*) FROM zenithjoy.$TABLE;" 2>/dev/null | tr -d ' ')

  DIFF=$((${ZJ_COUNT:-0} - ${CECELIA_COUNT:-0}))
  STATUS="OK"
  if [ "$DIFF" -lt -5 ]; then
    STATUS="WARN↓"
    ALL_OK=false
  elif [ "$DIFF" -gt 100 ]; then
    STATUS="GROWING"
  fi

  printf "%-40s %-15s %-15s %-10s\n" \
    "zenithjoy.$TABLE" "${CECELIA_COUNT:-ERR}" "${ZJ_COUNT:-ERR}" "$STATUS($DIFF)"
done

echo ""
# 检查最新写入时间对比
echo "--- 最新写入时间对比 ---"
for TABLE in "works" "wechat_publish_task"; do
  CECELIA_MAX=$($PSQL -d "$CECELIA_DB" -tc \
    "SELECT COALESCE(max(created_at)::text, 'empty') FROM zenithjoy.$TABLE;" \
    2>/dev/null | tr -d ' ')
  ZJ_MAX=$($PSQL -d "$ZJ_DB" -tc \
    "SELECT COALESCE(max(created_at)::text, 'empty') FROM zenithjoy.$TABLE;" \
    2>/dev/null | tr -d ' ')
  echo "  $TABLE: cecelia=$CECELIA_MAX | zenithjoy=$ZJ_MAX"
done

echo ""
if [ "$ALL_OK" = "true" ]; then
  echo "✅ 验证通过 — 新库数据完整，无显著差异"
else
  echo "⚠️  发现差异 — 请检查上表中 WARN 项目"
fi

echo ""
echo "--- Migration 记录数对比 ---"
CECELIA_MIG=$($PSQL -d "$CECELIA_DB" -tc \
  "SELECT count(*) FROM zenithjoy.schema_migrations;" 2>/dev/null | tr -d ' ')
ZJ_MIG=$($PSQL -d "$ZJ_DB" -tc \
  "SELECT count(*) FROM zenithjoy.schema_migrations;" 2>/dev/null | tr -d ' ')
echo "  cecelia.schema_migrations: $CECELIA_MIG 条"
echo "  zenithjoy.schema_migrations: $ZJ_MIG 条"

echo ""
echo "说明："
echo "  • 双写验证期 ≥ 3 天后，若 cecelia.zenithjoy 无新写入可断开旧连接"
echo "  • zenithjoy 库 count ≥ cecelia 库 count 为正常（新库持续接收写入）"
echo "  • WARN↓ 表示新库数据少于旧库 5 条以上，需调查"
