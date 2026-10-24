---
task_id: 6d966473-8217-4881-9373-457abef4428f
step: spec
upstream: ["01-intent.md#I-1", "01-intent.md#I-2", "01-intent.md#I-3", "01-intent.md#I-4"]
---
# 运行回执判读手册实现规格

### S-1
对应：I-1。只修改 `packages/brain/scripts/coding-workflow/runner/README.md`，插入“运行回执如何判读”小节，说明真实 CLI 为 `node packages/brain/scripts/coding-workflow/runner/status.mjs [--log-dir <dir>] [--json]`：不传目录时使用 `loadConfig().logDir`，`--json` 返回数组，文本模式显示各行，按文件 mtime 倒序；目录不存在或无可列回执时 JSON 是 `[]`，文本提示“没有运行记录”，均不证明服务健康。依据：同目录 `status.mjs` 的 `parseArgs`、`collectStatus`、`main`，现有 README“无领单健康与运行状态”已有 `status.mjs --json` 真实调用方。验证：在本任务 QA 的隔离临时目录运行 Q-1 的原生 CLI 命令，核对真实 stdout、退出码与 README 文字。

真实调用方 shape：操作者按 README 从仓库根执行 `node packages/brain/scripts/coding-workflow/runner/status.mjs --json`；定向排障加 `--log-dir <实际目录>`，无需 HTTP、header、body 或鉴权。CLI 只读取指定目录。失败语义与输入对抗面：不存在目录返回空结果且退出 0，不能解释为健康；非预期 JSON 会显示 `unreadable`；源码对未知参数、缺值、过长路径和并发改动没有新增校验保证，文档不得承诺报错、稳定快照或可重试即成功。读取失败先保留现场、核实目录和文件，再重新只读运行。

### S-2
对应：I-2。只在同一 `README.md` 小节按 `status.mjs`、`lib/receipt.mjs` 和 `lib/cifix-scan.mjs` 的真实结果说明 `running`（JSON 有 `last_event`）、`completed`、`partial`、`failed`、`unreadable`，以及 `ci_fix.attempts` 次数与 `last_result`；无修复记录时 `ci_fix=null`。说明扫描目录内扩展名 `.json` 且名称不匹配 `cifix-数字.json` 的普通文件，不预先只筛“回执”：合法 `qa`、`commander` 状态 JSON 和 `pr-sync-pending.json` 也可能显示 `unreadable`。此状态只表示不符合这条回执解析路径，不证明文件损坏，不能据此删除原生文件或终态回写待办。`partial`/`failed` 的 `failed_activity` 与 `reason_code` 来自首个未 completed/skipped 活动及其最后尝试，失败时按现有回执级原因回退；不把文本摘要冒充完整现场。验证：Q-2、Q-3 用临时文件运行真实 CLI，断言两种输出与 README 相符。

失败语义与输入对抗面：坏 JSON、合法但不属于终态/进度 shape 的 JSON 均可呈 `unreadable`；单个文件解析失败不应被手册指引为清理；同目录有重复/并发写入时只描述本次读到的结果和 mtime 排序，不承诺一致快照。`cifix-数字.json` 是汇总状态文件，不单列任务行；文件缺失或无尝试时不显示修复摘要。

### S-3
对应：I-3。只在 `README.md` 明确 `summarizeReceipt` 对 `completed` 且无 `outputs.pr_url` 仍保留 `status=completed`、JSON `reason_code=pr_url_missing`；`formatStatus` 的 completed 文本行默认不打印这个 reason，故须读 JSON 核查 `pr_url`。回执 completed 与 PR 真正合并分开判定：只读核对对应 PR 和最终 head 在 GitHub 的合并事实，再核 Brain `runner.phase=merged`、`merge.merged=true` 和 QA 终态；字段不齐或来源不一致不能报最终成功。仅提供诊断方法，不调用生产、不手改批准、FAIL 记录或 Brain 状态。保留原 README 安装及安全边界的所有原字节与原先后顺序，允许在原段落间插入新小节。验证：Q-3 用有/无 PR URL 的回执对照 CLI；Q-4 检查 README 原文顺序、范围和诊断文字。外部 GitHub/Brain 调用形状不属于本次改动的接口合同；本规格不编造写入请求。

