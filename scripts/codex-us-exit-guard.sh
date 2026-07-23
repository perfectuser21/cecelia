#!/usr/bin/env bash
# codex-us-exit-guard.sh — Codex 启动前确保西安执行机使用美国出口
set -uo pipefail

PRIMARY_EXIT="${CODEX_EXIT_PRIMARY:-100.71.151.105}"
FALLBACK_EXIT="${CODEX_EXIT_FALLBACK:-100.79.41.61}"
HOSTS_FILE="${CODEX_HOSTS_FILE:-/etc/hosts}"
CHATGPT_URL="https://chatgpt.com/backend-api/ps/mcp"
TRACE_URL="https://www.cloudflare.com/cdn-cgi/trace"

log() { printf '[codex-us-exit-guard] %s\n' "$*"; }
die() { printf '[codex-us-exit-guard] ERROR: %s\n' "$*" >&2; return 1; }

usage() {
  printf '用法: %s <prepare|restore> <state-file>\n' "$0"
}

current_exit_ip() {
  tailscale debug prefs 2>/dev/null | python3 -c '
import json, sys
try:
    print(json.load(sys.stdin).get("ExitNodeIP", "") or "")
except Exception:
    sys.exit(1)
'
}

assert_no_loopback_override() {
  if [[ -f "$HOSTS_FILE" ]] && grep -Eiq '^[[:space:]]*(127\.[0-9.]*|::1)[[:space:]]+([^#]*[[:space:]])?chatgpt\.com([[:space:]]|$)' "$HOSTS_FILE"; then
    local match
    match="$(grep -Ein '^[[:space:]]*(127\.[0-9.]*|::1)[[:space:]]+([^#]*[[:space:]])?chatgpt\.com([[:space:]]|$)' "$HOSTS_FILE" | head -n 1)"
    die "${HOSTS_FILE} 存在 chatgpt.com 回环覆盖（${match}）"
    return 1
  fi

  local resolved
  resolved="$(dscacheutil -q host -a name chatgpt.com 2>/dev/null || true)"
  if printf '%s\n' "$resolved" | grep -Eq '(^|[[:space:]])(127\.[0-9.]*|::1)([[:space:]]|$)'; then
    die "chatgpt.com 当前解析到回环地址"
    return 1
  fi
}

assert_public_country_us() {
  local trace country
  trace="$(curl -sS --connect-timeout 5 --max-time 10 "$TRACE_URL")" || {
    die "无法探测公网出口国家"
    return 1
  }
  country="$(printf '%s\n' "$trace" | awk -F= '$1 == "loc" { print $2; exit }')"
  if [[ "$country" != "US" ]]; then
    die "公网出口不是 US（实际: ${country:-unknown}）"
    return 1
  fi
  log "公网出口国家检查通过（US）"
}

assert_chatgpt_transport() {
  local code
  code="$(curl -sS -o /dev/null --connect-timeout 5 --max-time 10 -w '%{http_code}' "$CHATGPT_URL")" || {
    die "ChatGPT HTTPS 连接失败或超时"
    return 1
  }
  if [[ -z "$code" || "$code" == "000" ]]; then
    die "ChatGPT HTTPS 未建立（HTTP ${code:-000}）"
    return 1
  fi
  log "ChatGPT HTTPS 检查通过（HTTP ${code}）"
}

write_state() {
  local state_file="$1" previous="$2" selected="$3" changed="$4"
  umask 077
  {
    printf 'previous_exit=%s\n' "$previous"
    printf 'selected_exit=%s\n' "$selected"
    printf 'changed=%s\n' "$changed"
  } > "$state_file"
  chmod 600 "$state_file"
}

prepare() {
  local state_file="$1" current
  assert_no_loopback_override || return 1
  current="$(current_exit_ip)" || {
    die "无法读取 Tailscale exit node"
    return 1
  }
  if [[ "$current" != "$PRIMARY_EXIT" && "$current" != "$FALLBACK_EXIT" ]]; then
    die "当前 Tailscale exit node 不是允许的美国节点（实际: ${current:-none}）"
    return 1
  fi
  write_state "$state_file" "$current" "$current" 0
  assert_public_country_us || return 1
  assert_chatgpt_transport || return 1
  log "美国出口门禁通过（exit node: ${current}）"
}

restore() {
  local state_file="$1" changed
  [[ -f "$state_file" ]] || return 0
  changed="$(awk -F= '$1 == "changed" { print $2; exit }' "$state_file")"
  if [[ "$changed" == "1" ]]; then
    die "状态要求恢复已修改路由，但自动恢复尚未实现"
    return 1
  fi
  rm -f "$state_file"
}

main() {
  [[ $# -eq 2 ]] || { usage >&2; return 2; }
  case "$1" in
    prepare) prepare "$2" ;;
    restore) restore "$2" ;;
    *) usage >&2; return 2 ;;
  esac
}

main "$@"
