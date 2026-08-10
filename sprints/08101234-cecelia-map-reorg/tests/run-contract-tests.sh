#!/usr/bin/env bash
# run-contract-tests.sh — Cecelia 承诺地图归位 E2E 合同验收
# 用途：migration 397-400 执行完毕后运行，验证所有 DOD 条目
# 执行位置：workspace 根目录
#   bash sprints/08101234-cecelia-map-reorg/tests/run-contract-tests.sh
#
# 依赖：curl, python3, jq（可选），node（用于 facts-check）
# 环境变量：BRAIN_URL（默认 http://localhost:5221）

set -uo pipefail

BRAIN_URL="${BRAIN_URL:-http://localhost:5221}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
WORKSPACE_DIR="$(cd "$SCRIPT_DIR/../../.." && pwd)"

PASS=0
FAIL=0
TOTAL=0

###############################################################################
# 工具函数
###############################################################################

log_pass() { echo "  [PASS] $1"; ((PASS++)); ((TOTAL++)); }
log_fail() { echo "  [FAIL] $1"; ((FAIL++)); ((TOTAL++)); }

# 通过 Brain query API 执行 SQL，返回第一行第一列
brain_query_scalar() {
  local sql="$1"
  local result
  result=$(curl -sf "${BRAIN_URL}/api/brain/query" \
    -X POST \
    -H "Content-Type: application/json" \
    -d "$(python3 -c "import json,sys; print(json.dumps({'sql': sys.argv[1]}))" "$sql")" \
    2>/dev/null | python3 -c "
import sys, json
try:
    d = json.load(sys.stdin)
    rows = d.get('rows', d.get('data', d)) if isinstance(d, dict) else d
    if isinstance(rows, list) and rows:
        first = rows[0]
        val = list(first.values())[0] if isinstance(first, dict) else first
        print(str(val))
    else:
        print('0')
except Exception as e:
    print('ERROR:' + str(e))
" 2>/dev/null) || result="CURL_ERROR"
  echo "$result"
}

check_eq() {
  local label="$1"
  local sql="$2"
  local expected="$3"
  local result
  result=$(brain_query_scalar "$sql")
  if [ "$result" = "$expected" ]; then
    log_pass "$label (got=$result)"
  else
    log_fail "$label (expected=$expected, got=$result)"
  fi
}

###############################################################################
# 检查 Brain 连通性
###############################################################################

echo "=== Cecelia 承诺地图归位 — E2E 合同验收 ==="
echo "Brain URL: $BRAIN_URL"
echo "WorkSpace: $WORKSPACE_DIR"
echo ""

if ! curl -sf "${BRAIN_URL}/api/brain/health" >/dev/null 2>&1; then
  echo "[ERROR] Brain 不可达: $BRAIN_URL"
  echo "请先启动 Brain: cd packages/brain && npm start"
  exit 2
fi

###############################################################################
# DOD-1：2 条 active 价值流
###############################################################################

echo "--- DOD-1: 价值流数量（期望=2）---"
check_eq "active value_stream count" \
  "SELECT COUNT(*)::text FROM journeys WHERE type='value_stream' AND status='active'" \
  "2"

###############################################################################
# DOD-2：工厂 6 + 管家 5 Capability
###############################################################################

echo ""
echo "--- DOD-2: Capability 分布（工厂=6, 管家=5）---"

check_eq "工厂 active capability count" \
  "SELECT COUNT(*)::text FROM journeys c JOIN journeys j ON j.id=c.parent_journey_id WHERE j.type='value_stream' AND j.name='工厂' AND c.type='capability' AND c.status='active'" \
  "6"

check_eq "管家 active capability count" \
  "SELECT COUNT(*)::text FROM journeys c JOIN journeys j ON j.id=c.parent_journey_id WHERE j.type='value_stream' AND j.name='管家' AND c.type='capability' AND c.status='active'" \
  "5"

# capability_code 唯一性验证
check_eq "capability_code 无重复" \
  "SELECT COUNT(*)::text FROM (SELECT capability_code, COUNT(*) cnt FROM journeys WHERE type='capability' AND status='active' GROUP BY capability_code HAVING COUNT(*)>1) dup" \
  "0"

###############################################################################
# DOD-3：in_progress 任务锚点无悬空 FK
###############################################################################

echo ""
echo "--- DOD-3: in_progress 任务锚点保护（期望悬空=0）---"

check_eq "dangling in_progress task journey_id" \
  "SELECT COUNT(*)::text FROM tasks t WHERE t.status='in_progress' AND t.journey_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM journeys j WHERE j.id=t.journey_id)" \
  "0"

###############################################################################
# DOD-4：孤儿 journey_features 清零
###############################################################################

echo ""
echo "--- DOD-4: 孤儿 journey_features 清零（期望=0）---"

check_eq "null journey_id non-deprecated features" \
  "SELECT COUNT(*)::text FROM journey_features WHERE journey_id IS NULL AND status!='deprecated'" \
  "0"

# 验证未有物理 DELETE（孤儿行必须以 deprecated 留档）
check_eq "deprecated orphan features exist (留档验证，期望≥1)" \
  "SELECT CASE WHEN COUNT(*)>=1 THEN '1' ELSE '0' END FROM journey_features WHERE journey_id IS NULL AND status='deprecated'" \
  "1"

###############################################################################
# DOD-5：横切件池 7 项
###############################################################################

echo ""
echo "--- DOD-5: 横切件池 7 项登记（期望=7）---"

check_eq "xcut working_memory total count" \
  "SELECT COUNT(*)::text FROM working_memory WHERE key LIKE 'xcut::%'" \
  "7"

check_eq "xcut 每项有 owner_capability_code" \
  "SELECT COUNT(*)::text FROM working_memory WHERE key LIKE 'xcut::%' AND (value->>'owner_capability_code') IS NOT NULL AND (value->>'owner_capability_code')!=''" \
  "7"

# 逐项存在性检查
for xcut_key in heartbeat credential_chain executor_pool skill_dispatch alert_chain database network; do
  check_eq "xcut::${xcut_key} 存在" \
    "SELECT COUNT(*)::text FROM working_memory WHERE key='xcut::${xcut_key}'" \
    "1"
done

###############################################################################
# DOD-6：F1 分拣 audit 记录
###############################################################################

echo ""
echo "--- DOD-6: migration 399 分拣 audit 记录（期望≥1）---"

check_eq "migration_audit:399_orphan_triage 记录存在" \
  "SELECT CASE WHEN COUNT(*)>=1 THEN '1' ELSE '0' END FROM working_memory WHERE key='migration_audit:399_orphan_triage'" \
  "1"

###############################################################################
# DOD-7：migration 文件存在性
###############################################################################

echo ""
echo "--- DOD-7: migration 文件存在（397-400）---"

cd "$WORKSPACE_DIR"
for num in 397 398 399 400; do
  if ls packages/brain/migrations/${num}_*.sql >/dev/null 2>&1; then
    fname=$(ls packages/brain/migrations/${num}_*.sql | head -1 | xargs basename)
    log_pass "migration ${num} 文件存在: $fname"
  else
    log_fail "migration ${num} 文件缺失"
  fi
done

# rollback 文件存在性
for num in 397 398 399 400; do
  if ls packages/brain/migrations/rollback/${num}_*.down.sql >/dev/null 2>&1; then
    log_pass "rollback ${num} 存在"
  else
    log_fail "rollback ${num} 缺失（INV-5 rollback 对称要求）"
  fi
done

###############################################################################
# DOD-8：selfcheck EXPECTED_SCHEMA_VERSION=400
###############################################################################

echo ""
echo "--- DOD-8: selfcheck.js EXPECTED_SCHEMA_VERSION=400 ---"

if grep -q "EXPECTED_SCHEMA_VERSION = '400'" packages/brain/src/selfcheck.js; then
  log_pass "EXPECTED_SCHEMA_VERSION='400'"
else
  actual=$(grep "EXPECTED_SCHEMA_VERSION" packages/brain/src/selfcheck.js | head -1 | tr -d ' ')
  log_fail "EXPECTED_SCHEMA_VERSION 不是 400，实际: $actual"
fi

###############################################################################
# DOD-9：DevGate facts-check
###############################################################################

echo ""
echo "--- DOD-9: DevGate facts-check ---"

if node scripts/facts-check.mjs >/dev/null 2>&1; then
  log_pass "facts-check.mjs 通过"
else
  log_fail "facts-check.mjs 失败（运行 node scripts/facts-check.mjs 查看详情）"
fi

if bash scripts/check-version-sync.sh >/dev/null 2>&1; then
  log_pass "check-version-sync.sh 通过"
else
  log_fail "check-version-sync.sh 失败"
fi

###############################################################################
# 汇总
###############################################################################

echo ""
echo "========================================"
echo "验收结果: PASS=$PASS / TOTAL=$TOTAL  FAIL=$FAIL"
echo "========================================"

if [ "$FAIL" -eq 0 ]; then
  echo "所有合同验收通过，任务可合并。"
  exit 0
else
  echo "存在 $FAIL 项失败，请修复后重新验收。"
  exit 1
fi
