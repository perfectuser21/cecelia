# Coding workflow runner 常驻运行交接

本手册只描述现有 system LaunchDaemon 的安装、无领单检查和故障判读。下列路径是示例，执行前须以实际运行用户、订阅账号、专用 clone 和已安装 plist 为准。本次手册验收不安装或启用服务，不领单，不启动浏览器，不操作生产 Brain。

## 安装前核对

`install.sh` 默认 `CODING_WF_RUN_USER=administrator`，`CODING_WF_USER_HOME` 未设置时为 `/Users/<运行用户>`；示例 `CODING_WF_CODEX_HOME=/Users/administrator/.codex-team1` 只适用于该用户和该账号目录。先核对用户、绝对路径、该用户的 ChatGPT 订阅登录、专用 clone 位置，以及 `node`、`git`、`gh`、`codex` 在透传的 `PATH` 中可用。开发模型和独立裁判模型必须不同，裁判 provider 必须是 Codex。

```bash
# 在仓库根目录执行；按现场替换运行用户、USER_HOME 和 CODEX_HOME 的绝对路径
export CODING_WF_RUN_USER=administrator
export CODING_WF_USER_HOME=/Users/administrator
export CODING_WF_PROVIDER=codex
export CODING_WF_CODEX_HOME=/Users/administrator/.codex-team1
export CODING_WF_CODEX_MODEL=gpt-6-sol
export CODING_WF_JUDGE_PROVIDER=codex
export CODING_WF_JUDGE_MODEL=gpt-6-astra
export CODING_WF_REPOS=cecelia

bash packages/brain/scripts/coding-workflow/runner/install.sh --dry-run
sudo env PATH="$PATH" CODING_WF_RUN_USER="$CODING_WF_RUN_USER" CODING_WF_USER_HOME="$CODING_WF_USER_HOME" CODING_WF_PROVIDER="$CODING_WF_PROVIDER" CODING_WF_CODEX_HOME="$CODING_WF_CODEX_HOME" CODING_WF_CODEX_MODEL="$CODING_WF_CODEX_MODEL" CODING_WF_JUDGE_PROVIDER="$CODING_WF_JUDGE_PROVIDER" CODING_WF_JUDGE_MODEL="$CODING_WF_JUDGE_MODEL" CODING_WF_REPOS="$CODING_WF_REPOS" bash packages/brain/scripts/coding-workflow/runner/install.sh
```

正式安装需 root；`--dry-run` 仅打印 plist 和拟执行命令，不证明安装、账号或服务健康。若要按同一变量预览 root 命令，可在上面的 `sudo env ... bash .../install.sh` 末尾加 `--dry-run`，但仍只是打印。安装器写 `/Library/LaunchDaemons/com.cecelia.coding-workflow-runner.plist`，在 system 域以 `UserName=administrator`（或指定用户）每 300 秒调用 `/bin/bash <专用 clone>/packages/brain/scripts/coding-workflow/runner/runner.sh`；不是用户 LaunchAgent。

`repos.json` 中 ZenithJoy 即使 `enabled=true`，也必须显式列入 `CODING_WF_REPOS` 才启用；上例只启用 cecelia。显式配置 Claude 的兼容分支仍存在，但不是 Codex 故障时的自动回退。路径错误、模型缺失或相同、非 Codex 裁判、账号不可用、未知 provider (`runtime_provider_unknown`)、缺 root 都应停止并排查，不能自动换账号、模型、API key 或 Claude。原服务 disabled 时安装器返回 `runtime_install_disabled`；操作者确认后明确恢复启用，再重新安装，不能临时绕过禁用门。重复安装受原服务状态和安装锁保护，并发或旧锁不保证成功。

## 无领单健康与运行状态

