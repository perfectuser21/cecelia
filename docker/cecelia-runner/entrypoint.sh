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

# git-auth-setup:start
# 宿主 gitconfig 可能引用只在 macOS 宿主存在的 credential helper。Runner 已只读挂载
# ~/.config/gh，因此让容器内 gh 在可写副本中安装自身 helper；不把 token 放进 docker
# argv/日志。无有效 gh 登录时保留原失败语义，由 capability gate 结构化拦截。
if [[ "${HARNESS_CANARY:-false}" != "true" ]] && command -v gh >/dev/null 2>&1; then
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
  local round=""
  local workspace_abs=""
  local sprint_abs=""
  local brain_result_file=""
  local normalized_result_tmp=""

  if [[ ! "$task_id" =~ ^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$ ]]; then
    echo "[entrypoint] proposer finalizer rejected invalid task id" >&2
    return 1
  fi
  task_short="${task_id:0:8}"
  if [[ ! "$branch" =~ ^cp-harness-propose-r([0-9]+)-${task_short}-a[0-9]+$ ]]; then
    echo "[entrypoint] proposer finalizer rejected branch outside task scope: $branch" >&2
    return 1
  fi
  round="${BASH_REMATCH[1]}"

  if [[ "$sprint_dir" != sprints/* || "$sprint_dir" == *".."* \
      || "$sprint_dir" == *$'\n'* || "$sprint_dir" == *$'\r'* ]]; then
    echo "[entrypoint] proposer finalizer rejected sprint path: $sprint_dir" >&2
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

# evaluator-evidence-bridge:start
EVALUATOR_EVIDENCE_PREPARED=0

prepare_evaluator_evidence() {
  [[ "${HARNESS_NODE:-}" == "evaluator" ]] || return 0
  EVALUATOR_EVIDENCE_PREPARED=1
}

merge_evaluator_evidence() {
  local normalized_result_file="$1"
  local brain_result_file
  local merged_result_file="${normalized_result_file}.evidence"

  [[ "${HARNESS_NODE:-}" == "evaluator" ]] || return 0
  [[ "$EVALUATOR_EVIDENCE_PREPARED" == "1" ]] || return 0

  if [[ "${BRAIN_RESULT_CHANNEL_VERSION+x}" == "x" ]]; then
    [[ "$BRAIN_RESULT_CHANNEL_VERSION" == "attempt-result-file/v1" ]] || return 1
    [[ "${BRAIN_RESULT_FILE+x}" == "x" && -n "$BRAIN_RESULT_FILE" ]] || return 1
    brain_result_file="$BRAIN_RESULT_FILE"
  elif [[ "${BRAIN_RESULT_FILE+x}" == "x" ]]; then
    [[ -n "$BRAIN_RESULT_FILE" ]] || return 1
    brain_result_file="$BRAIN_RESULT_FILE"
  else
    brain_result_file="${WORKTREE_PATH:-$PWD}/.brain-result.json"
  fi

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

# commander-provider-contract:start
provider_result_schema_json() {
  local task_bundle_file="$1"
  local expected_output
  expected_output=$(jq -r '.task_bundle.expected_output // empty' "$task_bundle_file")
  if [[ "$expected_output" == "commander-directive/v1" ]]; then
    printf '%s' '{"type":"object","properties":{"schema":{"const":"commander-directive/v1"},"run_id":{"type":"string","format":"uuid"},"event_cursor":{"type":"integer","minimum":0},"action":{"type":"string","enum":["continue_default","dispatch_role","retry_attempt","revise_guidance","switch_provider","switch_machine","pause_run","request_human","abort_run"]},"target_role":{"type":"string","enum":["commander","planner","proposer","reviewer","generator","evaluator","judge"]},"target_attempt_id":{"type":"string","format":"uuid"},"reason":{"type":"string","minLength":1,"maxLength":4000},"guidance":{"type":"string","maxLength":4000},"route":{"type":"object","properties":{"machine":{"type":"string"},"provider":{"type":"string"},"account":{"type":"string"},"model":{"type":"string"}},"additionalProperties":false},"evidence_refs":{"type":"array","minItems":1,"maxItems":128,"items":{"type":"string","pattern":"^(event:[1-9][0-9]*|attempt:[0-9a-fA-F-]{36})$"}}},"required":["schema","run_id","event_cursor","action","reason","evidence_refs"],"additionalProperties":false}'
    return
  fi
  printf '%s' '{"type":"object","properties":{"status":{"type":"string","enum":["completed","completed_with_concerns","needs_context","blocked"]},"summary":{"type":"string"},"artifacts":{"type":"array","items":{"type":"string"}},"checks":{"type":"array","items":{"type":"string"}},"decision":{"anyOf":[{"type":"object","properties":{"outcome":{"type":"string"},"reason":{"type":"string"}},"required":["outcome","reason"],"additionalProperties":false},{"type":"null"}]},"error":{"anyOf":[{"type":"object","properties":{"code":{"type":"string"},"message":{"type":"string"}},"required":["code","message"],"additionalProperties":false},{"type":"null"}]}},"required":["status","summary","artifacts","checks","decision","error"],"additionalProperties":false}'
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
  local expected_output
  expected_output=$(jq -r '.task_bundle.expected_output // empty' "$task_bundle_file")

  if [[ "$expected_output" == "commander-directive/v1" ]]; then
    jq \
      --arg attempt "$attempt_id" \
      --arg provider "$provider" \
      --arg session "$session_id" \
      --arg credential_ref "$credential_ref" \
      --argjson credential_copy_mutated "$credential_copy_mutated" \
      '{
         contract_version: "1.0",
         attempt_id: $attempt,
         status: "completed",
         summary: .reason,
         artifacts: [],
         checks: [],
         decision: .,
         error: null,
         provider_metadata: ({
           provider: $provider,
           session_id: (if $session == "" then null else $session end)
         } + (if $credential_ref == "" then {} else {
           credential_ref: $credential_ref,
           credential_copy_mutated: $credential_copy_mutated
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
    '.contract_version = (.contract_version // "1.0")
     | .attempt_id = $attempt
     | .provider_metadata = ((.provider_metadata // {}) + {
         provider: $provider,
         session_id: (if $session == "" then null else $session end)
       } + (if $credential_ref == "" then {} else {
         credential_ref: $credential_ref,
         credential_copy_mutated: $credential_copy_mutated
       } end))' \
    "$result_file" > "$normalized_file"
}
# commander-provider-contract:end

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
  local heartbeat_pid=""
  local safe_line=""
  local commander_contract=false

  if [[ "$provider" == "codex" ]] && ! prepare_codex_credential; then
    jq -n \
      --arg attempt "$HARNESS_ATTEMPT_ID" \
      --arg provider "$provider" \
      --arg credential_ref "${CECELIA_CREDENTIAL_REF:-}" \
      '{contract_version:"1.0",attempt_id:$attempt,status:"failed",summary:"CredentialEnvelope rejected",artifacts:[],checks:[],decision:null,error:{code:"credential_envelope_invalid",message:"runner rejected the bounded credential envelope"},provider_metadata:{provider:$provider,session_id:null,credential_ref:$credential_ref,credential_copy_mutated:false}}' \
      > "$NORMALIZED_RESULT_FILE"
    return 1
  fi
  if [[ "$provider" == "codex" ]]; then
    result_file="$CODEX_HOME/harness-result.json"
  fi

  if [[ ! -f "$task_bundle_file" ]] || ! jq -e '.task_bundle' "$task_bundle_file" >/dev/null 2>&1; then
    jq -n \
      --arg attempt "$HARNESS_ATTEMPT_ID" \
      --arg provider "$provider" \
      '{contract_version:"1.0",attempt_id:$attempt,status:"failed",summary:"TaskBundle missing or invalid",artifacts:[],checks:[],decision:null,error:{code:"invalid_task_bundle",message:"runner could not parse TaskBundle envelope"},provider_metadata:{provider:$provider,session_id:null}}' \
      > "$NORMALIZED_RESULT_FILE"
    return 1
  fi
  if ! validate_commander_task_bundle "$task_bundle_file"; then
    jq -n \
      --arg attempt "$HARNESS_ATTEMPT_ID" \
      --arg provider "$provider" \
      '{contract_version:"1.0",attempt_id:$attempt,status:"failed",summary:"Commander TaskBundle rejected",artifacts:[],checks:[],decision:null,error:{code:"invalid_commander_task_bundle",message:"runner rejected the observational Commander boundary"},provider_metadata:{provider:$provider,session_id:null}}' \
      > "$NORMALIZED_RESULT_FILE"
    return 1
  fi
  if [[ "$(jq -r '.task_bundle.expected_output // empty' "$task_bundle_file")" == "commander-directive/v1" ]]; then
    commander_contract=true
  fi

  result_schema_json='{"type":"object","properties":{"status":{"type":"string","enum":["completed","completed_with_concerns","needs_context","blocked"]},"summary":{"type":"string"},"artifacts":{"type":"array","items":{"type":"string"}},"checks":{"type":"array","items":{"type":"string"}},"decision":{"anyOf":[{"type":"object","properties":{"outcome":{"type":"string"},"reason":{"type":"string"}},"required":["outcome","reason"],"additionalProperties":false},{"type":"null"}]},"error":{"anyOf":[{"type":"object","properties":{"code":{"type":"string"},"message":{"type":"string"}},"required":["code","message"],"additionalProperties":false},{"type":"null"}]}},"required":["status","summary","artifacts","checks","decision","error"],"additionalProperties":false}'
  if [[ "$commander_contract" == "true" ]]; then
    result_schema_json="$(provider_result_schema_json "$task_bundle_file")"
  fi
  printf '%s' "$result_schema_json" > "$result_schema_file"

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
    "${codex_command[@]}" "${codex_args[@]}" < "$task_bundle_file" 2>&1 \
      | while IFS= read -r line || [[ -n "$line" ]]; do
          safe_line=$(printf '%s\n' "$line" | redact_codex_credential_text)
          printf '%s\n' "$safe_line" | tee -a "$STDOUT_FILE"
          live_session=$(printf '%s\n' "$safe_line" \
            | jq -r 'select(.type == "thread.started") | (.thread_id // .thread.id // empty)' 2>/dev/null \
            || true)
          [[ -z "$live_session" ]] || persist_provider_session "$live_session" || true
        done
    provider_exit=${PIPESTATUS[0]}
    redact_codex_credential_file "$result_file" || provider_exit=1
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
    claude "${claude_args[@]}" < "$task_bundle_file" 2>&1 | tee "$STDOUT_FILE"
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
    grok -p "$(cat "$task_bundle_file")" "${grok_args[@]}" 2>&1 | tee "$STDOUT_FILE"
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
  if [[ "$provider_success" == "true" ]]; then
    finalize_proposer_output || {
      echo "[entrypoint] proposer finalizer did not establish remote branch; Kernel no-push detector remains authoritative" >&2
    }
    normalize_provider_success \
      "$task_bundle_file" \
      "$result_file" \
      "$NORMALIZED_RESULT_FILE" \
      "$HARNESS_ATTEMPT_ID" \
      "$provider" \
      "$provider_session_id" \
      "$CREDENTIAL_REF" \
      "$CREDENTIAL_COPY_MUTATED"
  else
    local stderr_tail
    stderr_tail=$(tail -c 2000 "$STDOUT_FILE" 2>/dev/null || true)
    jq -n \
      --arg attempt "$HARNESS_ATTEMPT_ID" \
      --arg provider "$provider" \
      --arg session "$provider_session_id" \
      --arg credential_ref "$CREDENTIAL_REF" \
      --argjson credential_copy_mutated "$CREDENTIAL_COPY_MUTATED" \
      --arg message "$stderr_tail" \
      --argjson exit_code "$provider_exit" \
      '{contract_version:"1.0",attempt_id:$attempt,status:"failed",summary:"provider process failed",artifacts:[],checks:[],decision:null,error:{code:"provider_exit",message:$message,exit_code:$exit_code},provider_metadata:({provider:$provider,session_id:(if $session == "" then null else $session end)} + (if $credential_ref == "" then {} else {credential_ref:$credential_ref,credential_copy_mutated:$credential_copy_mutated} end))}' \
      > "$NORMALIZED_RESULT_FILE"
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
  )
fi
for _retry in 1 2 3 4 5; do
  if curl -sf -m 10 -X POST "$TARGET_URL" \
      "${CALLBACK_HEADERS[@]}" \
      -d "$CALLBACK_BODY" >/dev/null 2>&1; then
    echo "[entrypoint] harness callback POST ok (url=${TARGET_URL} exit=${EXIT_CODE} attempt=${_retry})"
    CALLBACK_OK=1
    break
  fi
  if [[ $_retry -lt 5 ]]; then
    case $_retry in
      1) _sleep=3 ;;
      2) _sleep=6 ;;
      3) _sleep=12 ;;
      *) _sleep=24 ;;
    esac
    echo "[entrypoint] harness callback attempt ${_retry}/5 失败，${_sleep}s 后重试（指数退避）..."
    sleep "$_sleep"
  fi
done
if [[ $CALLBACK_OK -eq 0 ]]; then
  echo "[entrypoint] harness callback POST 全部失败（不阻塞容器退出）— url=${TARGET_URL} exit=${EXIT_CODE}"
fi

exit "$EXIT_CODE"
