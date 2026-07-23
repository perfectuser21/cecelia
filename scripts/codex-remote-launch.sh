#!/usr/bin/env bash
# codex-remote-launch.sh — codex 跨机 token 集中管理 launcher
#
# 设计目标：
#   美国本机（us-mac）= 唯一 token 管理/刷新点
#   西安 M4（xian-m4）= 纯执行体（只收 token、跑 codex，禁止 login/刷新）
#
# 目录布局发现逻辑（2026-07-20 实测，以本机 + 远端 ls 为准）：
#   ❌ 不存在 ~/.codex-accounts/<team>/auth.json
#   ✅ 实际布局：~/.codex-team{1..5}/auth.json
#      本机：team1/2/3 有 auth.json；team4/5 目录在但常无 auth（需先在本机 login）
#      远端 xian-m4：team2/3/4/5 均有 auth.json
#   启动约定（西安 history 实测）：CODEX_HOME=~/.codex-teamN codex [PROMPT]
#   西安 codex 路径：/opt/homebrew/bin/codex
#
# 用法：
#   # 推送 token + 拉起远程 tmux 会话（brief 可选）
#   bash scripts/codex-remote-launch.sh --team team3
#   bash scripts/codex-remote-launch.sh --team team3 --brief /path/to/task.md
#
#   # 回收：远端 auth.json 比本机新时才拉回
#   bash scripts/codex-remote-launch.sh --collect --team team3
#   bash scripts/codex-remote-launch.sh --collect   # team3+4+5
#
# 环境变量：
#   CODEX_REMOTE_HOST  默认 xian-m4；Tailscale 不可达时可设 xian-m4-cf 等
#
# 红线：
#   - 绝不在西安侧执行 codex login / 任何触发 token 刷新的认证命令
#   - token 内容绝不打印到 stdout/日志
#   - 本机与远端 auth.json 均为 mode 600
#   - auth.json 在 $HOME 下，不进 git（仓库外路径）
#
set -euo pipefail

ALLOWED_TEAMS=(team1 team2 team3 team4 team5)
ALLOWED_TEAMS_STR="$(IFS='|'; echo "${ALLOWED_TEAMS[*]}")"
REMOTE_HOST="${CODEX_REMOTE_HOST:-xian-m4}"
REMOTE_CODEX_BIN="${CODEX_REMOTE_BIN:-/opt/homebrew/bin/codex}"
REMOTE_PATH_PREFIX="/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LOCAL_EXIT_GUARD="${CODEX_EXIT_GUARD:-${SCRIPT_DIR}/codex-us-exit-guard.sh}"

TEAM=""
BRIEF=""
COLLECT=0
DRY_RUN=0
REMOTE_GUARD=""
REMOTE_GUARD_STATE=""
REMOTE_GUARD_PREPARED=0
REMOTE_GUARD_HANDED_OFF=0

usage() {
  cat <<EOF
用法:
  scripts/codex-remote-launch.sh --team <${ALLOWED_TEAMS_STR}> [--brief <任务书路径>]
  scripts/codex-remote-launch.sh --collect [--team <${ALLOWED_TEAMS_STR}>]
  scripts/codex-remote-launch.sh --team team3 --dry-run

选项:
  --team TEAM     账号：${ALLOWED_TEAMS_STR}（collect 时可省略=全部）
  --brief PATH    可选任务书；缺省只同步 token + 起交互会话
  --collect       回收模式：远端 auth.json 更新才拉回本机
  --dry-run       只打印将执行的动作（不涉及 token 内容）
  -h, --help      帮助
EOF
}

log() { printf '[codex-remote-launch] %s\n' "$*"; }
die() { printf '[codex-remote-launch] ERROR: %s\n' "$*" >&2; exit 1; }

