#!/usr/bin/env bash
# check-single-exit.sh — Stop Hook 单一出口守护
# 永远阻止散点 exit 0 / return 0 复活。
# 触发：CI lint job 调用；本地 push 前可手动跑。

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

ERR=0

check_count() {
    local file="$1" pattern="$2" expected="$3" label="$4"
    if [[ ! -f "$file" ]]; then
        echo "❌ $label: 文件不存在 $file"
        ERR=1
        return
    fi
    # 注释行剔除（# 之后的内容），再 grep
    local count
    count=$(sed 's/#.*//' "$file" | grep -cE "$pattern" || true)
    count="${count:-0}"
    if [[ "${count}" -ne "${expected}" ]]; then
        echo "❌ ${label}: '${pattern}' 出现 ${count} 次（期望 ${expected}）— ${file}"
        ERR=1
    else
        echo "✅ ${label}: ${count} / ${expected}"
    fi
}

# Ralph Loop 模式（v21.0.0+）协议：
#   - stop-dev.sh：全部 exit 0（多个早退路径合法），用 stdout decision:block JSON 表 block
#   - 禁止 exit 2 / exit 99（旧 v20.1.0 三态出口码已废弃）
#   - 必须读 .cecelia/dev-active-*.json + 调 verify_dev_complete
#
# 注：hooks/ 是 symlink → packages/engine/hooks/，物理同一文件
check_count "$REPO_ROOT/packages/engine/hooks/stop-dev.sh" '\bexit 2\b' 0 "stop-dev.sh exit 2 (Ralph 禁用)"
check_count "$REPO_ROOT/packages/engine/hooks/stop-dev.sh" '\bexit 99\b' 0 "stop-dev.sh exit 99 (Ralph 禁用)"
check_count "$REPO_ROOT/hooks/stop-dev.sh" '\bexit 2\b' 0 "hooks/stop-dev.sh exit 2 (Ralph 禁用)"
check_count "$REPO_ROOT/hooks/stop-dev.sh" '\bexit 99\b' 0 "hooks/stop-dev.sh exit 99 (Ralph 禁用)"

# devloop-check.sh：classify_session + devloop_check + verify_dev_complete + log_hook_decision = 4 函数末尾各 1 return 0
# log_hook_decision 由 stop-hook-v23 PR-1 引入（结构化决策日志）
check_count "$REPO_ROOT/packages/engine/lib/devloop-check.sh" '\breturn 0\b' 4 "devloop-check.sh return 0 (4 函数 × 1)"
# 旧 not-dev return 99 保留兼容（classify_session 末尾）
check_count "$REPO_ROOT/packages/engine/lib/devloop-check.sh" '\breturn 99\b' 1 "devloop-check.sh return 99 (classify_session 兼容)"

# stop-dev.sh 必须调 verify_dev_complete（Ralph 模式核心）
if ! grep -q "verify_dev_complete" "$REPO_ROOT/packages/engine/hooks/stop-dev.sh"; then
    echo "❌ stop-dev.sh 必须调用 verify_dev_complete（Ralph 模式核心）"
    ERR=1
else
    echo "✅ stop-dev.sh 调用 verify_dev_complete"
fi

# stop-dev.sh 必须读 .cecelia 状态文件（Ralph 信号源）
if ! grep -q "\.cecelia" "$REPO_ROOT/packages/engine/hooks/stop-dev.sh"; then
    echo "❌ stop-dev.sh 必须读 .cecelia/dev-active-*.json（Ralph 信号源）"
    ERR=1
else
    echo "✅ stop-dev.sh 读 .cecelia/dev-active-*.json"
fi

if [[ "$ERR" -eq 0 ]]; then
    echo ""
    echo "✅ 单一出口检查通过"
    exit 0
fi

echo ""
echo "❌ 单一出口检查失败 — 散点 exit 0 / return 0 复活，禁止合并"
exit 1
