#!/usr/bin/env bash
# harness-shared-skill-search-smoke.sh
# 验证 harness-shared.js SKILL_SEARCH_DIRS 结构正确：
# - 主路径: ~/.claude*/skills（生产/本地）
# - CI fallback: packages/workflows/skills/（已同步的 SKILL 快照）
# 对应 PR: skill repo 解耦 — harness-shared.js SKILL_SEARCH_DIRS 清理
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
BRAIN_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
HARNESS_SHARED="$BRAIN_ROOT/src/harness-shared.js"

echo "=== harness-shared SKILL_SEARCH_DIRS smoke ==="

# Case 1: SKILL_SEARCH_DIRS 包含 ~/.claude 主搜索路径
if ! grep -q "\.claude-account1\|\.claude'" "$HARNESS_SHARED"; then
  echo "FAIL Case 1: harness-shared.js 缺少 .claude 主搜索路径"
  exit 1
fi
echo "[smoke] PASS Case 1: .claude 主搜索路径存在"

# Case 2: SKILL_SEARCH_DIRS 包含 workflows/skills CI fallback
if ! grep -q "workflows.*skills" "$HARNESS_SHARED"; then
  echo "FAIL Case 2: harness-shared.js 缺少 workflows/skills CI fallback 路径"
  exit 1
fi
echo "[smoke] PASS Case 2: workflows/skills CI fallback 路径存在"

# Case 3: loadSkillContent 函数仍然 export（接口未断）
if ! grep -q "export function loadSkillContent" "$HARNESS_SHARED"; then
  echo "FAIL Case 3: loadSkillContent 不再 export"
  exit 1
fi
echo "[smoke] PASS Case 3: loadSkillContent 接口完整"

echo "✅ harness-shared-skill-search smoke PASS (3/3 cases)"
