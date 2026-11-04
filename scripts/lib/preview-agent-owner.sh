#!/usr/bin/env bash
# launchd 已装载不代表实际持有服务；同时核对 PID、业务监听、目录和入口。
preview_agent_owner() { # label root health-url
  local label="$1" root="${2%/}" url="$3" state pid port listeners cwd command
  state=$(launchctl print "gui/$(id -u)/${label}" 2>/dev/null) || return 1
  pid=$(printf '%s\n' "$state" | awk '/^[[:space:]]*pid = [0-9]+/{print $3;exit}')
  [[ "$pid" =~ ^[0-9]+$ ]] || return 1
  port=$(node -e 'const u=new URL(process.argv[1]);process.stdout.write(u.port||(u.protocol==="https:"?"443":"80"))' "$url") || return 1
  listeners=$(lsof -t -nP -iTCP:"$port" -sTCP:LISTEN 2>/dev/null | sort -u) || return 1
  [[ "$listeners" == "$pid" ]] || return 1
  cwd=$(lsof -a -p "$pid" -d cwd -Fn 2>/dev/null | sed -n 's/^n//p') || return 1
  [[ "$cwd" == "$root" ]] || return 1
  command=$(ps -p "$pid" -o command= 2>/dev/null) || return 1
  [[ "$command" == *" ${root}/scripts/preview-agent.mjs" ]] || return 1
  printf '%s\n' "$pid"
}
