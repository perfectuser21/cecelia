#!/usr/bin/env bash
# SessionStart Hook - 会话开始时引导 /dev
# 提示用户使用 /dev 工作流

# L2 修复: 条件输出 - 只在交互式会话中显示提示
# 检查是否是交互式终端或 Claude Code 会话
if [[ -t 2 ]] || [[ -n "${CLAUDE_CODE:-}" ]]; then
    echo "[SKILL_REQUIRED: dev]" >&2
    echo "请运行 /dev skill 开始开发流程。/dev 会自动检测状态并引导你。" >&2
fi

exit 0
