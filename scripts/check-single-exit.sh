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

# stop-dev.sh：唯一 1 个 exit 0
# 注：hooks/ 是 symlink → packages/engine/hooks/，物理上同一文件，但分别校验防 symlink 失效
check_count "$REPO_ROOT/packages/engine/hooks/stop-dev.sh" '\bexit 0\b' 1 "packages/engine/hooks/stop-dev.sh exit 0"
check_count "$REPO_ROOT/hooks/stop-dev.sh" '\bexit 0\b' 1 "hooks/stop-dev.sh exit 0"

# devloop-check.sh：classify_session 1 个 + devloop_check 1 个 = 共 2 个 return 0
# 辅助函数 _mark_cleanup_done / _increment_and_check_ci_counter 已改为 return（无参数）
check_count "$REPO_ROOT/packages/engine/lib/devloop-check.sh" '\breturn 0\b' 2 "packages/engine/lib/devloop-check.sh return 0"

if [[ "$ERR" -eq 0 ]]; then
    echo ""
    echo "✅ 单一出口检查通过"
    exit 0
fi

echo ""
echo "❌ 单一出口检查失败 — 散点 exit 0 / return 0 复活，禁止合并"
exit 1
