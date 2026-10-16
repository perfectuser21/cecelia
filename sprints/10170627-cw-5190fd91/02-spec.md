---
task_id: 5190fd91-d6c9-4247-850b-5700051a4830
step: spec
upstream: ["01-intent.md#I-1", "01-intent.md#I-2", "01-intent.md#I-3", "01-intent.md#I-4"]
---

# 运行回执判读手册实现规格

### S-1
对应：I-1。产品只编辑 `packages/brain/scripts/coding-workflow/runner/README.md`，在现有安装与安全说明间插入“运行回执如何判读”小节。写明从仓库根运行 `node packages/brain/scripts/coding-workflow/runner/status.mjs [--log-dir <目录>] [--json]`：`--log-dir` 指定回执目录，省略时取 `CODING_WF_LOG_DIR` 或运行用户 home 下 `.cecelia/coding-workflow-runner`；`--json` 输出机器可读数组；行按 JSON 文件 mtime 倒序。目录不存在或没有被扫描到的回执时 JSON 为 `[]`，普通输出为“没有运行记录（<目录>）”，只说明未找到记录，不证明服务健康。真实调用方 shape：运维人员从仓库根调用该 CLI，参数为 `--log-dir <目录>`、可选 `--json`，无 HTTP 方法、header、body 或鉴权；出处 `packages/brain/scripts/coding-workflow/runner/status.mjs` 的 `parseArgs/main` 与 `lib/config.mjs` 的 `logDir`。失败语义与输入对抗面：文档不暗示空数组是成功；无效/不存在目录返回空结果且进程退出码 0；源码未校验未知参数、重复参数或超长路径，不在本次文档虚构拒绝、权限错误或可重试承诺。验证：在临时空目录与不存在目录分别运行上述 CLI 的普通及 JSON 模式，断言文档所述输出；再创建两个不同 mtime 的合法回执，断言 JSON 顺序。

### S-2
对应：I-2。仍只编辑 `packages/brain/scripts/coding-workflow/runner/README.md`。依据 `status.mjs`、`lib/receipt.mjs`、`lib/cifix-scan.mjs` 写明：带 `last_event` 的 JSON 显示 `running`；终态 `completed`、`partial`、`failed` 由回执 `status` 判读，后两者显示首个非 completed/skipped 活动及最后一次尝试的 `reason_code`（缺失时依次回落活动、回执、`run_<status>`）；解析失败或不合状态形状的 JSON 显示 `unreadable`。扫描对象是目录中除 `cifix-<数字>.json` 外的所有 `.json` 普通文件，因此合法 `qa`/`commander` 状态 JSON、`pr-sync-pending.json` 也可能列为 `unreadable`；不能据此认定损坏、删除文件或终态回写待办。`ci_fix` 只从非空 `pr_url` 字符串匹配 `/pull/<编号>`，按编号读取同目录的 `cifix-<编号>.json`；有尝试时显示 `attempts` 与 `last_result`，不校验域名、PR 是否存在或外部 CI 事实。无匹配编号或无尝试时 `ci_fix:null`，普通行不附摘要。用户看到的修复次数仅是本地文件摘要，不能据此认定关联了有效 PR。真实调用方 shape 同 S-1。失败语义与输入对抗面：损坏 JSON 仍可出现 `unreadable`，但该类别不足以推断损坏原因；重复/并发读写只按当次磁盘快照判读，读失败不构成可删除依据。验证：对独立临时目录运行 CLI，造 `last_event`、三种终态、非回执 JSON、无效 JSON、`pr-sync-pending.json`、`cifix-37.json` 及非 GitHub `https://example.invalid/pull/37` 回执，断言该回执的 JSON 和普通行仍显示本地 ci_fix 摘要，并核对 README 的限制说明；不将 QA 场景写成单元测试。

