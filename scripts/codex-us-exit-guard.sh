#!/usr/bin/env bash
# codex-us-exit-guard.sh — Codex 启动前确保西安执行机使用美国出口
set -uo pipefail

PRIMARY_EXIT="${CODEX_EXIT_PRIMARY:-100.71.151.105}"
FALLBACK_EXIT="${CODEX_EXIT_FALLBACK:-100.79.41.61}"
HOSTS_FILE="${CODEX_HOSTS_FILE:-/etc/hosts}"
CHATGPT_URL="https://chatgpt.com/backend-api/ps/mcp"
TRACE_URL="https://www.cloudflare.com/cdn-cgi/trace"
MAX_TRANSPORT_ATTEMPTS="${CODEX_GUARD_MAX_ATTEMPTS:-4}"
RETRY_DELAY_SECONDS="${CODEX_GUARD_RETRY_DELAY:-2}"

log() { printf '[codex-us-exit-guard] %s\n' "$*"; }
die() { printf '[codex-us-exit-guard] ERROR: %s\n' "$*" >&2; return 1; }

usage() {
  printf '用法: %s <prepare|restore> <state-file>\n' "$0"
}

current_exit_ip() {
  local status current rc
  status="$(tailscale status --json 2>/dev/null)" || status=""
  if [[ -n "$status" ]]; then
    current="$(printf '%s\n' "$status" | python3 -c '
import json, sys
try:
    data = json.load(sys.stdin)
except Exception:
    sys.exit(1)
ips = (data.get("ExitNodeStatus") or {}).get("TailscaleIPs") or []
if not ips:
    for peer in (data.get("Peer") or {}).values():
        if peer.get("ExitNode"):
            ips = peer.get("TailscaleIPs") or []
            break
ipv4 = next((ip for ip in ips if ":" not in ip), "")
print(ipv4.split("/", 1)[0])
'
    )"
    rc=$?
    if [[ "$rc" -eq 0 ]]; then
      printf '%s\n' "$current"
      return 0
    fi
  fi

  tailscale debug prefs 2>/dev/null | python3 -c '
import json, sys
try:
    print(json.load(sys.stdin).get("ExitNodeIP", "") or "")
except Exception:
    sys.exit(1)
'
}

candidate_is_available() {
  local ip="$1"
  tailscale status --json 2>/dev/null | python3 -c '
import json, sys
ip = sys.argv[1]
try:
    peers = (json.load(sys.stdin).get("Peer") or {}).values()
except Exception:
    sys.exit(1)
for peer in peers:
    if ip in (peer.get("TailscaleIPs") or []):
        sys.exit(0 if peer.get("Online") and peer.get("ExitNodeOption") else 1)
sys.exit(1)
' "$ip"
}

set_exit_node() {
  local ip="$1"
  if tailscale set --exit-node="$ip" >/dev/null 2>&1; then
    return 0
  fi
  sudo -n tailscale set --exit-node="$ip" >/dev/null 2>&1
}

try_candidate() {
  local ip="$1" selected
  candidate_is_available "$ip" || return 1
  set_exit_node "$ip" || return 1
  selected="$(current_exit_ip)" || return 1
  [[ "$selected" == "$ip" ]]
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
  local code attempt
  for ((attempt = 1; attempt <= MAX_TRANSPORT_ATTEMPTS; attempt++)); do
    code=""
    if code="$(curl -sS -o /dev/null --connect-timeout 5 --max-time 10 -w '%{http_code}' "$CHATGPT_URL" 2>/dev/null)" && \
       [[ -n "$code" && "$code" != "000" ]]; then
      log "ChatGPT HTTPS 检查通过（HTTP ${code}，attempt ${attempt}）"
      return 0
    fi
    if [[ "$attempt" -lt "$MAX_TRANSPORT_ATTEMPTS" ]]; then
      log "ChatGPT HTTPS 尚未就绪，继续探测（${attempt}/${MAX_TRANSPORT_ATTEMPTS}）"
      sleep "$RETRY_DELAY_SECONDS"
    fi
  done
  die "ChatGPT HTTPS 连接失败或超时（已尝试 ${MAX_TRANSPORT_ATTEMPTS} 次）"
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
  local state_file="$1" current previous selected changed
  assert_no_loopback_override || return 1
  current="$(current_exit_ip)" || {
    die "无法读取 Tailscale exit node"
    return 1
  }
  previous="$current"
  selected="$current"
  changed=0

  if [[ "$current" != "$PRIMARY_EXIT" && "$current" != "$FALLBACK_EXIT" ]]; then
    selected=""
    if try_candidate "$PRIMARY_EXIT"; then
      selected="$PRIMARY_EXIT"
    elif try_candidate "$FALLBACK_EXIT"; then
      selected="$FALLBACK_EXIT"
    else
      die "两个美国出口节点均不可用（M4=${PRIMARY_EXIT}, SF=${FALLBACK_EXIT}）"
      return 1
    fi
    changed=1
    log "已切换美国 exit node（${selected}）"
  fi

  write_state "$state_file" "$previous" "$selected" "$changed"
  if ! assert_public_country_us || ! assert_chatgpt_transport; then
    if [[ "$changed" == "1" ]]; then
      restore "$state_file" || true
    fi
    return 1
  fi
  log "美国出口门禁通过（exit node: ${selected}）"
}

restore() {
  local state_file="$1" changed previous current
  [[ -f "$state_file" ]] || return 0
  changed="$(awk -F= '$1 == "changed" { print $2; exit }' "$state_file")"
  if [[ "$changed" == "1" ]]; then
    previous="$(awk -F= '$1 == "previous_exit" { print $2; exit }' "$state_file")"
    if ! set_exit_node "$previous"; then
      die "恢复 Tailscale exit node 失败（目标: ${previous:-none}）"
      return 1
    fi
    current="$(current_exit_ip)" || {
      die "恢复后无法读取 Tailscale exit node"
      return 1
    }
    if [[ "$current" != "$previous" ]]; then
      die "恢复 Tailscale exit node 未生效（期望: ${previous:-none}, 实际: ${current:-none}）"
      return 1
    fi
    log "已恢复进入前的 Tailscale exit node（${previous:-none}）"
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
