---
task_id: 3a27ca36-7be9-4efc-a27f-18361dae6557
step: intent
upstream: []
---
# Codex常驻运行交接手册：安装、诊断与失败恢复

## 背景

Codex常驻迁移的真实领单金丝雀，同时补齐交接现场手册。仅新增或更新 packages/brain/scripts/coding-workflow/runner/README.md，准确对照当前实现写出：Codex订阅的安装参数、明确CODEX_HOME和开发/裁判不同模型、默认只cecelia、运行健康检查与system launchd日志位置、心跳白名单安全自更新、源码脏/本地分叉/旧锁/账号失效的诊断恢复原则、同源HTTP API和隔离浏览器点击截图的受控预览通道，以及WS/SW/跨源依赖的CANNOT_VERIFY边界。保留ZenithJoy automerge=false、PR2132待人工和业务生产人工放行。不改任何程序/开关/凭据/任务数据，不启动Claude或其他API；禁止为此文档修改产品行为。此为实际运维交接产物，验收读最终文档与当前实现保持一致即可，不需要新增镜像实现的单元测试。 当前浏览器运行依赖来自 ~/.cecelia/coding-workflow-runtime/playwright-1.62.1/node_modules（Playwright及core版本和integrity与仓库lock一致），正式clone的node_modules链接到该专用依赖目录，Chromium headless-shell通过当前Playwright实启动核验。手册写清这项安装前置及缺失时的诊断；不依赖脏主仓node_modules。文档检查可先执行不存在/缺字段的验收命令留红证据，再补文档；无需为纯文档新增镜像单元测试。 阶段与边界：本任务的 change_kind=capability_change 指完善既有运维能力的交接文档；不新增或变更执行能力，也不是参数调整或代码 bugfix。README 是交付产品本身，开发、verify、QA 应真实读取最终文件并用会失败的内容断言与当前 install.sh、runtime-health.mjs、runtime-update.mjs、run-once.mjs、lib/codex-session.mjs、lib/preview-browser.mjs 等实现逐项核对；这不是读取 03-build/04-evidence 自述。README 当前不存在：spec 阶段只拟定验收命令，首次实际红态命令放 build 第一步执行，随后写文档并复跑取真实绿态，不要求无 shell 的 spec 步骤编造预跑退出码。安装、sudo、launchctl bootstrap/bootout/kickstart、git 更新/清理、真实账号调用等命令是手册需准确呈现的操作说明，本次文档 QA 不执行这些变更现场的操作，也不访问生产 Brain；不能把 dry-run 输出冒充安装或运行成功。纯文档不增加镜像单元测试/脚本；正常 CI、现有 QA/独立裁判及产线记录照常，不另改门禁，不以此文档金丝雀宣称重新完成浏览器或生产业务验收。 安装边界：服务原已禁用时返回 runtime_install_disabled，未修改服务/配置；需要操作者明确恢复启用后再安装，不能临时启用原已禁用服务来绕过该门。文档可说明恢复步骤，但本次QA不得实际执行。

### I-1
最终 runner/README.md 明确 CODING_WF_PROVIDER=codex、CODING_WF_CODEX_HOME、CODING_WF_CODEX_MODEL=gpt-6-sol、CODING_WF_JUDGE_PROVIDER=codex、CODING_WF_JUDGE_MODEL=gpt-6-astra，安装命令只启用cecelia。 以真实文件读取和内容断言核验这些参数及其在安装源码中的对应关系；不执行安装命令。

### I-2
文档提供与当前源码一致的健康检查、launchctl system状态和日志查询命令，遇到账号不可用或工作区脏时停止而不回退Claude、不硬清现场。 QA核查手册与已提交源码的对应关系及停止条件，不实际重启服务、改工作区或调用生产接口。

### I-3
文档明确独立预览只允许绑定本PR/head的同源HTTP API与隔离浏览器页面验收，WS/SW/跨源依赖无法验收时CANNOT_VERIFY；提供可信Playwright依赖及真实headless启动检查；ZenithJoy人工合并与生产放行边界保持。所有修改限文档和流水线正常验收记录。 依赖安装与headless启动检查以准确可用的操作命令写入文档，本任务验收其与实现的一致性，不实际安装依赖或重跑账号/浏览器会话。
