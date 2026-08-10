#!/usr/bin/env bash
# thin-clone-e2e.sh — preview 瘦克隆 E2E 验证脚本
#
# 覆盖 BEHAVIOR-05~09（需要真实起 preview 环境）
# 用法：
#   DB_NAME=cecelia_preview_<PR> PORT=<port> \
#   DB_HOST=<host> DB_USER=<user> DB_PASSWORD=<pw> \
#   PROD_DB_NAME=cecelia \
#   bash sprints/08110001-preview-thin-clone/tests/thin-clone-e2e.sh
#
# 环境变量：
#   DB_NAME          — preview 数据库名（必须，已克隆完毕）
#   PORT             — preview Brain 端口（必须）
#   DB_HOST          — DB 主机（默认 localhost）
#   DB_USER          — DB 用户（默认 cecelia）
#   DB_PASSWORD      — DB 密码（默认 cecelia）
#   PROD_DB_NAME     — 主库名（默认 cecelia），用于行数对比
#   SMOKE_SCRIPT     — 既有冒烟脚本路径（可选，缺省时跳过 BEHAVIOR-09）
#
# 本脚本产出 PR 证据数字，应将输出写进 PR 描述。

set -uo pipefail

PASS=0; FAIL=0; SKIP=0

pass()  { echo "  PASS: $1"; PASS=$((PASS + 1)); }
fail()  { echo "  FAIL: $1 — $2"; FAIL=$((FAIL + 1)); }
skip()  { echo "  SKIP: $1 — $2"; SKIP=$((SKIP + 1)); }

DB_NAME="${DB_NAME:?请设置 DB_NAME 环境变量（preview 数据库名）}"
PORT="${PORT:?请设置 PORT 环境变量（preview Brain 端口）}"
DB_HOST="${DB_HOST:-localhost}"
DB_USER="${DB_USER:-cecelia}"
DB_PASSWORD="${DB_PASSWORD:-cecelia}"
PROD_DB_NAME="${PROD_DB_NAME:-cecelia}"
SMOKE_SCRIPT="${SMOKE_SCRIPT:-}"

PSQL="PGPASSWORD=${DB_PASSWORD} psql -h ${DB_HOST} -U ${DB_USER}"

echo ""
echo "========================================"
echo "preview 瘦克隆 E2E 验证"
echo "DB_NAME=${DB_NAME}  PORT=${PORT}"
echo "========================================"

# ─────────────────────────────────────────────────────────────────────────────
# BEHAVIOR-05：preview 库总大小 < 1GB (manual:bash)
# ─────────────────────────────────────────────────────────────────────────────
echo ""
echo "=== BEHAVIOR-05: preview 库大小 ==="

DB_SIZE=$(${PSQL} -d "${DB_NAME}" -tAc "SELECT pg_database_size('${DB_NAME}')" 2>/dev/null || echo "")

if [ -z "$DB_SIZE" ]; then
  fail "BEHAVIOR-05" "无法获取 pg_database_size，请检查 DB 连接参数"
else
  DB_SIZE_MB=$(( DB_SIZE / 1024 / 1024 ))
  echo "  [证据] pg_database_size('${DB_NAME}') = ${DB_SIZE} bytes (${DB_SIZE_MB} MB)"
  echo "  [PR证据] 请将以下数字复制到 PR 描述: DB_SIZE=${DB_SIZE} bytes / ${DB_SIZE_MB} MB"

  LIMIT_BYTES=1073741824  # 1 GB
  if [ "$DB_SIZE" -lt "$LIMIT_BYTES" ]; then
    pass "BEHAVIOR-05: preview 库大小 ${DB_SIZE_MB}MB < 1024MB"
  else
    fail "BEHAVIOR-05" "preview 库 ${DB_SIZE_MB}MB >= 1024MB，未达到瘦克隆目标"
  fi
fi

