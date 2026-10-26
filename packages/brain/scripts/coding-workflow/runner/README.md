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

在仓库根目录只读查看回执：

```bash
node packages/brain/scripts/coding-workflow/runner/status.mjs [--log-dir <dir>] [--json]
```

实际执行时去掉方括号；不指定 `--log-dir` 时读取 `loadConfig().logDir`，定向排障时传入实际回执目录。`--json` 输出数组，省略时逐行显示；两种模式都按文件 mtime 倒序。目录不存在或没有可列回执时，JSON 输出 `[]`，文本提示“没有运行记录”，退出码为 0；这只说明本次没有读到记录，不证明服务健康。先核实目录和原生文件，再重新只读查看，不把重复读取当成执行成功或稳定快照。

每行状态按当前文件内容解析：

| 状态 | 判读 |
|---|---|
| `running` | JSON 有 `last_event` 的进度快照；不是终态。 |
| `completed` | 回执声明执行完成；还须核查 PR 与最终状态。 |
| `partial` / `failed` | JSON 的 `failed_activity` 指向首个非 `completed` / `skipped` 活动；`reason_code` 优先取该活动最后一次尝试的原因，再回退到活动、回执级原因或运行状态。文本行只是摘要，排障时保留并查看原始回执。 |
| `unreadable` | 本次文件不符合回执解析路径，也可能是 JSON 解析失败；不能单凭此状态认定文件损坏。 |

扫描范围是目录内扩展名为 `.json`、文件名不匹配 `cifix-数字.json` 的普通文件，并不预先筛出任务回执。因此合法的 `qa`、`commander` 状态 JSON，以及终态回写待办 `pr-sync-pending.json`，也可能显示 `unreadable`。不要因此删除这些文件、待办或其它现场记录；先核对文件用途和内容。并发写入时这里只代表本次读到的内容及 mtime 顺序。

有可识别的 `outputs.pr_url` 且存在对应 `cifix-<PR号>.json` 修复尝试时，JSON 的 `ci_fix.attempts` 是尝试次数，`ci_fix.last_result` 是最后一次尝试的结果；文本附 `ci_fix=<次数>次 last=<结果>`。没有修复尝试时 `ci_fix=null`；`cifix-数字.json` 本身不会列为任务行。修复摘要不等于完整修复现场或最终合并结果。

特别注意：`summarizeReceipt` 对已标记 `completed`、却没有 `outputs.pr_url` 的回执仍返回 `status=completed`，但 JSON 中有 `reason_code=pr_url_missing`、`pr_url=null`；`formatStatus` 的 completed 文本行默认不打印这个 reason。看到 completed 行时必须查看 JSON 并核实 `pr_url`，不能据此推断已有有效 PR。即使有 URL，也须只读核对 GitHub 上对应 PR 与最终 head 的实际合并事实，并核对 Brain 的 `runner.phase=merged`、`merge.merged=true` 及 QA 终态；字段不齐或来源不一致时不能报告最终成功。这里仅是诊断步骤，不手工改批准、FAIL 记录或 Brain 状态。

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

## 回执常见误读与核账示例

以下均为**示例数据、不是现场运行结果**。只读查看时，在仓库根目录用 `node packages/brain/scripts/coding-workflow/runner/status.mjs [--log-dir <dir>] [--json]`（执行时去掉方括号）。`--log-dir` 指定实际回执目录，省略时取 `loadConfig().logDir`；`--json` 输出 JSON 数组，省略时输出文本。结果按文件 mtime 倒序，本次读取并非并发更新期间的稳定快照。

### 误读一：空列表等于健康

目录不存在或没有可列回执时，示例 JSON 是 `[]`，文本是“没有运行记录（<实际目录>）”，退出码为 0。这只说明本次没有读到记录；先核实目录、服务状态与主日志，不能把空列表当作健康证明。下面的状态样例也只演示如何读字段。

### 误读二：所有 JSON 都是终态回执

含 `last_event` 的进度快照显示 `running`，不是终态；终态回执可显示 `completed`、`partial` 或 `failed`。例如下列独立样例可在内存中解析：

```json
{"last_event":"build","status":"completed"}
```

