---
task_id: 3a27ca36-7be9-4efc-a27f-18361dae6557
step: evaluate
upstream: ["02-spec.md#Q-1", "02-spec.md#Q-2", "02-spec.md#Q-3", "02-spec.md#Q-4", "02-spec.md#Q-5", "02-spec.md#Q-6"]
---
# QA 报告（第 3 轮，环境 http://localhost:5301）

### T-1
对应: Q-1
verdict: PASS
说明: 安装变量、仅启用 cecelia、dry-run 与禁用门均在最终手册。
```command
node -e 'const fs=require("fs");const p="packages/brain/scripts/coding-workflow/runner/README.md";const s=fs.readFileSync(p,"utf8");for(const x of ["CODING_WF_PROVIDER=codex","CODING_WF_CODEX_HOME=/Users/administrator/.codex-team1","CODING_WF_CODEX_MODEL=gpt-6-sol","CODING_WF_JUDGE_PROVIDER=codex","CODING_WF_JUDGE_MODEL=gpt-6-astra","CODING_WF_REPOS=cecelia","--dry-run","runtime_install_disabled","sudo env PATH"])if(!s.includes(x))throw Error(x);console.log("安装手册核对通过")'
```
```output
安装手册核对通过
```

### T-2
对应: Q-1
verdict: PASS
说明: 人工逐分支核对完整安装器：默认 Codex 与两模型、dry-run 只打印、真实安装需 root 和锁；原 disabled 由安装器先拒绝。
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

### T-3
对应: Q-1,Q-2
verdict: PASS
说明: 禁用状态在修改服务状态之前拒绝；持外锁、检查空闲、失败恢复旧配置。
```command
/opt/homebrew/bin/rg --no-config -n -e 'runtime_install_disabled|strictLock|assertIdle|print-disabled|bootstrap|bootout' -- packages/brain/scripts/coding-workflow/runner/runtime-install.mjs
```
```output
6:import { strictLock } from './runtime-lock.mjs';
8:import { assertIdle } from './runtime-install-guard.mjs';
22:  const lock = strictLock(path.join(locks, 'launcher'));
38:    const disabled = await ctl('print-disabled', 'system');
41:      : disabled.includes(label) || !/disabled services\s*=\s*\{/.test(disabled)) throw new Error('runtime_install_disabled_state_unknown');
44:    if (entry?.[1] === 'true' || entry?.[1] === 'disabled') throw new Error('runtime_install_disabled');
47:    ({ loaded: loadedBefore } = await assertIdle({ env, allowLauncherPid: process.pid }));
68:    if (loadedBefore) await ctl('bootout', `system/${label}`);
70:    await ctl('bootstrap', 'system', dest);
101:      // 必要恢复动作独立尝试：bootout或bootstrap失败不应跳过文件及disabled状态恢复。
103:        if (await restore(() => ctl('bootout', `system/${label}`))) loadedNow = false;
112:        if (await restore(() => ctl('enable', `system/${label}`))) await restore(() => ctl('bootstrap', 'system', dest));
```

### T-4
对应: Q-1,Q-6
verdict: PASS
说明: 具体仓库对象：cecelia 为默认启用仓；ZenithJoy 虽启用仍设人工合并。
```command
node -e 'const fs=require("fs");const p="packages/brain/scripts/coding-workflow/repos.json";const s=JSON.parse(fs.readFileSync(p,"utf8"));if(s.repos[0].key!=="cecelia"||s.repos[0].default!==true||s.repos[0].enabled!==true||s.repos[1].key!=="zenithjoy-workspace"||s.repos[1].enabled!==true||s.repos[1].automerge!==false)throw Error("repos_configuration");console.log("cecelia default and ZenithJoy manual merge checked");'
```
```output
cecelia default and ZenithJoy manual merge checked
```

### T-5
对应: Q-2
verdict: PASS
说明: 手册对 disabled、账号失败、并发和旧锁给出停止与人工核实路径。
```command
node -e 'const fs=require("fs");const p="packages/brain/scripts/coding-workflow/runner/README.md";const s=fs.readFileSync(p,"utf8");for(const x of ["runtime_install_disabled","操作者确认后明确恢复启用","不能临时绕过禁用门","账号不可用","不能自动换账号、模型、API key 或 Claude","并发或旧锁不保证成功","不按年龄删除","核对锁目录的 PID"])if(!s.includes(x))throw Error(x);console.log("故障判读核对通过")'
```
```output
故障判读核对通过
```

