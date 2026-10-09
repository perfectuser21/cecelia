#!/usr/bin/env bash
# 安装 coding workflow runner 为系统域 LaunchDaemon（本机铁律：常驻/周期服务一律 /Library/LaunchDaemons，
# 禁止 ~/Library/LaunchAgents）。每 5 分钟以 UserName 身份跑专用 clone 里的 runner.sh。
#
# 用法：
#   bash install.sh --dry-run                       # 只打印将写入的 plist 与将执行的命令，不落盘
#   sudo env PATH="$PATH" bash install.sh           # 真装（需 root；PATH 透传以解析 node/git/gh/claude）
#
# 可覆盖：CODING_WF_RUN_USER（默认 administrator）、CODING_WF_USER_HOME（默认 /Users/<user>）、
#         CODING_WF_REPO（默认 <home>/perfect21/cecelia-cw-runner）、CODING_WF_ORIGIN_URL、BRAIN_URL。
#         CODING_WF_AUTOMERGE（设置后写入 plist 的 EnvironmentVariables，如 0=关闭自动合并；未设置/为空则不写）。
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LABEL="com.cecelia.coding-workflow-runner"
DAEMON_DIR="/Library/LaunchDaemons"
DEST="$DAEMON_DIR/$LABEL.plist"
INTERVAL=300
TEMPLATE="$HERE/$LABEL.plist.tmpl"
RUNNER_REL="packages/brain/scripts/coding-workflow/runner/runner.sh"

DRY_RUN=0
for arg in "$@"; do
  case "$arg" in
    --dry-run) DRY_RUN=1 ;;
    *) echo "未知参数：${arg}（只支持 --dry-run）" >&2; exit 2 ;;
  esac
done

RUN_USER="${CODING_WF_RUN_USER:-administrator}"
USER_HOME="${CODING_WF_USER_HOME:-/Users/$RUN_USER}"
REPO="${CODING_WF_REPO:-$USER_HOME/perfect21/cecelia-cw-runner}"
ORIGIN_URL="${CODING_WF_ORIGIN_URL:-https://github.com/perfectuser21/cecelia.git}"
BRAIN="${BRAIN_URL:-http://localhost:5221}"
LOG_FILE="$USER_HOME/Library/Logs/coding-workflow-runner.log"

if [ "$DRY_RUN" -eq 0 ] && [ "$(id -u)" -ne 0 ]; then
  echo "真装需要 root：sudo env PATH=\"\$PATH\" bash $0（或先用 --dry-run 预览）" >&2
  exit 1
fi

# PATH：node/git/gh/claude 的实际所在目录 + 系统目录，去重保序
DIRS=()
for tool in node git gh claude; do
  bin="$(command -v "$tool" || true)"
  if [ -z "$bin" ]; then
    echo "找不到 ${tool}：请在能找到它的 PATH 下运行（sudo 时用 env PATH=\"\$PATH\" 透传）" >&2
    exit 1
  fi
  DIRS+=("$(dirname "$bin")")
done
DIRS+=(/usr/bin /bin /usr/sbin /sbin)
RUN_PATH=""
for d in "${DIRS[@]}"; do
  case ":$RUN_PATH:" in
    *":$d:"*) ;;
    *) RUN_PATH="${RUN_PATH:+$RUN_PATH:}$d" ;;
  esac
done

# sed 替换值转义：\ & 和分隔符 |
esc() { printf '%s' "$1" | sed -e 's/[\\&|]/\\&/g'; }

# 把 __AUTOMERGE_ENV__ 占位行换成 CODING_WF_AUTOMERGE 的 key/string 两行；未设置/为空则整行删除。
# 值经环境变量传入 awk（避免转义被 awk 解释），并先做 XML 转义（& 须最先转）。
fill_automerge() {
  local val="${CODING_WF_AUTOMERGE:-}"
  # 不用 ${val//</&lt;}：bash 5.2 起替换串里的 & 代表匹配文本（patsub_replacement），Linux 上会得到 <lt;
  val="$(printf '%s' "$val" | sed -e 's/&/\&amp;/g' -e 's/</\&lt;/g' -e 's/>/\&gt;/g')"
  AUTOMERGE_XML="$val" awk '
    /^[[:space:]]*__AUTOMERGE_ENV__[[:space:]]*$/ {
      if (ENVIRON["AUTOMERGE_XML"] != "") {
        print "    <key>CODING_WF_AUTOMERGE</key>"
        print "    <string>" ENVIRON["AUTOMERGE_XML"] "</string>"
      }
      next
    }
    { print }'
}

render_plist() {
  sed -e "s|__LABEL__|$(esc "$LABEL")|g" \
      -e "s|__USER__|$(esc "$RUN_USER")|g" \
      -e "s|__RUNNER_SH__|$(esc "$REPO/$RUNNER_REL")|g" \
      -e "s|__INTERVAL__|$INTERVAL|g" \
      -e "s|__HOME__|$(esc "$USER_HOME")|g" \
      -e "s|__PATH__|$(esc "$RUN_PATH")|g" \
      -e "s|__BRAIN_URL__|$(esc "$BRAIN")|g" \
      -e "s|__REPO__|$(esc "$REPO")|g" \
      -e "s|__LOG__|$(esc "$LOG_FILE")|g" \
      "$TEMPLATE" | fill_automerge
}

# dry-run 只打印；否则执行
do_cmd() {
  if [ "$DRY_RUN" -eq 1 ]; then
    printf '%s\n' "$*"
  else
    "$@"
  fi
}

PLIST_CONTENT="$(render_plist)"

if [ "$DRY_RUN" -eq 1 ]; then
  echo "# 将写入 ${DEST}："
  printf '%s\n' "$PLIST_CONTENT"
  echo "# 将执行的命令："
  PLIST_SRC="<上面的 plist 临时文件>"
else
  PLIST_SRC="$(mktemp -t coding-workflow-runner-plist)"
  printf '%s\n' "$PLIST_CONTENT" > "$PLIST_SRC"
  plutil -lint "$PLIST_SRC" >/dev/null
fi

# 专用 clone：以运行用户身份准备（runner.sh 之后每轮自更新）
if [ ! -d "$REPO/.git" ]; then
  do_cmd sudo -u "$RUN_USER" git clone -q "$ORIGIN_URL" "$REPO"
fi
# 日志文件预建并归运行用户
do_cmd mkdir -p "$(dirname "$LOG_FILE")"
do_cmd touch "$LOG_FILE"
do_cmd chown "$RUN_USER" "$LOG_FILE"

do_cmd install -m 644 -o root -g wheel "$PLIST_SRC" "$DEST"
if [ "$DRY_RUN" -eq 1 ]; then
  echo "launchctl bootout system/$LABEL || true"
else
  launchctl bootout "system/$LABEL" 2>/dev/null || true
fi
do_cmd launchctl bootstrap system "$DEST"
do_cmd launchctl enable "system/$LABEL"

if [ "$DRY_RUN" -eq 0 ]; then
  rm -f "$PLIST_SRC"
  echo "已安装 ${LABEL}；核对：launchctl print system/$LABEL"
fi