失败语义与输入对抗面：PR URL 缺失、无效或与最终 head 不符、GitHub 未合并、Brain 终态未闭合时都不能根据 completed 行宣称成功；重复查看只是只读诊断，不自动批准或重试合并。文档不把字符串形状检查当作远端真相。

### S-4
对应：I-4。产品编辑仍只限 `packages/brain/scripts/coding-workflow/runner/README.md`。发布前 verify 从固定 `a039701b0bbbc739623cc73823ad47bf5e584ee7` 到当时 HEAD 枚举完整提交 DAG、逐提交/逐路径差异，并分别列出暂存区、工作区、全仓未跟踪；先枚举全仓未跟踪再仅排除本任务实际 sprint 流水线记录路径。逐字节检查基线 README 原文按原顺序存在，允许中间插节；检查 `.implementation-source-relations.json` 相对该基线零差异。verify 只读 `01-intent.md` 和真实仓库/源码，不读其它 sprint 报告；当时控制器临时隐藏的 `03-build.md` 由当时可信控制器事实解释，不作缺产判断。验证责任属于发布前 verify，其当时原生命令、完整输出、真实退出码及外层独立核验是不可替代的证据；发布后的 HEAD、哈希或报告 PASS 不追造该现场。

发布后 QA/evaluate 用同一固定 initial base 至**当前** HEAD 独立枚举完整 DAG、逐提交归属、全部路径差异、暂存区、工作区及全仓未跟踪；自产只容许 README、当前真实 Markdown 阶段报告和可信控制器来源增量。可信 publish/QA/Commander 对 `.implementation-source-relations.json` 的许可仅为当前 sprint 已实际产生的指定 Markdown 准确行，`owner_path=packages/brain/scripts/coding-workflow/runner/run-once.mjs`、`role=documentation`，前部新增、与报告同提交、幂等冲突拒绝，历史行原样保留；模型不得编辑、暂存或提交 manifest。任何自产程序/测试/配置修改、历史报告编辑、改后 revert 均不通过。报告以各阶段真实指定路径产出，非 Markdown 附件和原生证据照原门禁保留，不以删除/改名规避。

可信控制器 main 同步须另由 source gate 核验：固定 initial base 至当前 HEAD 的完整 DAG；每个同步提交恰为两个父、第一父为前一已核任务 HEAD、第二父绑定合并前后 `gh pr view` 与 `git ls-remote` 原生采样的独立真实 main 完整 SHA；共同基线及身份一致，registration→stage→native 原来源链、绑定 task/sprint/controller/固定输入/登记 ID/精确父与 tree 的受保护 `local_controller_merge_only` 凭证齐全。逐 blob 与 mode 比较完整 tree：上游非任务路径与真实 main 一致（含删除），任务 README/既有报告与第一父字节及模式一致，manifest 由真实 main 有序历史和已证本任务增量确定生成；上游触任务 README 或报告（即使 revert）、任一路径/提交/模式/删除归属不明、同 path 异值/重复/未知字段/越界行均拒。该本地 merge 凭证不证明 push、QA、CI 或 GitHub 合并；推前 remote_pre_push、旧批准撤销、push、远端 head/正式检查/最终合并分别由原阶段核实。QA 以可信投影结合实际 Git 核实，不读保护凭证根，也不把 final diff 减 main 代替过程核验；投影缺失或不符如实 CANNOT_VERIFY。新 HEAD 重新真实 QA、裁判、预览及正式 CI。

