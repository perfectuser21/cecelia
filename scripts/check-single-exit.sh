#!/usr/bin/env bash
# check-single-exit.sh — Stop Hook 架构守护
# v25.0.0 (goal-based hook era): 验证旧心跳文件已删除 + 新 goal-based 注入链存在。
# 触发：CI lint job 调用；本地 push 前可手动跑。

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

ERR=0

check_deleted() {
    local file="$1" label="$2"
    if [[ -f "$file" ]]; then
        echo "❌ $label: 文件应已删除但仍存在 $file"
        ERR=1
    else
        echo "✅ $label: 已删除 ✓"
    fi
}

check_contains() {
    local file="$1" pattern="$2" label="$3"
    if [[ ! -f "$file" ]]; then
        echo "❌ $label: 文件不存在 $file"
        ERR=1
        return
    fi
    if ! grep -qE "$pattern" "$file"; then
        echo "❌ $label: 未找到 '$pattern' in $file"
        ERR=1
    else
        echo "✅ $label ✓"
    fi
}

# v25.0.0 goal-based hook 架构验证：
#   旧心跳体系（stop-dev.sh / devloop-check.sh / guardian / ship-finalize）已全部删除。
#   新体系：executor.js buildGoalSettings → CECELIA_GOAL_SETTINGS → cecelia-run.sh --settings
#
#   例外：dev-heartbeat-guardian.sh 在 Stop Hook v23 PR-2（dd60f635c，心跳模型核心
#   切换）里被重新引入，worktree-manage.sh 的 cmd_create 从那次起持续调用它做
#   .cecelia/lights/*.live 心跳续期——同名但语义完全不同于此处检查的 v22 时代旧
#   guardian（那个是给 stop hook 判断用的，已被 goal-based hook 取代）。此前该
#   文件本身一直缺失（每次建 worktree 都打印"不存在，跳过心跳启动"），07-19
#   zombie-cleaner 修复里补齐了这个功能缺口，本条 check_deleted 因此移除。

# 旧文件必须不存在
check_deleted "$REPO_ROOT/packages/engine/hooks/stop-dev.sh"    "stop-dev.sh 已删除（goal-based hook 替代）"
check_deleted "$REPO_ROOT/hooks/stop-dev.sh"                    "hooks/stop-dev.sh 已删除"
check_deleted "$REPO_ROOT/packages/engine/lib/devloop-check.sh" "devloop-check.sh 已删除（goal-based hook 替代）"
check_deleted "$REPO_ROOT/packages/engine/scripts/ship-finalize.sh"      "ship-finalize.sh 已删除"

# 新链必须存在且包含关键标识
check_contains "$REPO_ROOT/packages/brain/src/executor.js" \
    "buildGoalSettings" \
    "executor.js 含 buildGoalSettings"

check_contains "$REPO_ROOT/packages/brain/src/executor.js" \
    "CECELIA_GOAL_SETTINGS" \
    "executor.js 注入 CECELIA_GOAL_SETTINGS"

check_contains "$REPO_ROOT/packages/brain/scripts/cecelia-run.sh" \
    "CECELIA_GOAL_SETTINGS" \
    "cecelia-run.sh 读取 CECELIA_GOAL_SETTINGS"

check_contains "$REPO_ROOT/packages/brain/scripts/cecelia-run.sh" \
    "\-\-settings" \
    "cecelia-run.sh 有 --settings 标志"

if [[ "$ERR" -eq 0 ]]; then
    echo ""
    echo "✅ Stop Hook 架构检查通过（v25.0.0 goal-based hook 体系）"
    exit 0
fi

echo ""
echo "❌ Stop Hook 架构检查失败"
exit 1
