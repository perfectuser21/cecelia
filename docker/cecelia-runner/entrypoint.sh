#!/usr/bin/env bash
# entrypoint.sh — cecelia-runner 容器启动器
#
# 解决三个问题：
#  1. Claude Code 需要写 session-env —— 宿主 ~/.claude-account1 是 :ro 挂载，
#     会报 ENOENT: mkdir session-env。此处把只读挂载的 /host-claude-config 复制
#     到 /home/cecelia/.claude（可写），再把 CLAUDE_CONFIG_DIR 指向副本。
#  2. Generator 需要 git push / gh pr create —— 挂载宿主的 ~/.gitconfig 和
#     ~/.config/gh 后，用容器内 gh 重建 credential helper，再设置 safe.directory，
#     避免复制进来的宿主专用 helper 在 Linux Runner 内不存在。
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
#
# issue d4e0ec91：账号 home 目录（HOST_CFG）会被多个并发容器同时挂载使用，
# projects/ 等会话历史目录在被其他并发的活跃 session 实时读写。原先
# `cp -aL "$HOST_CFG/." "$LOCAL_CFG/"` 整目录复制在这种并发写入下会随机
# 卡死或中途失败（实测复现：失败容器内完全没有 .credentials.json，因为
# 复制在到达它之前就被打断）。这些高频变动、体积大的目录本来就不是一次性
# headless 容器任务需要的东西（不会恢复历史会话），逐条排除即可。
if [[ -d "$HOST_CFG" ]]; then
  mkdir -p "$LOCAL_CFG"
  # 高频并发写入 + 容器不需要的目录：跳过，避免整树复制卡死/中途失败
  EXCLUDE_FROM_CONFIG_COPY=(projects sessions file-history telemetry shell-snapshots paste-cache cache)
  # 逐个顶层条目复制（含隐藏文件），跳过排除列表 —— 保留 -aL 跟随 symlink
  # 拷贝真实文件的语义（skills/ 常是 symlink 指向项目 workflows 目录，配合
  # docker-executor 挂载的 symlink-target volume，harness skills 才能在容器里可见）
  shopt -s nullglob dotglob
  for entry in "$HOST_CFG"/*; do
    name="$(basename "$entry")"
    [[ "$name" == "." || "$name" == ".." ]] && continue
    skip=0
    for ex in "${EXCLUDE_FROM_CONFIG_COPY[@]}"; do
      [[ "$name" == "$ex" ]] && skip=1 && break
    done
    [[ $skip -eq 1 ]] && continue
    cp -aL "$entry" "$LOCAL_CFG/" 2>/dev/null || true
  done
  shopt -u nullglob dotglob
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

# github-credential-envelope:start
GITHUB_CREDENTIAL_SECRET=""

prepare_github_credential() {
  local config_dir="${1:-/home/cecelia/.config/gh}"
  local credential_ref="${CECELIA_GITHUB_CREDENTIAL_REF:-}"
  local fifo="${CECELIA_GITHUB_CREDENTIAL_FIFO:-}"
  local prior_umask=""

  if [[ ! "$credential_ref" =~ ^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$ ]] \
      || [[ -z "$fifo" || ! -r "$fifo" ]] \
      || [[ "$config_dir" != /* || "$config_dir" == "/" ]] \
      || ! command -v gh >/dev/null 2>&1; then
    return 1
  fi

  prior_umask="$(umask)"
  umask 077
  mkdir -p "$config_dir" || {
    umask "$prior_umask"
    return 1
  }
  chmod 700 "$config_dir" || {
    umask "$prior_umask"
    return 1
  }
  export GH_CONFIG_DIR="$config_dir"
  unset GH_TOKEN GITHUB_TOKEN

  if ! gh auth login \
      --hostname github.com \
      --git-protocol https \
      --with-token \
      < "$fifo" >/dev/null 2>&1; then
    unset CECELIA_GITHUB_CREDENTIAL_FIFO
    umask "$prior_umask"
    return 1
  fi
  unset CECELIA_GITHUB_CREDENTIAL_FIFO

  if [[ ! -s "$config_dir/hosts.yml" ]]; then
    umask "$prior_umask"
    return 1
  fi
  chmod 600 "$config_dir/hosts.yml" || {
    umask "$prior_umask"
    return 1
  }
  GITHUB_CREDENTIAL_SECRET="$(
    awk '
      $1 == "oauth_token:" {
        sub(/^[[:space:]]*oauth_token:[[:space:]]*/, "")
        gsub(/^"|"$/, "")
        print
        exit
      }
    ' "$config_dir/hosts.yml"
  )"
  if [[ -z "$GITHUB_CREDENTIAL_SECRET" ]]; then
    umask "$prior_umask"
    return 1
  fi
  umask "$prior_umask"
}
# github-credential-envelope:end

# provider-output-redaction:start
redact_github_credential_text() {
  local line=""

  IFS= read -r line || [[ -n "$line" ]] || return 0
  if [[ -z "${CECELIA_GITHUB_CREDENTIAL_REF:-}" ]]; then
    printf '%s\n' "$line"
    return 0
  fi
  if [[ "${GITHUB_CREDENTIAL_DESTROYED:-false}" == "true" ]]; then
    printf '%s\n' "$line"
    return 0
  fi
  if [[ -z "$GITHUB_CREDENTIAL_SECRET" ]]; then
    printf '%s\n' '[provider output redaction failed]'
    return 1
  fi
  printf '%s\n' "${line//$GITHUB_CREDENTIAL_SECRET/***REDACTED***}"
}

redact_provider_credential_text() {
  local github_safe=""
  if ! github_safe="$(redact_github_credential_text)"; then
    printf '%s\n' "$github_safe"
    return 1
  fi
  if [[ "${CECELIA_EXECUTOR:-}" == "codex" ]]; then
    printf '%s\n' "$github_safe" | redact_codex_credential_text
    return
  fi
  printf '%s\n' "$github_safe"
}
# provider-output-redaction:end

# evaluator-evidence-boundary:start
EVALUATOR_EVIDENCE_MANIFEST_DIGEST=""
GITHUB_CREDENTIAL_DESTROYED=false
PROVIDER_IDENTITY_PREFIX=()

is_evaluator_task_bundle() {
  local task_bundle_file="${HARNESS_TASK_BUNDLE_FILE:-}"
  [[ -f "$task_bundle_file" ]] \
    && [[ "$(jq -r '.task_bundle.role // empty' "$task_bundle_file" 2>/dev/null)" == "evaluator" ]]
}

prepare_evaluator_evidence_capsule() {
  is_evaluator_task_bundle || return 0

  local task_bundle_file="${HARNESS_TASK_BUNDLE_FILE:-}"
  local preflight_bin="${CECELIA_EVIDENCE_PREFLIGHT_BIN:-/usr/local/lib/cecelia/github-evidence-preflight.cjs}"
  local evidence_required=""
  evidence_required="$(
    jq -r 'if .task_bundle.inputs.github_evidence_request then "true" else "false" end' \
      "$task_bundle_file" 2>/dev/null
  )" || return 1
  [[ "$evidence_required" == "true" ]] || return 0
  if [[ -z "${CECELIA_GITHUB_CREDENTIAL_REF:-}" \
      || ! -x "$preflight_bin" \
      || ! "${HARNESS_ATTEMPT_ID:-}" =~ ^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$ ]]; then
    echo "[entrypoint] Evaluator evidence preflight prerequisites rejected" >&2
    return 1
  fi

  export HARNESS_EVIDENCE_CAPSULE_DIR="/tmp/cecelia-evidence/${HARNESS_ATTEMPT_ID}"
  local evidence_heartbeat_pid=""
  if [[ -n "${HARNESS_LEASE_OWNER:-}" \
      && -n "${HARNESS_CALLBACK_TOKEN:-}" ]]; then
    (
      while :; do
        curl -sf -m 10 -X POST \
          "${BRAIN_URL:-http://host.docker.internal:5221}/api/brain/harness/attempts/${HARNESS_ATTEMPT_ID}/heartbeat" \
          -H 'Content-Type: application/json' \
          -H "Authorization: Bearer ${HARNESS_CALLBACK_TOKEN}" \
          -d "$(jq -nc --arg owner "$HARNESS_LEASE_OWNER" '{lease_owner:$owner,lease_seconds:180}')" \
          >/dev/null 2>&1 || true
        sleep 60
      done
    ) &
    evidence_heartbeat_pid=$!
  fi
  set +e
  EVALUATOR_EVIDENCE_MANIFEST_DIGEST="$(
    "$preflight_bin" collect \
      --bundle "$task_bundle_file" \
      --capsule "$HARNESS_EVIDENCE_CAPSULE_DIR"
  )"
  local collect_exit=$?
  set -e
  if [[ -n "$evidence_heartbeat_pid" ]]; then
    kill "$evidence_heartbeat_pid" >/dev/null 2>&1 || true
    wait "$evidence_heartbeat_pid" 2>/dev/null || true
  fi
  [[ "$collect_exit" -eq 0 ]] || return 1
  [[ "$EVALUATOR_EVIDENCE_MANIFEST_DIGEST" =~ ^[a-f0-9]{64}$ ]] || return 1
  echo "[entrypoint] Evaluator evidence capsule sealed for exact PR head"
}

