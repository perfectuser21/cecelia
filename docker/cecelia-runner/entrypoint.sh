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
  # -aL 跟随 symlink 拷贝真实文件（skills/ 常是 symlink 指向项目 workflows 目录）
  # 配合 docker-executor 挂载的 symlink-target volume，harness skills 才能在容器里可见
  cp -aL "$HOST_CFG/." "$LOCAL_CFG/" 2>/dev/null || true
  # session-env 是运行时可写目录
  mkdir -p "$LOCAL_CFG/session-env"
fi

# 2. 准备可写 gitconfig（GIT_CONFIG_GLOBAL 覆盖默认路径）
# 宿主 ~/.gitconfig 通过 :ro 挂载到 /home/cecelia/.gitconfig，无法写入
# （直写会报 "Device or resource busy"），导致 safe.directory 设置失败，
# 后续所有 git 命令都撞 "fatal: detected dubious ownership in repository"。
# 方案：把宿主 gitconfig 复制到 /tmp/gitconfig-rw，再用 GIT_CONFIG_GLOBAL
# 让 git 把副本当成 --global 配置读写。Git 2.32+ 支持此环境变量。
WRITABLE_GIT_CONFIG="/tmp/gitconfig-rw"
HOST_GIT_CONFIG="/home/cecelia/.gitconfig"
if [[ -f "$HOST_GIT_CONFIG" ]]; then
  cp "$HOST_GIT_CONFIG" "$WRITABLE_GIT_CONFIG" 2>/dev/null || touch "$WRITABLE_GIT_CONFIG"
else
  touch "$WRITABLE_GIT_CONFIG"
fi
export GIT_CONFIG_GLOBAL="$WRITABLE_GIT_CONFIG"

# 3. git 信任 /workspace（detached worktree 场景下 git 会拒绝执行命令）
# 不再用 `|| true` 静默失败——现在 gitconfig 可写，这条必须真正成功
git config --global --add safe.directory '*'

# 3.5 v6 P1-D：容器内 git remote 自动重写
# 宿主以 worktree 形式把 /workspace 挂进来时，origin URL 是宿主绝对路径
# (/Users/...)，容器里 git fetch / push 直接挂 "does not appear to be a git repo"。
# Brain dispatch 注入 CONTRACT_BRANCH 后 generator 第一步就 git fetch origin
# <branch>，这里必须把宿主路径改成 https GitHub URL。
if [[ -d /workspace/.git || -f /workspace/.git ]]; then
  REMOTE_URL=$(cd /workspace && git remote get-url origin 2>/dev/null || echo "")
  if [[ "$REMOTE_URL" =~ ^/ ]]; then
    (cd /workspace && git remote set-url origin "https://github.com/perfectuser21/cecelia.git")
    echo "[entrypoint] git remote rewritten: $REMOTE_URL -> https://github.com/perfectuser21/cecelia.git"
  fi
fi

# 4. 如果挂了 ~/.gitconfig 但没有 user.name/email，补个默认值（避免 commit 失败）
if ! git config --global --get user.name >/dev/null 2>&1; then
  git config --global user.name "${GIT_AUTHOR_NAME:-Cecelia Bot}"
fi
if ! git config --global --get user.email >/dev/null 2>&1; then
  git config --global user.email "${GIT_AUTHOR_EMAIL:-cecelia-bot@noreply.github.com}"
fi

# 5. V6 运行时准备 — 把挂载的 ~/claude-output/scripts/gen-v6-*.mjs 复制到
# /home/cecelia/v6-runtime/（Dockerfile 预置了 linux @resvg symlink）。让 Claude 跑
# `node /home/cecelia/v6-runtime/gen-v6-person.mjs` 时 ESM import 'resvg-js'
# 能 resolve 到 linux 二进制。harness 任务不挂 claude-output，此段 skip。
V6_SRC="/home/cecelia/claude-output/scripts"
V6_DST="/home/cecelia/v6-runtime"
if [[ -d "$V6_SRC" && -d "$V6_DST" ]]; then
  cp -f "$V6_SRC"/gen-v6-*.mjs "$V6_DST/" 2>/dev/null || true
fi

