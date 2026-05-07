#!/usr/bin/env bash
# harness-task-plan-smoke.sh — 验证 harness_initiative pipeline task-plan.json 链路
# 端到端：构造 git fixture（裸仓 + worktree） → mock proposer push task-plan.json
#        → 调 inferTaskPlanNode → 验 tasks.length >= 1
#        → 反向：删文件 → 验返回 { error: ... }
# 不依赖 LLM，纯 JS 函数调用 + git fixture

set -euo pipefail

echo "❌ smoke 骨架：还未实现"
exit 1
