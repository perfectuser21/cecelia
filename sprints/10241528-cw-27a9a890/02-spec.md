---
task_id: 27a9a890-fccc-4874-9655-420030b8587b
step: spec
upstream: ["01-intent.md#I-1", "01-intent.md#I-2", "01-intent.md#I-3", "01-intent.md#I-4"]
---

# 运行回执判读手册实现规格

### S-1
对应：I-1。仅在 `packages/brain/scripts/coding-workflow/runner/README.md` 新增「运行回执如何判读」小节，写出 `node packages/brain/scripts/coding-workflow/runner/status.mjs --log-dir <回执目录> --json` 及省略参数时的用法；`--log-dir` 覆盖默认目录，`--json` 输出 JSON 数组，按文件 mtime 倒序。目录不存在或没有可扫描回执时 JSON 为 `[]`，文本为「没有运行记录」，只说明无记录，不能证明服务健康。依据 `packages/brain/scripts/coding-workflow/runner/status.mjs` 与 `lib/config.mjs`。真实调用方 shape：运维人员在仓库根运行 `node .../status.mjs [--log-dir <目录>] [--json]`，输入为命令行参数，无 HTTP 方法、header、body 或鉴权；现有 README「无领单健康与运行状态」已有 `node .../status.mjs --json` 调用。失败语义与输入对抗面：该只读命令不验证目录代表健康；不存在的目录返回空结果、正常退出；重复调用不改变回执；权限不足等无法读取目录也会被当前源码折叠为空结果，手册不得将空结果解释成健康。验证：按 Q-1 的真实 CLI 命令比较 JSON、文本与 mtime 顺序，并对照源码。

### S-2
对应：I-2。在同一 README 小节按 `status.mjs`、`lib/receipt.mjs`、`lib/cifix-scan.mjs` 解释 `running`（有 `last_event` 的进度快照）、`completed`、`partial`、`failed`、`unreadable`，以及 `ci_fix.attempts` 和 `ci_fix.last_result`；说明文本输出的 `ci_fix=<次数>次 last=<结果>`。扫描规则是目录内全部以 `.json` 结尾且文件名不匹配 `cifix-<数字>.json` 的普通文件；JSON 无法解析或不具备认可的回执形状会显示 `unreadable`。合法的 qa/commander 状态 JSON 和 `pr-sync-pending.json` 可能落入该类，不能据此断定文件损坏或删除现场。失败语义与输入对抗面：坏 JSON、非回执 JSON 均为 `unreadable`；重复扫描不改文件；不建议凭单一状态自动清理。验证：Q-2、Q-3 用真实 CLI 和现场新建文件核对分类、ci_fix 摘要与保留文件。

### S-3
对应：I-3。README 明确 `completed` 仅是执行器回执状态，不等于 PR 已合并；`summarizeReceipt` 对缺 `outputs.pr_url` 的 completed 保持 `status=completed`，JSON 的 `reason_code=pr_url_missing`，文本 completed 行默认不显示该原因，因此须查看 `--json` 并核实 `pr_url`。最终成功需只读核实对应 GitHub PR 的最终 head 确已合并，以及 Brain 的 `runner.phase=merged`、`merge.merged=true` 和 QA 终态；本次只提供诊断方法，不调用生产、不人工改批准或历史 FAIL。真实调用方 shape：运维 CLI 与 S-1 相同；GitHub/Brain 仅描述只读核对，不新增请求接口。失败语义与输入对抗面：缺 PR URL、PR/head 不匹配、尚未合并或 Brain 终态不齐时不能宣称最终成功；重复读状态不改变批准。验证：Q-4 新造缺 PR URL 回执，用真实 CLI 对照文本与 JSON；正文逐项检查终态判据。