验证：Q-4 对发布后当前固定 HEAD 做独立 Git 与文档检查；可信 source gate 和外层 C01-C12 在各自真实阶段核实受保护来源、正式 CI、合并、Brain 终态、Learning 全文回读及下一实际 tick 停预览，QA 不预先签发这些未来事实。旧 A/A2/A3/A4/A5/A6/A7/A8/A9 的失败记录不改、不追认；A11 独立 C01-C11 全 PASS 后才可能按真实新请求建 B，A11 与 B 均闭环后才判 C12，当前 QA 不创建 B 或替代该终验。

### S-5
对应：I-4。Q-4 每轮固定当前完整 HEAD、固定 initial base、完整 DAG/全仓差异及本轮可信来源投影。QA 会话内只核本轮可信控制器给出的 `03-build.md`、`04-evidence.md` 临时隐藏事实和当前可见工作区，明确“完整恢复尚未发生”；不读保护凭证根、不重建隐藏文件、不信模型自述。QA 会话结束后，控制器须按原字节和文件模式完整恢复；独立裁判核对绑定当前任务、轮次、测试 HEAD、原生会话及实际恢复的保护凭证，缺证、内容或模式变化、第三文件缺失均失败。verify 时仅 `03-build.md` 的隐藏事实同理由当时控制器和外层核验。

本轮所有真实执行（失败、修正、重复、重测及零字节输出）由可信控制器按发生顺序把原生命令、完整捕获输出、真实退出码编入最终 `05-qa-report-rN.md` 的原生全账；模型原始草稿完整保留，草稿自填 output 必须与对应真实记录完整一致，语义 FAIL/CANNOT_VERIFY 不可装配成 PASS。`aggregated_output` 仅以实际捕获字节为证，不声称任意子命令 stdout/stderr 未截断。历史失败与原始证据原样保留；旧报告缺引用可如实标注，不能改旧报告或靠新轮重跑补认旧轮。当前 Q-4 缺本轮可信投影、原生证据或 Git 对不上则不能验；会话内范围结论不充当会话后恢复或完整终态通过。验证：Q-4 的当前可见检查、本轮最终报告的控制器全账门与会话后独立裁判/终态门各按发生时点核实。

## QA 场景

### Q-1
对应: I-1
前提: QA 使用本 PR 当前 HEAD 的仓库检出和可运行的 Node；在隔离临时目录自建两个回执 JSON，分别写入 `{"status":"completed","outputs":{"pr_url":"https://github.com/example/example/pull/1"}}` 与 `{"status":"failed","reason_code":"demo"}`，用 `touch -t` 设为不同 mtime；不使用现有运行日志。
操作: 读取当前 HEAD 的 README 新小节；从仓库根执行 `node packages/brain/scripts/coding-workflow/runner/status.mjs --log-dir "$QA_LOG_DIR" --json` 和同一命令去掉 `--json`；再对一个不存在的临时目录各执行一次 JSON/文本模式，逐条保存命令、完整输出、退出码。
期望: 有文件时 JSON 为数组，较新 mtime 的行在前，文本同序；不存在目录 JSON 为 `[]`、文本含“没有运行记录”、退出 0；README 对 `--log-dir`、`--json`、mtime 倒序和空结果不等于健康的说明与这些观察一致。实际目录由 QA 会话创建并传入，不写死生产地址。

### Q-2
对应: I-2
前提: QA 在隔离临时目录自建互异文件：带 `last_event` 的进度 JSON、`partial` 且有失败活动/最后尝试原因的回执、`failed` 回执、无效 JSON、合法 `qa` 状态 JSON、合法 `commander` 状态 JSON、`pr-sync-pending.json` 待办形状 JSON；再建一个有 `outputs.pr_url` 的 completed 回执及匹配的 `cifix-<PR号>.json`，内有两次不同 `result` 的 attempts。
操作: 从仓库根运行 `node packages/brain/scripts/coding-workflow/runner/status.mjs --log-dir "$QA_LOG_DIR" --json` 及文本模式；只读打开 README，对照各行；保留所造文件，不对它们执行清理。
期望: 进度为 running，partial/failed 为各自状态且失败活动/原因与输入相符；无效 JSON、qa/commander 状态和 `pr-sync-pending.json` 可显示 unreadable，不导致命令整体失败，README 明说这不构成删文件依据；completed 行有 `ci_fix.attempts=2`、`last_result` 为第二次结果，文本出现“ci_fix=2次”，`cifix-<PR号>.json` 自身不单列任务。无修复尝试的任务 `ci_fix=null`。

