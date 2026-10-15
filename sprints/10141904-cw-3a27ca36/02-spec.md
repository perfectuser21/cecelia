---
task_id: 3a27ca36-7be9-4efc-a27f-18361dae6557
step: spec
upstream: ["01-intent.md#I-1", "01-intent.md#I-2", "01-intent.md#I-3"]
---

# Codex 常驻运行交接手册规格

### S-1

- 对应：I-1。
- 改动文件：仅新增 `packages/brain/scripts/coding-workflow/runner/README.md`；不修改安装器、配置、凭据或任务数据。
- 手册写出明确的安装前置与示例命令：`CODING_WF_PROVIDER=codex`、`CODING_WF_CODEX_HOME=/Users/administrator/.codex-team1`（或按实际运行用户绝对路径替换）、`CODING_WF_CODEX_MODEL=gpt-6-sol`、`CODING_WF_JUDGE_PROVIDER=codex`、`CODING_WF_JUDGE_MODEL=gpt-6-astra`、`CODING_WF_REPOS=cecelia`，并使用 `sudo env PATH="$PATH" ... bash packages/brain/scripts/coding-workflow/runner/install.sh` 的安装形状。说明先核对运行用户、`CODING_WF_USER_HOME`（未设置时为 `/Users/<运行用户>`）、路径与订阅登录；真正安装前可用相同环境变量执行 `bash .../install.sh --dry-run`，但 dry-run 仅打印 plist 和命令，不证明安装成功。说明安装器是 system LaunchDaemon，每 300 秒运行一次；原服务已 disabled 时返回 `runtime_install_disabled`，须由操作者明确恢复启用后重新安装，不能临时越过禁用门。本任务 QA 不执行安装与启用。
- 真实调用方 shape：运维人员从 shell 调用 `bash install.sh --dry-run` 或 `sudo env PATH="$PATH" <上述 CODING_WF_* 环境变量> bash install.sh`；无 HTTP header/body/鉴权。出处：`packages/brain/scripts/coding-workflow/runner/install.sh` 的用法、默认值和 plist 渲染，以及 `runtime-install.mjs` 的 disabled 检查。手册不得把显式支持 Claude 的兼容分支说成故障自动回退；`repos.json` 中 ZenithJoy 虽 `enabled=true`，仍需显式把它列入 `CODING_WF_REPOS` 才启用。
- 失败语义与输入对抗面：路径错误、模型缺失或相同、非 Codex 裁判、账号不可用、未知 provider、无 root、原服务 disabled 均应描述为停止并排查，不能重试时自动换账号、模型或 Claude；重复安装、并发安装受安装锁与旧服务状态门约束，不能承诺无条件成功。示例变量必须由操作者核对，不能把示例 home 当所有机器的固定值。
- 验证：构建阶段先运行真实文件存在/内容断言取得红态（当前 README 不存在），写完后再以 `node -e` 读取 README，逐项断言五个变量及 `CODING_WF_REPOS=cecelia`；对照读取 `install.sh`、`runtime-install.mjs`、`repos.json` 中相应默认值和禁用门。纯文档不新增镜像单元测试或 smoke。

### S-2