### S-3
对应：I-3。仍只编辑 `packages/brain/scripts/coding-workflow/runner/README.md`。明确 `summarizeReceipt` 对 `completed` 且缺 `outputs.pr_url` 仍返回 `status=completed`，同时 `reason_code=pr_url_missing`、`pr_url=null`；`formatStatus` 的 completed 行通常只显示 PR URL，不打印该 reason，故必须看 `--json` 并核实 URL。写明最终合并与运行回执是不同事实：按对应 PR 的当前 head 核实 GitHub 实际合并，并只读核对 Brain 的 `runner.phase=merged`、`merge.merged=true` 与 QA 终态；任一缺失或不一致不能宣布最终成功，也不手工改批准或历史 FAIL。产品仅给诊断步骤，不要求本次访问生产、建单或实际合并。真实调用方 shape 仍为 S-1 CLI；GitHub 与 Brain 在此仅是后续只读诊断对象，文档不得杜撰未核实的 API 请求 shape。失败语义与输入对抗面：无 URL、错误 PR/head、QA 未终态、合并未发生时结论为未核实/未完成；重复查询可以重试，但不修改状态。验证：临时目录放置 completed 有/无 PR URL 的回执，运行 `status.mjs --log-dir <目录> --json` 及普通模式，断言 JSON 的缺 URL 原因与普通 completed 行的差别；逐句对照 `status.mjs`、`lib/receipt.mjs` 和最终 README。

### S-4
对应：I-4。产品文件仍仅为 `packages/brain/scripts/coding-workflow/runner/README.md`；本条是验收约束，不授权模型修改任何其它文件。发布前 verify 固定 `base_sha=04b88ddba4b1aa23a156d59734b4d88f621fe1e9`，枚举从该 SHA 到 HEAD 的完整差异及提交、暂存区、工作区，并先枚举**整个仓库**未跟踪文件，再只排除实际本任务流水线记录路径；不能用浮动 main、最近 merge-base、最后一个提交或只查 README。对完整 DAG 中每个提交的**每条父边**核对改动路径、内容与文件模式；中途越界修改即使后续 revert、最终差异为零也失败。断言基线 README 的原字节按原先后顺序全部保留，允许在中间插入小节；`.implementation-source-relations.json` 相对基线零差异。本任务 sprint 的真实流水线 Markdown 属独立证据范围，不把它当产品编辑；verify 只读 `01-intent.md` 与真实仓库/源码，不读其它 sprint 报告，也不要求此时尚未发生的 publish/QA/CI/合并/Learning/预览回收。发布后 QA/evaluate 继续固定同一 initial base 完整枚举 DAG、差异、暂存区、工作区与全仓未跟踪文件；严格区分本任务 README、真实报告、可信控制器来源增量与已证实的 main 同步，不能重用发布前 manifest 零差异断言，也不能从最终 diff 简单减去 main 差异。仅可信 publish/QA/Commander 控制器可给 `.implementation-source-relations.json` 前部追加本次实际 sprint 中许可的 Markdown 来源，owner 固定 `packages/brain/scripts/coding-workflow/runner/run-once.mjs`、role 固定 `documentation`；历史字节不动、幂等、同 path 异值拒绝，模型不能编辑、暂存或提交 manifest。同步须由独立 source gate 逐项核实固定 initial base 的完整 DAG、精确两父（第一父为前一已核本任务 HEAD，第二父为真实独立 main ref 完整 SHA）、共同基线、原 registration→stage→native 链、受保护 merge 凭证与逐 blob/mode 的完整 tree；上游触本任务 README/报告、先改后 revert、未知或缺证同步均拒绝。每个新 HEAD 重做真实 QA、裁判、预览与正式 CI，旧批准撤销；原 C01-C12 全部保留，A7 C01-C11 真 PASS 后才可建 B，两条闭环后 C12 才 PASS。验证：按 Q-4 对固定 SHA、全仓范围及当时阶段事实进行只读核对；后续控制器来源门与外层终态验收各自独立核验，不将其冒充发布前产品 QA。