```json
{"status":"partial","activities":[{"key":"intent","status":"completed"},{"key":"review","status":"skipped"},{"key":"build","status":"failed","reason_code":"activity_reason","attempts":[{"reason_code":"old_reason"},{"reason_code":"last_attempt_reason"}]}],"reason_code":"receipt_reason"}
```

第一例因有 `last_event` 显示 `running`。第二例显示 `partial`、`failed_activity=build`、`reason_code=last_attempt_reason`；若其 `status` 改为 `failed`，显示 `failed`，失败活动和原因规则相同。失败活动取首个非 `completed`/`skipped` 活动；原因依次取该活动最后一次 attempt、活动级、回执级，最后才用 `run_<status>`。不要从文本摘要跳过原回执。

`completed` 即使缺 `outputs.pr_url` 仍是 `completed`。示例回执 `{"status":"completed","outputs":{}}` 对应的状态 JSON 摘要为：

```json
{"status":"completed","failed_activity":null,"reason_code":"pr_url_missing","pr_url":null,"ci_fix":null}
```

同一状态的文本 completed 行形如 `任务ID  completed  <mtime>`，不会打印 `pr_url_missing`；须看 JSON 并核 PR。有效 PR URL 对应的 `cifix-数字.json` 有修复尝试时，`ci_fix.attempts` 是次数，`ci_fix.last_result` 是最后一次结果，例如 `{"ci_fix":{"attempts":2,"last_result":"failed"}}`；无尝试则 `ci_fix:null`。修复次数与结果均不证明 PR 已合并。

扫描会读取目录内非 `cifix-数字.json` 的普通 `.json` 文件。非法 JSON，或合法但不是回执的 `qa`、`commander`、`pr-sync-pending` 等 JSON，可能显示 `unreadable`；它不是文件损坏证明，更不是删除待办、状态文件或清理现场的依据。先只读核文件用途与原文，再按需重读。

### 误读三：回执 completed 或前置 completed 等于全链成功

`terminal.mjs` 发布后先把 Brain task `status` 写为 `completed`，同时把 `result.runner.phase` 写为 `awaiting_qa`；QA 门关闭时写 `awaiting_manual_merge`。这一步没有证明 PR 已合并。只读核对应 GitHub PR、最终 head 的真实合并事实，及 Brain `result.runner.phase=merged`、`result.merge.merged=true` 和该 merge 的 head、`qa_state` 终态；字段缺失或身份不一致就记为未证实。Learning 确认需单独回读；预览回收和 pending 清理需等下一次实际 tick 单独核验。一个 completed、一个 PR URL 或一个哈希都不能越级证明这些事实；不要手工改批准、FAIL 记录或状态来补齐结果。

前置任务的 `completed` 只是 `deps.mjs` 检查的必要输入。源码对无 PR URL 或 `task.result.merged===true` 有直接就绪分支；有 PR URL 且无此捷径时才查询 GitHub：`MERGED` 就绪，`OPEN` 或未知状态等待，`CLOSED` 拒绝。这是领单判断分支，不是前置已真正合并的独立证据；核账仍须读实际 PR 与 head。

交叉提示：`node packages/brain/scripts/coding-workflow/new-task.mjs <plan.json> --dry-run` 只校验本地计划，不创建任务；预检 `base_sha` 只核 40 位小写 hex 格式，不核提交是否存在。预检退出 0 也不是建单或运行成功。

## 历史执行证据与本轮 QA 的责任边界

### 来源投影与历史执行

`sourceFacts` 只返回当前已验证的公共来源投影与可信 main 同步信息，不含 `historical_execution`。`judgeSourceFacts` 仅在真实 judge 上下文调用 `verifiedHistoricalExecutions`，才在已提交记录、本轮 QA 来源和同步投影之外增加 `historical_execution`。该读取绑定同一个 task、sprint、真实 worktree 和固定的当前 HEAD；HEAD 在读取期间变化就拒绝。03-build.md、04-evidence.md 必须先经 `registrationFor` 和 `validateStage`，核对原 Git 字节、mode、提交、manifest 增量、受保护阶段事件及其原生 ID，才能交出历史原生记录。相同 SHA、登记哈希、当前 HEAD 或模型自述都不能推出过去曾执行；缺失、伪造或重复登记不能靠重试变成既成历史。来源读取失败是拒绝证明，不是空账或产品 PASS。

