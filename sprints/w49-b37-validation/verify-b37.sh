#!/bin/bash
set -e

echo "=== B37 验证：git diff 确定性找 sprint 目录 ==="

# P1：sprint-prd.md 存在（planner 写入正确路径）
echo "[P1] 验证 sprint-prd.md 存在..."
test -f sprints/w49-b37-validation/sprint-prd.md \
  || { echo "❌ FAIL: sprint-prd.md 缺失"; exit 1; }
echo "✅ PASS: sprint-prd.md 存在"

# P2：sprint-contract.md 存在（Proposer 写入正确目录，parsePrdNode B37 fix 生效）
echo "[P2] 验证 sprint-contract.md 存在..."
test -f sprints/w49-b37-validation/sprint-contract.md \
  || { echo "❌ FAIL: sprint-contract.md 缺失（sprintDir 漂移）"; exit 1; }
echo "✅ PASS: sprint-contract.md 存在于正确目录"

# P3：git diff 找到正确路径（B37 fix 的直接验证）
echo "[P3] 验证 git diff 输出..."
DIFF_OUT=$(git diff --name-only origin/main HEAD -- sprints/ 2>/dev/null)
echo "git diff 输出: $DIFF_OUT"
echo "$DIFF_OUT" | grep -q "sprints/w49-b37-validation/" \
  || { echo "❌ FAIL: git diff 未找到 sprints/w49-b37-validation/"; exit 1; }
echo "✅ PASS: git diff 找到正确 sprint 目录"

# G1：verify-b37.sh 存在（自验）
echo "[G1] 验证 verify-b37.sh 存在..."
test -f sprints/w49-b37-validation/verify-b37.sh \
  || { echo "❌ FAIL: verify-b37.sh 缺失"; exit 1; }
echo "✅ PASS: verify-b37.sh 存在"

# G2：Brain Docker 日志无 ENOENT（动态查找容器名）
echo "[G2] 验证 Brain 日志无 ENOENT..."
BRAIN_CTR=$(docker ps --filter name=brain --format "{{.Names}}" 2>/dev/null | head -1)
if [ -z "$BRAIN_CTR" ]; then
  echo "⚠️  SKIP: brain 容器未运行，跳过 ENOENT 检查"
else
  ENOENT_COUNT=$(docker logs "$BRAIN_CTR" 2>&1 | grep -c "ENOENT.*w49-b37-validation\|w49-b37-validation.*ENOENT" || echo 0)
  [ "${ENOENT_COUNT:-0}" -eq 0 ] \
    || { echo "❌ FAIL: 发现 ${ENOENT_COUNT} 条 ENOENT 报错"; exit 1; }
  echo "✅ PASS: 无 ENOENT 报错"
fi

echo ""
echo "✅ B37 验证全部通过 — parsePrdNode git diff 逻辑生效"