### S-4
对应：I-4。发布前以固定 `6de9f4e25c0d0b456744a33aeca3fa92498c4138` 为基线，逐个检查该基线至当前 HEAD 的完整提交：对每个提交与每个父提交读取逐路径内容及文件模式差异，并保留越界提交的 SHA 与差异证据；同时检查基线至 HEAD 的最终差异、暂存区、工作区，并先枚举整个仓库未跟踪文件。仅按本任务真实 sprint 流水线记录路径排除，产品编辑只允许 README；先改程序再还原仍失败。基线 README 原字节按原先顺序逐段保留，允许中间插入小节；`.implementation-source-relations.json` 相对基线必须零差异。模型不编辑、暂存或提交 manifest，不改旧报告、程序、测试、开关、凭据或运行状态。verify 只读 `01-intent.md` 与真实仓库/源码；`03-build.md` 在 verify 会话被控制器临时隐藏时，不当作漏产，也不读取其它 sprint 报告。此 S 只规定当前发布前可见范围，后续阶段另按原合同执行。验证：Q-5 逐提交检查及固定基线、全仓未跟踪、原字节检查；任一自产越界提交即失败。

### S-5
对应：I-4。后续 QA/evaluate 仍以同一个固定 initial base 完整枚举到当前 HEAD 的 DAG、逐提交及逐路径差异、暂存区、工作区和全仓未跟踪文件，分别归属本任务 README/合法报告/可信来源增量与已证实的可信控制器 main 同步；不得把发布前 manifest 零差异套到发布后。本任务自产的来源增量只由可信 publish、QA、Commander 控制器登记当前 sprint 实际存在的 Markdown：publish 的 `01-intent.md`、`01-invariants.md`、`02-spec.md`、`02-review.md`、`02-review-rN.md`、`02-response-rN.md`、`03-build.md`、`04-evidence.md`，QA 的 `05-qa-report-rN.md`、`06-judge-rN.md`，Commander 的 `07-commander-rN.md`；N 为实际正整数轮次。`.implementation-source-relations.json` 仅允许在前部新增精确来源行，`owner_path=packages/brain/scripts/coding-workflow/runner/run-once.mjs`、`role=documentation`、path 为该真实 sprint 文件，登记与增量同提交；旧行逐字不动、重复幂等、冲突拒绝，模型不得直接编辑或提交。可信同步须由独立 source gate 核实真实 registration→stage→native 链、每次同步的精确两父及共同基线、独立 `gh pr view` 与 `git ls-remote` 前后 main ref 事实、逐 blob/mode 的完整 tree、受保护 merge 凭证与当前 HEAD；上游其它路径保留真实 main 原文、mode 与删除，本任务 README/报告保留第一父原字节及 mode，manifest 以真实 main 历史为底确定性携带已证明增量。缺投影、缺凭证、上游触及本任务 README/报告、改后 revert、未知变更均不能归属通过；不得只比较 final diff 或以 hash/回执代替产品验收。QA 依据可信投影和真实 Git 独立核实范围，不读保护凭证根。每个新 HEAD 均重新 QA、裁判、预览与正式 CI。QA 会话内只核实本轮可信控制器提供的 `03-build.md`、`04-evidence.md` 临时隐藏事实和当前可见工作区，明确记录完整恢复尚未发生；不重建报告、不预先宣称恢复完成。会话结束后控制器按原字节和 mode 恢复；独立裁判再核实绑定本轮任务、轮次、测试 HEAD、原生会话与实际恢复的保护凭证，第三文件缺失或内容/mode 变化失败。本轮所有实际原生命令、完整输出（含零字节）及退出码，包括失败、修正、重复、重测，均由可信控制器按序纳入最终 05 报告；原始模型草稿完整保留，草稿自填 output 必须与原生记录完全一致，FAIL/CANNOT_VERIFY 不可编译为 PASS。历史失败与报告原样保留，不能借新轮追认。验证：Q-6 按当前可见事实和可信投影核实；会话后恢复及后续终态由独立来源门、裁判和 C01-C12 核验，不要求本轮 QA 预证未来事件。

## QA 场景