- 对应：I-2。
- 改动文件：仅 `packages/brain/scripts/coding-workflow/runner/README.md`。
- 手册给出无领单健康检查：以运行用户与明确的 `CODING_WF_PROVIDER`、`CODING_WF_CODEX_HOME`、开发/裁判模型、裁判 provider 运行 `node packages/brain/scripts/coding-workflow/runner/runtime-health.mjs`；健康返回须为 `ok:true`、`authentication:"chatgpt"`，账号检查实为 `codex login status` 精确输出 `Logged in using ChatGPT`，API key 环境变量会被剔除。给出 `launchctl print system/com.cecelia.coding-workflow-runner`、`launchctl print-disabled system`、`node .../runner/status.mjs --json` 及主日志只读查询命令。日志路径须按安装时的 `CODING_WF_USER_HOME`（默认 `/Users/<运行用户>`）推导为 `<USER_HOME>/Library/Logs/coding-workflow-runner.log`，并给出从已安装 `/Library/LaunchDaemons/com.cecelia.coding-workflow-runner.plist` 的 `StandardOutPath` 核对实际路径的只读命令；`StandardErrorPath` 指向同一文件，不得把默认 home 当唯一位置。状态与日志须分别判读，不能仅用日志或 dry-run 推断服务正常。
- 写清故障停机原则：账号失效先停止排查指定订阅账号；源码脏、非 main、Git 操作中、本地 ahead/分叉、与心跳文件冲突时拒绝自更新，不执行 reset/clean；自更新只容许未跟踪 `.cecelia/hb.sh` 与 `.cecelia/lights/<安全文件名>.live`，fetch 后确认可从本地 HEAD 快进到 `origin/main`，再 `merge --ff-only`。旧锁/未知锁不自动删除，应核对 PID、进程、launchctl 与任务现场，由操作者确认所有权后恢复。指出启动器、运行器和安装器锁各自阻止并发；异常时保留现场，不回退 Claude、不直接重启或强行清理。
- 真实调用方 shape：launchd system 域按 plist 以 `UserName=administrator`、`/bin/bash <专用 clone>/.../runner.sh` 调用；runner 经 `runtime-launch.mjs` 先健康检查、更新专用 clone、再调 `runtime-run.sh`。出处：`com.cecelia.coding-workflow-runner.plist.tmpl`、`runner.sh`、`runtime-launch.mjs`、`runtime-update.mjs`、`runtime-lock.mjs`、`runtime-health.mjs`。手册中的命令是运维 shell 接口，无 HTTP 请求。
- 失败语义与输入对抗面：账号缺失/失效返回对应 `runtime_codex_*` 错码并停止；不安全更新返回拒绝，不删现场；重复/并发启动因锁跳过，未知/陈旧锁须人工核实，不能按年龄删除。日志可能含现场信息，文档不得要求输出令牌或 auth.json。
- 验证：用 `node -e` 读取 README 检查健康、system 域、按 `CODING_WF_USER_HOME` 或 plist 的 `StandardOutPath` 定位日志、只快进、心跳白名单和四类恢复条件的明确措辞；逐项对照 `install.sh`、plist 模板及上述实现文件，不实际重启服务、改 clone 或调用生产 Brain。

### S-3

- 对应：I-3。
- 改动文件：仅 `packages/brain/scripts/coding-workflow/runner/README.md`。
- 手册说明 QA 独立预览由控制器绑定当前 PR 编号与 40 位 head SHA，先查预览 `/api/brain/health` 的 `git_sha`，不一致或预览换版即停；受控 Codex QA 会话须使用控制器给的 `PREVIEW_URL` 和继承的 `CURL_HOME`，以普通 `curl "$PREVIEW_URL/api/brain/health"` 经 Unix 桥读取，不能直连预览 TCP 端口。只允许同源 HTTP API 和隔离 Chromium 页面访问预览桥。HTTP 桥拒绝任意上游、跨源重定向、CONNECT/upgrade，浏览器阻断跨源请求与 WebSocket，Service Worker 为 `block`；依赖 WS/SW/跨源资源的场景不能伪称 PASS，标 `CANNOT_VERIFY` 并列实际已验到的步骤。QA 示例地址只用本轮 `PREVIEW_URL/api/brain/...`，不得引用生产 Brain 地址；本任务只核对手册与实现，不启动预览会话。
- 写明可信浏览器依赖前置：当前 Playwright 与 playwright-core 1.62.1、integrity 与仓库 lock 一致，依赖位于 `~/.cecelia/coding-workflow-runtime/playwright-1.62.1/node_modules`，正式 clone 的 `node_modules` 链到该专用依赖目录；给出只读版本/路径/链接核查和 Playwright `chromium.launch({headless:true,args:['--single-process','--no-zygote']})`、关闭 browser 的真实 headless 启动检查命令。缺依赖或浏览器二进制时报告 `preview_browser_unavailable` 或启动失败，停止浏览器验收，不从脏主仓 `node_modules` 猜测成功。本次 QA 只核对命令是否与代码可用，不安装或实际启动浏览器。
- 写明 ZenithJoy 的 `automerge=false`、PR #2132 待人工处理、合并及业务生产仍须人工放行；不把此文档金丝雀说成重新完成浏览器或生产业务验收。对应 `repos.json` 和 `runner/lib/merge-gate.mjs`，不改合并开关。
- 真实调用方 shape：受控预览由 `lib/preview-bridge.mjs` 创建能力，参数含本 PR 的 `origin/headSha/prNumber`，Codex QA 仅经 `CURL_HOME` 指向的 Unix socket 以原 HTTP 方法、路径、header、body 调同源预览；页面由 `CODING_WF_PREVIEW_BROWSER_HELPER` 建 context。出处：`lib/codex-session.mjs`、`lib/preview-bridge.mjs`、`lib/preview-browser.mjs`、`lib/preview.mjs`。本次无新接口调用，QA 不编造 HTTP 请求替代现有调用形状。
- 失败语义与输入对抗面：错误 PR/head、预览 SHA 漂移、非法 origin、跨源跳转/资源、超大 body、超时、WS/SW 依赖均不能给成功结论；先排查预览部署，恢复后在同一 head 重验。重复或并发页面验收须使用隔离 context/进程，不能复用被关闭的能力或绕桥直连生产。
- 验证：用 `node -e` 读取 README 断言 PR/head、`PREVIEW_URL` 经 `CURL_HOME` 的 Unix 桥读取 health、同源 HTTP、隔离浏览器、WS/SW/跨源的 `CANNOT_VERIFY`、Playwright 前置与人工放行；逐项对照 `activities/evaluate.mjs`、四个预览实现文件、`repos.json` 和合并门。检查 README 是唯一产品文件变更，正常流水线记录由 runner 自身生成，不手改。

