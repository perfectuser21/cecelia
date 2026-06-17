#!/usr/bin/env bash
# harness-step-context-smoke — 验证 buildLangGraphInfo 步骤上下文富化字段（CI-safe 静态检查）
set -euo pipefail

ROUTES_FILE="packages/brain/src/routes/harness.js"

echo "[harness-step-context-smoke] 检查路由文件存在..."
[ -f "$ROUTES_FILE" ] || { echo "FAIL: $ROUTES_FILE not found"; exit 1; }

echo "[harness-step-context-smoke] 检查 NODE_TO_SKILL 常量..."
grep -q "NODE_TO_SKILL" "$ROUTES_FILE" || { echo "FAIL: NODE_TO_SKILL 常量缺失"; exit 1; }

echo "[harness-step-context-smoke] 检查 NODE_SYSTEM_PROMPTS 常量..."
grep -q "NODE_SYSTEM_PROMPTS" "$ROUTES_FILE" || { echo "FAIL: NODE_SYSTEM_PROMPTS 常量缺失"; exit 1; }

echo "[harness-step-context-smoke] 检查 readSkillFile 辅助函数..."
grep -q "readSkillFile" "$ROUTES_FILE" || { echo "FAIL: readSkillFile 函数缺失"; exit 1; }

echo "[harness-step-context-smoke] 检查 readSprintFile 辅助函数..."
grep -q "readSprintFile" "$ROUTES_FILE" || { echo "FAIL: readSprintFile 函数缺失"; exit 1; }

echo "[harness-step-context-smoke] 检查 step 富化字段 skill_name..."
grep -q "skill_name:" "$ROUTES_FILE" || { echo "FAIL: skill_name 字段缺失"; exit 1; }

echo "[harness-step-context-smoke] 检查 step 富化字段 system_prompt..."
grep -q "system_prompt:" "$ROUTES_FILE" || { echo "FAIL: system_prompt 字段缺失"; exit 1; }

echo "[harness-step-context-smoke] 检查 step 富化字段 db_context..."
grep -q "db_context:" "$ROUTES_FILE" || { echo "FAIL: db_context 字段缺失"; exit 1; }

echo "[harness-step-context-smoke] 检查 events.map 已改为 async Promise.all..."
grep -q "Promise.all(events.map" "$ROUTES_FILE" || { echo "FAIL: events.map 未改为 async Promise.all"; exit 1; }

echo "[harness-step-context-smoke] ALL CHECKS PASSED"
exit 0
