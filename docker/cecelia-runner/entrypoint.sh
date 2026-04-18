#!/usr/bin/env bash
# entrypoint.sh — cecelia-runner 容器启动器
#
# 解决三个问题：
#  1. Claude Code 需要写 session-env —— 宿主 ~/.claude-account1 是 :ro 挂载，
#     会报 ENOENT: mkdir session-env。此处把只读挂载的 /host-claude-config 复制
#     到 /home/cecelia/.claude（可写），再把 CLAUDE_CONFIG_DIR 指向副本。
#  2. Generator 需要 git push / gh pr create —— 挂载宿主的 ~/.gitconfig 和
#     ~/.config/gh 进来就够，这里只需 git config --global safe.directory '*'
#     让 git 信任 /workspace 上 detached worktree。
#  3. ENTRYPOINT 之前是 ["claude", "-p", ...]，docker-executor 把 prompt 作为
#     末尾参数传入；改到 entrypoint.sh 后同样把 "$@" 透传给 claude。
#
# 约定：
#  - 宿主 CLAUDE_CONFIG_DIR（例如 ~/.claude-account1）以 :ro 挂载到
#    /host-claude-config
#  - 容器内 claude 使用 /home/cecelia/.claude（可写，副本）
#  - docker-executor 注入 CLAUDE_CONFIG_DIR=/home/cecelia/.claude（覆盖宿主路径）

set -euo pipefail

HOST_CFG="/host-claude-config"
LOCAL_CFG="${CLAUDE_CONFIG_DIR:-/home/cecelia/.claude}"

# 1. 复制只读配置到可写副本（session-env 等需要运行时写入）
if [[ -d "$HOST_CFG" ]]; then
  mkdir -p "$LOCAL_CFG"
  # 复制内容而不是整个目录（保留 LOCAL_CFG 本身的权限属主）
  # -a 保 mode/owner/timestamp；2>/dev/null 屏蔽符号链接目标不存在等噪音
  cp -a "$HOST_CFG/." "$LOCAL_CFG/" 2>/dev/null || true
  # session-env 是运行时可写目录
  mkdir -p "$LOCAL_CFG/session-env"
fi

# 2. git 信任 /workspace（detached worktree 场景下 git 会拒绝执行命令）
git config --global --add safe.directory '*' 2>/dev/null || true

# 3. 如果挂了 ~/.gitconfig 但没有 user.name/email，补个默认值（避免 commit 失败）
if ! git config --global --get user.name >/dev/null 2>&1; then
  git config --global user.name "${GIT_AUTHOR_NAME:-Cecelia Bot}"
fi
if ! git config --global --get user.email >/dev/null 2>&1; then
  git config --global user.email "${GIT_AUTHOR_EMAIL:-cecelia-bot@noreply.github.com}"
fi

# 4. 启动 claude headless，把所有传入参数当 prompt
exec claude -p --dangerously-skip-permissions --output-format json "$@"