以实际运行用户执行下面的无任务检查。它会调用 `codex login status`，精确要求输出 `Logged in using ChatGPT`；通过时 JSON 中有 `ok:true`、`authentication:"chatgpt"`。检查会从 Codex 子进程环境剔除 `OPENAI_API_KEY`、`CODEX_API_KEY`、`CODEX_ACCESS_TOKEN`、`OPENAI_ACCESS_TOKEN`。不要读取或输出账号凭据文件。

```bash
# 确认当前 shell 已是运行用户，且 HOME/CODEX_HOME 是该用户的真实路径
CODING_WF_PROVIDER=codex CODING_WF_CODEX_HOME=/Users/administrator/.codex-team1 CODING_WF_CODEX_MODEL=gpt-6-sol CODING_WF_JUDGE_PROVIDER=codex CODING_WF_JUDGE_MODEL=gpt-6-astra node packages/brain/scripts/coding-workflow/runner/runtime-health.mjs

launchctl print system/com.cecelia.coding-workflow-runner
launchctl print-disabled system
node packages/brain/scripts/coding-workflow/runner/status.mjs --json
```

`launchctl` 看 system 服务是否加载、启禁状态；`status.mjs --json` 看任务回执。空数组 `[]` 只表示未找到回执，不能证明服务正常。主日志按安装时的 `CODING_WF_USER_HOME` 推导为 `<USER_HOME>/Library/Logs/coding-workflow-runner.log`，例如自定义 `CODING_WF_USER_HOME=/Volumes/runner-home` 时是 `/Volumes/runner-home/Library/Logs/coding-workflow-runner.log`。已安装机器优先只读核对 plist 的实际 `StandardOutPath`；`StandardErrorPath` 指向同一文件：

```bash
plutil -extract StandardOutPath raw -o - /Library/LaunchDaemons/com.cecelia.coding-workflow-runner.plist
plutil -extract StandardErrorPath raw -o - /Library/LaunchDaemons/com.cecelia.coding-workflow-runner.plist
tail -n 100 "${CODING_WF_USER_HOME:-/Users/${CODING_WF_RUN_USER:-administrator}}/Library/Logs/coding-workflow-runner.log"
```

若 plist 路径与变量推导不同，以 plist 的 `StandardOutPath` 读日志。分别判读服务状态、任务回执和主日志；日志或 dry-run 单独都不能证明运行正常。日志可能含任务现场信息，不复制令牌或账号文件内容。

## 运行回执如何判读

从仓库根目录运行 `node packages/brain/scripts/coding-workflow/runner/status.mjs [--log-dir <目录>] [--json]`。`--log-dir` 指定要看的回执目录；省略时先取 `CODING_WF_LOG_DIR`，否则取运行用户 home 下的 `.cecelia/coding-workflow-runner`。`--json` 输出机器可读数组；普通模式逐行显示。结果按扫描到的 JSON 文件 mtime（修改时间）倒序排列。目录不存在或没有扫描到回执时，JSON 输出 `[]`，普通模式输出“没有运行记录（<目录>）”，进程仍以 0 退出；这只表示未找到记录，不证明服务健康。结合上面的 `launchctl` 状态和主日志继续检查。

状态按当前磁盘文件判读：含 `last_event` 的 JSON 显示 `running`；终态回执的 `status` 为 `completed`、`partial` 或 `failed` 时显示对应状态。`partial` 和 `failed` 会显示首个非 `completed`/`skipped` 活动；原因先取该活动最后一次尝试的 `reason_code`，再依次回落到活动、回执的 `reason_code`，最后为 `run_<status>`。解析失败或不符合上述状态形状的 JSON 显示 `unreadable`。扫描范围是目录中除 `cifix-<数字>.json` 外的所有 `.json` 普通文件；合法的 `qa`、`commander` 状态 JSON 和终态回写待办 `pr-sync-pending.json` 也可能显示 `unreadable`。这个标签不能单独证明文件损坏，更不能据此删除文件或待办；先只读核对文件用途与内容。并发写入时只以当次读到的内容为准。