## QA 场景

### Q-1

- 对应: I-1
- 前提: QA 在本 PR 的全新检出目录中执行，先用该目录内的 `01-intent.md` 与 `repos.json` 建立任务和仓库配置基线；无需现有任务数据或账号。
- 操作: 运行 `node -e 'const fs=require("fs");const p="packages/brain/scripts/coding-workflow/runner/README.md";const s=fs.readFileSync(p,"utf8");for(const x of ["CODING_WF_PROVIDER=codex","CODING_WF_CODEX_MODEL=gpt-6-sol","CODING_WF_JUDGE_PROVIDER=codex","CODING_WF_JUDGE_MODEL=gpt-6-astra","CODING_WF_REPOS=cecelia","--dry-run","runtime_install_disabled"])if(!s.includes(x))throw Error(x);console.log("安装手册核对通过")'`；人工读取手册里的 CODEX_HOME、sudo 安装命令，并与本 PR 检出的 `install.sh`、`runtime-install.mjs`、`repos.json` 对照。
- 期望: 命令输出“安装手册核对通过”；示例仅启用 cecelia，明确订阅账号 home 与开发/裁判不同模型；dry-run 和实际安装有区别，禁用服务需人工明确恢复。

### Q-2

- 对应: I-1,I-2
- 前提: QA 在本 PR 的全新检出目录读取手册及对应脚本，不需要已有 launchd 状态；将“原服务 disabled、账号失效、重复安装”作为手册操作题的输入状态，不改真实服务。
- 操作: 按 README 查找 disabled、登录失效和并发安装段，逐条对照 `runtime-install.mjs`、`runtime-health.mjs`、`runtime-install-guard.mjs`；分别模拟人工选择下一步，仅做文档判读，不执行 sudo/launchctl 写命令。
- 期望: disabled 时显示 `runtime_install_disabled` 的停止条件且不能临时绕门；账号不可用时停止而非使用 API key 或 Claude；并发/旧锁先核实持有者与现场，不能无条件重试或删除。

### Q-3