### 原生账的含义

每个 build/verify stage 的 `native_ids` 按原顺序逐项投影到 `natives`，保留以 `turn.failed` 结束的失败会话、非零退出、重复命令和零字节 `aggregated_output`，不会只挑最后一次成功。每项保留原生 `code`、`timed_out`、`terminated`、`success`、`terminal_event`、`stdout_sha256`、`stdout_bytes`、`error_event_seen`；已完成命令保留原字符串 `command`、聚合 `output` 和整数 `exit_code`。哈希和字节数针对该 native 捕获的 JSONL stdout。`execution_complete` 只在终止事件为 `turn.completed`、没有 error 事件、进程退出 0、未超时或终止，且 stdin 状态满足条件时为真，并须与 `native.success` 一致；它不判产品 PASS。即使某条命令 exit0，也不能越级认定产品通过。缺 native、未知 JSONL 事件、未结束会话、缺失命令结果、身份错配或当前 native 失败均失败关闭，不能把缺账吞成空账。投影不包含 `reasoning`；`aggregated_output` 仅是原生捕获的聚合输出，不宣称任意子进程 stdout/stderr 的完整分流。

### 当前 QA 与后续裁判

本轮 QA 只读 `01-intent.md`、`02-spec.md`、固定源码、当前精确测试 HEAD 的 Git 事实和可信控制器给出的有限来源投影，并以真正可失败的静态断言及内存反例验收当前 README 和源码。QA 期间，03/04 由控制器暂隐藏；可信隔离投影仅允许将绑定本 task、round、测试 HEAD 的这两条删除识别为本轮隔离状态，不代表会话后已经恢复，也不豁免其他工作区差异。QA 不读 03/04 正文或保护根，不重造发布前 index/worktree/untracked，不手工补投或追认旧失败。`historical_execution` 是后续 judge-only 历史材料，不是当前 QA 命令，更不是产品 PASS。旧 build/verify 是否真实执行，仅由当时受保护原生事件、合法登记、后续独立 judge 和外层门核定；draft 的 FAIL/CANNOT_VERIFY 不编译为 PASS。过去的 PASS、登记 SHA、当前干净工作区、空输出、失败或非零会话都不能代替历史现场。来源不齐、隔离未恢复或反例可误判时应标 FAIL/CANNOT_VERIFY，不能补写来源或重跑过去现场。

### 发布前与发布后的核验时点

发布前 verify 当场以固定 initial base `8174a7d6f40ecdaf21c0fd8ad4e82606e5ea913d` 到当时 HEAD 检查完整 DAG 的每条父边、全 diff、index、worktree 与全仓 untracked；实际执行 `git rev-list --parents`、逐父 `git diff-tree --raw`、`git diff --cached --raw`、`git diff --raw` 和 `git ls-files --others --exclude-standard`，由当时原生命令的完整输出与退出码承担证据。此时 README 原 bytes/mode 应为固定基线的精确前缀加文末新增节，manifest 相对该 base 应为零差异。发布后 QA 重新核当前精确测试 HEAD 的完整 DAG、每条父边的 raw 路径/blob/mode，以及当前全仓 index/worktree/untracked；不能拿当前干净状态补证明发布前现场。QA 只把可信本轮隔离投影中准确绑定 task/round/HEAD、HEAD blob/mode 和实际暂缺的 03/04 视作预期暂隐藏，其他差异仍逐项验来源和范围，未匹配或越界就失败关闭。

发布后 manifest 可含可信控制器对本 task 合法 Markdown 的准确前插登记：`owner` 为 `packages/brain/scripts/coding-workflow/runner/run-once.mjs`，`role` 为 `documentation`，旧 raw 历史及顺序原样保留；不能把发布前 manifest 零差异要求重施于登记后的 HEAD。若有 main 同步，必须有独立可信链、准确双父、真实 main ref、全树与 source gate 证明，不能简单扣除 main 或改用浮动 base。03/04 原 bytes/mode 的会话后恢复、正式 source/CI/preview、精确批准 HEAD、真实 MERGED、Brain/Learning 回读和下次 tick 回收，均由后续控制器及终态门在实际发生后按冻结 C01-C12 核验；未发生的不报 PASS。新产品或源码 HEAD 必须重新经过真实 QA、judge、CI 和 preview。合同若允许仅本轮 05/06 纯登记提交，受保护来源链须证明仅有准确本轮记录、产品和旧历史未改，并把 `approved.head` 绑定实际登记 HEAD；不伪称模型测过该新记录 HEAD，也不因此陷入无限重验登记循环。

