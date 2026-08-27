#!/usr/bin/env bash
# codex-request.sh — 西安 M4 侧发起的 codex token 只读借用
#
# 设计目标：
#   西安 M4（本脚本运行处）= 同事交互式使用发起点
#   美国 M4 = token 的家（唯一持久存储、唯一写者）
#   模型：只读快照 —— 每次用前从美国拉最新，用完不回传、不覆盖美国侧。
#         美国侧 crontab 的自动续期脚本是唯一负责刷新与持久化的角色。
#
# 用法：
#   bash scripts/codex-request.sh --team <team1|team2|team3|team4|team5>
#
# 环境变量：
#   CODEX_US_HOST   默认 mac-mini-m4-us 的 Tailscale 用户@地址；
#                   可用 CODEX_US_HOST 覆盖（如 Tailscale 不可达时切换别名）
#   CODEX_BIN       本地 codex 可执行文件名，默认 codex
#   CODEX_MIN_REMAINING_SECONDS  拒绝运行的最低剩余有效期阈值，默认 172800（48小时）
#
# 红线：
#   - 绝不在本机（西安）执行 codex 的登录（login）子命令 / 任何触发认证刷新的命令
#   - token 内容绝不打印到 stdout/日志
#   - 本地 auth.json mode 600
#   - 绝不往回推（scp push）——美国侧 crontab 是唯一写者，本脚本只读借用，
#     用完就地丢弃。这不是遗漏，是刻意设计：曾经的"用完整份回传"模式在跨机
#     场景下会产生 lost-update 竞态（回传旧版本覆盖美国侧 cron 已刷新的新版本，
#     导致 refresh_token 失效，整个账号需要重新登录才能恢复；如果美国侧自己
#     也正有会话在用，这次覆盖还会反过来把美国自己的会话弄断）。没有第二个
#     写者，就没有竞态，不需要加锁。
#   - 拉取到的 token 若剩余有效期不足 CODEX_MIN_REMAINING_SECONDS，拒绝运行——
#     这是美国侧 cron 掉线的哨兵，不能让西安悄悄用着一份快过期的陈旧 token
set -uo pipefail

ALLOWED_TEAMS=(team1 team2 team3 team4 team5)
ALLOWED_TEAMS_STR="$(IFS='|'; echo "${ALLOWED_TEAMS[*]}")"
US_HOST="${CODEX_US_HOST:-administrator@100.71.151.105}"
CODEX_BIN="${CODEX_BIN:-codex}"
MIN_REMAINING_SECONDS="${CODEX_MIN_REMAINING_SECONDS:-172800}"

TEAM=""
EXIT_GUARD_ACTIVE=0
EXIT_STATE=""

usage() {
  cat <<EOF
用法:
  scripts/codex-request.sh --team <${ALLOWED_TEAMS_STR}>

流程:
  1. 反向 SSH 探活美国 M4
  2. scp 从美国拉取该账号最新 auth.json（覆盖本地）
  3. 校验剩余有效期 >= ${MIN_REMAINING_SECONDS} 秒，不足则拒绝运行
  4. 前台运行 codex
  5. 用完不回传——美国侧 crontab 是唯一写者
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
is_allowed_team "$TEAM" || die "非法 team: ${TEAM}（允许: ${ALLOWED_TEAMS_STR}）"

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

# 剩余有效期检查：美国侧 cron 是唯一写者，正常情况下拉到的 token 应该有
# 大把余量（实测约 9 天）。剩余不足 48 小时意味着美国侧 cron 大概率已经
# 掉线/失败，此时不应该继续借用一份快过期的陈旧 token 出去。
assert_fresh_enough() {
  local remaining
  remaining=$(python3 -c "
import json, base64, time, sys
try:
    d = json.load(open('$LOCAL_AUTH'))
    at = d.get('tokens', {}).get('access_token', '')
    if not at or at.count('.') != 2:
        print(-1); sys.exit(0)
    p = at.split('.')[1] + '=='
    exp = json.loads(base64.b64decode(p + '==')).get('exp', 0)
    print(int(exp - time.time()))
except Exception:
    print(-1)
")
  if [[ "$remaining" -lt "$MIN_REMAINING_SECONDS" ]]; then
    die "${TEAM} token 剩余有效期不足（约 ${remaining} 秒 < 要求 ${MIN_REMAINING_SECONDS} 秒），拒绝运行。可能是美国侧 refresh-codex-tokens cron 掉线未及时刷新，请去美国机核查 /tmp/codex-token-refresh.log"
  fi
  log "剩余有效期检查通过（约 ${remaining} 秒 >= ${MIN_REMAINING_SECONDS} 秒）"
}

restore_exit_guard() {
  local original_rc=$? restore_rc=0
  trap - EXIT
  if [[ "$EXIT_GUARD_ACTIVE" == "1" ]]; then
    "$EXIT_GUARD" restore "$EXIT_STATE" || restore_rc=$?
  fi
  if [[ "$original_rc" -ne 0 ]]; then
    exit "$original_rc"
  fi
  exit "$restore_rc"
}

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
EXIT_GUARD="${CODEX_EXIT_GUARD:-${SCRIPT_DIR}/codex-us-exit-guard.sh}"
EXIT_STATE="${TMPDIR:-/tmp}/codex-us-exit-request-${TEAM}-$$.state"

[[ -x "$EXIT_GUARD" ]] || die "美国出口守卫不可执行: ${EXIT_GUARD}"
"$EXIT_GUARD" prepare "$EXIT_STATE" || die "美国出口门禁失败，未拉取 ${TEAM} token"
EXIT_GUARD_ACTIVE=1
trap restore_exit_guard EXIT

assert_ssh
pull_token
assert_fresh_enough

log "启动 codex（CODEX_HOME=${LOCAL_HOME}；用完不回传，美国侧 crontab 是唯一写者）"
env CODEX_HOME="$LOCAL_HOME" "$CODEX_BIN"
CODEX_RC=$?
exit "$CODEX_RC"