### Q-1
对应: I-1
前提: 在本 PR 预览 QA 工作区新建独立空目录 `D=$(mktemp -d)`；在该目录自行写入两个最小回执 JSON，分别为 `{"status":"failed","reason_code":"older"}` 与 `{"status":"failed","reason_code":"newer"}`，文件名为 `older.json`、`newer.json`，用 `touch -t` 赋予确定且不同的 mtime。
操作: 在仓库根运行 `node packages/brain/scripts/coding-workflow/runner/status.mjs --log-dir "$D" --json`，再运行不带 `--json` 的同一命令；另用刚创建的空目录及不存在的目录分别运行 `--json`。
期望: JSON 数组中 `newer` 在 `older` 前，文本同顺序；空目录和不存在目录均为 `[]`，文本提示「没有运行记录」；README 写明这些结果只表示无回执，不能作为健康证明。清理仅删除本场景新建的临时目录。

### Q-2
对应: I-2
前提: 在本 PR 预览 QA 工作区新建独立临时目录；自行写入 `running.json` 为 `{"last_event":"step"}`，`completed.json` 为 `{"status":"completed","outputs":{"pr_url":"https://github.com/perfectuser21/cecelia/pull/987654"}}`，`partial.json` 为 `{"status":"partial","activities":[{"key":"qa","status":"failed","attempts":[{"reason_code":"qa_failed"}]}]}`，`failed.json` 为 `{"status":"failed","reason_code":"run_failed"}`，`broken.json` 为不完整 JSON；再写 `cifix-987654.json` 为 `{"attempts":[{"result":"failed"},{"result":"passed"}]}`。
操作: 运行 `node packages/brain/scripts/coding-workflow/runner/status.mjs --log-dir "$D" --json` 和同路径文本命令，逐条查状态、`failed_activity`、`reason_code`、`ci_fix`。
期望: 分别显示 `running`、`completed`、`partial`、`failed`、`unreadable`；partial 的失败活动为 `qa`、原因 `qa_failed`；completed 的 `ci_fix` 是 `attempts:2,last_result:passed`，文本出现 `ci_fix=2次 last=passed`；`cifix-987654.json` 不另成任务行；所有原文件仍在。

### Q-3
对应: I-2
前提: 在本 PR 预览 QA 工作区新建独立临时目录；本场景自行写入有效 JSON：`qa-state.json`、`commander-state.json`、`pr-sync-pending.json`，内容各为不带 `status` 或 `last_event` 的状态对象。
操作: 运行 `node packages/brain/scripts/coding-workflow/runner/status.mjs --log-dir "$D" --json`；再逐个读取这三个文件。
期望: 三行均可显示 `unreadable`，文件内容和存在性不变；README 点名合法 qa/commander 状态及 `pr-sync-pending.json` 均可能被扫描，不能因 `unreadable` 删除它们。

### Q-4
对应: I-3
前提: 在本 PR 预览 QA 工作区新建独立临时目录，本场景自行写入 `no-pr.json` 为 `{"status":"completed","outputs":{}}`。
操作: 运行 `node packages/brain/scripts/coding-workflow/runner/status.mjs --log-dir "$D" --json` 和文本命令；阅读最终 README 的合并诊断步骤。
期望: JSON 行为 `status=completed`、`reason_code=pr_url_missing`、`pr_url=null`；文本 completed 行不输出 `pr_url_missing`，不能从其 completed 推断有效 PR。README 要求只读核对实际 PR、最终 head 合并、Brain `runner.phase=merged`、`merge.merged=true` 及 QA 终态，不指导修改批准或 FAIL 记录。此场景不造真实 PR/Brain 任务，因此不能据此宣称最终合并。

