#!/usr/bin/env bash
# compare-us-hk.sh — 美国本机 ↔ HK 容器库对比（拆库刀3-T2/T3/T4/T5 数据核对）
# 方法论复用 scripts/zenithjoy-db-compare.sh（#3900 动态全量表版）：
#   动态枚举 zenithjoy schema 全量表 + 逐表 count + 关键表 max(created_at) + schema_migrations 条数
# 性能：所有 count 拼成单条 UNION ALL，每侧各一次查询（65 表逐条 ssh 往返会超时，禁止回退逐表模式）
# 用法: bash scripts/zj-migrate-hk/compare-us-hk.sh <db_name>   （如 zenithjoy_staging）
# 退出码: 0 = 零漂移；1 = 存在差异（WARN）
# 在美国本机（mmv）运行；HK 侧经 Tailscale ssh + 裸 docker exec（默认无 TTY，勿加 -T——那是 compose 旗标）。
set -euo pipefail

DB="${1:?用法: compare-us-hk.sh <db_name>}"
HK_SSH="root@100.86.118.99"
HK_CONTAINER="zenithjoy-db-postgres"
KEY_TABLES="wechat_publish_task works publish_logs agents"
WARN=0

us_sql() { psql -q -d "$DB" -Atc "$1"; }
hk_sql() { ssh "$HK_SSH" "docker exec $HK_CONTAINER psql -q -U zenithjoy -d $DB -Atc \"$1\""; }

echo "=== US↔HK 库对比: $DB — $(date '+%F %T %Z') ==="

LIST_SQL="SELECT table_name FROM information_schema.tables WHERE table_schema='zenithjoy' AND table_type='BASE TABLE' ORDER BY table_name;"
US_TABLES=$(us_sql "$LIST_SQL")
HK_TABLES=$(hk_sql "$LIST_SQL")

echo "表数量：US=$(echo "$US_TABLES" | grep -c .) 张，HK=$(echo "$HK_TABLES" | grep -c .) 张"

ONLY_US=$(comm -23 <(echo "$US_TABLES" | sort) <(echo "$HK_TABLES" | sort))
ONLY_HK=$(comm -13 <(echo "$US_TABLES" | sort) <(echo "$HK_TABLES" | sort))
COMMON=$(comm -12 <(echo "$US_TABLES" | sort) <(echo "$HK_TABLES" | sort))

if [ -n "$ONLY_US" ]; then echo "⚠️ WARN 仅在 US 存在（迁移遗漏）:"; echo "$ONLY_US" | sed 's/^/  - /'; WARN=1; fi
if [ -n "$ONLY_HK" ]; then echo "⚠️ WARN 仅在 HK 存在:"; echo "$ONLY_HK" | sed 's/^/  - /'; WARN=1; fi

# 单条 UNION ALL 拿全部 count（每侧一次往返）
COUNT_SQL=$(echo "$COMMON" | awk '{printf "%sSELECT '\''%s'\'' AS t, count(*) AS c FROM zenithjoy.\\\"%s\\\"", (NR>1?" UNION ALL ":""), $0, $0} END {print ";"}')
US_COUNTS=$(us_sql "$(echo "$COUNT_SQL" | sed 's/\\\"/"/g')")
HK_COUNTS=$(hk_sql "$COUNT_SQL")

printf "%-42s %12s %12s %8s\n" "表名" "US" "HK" "差异"
while IFS='|' read -r T US_C; do
  HK_C=$(echo "$HK_COUNTS" | awk -F'|' -v t="$T" '$1==t {print $2}')
  HK_C=${HK_C:-MISSING}
  if [ "$HK_C" = "MISSING" ] || [ "$US_C" != "$HK_C" ]; then
    printf "%-42s %12s %12s %8s ⚠️ WARN\n" "$T" "$US_C" "$HK_C" "-"
    WARN=1
  else
    printf "%-42s %12s %12s %8s\n" "$T" "$US_C" "$HK_C" "0"
  fi
done <<< "$US_COUNTS"

echo ""
echo "-- 关键表 max(created_at) --"
MAX_SQL=""
for T in $KEY_TABLES; do
  if echo "$COMMON" | grep -qx "$T"; then
    [ -n "$MAX_SQL" ] && MAX_SQL="$MAX_SQL UNION ALL "
    # 用 epoch 比较：两侧 psql 会话时区不同（US -05 / HK UTC），::text 同一时刻显示不同会误报
    MAX_SQL="${MAX_SQL}SELECT '$T' AS t, COALESCE(extract(epoch FROM max(created_at))::text,'-') AS m FROM zenithjoy.\\\"$T\\\""
  fi
done
if [ -n "$MAX_SQL" ]; then
  US_MAX=$(us_sql "$(echo "$MAX_SQL;" | sed 's/\\\"/"/g')")
  HK_MAX=$(hk_sql "$MAX_SQL;")
  while IFS='|' read -r T US_M; do
    HK_M=$(echo "$HK_MAX" | awk -F'|' -v t="$T" '$1==t {print $2}')
    FLAG=""; [ "$US_M" != "${HK_M:-}" ] && { FLAG="⚠️ WARN"; WARN=1; }
    printf "%-30s US=%-28s HK=%-28s %s\n" "$T" "$US_M" "${HK_M:--}" "$FLAG"
  done <<< "$US_MAX"
fi

echo ""
echo "-- schema_migrations 条数 --"
US_MIG=$(us_sql "SELECT count(*) FROM zenithjoy.schema_migrations;" 2>/dev/null || echo "-")
HK_MIG=$(hk_sql "SELECT count(*) FROM zenithjoy.schema_migrations;" 2>/dev/null || echo "-")
FLAG=""; [ "$US_MIG" != "$HK_MIG" ] && { FLAG="⚠️ WARN"; WARN=1; }
echo "US=$US_MIG HK=$HK_MIG $FLAG"

echo ""
if [ "$WARN" -eq 0 ]; then echo "✅ 零漂移"; else echo "❌ 存在差异（WARN）"; fi
exit "$WARN"