### T-6
对应: Q-2
verdict: PASS
说明: 安装守卫只读核实 system daemon 和两处锁的 PID；状态不明即拒绝。
```command
cat packages/brain/scripts/coding-workflow/runner/runtime-install-guard.mjs
```
```output
// 安装前只读探测：不停止服务，不删除任何锁；看不清即拒绝，由外层等空闲后重试。
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { runtimeProcess } from './runtime-process.mjs';
import { pathToFileURL } from 'node:url';

export async function assertIdle({ env = process.env, allowLauncherPid = null } = {}) {
  const service = await runtimeProcess('launchctl', ['print', 'system/com.cecelia.coding-workflow-runner'], {
    env, timeoutMs: 5000,
  });
  const output = `${service.stdout ?? ''}\n${service.stderr ?? ''}`;
  if (service.terminated) throw new Error('runtime_install_daemon_unknown');
  if (service.code !== 0) {
    if (service.error || !output.includes('Could not find service "com.cecelia.coding-workflow-runner"')) throw new Error('runtime_install_daemon_unknown');
  } else {
    const count = /^\s*active count = (\d+)\s*$/m.exec(output);
    if (!count) throw new Error('runtime_install_daemon_unknown');
    if (Number(count[1]) > 0 || /^\s*pid = [1-9]\d*\s*$/m.test(output) || /^\s*state = running\s*$/m.test(output)) {
      throw new Error('runtime_install_daemon_active');
    }
  }
  const locks = env.CODING_WF_LOCK_DIR || path.join(env.HOME || os.homedir(), '.cecelia');
  for (const name of ['coding-workflow-runner.lock', 'launcher/coding-workflow-runner.lock']) {
    const dir = path.join(locks, name);
    if (!fs.existsSync(dir)) continue;
    let raw;
    try { raw = fs.readFileSync(path.join(dir, 'pid'), 'utf8').trim(); }
    catch { throw new Error('runtime_install_lock_unknown'); }
    if (!/^[1-9]\d*$/.test(raw)) throw new Error('runtime_install_lock_unknown');
    if (name.startsWith('launcher/') && Number(raw) === allowLauncherPid) continue;
    try { process.kill(Number(raw), 0); }
    catch (error) {
      if (error.code === 'ESRCH') continue;
      throw new Error('runtime_install_runner_active');
    }
    throw new Error('runtime_install_runner_active');
  }
  return { loaded: service.code === 0 };
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try { await assertIdle({ allowLauncherPid: Number(process.env.CODING_WF_INSTALL_LOCK_PID) || null }); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
```

### T-7
对应: Q-2,Q-3
verdict: PASS
说明: 账号检查只接受 ChatGPT 订阅登录，并从子进程环境剔除 API key。
```command
/opt/homebrew/bin/rg --no-config -n -e 'Logged in using ChatGPT|OPENAI_API_KEY|CODEX_API_KEY|CODEX_ACCESS_TOKEN|OPENAI_ACCESS_TOKEN|runtime_codex_' -- packages/brain/scripts/coding-workflow/runner/runtime-health.mjs
```
```output
9:  for (const key of ['OPENAI_API_KEY', 'CODEX_API_KEY', 'CODEX_ACCESS_TOKEN', 'OPENAI_ACCESS_TOKEN']) delete clean[key];
19:    throw new Error('runtime_codex_home_missing');
31:  if (status.code !== 0 || status.terminated || `${status.stdout ?? ''}\n${status.stderr ?? ''}`.trim() !== 'Logged in using ChatGPT') {
32:    throw new Error('runtime_codex_chatgpt_login_required');
```