- 对应: I-2
- 前提: QA 在本 PR 全新检出目录，以本地脚本源码作为命令基线；不用生产服务、已有日志或任务。另设安装参数 `CODING_WF_USER_HOME=/Volumes/runner-home` 作为文档对照案例，不实际安装。
- 操作: 照手册抄取健康检查、`launchctl print system/com.cecelia.coding-workflow-runner`、`launchctl print-disabled system`、`node packages/brain/scripts/coding-workflow/runner/status.mjs --json` 和主日志只读查询命令；用 `node -e` 读取 README 断言这些命令及自定义 home/已安装 plist 定位日志的方法存在，人工按案例推导日志路径，并核对 `install.sh`、`runtime-health.mjs`、plist 模板和 `status.mjs`。仅实际运行本 PR 检出的 `status.mjs --log-dir <QA 新建空目录> --json`，先建空目录再查。
- 期望: 空目录返回 `[]`；自定义 home 案例的主日志定位到 `/Volumes/runner-home/Library/Logs/coding-workflow-runner.log`，与已安装 plist 的 `StandardOutPath` 核对方法一致；手册准确说明健康检查成功条件和 system 域，不把空回执或 dry-run 当运行成功。

### Q-4

- 对应: I-2
- 前提: QA 从本 PR 检出目录新建一个仅供阅读的故障案例清单，列“工作区脏、本地 ahead/分叉、心跳白名单文件、未知旧锁”；不改专用 clone。
- 操作: 逐案查 README 的恢复步骤，读取本 PR 的 `runtime-update.mjs`、`runtime-lock.mjs` 与 `runtime-launch.mjs` 对照；查找有无建议 `git reset --hard`、`git clean` 或无确认删除锁的句子。
- 期望: 只有 `.cecelia/hb.sh` 和符合命名规则的 `.cecelia/lights/*.live` 未跟踪文件可容忍，且仍须安全快进；其余情形停跑保留现场。旧锁须核对进程与任务，手册无硬清建议。

### Q-5

- 对应: I-3
- 前提: QA 使用本 PR 全新检出目录；在控制器已核对 PR/head 并授予 Unix 预览能力的受控 Codex QA 会话内，取得本 PR 的 head SHA 和本轮提示词里的 `PREVIEW_URL`，继承控制器设置的 `CURL_HOME`，不用环境里已有业务数据。
- 操作: 将本轮提示词里的完整地址赋给 shell 变量 `PREVIEW_URL`，保留原有 `CURL_HOME`，运行 `curl -fsS "$PREVIEW_URL/api/brain/health"`，把返回的 `git_sha` 与本 PR head 比对；随后人工核对 README 对同源 HTTP、Unix 桥、隔离浏览器、跨源重定向及 WS/SW 边界的描述与 `activities/evaluate.mjs`、`lib/preview-bridge.mjs`、`lib/preview-browser.mjs`、`lib/codex-session.mjs`。不直连预览端口，不启动新的账号或浏览器会话。
- 期望: 若 SHA 一致，确认文档只把该 head 的同源 HTTP 列为可验；若 SHA 不一致或桥返回 `preview_sha_mismatch`，停止，不能用旧预览判 PASS。若预览未就绪或能力未授予，控制器返回可重试的 `preview_unavailable`/`preview_stale`，真人 QA 不得声称已验到 health；若需出具场景报告，记 `CANNOT_VERIFY` 和具体阻断原因。依赖 WS/SW/跨源时结论为 `CANNOT_VERIFY`。

### Q-6

- 对应: I-3
- 前提: QA 从本 PR 全新检出目录读取 `repos.json`、`lib/preview-browser.mjs` 和手册；把“依赖不存在、Chromium 启动失败、ZenithJoy PR 待合并”作为新建的判读案例，不依赖已有浏览器会话。
- 操作: 逐行核对 README 所列专用 Playwright 1.62.1 路径、lock/integrity、clone 链接和 headless 启动检查命令；核对失败时停止验收的文字；读取 `repos.json` 中 ZenithJoy `automerge` 与 `runner/lib/merge-gate.mjs`，查 PR #2132 和生产放行措辞。不执行依赖安装、Chromium 启动或合并。
- 期望: 命令可供现场操作者原样核查并会暴露缺失，不声称本次已经实启动；ZenithJoy 保持人工合并及生产放行，PR #2132 保持待人工。

## 铁律对照

