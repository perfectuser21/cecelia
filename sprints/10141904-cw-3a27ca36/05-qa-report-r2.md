---
task_id: 3a27ca36-7be9-4efc-a27f-18361dae6557
step: evaluate
upstream: ["02-spec.md#Q-1", "02-spec.md#Q-2", "02-spec.md#Q-3", "02-spec.md#Q-4", "02-spec.md#Q-5", "02-spec.md#Q-6"]
---
# QA 报告（第 2 轮，环境 http://localhost:5301）

### T-1
对应: Q-1
verdict: PASS
说明: 完整读取安装器并人工逐项核对：默认运行用户 administrator、home 为 `/Users/<运行用户>`、provider 为 codex、开发/裁判模型分别为 gpt-6-sol/gpt-6-astra、仓库默认仅 cecelia；`--dry-run` 解析到 `DRY_RUN=1`，仅打印 plist 与拟执行命令；真实安装需 root，交给 runtime-install.mjs 的外锁及 disabled 门，并有安装前后空闲检查。手册示例的 `sudo env PATH="$PATH"`、CODEX_HOME 与这份源码相符。
```command
cat packages/brain/scripts/coding-workflow/runner/install.sh
```
```output
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
```

### T-2
对应: Q-1
verdict: PASS
```command
node -e 'const fs=require("fs");const p="packages/brain/scripts/coding-workflow/runner/README.md";const s=fs.readFileSync(p,"utf8");for(const x of ["CODING_WF_PROVIDER=codex","CODING_WF_CODEX_MODEL=gpt-6-sol","CODING_WF_JUDGE_PROVIDER=codex","CODING_WF_JUDGE_MODEL=gpt-6-astra","CODING_WF_REPOS=cecelia","--dry-run","runtime_install_disabled"])if(!s.includes(x))throw Error(x);console.log("安装手册核对通过")'
```
```output
安装手册核对通过
```

### T-3
对应: Q-2
verdict: PASS
说明: 人工对照 runtime-install.mjs、runtime-health.mjs、runtime-install-guard.mjs：disabled 在服务变更前拒绝；账号失效返回错误，API key 被剔除；外锁和进程空闲门拒绝并发，旧锁不自动删除。手册的下一步均为停下、核实现场和人工恢复。
```command
node -e 'const fs=require("fs");const p="packages/brain/scripts/coding-workflow/runner/README.md";const s=fs.readFileSync(p,"utf8");for(const x of ["CODING_WF_CODEX_HOME=/Users/administrator/.codex-team1","sudo env PATH=","runtime_install_disabled","不能临时绕过禁用门","API key","Claude","旧锁","PID"])if(!s.includes(x))throw Error(x);console.log("安装与故障判读文本核对通过")'
```
```output
安装与故障判读文本核对通过
```

### T-4
对应: Q-3
verdict: PASS
说明: README 给出健康检查、system 域状态、回执及 plist 的 StandardOutPath/StandardErrorPath 查询。与 runtime-health.mjs、status.mjs、plist 模板及 install.sh 对照，自定义 home 应得 `/Volumes/runner-home/Library/Logs/coding-workflow-runner.log`；手册明确空回执不代表服务正常。
```command
node -e 'const fs=require("fs");const p="packages/brain/scripts/coding-workflow/runner/README.md";const s=fs.readFileSync(p,"utf8");for(const x of ["runtime-health.mjs","Logged in using ChatGPT","ok:true","authentication:","launchctl print system/com.cecelia.coding-workflow-runner","launchctl print-disabled system","status.mjs --json","CODING_WF_USER_HOME=/Volumes/runner-home","/Volumes/runner-home/Library/Logs/coding-workflow-runner.log","StandardOutPath","StandardErrorPath","tail -n 100"])if(!s.includes(x))throw Error(x);console.log("健康与日志文本核对通过")'
```
```output
健康与日志文本核对通过
```

### T-5
对应: Q-3
verdict: PASS
```command
mkdir -p /private/tmp/qa-3a27ca36-r2-empty && node packages/brain/scripts/coding-workflow/runner/status.mjs --log-dir /private/tmp/qa-3a27ca36-r2-empty --json | node -e 'let s="";process.stdin.on("data",x=>s+=x);process.stdin.on("end",()=>{if(s.trim()!=="[]")throw Error(s);console.log(s.trim())})'
```
```output
[]
```

### T-6
对应: Q-4
verdict: PASS
说明: 人工对照 runtime-update.mjs、runtime-lock.mjs、runtime-launch.mjs：白名单限未跟踪 `.cecelia/hb.sh` 与安全命名的 `.cecelia/lights/*.live`；先验 main、Git 状态、祖先关系和心跳冲突，再执行 `merge --ff-only`。文档提及 reset/clean 仅用于明确禁止；旧锁须核对 PID、进程、launchctl 与任务现场。
```command
node -e 'const fs=require("fs");const p="packages/brain/scripts/coding-workflow/runner/README.md";const s=fs.readFileSync(p,"utf8");for(const x of [".cecelia/hb.sh",".cecelia/lights/<安全文件名>.live","git merge --ff-only","本地 ahead 或分叉","Git 操作中","心跳冲突","git reset --hard","git clean","不按年龄删除","PID"])if(!s.includes(x))throw Error(x);console.log("更新与旧锁文本核对通过")'
```
```output
更新与旧锁文本核对通过
```