### T-8
对应: Q-3
verdict: PASS
说明: 健康、system 状态、回执、plist 日志定位及自定义 home 案例均在手册。
```command
node -e 'const fs=require("fs");const p="packages/brain/scripts/coding-workflow/runner/README.md";const s=fs.readFileSync(p,"utf8");for(const x of ["runtime-health.mjs","launchctl print system/com.cecelia.coding-workflow-runner","launchctl print-disabled system","status.mjs --json","CODING_WF_USER_HOME=/Volumes/runner-home","/Volumes/runner-home/Library/Logs/coding-workflow-runner.log","StandardOutPath","StandardErrorPath","tail -n 100","ok:true","authentication:\"chatgpt\"","Logged in using ChatGPT"])if(!s.includes(x))throw Error(x);console.log("健康与日志手册核对通过")'
```
```output
健康与日志手册核对通过
```

### T-9
对应: Q-3
verdict: PASS
说明: 在本轮新建空目录查询回执，真实返回空数组。
```command
status_dir=$(mktemp -d /private/tmp/qa-r3-status.XXXXXX); node packages/brain/scripts/coding-workflow/runner/status.mjs --log-dir "$status_dir" --json
```
```output
[]
```

### T-10
对应: Q-3
verdict: PASS
说明: plist 模板有运行用户、周期、stdout 和 stderr 字段；手册说明 300 秒与自定义 home 路径。
```command
/opt/homebrew/bin/rg --no-config -n -e 'StandardOutPath|StandardErrorPath|StartInterval|UserName|ProgramArguments' -- packages/brain/scripts/coding-workflow/runner/com.cecelia.coding-workflow-runner.plist.tmpl
```
```output
7:  <key>UserName</key>
9:  <key>ProgramArguments</key>
14:  <key>StartInterval</key>
48:  <key>StandardOutPath</key>
50:  <key>StandardErrorPath</key>
```

### T-11
对应: Q-4
verdict: PASS
说明: 手册逐案列出脏目录、ahead/分叉、心跳冲突与未知旧锁的保留现场处理。
```command
node -e 'const fs=require("fs");const p="packages/brain/scripts/coding-workflow/runner/README.md";const s=fs.readFileSync(p,"utf8");for(const x of [".cecelia/hb.sh",".cecelia/lights/<安全文件名>.live","git merge --ff-only","源码脏","本地 ahead 或分叉","心跳冲突","git reset --hard","git clean","旧锁或未知锁","PID 与启动时间"])if(!s.includes(x))throw Error(x);console.log("更新与旧锁手册核对通过")'
```
```output
更新与旧锁手册核对通过
```

### T-12
对应: Q-4
verdict: PASS
说明: 实现只放行指定心跳文件，并以祖先检查及 ff-only 更新；其他脏文件拒绝。
```command
/opt/homebrew/bin/rg --no-config -n -e 'hb\.sh|lights|ff-only|ancestor|status|dirty|ahead|merge' -- packages/brain/scripts/coding-workflow/runner/runtime-update.mjs
```
```output
6:const runtimePath = p => p === '.cecelia/hb.sh' || /^\.cecelia\/lights\/[a-zA-Z0-9][a-zA-Z0-9._-]*\.live$/.test(p);
7:const operationFiles = ['MERGE_HEAD', 'CHERRY_PICK_HEAD', 'REVERT_HEAD', 'REBASE_HEAD', 'rebase-merge', 'rebase-apply', 'sequencer', 'BISECT_LOG'];
19:    const status = await git('status', '--porcelain=v1', '-z', '--untracked-files=all');
20:    const records = status.split('\0');
21:    if (records.pop() !== '') throw new Error('invalid_status');
24:      if (!record.startsWith('?? ') || !runtimePath(record.slice(3))) throw new Error('dirty');
34:    // 本地 ahead 或分叉都不抹掉。即使干净也不允许 hard reset。
35:    await git('merge-base', '--is-ancestor', before, target);
40:    await git('-c', 'merge.autoStash=false', 'merge', '--ff-only', '--no-edit', '--no-overwrite-ignore', target);
```

### T-13
对应: Q-6
verdict: PASS
说明: 逐一核查三包的具体版本与非空 integrity；本次执行的是静态、只读、可失败命令。
```command
node -e 'const fs=require("fs");const p="packages/brain/scripts/coding-workflow/runner/runtime-deps/package-lock.json";const s=JSON.parse(fs.readFileSync(p,"utf8"));if(!s.packages["node_modules/playwright"]||s.packages["node_modules/playwright"].version!=="1.62.1"||!s.packages["node_modules/playwright"].integrity||!s.packages["node_modules/playwright-core"]||s.packages["node_modules/playwright-core"].version!=="1.62.1"||!s.packages["node_modules/playwright-core"].integrity||!s.packages["node_modules/acorn"]||s.packages["node_modules/acorn"].version!=="8.16.0"||!s.packages["node_modules/acorn"].integrity)throw Error("package_version_or_integrity");console.log("Playwright/core/Acorn specific versions and integrity checked");'
```
```output
Playwright/core/Acorn specific versions and integrity checked
```