`ci_fix` 是本地修复记录摘要：只有非空 `pr_url` 字符串匹配 `/pull/<编号>`，并且同目录 `cifix-<编号>.json` 有尝试记录，才显示 `attempts`（次数）和 `last_result`（最后结果）；否则 JSON 中为 `ci_fix:null`，普通行不附摘要。此匹配不校验 URL 域名、PR 是否存在或外部 CI 结果；即使 URL 是非 GitHub 域名，编号匹配也会显示本地次数，不能据此认定关联了有效 PR 或 CI 已修复。

特别注意：`summarizeReceipt` 对没有 `outputs.pr_url` 的 `completed` 回执仍保留 `status=completed`，但在 JSON 中给出 `reason_code=pr_url_missing`、`pr_url=null`。普通 `completed` 行默认只打印 PR URL，不打印该原因；看到 `completed` 时必须再看 `--json` 并核实 `pr_url`。运行回执与最终合并是两项事实：只读核对对应 PR 的当前 head 及 GitHub 实际合并结果，再核对 Brain 的 `runner.phase=merged`、`merge.merged=true` 和 QA 终态是否与该 head 对应。任一项缺失或不一致，都不能宣布最终成功；继续只读复查，不手工更改批准状态或历史 FAIL 记录。

## 故障时保留现场

`runner.sh` 经 `runtime-launch.mjs` 先健康检查，再安全更新专用 clone，最后调用 `runtime-run.sh`。账号失效或缺目录等返回 `runtime_codex_*` 错码时，先停止并排查指定订阅账号；不改用 API key、其他账号或 Claude，也不直接重启。

自更新要求 clone 在 `main`、没有 Git 操作中的状态、没有脏文件。唯一可容忍的未跟踪运行文件是 `.cecelia/hb.sh` 和 `.cecelia/lights/<安全文件名>.live`（文件名规则为字母数字开头，后续仅字母数字、点、下划线、连字符）；若与 incoming 文件冲突也拒绝。fetch 后确认本地 HEAD 是 `origin/main` 的祖先且现场未变化，才执行 `git merge --ff-only`。源码脏、非 main、Git 操作中、本地 ahead 或分叉、心跳冲突时停止更新并保留现场，不执行 `git reset --hard` 或 `git clean`。

启动器外锁、运行器锁、安装器锁分别阻止并发启动、领单和安装。已有任务或重复启动时本轮跳过；遇旧锁或未知锁，不按年龄删除。只读核对锁目录的 PID 与启动时间、对应进程、`launchctl` 状态及任务现场，由操作者确认所有权和恢复时机；异常现场不强行清理或直接重启。

## 独立预览 QA 边界

控制器把当前 PR 编号和 40 位 head SHA 绑定到预览能力，先查预览 `/api/brain/health` 的 `git_sha`。不一致、预览换版或能力关闭即停止；部署恢复后只在同一 head 重新验。预览未就绪或漂移对应 `preview_unavailable` / `preview_stale`，不能报 PASS。受控 Codex QA 会话从控制器提示词取得本轮完整 `PREVIEW_URL`；控制器不会自动注入 `PREVIEW_URL` 环境变量，须先在执行请求的同一 shell 中赋值。`CURL_HOME` 由控制器自动注入，保留其原值；普通 HTTP 方法、路径、header、body 经其中 `.curlrc` 指向的 Unix socket 桥转发：

```bash
# 仅在控制器已授予本轮预览能力的 QA 会话内执行；先用提示词原值替换占位符
PREVIEW_URL='<本轮提示词中的完整 PREVIEW_URL>'
curl -fsS "$PREVIEW_URL/api/brain/health"
```