### Q-5
对应: I-4
前提: 本场景在发布前 verify 的当时现场执行，以本任务固定 base SHA 和该阶段受验 HEAD 为输入；由真实控制器创建的 sprint 报告仅作为当前任务的流水线记录，不预造额外产品数据。若需改动前基线，在本机从该固定 base 的仓库内容读取，不调用生产。后续预览 QA 只查阅 verify 当时留下的真实回执及证据，不把此场景搬到已发布 HEAD 重跑。
操作: 发布前在仓库根运行 `git rev-list --parents --reverse --topo-order 6de9f4e25c0d0b456744a33aeca3fa92498c4138..HEAD`，对列出的每个提交及其每个父提交分别运行 `git diff --raw --no-renames <父SHA> <提交SHA>` 和 `git diff --binary --no-renames <父SHA> <提交SHA>`，逐路径查看内容、增删与 mode，保存越界提交 SHA 及对应差异；即使后续提交还原也照样判越界。再运行 `git diff --name-status 6de9f4e25c0d0b456744a33aeca3fa92498c4138 HEAD`、`git diff --cached --name-status`、`git diff --name-status`、`git ls-files --others --exclude-standard`，先保留全仓未跟踪清单，再逐路径核查。对 README 用 `git show 6de9f4e25c0d0b456744a33aeca3fa92498c4138:packages/brain/scripts/coding-workflow/runner/README.md` 读取基线原字节，核实它们在该阶段 README 中按原顺序逐段保留；检查该阶段 `git diff 6de9f4e25c0d0b456744a33aeca3fa92498c4138 HEAD -- .implementation-source-relations.json` 及暂存区、工作区同路径差异。预览 QA 阅读该阶段真实记录，并在 Q-6 对当前 HEAD 另做完整范围核验。
期望: 发布前每个提交均无越界自产修改；先提交修改 `status.mjs` 再提交还原仍被逐提交差异发现并判失败，证据指向相应提交。最终产品变更只有 README；全仓未跟踪文件仅能按实际本任务流水线记录路径排除，越界文件不漏；原 README 无字节改写或删除，manifest 在发布前现场对基线零差异。控制器当时暂时隐藏的 `03-build.md` 不能单凭路径暂缺判漏；verify 不读取其它 sprint 报告，也不把未来发布、CI、合并或清理作为发布前 PASS 条件。预览 QA 不将此零差异要求套到发布后 HEAD。

### Q-6
对应: I-4
前提: 本轮 QA 在 PR 预览环境针对当前精确 40 位 HEAD 运行；可信控制器提供绑定当前任务、轮次、HEAD 的只读来源投影、临时隐藏事实与本轮原生执行记录，QA 不创建或修改这些凭据。若无可信投影或无可用同步事实，按实际缺证范围判 CANNOT_VERIFY/FAIL；不假造同步。
操作: QA 从固定 initial base 对当前 HEAD 独立运行 Q-5 列出的完整 DAG、全仓差异和未跟踪枚举，并核对 README 基线原字节按原顺序保留；逐提交核对本任务 README/真实报告/合法 manifest 增量，不沿用 Q-5 的发布前 manifest 零差异判据。若存在 main 同步，按可信投影逐个核对精确两父、独立 main ref 前后采样、共同基线、全 tree 的 blob/mode、上游未触本任务 README/报告及来源门结论，并与当前 Git/HEAD 对照。只查本轮 `03-build.md`、`04-evidence.md` 临时隐藏的控制器事实及当前可见现场；记录完整恢复在 QA 会话内尚未发生。核对本轮实际命令、完整输出和退出码顺序以及原始草稿的自填 output、语义结论。
期望: 只对有独立证据且与当前 HEAD 一致的同步归属上游；缺证、越界、改后 revert、草稿 output 不实或将 FAIL/CANNOT_VERIFY 改成 PASS 均不通过。QA 会话不读取保护凭证根、不自行恢复报告，不把当前可见结论当成实际恢复、正式 CI 或最终合并；会话后控制器恢复与独立裁判、外层 C01-C12 继续独立核验。

## 铁律对照