## QA 修复的文件合同与验证方式

`runner/lib/qa-gate.mjs` 的 `qaFix` 用 `loadPrompt('qa-fix', ...)` 加载 `prompts/qa-fix.md`，再经历史命名的 `runClaude` 交现行 provider 适配器执行。函数名不要求 Claude 账号；Codex 通道由现行 `CODING_WF_PROVIDER` 配置选择。修复者先读 `INTENT_PATH` 与 `SPEC_PATH`，两者共同限定允许修改的文件与操作；通用修复和验证规则不增加授权。本节仅说明既有行为，不授权修改 `qa-gate.mjs`、`lib/claude.mjs`、`prompts/qa-fix.md` 或其他文件；本轮只在固定基线 README 文末追加本节，不运行产品 CLI。

文档及限定文件任务只用原合同许可的可失败只读内容断言和内存破坏对抗：build 在修复前运行同一断言得 RED，修复后运行得 GREEN，并保留原生命令、完整捕获输出、整数退出码及失败、修正、重复、零输出；不能打印 `PASS` 代替断言。内存反例须使缺失新节、关键语义反转及夹带扩大文件或操作授权的文本都失败。不得为通用 TDD 新增合同禁止的仓库测试、程序或配置；本文档任务不新增仓库测试，也不运行产品 CLI。不得先提交越界文件再删除以掩盖逐父历史。断言非零或证据缺失即未通过；合法修复后重新验证。非法、超长、重复或并发输入不能扩大合同；逐父范围或来源不明时失败关闭。

代码 bug 仍须在原 intent/spec 允许的文件与操作范围内先写失败测试，再修复并永久保留回归；文档分档不能免除代码回归。若本次 QA 问题与原 intent/spec、前轮裁决冲突，或在许可范围内做不成，修复者不提交改动，最后独立一行输出 `RULING_CONFLICT: <本次条目> 与 <需求/规格条款或前轮条目> 矛盾：<各自要求>`，由既有控制器识别并升级；不自动放宽合同或裁决，不声称新增机械 allowlist，受保护路径与削弱测试检查保持。本节不实现新的控制器语义；重复或并发修复也逐条受原合同约束。

当前 QA 只在精确测试 HEAD 上做可失败静态断言、只读内容断言和内存对抗；只读 `01-intent.md`、`02-spec.md`、固定源码、该 HEAD 的 Git 事实和可信控制器给出的有限来源投影，不读 03/04 正文或保护根，也不重造发布前 index/worktree/untracked。控制器临时隐藏 03/04，只能凭绑定本 task/round/HEAD 的可信隔离投影识别，不代表已经恢复。当前干净状态、hash、metadata、旧 PASS 或登记 hash 均不能追认旧现场。

固定 initial base `5f514a8523ef3f40fb671ff8f3a90947597d0628` 必须是当前 HEAD 祖先；从该 base 到当前 HEAD，核完整 DAG 每条父边的递归文件级 raw 路径/blob/mode、全 diff，以及当前 index、worktree、全仓 untracked。只允许本任务准确 Markdown 和可信控制器对合法 Markdown 的精确 manifest 增量：`owner=packages/brain/scripts/coding-workflow/runner/run-once.mjs`、`role=documentation`，旧 raw 历史及顺序保留。可信 main 同步还须完整可信链、准确双父、实际 main ref、全 tree/source gate 证明；不能浮动 base 或简单减去 main 差异。发布前 verify 当场核固定 base 至当时 HEAD、index/worktree/untracked、README 原 bytes/mode 前缀及 manifest 相对 base 零差异；过去非 Git 现场只能由当时原生命令完整输出、整数退出码和独立外层门证明，不能用当前现场补证。

