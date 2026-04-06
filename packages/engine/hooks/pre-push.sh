#!/usr/bin/env bash
# pre-push.sh — git pre-push hook 入口 v1.0.0
#
# 职责：调用 scripts/quickcheck.sh 在 push 前完成本地快速检查
#
# 接入方式：
#   此脚本由 Claude Code settings.json 中的 PrePush hook 直接引用，
#   也可作为 git pre-push hook 手动 symlink：
#   ln -sf "$(pwd)/packages/engine/hooks/pre-push.sh" .git/hooks/pre-push
#
# 支持 --skip 环境变量跳过：
#   QUICKCHECK_SKIP=1 git push ...
#
# 退出码：0 = 允许 push，1 = 阻止 push

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
QUICKCHECK_SCRIPT="$PROJECT_ROOT/scripts/quickcheck.sh"

# ─── 跳过检查（紧急模式）────────────────────────────────────────
if [[ "${QUICKCHECK_SKIP:-0}" == "1" ]]; then
    echo "" >&2
    echo "⚠️  [QUICKCHECK SKIP] 环境变量 QUICKCHECK_SKIP=1，已跳过本地预检" >&2
    echo "   警告：此举会让代码质量问题流入 CI" >&2
    echo "" >&2
    exit 0
fi

# ─── 检查脚本存在 ────────────────────────────────────────────────
if [[ ! -f "$QUICKCHECK_SCRIPT" ]]; then
    echo "" >&2
    echo "⚠️  [pre-push] 未找到 scripts/quickcheck.sh，跳过本地预检" >&2
    echo "   路径：$QUICKCHECK_SCRIPT" >&2
    echo "" >&2
    exit 0
fi

# ─── 运行 quickcheck ─────────────────────────────────────────────
bash "$QUICKCHECK_SCRIPT" "${@}"
EXIT_CODE=$?

if [[ $EXIT_CODE -ne 0 ]]; then
    echo "" >&2
    echo "❌ [pre-push] QuickCheck 失败，push 已阻止" >&2
    echo "   紧急跳过：QUICKCHECK_SKIP=1 git push ..." >&2
    echo "" >&2
    exit 1
fi

exit 0