# 6. P0-3：如果调用方通过 env CLAUDE_MODEL_OVERRIDE 指定了模型（alias 或完整名），
# 就给 claude 加 `--model <value>`。content pipeline 的 copy_review 节点借此切到
# haiku 降成本（Opus 单次 ~$0.96 → Haiku 量级便宜 10-20x）。
# 空/未设置时走容器默认模型（账号 tier），保持老行为。
MODEL_FLAGS=()
if [[ -n "${CLAUDE_MODEL_OVERRIDE:-}" ]]; then
  MODEL_FLAGS=(--model "$CLAUDE_MODEL_OVERRIDE")
fi

# 7. 启动 claude headless
# 优先从 /tmp/cecelia-prompts/${CECELIA_TASK_ID}.prompt 读 prompt 并走 stdin
# —— 长 prompt（GAN Round N Reviewer 含完整合同历史）不会撞 OS argv 限制
# （E2BIG: spawn argument list too long）。
# 文件不在时 fallback 到 argv（backward compat，手动 docker run 仍可工作）。
#
# v1.229.0: 不再用 `exec claude` 直接接管进程。改为先在子进程跑 claude，
# 拿到 exit code 后向 brain POST callback（让 LangGraph interrupt resume），
# 再用同一 exit code 退出容器。HARNESS_NODE/CECELIA_TASK_ID 任一为空时
# 走旧 exec 路径，保持非 harness 任务零变更。
PROMPT_FILE="/tmp/cecelia-prompts/${CECELIA_TASK_ID:-UNSET}.prompt"

run_claude() {
  if [[ -f "$PROMPT_FILE" ]]; then
    claude -p --dangerously-skip-permissions --output-format json "${MODEL_FLAGS[@]}" < "$PROMPT_FILE"
  else
    claude -p --dangerously-skip-permissions --output-format json "${MODEL_FLAGS[@]}" "$@"
  fi
}

# 非 harness 任务（如手动 docker run、self-drive 普通容器）走老 exec 路径
if [[ -z "${CECELIA_TASK_ID:-}" || -z "${HARNESS_NODE:-}" ]]; then
  if [[ -f "$PROMPT_FILE" ]]; then
    exec claude -p --dangerously-skip-permissions --output-format json "${MODEL_FLAGS[@]}" < "$PROMPT_FILE"
  else
    exec claude -p --dangerously-skip-permissions --output-format json "${MODEL_FLAGS[@]}" "$@"
  fi
fi

# Harness 任务路径：跑完 → POST callback → 用 claude exit code 退出
# set -e 已开，必须临时关掉避免 claude 失败时跳过 callback
set +e
run_claude "$@"
EXIT_CODE=$?
set -e

STDOUT_FILE="/tmp/cecelia-prompts/${CECELIA_TASK_ID}.stdout"
STDOUT_CONTENT=""
if [[ -f "$STDOUT_FILE" ]]; then
  STDOUT_CONTENT=$(tail -c 4000 "$STDOUT_FILE" 2>/dev/null || echo "")
fi
# jq -Rs 把任意 stdout 安全编码成 JSON 字符串（含换行、引号）
STDOUT_JSON=$(printf '%s' "$STDOUT_CONTENT" | jq -Rs . 2>/dev/null || echo '""')

CALLBACK_BODY=$(printf '{"result":"completed","exit_code":%d,"stdout":%s}' "$EXIT_CODE" "$STDOUT_JSON")

# 优先用 Layer 3 spawnNode 传的 HARNESS_CALLBACK_URL（含完整 URL + --name 作 containerId），
# fallback HOSTNAME（旧方式，但 Layer 3 spawn 给 docker 起的 --name ≠ HOSTNAME，会导致 callback router 找不到 thread_lookup）。
TARGET_URL="${HARNESS_CALLBACK_URL:-}"
if [[ -z "$TARGET_URL" ]]; then
  CONTAINER_ID="${HOSTNAME:-$(cat /etc/hostname 2>/dev/null || echo unknown)}"
  TARGET_URL="http://host.docker.internal:5221/api/brain/harness/callback/${CONTAINER_ID}"
fi

if curl -sf -m 10 -X POST \
    "$TARGET_URL" \
    -H "Content-Type: application/json" \
    -d "$CALLBACK_BODY" >/dev/null 2>&1; then
  echo "[entrypoint] harness callback POST ok (url=${TARGET_URL} exit=${EXIT_CODE})"
else
  echo "[entrypoint] harness callback POST 失败（不阻塞容器退出）— url=${TARGET_URL} exit=${EXIT_CODE}"
fi

exit "$EXIT_CODE"