### T-14
对应: Q-4
verdict: PASS
说明: 启动器和运行器分别加锁，之后再调用 runtime-run.sh。
```command
/opt/homebrew/bin/rg --no-config -n -e 'runtime-health|runtime-update|runtime-run|strictLock' -- packages/brain/scripts/coding-workflow/runner/runtime-launch.mjs
```
```output
6:import { strictLock } from './runtime-lock.mjs';
8:import { updateClone } from './runtime-update.mjs';
9:import { checkRuntimeHealth, codexEnvironment } from './runtime-health.mjs';
21:  const outer = strictLock(path.join(locks, 'launcher'));
25:    updateLock = strictLock(locks);
40:    const result = await runtimeProcess('/bin/bash', [path.join(here, 'runtime-run.sh')], {
```

### T-15
对应: Q-5
verdict: PASS
说明: 同 shell 指定本轮 PREVIEW_URL，继承 CURL_HOME；health 的完整 SHA 与本 PR 检出 HEAD 一致。
```command
PREVIEW_URL=http://localhost:5301; curl -fsS "$PREVIEW_URL/api/brain/health" | jq -e --arg sha "$(git rev-parse HEAD)" 'if .git_sha == $sha then .git_sha else error("sha mismatch") end'
```
```output
"04279e2b13f043dcdcc9307e4305fecd6149554c"
```

### T-16
对应: Q-5
verdict: PASS
说明: 手册明确 PR/head、Unix 桥、同源 HTTP、隔离浏览器及 WS/SW/跨源不能验的边界。
```command
node -e 'const fs=require("fs");const p="packages/brain/scripts/coding-workflow/runner/README.md";const s=fs.readFileSync(p,"utf8");for(const x of ["40 位 head SHA","git_sha","PREVIEW_URL","CURL_HOME","Unix socket","同源 HTTP API","隔离 Chromium","跨源重定向","WebSocket","Service Worker","CANNOT_VERIFY","preview_unavailable","preview_stale"])if(!s.includes(x))throw Error(x);console.log("预览边界手册核对通过")'
```
```output
预览边界手册核对通过
```