destroy_evaluator_github_credential() {
  is_evaluator_task_bundle || return 0

  local config_dir="${GH_CONFIG_DIR:-/home/cecelia/.config/gh}"
  if [[ "$config_dir" != /* || "$config_dir" == "/" ]]; then
    echo "[entrypoint] refusing unsafe GitHub config cleanup path" >&2
    return 1
  fi
  rm -f -- "$config_dir/hosts.yml" || return 1
  unset CECELIA_GITHUB_CREDENTIAL_FIFO GH_TOKEN GITHUB_TOKEN
  GITHUB_CREDENTIAL_SECRET=""
  export GITHUB_CREDENTIAL_DESTROYED=true
  if [[ -e "$config_dir/hosts.yml" ]] \
      || gh auth token --hostname github.com >/dev/null 2>&1; then
    echo "[entrypoint] Evaluator GitHub credential destruction failed" >&2
    return 1
  fi
  echo "[entrypoint] Evaluator GitHub credential destroyed before Provider"
}

verify_evaluator_evidence_capsule() {
  [[ -n "$EVALUATOR_EVIDENCE_MANIFEST_DIGEST" ]] || return 0
  local preflight_bin="${CECELIA_EVIDENCE_PREFLIGHT_BIN:-/usr/local/lib/cecelia/github-evidence-preflight.cjs}"
  "$preflight_bin" verify \
    --capsule "$HARNESS_EVIDENCE_CAPSULE_DIR" \
    --expected-digest "$EVALUATOR_EVIDENCE_MANIFEST_DIGEST"
}

seal_evaluator_evidence_capsule() {
  is_evaluator_task_bundle || return 0
  [[ -n "$EVALUATOR_EVIDENCE_MANIFEST_DIGEST" ]] || return 0
  if [[ "$(id -u)" != "0" ]] \
      || [[ -z "${HARNESS_EVIDENCE_CAPSULE_DIR:-}" ]] \
      || [[ ! -d "$HARNESS_EVIDENCE_CAPSULE_DIR" ]]; then
    echo "[entrypoint] Evaluator evidence capsule requires trusted root stage" >&2
    return 1
  fi

  local capsule_parent=""
  capsule_parent="$(dirname -- "$HARNESS_EVIDENCE_CAPSULE_DIR")" || return 1
  if [[ "$capsule_parent" != "/tmp/cecelia-evidence" ]]; then
    echo "[entrypoint] Evaluator evidence parent rejected" >&2
    return 1
  fi
  chown -R root:root -- "$HARNESS_EVIDENCE_CAPSULE_DIR" || return 1
  chown root:root -- "$capsule_parent" || return 1
  chmod 0711 -- "$capsule_parent" || return 1
  find "$HARNESS_EVIDENCE_CAPSULE_DIR" -type d -exec chmod 0555 {} + \
    || return 1
  find "$HARNESS_EVIDENCE_CAPSULE_DIR" -type f -exec chmod 0444 {} + \
    || return 1
  echo "[entrypoint] Evaluator evidence capsule made immutable to Provider UID"
}

prepare_evaluator_provider_identity() {
  is_evaluator_task_bundle || {
    PROVIDER_IDENTITY_PREFIX=()
    return 0
  }
  if [[ "$(id -u)" != "0" ]] \
      || ! command -v setpriv >/dev/null 2>&1 \
      || [[ "$(id -u cecelia 2>/dev/null)" != "999" ]]; then
    echo "[entrypoint] Evaluator Provider privilege boundary unavailable" >&2
    return 1
  fi

  if [[ -d "$LOCAL_CFG" ]]; then
    chown -R cecelia:cecelia -- "$LOCAL_CFG" || return 1
  fi
  if [[ -n "${CODEX_HOME:-}" && -d "$CODEX_HOME" ]]; then
    chown -R cecelia:cecelia -- "$CODEX_HOME" || return 1
  fi
  PROVIDER_IDENTITY_PREFIX=(
    setpriv
    --reuid=cecelia
    --regid=cecelia
    --init-groups
    --no-new-privs
    --bounding-set=-all
    --inh-caps=-all
    --ambient-caps=-all
    --
  )
  echo "[entrypoint] Evaluator Provider constrained to UID 999 without capabilities"
}
# evaluator-evidence-boundary:end

if [[ -n "${CECELIA_GITHUB_CREDENTIAL_REF:-}" \
    || -n "${CECELIA_GITHUB_CREDENTIAL_FIFO:-}" ]]; then
  if ! prepare_github_credential "/home/cecelia/.config/gh"; then
    echo "[entrypoint] GitHub CredentialEnvelope rejected" >&2
    exit 1
  fi
fi

if is_evaluator_task_bundle; then
  prepare_evaluator_evidence_capsule
  seal_evaluator_evidence_capsule
  destroy_evaluator_github_credential
fi

# git-auth-setup:start
# 宿主 gitconfig 可能引用只在 macOS 宿主存在的 credential helper。Fleet Runner 已从
# 一次性 FIFO 在 gh tmpfs 中登录；legacy Runner 仍可使用既有 gh config。这里让容器内
# gh 安装自身 helper；token 不进入 docker argv/env/日志。
if [[ "${HARNESS_CANARY:-false}" != "true" \
    && "${GITHUB_CREDENTIAL_DESTROYED:-false}" != "true" ]] \
    && command -v gh >/dev/null 2>&1; then
  if gh auth setup-git >/dev/null 2>&1; then
    echo "[entrypoint] in-container GitHub credential helper configured"
  else
    echo "[entrypoint] GitHub credential helper unavailable; git push may fail" >&2
  fi
fi
# git-auth-setup:end

# 3. git 信任 /workspace（detached worktree 场景下 git 会拒绝执行命令）
# 不再用 `|| true` 静默失败——现在 gitconfig 可写，这条必须真正成功
git config --global --add safe.directory '*'

# 3.2 Brain API 回环转发（issue 219a9efc 零落库根修·通治层）
# 众多 SKILL.md（line-strategist / ci-patrol / db-update…）硬编码 localhost:5221，
# bridge 容器内 localhost 是容器自己 → 所有写库 curl 静默失败、skill 照常 exit 0。
# 此处把容器内 127.0.0.1:5221 转发到宿主（--add-host host.docker.internal:host-gateway
# 由 docker-executor 注入）。host.docker.internal 不可解析时跳过（非 Brain 派发场景）。
# 转发目标端口跟随 BRAIN_URL（staging 5222 / 预览 brain 派发时不得把硬编码流量倒进生产 5221）。
if [[ "${HARNESS_CANARY:-false}" != "true" ]] \
    && getent hosts host.docker.internal >/dev/null 2>&1; then
  BRAIN_TARGET_PORT=5221
  if [[ -n "${BRAIN_URL:-}" ]]; then
    _brain_port="${BRAIN_URL##*:}"
    [[ "$_brain_port" =~ ^[0-9]+$ ]] && BRAIN_TARGET_PORT="$_brain_port"
  fi
  socat TCP-LISTEN:5221,bind=127.0.0.1,fork,reuseaddr TCP:host.docker.internal:${BRAIN_TARGET_PORT} &
  echo "[entrypoint] loopback forward 127.0.0.1:5221 -> host.docker.internal:${BRAIN_TARGET_PORT} (pid $!)"
fi

# 3.5 v6 P1-D：容器内 git remote 自动重写
# 宿主以 worktree 形式把 /workspace 挂进来时，origin URL 是宿主绝对路径
# (/Users/...)，容器里 git fetch / push 直接挂 "does not appear to be a git repo"。
# Brain dispatch 注入 CONTRACT_BRANCH 后 generator 第一步就 git fetch origin
# <branch>，这里必须把宿主路径改成 https GitHub URL。
if [[ "${HARNESS_READ_ONLY:-false}" != "true" ]] \
    && [[ -d /workspace/.git || -f /workspace/.git ]]; then
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

# goal-based stop hook：与 cecelia-run.sh 相同机制
# CECELIA_GOAL_SETTINGS 由 harness-initiative.graph.js 注入（JSON --settings 内容）
# 写入临时文件后以 --settings <file> 传给 claude，让 Stop hook 问 Haiku"目标完成了吗"
GOAL_FLAGS=()
_GOAL_TMP=""
if [[ -n "${CECELIA_GOAL_SETTINGS:-}" ]]; then
  _GOAL_TMP=$(mktemp /tmp/cecelia-goal-settings-XXXXXX.json)
  printf '%s' "$CECELIA_GOAL_SETTINGS" > "$_GOAL_TMP"
  GOAL_FLAGS=(--settings "$_GOAL_TMP")
  echo "[entrypoint] goal-based stop hook enabled (settings: $_GOAL_TMP)" >&2
fi

# 7. 启动 claude headless
# 取证文件路径解析（env-优先协议，v forensics-no-overwrite-r2）：
#   - CECELIA_PROMPT_FILE / CECELIA_STDOUT_FILE 由 docker-executor 注入完整唯一文件名；
#     entrypoint 直接采用，不再自拼（防同 task 重跑覆盖）。
#   - env 缺失时回退旧拼接（向后兼容：滚动部署期老镜像无 env 仍可工作）。
# 当 CECELIA_ENTRYPOINT_TEST=1 时，立即打印两个变量并 exit 0（短路在所有副作用之前，
# 供 check-step3-entrypoint-resolve.sh 在 evaluator 容器内纯 bash 验证，无需 docker）。
PROMPT_FILE="${CECELIA_PROMPT_FILE:-/tmp/cecelia-prompts/${CECELIA_TASK_ID:-UNSET}.prompt}"
STDOUT_FILE="${CECELIA_STDOUT_FILE:-/tmp/cecelia-prompts/${CECELIA_TASK_ID:-UNSET}.stdout}"

if [[ "${CECELIA_ENTRYPOINT_TEST:-}" == "1" ]]; then
  echo "PROMPT_FILE=$PROMPT_FILE"
  echo "STDOUT_FILE=$STDOUT_FILE"
  exit 0
fi

# provider-neutral:start
# Kernel attempt path. The prompt file is the frozen TaskBundle envelope written by
# spawnDockerDetached; provider CLIs are only transports and never own workflow state.
PROVIDER_CONTRACT=0
NORMALIZED_RESULT_FILE=""

# proposer-finalizer:start
# Proposer 的合同判断仍由 LLM + Reviewer 负责，但 branch/commit/push 是确定性运输效果。
# 生产 run 466971c2 实证：完整合同已连续三次落在本地，Codex 却停在 mandatory Step 4
# 之前，Kernel 只能重复派同一 LLM，最终 gan_no_push_streak。这里用 Brain 注入的
# PROPOSE_BRANCH/SPRINT_DIR 收口该效果；不信 provider 自报 branch，不 push 半成品，
# 不 force-push，任何校验失败仍交给 Kernel 现有 no-push 探测器判定。
finalize_proposer_output() {
  [[ "${HARNESS_NODE:-}" == "proposer" ]] || return 0

  local workspace="${WORKTREE_PATH:-$PWD}"
  local task_id="${CECELIA_TASK_ID:-}"
  local branch="${PROPOSE_BRANCH:-}"
  local sprint_dir="${SPRINT_DIR:-}"
  local task_short=""
  local run_id=""
  local run_short=""
  local round=""
  local hop=""
  local task_bundle_file="${HARNESS_TASK_BUNDLE_FILE:-}"
  local workspace_abs=""
  local sprint_abs=""
  local brain_result_file=""
  local normalized_result_tmp=""

  if [[ ! "$task_id" =~ ^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$ ]]; then
    echo "[entrypoint] proposer finalizer rejected invalid task id" >&2
    return 1
  fi
  task_short="${task_id:0:8}"
  run_id="$(jq -r '.task_bundle.run_id // empty' "$task_bundle_file" 2>/dev/null)" || return 1
  if [[ ! "$run_id" =~ ^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$ ]]; then
    echo "[entrypoint] proposer finalizer rejected invalid run id" >&2
    return 1
  fi
  run_short="${run_id:0:8}"
  if [[ ! "$branch" =~ ^cp-harness-propose-r([0-9]+)-${task_short}-r${run_short}-a([0-9]+)$ ]]; then
    echo "[entrypoint] proposer finalizer rejected branch outside task scope: $branch" >&2
    return 1
  fi
  round="${BASH_REMATCH[1]}"
  hop="${BASH_REMATCH[2]}"
  if [[ -n "${HARNESS_HOP:-}" && "${HARNESS_HOP}" != "$hop" ]]; then
    echo "[entrypoint] proposer finalizer rejected branch outside dispatched hop" >&2
    return 1
  fi

  if [[ "$sprint_dir" != sprints/* || "$sprint_dir" == *".."* \
      || "$sprint_dir" == *$'\n'* || "$sprint_dir" == *$'\r'* ]]; then
    echo "[entrypoint] proposer finalizer rejected sprint path: $sprint_dir" >&2
    return 1
  fi
  if [[ ! -f "$task_bundle_file" ]] || ! jq -e \
    --arg task "$task_id" \
    --arg run "$run_id" \
    --arg sprint "$sprint_dir" \
    --arg branch "$branch" \
    --argjson round "$round" \
    --argjson hop "$hop" \
    '.task_bundle.role == "proposer"
     and .task_bundle.run_id == $run
     and (.task_bundle.hop | type) == "number"
     and .task_bundle.hop == $hop
     and .task_bundle.inputs.task_id == $task
     and .task_bundle.inputs.sprint_dir == $sprint
     and .task_bundle.inputs.propose_branch == $branch
     and (.task_bundle.inputs.contract_round | type) == "number"
     and .task_bundle.inputs.contract_round == $round' \
    "$task_bundle_file" >/dev/null 2>&1; then
    echo "[entrypoint] proposer finalizer rejected TaskBundle identity" >&2
    return 1
  fi
  workspace_abs="$(cd "$workspace" 2>/dev/null && pwd -P)" || {
    echo "[entrypoint] proposer finalizer workspace is unavailable" >&2
    return 1
  }
  sprint_abs="$(cd "$workspace_abs/$sprint_dir" 2>/dev/null && pwd -P)" || {
    echo "[entrypoint] proposer finalizer sprint is unavailable: $sprint_dir" >&2
    return 1
  }
  if [[ "$sprint_abs" != "$workspace_abs"/sprints/* ]]; then
    echo "[entrypoint] proposer finalizer sprint escaped workspace" >&2
    return 1
  fi

  local required
  for required in contract-draft.md contract-dod.md task-plan.json; do
    if [[ ! -f "$sprint_abs/$required" ]]; then
      echo "[entrypoint] proposer finalizer missing artifact: $sprint_dir/$required" >&2
      return 1
    fi
  done
  if [[ ! -d "$sprint_abs/tests" ]] \
      || [[ -z "$(find "$sprint_abs/tests" -type f -print -quit 2>/dev/null)" ]]; then
    echo "[entrypoint] proposer finalizer missing contract tests: $sprint_dir/tests" >&2
    return 1
  fi
  git -C "$workspace_abs" rev-parse --is-inside-work-tree >/dev/null 2>&1 || {
    echo "[entrypoint] proposer finalizer workspace is not a git worktree" >&2
    return 1
  }

  git -C "$workspace_abs" checkout -B "$branch" >/dev/null || return 1
  git -C "$workspace_abs" add -- \
    "$sprint_dir/contract-draft.md" \
    "$sprint_dir/contract-dod.md" \
    "$sprint_dir/tests" \
    "$sprint_dir/task-plan.json" || return 1
  if ! git -C "$workspace_abs" diff --cached --quiet; then
    git -C "$workspace_abs" commit \
      -m "feat(contract): round-${round} Golden Path draft + DoD + tests + task-plan" \
      >/dev/null || return 1
  fi

  git -C "$workspace_abs" push origin "HEAD:refs/heads/$branch" >/dev/null || return 1
  git -C "$workspace_abs" ls-remote --exit-code --heads origin "refs/heads/$branch" \
    >/dev/null || return 1

  brain_result_file="$workspace_abs/.brain-result.json"
  normalized_result_tmp="${brain_result_file}.proposer-finalizer.$$"
  if [[ -f "$brain_result_file" ]] && jq -e 'type == "object"' "$brain_result_file" >/dev/null 2>&1; then
    jq \
      --arg branch "$branch" \
      --arg task_plan_path "$sprint_dir/task-plan.json" \
      '.propose_branch = $branch
       | .workstream_count = 1
       | .task_plan_path = $task_plan_path' \
      "$brain_result_file" > "$normalized_result_tmp" || return 1
  else
    jq -n \
      --arg branch "$branch" \
      --arg task_plan_path "$sprint_dir/task-plan.json" \
      '{propose_branch:$branch,workstream_count:1,task_plan_path:$task_plan_path}' \
      > "$normalized_result_tmp" || return 1
  fi
  mv "$normalized_result_tmp" "$brain_result_file"
  echo "[entrypoint] proposer finalizer pushed branch=$branch sprint=$sprint_dir"
}
# proposer-finalizer:end

# planner-finalizer:start
finalize_planner_output() {
  [[ "${HARNESS_NODE:-}" == "planner" ]] || return 0

  local provider_result_file="${1:-}"
  local workspace="${WORKTREE_PATH:-$PWD}"
  local task_id="${CECELIA_TASK_ID:-}"
  local task_short=""
  local run_id=""
  local run_short=""
  local hop=""
  local branch="${PLANNER_BRANCH:-}"
  local sprint_dir="${SPRINT_DIR:-}"
  local task_bundle_file="${HARNESS_TASK_BUNDLE_FILE:-}"
  local workspace_abs=""
  local sprint_abs=""
  local prd_path=""
  local repo=""
  local local_sha=""
  local remote_sha=""
  local artifact=""
  local brain_result_file=""
  local source_result_file=""
  local brain_result_tmp=""
  local provider_result_tmp=""

  if [[ ! "$task_id" =~ ^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$ ]]; then
    echo "[entrypoint] planner finalizer rejected invalid task id" >&2
    return 1
  fi
  task_short="${task_id:0:8}"
  run_id="$(jq -r '.task_bundle.run_id // empty' "$task_bundle_file" 2>/dev/null)" || return 1
  if [[ ! "$run_id" =~ ^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$ ]]; then
    echo "[entrypoint] planner finalizer rejected invalid run id" >&2
    return 1
  fi
  run_short="${run_id:0:8}"
  if [[ ! "$branch" =~ ^cp-harness-prd-${task_short}-r${run_short}-a([1-9][0-9]*)$ ]]; then
    echo "[entrypoint] planner finalizer rejected branch outside task scope: $branch" >&2
    return 1
  fi
  hop="${BASH_REMATCH[1]}"
  if [[ -n "${HARNESS_HOP:-}" && "${HARNESS_HOP}" != "$hop" ]]; then
    echo "[entrypoint] planner finalizer rejected branch outside dispatched hop" >&2
    return 1
  fi
  if [[ "$sprint_dir" != sprints/* || "$sprint_dir" == *".."* \
      || "$sprint_dir" == *$'\n'* || "$sprint_dir" == *$'\r'* ]]; then
    echo "[entrypoint] planner finalizer rejected sprint path: $sprint_dir" >&2
    return 1
  fi
  if [[ ! -f "$task_bundle_file" || ! -f "$provider_result_file" ]] \
      || ! jq -e 'type == "object"' "$provider_result_file" >/dev/null 2>&1; then
    echo "[entrypoint] planner finalizer inputs unavailable" >&2
    return 1
  fi

  repo="$(jq -r \
    --arg task "$task_id" \
    --arg run "$run_id" \
    --arg sprint "$sprint_dir" \
    --arg branch "$branch" \
    --argjson hop "$hop" \
    'if .task_bundle.role == "planner"
        and .task_bundle.run_id == $run
        and (.task_bundle.hop | type) == "number"
        and .task_bundle.hop == $hop
        and .task_bundle.inputs.task_id == $task
        and .task_bundle.inputs.sprint_dir == $sprint
        and .task_bundle.inputs.planner_branch == $branch
      then .task_bundle.inputs.workspace_spec.repo
      else empty
      end' \
    "$task_bundle_file" 2>/dev/null)" || return 1
  if [[ ! "$repo" =~ ^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$ ]]; then
    echo "[entrypoint] planner finalizer rejected repository identity" >&2
    return 1
  fi

  workspace_abs="$(cd "$workspace" 2>/dev/null && pwd -P)" || {
    echo "[entrypoint] planner finalizer workspace is unavailable" >&2
    return 1
  }
  sprint_abs="$(cd "$workspace_abs/$sprint_dir" 2>/dev/null && pwd -P)" || {
    echo "[entrypoint] planner finalizer sprint is unavailable: $sprint_dir" >&2
    return 1
  }
  if [[ "$sprint_abs" != "$workspace_abs"/sprints/* ]]; then
    echo "[entrypoint] planner finalizer sprint escaped workspace" >&2
    return 1
  fi
  prd_path="$sprint_abs/sprint-prd.md"
  if [[ ! -s "$prd_path" ]]; then
    echo "[entrypoint] planner finalizer missing sprint-prd.md" >&2
    return 1
  fi

  git -C "$workspace_abs" rev-parse --is-inside-work-tree >/dev/null 2>&1 || return 1
  git -C "$workspace_abs" checkout -B "$branch" >/dev/null || return 1
  git -C "$workspace_abs" add -- "$sprint_dir/sprint-prd.md" || return 1
  if ! git -C "$workspace_abs" diff --cached --quiet; then
    git -C "$workspace_abs" commit \
      -m "feat(planner): publish verified sprint PRD" \
      >/dev/null || return 1
  fi
  local_sha="$(git -C "$workspace_abs" rev-parse HEAD)" || return 1
  [[ "$local_sha" =~ ^[a-f0-9]{40}$ ]] || return 1
  git -C "$workspace_abs" push origin "HEAD:refs/heads/$branch" >/dev/null \
    || return 1
  remote_sha="$(git -C "$workspace_abs" ls-remote \
    --exit-code --heads origin "refs/heads/$branch" | awk 'NR == 1 {print $1}')" \
    || return 1
  if [[ "$remote_sha" != "$local_sha" ]]; then
    echo "[entrypoint] planner finalizer remote SHA mismatch" >&2
    return 1
  fi

  artifact="$(jq -nc \
    --arg repo "$repo" \
    --arg branch "$branch" \
    --arg head_sha "$remote_sha" \
    --arg path "$sprint_dir/sprint-prd.md" \
    '{
       type: "git_artifact",
       kind: "planner_prd",
       verification_status: "verified",
       repo: $repo,
       branch: $branch,
       head_sha: $head_sha,
       path: $path
     }')" || return 1

  brain_result_file="$workspace_abs/.brain-result.json"
  source_result_file="$brain_result_file"
  if [[ ! -f "$source_result_file" ]] \
      || ! jq -e 'type == "object"' "$source_result_file" >/dev/null 2>&1; then
    printf '%s\n' '{}' > "$source_result_file"
  fi
  brain_result_tmp="${brain_result_file}.planner-finalizer.$$"
  jq --argjson receipt "$artifact" \
    '(.artifacts // [] | if type == "array" then . else [] end) as $existing
     | .artifacts = (
         [$existing[]
          | select(
              (
                type == "object"
                and .type == "git_artifact"
                and .kind == "planner_prd"
              ) | not
            )]
         + [$receipt]
       )' \
    "$source_result_file" > "$brain_result_tmp" || {
      rm -f "$brain_result_tmp"
      return 1
    }
  chmod 600 "$brain_result_tmp"
  mv "$brain_result_tmp" "$brain_result_file"

  provider_result_tmp="${provider_result_file}.planner-finalizer.$$"
  jq --argjson receipt "$artifact" \
    '(.artifacts // [] | if type == "array" then . else [] end) as $existing
     | .artifacts = (
         [$existing[]
          | select(
              (
                type == "object"
                and .type == "git_artifact"
                and .kind == "planner_prd"
              ) | not
            )]
         + [$receipt]
       )' \
    "$provider_result_file" > "$provider_result_tmp" || {
      rm -f "$provider_result_tmp"
      return 1
    }
  mv "$provider_result_tmp" "$provider_result_file"
  echo "[entrypoint] planner finalizer verified branch=$branch head=$remote_sha"
}
# planner-finalizer:end

# frozen-baseline-guard:start
# 生产 run d9785137 / attempt 3aa00156：任务 payload.base_sha 钉死了盲测冻结基线，
# Generator 仍按 SKILL Step 0.5 无条件 rebase 到 origin/main，把对照候选的血统带进
# 工作区。提示词不是闸——这里用 Kernel 注入的、Provider 无法伪造的服务端观测量
# （HARNESS_WORKSPACE_START_SHA + HARNESS_FROZEN_BASELINE）在运输层收口：
#   ① Provider 启动前武装 pre-push 钩子，SHA 烤进钩子脚本，unset env 也松不开；
#   ② Provider 退出后（此时会话已结束，改不动父进程）再断言一次血统。
FROZEN_BASELINE_GUARD_DIR="${FROZEN_BASELINE_GUARD_DIR:-/tmp/cecelia-frozen-baseline}"

frozen_baseline_enabled() {
  [[ "${HARNESS_FROZEN_BASELINE:-false}" == "true" ]]
}

install_frozen_baseline_guard() {
  frozen_baseline_enabled || return 0

  local workspace="${WORKTREE_PATH:-/workspace}"
  local start_sha="${HARNESS_WORKSPACE_START_SHA:-}"
  local hooks_dir="$FROZEN_BASELINE_GUARD_DIR/hooks"

  if [[ ! "$start_sha" =~ ^[0-9a-f]{40}$ ]]; then
    echo "[entrypoint] frozen baseline guard rejected an uncanonical start SHA" >&2
    return 1
  fi
  if ! git -C "$workspace" rev-parse --is-inside-work-tree >/dev/null 2>&1; then
    echo "[entrypoint] frozen baseline guard workspace is not a git worktree" >&2
    return 1
  fi
  if ! git -C "$workspace" cat-file -e "${start_sha}^{commit}" 2>/dev/null; then
    echo "[entrypoint] frozen baseline start SHA is absent from the workspace" >&2
    return 1
  fi
  if [[ "$(git -C "$workspace" rev-parse HEAD 2>/dev/null)" != "$start_sha" ]]; then
    echo "[entrypoint] frozen baseline workspace did not start at the pinned SHA" >&2
    return 1
  fi

  local check="$FROZEN_BASELINE_GUARD_DIR/lineage-check.sh"
  local baseline_refs="$FROZEN_BASELINE_GUARD_DIR/baseline-refs"
  mkdir -p "$hooks_dir" || return 1
  rm -f "$hooks_dir/pre-push" "$check" "$baseline_refs"

  # 判据不是「start SHA 仍是 HEAD 的祖先」——生产事故里 main 本来就是 0dc4e3c0
  # 的后代，rebase 上去祖先关系照样成立，这条规则一个字都拦不住。真正的不变量是：
  # start SHA..HEAD 之间引入的每一个 commit 都必须是本 Attempt 新写的。这里在
  # Provider 启动前给「已存在的血统」拍一张快照（admin clone 里的 main、对照候选
  # 分支、远端跟踪分支都在其中）；之后任何一个落进 start SHA..HEAD 的 commit 只要
  # 在快照可达范围内，就说明 fetch/rebase/merge/pull 把别的血统搬了进来。
  git -C "$workspace" for-each-ref --format='%(objectname)' refs/heads refs/remotes \
    | sort -u > "$baseline_refs" || return 1
  chmod 0444 "$baseline_refs" || return 1

  {
    printf '%s\n' '#!/usr/bin/env bash'
    printf '%s\n' 'set -uo pipefail'
    printf "START_SHA='%s'\n" "$start_sha"
    printf "BASELINE_REFS='%s'\n" "$baseline_refs"
    printf '%s\n' 'commit="${1:-HEAD}"'
    printf '%s\n' 'if ! git merge-base --is-ancestor "$START_SHA" "$commit"; then'
    printf '%s\n' '  echo "frozen_baseline_violation: $commit no longer descends from $START_SHA" >&2'
    printf '%s\n' '  exit 1'
    printf '%s\n' 'fi'
    printf '%s\n' 'exclusions=("^$START_SHA")'
    printf '%s\n' 'while IFS= read -r baseline_sha; do'
    printf '%s\n' '  [[ "$baseline_sha" =~ ^[0-9a-f]{40}$ ]] || continue'
    printf '%s\n' '  git cat-file -e "${baseline_sha}^{commit}" 2>/dev/null || continue'
    printf '%s\n' '  exclusions+=("^$baseline_sha")'
    printf '%s\n' 'done < "$BASELINE_REFS"'
    printf '%s\n' 'introduced="$(git rev-list --count "$START_SHA..$commit")"'
    printf '%s\n' 'own="$(git rev-list --count "$commit" "${exclusions[@]}")"'
    printf '%s\n' 'if [[ "$introduced" != "$own" ]]; then'
    printf '%s\n' '  echo "frozen_baseline_violation: $commit imported $((introduced - own)) commit(s) from another lineage above $START_SHA" >&2'
    printf '%s\n' '  exit 1'
    printf '%s\n' 'fi'
  } > "$check" || return 1
  chmod 0555 "$check" || return 1

  # Reviewer/evaluator workspaces are mounted read-only. Their provider cannot
  # push, so the pre-push hook adds no protection; the immutable before/after
  # lineage checker above remains authoritative without touching repository
  # config. Writable generator roles still receive both layers.
  if [[ "${HARNESS_READ_ONLY:-false}" == "true" ]]; then
    echo "[entrypoint] frozen baseline read-only assertion armed at $start_sha"
    return 0
  fi

  {
    printf '%s\n' '#!/usr/bin/env bash'
    printf '%s\n' 'set -uo pipefail'
    printf "CHECK='%s'\n" "$check"
    printf '%s\n' 'while read -r local_ref local_sha remote_ref remote_sha; do'
    printf '%s\n' '  [[ "$local_sha" =~ ^0{40}$ ]] && continue'
    printf '%s\n' '  bash "$CHECK" "$local_sha" || exit 1'
    printf '%s\n' 'done'
  } > "$hooks_dir/pre-push" || return 1
  chmod 0555 "$hooks_dir/pre-push" || return 1
  git -C "$workspace" config core.hooksPath "$hooks_dir" || return 1
  echo "[entrypoint] frozen baseline guard armed at $start_sha"
}

assert_frozen_baseline_lineage() {
  frozen_baseline_enabled || return 0

  local workspace="${WORKTREE_PATH:-/workspace}"
  local start_sha="${HARNESS_WORKSPACE_START_SHA:-}"
  local check="$FROZEN_BASELINE_GUARD_DIR/lineage-check.sh"

  if [[ ! "$start_sha" =~ ^[0-9a-f]{40}$ ]]; then
    echo "[entrypoint] frozen baseline assertion rejected an uncanonical start SHA" >&2
    return 1
  fi
  if [[ ! -r "$check" ]]; then
    echo "[entrypoint] frozen baseline lineage checker is missing" >&2
    return 1
  fi
  if ! (cd "$workspace" && bash "$check" HEAD); then
    echo "[entrypoint] frozen baseline violated above $start_sha" >&2
    return 1
  fi
}
# frozen-baseline-guard:end

# evaluator-evidence-bridge:start
EVALUATOR_EVIDENCE_PREPARED=0

prepare_evaluator_evidence() {
  [[ "${HARNESS_NODE:-}" == "evaluator" ]] || return 0
  EVALUATOR_EVIDENCE_PREPARED=1
}

merge_evaluator_evidence() {
  local normalized_result_file="$1"
  local brain_result_file="${WORKTREE_PATH:-$PWD}/.brain-result.json"
  local merged_result_file="${normalized_result_file}.evidence"

  [[ "${HARNESS_NODE:-}" == "evaluator" ]] || return 0
  [[ "$EVALUATOR_EVIDENCE_PREPARED" == "1" ]] || return 0
  [[ -f "$normalized_result_file" && -f "$brain_result_file" ]] || return 0
  jq -e \
    --arg task_id "${CECELIA_TASK_ID:-}" \
    --arg attempt_id "${HARNESS_ATTEMPT_ID:-}" '
    type == "object"
    and ($task_id | length > 0)
    and .task_id == $task_id
    and ($attempt_id | length > 0)
    and .attempt_id == $attempt_id
    and (.behavior_tests | type == "array")
    and (.behavior_tests | length > 0)
    and all(.behavior_tests[];
      type == "object"
      and (.command | type == "string" and length > 0)
      and (.exit_code | type == "number")
      and (.log_tail | type == "string")
    )
  ' "$brain_result_file" >/dev/null 2>&1 || return 0

  if jq --slurpfile evidence "$brain_result_file" \
    '.checks = $evidence[0].behavior_tests' \
    "$normalized_result_file" > "$merged_result_file"; then
    mv "$merged_result_file" "$normalized_result_file"
  else
    rm -f "$merged_result_file"
    return 1
  fi
}
# evaluator-evidence-bridge:end

persist_provider_session() {
  local session="$1"
  [[ -n "$session" && -n "${HARNESS_LEASE_OWNER:-}" ]] || return 0
  curl -sf -m 10 -X POST \
    "${BRAIN_URL:-http://host.docker.internal:5221}/api/brain/harness/attempts/${HARNESS_ATTEMPT_ID}/heartbeat" \
    -H 'Content-Type: application/json' \
    -H "Authorization: Bearer ${HARNESS_CALLBACK_TOKEN}" \
    -d "$(jq -nc \
      --arg owner "$HARNESS_LEASE_OWNER" \
      --arg session "$session" \
      '{lease_owner:$owner,lease_seconds:180,provider_session_id:$session}')" \
    >/dev/null 2>&1
}

# codex-credential-envelope:start
CREDENTIAL_REF=""
CREDENTIAL_INITIAL_HASH=""
CREDENTIAL_COPY_MUTATED=false
MAX_CODEX_CREDENTIAL_BYTES=196608

credential_file_hash() {
  local file="$1"
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$file" | awk '{print $1}'
  else
    shasum -a 256 "$file" | awk '{print $1}'
  fi
}

credential_file_mode() {
  local file="$1"
  local mode
  if mode="$(stat -c '%a' "$file" 2>/dev/null)"; then
    printf '%s\n' "$mode"
  elif mode="$(stat -f '%Lp' "$file" 2>/dev/null)"; then
    printf '%s\n' "$mode"
  else
    return 1
  fi
}

credential_file_size() {
  local file="$1"
  local size
  size="$(wc -c < "$file" | tr -d '[:space:]')" || return 1
  [[ "$size" =~ ^[0-9]+$ ]] || return 1
  printf '%s\n' "$size"
}

redact_codex_credential_text() {
  local auth_file="${CODEX_HOME:-/home/cecelia/.codex}/auth.json"
  local redacted
  if [[ ! -f "$auth_file" ]] || ! redacted="$(
    jq -Rr --slurpfile credential "$auth_file" '
      ($credential[0] // {}) as $auth
      | reduce (
          $auth
          | ..
          | strings
          | select(length >= 8)
        ) as $secret (.;
          split($secret) | join("***REDACTED***")
        )
    '
  )"; then
    cat >/dev/null
    printf '%s\n' '[provider output redaction failed]'
    return 1
  fi
  printf '%s\n' "$redacted"
}

redact_codex_credential_file() {
  local file="$1"
  local redacted_file="${file}.redacted"
  [[ -f "$file" ]] || return 0
  : > "$redacted_file"
  while IFS= read -r line || [[ -n "$line" ]]; do
    printf '%s\n' "$line" | redact_codex_credential_text \
      >> "$redacted_file" || {
        rm -f "$redacted_file"
        return 1
      }
  done < "$file"
  chmod 600 "$redacted_file"
  mv "$redacted_file" "$file"
}

redact_provider_credential_file() {
  local file="$1"
  local redacted_file="${file}.redacted"
  [[ -f "$file" ]] || return 0
  : > "$redacted_file"
  while IFS= read -r line || [[ -n "$line" ]]; do
    printf '%s\n' "$line" | redact_provider_credential_text \
      >> "$redacted_file" || {
        rm -f "$redacted_file"
        return 1
      }
  done < "$file"
  chmod 600 "$redacted_file"
  mv "$redacted_file" "$file"
}

prepare_codex_credential() {
  local codex_home="${1:-/home/cecelia/.codex}"
  local fifo="${CECELIA_CREDENTIAL_FIFO:-}"
  local credential_size=""
  CREDENTIAL_REF="${CECELIA_CREDENTIAL_REF:-}"
  if [[ -z "$fifo" ]] \
      || [[ ! "$fifo" = /* ]] \
      || [[ ! "$CREDENTIAL_REF" =~ ^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$ ]]; then
    return 1
  fi

  export CODEX_HOME="$codex_home"
  umask 077
  mkdir -p "$CODEX_HOME"
  chmod 700 "$CODEX_HOME"
  if ! cat -- "$fifo" > "$CODEX_HOME/auth.json"; then
    rm -f "$CODEX_HOME/auth.json"
    return 1
  fi
  chmod 600 "$CODEX_HOME/auth.json"
  unset CECELIA_CREDENTIAL_FIFO
  credential_size="$(credential_file_size "$CODEX_HOME/auth.json")" || {
    rm -f "$CODEX_HOME/auth.json"
    return 1
  }
  if (( credential_size > MAX_CODEX_CREDENTIAL_BYTES )); then
    rm -f "$CODEX_HOME/auth.json"
    return 1
  fi
  if ! jq -e \
      'type == "object"
       and (.tokens | type == "object")
       and (.tokens.access_token | type == "string" and length > 0)' \
      "$CODEX_HOME/auth.json" >/dev/null 2>&1; then
    rm -f "$CODEX_HOME/auth.json"
    return 1
  fi
  CREDENTIAL_INITIAL_HASH="$(credential_file_hash "$CODEX_HOME/auth.json")"
  [[ "$CREDENTIAL_INITIAL_HASH" =~ ^[a-f0-9]{64}$ ]]
}

record_codex_credential_mutation() {
  CREDENTIAL_COPY_MUTATED=false
  if [[ -z "$CREDENTIAL_INITIAL_HASH" ]] \
      || [[ ! -f "${CODEX_HOME:-/home/cecelia/.codex}/auth.json" ]] \
      || [[ "$(credential_file_mode "${CODEX_HOME:-/home/cecelia/.codex}/auth.json")" != "600" ]] \
      || [[ "$(credential_file_hash "${CODEX_HOME:-/home/cecelia/.codex}/auth.json")" != "$CREDENTIAL_INITIAL_HASH" ]]; then
    CREDENTIAL_COPY_MUTATED=true
  fi
}
# codex-credential-envelope:end

# credential-contract-probe:start
run_credential_contract_probe() {
  local probe_root=""
  local fake_bin=""
  local github_fifo=""
  local github_home=""
  local github_writer=""
  local codex_fifo=""
  local codex_home=""
  local codex_writer=""
  local probe_status=0
  local github_token='github_pat_runner_contract_probe'
  local codex_token='codex-runner-contract-probe'

  probe_root="$(mktemp -d)" || return 1
  fake_bin="$probe_root/bin"
  github_fifo="$probe_root/github-token.fifo"
  github_home="$probe_root/gh"
  codex_fifo="$probe_root/codex-auth.fifo"
  codex_home="$probe_root/codex"
  mkdir -p "$fake_bin" || probe_status=1

  # shellcheck disable=SC2016
  printf '%s\n' \
    '#!/bin/sh' \
    'token=""' \
    'IFS= read -r token || exit 1' \
    'mkdir -p "${GH_CONFIG_DIR:?}" || exit 1' \
    'printf "%s\n" "github.com:" "    oauth_token: $token" "    git_protocol: https" > "$GH_CONFIG_DIR/hosts.yml"' \
    > "$fake_bin/gh" || probe_status=1
  chmod 0700 "$fake_bin/gh" || probe_status=1
  mkfifo "$github_fifo" "$codex_fifo" || probe_status=1

  if [[ "$probe_status" -eq 0 ]]; then
    (printf '%s\n' "$github_token" > "$github_fifo") &
    github_writer="$!"
    if ! PATH="$fake_bin:$PATH" \
        CECELIA_GITHUB_CREDENTIAL_REF='44444444-4444-4444-8444-444444444444' \
        CECELIA_GITHUB_CREDENTIAL_FIFO="$github_fifo" \
        prepare_github_credential "$github_home"; then
      probe_status=1
    fi
    if kill -0 "$github_writer" >/dev/null 2>&1; then
      kill "$github_writer" >/dev/null 2>&1 || true
      probe_status=1
    fi
    wait "$github_writer" >/dev/null 2>&1 || probe_status=1
    grep -Fq "$github_token" "$github_home/hosts.yml" \
      || probe_status=1
  fi

  if [[ "$probe_status" -eq 0 ]]; then
    (
      printf '%s' \
        "{\"tokens\":{\"access_token\":\"$codex_token\"}}" \
        > "$codex_fifo"
    ) &
    codex_writer="$!"
    if ! CECELIA_CREDENTIAL_REF='33333333-3333-4333-8333-333333333333' \
        CECELIA_CREDENTIAL_FIFO="$codex_fifo" \
        prepare_codex_credential "$codex_home"; then
      probe_status=1
    fi
    if kill -0 "$codex_writer" >/dev/null 2>&1; then
      kill "$codex_writer" >/dev/null 2>&1 || true
      probe_status=1
    fi
    wait "$codex_writer" >/dev/null 2>&1 || probe_status=1
    jq -e \
      --arg token "$codex_token" \
      '.tokens.access_token == $token' \
      "$codex_home/auth.json" >/dev/null 2>&1 \
      || probe_status=1
  fi

  rm -rf -- "$probe_root"
  [[ "$probe_status" -eq 0 ]] || return 1
  printf '%s\n' 'runner-credential-contract-ok'
}

if [[ "${1:-}" == '__cecelia_runner_credential_contract_probe__' ]]; then
  run_credential_contract_probe
  exit $?
fi
# credential-contract-probe:end

# commander-provider-contract:start
provider_result_schema_json() {
  local task_bundle_file="$1"
  local expected_output
  expected_output=$(jq -r '.task_bundle.expected_output // empty' "$task_bundle_file")
  if [[ "$expected_output" == "commander-directive/v1" ]]; then
    printf '%s' '{"type":"object","properties":{"schema":{"type":"string","const":"commander-directive/v1"},"run_id":{"type":"string","format":"uuid"},"event_cursor":{"type":"integer","minimum":0},"action":{"type":"string","enum":["continue_default","dispatch_role","retry_attempt","revise_guidance","switch_provider","switch_machine","pause_run","request_human","abort_run"]},"target_role":{"type":["string","null"],"enum":["commander","planner","proposer","reviewer","generator","evaluator","judge",null]},"target_attempt_id":{"anyOf":[{"type":"string","format":"uuid"},{"type":"null"}]},"reason":{"type":"string","minLength":1,"maxLength":4000},"guidance":{"type":["string","null"],"maxLength":4000},"route":{"anyOf":[{"type":"object","properties":{"machine":{"type":["string","null"]},"provider":{"type":["string","null"]},"account":{"type":["string","null"]},"model":{"type":["string","null"]}},"required":["machine","provider","account","model"],"additionalProperties":false},{"type":"null"}]},"evidence_refs":{"type":"array","minItems":1,"maxItems":128,"items":{"type":"string","pattern":"^(event:[1-9][0-9]*|attempt:[0-9a-fA-F-]{36})$"}}},"required":["schema","run_id","event_cursor","action","target_role","target_attempt_id","reason","guidance","route","evidence_refs"],"additionalProperties":false}'
    return
  fi
  printf '%s' '{"type":"object","properties":{"status":{"type":"string","enum":["completed","completed_with_concerns","needs_context","blocked"]},"summary":{"type":"string"},"artifacts":{"type":"array","items":{"type":"string"}},"checks":{"type":"array","items":{"anyOf":[{"type":"string"},{"type":"object","properties":{"command":{"type":"string"},"exit_code":{"type":"integer"},"log_tail":{"type":"string"},"verification_level":{"type":"string","enum":["L1","L2","L3"]},"action":{"anyOf":[{"type":"string"},{"type":"null"}]},"expected":{"anyOf":[{"type":"string"},{"type":"null"}]},"wait_budget":{"anyOf":[{"type":"string"},{"type":"null"}]},"evidence":{"anyOf":[{"type":"string"},{"type":"null"}]}},"required":["command","exit_code","log_tail","verification_level","action","expected","wait_budget","evidence"],"additionalProperties":false}]}},"decision":{"anyOf":[{"type":"object","properties":{"outcome":{"type":"string"},"reason":{"type":"string"}},"required":["outcome","reason"],"additionalProperties":false},{"type":"null"}]},"error":{"anyOf":[{"type":"object","properties":{"code":{"type":"string"},"message":{"type":"string"}},"required":["code","message"],"additionalProperties":false},{"type":"null"}]}},"required":["status","summary","artifacts","checks","decision","error"],"additionalProperties":false}'
}

publish_provider_result_schema() {
  local schema_file="$1"
  local schema_json="$2"

  printf '%s' "$schema_json" > "$schema_file" || return 1
  # Evaluator preflight runs as root so it can own the immutable evidence
  # capsule, then Provider execution drops to UID 999. The schema is public
  # contract metadata, not evidence or a credential, and must cross that UID
  # boundary as read-only data.
  chmod 0444 "$schema_file"
}

validate_commander_task_bundle() {
  local task_bundle_file="$1"
  local expected_output
  expected_output=$(jq -r '.task_bundle.expected_output // empty' "$task_bundle_file")
  if [[ "$expected_output" != "commander-directive/v1" ]]; then
    return 0
  fi
  jq -e '
    .task_bundle as $task
    | $task.role == "commander"
      and $task.skill == null
      and $task.constraints.read_only == true
      and $task.constraints.fresh_session == true
      and ($task.inputs.commander_bundle | type) == "object"
      and $task.run_id == $task.inputs.commander_bundle.run_id
      and $task.attempt_id == $task.inputs.commander_bundle.commander_attempt_id
      and $task.inputs.commander_bundle.output_schema == "commander-directive/v1"
  ' "$task_bundle_file" >/dev/null
}

normalize_provider_success() {
  local task_bundle_file="$1"
  local result_file="$2"
  local normalized_file="$3"
  local attempt_id="$4"
  local provider="$5"
  local session_id="$6"
  local credential_ref="$7"
  local credential_copy_mutated="$8"
  local cli_exit_code="${9:-}"
  local terminal_receipt="${10:-}"
  local expected_output
  expected_output=$(jq -r '.task_bundle.expected_output // empty' "$task_bundle_file")

  if [[ "$expected_output" == "commander-directive/v1" ]]; then
    jq \
      --arg attempt "$attempt_id" \
      --arg provider "$provider" \
      --arg session "$session_id" \
      --arg credential_ref "$credential_ref" \
      --argjson credential_copy_mutated "$credential_copy_mutated" \
      --arg cli_exit_code "$cli_exit_code" \
      --arg terminal_receipt "$terminal_receipt" \
      '(.
         | with_entries(select(.value != null))
         | if (.route? | type) == "object"
           then .route |= with_entries(select(.value != null))
           else .
           end) as $decision
       | {
         contract_version: "1.0",
         attempt_id: $attempt,
         status: "completed",
         summary: $decision.reason,
         artifacts: [],
         checks: [],
         decision: $decision,
         error: null,
         provider_metadata: ({
           provider: $provider,
           session_id: (if $session == "" then null else $session end)
         } + (if $credential_ref == "" then {} else {
           credential_ref: $credential_ref,
           credential_copy_mutated: $credential_copy_mutated
         } end) + (if $cli_exit_code == "" then {} else {
           cli_exit_code: ($cli_exit_code | tonumber),
           terminal_receipt: $terminal_receipt
         } end))
       }' \
      "$result_file" > "$normalized_file"
    return
  fi

  jq \
    --arg attempt "$attempt_id" \
    --arg provider "$provider" \
    --arg session "$session_id" \
    --arg credential_ref "$credential_ref" \
    --argjson credential_copy_mutated "$credential_copy_mutated" \
    --arg cli_exit_code "$cli_exit_code" \
    --arg terminal_receipt "$terminal_receipt" \
    '.contract_version = (.contract_version // "1.0")
     | .attempt_id = $attempt
     | .provider_metadata = ((.provider_metadata // {}) + {
         provider: $provider,
         session_id: (if $session == "" then null else $session end)
       } + (if $credential_ref == "" then {} else {
         credential_ref: $credential_ref,
         credential_copy_mutated: $credential_copy_mutated
       } end) + (if $cli_exit_code == "" then {} else {
         cli_exit_code: ($cli_exit_code | tonumber),
         terminal_receipt: $terminal_receipt
       } end))' \
     "$result_file" > "$normalized_file"
}

# attempt-timeout-contract:start
read_attempt_timeout_seconds() {
  local value="${1:-}"
  [[ "$value" =~ ^[1-9][0-9]*$ ]] || return 1
  (( 10#$value <= 9007199254740991 )) || return 1
  printf '%s' "$value"
}

normalize_attempt_timeout_exit() {
  local raw_exit="$1"
  local elapsed_seconds="$2"
  local timeout_seconds="$3"

  if [[ "$raw_exit" -eq 137 && "$elapsed_seconds" -ge "$timeout_seconds" ]]; then
    printf '124'
    return
  fi
  if [[ "$raw_exit" -eq 124 && "$elapsed_seconds" -lt "$timeout_seconds" ]]; then
    printf '125'
    return
  fi
  printf '%s' "$raw_exit"
}

run_with_attempt_timeout() {
  local seconds="$1"
  shift
  local started_at="$SECONDS"
  local raw_exit
  local elapsed_seconds
  local normalized_exit

  timeout --signal=TERM --kill-after=10s "${seconds}s" "$@"
  raw_exit=$?
  elapsed_seconds=$((SECONDS - started_at))
  normalized_exit="$(
    normalize_attempt_timeout_exit "$raw_exit" "$elapsed_seconds" "$seconds"
  )"
  return "$normalized_exit"
}

normalize_provider_failure() {
  local normalized_file="$1"
  local attempt_id="$2"
  local provider="$3"
  local session_id="$4"
  local credential_ref="$5"
  local credential_copy_mutated="$6"
  local provider_exit="$7"
  local stdout_file="$8"

  if [[ "$provider_exit" -eq 124 ]]; then
    jq -n \
      --arg attempt "$attempt_id" \
      --arg provider "$provider" \
      --arg session "$session_id" \
      --arg credential_ref "$credential_ref" \
      --argjson credential_copy_mutated "$credential_copy_mutated" \
      --argjson exit_code "$provider_exit" \
      '{contract_version:"1.0",attempt_id:$attempt,status:"failed",summary:"provider process timed out",artifacts:[],checks:[],decision:null,error:{code:"provider_timeout",message:"provider exceeded the TaskBundle timeout",exit_code:$exit_code},provider_metadata:({provider:$provider,session_id:(if $session == "" then null else $session end)} + (if $credential_ref == "" then {} else {credential_ref:$credential_ref,credential_copy_mutated:$credential_copy_mutated} end))}' \
      > "$normalized_file"
    return
  fi

  local stderr_tail
  stderr_tail=$(tail -c 2000 "$stdout_file" 2>/dev/null || true)
  jq -n \
    --arg attempt "$attempt_id" \
    --arg provider "$provider" \
    --arg session "$session_id" \
    --arg credential_ref "$credential_ref" \
    --argjson credential_copy_mutated "$credential_copy_mutated" \
    --arg message "$stderr_tail" \
    --argjson exit_code "$provider_exit" \
    '{contract_version:"1.0",attempt_id:$attempt,status:"failed",summary:"provider process failed",artifacts:[],checks:[],decision:null,error:{code:"provider_exit",message:$message,exit_code:$exit_code},provider_metadata:({provider:$provider,session_id:(if $session == "" then null else $session end)} + (if $credential_ref == "" then {} else {credential_ref:$credential_ref,credential_copy_mutated:$credential_copy_mutated} end))}' \
    > "$normalized_file"
}

# A Codex CLI diagnostic error can coexist with a successfully completed
# primary turn. The CLI deliberately retains exit 1 in that case. Do not trust
# the result file alone: require the protocol stream to end in turn.completed,
# reject any turn.failed, and require its last agent message to equal the
# independently written --output-last-message file.
validate_codex_terminal_receipt() {
  local stdout_file="$1"
  local result_file="$2"

  [[ -s "$stdout_file" && -s "$result_file" ]] || return 1
  jq -e '
    type == "object"
    and (.status as $status
      | (
          (
            ($status | type) == "string"
            and (["completed","completed_with_concerns","needs_context","blocked"] | index($status)) != null
            and (.summary | type) == "string"
            and (.artifacts | type) == "array"
            and (.checks | type) == "array"
            and ((.decision | type) == "object" or .decision == null)
            and ((.error | type) == "object" or .error == null)
          )
          or .schema == "commander-directive/v1"
        )
    )
  ' "$result_file" >/dev/null 2>&1 || return 1

  jq -Rse --slurpfile result "$result_file" '
    (split("\n") | map(select(length > 0))) as $lines
    | [$lines[] | fromjson?] as $events
    | ($lines | length) == ($events | length)
    and ($events | length) > 0
    and ($events[-1].type == "turn.completed")
    and any($events[]; .type == "thread.started")
    and (any($events[]; .type == "turn.failed") | not)
    and (
      [$events[]
       | select(.type == "item.completed" and .item.type == "agent_message")
       | .item.text] as $messages
      | ($messages | length) > 0
      and (($messages | last | fromjson? // null) == $result[0])
    )
  ' "$stdout_file" >/dev/null 2>&1
}
# attempt-timeout-contract:end
# commander-provider-contract:end

# provider-bootstrap-failure:start
write_provider_bootstrap_failure() {
  local normalized_file="$1"
  local attempt_id="$2"
  local provider="$3"
  local summary="$4"
  local code="$5"
  local message="$6"
  local credential_ref="${7:-}"
  local credential_copy_mutated="${8:-false}"

  jq -n \
    --arg attempt "$attempt_id" \
    --arg provider "$provider" \
    --arg summary "$summary" \
    --arg code "$code" \
    --arg message "$message" \
    --arg credential_ref "$credential_ref" \
    --argjson credential_copy_mutated "$credential_copy_mutated" \
    '{contract_version:"1.0",attempt_id:$attempt,status:"failed",summary:$summary,artifacts:[],checks:[],decision:null,error:{code:$code,message:$message},provider_metadata:({provider:$provider,session_id:null} + (if $provider == "codex" and $credential_ref != "" then {credential_ref:$credential_ref,credential_copy_mutated:$credential_copy_mutated} else {} end))}' \
    > "$normalized_file"
}
# provider-bootstrap-failure:end

run_provider_contract() {
  PROVIDER_CONTRACT=1
  local task_bundle_file="${HARNESS_TASK_BUNDLE_FILE:-$PROMPT_FILE}"
  local result_schema_file="/tmp/harness-result-${HARNESS_ATTEMPT_ID}.schema.json"
  local result_file="/tmp/harness-result-${HARNESS_ATTEMPT_ID}.json"
  NORMALIZED_RESULT_FILE="/tmp/harness-result-${HARNESS_ATTEMPT_ID}.normalized.json"
  local result_schema_json
  local provider="${CECELIA_EXECUTOR:-claude}"
  local provider_session_id=""
  local provider_exit=1
  local provider_cli_exit_code=""
  local terminal_receipt=""
  local heartbeat_pid=""
  local safe_line=""
  local commander_contract=false
  local attempt_timeout_seconds=""

  if ! attempt_timeout_seconds="$(
    read_attempt_timeout_seconds "${HARNESS_TIMEOUT_SECONDS:-}"
  )"; then
    write_provider_bootstrap_failure \
      "$NORMALIZED_RESULT_FILE" "$HARNESS_ATTEMPT_ID" "$provider" \
      'Attempt timeout rejected' invalid_attempt_timeout \
      'runner rejected the bounded attempt timeout'
    return 1
  fi

  if [[ "$provider" == "codex" ]] && ! prepare_codex_credential; then
    write_provider_bootstrap_failure \
      "$NORMALIZED_RESULT_FILE" "$HARNESS_ATTEMPT_ID" "$provider" \
      'CredentialEnvelope rejected' credential_envelope_invalid \
      'runner rejected the bounded credential envelope' \
      "${CECELIA_CREDENTIAL_REF:-}" false
    return 1
  fi
  if [[ "$provider" == "codex" ]]; then
    result_file="$CODEX_HOME/harness-result.json"
  fi

  if [[ ! -f "$task_bundle_file" ]] || ! jq -e '.task_bundle' "$task_bundle_file" >/dev/null 2>&1; then
    write_provider_bootstrap_failure \
      "$NORMALIZED_RESULT_FILE" "$HARNESS_ATTEMPT_ID" "$provider" \
      'TaskBundle missing or invalid' invalid_task_bundle \
      'runner could not parse TaskBundle envelope' \
      "${CREDENTIAL_REF:-}" "${CREDENTIAL_COPY_MUTATED:-false}"
    return 1
  fi
  if ! validate_commander_task_bundle "$task_bundle_file"; then
    write_provider_bootstrap_failure \
      "$NORMALIZED_RESULT_FILE" "$HARNESS_ATTEMPT_ID" "$provider" \
      'Commander TaskBundle rejected' invalid_commander_task_bundle \
      'runner rejected the observational Commander boundary' \
      "${CREDENTIAL_REF:-}" "${CREDENTIAL_COPY_MUTATED:-false}"
    return 1
  fi
  if [[ "$(jq -r '.task_bundle.expected_output // empty' "$task_bundle_file")" == "commander-directive/v1" ]]; then
    commander_contract=true
  fi

  result_schema_json="$(provider_result_schema_json "$task_bundle_file")"
  publish_provider_result_schema "$result_schema_file" "$result_schema_json"

  if ! install_frozen_baseline_guard; then
    write_provider_bootstrap_failure \
      "$NORMALIZED_RESULT_FILE" "$HARNESS_ATTEMPT_ID" "$provider" \
      'Frozen baseline guard rejected' frozen_baseline_guard_unavailable \
      'runner could not arm the frozen baseline lineage guard' \
      "${CREDENTIAL_REF:-}" "${CREDENTIAL_COPY_MUTATED:-false}"
    return 1
  fi

  if ! prepare_evaluator_provider_identity; then
    write_provider_bootstrap_failure \
      "$NORMALIZED_RESULT_FILE" "$HARNESS_ATTEMPT_ID" "$provider" \
      'Evaluator Provider boundary rejected' evaluator_privilege_boundary_invalid \
      'runner could not isolate the Provider from trusted evidence collection' \
      "${CREDENTIAL_REF:-}" "${CREDENTIAL_COPY_MUTATED:-false}"
    return 1
  fi

  local model_args=()
  if [[ -n "${HARNESS_MODEL:-}" ]]; then
    model_args=(--model "$HARNESS_MODEL")
  fi

  # Arm the evaluator bridge before provider execution. Evidence ownership is
  # established by the exact attempt_id written by the evaluator Skill.
  prepare_evaluator_evidence

  if [[ -n "${HARNESS_LEASE_OWNER:-}" ]]; then
    (
      while :; do
        curl -sf -m 10 -X POST \
          "${BRAIN_URL:-http://host.docker.internal:5221}/api/brain/harness/attempts/${HARNESS_ATTEMPT_ID}/heartbeat" \
          -H 'Content-Type: application/json' \
          -H "Authorization: Bearer ${HARNESS_CALLBACK_TOKEN}" \
          -d "$(jq -nc --arg owner "$HARNESS_LEASE_OWNER" '{lease_owner:$owner,lease_seconds:180}')" \
          >/dev/null 2>&1 || true
        sleep 60
      done
    ) &
    heartbeat_pid=$!
  fi

  if [[ "$provider" == "codex" ]]; then
    local codex_args=(exec)
    # The Runner container is the external sandbox. In particular, reviewer and
    # judge workspaces are already mounted /workspace:ro by docker-executor.
    # Starting Codex's nested bubblewrap sandbox inside this unprivileged
    # container fails before the first command with:
    #   bwrap: No permissions to create a new namespace
    # Bypass only the inner Codex sandbox; Docker keeps the role's filesystem
    # boundary authoritative for both read-only and writable attempts.
    local codex_permission_args=(--dangerously-bypass-approvals-and-sandbox)
    local codex_command=(codex)
    if [[ "${HARNESS_CANARY:-false}" == "true" ]]; then
      codex_permission_args+=(
        --ignore-user-config
        --ignore-rules
        --ephemeral
        --disable shell_tool
        --disable unified_exec
        --disable code_mode_host
        --disable browser_use
        --disable browser_use_external
        --disable browser_use_full_cdp_access
        --disable apps
        --disable enable_mcp_apps
        --disable plugins
        --disable image_generation
        --disable standalone_web_search
        --disable computer_use
        --disable in_app_browser
        --disable multi_agent
        --disable multi_agent_v2
        --disable hooks
        --disable auth_elicitation
        --disable plugin_sharing
        --disable remote_plugin
        --disable skill_mcp_dependency_install
        --disable skill_search
        --disable tool_call_mcp_elicitation
        --disable tool_suggest
        --disable request_permissions_tool
        --disable workspace_dependencies
        --disable goals
      )
      codex_command=(
        env
        -u BRAIN_URL
        -u HARNESS_CALLBACK_URL
        -u HARNESS_CALLBACK_TOKEN
        -u HARNESS_LEASE_OWNER
        -u HARNESS_LEASE_GENERATION
        codex
      )
    elif [[ "$commander_contract" == "true" ]]; then
      codex_permission_args+=(
        --ignore-user-config
        --ignore-rules
        --ephemeral
        --disable shell_tool
        --disable unified_exec
        --disable code_mode_host
        --disable browser_use
        --disable apps
        --disable plugins
        --disable multi_agent
        --disable multi_agent_v2
        --disable hooks
        --disable goals
      )
    fi
    if [[ -n "${HARNESS_RESUME_SESSION_ID:-}" ]]; then
      codex_args+=(resume "$HARNESS_RESUME_SESSION_ID")
    fi
    codex_args+=(
      --json
      --output-schema "$result_schema_file"
      --output-last-message "$result_file"
      --skip-git-repo-check
      "${codex_permission_args[@]}"
      "${model_args[@]}"
      -
    )
    : > "$STDOUT_FILE"
    run_with_attempt_timeout \
      "$attempt_timeout_seconds" \
      "${PROVIDER_IDENTITY_PREFIX[@]}" \
      "${codex_command[@]}" "${codex_args[@]}" < "$task_bundle_file" 2>&1 \
      | while IFS= read -r line || [[ -n "$line" ]]; do
          safe_line=$(printf '%s\n' "$line" | redact_provider_credential_text)
          printf '%s\n' "$safe_line" | tee -a "$STDOUT_FILE"
          live_session=$(printf '%s\n' "$safe_line" \
            | jq -r 'select(.type == "thread.started") | (.thread_id // .thread.id // empty)' 2>/dev/null \
            || true)
          [[ -z "$live_session" ]] || persist_provider_session "$live_session" || true
        done
    provider_exit=${PIPESTATUS[0]}
    provider_session_id=$(jq -r 'select(.type == "thread.started") | (.thread_id // .thread.id // empty)' "$STDOUT_FILE" 2>/dev/null | head -n 1)
  elif [[ "$provider" == "claude" ]]; then
    local claude_args=(-p --output-format json --json-schema "$result_schema_json")
    if [[ "${HARNESS_READ_ONLY:-false}" == "true" ]]; then
      claude_args+=(--permission-mode plan)
    else
      claude_args+=(--dangerously-skip-permissions)
    fi
    if [[ -n "${HARNESS_RESUME_SESSION_ID:-}" ]]; then
      claude_args+=(--resume "$HARNESS_RESUME_SESSION_ID")
    else
      # Claude JSON output exposes session_id only at process exit. Pre-allocate a
      # deterministic UUID so watchdog can resume even if the container dies mid-run.
      provider_session_id="$HARNESS_ATTEMPT_ID"
      claude_args+=(--session-id "$provider_session_id")
      persist_provider_session "$provider_session_id" || true
    fi
    claude_args+=("${model_args[@]}")
    : > "$STDOUT_FILE"
    run_with_attempt_timeout \
      "$attempt_timeout_seconds" \
      "${PROVIDER_IDENTITY_PREFIX[@]}" \
      claude "${claude_args[@]}" < "$task_bundle_file" 2>&1 \
      | while IFS= read -r line || [[ -n "$line" ]]; do
          safe_line=$(printf '%s\n' "$line" | redact_provider_credential_text)
          printf '%s\n' "$safe_line" | tee -a "$STDOUT_FILE"
        done
    provider_exit=${PIPESTATUS[0]}
    if [[ $provider_exit -eq 0 ]]; then
      jq -c '
        if .structured_output then .structured_output
        elif (.result | type) == "object" then .result
        else (.result | fromjson)
        end
      ' "$STDOUT_FILE" > "$result_file" 2>/dev/null || provider_exit=1
    fi
    provider_session_id=$(jq -r '.session_id // empty' "$STDOUT_FILE" 2>/dev/null || true)
  elif [[ "$provider" == "grok" ]]; then
    local grok_args=(
      --cwd "${WORKTREE_PATH:-$PWD}"
      --always-approve
      --output-format json
      --json-schema "$result_schema_json"
    )
    if [[ -n "${HARNESS_RESUME_SESSION_ID:-}" ]]; then
      grok_args+=(--resume "$HARNESS_RESUME_SESSION_ID")
    else
      provider_session_id="$HARNESS_ATTEMPT_ID"
      grok_args+=(--session-id "$provider_session_id")
      persist_provider_session "$provider_session_id" || true
    fi
    grok_args+=("${model_args[@]}")
    : > "$STDOUT_FILE"
    run_with_attempt_timeout \
      "$attempt_timeout_seconds" \
      "${PROVIDER_IDENTITY_PREFIX[@]}" \
      grok -p "$(cat "$task_bundle_file")" "${grok_args[@]}" 2>&1 \
      | while IFS= read -r line || [[ -n "$line" ]]; do
          safe_line=$(printf '%s\n' "$line" | redact_provider_credential_text)
          printf '%s\n' "$safe_line" | tee -a "$STDOUT_FILE"
        done
    provider_exit=${PIPESTATUS[0]}
    if [[ $provider_exit -eq 0 ]]; then
      jq -c '
        if .structuredOutput then .structuredOutput
        elif .structured_output then .structured_output
        elif (.result | type) == "object" then .result
        elif (.result | type) == "string" then (.result | fromjson)
        else .
        end
      ' "$STDOUT_FILE" > "$result_file" 2>/dev/null || provider_exit=1
    fi
    provider_session_id=$(jq -r '.sessionId // .session_id // .session.id // empty' "$STDOUT_FILE" 2>/dev/null || true)
  else
    provider_exit=1
    printf '{"error":"unsupported provider: %s"}\n' "$provider" > "$STDOUT_FILE"
  fi
  if [[ "$provider" == "codex" && $provider_exit -ne 0 && $provider_exit -ne 124 ]] \
      && validate_codex_terminal_receipt "$STDOUT_FILE" "$result_file"; then
    provider_cli_exit_code="$provider_exit"
    terminal_receipt='turn.completed'
    provider_exit=0
    echo "[entrypoint] recovered completed Codex turn from CLI exit $provider_cli_exit_code" >&2
  fi
  if ! verify_evaluator_evidence_capsule; then
    provider_exit=1
    printf '%s\n' '{"error":"github_evidence_capsule_tampered"}' >> "$STDOUT_FILE"
  fi
  redact_provider_credential_file "$result_file" || provider_exit=1

  # Persist the session before the terminal callback. If callback delivery fails after
  # the CLI exits, watchdog can still reclaim and resume this exact attempt/session.
  [[ -z "$provider_session_id" ]] || persist_provider_session "$provider_session_id" || true

  if [[ -n "$heartbeat_pid" ]]; then
    kill "$heartbeat_pid" >/dev/null 2>&1 || true
    wait "$heartbeat_pid" 2>/dev/null || true
  fi

  if [[ "$provider" == "codex" ]]; then
    record_codex_credential_mutation
  fi

  local provider_success=false
  if [[ $provider_exit -eq 0 ]]; then
    if [[ "$commander_contract" == "true" ]]; then
      jq -e 'type == "object" and .schema == "commander-directive/v1"' \
        "$result_file" >/dev/null 2>&1 && provider_success=true
    else
      jq -e 'type == "object" and .status' "$result_file" >/dev/null 2>&1 \
        && provider_success=true
    fi
  fi
  # Provider 已退出，改不动这一层。血统断了就把整个 Attempt 判死，
  # 由 Kernel 侧的 callback 服务端校验做最后一道 fail-closed。
  if ! assert_frozen_baseline_lineage; then
    provider_success=false
    provider_exit=1
    printf '%s\n' '{"error":"frozen_baseline_violation"}' >> "$STDOUT_FILE"
  fi
  if [[ "$provider_success" == "true" ]]; then
    finalize_proposer_output || {
      echo "[entrypoint] proposer finalizer did not establish remote branch; Kernel no-push detector remains authoritative" >&2
    }
    if ! finalize_planner_output "$result_file"; then
      echo "[entrypoint] planner finalizer did not establish a verified Git artifact" >&2
      provider_success=false
      provider_exit=1
    fi
  fi
  if [[ "$provider_success" == "true" ]]; then
    normalize_provider_success \
      "$task_bundle_file" \
      "$result_file" \
      "$NORMALIZED_RESULT_FILE" \
      "$HARNESS_ATTEMPT_ID" \
      "$provider" \
      "$provider_session_id" \
      "$CREDENTIAL_REF" \
      "$CREDENTIAL_COPY_MUTATED" \
      "$provider_cli_exit_code" \
      "$terminal_receipt"
  else
    normalize_provider_failure \
      "$NORMALIZED_RESULT_FILE" \
      "$HARNESS_ATTEMPT_ID" \
      "$provider" \
      "$provider_session_id" \
      "$CREDENTIAL_REF" \
      "$CREDENTIAL_COPY_MUTATED" \
      "$provider_exit" \
      "$STDOUT_FILE"
  fi
  merge_evaluator_evidence "$NORMALIZED_RESULT_FILE" || true
  return "$provider_exit"
}
# provider-neutral:end

# v1.229.0: 不再用 `exec claude` 直接接管进程。改为先在子进程跑 claude，
# 拿到 exit code 后向 brain POST callback（让 LangGraph interrupt resume），
# 再用同一 exit code 退出容器。HARNESS_NODE/CECELIA_TASK_ID 任一为空时
# 走旧 exec 路径，保持非 harness 任务零变更。

run_claude() {
  if [[ -f "$PROMPT_FILE" ]]; then
    claude -p --dangerously-skip-permissions --output-format json "${MODEL_FLAGS[@]}" "${GOAL_FLAGS[@]}" < "$PROMPT_FILE" 2>&1 | tee "$STDOUT_FILE"
    return ${PIPESTATUS[0]}
  else
    claude -p --dangerously-skip-permissions --output-format json "${MODEL_FLAGS[@]}" "${GOAL_FLAGS[@]}" "$@" 2>&1 | tee "$STDOUT_FILE"
    return ${PIPESTATUS[0]}
  fi
}

# 非 harness 任务（如手动 docker run、self-drive 普通容器）走老 exec 路径
if [[ -z "${CECELIA_TASK_ID:-}" || -z "${HARNESS_NODE:-}" ]]; then
  if [[ -f "$PROMPT_FILE" ]]; then
    exec claude -p --dangerously-skip-permissions --output-format json "${MODEL_FLAGS[@]}" "${GOAL_FLAGS[@]}" < "$PROMPT_FILE"
  else
    exec claude -p --dangerously-skip-permissions --output-format json "${MODEL_FLAGS[@]}" "${GOAL_FLAGS[@]}" "$@"
  fi
fi

# Harness 任务路径：跑完 → POST callback → 用 exit code 退出
# set -e 已开，必须临时关掉避免失败时跳过 callback

# B7: CECELIA_EXECUTOR=codex 分支
# CODEX_RELAY_HOME 挂载目录（~/.codex-team2，含 auth/config）
CODEX_RELAY_HOME="${CODEX_RELAY_HOME:-/home/cecelia/.codex-team2}"

# B7 真实性校验：只认"真实错误行"（带 ERROR/FATAL 标记的行）里的关键词。
# 裸词全文匹配会把 agent 自然语言总结（如复述"usage limit 治理"类 PRD）误判为失败，
# 连环击杀正常任务（2026-07-21 两例实锤，issue 在案）。
scan_error_keywords() {
  local f="$1"
  [[ -f "$f" ]] || return 1
  grep -E '(^|[[:space:]])(ERROR|FATAL)([:[:space:]]|$)' "$f" 2>/dev/null \
    | grep -qiE '401|unauthorized|usage limit|stream error'
}

set +e
if [[ -n "${HARNESS_ATTEMPT_ID:-}" ]]; then
  run_provider_contract
  EXIT_CODE=$?
elif [[ "${CECELIA_EXECUTOR:-}" = "codex" ]]; then
  # B7: codex exec 分支
  if [[ -f "$PROMPT_FILE" ]]; then
    codex exec -c approval_policy="never" -c sandbox_mode="danger-full-access" < "$PROMPT_FILE" 2>&1 | tee "$STDOUT_FILE"
  else
    codex exec -c approval_policy="never" -c sandbox_mode="danger-full-access" "$@" 2>&1 | tee "$STDOUT_FILE"
  fi
  EXIT_CODE=${PIPESTATUS[0]}

  # B7: exit=0 但 stdout 的真实错误行含关键词 → 覆写为退出码 1（真实性校验）
  if [[ $EXIT_CODE -eq 0 ]] && scan_error_keywords "$STDOUT_FILE"; then
    echo "[entrypoint] codex exit=0 but error keyword detected → overriding EXIT_CODE=1" >&2
    EXIT_CODE=1
  fi

  # B7: token 洗敏（ghp_/gho_/ghs_/github_pat_ 替换为 ***REDACTED***）
  if [[ -f "$STDOUT_FILE" ]]; then
    sed -i \
      -e 's/ghp_[A-Za-z0-9_]*/***REDACTED***/g' \
      -e 's/gho_[A-Za-z0-9_]*/***REDACTED***/g' \
      -e 's/ghs_[A-Za-z0-9_]*/***REDACTED***/g' \
      -e 's/github_pat_[A-Za-z0-9_]*/***REDACTED***/g' \
      "$STDOUT_FILE" 2>/dev/null || true
  fi

  echo "[entrypoint] goal-hook N/A for codex" >&2
elif [[ "${CECELIA_EXECUTOR:-}" = "grok" ]]; then
  # INV-2 + GP6: grok 显式分支（三分支修正——旧版仅 codex/claude 二元，grok 落入 run_claude）
  # headless grok 走 run_provider_contract（HARNESS_ATTEMPT_ID 路径），此处为旧路径兜底
  if [[ -f "$PROMPT_FILE" ]]; then
    grok -p "$(cat "$PROMPT_FILE")" --output-format json --always-approve 2>&1 | tee "$STDOUT_FILE"
  else
    grok -p "" --output-format json --always-approve "$@" 2>&1 | tee "$STDOUT_FILE"
  fi
  EXIT_CODE=${PIPESTATUS[0]}
  echo "[entrypoint] goal-hook N/A for grok" >&2
elif [[ -z "${CECELIA_EXECUTOR:-}" || "${CECELIA_EXECUTOR:-}" = "claude" ]]; then
  run_claude "$@"
  EXIT_CODE=$?
else
  # INV-2 + GP7: 未知 executor loud-fail（exit 1 + 明确错误信息）
  echo "[entrypoint] unsupported executor: ${CECELIA_EXECUTOR}" >&2
  echo "[entrypoint] supported values: claude, codex, grok (or empty for default claude)" >&2
  EXIT_CODE=1
  exit 1
fi
set -e

if [[ $PROVIDER_CONTRACT -eq 1 ]]; then
  CALLBACK_BODY=$(cat "$NORMALIZED_RESULT_FILE")
else
  STDOUT_CONTENT=""
  if [[ -f "$STDOUT_FILE" ]]; then
    STDOUT_CONTENT=$(tail -c 4000 "$STDOUT_FILE" 2>/dev/null || echo "")
  fi
  # jq -Rs 把任意 stdout 安全编码成 JSON 字符串（含换行、引号）
  STDOUT_JSON=$(printf '%s' "$STDOUT_CONTENT" | jq -Rs . 2>/dev/null || echo '""')
  CALLBACK_BODY=$(printf '{"result":"completed","exit_code":%d,"stdout":%s}' "$EXIT_CODE" "$STDOUT_JSON")
fi

# 优先用 Layer 3 spawnNode 传的 HARNESS_CALLBACK_URL（含完整 URL + --name 作 containerId），
# fallback HOSTNAME（旧方式，但 Layer 3 spawn 给 docker 起的 --name ≠ HOSTNAME，会导致 callback router 找不到 thread_lookup）。
TARGET_URL="${HARNESS_CALLBACK_URL:-}"
if [[ -z "$TARGET_URL" ]]; then
  CONTAINER_ID="${HOSTNAME:-$(cat /etc/hostname 2>/dev/null || echo unknown)}"
  TARGET_URL="http://host.docker.internal:5221/api/brain/harness/callback/${CONTAINER_ID}"
fi

CALLBACK_OK=0
CALLBACK_HEADERS=(-H "Content-Type: application/json")
if [[ -n "${HARNESS_ATTEMPT_ID:-}" ]]; then
  CALLBACK_HEADERS+=(
    -H "Authorization: Bearer ${HARNESS_CALLBACK_TOKEN}"
    -H "X-Harness-Lease-Owner: ${HARNESS_LEASE_OWNER}"
    -H "X-Harness-Lease-Generation: ${HARNESS_LEASE_GENERATION}"
  )
fi
_retry=0
while [[ $CALLBACK_OK -eq 0 ]]; do
  _retry=$((_retry + 1))
  if curl -sf -m 10 -X POST "$TARGET_URL" \
      "${CALLBACK_HEADERS[@]}" \
      -d "$CALLBACK_BODY" >/dev/null 2>&1; then
    echo "[entrypoint] harness callback POST ok (url=${TARGET_URL} exit=${EXIT_CODE} attempt=${_retry})"
    CALLBACK_OK=1
    break
  fi

  # A callback is the terminal claim, not best-effort telemetry. Keep its lease
  # alive and remain the retry executor until Brain returns 2xx or the control
  # plane explicitly cancels this container.
  if [[ -n "${HARNESS_ATTEMPT_ID:-}" && -n "${HARNESS_LEASE_OWNER:-}" ]]; then
    curl -sf -m 10 -X POST \
      "${BRAIN_URL:-http://host.docker.internal:5221}/api/brain/harness/attempts/${HARNESS_ATTEMPT_ID}/heartbeat" \
      -H 'Content-Type: application/json' \
      -H "Authorization: Bearer ${HARNESS_CALLBACK_TOKEN}" \
      -d "$(jq -nc --arg owner "$HARNESS_LEASE_OWNER" '{lease_owner:$owner,lease_seconds:180}')" \
      >/dev/null 2>&1 || true
  elif [[ $_retry -ge 5 ]]; then
    # Legacy relay callbacks have no Attempt lease/cancel authority. Preserve
    # their historical bounded behavior; durable retry is a Kernel contract.
    echo "[entrypoint] legacy harness callback retry budget exhausted (url=${TARGET_URL})"
    break
  fi
  case $_retry in
    1) _sleep=3 ;;
    2) _sleep=6 ;;
    3) _sleep=12 ;;
    *) _sleep=24 ;;
  esac
  echo "[entrypoint] harness callback attempt ${_retry} 失败，${_sleep}s 后重试（等待 Brain durable 2xx）..."
  sleep "$_sleep"
done

exit "$EXIT_CODE"