### Q-3
对应: I-2,I-3
前提: QA 在新隔离目录自建两个 completed 回执：一个无 `outputs.pr_url`，一个有仅供解析的 PR URL；不创建真实 PR、Brain 任务或批准记录。
操作: 运行上述 CLI 的 `--json` 和文本模式，读取当前 README“运行回执如何判读”及已有安装/安全段落。
期望: 缺 PR URL 的 JSON 仍是 `completed`、`reason_code=pr_url_missing`、`pr_url=null`，文本 completed 行不显示该 reason；另一行能显示 PR URL，但 README 明确这仍不证明合并，给出只读核对对应 PR/最终 head、Brain `runner.phase=merged`、`merge.merged=true`、QA 终态的方法，不指示手工改批准或 FAIL。QA 不把示例 URL 的真假当最终合并结论。若真实 GitHub/Brain 终态未在当前 QA 阶段发生，记录未验范围而非 PASS。

### Q-4
对应: I-4
前提: QA 取得本轮控制器固定的当前完整 HEAD、固定 initial base `a039701b0bbbc739623cc73823ad47bf5e584ee7`、当前轮可信同步事实投影和 `03-build.md`/`04-evidence.md` 暂时隐藏事实；只接受实际已发生记录。不读取 `03-build.md`、`04-evidence.md` 内容、旧 QA 自述、保护凭证根或其它 sprint 报告。发布前 verify 的工作区快照和会话后恢复/正式 CI/合并不是当前 QA 可自造的前提。
操作: 在本 PR 检出中只读运行 `git rev-parse HEAD`、`git rev-list --parents a039701b0bbbc739623cc73823ad47bf5e584ee7..HEAD`、`git diff --name-status a039701b0bbbc739623cc73823ad47bf5e584ee7 HEAD`、`git diff --cached --name-status`、`git diff --name-status`、`git ls-files --others --exclude-standard`，先保留完整全仓未跟踪清单，再按实际本任务 sprint 记录路径辨别；对 README 用 `git show a039701b0bbbc739623cc73823ad47bf5e584ee7:packages/brain/scripts/coding-workflow/runner/README.md` 取得真实基线，按原字节和顺序对照当前文件，允许插入小节；逐提交查看变动与可信投影，检查当前可见文件、模式和本任务报告/manifest 登记范围。所有执行及失败、修正、重跑按 S-5 进入本轮最终原生全账；QA 不手工补造投影或历史现场。
期望: 当前产品改动仅 README、基线原文按序原字节保留；自产其余差异仅为当轮真实报告及精确可信来源增量，全部可见差异、暂存区、工作区、全仓未跟踪均有唯一合法归属。若有 main 同步，QA 独立核完整 DAG、提交/路径归属并与可信投影对照；source gate 另核真实 main ref 采样、两父/共同基线、逐 blob/mode 全 tree、受保护 merge 及 registration→stage→native 链，两门缺一不可。上游触本任务 README/报告、改后 revert、未知自产修改、缺投影或与 Git/HEAD 不符均不能 PASS。QA 明记 03/04 完整恢复尚未发生；当前结论不替代 verify 当时 manifest 零差异/现场原生证据，亦不替代会话后裁判的恢复凭证及后续每个新 HEAD 的 QA、预览、正式 CI、实际合并、Brain 终态、Learning 回读和下一次 tick 预览回收。