### S-5
对应：I-4。只约束本轮 QA/evaluate 的隔离与证据判定，不授权修改代码或报告。verify 会话内控制器临时隐藏 `03-build.md`；QA/evaluate 会话内临时隐藏当前任务的 `03-build.md` 和 `04-evidence.md`。QA 只根据本轮可信控制器提供的隐藏事实与当前可见工作区判断，记录“完整恢复尚未发生”，不读受保护凭证根、不自行重建报告、不信模型自述；不因这两个暂缺路径断言漏产，也不把第三文件暂缺算豁免。会话结束后由控制器按原字节及文件模式恢复，独立裁判再核本轮任务、轮次、测试 HEAD、原生会话与实际完整恢复凭证；缺证、恢复不全、内容/模式变动都失败。每轮 Q-4 必须引用本轮所有实际命令（含失败、修正、重测）的完整原生输出和退出码，不省略、不摘要替代；历史 FAIL/CANNOT_VERIFY 与旧报告缺口留原样，不能重写或追认旧 A/A2/A3/A4/A5/A6，也不能把旧报告缺输出说成原生记录不存在。验证：Q-4 在 QA 会话内核当时可见证据并明确尚未恢复；裁判及控制器随后按本轮受保护凭证完成恢复与来源核验。新增报告只能是当前合法轮次实际生成的路径，不能编造轮次或编辑历史。

## QA 场景

以下命令均在本 PR 的 QA 会话所给仓库根执行；CLI 使用本地临时回执目录，不连生产 Brain、不安装服务、不启动浏览器。需要预览环境的 HTTP 操作一律写 `<预览环境>/api/brain/...`；本次文档产品没有 HTTP 接口，不需 HTTP 场景。每个临时目录与文件由该场景当场创建，验完即清理。每个场景同时真读取最终 README 的相关文字并真运行仓库 CLI，命令、完整输出、退出码逐字记入本轮原生报告；不以 `npm test`、dry-run 或旧轮输出代替。

### Q-1
对应: I-1
前提: 在 QA 环境新建独立空临时目录 `D`；另选从未创建的 `D/missing`。不依赖现有 runner 回执。
操作: 从仓库根分别运行 `node packages/brain/scripts/coding-workflow/runner/status.mjs --log-dir "$D" --json`、去掉 `--json` 的命令，再对 `"$D/missing"` 重复两次；在 `D` 新建 `older.json`/`newer.json` 两份合法 `{"status":"completed","outputs":{"pr_url":"https://github.com/example/repo/pull/12"}}`，显式设置 `older.json` mtime 早于 `newer.json`，再次运行 JSON 模式并阅读 README 用法小节。
期望: 空目录与不存在目录的 JSON 均精确为 `[]`，普通模式含“没有运行记录（<实际目录>）”，退出码 0；两条结果按 `newer`、`older` 顺序出现。README 写明 `--log-dir`、`--json`、默认目录、mtime 倒序及“无记录不证明健康”。

### Q-2
对应: I-2
前提: 新建独立临时目录 `D`；场景自己写入 `run.json`（含 `last_event`）、`partial.json`（含 `status=partial` 与一条 failed 活动及最后尝试原因）、`failed.json`（含 `status=failed`）、`ok.json`（含 `status=completed` 与 `outputs.pr_url=https://github.com/example/repo/pull/37`）、`non-github.json`（含 `status=completed` 与 `outputs.pr_url=https://example.invalid/pull/37`）、`cifix-37.json`（两条 `attempts`，末条 `result=passed`）、`qa.json`、`commander.json`、`pr-sync-pending.json`（均为合法 JSON 对象但无回执形状），以及内容损坏的 `broken.json`。这些文件均由本场景生成，不从 runner 现场复制。
操作: 从仓库根运行 `node packages/brain/scripts/coding-workflow/runner/status.mjs --log-dir "$D" --json` 和不带 `--json` 的同一命令；阅读最终 README 相应小节，核对各文件名和字段。
期望: `run` 为 running；`partial`、`failed` 保持各自状态及失败原因；`ok` 与 `non-github` 均为 completed，均显示本地 `ci_fix.attempts=2`、`last_result=passed`，普通行摘要与 JSON 对应；`cifix-37.json` 不成为单独行；`qa`、`commander`、`pr-sync-pending`、`broken` 均可列为 unreadable。README 明说 unreadable 不足以证明文件损坏，更不能删除 `pr-sync-pending.json` 待办；`non-github` 的修复次数只证明 URL 字符串编号匹配了本地文件，不证明 PR 有效或外部 CI 已修复。

