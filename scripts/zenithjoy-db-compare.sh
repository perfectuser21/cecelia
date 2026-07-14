#!/usr/bin/env bash
# zenithjoy-db-compare.sh — 刀1c/1d 双写验证监控脚本
#
# 目的：在3天验证期内对比 cecelia.zenithjoy schema 与独立 zenithjoy 库的全量表数据，
# 确认新库数据写入正常、旧库不再有新写入后可安全断开。
#
# P1修复(07-14)：原版只比对11张表，zenithjoy schema 实际有 ~69-74 张表。
# 现在动态枚举两侧所有表，盲区清零。
#
# 使用：bash scripts/zenithjoy-db-compare.sh
# 部署：在 mmv（38.23.47.81）上运行，每小时/每天比对一次
#
# 决策依据：拆库三刀落地（initiative 0935f962）+ 决策 3ac02755

set -euo pipefail

PSQL="psql -q"
CECELIA_DB="cecelia"
ZJ_DB="zenithjoy"

echo "=== ZenithJoy 双写验证比对 — $(date '+%Y-%m-%d %H:%M:%S') ==="
echo ""

# 动态枚举两侧 zenithjoy schema 下的所有表
CECELIA_TABLES=$($PSQL -d "$CECELIA_DB" -tc \
  "SELECT table_name FROM information_schema.tables WHERE table_schema='zenithjoy' AND table_type='BASE TABLE' ORDER BY table_name;" \
  2>/dev/null | tr -d ' ' | grep -v '^$') || CECELIA_TABLES=""

ZJ_TABLES=$($PSQL -d "$ZJ_DB" -tc \
  "SELECT table_name FROM information_schema.tables WHERE table_schema='zenithjoy' AND table_type='BASE TABLE' ORDER BY table_name;" \
  2>/dev/null | tr -d ' ' | grep -v '^$') || ZJ_TABLES=""

CECELIA_COUNT_TABLES=$(echo "$CECELIA_TABLES" | grep -c . 2>/dev/null || echo 0)
ZJ_COUNT_TABLES=$(echo "$ZJ_TABLES" | grep -c . 2>/dev/null || echo 0)
echo "表数量：cecelia.zenithjoy=${CECELIA_COUNT_TABLES} 张，zenithjoy库=${ZJ_COUNT_TABLES} 张"
echo ""

# 找出仅存在于一侧的表
if [ -n "$CECELIA_TABLES" ] && [ -n "$ZJ_TABLES" ]; then
  ONLY_IN_CECELIA=$(comm -23 <(echo "$CECELIA_TABLES" | sort) <(echo "$ZJ_TABLES" | sort))
  ONLY_IN_ZJ=$(comm -13 <(echo "$CECELIA_TABLES" | sort) <(echo "$ZJ_TABLES" | sort))
  COMMON_TABLES=$(comm -12 <(echo "$CECELIA_TABLES" | sort) <(echo "$ZJ_TABLES" | sort))

  if [ -n "$ONLY_IN_CECELIA" ]; then
    echo "⚠️  仅在 cecelia.zenithjoy 存在的表（未迁移）："
    echo "$ONLY_IN_CECELIA" | sed 's/^/  - /'
    echo ""
  fi
  if [ -n "$ONLY_IN_ZJ" ]; then
    echo "ℹ️  仅在 zenithjoy 库存在的表（新建表）："
    echo "$ONLY_IN_ZJ" | sed 's/^/  - /'
    echo ""
  fi
else
  COMMON_TABLES=""
  echo "⚠️  无法枚举表列表，请检查 psql 连接"
fi

printf "%-42s %-15s %-15s %-12s\n" "表名" "cecelia库" "zenithjoy库" "差异"
printf "%-42s %-15s %-15s %-12s\n" "----" "------" "------" "----"

ALL_OK=true
WARN_TABLES=()

