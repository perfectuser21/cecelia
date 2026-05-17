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

# v23 心跳模型协议（v23.1.0+）：
#   - stop-dev.sh 单一出口：禁 exit 2 / exit 99，仅一个 exit 0
#   - 必须读 .cecelia/lights/ + 用 stat mtime 判定灯新鲜度
#
# 注：hooks/ 是 symlink → packages/engine/hooks/，物理同一文件
check_count "$REPO_ROOT/packages/engine/hooks/stop-dev.sh" '\bexit 2\b' 0 "stop-dev.sh exit 2 (Ralph 禁用)"
check_count "$REPO_ROOT/packages/engine/hooks/stop-dev.sh" '\bexit 99\b' 0 "stop-dev.sh exit 99 (Ralph 禁用)"
check_count "$REPO_ROOT/hooks/stop-dev.sh" '\bexit 2\b' 0 "hooks/stop-dev.sh exit 2 (Ralph 禁用)"
check_count "$REPO_ROOT/hooks/stop-dev.sh" '\bexit 99\b' 0 "hooks/stop-dev.sh exit 99 (Ralph 禁用)"

# v23.1: 单一出口纪律 — stop-dev.sh 必须只有 1 个 'exit 0'
exit0_count=$(sed 's/#.*//' "$REPO_ROOT/packages/engine/hooks/stop-dev.sh" | grep -cE '\bexit\s+0\b' || true)
exit0_count="${exit0_count:-0}"
if [[ "$exit0_count" -ne 1 ]]; then
    echo "❌ stop-dev.sh exit 0 纪律: 出现 ${exit0_count} 次（期望 1）— 单一出口违反"
    ERR=1
else
    echo "✅ stop-dev.sh exit 0 纪律: ${exit0_count} / 1（单一出口）"
fi

# devloop-check.sh：classify_session + devloop_check + log_hook_decision = 3 函数末尾各 1 return 0
# v23 PR-3 起 verify_dev_complete 已删（hook 切心跳模型不再需要）
check_count "$REPO_ROOT/packages/engine/lib/devloop-check.sh" '\breturn 0\b' 3 "devloop-check.sh return 0 (3 函数 × 1)"
# 旧 not-dev return 99 保留兼容（classify_session 末尾）
check_count "$REPO_ROOT/packages/engine/lib/devloop-check.sh" '\breturn 99\b' 1 "devloop-check.sh return 99 (classify_session 兼容)"

# v23: stop-dev.sh 必须读 .cecelia/lights/（心跳模型核心）
if ! grep -q "\.cecelia/lights" "$REPO_ROOT/packages/engine/hooks/stop-dev.sh"; then
    echo "❌ stop-dev.sh 必须读 .cecelia/lights/（v23 心跳模型核心）"
    ERR=1
else
    echo "✅ stop-dev.sh 读 .cecelia/lights/"
fi

# v23: stop-dev.sh 必须用 mtime 判定（不再调 verify_dev_complete）
if ! grep -qE "stat -[fc] %[mY]" "$REPO_ROOT/packages/engine/hooks/stop-dev.sh"; then
    echo "❌ stop-dev.sh 必须用 stat mtime 判定灯新鲜度"
    ERR=1
else
    echo "✅ stop-dev.sh 使用 stat mtime"
fi

if [[ "$ERR" -eq 0 ]]; then
    echo ""
    echo "✅ 单一出口检查通过"
    exit 0
fi

echo ""
echo "❌ 单一出口检查失败 — 散点 exit 0 / return 0 复活，禁止合并"
exit 1