### T-7
对应: Q-5
verdict: PASS
说明: 同一 shell 设置本轮 PREVIEW_URL，保留控制器的 CURL_HOME；health 的 40 位 SHA 与本检出 HEAD 一致。
```command
set -o pipefail; PREVIEW_URL=http://localhost:5301; curl -fsS "$PREVIEW_URL/api/brain/health" | jq -e --arg sha "$(git rev-parse HEAD)" '{status,git_sha,sha_matches:(.git_sha==$sha)} | select(.sha_matches == true)'
```
```output
{
  "status": "healthy",
  "git_sha": "47b2a5e590e1ac388e82c41d63662af10a19a916",
  "sha_matches": true
}
```

### T-8
对应: Q-5
verdict: PASS
说明: 人工对照 activities/evaluate.mjs、lib/preview-bridge.mjs、lib/codex-session.mjs 与 lib/preview-browser.mjs：PR/head 能力绑定和逐请求 SHA 核验、Unix 桥、同源 HTTP、跨源及 WS 阻断、Service Worker 禁用均与手册一致；依赖这些能力的业务步骤应记 CANNOT_VERIFY。本场景只核对文档和源码，不启动浏览器。
```command
node -e 'const fs=require("fs");const p="packages/brain/scripts/coding-workflow/runner/README.md";const s=fs.readFileSync(p,"utf8");for(const x of ["40 位 head SHA","/api/brain/health","git_sha","PREVIEW_URL","CURL_HOME","Unix socket","同源 HTTP API","隔离 Chromium","跨源重定向","WebSocket","serviceWorkers:","CANNOT_VERIFY","preview_stale"])if(!s.includes(x))throw Error(x);console.log("预览边界文本核对通过")'
```
```output
预览边界文本核对通过
```

### T-9
对应: Q-6
verdict: PASS
说明: 只读核对浏览器 helper 的实际能力词，不启动 Chromium。手册的 headless 启动检查参数与 helper 相同，缺依赖时明确停止浏览器验收。
```command
node -e 'const fs=require("fs");const p="packages/brain/scripts/coding-workflow/lib/preview-browser.mjs";const s=fs.readFileSync(p,"utf8");for(const x of ["preview_browser_unavailable","chromium.launch","single-process","no-zygote","serviceWorkers","routeWebSocket"])if(!s.includes(x))throw Error(x);console.log("Browser helper source assertions checked");'
```
```output
Browser helper source assertions checked
```

### T-10
对应: Q-6
verdict: PASS
说明: 固定包键分别核验 Playwright、playwright-core 和 Acorn 的版本与非空 integrity。
```command
node -e 'const fs=require("fs");const p="packages/brain/scripts/coding-workflow/runner/runtime-deps/package-lock.json";const s=JSON.parse(fs.readFileSync(p,"utf8"));if(!s.packages["node_modules/playwright"]||s.packages["node_modules/playwright"].version!=="1.62.1"||!s.packages["node_modules/playwright"].integrity||!s.packages["node_modules/playwright-core"]||s.packages["node_modules/playwright-core"].version!=="1.62.1"||!s.packages["node_modules/playwright-core"].integrity||!s.packages["node_modules/acorn"]||s.packages["node_modules/acorn"].version!=="8.16.0"||!s.packages["node_modules/acorn"].integrity)throw Error("package_version_or_integrity");console.log("Playwright/core/Acorn specific versions and integrity checked");'
```
```output
Playwright/core/Acorn specific versions and integrity checked
```

### T-11
对应: Q-6
verdict: PASS
说明: 具体 repos 对象确认 cecelia 是默认仓、ZenithJoy 已启用且 automerge=false；merge-gate.mjs 中的 `repoAutomerge === false` 分支等待人工合并。手册保留 PR #2132 待人工和业务生产人工放行。
```command
node -e 'const fs=require("fs");const p="packages/brain/scripts/coding-workflow/repos.json";const s=JSON.parse(fs.readFileSync(p,"utf8"));if(s.repos[0].key!=="cecelia"||s.repos[0].default!==true||s.repos[1].key!=="zenithjoy-workspace"||s.repos[1].enabled!==true||s.repos[1].automerge!==false)throw Error("repo_policy");console.log("cecelia default and ZenithJoy automerge=false checked")'
```
```output
cecelia default and ZenithJoy automerge=false checked
```

### T-12
对应: Q-6
verdict: PASS
说明: 手册包含专用依赖路径、正式 clone 的链接检查、包版本/integrity 核查与真实 headless 启停命令，并明确本轮不执行启动。
```command
node -e 'const fs=require("fs");const p="packages/brain/scripts/coding-workflow/runner/README.md";const s=fs.readFileSync(p,"utf8");for(const x of ["playwright-1.62.1/node_modules","playwright-core","Acorn 8.16.0","integrity","readlink","chromium.launch","--single-process","--no-zygote","preview_browser_unavailable","automerge=false","PR #2132","人工放行"])if(!s.includes(x))throw Error(x);console.log("依赖和人工合并文本核对通过")'
```
```output
依赖和人工合并文本核对通过
```

### X-1
对应: Q-3
场景: 运维把日志目录填成不存在的路径，状态工具返回空数组；手册明确空数组不能证明服务正常。
verdict: PASS
```command
node packages/brain/scripts/coding-workflow/runner/status.mjs --log-dir /private/tmp/qa-3a27ca36-r2-missing --json | node -e 'let s="";process.stdin.on("data",x=>s+=x);process.stdin.on("end",()=>{if(s.trim()!=="[]")throw Error(s);console.log(s.trim())})'
```
```output
[]
```