### T-17
对应: Q-5
verdict: PASS
说明: 控制器按 head 和 PR 建能力，漂移报错；Codex 会话注入 CURL_HOME。
```command
/opt/homebrew/bin/rg --no-config -n -e 'git_sha|headSha|prNumber|preview_sha_mismatch|CURL_HOME|PREVIEW_URL' -- packages/brain/scripts/coding-workflow/activities/evaluate.mjs packages/brain/scripts/coding-workflow/lib/codex-session.mjs packages/brain/scripts/coding-workflow/lib/preview-bridge.mjs packages/brain/scripts/coding-workflow/lib/preview.mjs
```
```output
packages/brain/scripts/coding-workflow/lib/preview.mjs:10:/** 预览 Brain 部署所用的提交（/api/brain/health 的 git_sha）；查不到返回 null。 */
packages/brain/scripts/coding-workflow/lib/preview.mjs:15:    return typeof body?.git_sha === 'string' && body.git_sha ? body.git_sha : null;
packages/brain/scripts/coding-workflow/lib/codex-session.mjs:46:  if (/^PREVIEW_URL:\s*\S+/m.test(input.prompt) && !preview) throw new Error('codex_qa_local_only');
packages/brain/scripts/coding-workflow/lib/codex-session.mjs:94:    env: { ...(env.CODING_WF_CODEX_HOME ? { CODEX_HOME: env.CODING_WF_CODEX_HOME } : {}), ...(preview ? { CURL_HOME: preview.runtimeDir, CODING_WF_PREVIEW_BROWSER_HELPER: preview.browserHelperPath } : {}) } };
packages/brain/scripts/coding-workflow/activities/evaluate.mjs:17:  loadPrompt, claudeTimeoutMs, runClaude, claudeFailure, headSha, snapshotChanges, outOfScopeChanges,
packages/brain/scripts/coding-workflow/activities/evaluate.mjs:44:  const headAfter = await headSha(worktree);
packages/brain/scripts/coding-workflow/activities/evaluate.mjs:126:    ...(local ? { WORKTREE: worktree, PRODUCTION: production.join(' | ') } : { PREVIEW_URL: preview.url }),
packages/brain/scripts/coding-workflow/activities/evaluate.mjs:133:  const before = { head: await headSha(worktree), changes: await snapshotChanges(worktree) };
packages/brain/scripts/coding-workflow/activities/evaluate.mjs:147:        state.bridge = await createPreviewBridge({ origin: preview.url, headSha: input.head_sha, prNumber: input.pr_number, production });
packages/brain/scripts/coding-workflow/activities/evaluate.mjs:171:        result = fail('retryable', error.message === 'preview_sha_mismatch' ? 'preview_stale' : 'preview_unavailable',
packages/brain/scripts/coding-workflow/lib/preview-bridge.mjs:50:export async function createPreviewBridge({ origin, headSha, prNumber, production = null }) {
packages/brain/scripts/coding-workflow/lib/preview-bridge.mjs:52:  if (!/^[a-f0-9]{40}$/.test(headSha ?? '') || !Number.isSafeInteger(prNumber) || prNumber <= 0) throw new Error('preview_identity_invalid');
packages/brain/scripts/coding-workflow/lib/preview-bridge.mjs:64:    if (r.status !== 200 || body?.git_sha !== headSha) {
packages/brain/scripts/coding-workflow/lib/preview-bridge.mjs:65:      invalidated = 'preview_sha_mismatch'; if (capability) active.delete(capability);
packages/brain/scripts/coding-workflow/lib/preview-bridge.mjs:72:  // CURL_HOME keeps report commands portable; CI/preflight use those exact commands without this transport config.
packages/brain/scripts/coding-workflow/lib/preview-bridge.mjs:75:  capability = Object.freeze({ runtimeDir, socketPath, browserHelperPath, origin: target.origin, headSha, prNumber });
packages/brain/scripts/coding-workflow/lib/preview-bridge.mjs:92:      if (requests.length < 1000) requests.push({ method: req.method, path: req.url, status: r.status, sha: headSha });
```

### T-18
对应: Q-5
verdict: PASS
说明: 预览桥拒绝跨源跳转、CONNECT/upgrade，并设请求体及超时限制。
```command
/opt/homebrew/bin/rg --no-config -n -e 'upgrade|CONNECT|location|origin|body_limit|timeout|preview_sha_mismatch' -- packages/brain/scripts/coding-workflow/lib/preview-bridge.mjs
```
```output
11:const HOP = new Set(['connection', 'proxy-connection', 'keep-alive', 'transfer-encoding', 'upgrade', 'proxy-authorization', 'proxy-authenticate', 'host']);
19:function originOf(origin, production) {
21:  try { u = new URL(origin); } catch { throw new Error('preview_origin_invalid'); }
24:    || productionMatchers(production).target.test(u.origin)) throw new Error('preview_origin_invalid');
31:    stream.on('data', (chunk) => { size += chunk.length; if (size > LIMIT) { reject(new Error('preview_body_limit')); stream.destroy(); } else chunks.push(chunk); });
37:function upstream(origin, target, options, pending, ensureActive) {
40:    const req = http.request({ hostname: origin.hostname, port: origin.port, path: target, agent: false,
41:      method: options.method ?? 'GET', headers: { ...headers(options.headers ?? {}), host: origin.host, connection: 'close' }, timeout: 10000 }, async (res) => {
45:    req.on('timeout', () => req.destroy(new Error('preview_upstream_timeout'))); req.on('error', reject);
50:export async function createPreviewBridge({ origin, headSha, prNumber, production = null }) {
51:  const target = originOf(origin, production);
65:      invalidated = 'preview_sha_mismatch'; if (capability) active.delete(capability);
74:  const browserHelperPath = writePreviewBrowserHelper({ runtimeDir, socketPath, origin: target.origin });
75:  capability = Object.freeze({ runtimeDir, socketPath, browserHelperPath, origin: target.origin, headSha, prNumber });
80:      || /[\\\x00-\x20]/.test(req.url) || req.headers.upgrade || req.method === 'CONNECT') return deny(403, 'preview_bridge_forbidden');
88:      if (r.headers.location) {
89:        const location = new URL(r.headers.location, target.origin);
90:        if (location.origin !== target.origin || location.username || location.password) return deny(502, 'preview_redirect_forbidden');
98:  server.on('upgrade', (_req, socket) => socket.end('HTTP/1.1 403 Forbidden\r\nContent-Length: 0\r\nConnection: close\r\n\r\n'));
```