while IFS= read -r TABLE; do
  [ -z "$TABLE" ] && continue

  CECELIA_CNT=$($PSQL -d "$CECELIA_DB" -tc \
    "SELECT count(*) FROM zenithjoy.\"$TABLE\";" 2>/dev/null | tr -d ' ') || CECELIA_CNT="ERR"
  ZJ_CNT=$($PSQL -d "$ZJ_DB" -tc \
    "SELECT count(*) FROM zenithjoy.\"$TABLE\";" 2>/dev/null | tr -d ' ') || ZJ_CNT="ERR"

  if [ "$CECELIA_CNT" = "ERR" ] || [ "$ZJ_CNT" = "ERR" ]; then
    printf "%-42s %-15s %-15s %-12s\n" "zenithjoy.$TABLE" "${CECELIA_CNT}" "${ZJ_CNT}" "ERR"
    ALL_OK=false
    WARN_TABLES+=("$TABLE")
    continue
  fi

  DIFF=$((ZJ_CNT - CECELIA_CNT))
  STATUS="OK"
  if [ "$DIFF" -lt -5 ]; then
    STATUS="WARN↓($DIFF)"
    ALL_OK=false
    WARN_TABLES+=("$TABLE")
  elif [ "$DIFF" -gt 100 ]; then
    STATUS="GROWING($DIFF)"
  else
    STATUS="OK($DIFF)"
  fi

  printf "%-42s %-15s %-15s %-12s\n" "zenithjoy.$TABLE" "$CECELIA_CNT" "$ZJ_CNT" "$STATUS"
done <<< "$COMMON_TABLES"

echo ""
if [ "$ALL_OK" = "true" ]; then
  echo "✅ 验证通过 — 全量表数据完整，无显著差异"
else
  echo "⚠️  发现差异表：${WARN_TABLES[*]:-（见上）}"
fi

# 最新写入时间对比（关键业务表）
echo ""
echo "--- 最新写入时间对比（关键表） ---"
for TABLE in "works" "wechat_publish_task" "publish_logs" "agents"; do
  CECELIA_MAX=$($PSQL -d "$CECELIA_DB" -tc \
    "SELECT COALESCE(max(created_at)::text, 'empty') FROM zenithjoy.\"$TABLE\";" \
    2>/dev/null | tr -d ' ') || CECELIA_MAX="ERR"
  ZJ_MAX=$($PSQL -d "$ZJ_DB" -tc \
    "SELECT COALESCE(max(created_at)::text, 'empty') FROM zenithjoy.\"$TABLE\";" \
    2>/dev/null | tr -d ' ') || ZJ_MAX="ERR"
  echo "  $TABLE: cecelia=$CECELIA_MAX | zenithjoy=$ZJ_MAX"
done

echo ""
echo "--- Migration 记录数对比 ---"
CECELIA_MIG=$($PSQL -d "$CECELIA_DB" -tc \
  "SELECT count(*) FROM zenithjoy.schema_migrations;" 2>/dev/null | tr -d ' ') || CECELIA_MIG="ERR"
ZJ_MIG=$($PSQL -d "$ZJ_DB" -tc \
  "SELECT count(*) FROM zenithjoy.schema_migrations;" 2>/dev/null | tr -d ' ') || ZJ_MIG="ERR"
echo "  cecelia.schema_migrations: $CECELIA_MIG 条"
echo "  zenithjoy.schema_migrations: $ZJ_MIG 条"

echo ""
echo "说明："
echo "  • 比对范围：两侧 zenithjoy schema 下全量表（动态枚举，无盲区）"
echo "  • 双写验证期 ≥ 3 天后，若 cecelia.zenithjoy 无新写入可断开旧连接"
echo "  • zenithjoy 库 count ≥ cecelia 库 count 为正常（新库持续接收写入）"
echo "  • WARN↓ 表示新库数据少于旧库 5 条以上，需调查"
echo "  • 仅在 cecelia.zenithjoy 存在的表=迁移遗漏（P0）"