# 解析参数
while [[ $# -gt 0 ]]; do
  case "$1" in
    --team)
      [[ $# -ge 2 ]] || die "--team 需要参数"
      TEAM="$2"
      shift 2
      ;;
    --brief)
      [[ $# -ge 2 ]] || die "--brief 需要参数"
      BRIEF="$2"
      shift 2
      ;;
    --collect)
      COLLECT=1
      shift
      ;;
    --dry-run)
      DRY_RUN=1
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      die "未知参数: $1（见 --help）"
      ;;
  esac
done

is_allowed_team() {
  local t="$1"
  local a
  for a in "${ALLOWED_TEAMS[@]}"; do
    [[ "$a" == "$t" ]] && return 0
  done
  return 1
}

# 本地 CODEX_HOME 解析：优先 ~/.codex-teamN，兼容探测 ~/.codex-accounts/N
resolve_local_home() {
  local team="$1"
  local candidate
  candidate="${HOME}/.codex-${team}"
  if [[ -d "$candidate" ]]; then
    printf '%s' "$candidate"
    return 0
  fi
  # 兼容假设布局（实测不存在，但保留探测）
  candidate="${HOME}/.codex-accounts/${team}"
  if [[ -d "$candidate" ]]; then
    printf '%s' "$candidate"
    return 0
  fi
  return 1
}

local_auth_path() {
  local home
  home="$(resolve_local_home "$1")" || return 1
  printf '%s/auth.json' "$home"
}

remote_auth_path() {
  # 远端与本机同布局：~/.codex-teamN/auth.json（scp/ssh 路径用 ~）
  printf '~/.codex-%s/auth.json' "$1"
}

remote_home_path() {
  # 供 mkdir 等 ssh 命令使用（~ 在未转义时展开）
  printf '~/.codex-%s' "$1"
}

# 在远端 bash -lc 单引号命令内使用：$HOME 可展开，~ 不行
remote_home_env() {
  printf '$HOME/.codex-%s' "$1"
}

file_mtime_epoch() {
  # macOS stat -f %m；Linux stat -c %Y
  local f="$1"
  if stat -f %m "$f" >/dev/null 2>&1; then
    stat -f %m "$f"
  else
    stat -c %Y "$f"
  fi
}

ssh_cmd() {
  ssh -o BatchMode=yes -o ConnectTimeout=30 "$REMOTE_HOST" "$@"
}

assert_ssh() {
  if ! ssh_cmd 'echo ok' >/dev/null 2>&1; then
    die "无法 SSH 到 ${REMOTE_HOST}。请检查 Tailscale（xian-m4）或 CODEX_REMOTE_HOST（如 Cloudflare 别名）。"
  fi
}

chmod_local_auth() {
  local path="$1"
  chmod 600 "$path"
}

prepare_remote_us_exit() {
  local team="$1" ts
  ts="$(date +%Y%m%d%H%M%S)-$$"
  REMOTE_GUARD="/tmp/codex-us-exit-guard-${team}-${ts}.sh"
  REMOTE_GUARD_STATE="/tmp/codex-us-exit-guard-${team}-${ts}.state"

  [[ -x "$LOCAL_EXIT_GUARD" ]] || die "本机出口守卫不可执行: ${LOCAL_EXIT_GUARD}"
  log "西安美国出口预检: ${REMOTE_HOST}（M4 优先，SF 兜底）"
  if [[ "$DRY_RUN" == "1" ]]; then
    log "[dry-run] 上传出口守卫并在 token 传输前执行 prepare"
    return 0
  fi

  scp -o BatchMode=yes -o ConnectTimeout=30 \
    "$LOCAL_EXIT_GUARD" "${REMOTE_HOST}:${REMOTE_GUARD}"
  ssh_cmd "chmod 700 ${REMOTE_GUARD}"
  if ! ssh_cmd "${REMOTE_GUARD} prepare ${REMOTE_GUARD_STATE}"; then
    ssh_cmd "rm -f ${REMOTE_GUARD} ${REMOTE_GUARD_STATE}" >/dev/null 2>&1 || true
    die "西安美国出口门禁失败，未传输 ${team} token"
  fi
  REMOTE_GUARD_PREPARED=1
}

restore_remote_us_exit() {
  [[ "$REMOTE_GUARD_PREPARED" == "1" ]] || return 0
  if ! ssh_cmd "${REMOTE_GUARD} restore ${REMOTE_GUARD_STATE}"; then
    log "ERROR: 西安 Tailscale exit node 恢复失败，请立即人工检查 ${REMOTE_HOST}"
    return 1
  fi
  ssh_cmd "rm -f ${REMOTE_GUARD} ${REMOTE_GUARD_STATE}" >/dev/null 2>&1 || true
  REMOTE_GUARD_PREPARED=0
}

cleanup_remote_guard_on_exit() {
  local original_rc=$? restore_rc=0
  trap - EXIT
  if [[ "$REMOTE_GUARD_PREPARED" == "1" && "$REMOTE_GUARD_HANDED_OFF" == "0" ]]; then
    restore_remote_us_exit || restore_rc=$?
  fi
  if [[ "$original_rc" -ne 0 ]]; then
    exit "$original_rc"
  fi
  exit "$restore_rc"
}

push_token() {
  local team="$1"
  local local_auth remote_auth remote_dir
  local_auth="$(local_auth_path "$team")" || die "本机找不到 ${team} 目录（期望 ~/.codex-${team}/）"
  [[ -f "$local_auth" ]] || die "本机无 ${local_auth}。请先在美国本机对该账号 codex login，禁止在西安 login。"
  remote_auth="$(remote_auth_path "$team")"
  remote_dir="$(remote_home_path "$team")"

  log "推送 token: ${team} → ${REMOTE_HOST}:${remote_auth}（不打印内容）"
  if [[ "$DRY_RUN" == "1" ]]; then
    log "[dry-run] scp ${local_auth} ${REMOTE_HOST}:${remote_auth}"
    log "[dry-run] ssh chmod 600 ${remote_auth}"
    return 0
  fi

  chmod_local_auth "$local_auth"
  # 确保远端目录存在，再 scp（不 cat 内容）
  ssh_cmd "mkdir -p ${remote_dir}"
  scp -o BatchMode=yes -o ConnectTimeout=30 \
    "$local_auth" "${REMOTE_HOST}:${remote_auth}"
  ssh_cmd "chmod 600 ${remote_auth}"
  log "推送完成 + 远端 chmod 600"
}

start_remote_session() {
  local team="$1"
  local brief="${2:-}"
  local ts session_name remote_brief_path remote_launcher remote_home_expr

  ts="$(date +%Y%m%d%H%M%S)"
  session_name="codex-${team}-${ts}"
  remote_home_expr="$(remote_home_env "$team")"
  remote_launcher="/tmp/codex-launch-${team}-${ts}.sh"
  remote_brief_path=""

  if [[ -n "$brief" ]]; then
    [[ -f "$brief" ]] || die "brief 不存在: $brief"
    remote_brief_path="/tmp/codex-brief-${team}-${ts}.txt"
    log "上传 brief → ${REMOTE_HOST}:${remote_brief_path}（任务书，非 token）"
    if [[ "$DRY_RUN" != "1" ]]; then
      scp -o BatchMode=yes -o ConnectTimeout=30 \
        "$brief" "${REMOTE_HOST}:${remote_brief_path}"
    fi
  fi

  log "远程 tmux 会话: ${session_name}"
  if [[ "$DRY_RUN" == "1" ]]; then
    log "[dry-run] 写远端 launcher + tmux new-session -d -s ${session_name}"
    log "[dry-run] CODEX_HOME=${remote_home_expr} ${REMOTE_CODEX_BIN}"
    return 0
  fi

  # 在远端落盘 launcher（不含任何 token），再 tmux 执行，避开多层引号陷阱
  # 红线：绝不调用 codex login
  if [[ -n "$remote_brief_path" ]]; then
    ssh_cmd "cat > ${remote_launcher} <<'EOS'
#!/usr/bin/env bash
set -euo pipefail
export PATH=${REMOTE_PATH_PREFIX}
export CODEX_HOME=${remote_home_expr}
GUARD=${REMOTE_GUARD}
STATE=${REMOTE_GUARD_STATE}
cleanup() {
  original_rc=\$?
  trap - EXIT
  restore_rc=0
  \"\$GUARD\" restore \"\$STATE\" || restore_rc=\$?
  rm -f \"\$GUARD\" \"\$STATE\" ${remote_brief_path} ${remote_launcher}
  if [[ \"\$original_rc\" -ne 0 ]]; then exit \"\$original_rc\"; fi
  exit \"\$restore_rc\"
}
trap cleanup EXIT
${REMOTE_CODEX_BIN} --dangerously-bypass-approvals-and-sandbox \"\$(cat ${remote_brief_path})\"
CODEX_RC=\$?
exit \"\$CODEX_RC\"
EOS
chmod 700 ${remote_launcher}"
  else
    ssh_cmd "cat > ${remote_launcher} <<'EOS'
#!/usr/bin/env bash
set -euo pipefail
export PATH=${REMOTE_PATH_PREFIX}
export CODEX_HOME=${remote_home_expr}
GUARD=${REMOTE_GUARD}
STATE=${REMOTE_GUARD_STATE}
cleanup() {
  original_rc=\$?
  trap - EXIT
  restore_rc=0
  \"\$GUARD\" restore \"\$STATE\" || restore_rc=\$?
  rm -f \"\$GUARD\" \"\$STATE\" ${remote_launcher}
  if [[ \"\$original_rc\" -ne 0 ]]; then exit \"\$original_rc\"; fi
  exit \"\$restore_rc\"
}
trap cleanup EXIT
${REMOTE_CODEX_BIN} --dangerously-bypass-approvals-and-sandbox
CODEX_RC=\$?
exit \"\$CODEX_RC\"
EOS
chmod 700 ${remote_launcher}"
  fi

  ssh_cmd "tmux new-session -d -s $(printf '%q' "$session_name") $(printf '%q' "$remote_launcher")"
  log "已拉起。附着: ssh ${REMOTE_HOST} -t 'tmux attach -t ${session_name}'"
  # 回显会话列表作验收证据（不含 token）
  ssh_cmd 'tmux ls' || true
}

collect_one() {
  local team="$1"
  local local_auth remote_auth local_mtime remote_mtime local_home tmp

  local_home="$(resolve_local_home "$team" 2>/dev/null || true)"
  if [[ -z "${local_home:-}" ]]; then
    mkdir -p "${HOME}/.codex-${team}"
    local_home="${HOME}/.codex-${team}"
    log "本机无 ${team} 目录，已创建 ${local_home}"
  fi
  local_auth="${local_home}/auth.json"
  remote_auth="$(remote_auth_path "$team")"

  # 远端是否存在
  if ! ssh_cmd "test -f ${remote_auth}"; then
    log "跳过 ${team}：远端无 ${remote_auth}"
    return 0
  fi

  remote_mtime="$(ssh_cmd "stat -f %m ${remote_auth} 2>/dev/null || stat -c %Y ${remote_auth}")"
  if [[ -f "$local_auth" ]]; then
    local_mtime="$(file_mtime_epoch "$local_auth")"
  else
    local_mtime=0
  fi

  log "mtime 对比 ${team}: local=${local_mtime} remote=${remote_mtime}"
  if [[ "$remote_mtime" -le "$local_mtime" ]]; then
    log "跳过 ${team}：远端未更新（remote_mtime <= local_mtime）"
    return 0
  fi

  log "拉回 ${team}：远端更新，scp 回本机（不打印内容）"
  if [[ "$DRY_RUN" == "1" ]]; then
    log "[dry-run] scp ${REMOTE_HOST}:${remote_auth} → ${local_auth}"
    return 0
  fi

  tmp="${local_auth}.collect.tmp.$$"
  scp -o BatchMode=yes -o ConnectTimeout=30 \
    "${REMOTE_HOST}:${remote_auth}" "$tmp"
  chmod 600 "$tmp"
  mv -f "$tmp" "$local_auth"
  chmod 600 "$local_auth"
  log "已拉回 → ${local_auth} (mode 600)"
}

# ---------- main ----------
if [[ "$COLLECT" == "1" ]]; then
  assert_ssh
  if [[ -n "$TEAM" ]]; then
    is_allowed_team "$TEAM" || die "非法 team: ${TEAM}（允许: ${ALLOWED_TEAMS_STR}）"
    collect_one "$TEAM"
  else
    for t in "${ALLOWED_TEAMS[@]}"; do
      collect_one "$t"
    done
  fi
  log "collect 完成"
  exit 0
fi

[[ -n "$TEAM" ]] || die "需要 --team <${ALLOWED_TEAMS_STR}>（或 --collect）"
is_allowed_team "$TEAM" || die "非法 team: ${TEAM}（允许: ${ALLOWED_TEAMS_STR}）"

assert_ssh
trap cleanup_remote_guard_on_exit EXIT
prepare_remote_us_exit "$TEAM"
push_token "$TEAM"
start_remote_session "$TEAM" "$BRIEF"
REMOTE_GUARD_HANDED_OFF=1
trap - EXIT
log "完成 team=${TEAM} host=${REMOTE_HOST}"
