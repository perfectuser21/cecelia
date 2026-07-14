#!/usr/bin/env bash
# compare-us-hk.sh — 美国本机 ↔ HK 容器库对比（拆库刀3-T2/T3/T4/T5 数据核对）
# 方法论复用 scripts/zenithjoy-db-compare.sh（#3900 动态全量表版）：
#   动态枚举 zenithjoy schema 全量表 + 逐表 count + 关键表 max(created_at) + schema_migrations 条数
# 用法: bash scripts/zj-migrate-hk/compare-us-hk.sh <db_name>   （如 zenithjoy_staging）
# 退出码: 0 = 零漂移；1 = 存在差异（WARN）
# 在美国本机（mmv）运行；HK 侧经 Tailscale ssh + docker exec -T（无 TTY）。
set -euo pipefail

DB="${1:?用法: compare-us-hk.sh <db_name>}"
HK_SSH="root@100.86.118.99"
HK_CONTAINER="zenithjoy-db-postgres"
KEY_TABLES="wechat_publish_task works publish_logs agents"
WARN=0

us_sql() { psql -q -d "$DB" -Atc "$1"; }
hk_sql() { ssh "$HK_SSH" "docker exec -T $HK_CONTAINER psql -q -U zenithjoy -d $DB -Atc \"$1\""; }

echo "=== US↔HK 库对比: $DB — $(date '+%F %T %Z') ==="

US_TABLES=$(us_sql "SELECT table_name FROM information_schema.tables WHERE table_schema='zenithjoy' AND table_type='BASE TABLE' ORDER BY table_name;")
HK_TABLES=$(hk_sql "SELECT table_name FROM information_schema.tables WHERE table_schema='zenithjoy' AND table_type='BASE TABLE' ORDER BY table_name;")

echo "表数量：US=$(echo "$US_TABLES" | grep -c .) 张，HK=$(echo "$HK_TABLES" | grep -c .) 张"

ONLY_US=$(comm -23 <(echo "$US_TABLES" | sort) <(echo "$HK_TABLES" | sort))
ONLY_HK=$(comm -13 <(echo "$US_TABLES" | sort) <(echo "$HK_TABLES" | sort))
COMMON=$(comm -12 <(echo "$US_TABLES" | sort) <(echo "$HK_TABLES" | sort))

if [ -n "$ONLY_US" ]; then echo "⚠️ WARN 仅在 US 存在（迁移遗漏）:"; echo "$ONLY_US" | sed 's/^/  - /'; WARN=1; fi
if [ -n "$ONLY_HK" ]; then echo "⚠️ WARN 仅在 HK 存在:"; echo "$ONLY_HK" | sed 's/^/  - /'; WARN=1; fi

printf "%-42s %12s %12s %8s\n" "表名" "US" "HK" "差异"
for T in $COMMON; do
  US_C=$(us_sql "SELECT count(*) FROM zenithjoy.\"$T\";")
  HK_C=$(hk_sql "SELECT count(*) FROM zenithjoy.\\\"$T\\\";")
  DIFF=$((US_C - HK_C))
  MARK=""
  if [ "$DIFF" -ne 0 ]; then MARK="⚠️ WARN"; WARN=1; fi
  printf "%-42s %12s %12s %8s %s\n" "$T" "$US_C" "$HK_C" "$DIFF" "$MARK"
done

echo ""
echo "-- 关键表 max(created_at) --"
for T in $KEY_TABLES; do
  if echo "$COMMON" | grep -qx "$T"; then
    US_M=$(us_sql "SELECT COALESCE(max(created_at)::text,'-') FROM zenithjoy.\"$T\";")
    HK_M=$(hk_sql "SELECT COALESCE(max(created_at)::text,'-') FROM zenithjoy.\\\"$T\\\";")
    FLAG=""; [ "$US_M" != "$HK_M" ] && { FLAG="⚠️ WARN"; WARN=1; }
    printf "%-30s US=%-28s HK=%-28s %s\n" "$T" "$US_M" "$HK_M" "$FLAG"
  fi
done

echo ""
echo "-- schema_migrations 条数 --"
US_MIG=$(us_sql "SELECT count(*) FROM zenithjoy.schema_migrations;" 2>/dev/null || echo "-")
HK_MIG=$(hk_sql "SELECT count(*) FROM zenithjoy.schema_migrations;" 2>/dev/null || echo "-")
FLAG=""; [ "$US_MIG" != "$HK_MIG" ] && { FLAG="⚠️ WARN"; WARN=1; }
echo "US=$US_MIG HK=$HK_MIG $FLAG"

echo ""
if [ "$WARN" -eq 0 ]; then echo "✅ 零漂移"; else echo "❌ 存在差异（WARN）"; fi
exit "$WARN"