仅独立 judge 可用已登记 build/verify 的 `historical_execution`：须绑定真实 stage/head/native、03/04 原 bytes/mode 的真实完整恢复和受保护来源门，保留失败、修正、重复、零输出及 draft FAIL/CANNOT_VERIFY；`aggregated_output` 是聚合捕获，不宣称任意子进程 stdout/stderr 完整分流。缺证记 UNKNOWN。后续恢复、精确批准 HEAD、正式 source/CI/preview、真实 MERGED、Brain/Learning 读回及下次 tick 回收，仍须在实际发生后按冻结 C01-C12 分阶段核验；未发生不得 PASS。代码、产品或可信 main 同步产生新 HEAD，须重新真实 QA、judge、CI、preview。若原合同允许本轮仅 05/06 准确记录的纯登记提交，受保护来源链须证明未改产品和旧历史，并把 `approved.head` 合法绑定实际记录 HEAD；不得声称模型测过新记录 HEAD，也不制造无限重验循环。身份漂移、非法或超长来源字段、重复登记、并发 HEAD 漂移或缺证时，只能按对应阶段失败或记 UNKNOWN，再从可信事实核验。

## QA 修复后的批准、合并和收账边界

### 两次 ready 与合并权

`lib/terminal.mjs` 的 `finishSuccess` 先确认 Brain 正常写回 `completed`；仅在成功且 `cfg.automerge` 允许后，才以 `gh pr ready <PR URL>` 提前解除草稿。QA 开启时 runner 仍是 `awaiting_qa`，QA 关闭时是 `awaiting_manual_merge`、交人工处理；这次 ready 是非批准、非合并，`completed` 也不表示已合并。ready 失败只留下失败结果，不能升级成批准。`lib/merge-gate.mjs` 的后续门必须先在精确 head 上取得 QA+独立 judge 批准，再核该 head 的 required 检查全绿和可信 source；仓库 `automerge=false` 时进入 `awaiting_human`，不调用自动合并。

仓库允许自动合并且 PR 仍为草稿时，合并门才再次执行 `gh pr ready <编号>`。它在 ready 前后都用 `gh pr view <编号> --json headRefOid,isDraft,state` 读回，要求 `OPEN`、精确 `approved.head` 和有效草稿状态；ready 后还须确认不再是草稿。ready 自身没有 head CAS，只有最终 `gh pr merge <编号> --squash --delete-branch --match-head-commit <approved.head>` 由 GitHub 校验精确 head。前后 GET 失败或身份变化、非法或漂移 head、ready 失败及重复或并发动作，都不得写成已批准或已合并；保留待核或按既有门失败，不能跳过 CAS 或凭本文档获得重试权限。

### 四种 SHA 与来源范围

`tested_head` 是 QA 实际测试的分支提交；`approved.head` 是精确批准所绑定的提交，合同允许纯本轮记录提交时可经受保护来源链合法改绑；合并前实际 PR `headRefOid` 必须再次核对；GitHub squash 生成的 `mergeCommit.oid` 是合并提交。前三种身份可能处于不同时间点，squash SHA 既不是 QA 测试的分支 HEAD，也不是执行证据。代码、产品改动或可信 main 同步产生新 HEAD 重新真实 QA、judge、CI、preview，不能沿用旧 HEAD 信用。唯一窄例外是合同允许的本轮 05/06 准确记录提交：受保护来源链须证明仅含本轮记录、产品与旧历史未改，才可将 `approved.head` 绑定实际记录 HEAD；不能声称模型测过记录 HEAD，也不能制造无限“QA 再登记”循环。

范围始终锚定固定 initial base `7724d4f246453d6a90b5c451e63d80fbb586628d`，审完整 initial base→当前 HEAD 的每个提交及所有父边，用 `git diff-tree -r --raw --no-abbrev <parent> <child>` 核文件级路径、blob、mode，另核全差异、index、worktree、全仓 untracked。仅准确本任务 Markdown 和可信控制器的 manifest documentation 增量可归本任务；旧 raw 历史及顺序保留。main 同步必须有完整可信来源链、准确双父、实际 main ref、全 tree/source gate 证明，不能改用浮动 main 简单减差。现行 `changedSinceApproval` 排除 main 提交、仅余记录时尝试 `verifyMergeSource` 后改绑，这是实现行为，不是新 HEAD 的 QA/judge/preview 结果；`source-merge-proof.mjs` 对 QA 后同步以 `qa_before_sync` 拒绝旧 QA 轮次。同步后控制器必须取得新 HEAD 的真实 QA、judge、CI、preview 并按新轮次批准，终态逐项核同一 HEAD。HEAD 漂移、伪造或重复登记、非法或超长来源字段、并发变更、来源缺失均不能靠旧信用通过；当前验收失败关闭，历史缺证记 UNKNOWN。