### Q-3
对应: I-2, I-3
前提: 新建独立临时目录 `D`；本场景写 `missing-pr.json`，内容为 `{"status":"completed","outputs":{}}`，以及 `with-pr.json`，内容为 `{"status":"completed","outputs":{"pr_url":"https://github.com/example/repo/pull/38"}}`；不创建真实 PR 或 Brain 任务。
操作: 运行 `node packages/brain/scripts/coding-workflow/runner/status.mjs --log-dir "$D" --json` 与普通输出，逐条阅读 README 对 completed、PR/head、Brain 终态及只读诊断的说明。
期望: `missing-pr` 在 JSON 中仍是 completed，`reason_code=pr_url_missing`、`pr_url=null`，普通 completed 行不显示该原因；`with-pr` 有 URL 且无 ci_fix 尝试时 `ci_fix=null`。README 要求核对 JSON、对应 PR 当前 head 和实际合并，以及 Brain `runner.phase=merged`、`merge.merged=true`、QA 终态；未核实不得宣布成功或手工改批准/历史 FAIL。此场景不把合成 URL 误称实际合并。

### Q-4
对应: I-4
前提: QA 以本轮控制器实际生成的 task/sprint、测试 HEAD 和可信来源投影为输入；它们是本轮操作自身产生的证据，不借用环境已有任务或旧轮报告。QA 会话内控制器已记录当前任务 `03-build.md`、`04-evidence.md` 临时隐藏事实；完整恢复此时尚未发生。固定 initial base 为 `04b88ddba4b1aa23a156d59734b4d88f621fe1e9`。
操作: 在本轮工作树真运行 `git rev-parse HEAD`、`git rev-list --reverse --topo-order --parents 04b88ddba4b1aa23a156d59734b4d88f621fe1e9..HEAD`、`git diff --name-status 04b88ddba4b1aa23a156d59734b4d88f621fe1e9 HEAD`、`git diff --cached --name-status`、`git diff --name-status`、`git ls-files --others --exclude-standard`。按 `rev-list` 所列每个提交及其**每个父提交**，分别运行 `git diff --no-ext-diff --no-renames --raw --full-index --binary <父SHA> <提交SHA> --`，读取每条父边的全部路径、原/新 blob、文件模式及内容补丁；合并提交不得只查第一父。将每条边与本任务自产许可或经可信来源门证明的 main 同步逐项对照；任一非 README 程序文件被本任务改动，即使下一提交恢复原字节，也判越界。先保存完整全仓未跟踪列表，再仅按本任务实际 sprint 记录识别证据路径；真读最终 README 与固定基线 README，逐字且按顺序比较旧内容。结合本轮可信来源投影和实际 Git 核本任务自产路径、manifest 真实增量与每次被声称的 main 同步；QA 不读保护凭证根、不自行生成隐藏报告。把本轮执行过的每条命令、完整原生输出和退出码（包括失败及重测，含逐父边检查）原样写进本轮 QA 报告，明确完整恢复未发生。发布前 verify 的相同范围另须以当时 HEAD 核 `.implementation-source-relations.json` 相对固定基线零差异，且只读 01-intent 与真实仓库/源码；QA 不在发布后重造该状态。
期望: 当前可见产品编辑仅 README，原文原字节按原顺序保留；逐提交、逐父边均无未获许可的自产改动，中途改动非 README 程序文件再 revert 仍失败，不能被最终零差异掩盖。真实报告及经证实的来源增量按各阶段许可归位，无其它自产程序、测试、配置、开关、凭据、运行状态或未知文件变化。若存在 main 同步，QA 的固定 initial base 全 DAG/全仓差异检查与独立 source gate 的两父、真实 main ref、完整 tree/blob/mode、原生链和受保护 merge 核验均须分别通过；缺投影、与 Git/HEAD 不符、上游触本任务产品/报告、改后 revert 或任一证据缺失时记录不能验收，不能自行补造。仅依据控制器本轮隐藏事实解释指定两份暂缺报告；第三文件缺失仍失败。历史轮失败与报告证据缺口保留，当前轮也必须独立有完整原生输出/退出码。QA 不预判恢复、正式 CI、远端合并、Brain 终态、Learning 或下次 tick；这些由会话后裁判、来源门与外层 C01-C12 在实际发生后核验。

