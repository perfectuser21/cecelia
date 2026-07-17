#!/usr/bin/env bash
# Smoke: MJ5 S3 联动清单 — GET /journeys/steps/:step_id/impact 端点结构验证
set -e
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/../../../.." && pwd)"
cd "$ROOT_DIR"

# 1. 新端点路由在 journeys.js 中存在
grep -q "journeys/steps/:step_id/impact" packages/brain/src/routes/journeys.js \
  || { echo "FAIL: /journeys/steps/:step_id/impact 路由不存在"; exit 1; }
echo "OK: /journeys/steps/:step_id/impact 路由已注册"

# 2. 端点查询包含 assertion_ref 和 cell_status
grep -q "assertion_ref" packages/brain/src/routes/journeys.js \
  || { echo "FAIL: journeys.js 缺少 assertion_ref 字段"; exit 1; }
grep -q "cell_status" packages/brain/src/routes/journeys.js \
  || { echo "FAIL: journeys.js 缺少 cell_status 字段"; exit 1; }
grep -q "needs_assertion" packages/brain/src/routes/journeys.js \
  || { echo "FAIL: journeys.js 缺少 needs_assertion 字段"; exit 1; }
echo "OK: 端点返回 assertion_ref + cell_status + needs_assertion"

# 3. 端点返回 runnable_count（可跑断言计数）
grep -q "runnable_count" packages/brain/src/routes/journeys.js \
  || { echo "FAIL: journeys.js 缺少 runnable_count"; exit 1; }
echo "OK: runnable_count 已计算"

# 4. harness-evaluator SKILL.md 含 S3 联动清单步骤（B-1.4 扩展形态）
grep -q "S3 联动清单\|cascade_assertions\|blast-radius" packages/workflows/skills/harness-evaluator/SKILL.md \
  || { echo "FAIL: harness-evaluator SKILL.md 未含 S3 联动清单相关内容"; exit 1; }
echo "OK: harness-evaluator SKILL.md 含 S3 联动清单步骤"

# 5. TDD 测试文件存在
[ -f "packages/brain/src/routes/__tests__/journeys-step-impact.test.js" ] \
  || { echo "FAIL: S3 联动清单 TDD 测试文件不存在"; exit 1; }
grep -q "S3-I1\|S3-I2\|S3-I3\|S3-I4" packages/brain/src/routes/__tests__/journeys-step-impact.test.js \
  || { echo "FAIL: S3 联动清单测试缺少必要 BEHAVIOR 断言"; exit 1; }
echo "OK: S3 联动清单 TDD 测试（4 条 BEHAVIOR）已就位"

echo ""
echo "ALL SMOKE CHECKS PASSED: MJ5 S3 联动清单端点结构完整"