### 合并后的收账

实际 GitHub `MERGED` 后，`recordMerged` 经 `pr-sync.mjs` 的 `syncTask GET` 取得原结果，再 PATCH Brain 的 `merge.merged=true`、精确合并 head、`runner.phase=merged` 与 `handoff`。目前 PATCH 返回 `ok` 即清 `receipt_pending=false`；PATCH 前的 GET 与 PATCH 响应都不是 PATCH 后独立 GET。后续终态门须另行读回精确合并回执，不能凭这个 false 值推断收账完成。Brain `status=completed` 或单个 `runner.phase=merged` 都不等于完整闭环；合并用的是 PR head，另须区分 GitHub `mergeCommit.oid`。

`merge-learning.mjs` 仅在 Learning 返回的每个 Learning ID 和原文全文 SHA-256 经独立 GET 读回后，才清 `learning_pending`；未知或部分成功不自动重发不幂等的 Learning。`pr-closure.mjs` 的 preview stop 只在响应 `stopped=true` 后记确认。Brain 回写或读回失败、重复收账、并发状态变化时保留 pending 或 UNKNOWN；未确认的 preview stop、Learning 和收账待办由下次实际 tick 复核。历史 FAIL/HUMAN、修复失败、错误恢复和未确认待办须继续留痕，不得抹除或改写成 PASS。

### 本轮阶段和历史证据

本轮 build 在追加文档前对新增小节运行可失败只读断言取得真实 RED，追加后以同一断言取得真实 GREEN；原生账保留失败、修正、重复、零输出、完整捕获输出及整数退出码，打印 PASS 不能替代断言。发布前 verify 当场以固定 initial base 核完整 DAG 的每条父边文件级 raw 路径/blob/mode、全 diff/index/worktree/untracked、README 原 bytes/mode 前缀及 manifest 相对固定 base 零差异。发布后现况不能补证发布前非 Git 现场。

当前 QA 只读 01/02、固定源码、精确测试 HEAD 的 Git 事实及可信有限来源投影，用可失败静态断言和内存破坏对抗验新节，重新审完整逐父 DAG、当前 index/worktree/untracked。仅可信投影精确绑定本轮 task/round/HEAD 的 03/04 暂隐藏可解释，不能读 03/04 正文或保护根，也不能由此断言会话后已恢复。只对本轮可信固定 `env_url` 检查字面主机为 `localhost` 或 `127.0.0.1` 且同源，只读 GET `/api/brain/health` 核精确 preview HEAD 和隔离身份；不跟跨源重定向、不请求其他 API、外网或 POST、不伪造 header、不读凭据、不扫端口、不执行产品 CLI。该身份 GET 不是产品 smoke 或 PASS 证据。

独立 judge 才消费 `judge-only historical_execution`，按已登记 build/verify 的 stage/head/native 绑定原生命令、完整捕获输出、整数退出码，并核 03/04 原 bytes/mode 在会话后的真实完整恢复。`aggregated_output` 只是原生聚合捕获，不声称任意 child stdout/stderr 的完整分流；draft FAIL/CANNOT 不编译成 PASS，缺证记 UNKNOWN，不重跑旧阶段伪造历史。后续控制器和终态门仅在实际发生后按冻结 C01-C12 核恢复、正式 source/CI/preview、精确批准 HEAD、真实 MERGED、Brain/Learning 的 ID 与全文哈希读回、preview stop 及下次 tick 回收。未发生的步骤不报 PASS，不能用旧 A 信用替代本轮 B，也不能用来源证明或 required 检查代替新 HEAD 的 QA/judge/preview。