## 铁律对照

- INV-2fe86d34：S-3、Q-3 覆盖；回执状态只代表运行事实，PR 与 Brain 终态另行核对。
- INV-b3a8bf82：S-3、S-4、Q-4 覆盖；任务、运行与版本证据各用自身真身，不用 README 代替账本。
- INV-e5ab4826：S-4、Q-4 覆盖；此次只补仓库手册，不建立平行状态账。
- INV-696c9f96：S-3 覆盖；文档只称 coding workflow runner/commander，不混称业务 OpenClaw commander。
- INV-02d8e749：S-4、Q-4 覆盖；保留真实 QA、独立裁判、正式 CI 与后续合并门，不以文档验收缩减流程。
- INV-0dc6b84f：不适用：只写回执判读文档，不改 coding 模型或执行地。
- INV-91e9abe3：不适用：不启动或改动自动模型通道。
- INV-751f73be：S-1、Q-1 覆盖；仅运行只读 status CLI，不激活无人值守服务。
- INV-26886b60：S-3、S-4、Q-4 覆盖；最终 head 必与实际 QA/裁判/合并身份对应，新 HEAD 重验。
- INV-e8230eb5：S-4、Q-4 覆盖；模型不执行受保护 merge，控制器来源门另核。
- INV-dc18d43d：S-3、S-4、Q-4 覆盖；文档仅指导判读，生命周期与最终状态仍由真实控制器、Brain 和外部事实判定。
- INV-09fb5c69：S-4、Q-4 覆盖；CI 绿不代替真人 QA/evaluator 与裁判。
- INV-3c30394c：S-3、Q-3、Q-4 覆盖；本次未真验远端合并与 Brain 终态，不报这些链路已完成。
- INV-564802ee：S-1、Q-1 覆盖；样例仅用临时目录与虚构 PR URL，不读写凭据。
- INV-459b6ff9：S-2、Q-2 覆盖；QA 仅造无隐私合成回执，不把真实日志内容复制进文档。
- INV-45cd3ec2：不适用：本次不新增或修改 smoke guard；后续 runner 生成 smoke 仍按现行授权约定。
- INV-ff177feb：不适用：已被 INV-45cd3ec2 撤销，且本次不改 smoke。

## 判定点

- 回执与最终合并｜候选: 只看 status 表格、同时核 JSON/对应 PR 当前 head 与 Brain 终态｜所选: 后者｜依据: completed 缺 PR URL 仍显示 completed，且本地回执不含实际合并真相｜误判后果: 未合并任务被宣布完成。
- unreadable 原因｜候选: 一律判文件损坏并删除、先核文件用途与回执形状｜所选: 后者｜依据: status 扫描非 cifix 的所有 JSON，合法状态/待办 JSON 也可能落入 unreadable｜误判后果: 删除终态回写待办或丢失运行现场。
- main 同步归属｜候选: 最终 diff 减 main、固定 initial base 全 DAG 加可信来源门｜所选: 后者｜依据: 合并及 revert 过程不能由最终树单独证明，必须核真实 main ref 与受保护 merge｜误判后果: 越界自产修改冒充上游同步。

## 未覆盖真实链路

- 本次 QA 用临时合成回执真跑本地 CLI 并真读 README；没有实际创建任务、调用生产 Brain、生成 PR 或触发 GitHub 合并，PR/head、`runner.phase`、`merge.merged` 与 QA 终态仅写只读诊断判据，由后续外层终验在事件实际发生后核。
- QA 会话内只核本轮可信隐藏事实及当前可见范围；`03-build.md`/`04-evidence.md` 按原字节与模式完整恢复、受保护来源凭证及本轮 native 链由会话后控制器和独立裁判核，本轮 QA 不预先声称通过。
- 正式 CI、最终远端 head 与实际合并、Brain 终态、Learning 回读及下次 tick 停预览尚未在发布前发生；由 C01-C12 对应阶段真实读取，不用本地 CLI 结果代替。
