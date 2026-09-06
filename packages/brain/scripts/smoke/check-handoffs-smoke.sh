#!/usr/bin/env bash
# Smoke: check-handoffs.mjs 契约 schema 化机械校验器（第 82 批）
# 纯离线 CLI 校验器（无 Brain/DB 依赖），用真实 CLI + 冻结 fixture 断言五类退出码与输出。
set -e
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/../../../.." && pwd)"
cd "$ROOT_DIR"

CHK="packages/brain/src/orchestrator/check-handoffs.mjs"
FIX="sprints/09052200-kernel-b6faa20c/tests/fixtures"

[ -f "$CHK" ] || { echo "FAIL: check-handoffs.mjs 不存在"; exit 1; }

# 1. --cells 子命令：覆盖 coding 九格 + leadgen 八格共 17 格
node "$CHK" --cells | grep -q "coding=9 leadgen=8 total=17" \
  || { echo "FAIL: --cells 未输出 coding=9 leadgen=8 total=17"; exit 1; }
echo "OK: --cells 17 格覆盖"

# 2. evaluate 合规 fixture → 纯类目断言全 PASS，ok=true exit 0
node "$CHK" evaluate "$FIX/evaluate-compliant.json" | grep -q "cell=evaluate ok=true" \
  || { echo "FAIL: evaluate 合规未 ok=true"; exit 1; }
echo "OK: evaluate 合规 ok=true"

# 3. 缺 source_attempt_id → artifact_compliance FAIL 并点名字段（exit 1）
node "$CHK" generate "$FIX/candidate-missing-source.json" | grep -q source_attempt_id \
  || { echo "FAIL: 缺字段未点名 source_attempt_id"; exit 1; }
echo "OK: 缺字段点名 source_attempt_id"

# 4. record_persisted 无 resolver → UNDECIDABLE 不静默 PASS（忽略 handoff 自报 db_count）
node "$CHK" generate "$FIX/candidate-forged-dbcount.json" | grep -q UNDECIDABLE \
  || { echo "FAIL: 无 resolver 未 UNDECIDABLE"; exit 1; }
echo "OK: 无 resolver 判 UNDECIDABLE"

# 5. 未知格标识 → 显式 unknown_cell（exit 2），绝不静默 PASS
UNKNOWN_OUT="$(node "$CHK" bogus_cell "$FIX/candidate-compliant.json" || true)"
echo "$UNKNOWN_OUT" | grep -q unknown_cell \
  || { echo "FAIL: 未知格未显式报 unknown_cell"; exit 1; }
echo "$UNKNOWN_OUT" | grep -q '"ok":true' \
  && { echo "FAIL: 未知格静默 PASS（出现 ok:true）"; exit 1; }
echo "OK: 未知格显式 unknown_cell 不静默 PASS"

echo "✅ check-handoffs smoke 全过"
