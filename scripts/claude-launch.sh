#!/usr/bin/env bash
# Cecelia 统一 claude 启动器
# 保证 headless / interactive / parallel 所有 claude 实例都有 --session-id + export 到子进程
# 用法：
#   直接用:     bash scripts/claude-launch.sh [-p PROMPT] [其他 claude 参数]
#   交互 alias:  alias claude='bash /absolute/path/to/scripts/claude-launch.sh'
#   headless:   CLAUDE_SESSION_ID=<uuid> bash scripts/claude-launch.sh -p "..."
#   dry-run:    bash scripts/claude-launch.sh --dry-run  → echo 最终命令行后 exit 0
set -euo pipefail

SID="${CLAUDE_SESSION_ID:-$(uuidgen | tr '[:upper:]' '[:lower:]')}"
export CLAUDE_SESSION_ID="$SID"

# --dry-run 选项：解析参数，提取 --dry-run 标志
DRY_RUN=0
ARGS=()
for arg in "$@"; do
    if [[ "$arg" == "--dry-run" ]]; then
        DRY_RUN=1
    else
        ARGS+=("$arg")
    fi
done

# --dry-run 优先：CI / 测试环境无真 claude binary 也要能跑契约测试
# 输出格式与正常 exec 一致，含 --session-id <uuid>
if [[ "$DRY_RUN" == "1" ]]; then
    _CLAUDE_BIN="${CLAUDE_CODE_EXECPATH:-$(command -v claude 2>/dev/null || echo claude)}"
    echo "$_CLAUDE_BIN --session-id $SID ${ARGS[@]+${ARGS[@]}}"
    exit 0
fi

# Phase 7.6: 用绝对路径/command 跳过 shell function + alias，避免递归陷阱。
# Claude Code 的 shell-snapshots 会注入 'claude' shell function；在 bash 子进程里
# `exec claude` 会解析成该 function 反复调回 launcher 本身，表现为 "permission
# denied" 或死循环。优先级：CLAUDE_CODE_EXECPATH > PATH 里真 binary。
_CLAUDE_BIN="${CLAUDE_CODE_EXECPATH:-}"
if [[ -z "$_CLAUDE_BIN" || ! -x "$_CLAUDE_BIN" ]]; then
    _CLAUDE_BIN="$(command -v claude 2>/dev/null || true)"
fi
if [[ -z "$_CLAUDE_BIN" || ! -x "$_CLAUDE_BIN" ]]; then
    echo "[claude-launch] ❌ 找不到真 claude 可执行文件（CLAUDE_CODE_EXECPATH/\$PATH 都不行）" >&2
    exit 127
fi

FINAL_CMD=("$_CLAUDE_BIN" --session-id "$SID" "${ARGS[@]+"${ARGS[@]}"}")
exec "${FINAL_CMD[@]}"
