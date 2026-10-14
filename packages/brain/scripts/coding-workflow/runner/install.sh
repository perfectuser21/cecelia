#!/usr/bin/env bash
# 安装 coding workflow runner 为系统域 LaunchDaemon（本机铁律：常驻/周期服务一律 /Library/LaunchDaemons，
# 禁止 ~/Library/LaunchAgents）。每 5 分钟以 UserName 身份跑专用 clone 里的 runner.sh。
#
# 用法：
#   bash install.sh --dry-run                       # 只打印将写入的 plist 与将执行的命令，不落盘
#   sudo env PATH="$PATH" bash install.sh           # 真装（需 root；PATH 透传以解析 node/git/gh/所选 provider）
# 原服务disabled时拒绝安装；操作者明确启用后再重试，安装器不暗中启动禁用服务。
#
# 可覆盖：CODING_WF_RUN_USER（默认 administrator）、CODING_WF_USER_HOME（默认 /Users/<user>）、
#         CODING_WF_REPO（默认 <home>/perfect21/cecelia-cw-runner）、CODING_WF_ORIGIN_URL、BRAIN_URL。
#         CODING_WF_PROVIDER（默认 codex）、CODING_WF_CODEX_HOME（默认 <home>/.codex-team1）、
#         CODING_WF_CODEX_MODEL（默认 gpt-6-sol）、CODING_WF_JUDGE_PROVIDER/MODEL（默认 codex/gpt-6-astra）。
#         CODING_WF_AUTOMERGE（设置后写入 plist 的 EnvironmentVariables，如 0=关闭自动合并；未设置/为空则不写）。
#         CODING_WF_REPOS（启用的仓库，逗号分隔，如 cecelia,zenithjoy-workspace；设置后写入 plist，并以运行用户身份预先
#         clone 其中缺 clone 的非默认仓库——路径与 origin 取自 repos.json；未设置/为空则只启用 cecelia，额外仓必须显式声明）。
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LABEL="com.cecelia.coding-workflow-runner"
DAEMON_DIR="/Library/LaunchDaemons"
DEST="$DAEMON_DIR/$LABEL.plist"
INTERVAL=300
TEMPLATE="$HERE/$LABEL.plist.tmpl"
RUNNER_REL="packages/brain/scripts/coding-workflow/runner/runner.sh"

DRY_RUN=0
LOCKED_INSTALL=0
for arg in "$@"; do
  case "$arg" in
    --dry-run) DRY_RUN=1 ;;
    --runtime-install-locked) LOCKED_INSTALL=1 ;;
    *) echo "未知参数：${arg}（只支持 --dry-run）" >&2; exit 2 ;;
  esac
done

RUN_USER="${CODING_WF_RUN_USER:-administrator}"
USER_HOME="${CODING_WF_USER_HOME:-/Users/$RUN_USER}"
REPO="${CODING_WF_REPO:-$USER_HOME/perfect21/cecelia-cw-runner}"
ORIGIN_URL="${CODING_WF_ORIGIN_URL:-https://github.com/perfectuser21/cecelia.git}"
BRAIN="${BRAIN_URL:-http://localhost:5221}"
LOG_FILE="$USER_HOME/Library/Logs/coding-workflow-runner.log"

# 新安装默认 Codex；显式 Claude 配置仍可重建。两个模型保持不同，账户路径不改变 HOME。
export CODING_WF_PROVIDER="${CODING_WF_PROVIDER:-codex}"
export CODING_WF_REPOS="${CODING_WF_REPOS:-cecelia}"
case "$CODING_WF_PROVIDER" in codex|claude) ;; *) echo "runtime_provider_unknown" >&2; exit 1 ;; esac
if [ "$CODING_WF_PROVIDER" = codex ]; then
  export CODING_WF_CODEX_HOME="${CODING_WF_CODEX_HOME:-$USER_HOME/.codex-team1}"
  export CODING_WF_CODEX_MODEL="${CODING_WF_CODEX_MODEL:-gpt-6-sol}"
  export CODING_WF_JUDGE_PROVIDER="${CODING_WF_JUDGE_PROVIDER:-codex}"
  export CODING_WF_JUDGE_MODEL="${CODING_WF_JUDGE_MODEL:-gpt-6-astra}"
fi

if [ "$DRY_RUN" -eq 0 ] && [ "$(id -u)" -ne 0 ]; then
  echo "真装需要 root：sudo env PATH=\"\$PATH\" bash $0（或先用 --dry-run 预览）" >&2
  exit 1
fi

if [ "$DRY_RUN" -eq 0 ] && [ "$LOCKED_INSTALL" -eq 0 ]; then
  export HOME="$USER_HOME" CODING_WF_RUN_USER="$RUN_USER"
  exec node "$HERE/runtime-install.mjs" "$0"
fi
if [ "$LOCKED_INSTALL" -eq 1 ] && [ "${CODING_WF_INSTALL_LOCK_PID:-}" != "$PPID" ]; then
  echo "runtime_install_lock_required" >&2; exit 1
fi

# PATH：node/git/gh/所选 provider 的实际所在目录 + 系统目录，去重保序
DIRS=()
PROVIDER_BIN="$CODING_WF_PROVIDER"
if [ "$CODING_WF_PROVIDER" = codex ]; then PROVIDER_BIN="${CODING_WF_CODEX_BIN:-codex}"; fi
for tool in node git gh "$PROVIDER_BIN"; do
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

