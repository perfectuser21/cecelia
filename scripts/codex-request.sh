#!/usr/bin/env bash
# codex-request.sh — 西安 M4 侧发起的 codex token pull-request
#
# 设计目标：
#   西安 M4（本脚本运行处）= 同事交互式使用发起点
#   美国 M4 = token 的家（唯一持久存储）
#   模型：用前拉最新（scp pull）→ 前台跑 codex → 用后立即还（trap EXIT scp push）
#
# 用法：
#   bash scripts/codex-request.sh --team <team1|team2|team3|team4|team5>
#
# 环境变量：
#   CODEX_US_HOST   默认 mac-mini-m4-us 的 Tailscale 用户@地址；
#                   可用 CODEX_US_HOST 覆盖（如 Tailscale 不可达时切换别名）
#   CODEX_BIN       本地 codex 可执行文件名，默认 codex
#
# 红线：
#   - 绝不在本机（西安）执行 codex 的登录（login）子命令 / 任何触发认证刷新的命令
#   - token 内容绝不打印到 stdout/日志
#   - 本地与远端 auth.json 均 mode 600
#   - 不使用 exec 运行 codex —— exec 会替换脚本自身进程，
#     导致 EXIT trap 无法在 codex 退出后触发，回传逻辑就此失效
#   - 推回前必须校验本地 auth.json 是合法 JSON（依赖 jq）——
#     codex 若被 kill -9 / 磁盘满导致文件写坏，绝不能把坏文件当"最新版本"
#     覆盖美国侧唯一持久副本；校验失败则跳过推回，人工核查
set -uo pipefail  # 不用 -e：codex 非零退出时仍须继续执行 trap 回传逻辑

ALLOWED_TEAMS=(team1 team2 team3 team4 team5)
ALLOWED_TEAMS_STR="$(IFS='|'; echo "${ALLOWED_TEAMS[*]}")"
US_HOST="${CODEX_US_HOST:-administrator@100.71.151.105}"
CODEX_BIN="${CODEX_BIN:-codex}"

TEAM=""

usage() {
  cat <<EOF
用法:
  scripts/codex-request.sh --team <${ALLOWED_TEAMS_STR}>

流程:
  1. 反向 SSH 探活美国 M4
  2. scp 从美国拉取该账号最新 auth.json（覆盖本地）
  3. 前台运行 codex（非 exec，保留退出后 trap 回传能力）
  4. 无论 codex 正常/异常退出，trap 都会把（可能已被刷新的）auth.json scp 推回美国
EOF
}

log() { printf '[codex-request] %s\n' "$*"; }
die() { printf '[codex-request] ERROR: %s\n' "$*" >&2; exit 1; }

while [[ $# -gt 0 ]]; do
  case "$1" in
    --team)
      [[ $# -ge 2 ]] || die "--team 需要参数"
      TEAM="$2"
      shift 2
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

[[ -n "$TEAM" ]] || die "需要 --team <${ALLOWED_TEAMS_STR}>"

is_allowed_team() {
  local t="$1" a
  for a in "${ALLOWED_TEAMS[@]}"; do
    [[ "$a" == "$t" ]] && return 0
  done
  return 1
}
is_allowed_team "$TEAM" || die "非法 team: $TEAM（允许: ${ALLOWED_TEAMS_STR}）"

LOCAL_HOME="${HOME}/.codex-${TEAM}"
LOCAL_AUTH="${LOCAL_HOME}/auth.json"
REMOTE_AUTH="~/.codex-${TEAM}/auth.json"

ssh_cmd() {
  ssh -o BatchMode=yes -o ConnectTimeout=15 "$US_HOST" "$@"
}

assert_ssh() {
  if ! ssh_cmd 'echo ok' >/dev/null 2>&1; then
    die "无法反向 SSH 到美国 M4（${US_HOST}）。请检查 Tailscale 连通性。"
  fi
}

pull_token() {
  mkdir -p "$LOCAL_HOME"
  log "从美国拉取 ${TEAM} 最新 token（不打印内容）"
  scp -o BatchMode=yes -o ConnectTimeout=15 \
    "${US_HOST}:${REMOTE_AUTH}" "$LOCAL_AUTH" \
    || die "拉取 ${TEAM} token 失败"
  chmod 600 "$LOCAL_AUTH"
  log "拉取完成，本地已 chmod 600"
}

push_token_back() {
  if [[ ! -f "$LOCAL_AUTH" ]]; then
    printf '[codex-request] WARN: 本地 %s 不存在，跳过推回\n' "$LOCAL_AUTH" >&2
    return 0
  fi
  if ! jq empty "$LOCAL_AUTH" >/dev/null 2>&1; then
    printf '[codex-request] WARN: 本地 %s 不是合法 JSON（可能 codex 异常终止/磁盘满导致写坏），跳过推回，保留美国侧现有副本不被覆盖\n' \
      "$LOCAL_AUTH" >&2
    return 0
  fi
  chmod 600 "$LOCAL_AUTH"
  if scp -o BatchMode=yes -o ConnectTimeout=15 \
      "$LOCAL_AUTH" "${US_HOST}:${REMOTE_AUTH}" 2>/tmp/codex-request-pushback-err.$$; then
    ssh_cmd "chmod 600 ${REMOTE_AUTH}" || true
    log "已把 ${TEAM} token 推回美国"
  else
    printf '[codex-request] ERROR: %s token 推回美国失败，请人工核查（scp 本次连接已不通，重试无意义，不做自动重试）: %s\n' \
      "$TEAM" "$(cat /tmp/codex-request-pushback-err.$$ 2>/dev/null)" >&2
  fi
  rm -f /tmp/codex-request-pushback-err.$$
}

assert_ssh
pull_token

trap push_token_back EXIT

log "启动 codex（CODEX_HOME=${LOCAL_HOME}）"
env CODEX_HOME="$LOCAL_HOME" "$CODEX_BIN"
CODEX_EXIT=$?

exit "$CODEX_EXIT"