- INV-3a390000：S-3、S-5、Q-4、Q-6 覆盖；回执或候选验证不足时不宣称合并或晋级。
- INV-2fe86d34：S-2、S-3、Q-2、Q-4 覆盖；运行状态、版本和执行结果依真实回执及终态来源判读。
- INV-696c9f96：S-3、S-4、Q-4、Q-5 覆盖；沿用 coding workflow runner 的现有命名和边界。
- INV-02d8e749：S-3、S-5、Q-4、Q-6 覆盖；README 不把执行回执或 CI 当作独立 QA 合并门。
- INV-0dc6b84f：S-4、S-5、Q-5、Q-6 覆盖；不改执行位置、模型或现有工作流约束。
- INV-ac7c8801：S-4、S-5、Q-5、Q-6 覆盖；保留研发线已定执行地与模型合同。
- INV-e2551d59：S-4、Q-5 覆盖；只编辑仓库 README，不改变 runner 镜像摘要真身。
- INV-edbf1fb9：S-3、S-5、Q-4、Q-6 覆盖；核验精确 HEAD 的 QA、裁判与最终出口，不以 PR 假设替代。
- INV-3529e88f：S-4、S-5、Q-5、Q-6 覆盖；范围和来源由固定基线、Git 与可信控制器门核实。
- INV-5e125909：S-1、Q-1 覆盖；回执目录由 CLI 参数或当前配置决定，文档不写死现场目录。
- INV-3c30394c：S-1、S-2、S-3、Q-1、Q-2、Q-4 覆盖；真实运行 CLI，未实测 GitHub/Brain 终态不标最终成功。
- INV-564802ee：S-4、Q-5 覆盖；不编辑凭据，也不在测试回执中放 secret。
- INV-3b9804e6：S-1、Q-1、Q-2、Q-3、Q-4 覆盖；QA 每场景使用独立临时目录，避免互相覆盖。
- INV-c906dd6c：S-1、S-2、Q-1、Q-2 覆盖；规格的 CLI 验证有明确输出和退出语义，不以空命令的绿色退出冒充通过。
- INV-f200769d：S-4、S-5、Q-5、Q-6 覆盖；原生命令和退出码交由可信控制器完整记录，不能用手写摘要替代。
- INV-dc18d43d：S-3、S-5、Q-4、Q-6 覆盖；文档只说明诊断，既有实际门禁继续执行，不能靠文字放行。

## 未覆盖真实链路

- 本次文档 QA 不创建真实 GitHub PR 或 Brain 任务，不调用生产；Q-4 只验 CLI 缺 PR URL 的真实行为与 README 诊断合同，真实合并、Brain 与 QA 终态由后续控制器门和外层 C01-C12 核实。
- QA 会话内无法预验会话结束后的 `03-build.md`、`04-evidence.md` 原字节及 mode 恢复、最终 05 全账装配、正式 CI、Learning 回读和下一次 tick 预览回收；Q-6 只验本轮可见事实，后续由可信控制器和独立裁判核验。
- 若本轮没有实际可信 main 同步，Q-6 不能制造同步来实测两父、全 tree 和受保护 merge 凭证；QA 验到固定 base 完整范围与投影可用性，实际同步发生时由独立 source gate 核验。

## commander 裁决（第 1 次）

### X-1：维持规格

QA 第 1 轮观察到 `status.mjs --log-dir` 缺少目录值时，现有 `parseArgs` 将 `logDir` 置为 `null`，`main` 随后读取默认 `logDir` 并以 0 退出；这一观察属实，但它是本任务未要求修复的既有 CLI 输入行为。需求 01 明确限定产品编辑为 README，禁止修改程序和仓库测试；I-1、S-1 与 Q-1 要求核验的是提供目录值的 `--log-dir <目录>` 及省略整组选项时的现有行为，不包含只给选项名却缺值的输入。S-4、S-5 还要求逐提交拒绝本任务自产的程序或测试变更。因此 X-1 要求在本 PR 修复 `status.mjs` 并留回归测试，与需求和规格的范围合同冲突，不作为本任务的 QA 失败项或修复指令。该现象及其误读风险保留在原 QA 报告中，后续若要改变 CLI 参数错误语义，应另立修复任务并配套回归测试；不得改写本轮报告或声称现象不存在。

补充 S-6：后续 QA 对 Q-1 只按已定义的有效参数形式和整组选项省略形式验收 README 与当前源码的一致性；不得将裸 `--log-dir` 缺值场景扩展为本任务必须修改程序的验收条件。此裁决不改变 Q-5 的发布前证据要求、Q-6 的当前 HEAD 范围核验，也不代替独立裁判对其它未决证据的判断。
