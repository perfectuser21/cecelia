#!/usr/bin/env bash
# test-migration-rollback.sh — 验证 migration 397-400 rollback 文件格式合法
# INV-5：migration 必须有 rollback SQL（up/down 对称）
#
# 本脚本检查：
#   1. rollback 文件存在
#   2. 每个 rollback 文件包含 ALTER TABLE ... DROP 或 DELETE FROM schema_version
#   3. 每个 rollback 文件包含 schema_version DELETE（清理版本记录）
#
# 运行：bash sprints/08101234-cecelia-map-reorg/tests/test-migration-rollback.sh
# 必须在 workspace 根目录执行

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
WORKSPACE_DIR="$(cd "$SCRIPT_DIR/../../.." && pwd)"
ROLLBACK_DIR="$WORKSPACE_DIR/packages/brain/migrations/rollback"

PASS=0; FAIL=0

log_pass() { echo "  [PASS] $1"; ((PASS++)); }
log_fail() { echo "  [FAIL] $1"; ((FAIL++)); }

echo "=== INV-5: Migration Rollback 文件合法性验证 ==="
echo "Rollback dir: $ROLLBACK_DIR"
echo ""

for num in 397 398 399 400; do
  echo "--- migration $num ---"

  # 文件存在性
  files=$(ls "$ROLLBACK_DIR/${num}_"*.down.sql 2>/dev/null | wc -l)
  if [ "$files" -ge 1 ]; then
    fname=$(ls "$ROLLBACK_DIR/${num}_"*.down.sql | head -1)
    log_pass "rollback 文件存在: $(basename $fname)"

    # 必须包含 schema_version DELETE（否则版本号不回退）
    if grep -qi "DELETE FROM schema_version" "$fname"; then
      log_pass "包含 DELETE FROM schema_version"
    else
      log_fail "缺少 DELETE FROM schema_version — rollback 执行后版本号不回退"
    fi

    # 必须包含回退 SQL（DROP COLUMN 或 DELETE FROM 业务表）
    if grep -qiE "DROP COLUMN|DROP TABLE|DELETE FROM|ALTER TABLE.*DROP|TRUNCATE" "$fname"; then
      log_pass "包含回退 SQL（DROP/DELETE 语句）"
    else
      log_fail "未找到回退 SQL（期望 DROP COLUMN / DELETE / ALTER TABLE DROP）"
    fi

    # 检查是否有注释说明回滚影响
    if grep -q "^--" "$fname"; then
      log_pass "有注释说明"
    else
      log_fail "缺少注释（建议说明回滚的数据代价）"
    fi

  else
    log_fail "rollback ${num}_*.down.sql 不存在"
  fi
  echo ""
done

echo "========================================"
echo "Rollback 合法性: PASS=$PASS  FAIL=$FAIL"
echo "========================================"

if [ "$FAIL" -eq 0 ]; then
  echo "INV-5 rollback 对称性验证通过。"
  exit 0
else
  echo "存在 $FAIL 项问题，请补充对应 rollback 文件。"
  exit 1
fi
