#!/usr/bin/env bash
# check-bypass-not-committed.sh — Stop Hook BYPASS 反 AI 滥用 layer 1
# 扫所有 committed 文件，禁止非豁免位置出现 'CECELIA_STOP_HOOK_BYPASS=1'
#
# 豁免清单：
#   - packages/engine/hooks/stop-dev.sh         （hook 源文件，合法引用）
#   - packages/engine/tests/**/*bypass*.{ts,sh} （测试用）
#   - docs/**                                   （设计文档引用）
#   - scripts/check-bypass-not-committed.sh     （本脚本自身）
#
# CI: lint-bypass-not-committed job 调用
# 本地：bash scripts/check-bypass-not-committed.sh

set -uo pipefail

REPO_ROOT="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
cd "$REPO_ROOT" || { echo "[lint] cannot cd to repo root" >&2; exit 1; }

# 模式：真实 shell 赋值（行首或 export 后），排除字符串里的引用
# 命中：
#   export CECELIA_STOP_HOOK_BYPASS=1
#   CECELIA_STOP_HOOK_BYPASS=1 some_command
# 不命中：
#   description: "... CECELIA_STOP_HOOK_BYPASS=1 ..." （YAML 字符串）
#   '... bypass via CECELIA_STOP_HOOK_BYPASS=1' （单引号字符串）
PATTERN='(^|;|&&|\|\|)[[:space:]]*(export[[:space:]]+)?CECELIA_STOP_HOOK_BYPASS=1\b'

# 豁免 path 模式（fnmatch 风格）
is_exempt() {
    local f="$1"
    case "$f" in
        packages/engine/hooks/stop-dev.sh) return 0 ;;       # hook 源（合法 env 检查）
        packages/engine/lib/devloop-check.sh) return 0 ;;    # legacy classify_session 在错误消息字符串里引用
        packages/engine/tests/*) return 0 ;;                  # 所有测试
        docs/*) return 0 ;;                                   # 设计文档
        scripts/check-bypass-not-committed.sh) return 0 ;;   # 本脚本自身
        *) return 1 ;;
    esac
}

violations=()
while IFS= read -r f; do
    [[ -f "$f" ]] || continue
    if grep -qE "${PATTERN}" "$f" 2>/dev/null; then
        if ! is_exempt "$f"; then
            violations+=("$f")
        fi
    fi
done < <(git ls-files 2>/dev/null)

if (( ${#violations[@]} > 0 )); then
    echo "❌ 发现非豁免文件含 ${PATTERN}：" >&2
    for v in "${violations[@]}"; do
        echo "  - $v" >&2
        grep -nE "${PATTERN}" "$v" 2>/dev/null | head -3 | sed 's/^/    /' >&2
    done
    echo "" >&2
    echo "BYPASS 是 stop hook 的逃生通道。任何 committed 文件含此 env 设置 = AI 攻击面或人工失误。" >&2
    echo "如果是测试 / 文档合法引用，把文件加到本脚本 is_exempt 函数。" >&2
    exit 1
fi

echo "✅ check-bypass-not-committed: 0 个非豁免位置含 ${PATTERN}（pass）"
exit 0