### T-19
对应: Q-5,Q-6
verdict: PASS
说明: 浏览器 helper 的隔离 context、Service Worker 阻止、WebSocket 与跨源阻止、单进程启动均有对应实现。按合同只读核对，本任务不启动浏览器。
```command
node -e 'const fs=require("fs");const p="packages/brain/scripts/coding-workflow/lib/preview-browser.mjs";const s=fs.readFileSync(p,"utf8");for(const x of ["newContext","serviceWorkers","routeWebSocket","origin_blocked","chromium.launch","--single-process","--no-zygote"])if(!s.includes(x))throw Error(x);console.log("浏览器 helper 关键词核对通过")'
```
```output
浏览器 helper 关键词核对通过
```

### T-20
对应: Q-6
verdict: PASS
说明: 手册写出专用依赖路径、版本、链接和实启动检查命令，并说明缺依赖时停止；PR #2132 待人工。
```command
node -e 'const fs=require("fs");const p="packages/brain/scripts/coding-workflow/runner/README.md";const s=fs.readFileSync(p,"utf8");for(const x of ["playwright-1.62.1/node_modules","playwright-core 均为 1.62.1","Acorn 8.16.0","package-lock.json","integrity","node_modules","--single-process","--no-zygote","headless:true","preview_browser_unavailable","automerge=false","PR #2132","人工放行"])if(!s.includes(x))throw Error(x);console.log("依赖与人工放行手册核对通过")'
```
```output
依赖与人工放行手册核对通过
```

### T-21
对应: Q-6
verdict: PASS
说明: 合并门在 repoAutomerge=false 时转交人工，不自动执行合并。
```command
/opt/homebrew/bin/rg --no-config -n -e 'repoAutomerge === false|awaitHuman|不自动合并' -- packages/brain/scripts/coding-workflow/runner/lib/merge-gate.mjs
```
```output
7:// 不自动合并的仓库（repos.json automerge=false，如 zenithjoy：合入 main 会自动部署生产手机控制器）：走到合并这一步不调 merge，
56:  if (cfg.repoAutomerge === false) return awaitHuman(ctx, pr, s, taskId);
186: * 不自动合并的仓库：批准且必需检查全绿 → 记 awaiting_human、Bark 主理人、Brain phase=awaiting_human。
189:async function awaitHuman(ctx, pr, s, taskId) {
195:    `QA + 独立裁判已通过（head ${head.slice(0, 9)}），${cfg.repoKey} 不自动合并（repos.json automerge=false），请人工合并：${pr.url}`);
198:  ctx.log(`[coding-merge][P1] 合并门 ${label} 已批准，等人合并（本仓不自动合并）${notified ? '' : '（Bark 未送达）'}：${pr.url}`);
213:/** 不自动合并的仓库：等人合并的 PR 已被人合并 → 收账（只收一次）。不抛错，不算本轮动作。 */
```

### X-1
对应: Q-3
verdict: PASS
说明: 探索：回执目录不存在时，状态命令仍返回 []；手册明确 [] 只表示无回执，不把它当服务健康。
```command
node packages/brain/scripts/coding-workflow/runner/status.mjs --log-dir /private/tmp/qa-r3-status-no-such-dir-6433 --json
```
```output
[]
```

## 结论

Q-1 至 Q-6 的本轮手册及源码对照均通过；预览 health 的 git_sha 与当前 HEAD 一致。安装、账号、浏览器实启动和生产放行均按合同只核对操作说明与现有实现，本轮未执行。