# ─────────────────────────────────────────────────────────────────────────────
# BEHAVIOR-03（E2E 确认）：排除表 schema 存在
# ─────────────────────────────────────────────────────────────────────────────
echo ""
echo "=== BEHAVIOR-03(E2E): 排除表 schema 存在 ==="

SCHEMA_COUNT=$(${PSQL} -d "${DB_NAME}" -tAc \
  "SELECT count(*) FROM information_schema.tables
   WHERE table_schema='public'
     AND table_name IN (
       'memory_stream','cecelia_events','alertness_metrics',
       'checkpoint_writes','checkpoint_blobs','checkpoints','captures'
     )" 2>/dev/null || echo "")

if [ -z "$SCHEMA_COUNT" ]; then
  fail "BEHAVIOR-03" "无法查询 information_schema.tables"
elif [ "$SCHEMA_COUNT" -eq 7 ]; then
  pass "BEHAVIOR-03: 7 张排除表 schema 均存在（count=${SCHEMA_COUNT}）"
else
  fail "BEHAVIOR-03" "排除表 schema 存在 ${SCHEMA_COUNT} 张，期望 7 张"
fi

# ─────────────────────────────────────────────────────────────────────────────
# BEHAVIOR-04（E2E 确认）：排除表数据为空
# ─────────────────────────────────────────────────────────────────────────────
echo ""
echo "=== BEHAVIOR-04(E2E): 排除表数据为空 ==="

EXCLUDE_TABLES=(memory_stream cecelia_events alertness_metrics checkpoint_writes checkpoint_blobs checkpoints captures)
for tbl in "${EXCLUDE_TABLES[@]}"; do
  COUNT=$(${PSQL} -d "${DB_NAME}" -tAc "SELECT count(*) FROM ${tbl}" 2>/dev/null || echo "ERROR")
  if [ "$COUNT" = "ERROR" ]; then
    fail "BEHAVIOR-04: ${tbl}" "查询失败（表可能不存在或连接错误）"
  elif [ "$COUNT" -eq 0 ]; then
    pass "BEHAVIOR-04: ${tbl} 数据为空（count=0）"
  else
    fail "BEHAVIOR-04: ${tbl}" "数据不为空（count=${COUNT}），瘦克隆失效"
  fi
done

# ─────────────────────────────────────────────────────────────────────────────
# BEHAVIOR-06：业务表行数与主库一致
# ─────────────────────────────────────────────────────────────────────────────
echo ""
echo "=== BEHAVIOR-06: 业务表数据完整性 ==="

BUSINESS_TABLES=(tasks journeys)
for tbl in "${BUSINESS_TABLES[@]}"; do
  PREVIEW_COUNT=$(${PSQL} -d "${DB_NAME}" -tAc "SELECT count(*) FROM ${tbl}" 2>/dev/null || echo "")
  PROD_COUNT=$(${PSQL} -d "${PROD_DB_NAME}" -tAc "SELECT count(*) FROM ${tbl}" 2>/dev/null || echo "")

  echo "  [PR证据] ${tbl}: 主库=${PROD_COUNT:-N/A} preview=${PREVIEW_COUNT:-N/A}"

  if [ -z "$PREVIEW_COUNT" ] || [ -z "$PROD_COUNT" ]; then
    fail "BEHAVIOR-06: ${tbl}" "无法获取行数（DB_NAME=${DB_NAME} PROD_DB_NAME=${PROD_DB_NAME}）"
  elif [ "$PREVIEW_COUNT" -ge "$PROD_COUNT" ]; then
    pass "BEHAVIOR-06: ${tbl} 行数完整（preview=${PREVIEW_COUNT} >= prod=${PROD_COUNT}）"
  else
    fail "BEHAVIOR-06: ${tbl}" "数据丢失（preview=${PREVIEW_COUNT} < prod=${PROD_COUNT}）"
  fi
done

# ─────────────────────────────────────────────────────────────────────────────
# BEHAVIOR-07：preview Brain health 200
# ─────────────────────────────────────────────────────────────────────────────
echo ""
echo "=== BEHAVIOR-07: preview Brain health ==="

HEALTH_RESP=$(curl -sf --connect-timeout 5 --max-time 10 "http://localhost:${PORT}/" 2>/dev/null || echo "")
HTTP_CODE=$(curl -s -o /dev/null -w '%{http_code}' --connect-timeout 5 --max-time 10 "http://localhost:${PORT}/" 2>/dev/null || echo "000")

if [ "$HTTP_CODE" = "200" ] && echo "$HEALTH_RESP" | grep -q '"status":"running"'; then
  pass "BEHAVIOR-07: preview Brain health 200 + status=running"
elif [ "$HTTP_CODE" = "200" ]; then
  fail "BEHAVIOR-07" "HTTP 200 但响应无 status=running: ${HEALTH_RESP}"
else
  fail "BEHAVIOR-07" "HTTP ${HTTP_CODE}，preview Brain 未就绪（port=${PORT}）"
fi

# ─────────────────────────────────────────────────────────────────────────────
# BEHAVIOR-08：preview Brain selfcheck 无 schema 错误
# ─────────────────────────────────────────────────────────────────────────────
echo ""
echo "=== BEHAVIOR-08: preview Brain selfcheck ==="

SELFCHECK_RESP=$(curl -sf --connect-timeout 5 --max-time 15 "http://localhost:${PORT}/api/brain/selfcheck" 2>/dev/null || echo "")

if [ -z "$SELFCHECK_RESP" ]; then
  fail "BEHAVIOR-08" "selfcheck 接口无响应（port=${PORT}）"
elif echo "$SELFCHECK_RESP" | grep -qi 'schema_version\|schema.*error\|migration.*error'; then
  fail "BEHAVIOR-08" "selfcheck 返回 schema 错误: ${SELFCHECK_RESP}"
else
  pass "BEHAVIOR-08: selfcheck 无 schema 错误"
fi

# ─────────────────────────────────────────────────────────────────────────────
# BEHAVIOR-09：既有冒烟测试 PASS
# ─────────────────────────────────────────────────────────────────────────────
echo ""
echo "=== BEHAVIOR-09: 既有冒烟测试 ==="

REPO_ROOT_GUESS="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
DEFAULT_SMOKE="${REPO_ROOT_GUESS}/packages/brain/scripts/smoke/preview-environments-smoke.sh"

if [ -z "$SMOKE_SCRIPT" ] && [ -f "$DEFAULT_SMOKE" ]; then
  SMOKE_SCRIPT="$DEFAULT_SMOKE"
fi

if [ -z "$SMOKE_SCRIPT" ]; then
  skip "BEHAVIOR-09" "未找到冒烟脚本（设置 SMOKE_SCRIPT 环境变量指向脚本路径）"
elif [ ! -f "$SMOKE_SCRIPT" ]; then
  skip "BEHAVIOR-09" "冒烟脚本路径不存在: ${SMOKE_SCRIPT}"
else
  if DB_NAME="$DB_NAME" PORT="$PORT" bash "$SMOKE_SCRIPT" 2>&1; then
    pass "BEHAVIOR-09: 既有冒烟测试 PASS"
  else
    fail "BEHAVIOR-09" "既有冒烟测试 FAIL（exit 非 0）"
  fi
fi

# ─────────────────────────────────────────────────────────────────────────────
# 总结
# ─────────────────────────────────────────────────────────────────────────────
echo ""
echo "========================================"
echo "E2E 结果: PASS=${PASS}, FAIL=${FAIL}, SKIP=${SKIP}"
echo ""
echo "PR 证据摘要（请复制到 PR 描述）："
echo "  - DB_SIZE: 见上方 [PR证据] 行"
echo "  - tasks/journeys 行数: 见上方 [PR证据] 行"
echo "========================================"
[ "$FAIL" -eq 0 ] || exit 1