- INV-b3a8bf82：S-1、S-2、S-3 覆盖（手册只引用既有仓库实现、任务和运行事实，不另建平行账本）。
- INV-e5ab4826：S-1、S-2、S-3 覆盖（运维交接归在现有 coding workflow 仓库与运行链，不另造框架）。
- INV-91e9abe3：S-1、S-2、Q-2 覆盖（写明当前 Codex 订阅运行形状，故障不自动切 Claude）。
- INV-3859041e：S-2、Q-2 覆盖（不通过已关停的 Claude 桥接恢复常驻运行）。
- INV-067867c8：S-2、Q-2 覆盖（不将桥接 :3457 或 Claude 无头当兜底）。
- INV-751f73be：S-2、Q-2 覆盖（账号故障不启动无人值守 Claude）。
- INV-696c9f96：S-1、S-3 覆盖（手册只描述此 coding runner，不混称业务 OpenClaw Commander）。
- INV-02d8e749：S-3、Q-5 覆盖（保留独立预览、真实 QA 与独立裁判边界，不以文档 QA 冒充业务验收）。
- INV-0dc6b84f：S-1、Q-1 覆盖（本任务按最新 Codex 迁移验收写运行参数，不倒写旧 Claude 版本为当前安装值）。
- INV-ac7c8801：不适用：该条已由 INV-0dc6b84f 修订，且本任务不变更开发会话模型。
- INV-02e74e46：S-1、Q-3 覆盖（手册使用 system LaunchDaemon，不建议 LaunchAgent）。
- INV-b145c74a：不适用：未新增常驻服务或修改 patrol manifest，仅补现有服务手册。
- INV-365d645a：不适用：本 runner 是五分钟周期任务，不监听服务端口；S-2、Q-3 仍核对 system 状态与运行回执。
- INV-51b9b095：不适用：该条约束额度分配器的 triage/judge 档位映射，本任务只如实记录现有 runner 裁判模型，不改额度分配器。
- INV-45cd3ec2：不适用：本任务不新增或修改 smoke，现行未授权 guard 仍按撤销后的约定执行。
- INV-ff177feb：不适用：已被 INV-45cd3ec2 撤销，本任务不改变 smoke 退出码。
- INV-09fb5c69：S-3、Q-5 覆盖（文档验收不以 CI 绿替代真实预览 QA；人工合并仍须遵守原门）。
- INV-5e125909：S-1、S-3、Q-1 覆盖（运行用户 home 与预览地址按实际环境核对，示例不作为通用固定值）。
- INV-3c30394c：S-3、Q-5、Q-6 覆盖（仅宣称已做的手册/预览只读核对，未实启浏览器与生产接缝列在下节）。
- INV-564802ee：S-1、S-2、Q-2 覆盖（凭据只说明指定账户位置与状态，不读取或输出 auth.json）。
- INV-50954d28：不适用：本任务不新增或修改 API 端点；预览 health 仅在现有受控 QA 通道读取。
- INV-dc18d43d：S-1、S-2、S-3 覆盖（文档描述既有代码闸及运行判据，不以手册文字替代实际代码闸）。

## 未覆盖真实链路

- 安装与 system LaunchDaemon 变更：本次 QA 只读文档、安装器和 plist 源码，不执行 sudo、bootstrap/bootout/kickstart 或恢复 disabled 服务；缺真实安装操作授权及受控维护窗口。
- Codex 订阅账号：本次 QA 核对健康检查命令和失败语义，不读取真实账号凭据、不执行 `codex login status` 或模型调用；缺本任务允许的真实账号会话。
- 专用 clone 更新、旧锁和运行中任务：本次 QA 核对源码与恢复原则，不对正式 clone 做 fetch/merge、删锁或领单；缺可安全变更的现场。
- Playwright 依赖和 Chromium：本次 QA 核对可信依赖路径、版本/integrity 与实启动检查命令，不安装依赖或实际启动 headless 浏览器；缺本任务允许的浏览器运行会话。
- 预览桥 WS/SW/跨源业务页面：本次 QA 核对代码阻断机制与 `CANNOT_VERIFY` 结论，并读取本 PR 预览 health SHA；不执行依赖这些能力的实际业务流程。
- ZenithJoy PR #2132、人工合并与生产业务放行：本次 QA 核对仓库开关及手册边界，不合并 PR、不部署或验收生产业务。