将响应 `git_sha` 与本 PR 的 40 位 head SHA 比对；不能直连预览 TCP 端口，也不能把生产地址代入 `PREVIEW_URL`。只允许同源 HTTP API 和隔离 Chromium 页面经桥访问。桥拒绝任意上游、跨源重定向、`CONNECT`/upgrade，限制 body 大小与超时；浏览器阻断跨源请求及 WebSocket，context 使用 `serviceWorkers: 'block'`。每个 QA 场景新建隔离 context/进程，关闭后的能力不能复用。依赖 WS、Service Worker 或跨源资源的步骤应写 `CANNOT_VERIFY` 并列出实际已验步骤与阻断原因，不能伪称 PASS。错误 PR/head、非法 origin、超大 body 或超时同样不能给成功结论。

可信运行依赖前置：以版本化的 `packages/brain/scripts/coding-workflow/runner/runtime-deps/package.json` 和 `package-lock.json` 为安装清单，在服务空闲且持有启动器外锁与 run-once 互斥锁的维护窗口，将两份清单复制到受控依赖安装目录并执行 `npm ci --prefix <受控依赖安装目录> --ignore-scripts`；验证后再由维护过程替换正式目录并保留旧目录备份，不能在运行中的依赖目录直接安装。专用依赖目录 `~/.cecelia/coding-workflow-runtime/playwright-1.62.1/node_modules` 保持稳定：Playwright 与 playwright-core 均为 1.62.1，另含 Acorn 8.16.0；各包 integrity 与上述版本化 lock 一致，正式 clone 的 `node_modules` 须链到该专用依赖目录。以下只读检查会在缺依赖、版本或链接不符时失败；运行用户按实际 home 和 clone 路径替换。headless 实启动检查会启动并关闭 Chromium，只供获准的现场维护使用，本次手册 QA 不执行。

```bash
RUNTIME_MODULES="$HOME/.cecelia/coding-workflow-runtime/playwright-1.62.1/node_modules"
CLONE_MODULES="$HOME/perfect21/cecelia-cw-runner/node_modules"
test -L "$CLONE_MODULES" && test "$(readlink "$CLONE_MODULES")" = "$RUNTIME_MODULES"
RUNTIME_MODULES="$RUNTIME_MODULES" node -e 'const fs=require("fs"),path=require("path"),m=process.env.RUNTIME_MODULES,repo=require("./packages/brain/scripts/coding-workflow/runner/runtime-deps/package-lock.json"),runtime=JSON.parse(fs.readFileSync(path.join(m,"..","package-lock.json")));for(const [n,v] of Object.entries({playwright:"1.62.1","playwright-core":"1.62.1",acorn:"8.16.0"})){const p=JSON.parse(fs.readFileSync(path.join(m,n,"package.json"))),a=repo.packages["node_modules/"+n],b=runtime.packages["node_modules/"+n];if(p.version!==v||a.version!==p.version||b?.version!==p.version||!a.integrity||b.integrity!==a.integrity)throw Error(n+" version/integrity mismatch");console.log(n,p.version,a.integrity)}'
RUNTIME_MODULES="$RUNTIME_MODULES" node -e 'const {createRequire}=require("module");const r=createRequire(process.env.RUNTIME_MODULES+"/playwright/package.json");(async()=>{const b=await r("playwright").chromium.launch({headless:true,args:["--single-process","--no-zygote"]});await b.close();console.log("Chromium headless OK")})().catch(e=>{console.error(e.message);process.exitCode=1})'
```

运行健康检查缺少 Acorn 时返回 `runtime_acorn_unavailable`，版本不是 8.16.0 或解析接口不符时返回 `runtime_acorn_version_mismatch`；停止运行并修复可信依赖，不能用旧版健康结果替代。若浏览器依赖或二进制缺失，helper 报 `preview_browser_unavailable` 或启动失败，停止浏览器验收，不从脏主仓的 `node_modules` 猜测成功。ZenithJoy 在 `repos.json` 为 `automerge=false`；PR #2132 待人工处理，合并和业务生产仍须人工放行。本手册金丝雀只核对文档与实现，不代表重新完成浏览器或生产业务验收。
