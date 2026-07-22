#!/usr/bin/env bash
# harness-shared-skill-search-smoke.sh
# 验证 harness-shared.js 使用仓库冻结 Skill bundle：
# - 禁止回退 ~/.claude* 账号目录（防跨账号/跨机器漂移）
# - 默认根为 packages/workflows/skills/
# - loadSkillContent 兼容接口委托给 loadRepositorySkillContent
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
BRAIN_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
HARNESS_SHARED="$BRAIN_ROOT/src/harness-shared.js"
SKILL_BUNDLE="$BRAIN_ROOT/src/orchestrator/skill-bundle.js"

echo "=== harness-shared repository skill bundle smoke ==="

# Case 1: 运行时不再读取账号目录
if grep -q "\.claude-account\|\.claude/skills" "$SKILL_BUNDLE"; then
  echo "FAIL Case 1: skill-bundle.js 仍读取 .claude 账号目录"
  exit 1
fi
echo "[smoke] PASS Case 1: 无 .claude 账号目录回退"

# Case 2: 默认读取仓库冻结快照
if ! grep -q "workflows.*skills" "$SKILL_BUNDLE"; then
  echo "FAIL Case 2: skill-bundle.js 缺少 workflows/skills 仓库路径"
  exit 1
fi
echo "[smoke] PASS Case 2: workflows/skills 仓库路径存在"

# Case 3: loadSkillContent 函数仍然 export（接口未断）
if ! grep -q "export function loadSkillContent" "$HARNESS_SHARED"; then
  echo "FAIL Case 3: loadSkillContent 不再 export"
  exit 1
fi
echo "[smoke] PASS Case 3: loadSkillContent 接口完整"

# Case 4: 兼容接口委托给仓库 bundle loader
if ! grep -q "return loadRepositorySkillContent(skillName)" "$HARNESS_SHARED"; then
  echo "FAIL Case 4: loadSkillContent 未委托给仓库 bundle loader"
  exit 1
fi
echo "[smoke] PASS Case 4: 兼容接口接线正确"

echo "✅ harness-shared-skill-search smoke PASS (4/4 cases)"