## 铁律对照

- INV-3a390000：S-4、Q-4 覆盖；预览/当前 HEAD 验收缺证不能晋级或宣称最终成功。
- INV-2fe86d34：S-2、S-3、Q-2、Q-3 覆盖；运行回执和修复摘要只按真实记录判读，不把同步/完成标签当执行或合并事实。
- INV-02d8e749：S-4、S-5、Q-4 覆盖；现有独立 QA、裁判、预览及终态门完整保留。
- INV-3529e88f：S-4、S-5、Q-4 覆盖；产品及来源核验由实际 Git、原生记录与独立门完成，不依赖模型自报。
- INV-e8230eb5：S-4、Q-4 覆盖；文档诊断不授予模型合并权，受保护 merge 只认控制器事实。
- INV-933701a3：S-4、Q-4 覆盖；全仓枚举时不把控制器本地台账误带进 PR。
- INV-dc18d43d：S-3、S-4、Q-3、Q-4 覆盖；文档只解释现行代码判据，生命周期/终态由控制器与外部真相门判定。
- INV-09fb5c69：S-4、S-5、Q-4 覆盖；正式 CI 绿不替代当前产品 QA 与独立裁判验收。
- INV-6d11717d：S-4、Q-4 覆盖；未实跑的链路如实列未覆盖，不凭 CI 颜色放行。
- INV-3c30394c：S-1、S-2、S-3、Q-1、Q-2、Q-3 覆盖；用真实 Node CLI 和当前 README 观察本次产品结果，未来合并终态另待真环境核验。
- INV-564802ee：S-1、Q-1 覆盖；隔离测试目录只用自造回执，不读写凭据或将其放入日志。
- INV-45cd3ec2：不适用：本次不修改或执行受生产写保护的回归 smoke，QA CLI 只读临时目录。
- INV-ff177feb：不适用：该条已被 INV-45cd3ec2 撤销，本次不碰 smoke 退出码。
- INV-0dc6b84f：不适用：本规格不修改研发会话的模型或执行地配置。
- INV-ac7c8801：不适用：该模型版本条已由 INV-0dc6b84f 修订，本次不修改模型配置。
- INV-c906dd6c：不适用：本次没有指定 vitest 作为验收命令；Q 场景使用原生 CLI 并记录真实退出码。
- INV-52f1801e：不适用：本次不安装依赖，QA 使用现成 Node 运行只读 CLI。
- INV-50954d28：不适用：本次不新增或修改 HTTP 端点。

## 未覆盖真实链路

- 本次产品 QA 只读当前 PR README 并在隔离目录真跑 CLI；不调用生产 Brain/GitHub、不创建真实 PR，因此 PR 最终 head 合并、Brain `runner.phase`/`merge.merged`/QA 终态由实际合并及终态门之后核实，Q-3 只验文档诊断和回执边界。
- 发布前 verify 当时的暂存区、工作区、全仓未跟踪、manifest 零差异及 `03-build.md` 临时隐藏现场，当前发布后 QA 无法重建；须查当时可信原生命令、完整输出、真实退出码和外层独立核验，缺证不通过。
- QA 会话结束后的 `03-build.md`、`04-evidence.md` 原字节/模式恢复及保护凭证当前尚未发生；Q-4 只核本轮隐藏事实和可见工作区，恢复由控制器实际执行后交独立裁判核验。
- 本轮最终 `05-qa-report-rN.md` 原生全账、模型草稿、精确来源链和受保护 main merge 凭证由可信控制器/source gate 在实际发生后核验；Q-4 仅使用受控投影及实际 Git，缺投影或全账不能补造通过。
- 新 HEAD 的重测、正式 CI、实际合并、Learning 全文回读、下一实际 tick 停预览，以及 A11/C01-C11 后可能创建 B 与 C12，均待对应控制器/外层终态验收；本次 Q-4 不预先宣称通过。
