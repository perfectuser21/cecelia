#!/usr/bin/env bash
# P0 Kernel DevOps Map 格子写入脚本
# 按合同 DoD 约定：FR-3 → FR-1 → FR-2 顺序执行
# Task ID: 5a4a7ef1-461d-4c3a-b8f5-7ca8c5f638bc

set -euo pipefail
BRAIN="${BRAIN_URL:-http://localhost:5221}"
JOURNEY_ID="e6f803f2-8c48-4cce-a7a1-5b1bda5e9c29"

echo "=== FR-3: 创建 kernel-contract-a20 步骤 (step_number=5) ==="
# POST journey_steps（ON CONFLICT DO UPDATE，幂等安全）
STEP_RESP=$(curl -fsS -m 15 -X POST "$BRAIN/api/brain/journey_steps" \
  -H "Content-Type: application/json" \
  -d "{\"journey_id\":\"$JOURNEY_ID\",\"step_number\":5,\"name\":\"kernel-contract-a20\",\"description\":\"A2-0 原子行为等价合同骨干步骤（11 行为族 S0-S12，43 原子行为，446 探针）\",\"status\":\"planned\"}")
echo "step 响应: $STEP_RESP"

# 响应直接是对象，有 .id 字段
STEP_ID=$(echo "$STEP_RESP" | jq -r '.id // empty')
if [ -z "$STEP_ID" ]; then
  echo "ERROR: 未能获取 step_id，响应: $STEP_RESP"
  exit 1
fi
echo "step_id: $STEP_ID"

echo "=== FR-1: 写入 artifact-verification 能力格子 ==="
RESP=$(curl -fsS -m 15 -X POST "$BRAIN/api/brain/journey_step_links" \
  -H "Content-Type: application/json" \
  -d "{\"journey_id\":\"$JOURNEY_ID\",\"step_id\":\"$STEP_ID\",\"cell_kind\":\"capability\",\"cell_key\":\"artifact-verification-capability\",\"cell_status\":\"gray\",\"assertion_ref\":\"PR #4457 分散实现、无独立模块审计记录\"}")
echo "artifact-verification 格子: $RESP"

echo "=== FR-2: 写入 A2-0 合同维度 4 个格子 ==="

# a20-schema（capability）
RESP=$(curl -fsS -m 15 -X POST "$BRAIN/api/brain/journey_step_links" \
  -H "Content-Type: application/json" \
  -d "{\"journey_id\":\"$JOURNEY_ID\",\"step_id\":\"$STEP_ID\",\"cell_kind\":\"capability\",\"cell_key\":\"a20-schema\",\"cell_status\":\"gray\",\"assertion_ref\":\"regression-contract.yaml schema_valid=true\"}")
echo "a20-schema 格子: $RESP"

# a20-proof（element）
RESP=$(curl -fsS -m 15 -X POST "$BRAIN/api/brain/journey_step_links" \
  -H "Content-Type: application/json" \
  -d "{\"journey_id\":\"$JOURNEY_ID\",\"step_id\":\"$STEP_ID\",\"cell_kind\":\"element\",\"cell_key\":\"a20-proof\",\"cell_status\":\"gray\",\"assertion_ref\":\"proof_complete=false，0/99 已证明\"}")
echo "a20-proof 格子: $RESP"

# a20-cutover-gate（element）
RESP=$(curl -fsS -m 15 -X POST "$BRAIN/api/brain/journey_step_links" \
  -H "Content-Type: application/json" \
  -d "{\"journey_id\":\"$JOURNEY_ID\",\"step_id\":\"$STEP_ID\",\"cell_kind\":\"element\",\"cell_key\":\"a20-cutover-gate\",\"cell_status\":\"gray\",\"assertion_ref\":\"atomic_cutover_ready=false，manual gate exits 1\"}")
echo "a20-cutover-gate 格子: $RESP"

# a20-draft-blockers（scenario）
RESP=$(curl -fsS -m 15 -X POST "$BRAIN/api/brain/journey_step_links" \
  -H "Content-Type: application/json" \
  -d "{\"journey_id\":\"$JOURNEY_ID\",\"step_id\":\"$STEP_ID\",\"cell_kind\":\"scenario\",\"cell_key\":\"a20-draft-blockers\",\"cell_status\":\"gray\",\"assertion_ref\":\"4 堵点（rebase/测试失败/QuickCheck/receipt v2）均处于 open\"}")
echo "a20-draft-blockers 格子: $RESP"

echo ""
echo "=== 写入完成，step_id=$STEP_ID ==="