# 把 __<占位>__ 占位行换成环境变量 <名> 的 key/string 两行；未设置/为空则整行删除。用法：fill_env <占位> <变量名>
# 值经环境变量传入 awk（避免转义被 awk 解释），并先做 XML 转义（& 须最先转）。
fill_env() {
  local placeholder="$1" name="$2" val="${!2:-}"
  # 不用 ${val//</&lt;}：bash 5.2 起替换串里的 & 代表匹配文本（patsub_replacement），Linux 上会得到 <lt;
  val="$(printf '%s' "$val" | sed -e 's/&/\&amp;/g' -e 's/</\&lt;/g' -e 's/>/\&gt;/g')"
  ENV_XML="$val" ENV_NAME="$name" PLACEHOLDER="$placeholder" awk '
    $0 ~ "^[[:space:]]*" ENVIRON["PLACEHOLDER"] "[[:space:]]*$" {
      if (ENVIRON["ENV_XML"] != "") {
        print "    <key>" ENVIRON["ENV_NAME"] "</key>"
        print "    <string>" ENVIRON["ENV_XML"] "</string>"
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
      "$TEMPLATE" | fill_env __AUTOMERGE_ENV__ CODING_WF_AUTOMERGE | fill_env __REPOS_ENV__ CODING_WF_REPOS \
      | fill_env __PROVIDER_ENV__ CODING_WF_PROVIDER \
      | fill_env __CODEX_HOME_ENV__ CODING_WF_CODEX_HOME \
      | fill_env __CODEX_BIN_ENV__ CODING_WF_CODEX_BIN \
      | fill_env __CODEX_MODEL_ENV__ CODING_WF_CODEX_MODEL \
      | fill_env __JUDGE_PROVIDER_ENV__ CODING_WF_JUDGE_PROVIDER \
      | fill_env __JUDGE_MODEL_ENV__ CODING_WF_JUDGE_MODEL
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

# dry-run 仅打印，不读取生产进程；真实安装必须先看清旧 daemon/直接 runner 都空闲。
do_cmd env HOME="$USER_HOME" node "$HERE/runtime-install-guard.mjs"

# 在实际运行用户下检查；dry-run 仅展示命令，不读取账户、不触发任务。
do_cmd sudo -u "$RUN_USER" env HOME="$USER_HOME" PATH="$RUN_PATH" \
  CODING_WF_PROVIDER="$CODING_WF_PROVIDER" \
  CODING_WF_CODEX_HOME="${CODING_WF_CODEX_HOME:-}" \
  CODING_WF_CODEX_BIN="${CODING_WF_CODEX_BIN:-}" \
  CODING_WF_CODEX_MODEL="${CODING_WF_CODEX_MODEL:-}" \
  CODING_WF_JUDGE_PROVIDER="${CODING_WF_JUDGE_PROVIDER:-}" \
  CODING_WF_JUDGE_MODEL="${CODING_WF_JUDGE_MODEL:-}" \
  node "$HERE/runtime-health.mjs"

# 专用 clone：以运行用户身份准备（runner.sh 之后每轮自更新）
if [ ! -d "$REPO/.git" ]; then
  do_cmd sudo -u "$RUN_USER" git clone -q "$ORIGIN_URL" "$REPO"
fi
# 首次切换也用候选代码安全快进旧 clone，保留hb/lights；拒绝更新则停止安装。
do_cmd sudo -u "$RUN_USER" env HOME="$USER_HOME" PATH="$RUN_PATH" \
  node "$HERE/runtime-update.mjs" "$REPO"
# 其他已启用仓库的专用 clone（repos.json 的路径与 origin）：缺的以运行用户身份 clone；已存在的不动
CLONES_SH="$HERE/list-clones.mjs"
if [ -f "$CLONES_SH" ]; then
  CLONE_LIST="$(HOME="$USER_HOME" node "$CLONES_SH")" || { echo "读 repos.json 失败，不能列仓库 clone" >&2; exit 1; }
  while IFS=$'\t' read -r EXTRA_CLONE EXTRA_ORIGIN; do
    [ -n "$EXTRA_CLONE" ] || continue
    [ -e "$EXTRA_CLONE/.git" ] && continue
    do_cmd sudo -u "$RUN_USER" git clone -q "$EXTRA_ORIGIN" "$EXTRA_CLONE"
  done <<< "$CLONE_LIST"
fi
# 日志文件预建并归运行用户
do_cmd mkdir -p "$(dirname "$LOG_FILE")"
do_cmd touch "$LOG_FILE"
do_cmd chown "$RUN_USER" "$LOG_FILE"

# 前置检查后可能经历 clone，写入/bootout 前再核一次，拒绝中途启动的任务。
do_cmd env HOME="$USER_HOME" node "$HERE/runtime-install-guard.mjs"
do_cmd install -m 644 -o root -g wheel "$PLIST_SRC" "$DEST"
if [ "$DRY_RUN" -eq 1 ]; then
  echo "# 原服务disabled时在任何服务/配置动作前拒绝：runtime_install_disabled"
  echo "# 以下由安装器持外锁执行；仅原已加载时bootout"
  echo "launchctl bootout system/$LABEL"
  do_cmd launchctl enable "system/$LABEL"
  do_cmd launchctl bootstrap system "$DEST"
  echo "# 随后恢复安装前disabled/enabled状态；失败恢复原plist/loaded状态"
fi

if [ "$DRY_RUN" -eq 0 ]; then
  rm -f "$PLIST_SRC"
  echo "已准备 ${LABEL} 配置；由持锁安装器加载并恢复原启用状态"
fi
