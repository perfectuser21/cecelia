---
task_id: 3a15fcff-3af4-49b4-a4c2-b0c7c743ef49
step: spec
upstream: ["01-intent.md#I-1", "01-intent.md#I-2", "01-intent.md#I-3", "01-intent.md#I-4"]
---

# 回执常见误读与核账示例：实现规格

### S-1

对应：I-1。只改 `packages/brain/scripts/coding-workflow/runner/README.md`，在文末追加“回执常见误读与核账示例”FAQ，不重建已有“运行回执如何判读”。以 `packages/brain/scripts/coding-workflow/runner/status.mjs` 为准，写出 `node packages/brain/scripts/coding-workflow/runner/status.mjs [--log-dir <dir>] [--json]` 的参数含义、默认 `loadConfig().logDir`、按文件 mtime 倒序、JSON 空数组和文本“没有运行记录”的含义；示例明确标注“示例数据、不是现场运行结果”。验证：读取最终 README 并对照 `status.mjs` 的 `parseArgs`、`collectStatus`、`formatStatus` 和 `main` 做逐项可失败断言；在隔离临时目录执行 `node packages/brain/scripts/coding-workflow/runner/status.mjs --log-dir <不存在的临时目录> --json`，断言退出码 0 且输出 `[]`，不能据此声称服务健康。

真实调用方 shape：运维人员在仓库根目录以命令行调用上述脚本，参数为可选 `--log-dir <dir>`、`--json`，无 HTTP、header、body 或鉴权；出处是 README 现有“运行回执如何判读”命令及 `status.mjs` 的 `parseArgs/main`。失败语义：不存在或空目录是“无记录”且退出 0，可在核实路径后只读重试；无法解析的单个 JSON 显示 `unreadable`，不触发删除。输入对抗面：目录中混入非回执 `.json` 仍会被扫描；mtime 相同不承诺稳定次序；未知参数或 `--log-dir` 缺值按现有源码处理，不在文档中许诺新增校验；超长目录名、并发写入不承诺稳定快照。

### S-2

对应：I-2。只改同一 README 的新 FAQ，对照 `packages/brain/scripts/coding-workflow/runner/status.mjs`、`packages/brain/scripts/coding-workflow/runner/lib/receipt.mjs` 与 `packages/brain/scripts/coding-workflow/runner/lib/cifix-scan.mjs`，用小型非现场 JSON/文本例解释：含 `last_event` 是 `running`；终态 `completed`、`partial`、`failed` 与 `unreadable`；`partial/failed` 的 `failed_activity` 是首个非 `completed/skipped` 活动，`reason_code` 优先最后一次 attempt，再活动级、回执级，最后 `run_<status>`；缺 PR URL 的 `completed` 仍为 `completed`，JSON 为 `reason_code=pr_url_missing`、`pr_url=null`，文本 completed 行不显示原因；有效 PR URL 对应的 `cifix-数字.json` 尝试次数、最后一次 `last_result`，无尝试时 `ci_fix=null`。说明合法 `qa`、`commander`、`pr-sync-pending` 等非回执 JSON 可能显示 `unreadable`，不可凭它清理文件或状态。验证：最终 README 中每种样例在内存里解析，逐字段与上述三份源码的分支及优先级核对；断言文本与 JSON 的缺 PR 差异、没有把 `unreadable` 写成损坏证明。样例中的命令只作文字，不执行。

真实调用方 shape、失败语义及输入对抗面沿用 S-1；特别注明非法 JSON、非回执 JSON 显示 `unreadable`，可核文件用途后重读；重复或并发更新的回执只代表本次读取，不删除或自动修复。无外部 HTTP 调用。

### S-3

对应：I-3。只改同一 README 的新 FAQ，以 `packages/brain/scripts/coding-workflow/runner/lib/terminal.mjs`、`lib/deps.mjs`、`packages/brain/scripts/coding-workflow/new-task.mjs` 和 `runner/run-once.mjs` 为核对源。写清 `terminal.mjs` 先把 task `status` 写 `completed`、`result.runner.phase` 写 `awaiting_qa`（QA 关闭时 `awaiting_manual_merge`），不等于合并；只读核对应 PR 与最终 head、Brain `runner.phase=merged`、`result.merge.merged=true` 及其 head、`qa_state` 终态，Learning 确认与下一实际 tick 的预览回收各自另验。`deps.mjs` 的前置 `completed` 只是必要输入：无 PR URL 或 `result.merged===true` 有直接就绪分支；有 PR URL 且无此捷径才查询 GitHub，`MERGED` 就绪、`OPEN`/未知等待、`CLOSED` 拒绝。`new-task.mjs --dry-run` 只做计划校验不建单，`base_sha` 预检只查 40 位小写 hex 格式，不查提交存在性；不扩成建单教程。验证：对照上述源码逐个判断分支，断言 FAQ 没把 completed、PR URL、单个哈希、dry-run 或前置 completed 写成全链成功，也没写手工改批准或 FAIL 记录的建议。

对外命令 shape：`node packages/brain/scripts/coding-workflow/new-task.mjs <plan.json> --dry-run`，读取本地计划 JSON、无 HTTP 请求或鉴权；出处是 `new-task.mjs` 的 `main/validatePlan`。这里只在 FAQ 文字中交叉提示，QA 不运行它。失败语义：预检非法计划退出 2 且给错误，合法退出 0 也不代表建单；只读核账缺 PR/head、Brain 字段或来源不一致时结论为未证实，可待真实事实出现后重读。输入对抗面：伪造或重复 PR URL、未知 GitHub 状态、错误 head、伪造 `result.merged` 不应从回执文案推断最终成功；文档按既有源码说明分支，不改校验逻辑。

### S-4

对应：I-3、I-4。产品文件仍只有 `packages/brain/scripts/coding-workflow/runner/README.md`。发布前 build/verify 以固定 `05f28a953a9fa184ed53619eba2127a203edab0e` 为基线，验证 README 是该基线整份原始字节的前缀、仅文末追加 FAQ，原文顺序和模式保留；固定基线到 HEAD 的完整 DAG、逐提交差异、暂存区、工作区和整个仓库未跟踪文件都要枚举，再只排除实际本任务流水线记录路径。对 `git rev-list --parents <固定基线>..HEAD` 列出的每个提交，逐父用 `git diff --raw --no-abbrev --no-renames <父> <提交>` 核全路径、blob 与 mode；合并提交不得只看第一父，任何自产越界改动即使后续 revert 也拒绝。发布前 verify 在当时现场核内容并留真实原生证据；后续 QA 读取 Git 正文须遵守下段隔离边界。`.implementation-source-relations.json` 发布前相对该基线零差异；其它产品代码、测试、配置、开关、凭据、运行状态均不得改。可用 `git diff --name-status 05f28a953a9fa184ed53619eba2127a203edab0e HEAD`、`git diff --cached --name-status`、`git diff --name-status`、`git ls-files --others --exclude-standard` 与只读字节比较；verify 保留原生命令、完整输出及退出码，03-build 临时隐藏按本轮可信事实解释，verify 不读其它 sprint 报告。发布前仅核当时可见事实，不提前验未来 publish/QA/CI/merge/Learning/回收。

发布后 QA 不重造发布前工作区，也不把发布前 manifest 零差异重新施加于当前 HEAD。当前 QA 仍以同一固定 initial base 枚举完整 DAG，对每个提交逐父核全路径 raw blob/mode 与归属，并核当前暂存区/工作区及全仓未跟踪文件；只对合同允许读正文的单一路径执行 `git diff --binary --no-ext-diff --no-renames <父> <提交> -- <允许路径>` 核内容，禁止不限定路径的正文 diff；当前及历史 03-build.md、04-evidence.md 的 Git 正文均禁止读取。03/04 正文身份、来源及会话后完整恢复由可信 source gate 和独立裁判核实，QA 的 raw blob/mode 不替代该证明；缺证不能通过。本任务自产只允许 README、真实本轮报告及可信控制器登记的 `.implementation-source-relations.json` 精确增量。登记只能由可信 publish/QA/Commander 控制器生成并与记录同提交：`owner_path=packages/brain/scripts/coding-workflow/runner/run-once.mjs`、`role=documentation`、本任务真实 sprint 内许可 Markdown 路径；历史条目不动、幂等、冲突拒绝，模型不得编辑/暂存/提交 manifest。可信 main 同步须逐提交证明精确两父、真实独立 main ref 的前后采样及唯一共同基线、原 registration→stage→native 链和受保护 local_controller_merge_only 凭证、逐 blob/mode 全 tree；上游不得触本任务 README/报告，即使后续 revert 也拒。QA 结合控制器提供的固定字段投影和实际 Git 核验；独立 source gate 核保护来源根及全 tree，任一缺失均不得归属同步。新 HEAD 须重跑真实 QA、裁判、预览、正式 CI；外层 C01–C12 继续在对应事件实际发生后核验。验证：读取固定 Git 事实与控制器投影，不从最终 diff 减去 main，不用浮动 `origin/main` 或最后提交替代 initial base；投影与 Git/HEAD 不合即记录不能验。

### S-5

对应：I-4。仍不增加产品改动文件；本任务真实流水线 Markdown 报告由对应阶段/可信控制器按原路径生成，不能由模型补写旧报告、改历史 FAIL 或造凭证。Q-4 每轮在当前固定 HEAD 只核可信控制器提供的本轮 `03-build.md`、`04-evidence.md` 临时隐藏事实和当前可见工作区，明确会话内尚未恢复；QA 不读保护凭证根、不自行重建隐藏文件、不采信模型自述。会话后控制器必须按原字节及 mode 完整恢复；独立裁判再核绑定当前 task、轮次、测试 HEAD、原生会话的保护凭证及无第三文件异常。可信控制器把本轮全部真实 native 执行（含失败、修正、重复、零字节输出）的命令、实际捕获的完整 `aggregated_output` 和退出码按顺序编入最终 05 报告，保留模型原草稿，模型自填 output 必须逐字验真，FAIL/CANNOT_VERIFY 不得被装配成 PASS；`aggregated_output` 不冒称任意子命令 stdout/stderr 均未截断。历史缺口、当前缺证或来源投影缺失如实失败，不能重跑补造过去。验证责任：当前 QA 只记录本轮可见事实；会话后恢复及保护凭证由裁判/source gate 核，正式 CI、实际 GitHub merge、Brain 终态、Learning ID 与全文 hash 读回、下一实际 tick 停预览/清 pending 由外层终验在发生后分别核，不得由当前 QA 预判。纯 README 任务没有有效 API 回归 smoke，不新增镜像单元测试或伪造 smoke；现有真实门禁仍执行。

## QA 场景

### Q-1

对应: I-1
前提: PR 预览环境已绑定本轮实际 HEAD；QA 在隔离的本轮仓库副本中，取一个本轮新建且不存在的临时回执目录路径，不依赖现存运行日志。
操作: 在仓库根目录读最终 README 的新 FAQ 和 `status.mjs`；运行 `node packages/brain/scripts/coding-workflow/runner/status.mjs --log-dir <本轮不存在的临时目录> --json`，记录原生命令、完整输出和退出码；再创建空临时目录并用同一命令读取，另以不带 `--json` 的同 shape 命令读取空目录；从最终 README 核 `--log-dir`、`--json`、mtime 倒序及“示例数据、不是现场运行结果”字样。
期望: 不存在/空目录的 JSON 输出均为 `[]` 且退出 0，文本包含“没有运行记录”；README 明确这仅是无记录、不能证明健康，且与源码的扫描和 mtime 倒序一致，没有重写 A11 原小节。临时数据只由本场景创建并在隔离目录使用。

### Q-2

对应: I-2
前提: 同一固定 HEAD 的最终 README 与 `status.mjs`、`lib/receipt.mjs`、`lib/cifix-scan.mjs` 可只读；样例 JSON 仅在内存解析，不写入 runner 日志目录。
操作: 像运维读手册一样逐例读取新 FAQ，使用 `node -e` 对 README 中明确标为示例的 JSON 小片段仅作内存 `JSON.parse` 与字段断言，并只读对照源码分支；逐项检查 `last_event`、三种终态、首个失败活动与最后 attempt 优先级、缺 PR 的 JSON/文本对照、ci_fix 次数/最后结果/无记录 null，以及 qa、commander、pr-sync-pending 等非回执文件误读。样例里的 shell 命令不执行。
期望: 每个例子能解析且说明与当前源码一致；缺 PR 的 completed JSON 是 `pr_url:null`、`reason_code:pr_url_missing`，文本 completed 行无该原因；非回执 JSON 可为 `unreadable`，文档没有据此建议删文件或状态。任何字段、优先级或文本差异不符即失败。

### Q-3

对应: I-3
前提: 本轮最终 README 和同一 HEAD 的 `terminal.mjs`、`deps.mjs`、`new-task.mjs` 可只读；本场景不创建 Brain 任务、不请求生产或 GitHub。
操作: 读取 FAQ 中 completed、合并、Learning、预览回收、依赖和 dry-run 的核账步骤；只读对照源码里的 `finishSuccess`、`depState`、`validatePlan/main` 分支，用当前固定源码逐句断言 `awaiting_qa`/`awaiting_manual_merge`、GitHub `MERGED/OPEN/CLOSED/未知`、无 PR 与 `result.merged===true` 捷径、`base_sha` 格式检查。检查 FAQ 的只读核账字段清单与示例标识。
期望: README 不把 completed、PR URL、单个 hash、前置 completed 或 dry-run 当最终成功；要求实际 PR/head、Brain merged 与 merge.merged/head、QA 终态，并把 Learning 和下一 tick 单独列出。没有操作批准、FAIL 记录、状态或真实建单的指令；若源码分支和 FAQ 不一致，本场景失败。

### Q-4

对应: I-4
前提: QA 在本 PR 预览环境的当前固定测试 HEAD；固定 initial base 为 `05f28a953a9fa184ed53619eba2127a203edab0e`。可信控制器仅向 QA 提供本轮必要的同步归属固定字段投影、当前 `03-build.md`/`04-evidence.md` 临时隐藏事实、测试 HEAD 与预览身份；缺项不得编造或读保护根。过去 verify 原生现场只由当时证据负责。当前及历史 03/04 正文即使在 Git 提交中也禁止读取。
操作: 先只读核 `<预览环境>/api/brain/health` 的 `git_sha` 与当前 PR head 一致；在当前仓库运行 `git rev-parse HEAD`、`git rev-list --parents 05f28a953a9fa184ed53619eba2127a203edab0e..HEAD`，对列出的每个提交逐父运行 `git diff --raw --no-abbrev --no-renames <父> <提交>`，核全量路径、blob 和 mode（合并提交逐父核）；仅对确认允许读取正文的路径逐一运行 `git diff --binary --no-ext-diff --no-renames <父> <提交> -- <允许路径>` 核内容，禁止不限路径的正文 diff，禁止读取当前或历史 03/04 的 Git 正文；再运行 `git diff --name-status 05f28a953a9fa184ed53619eba2127a203edab0e HEAD`、`git diff --cached --name-status`、`git diff --name-status`、`git ls-files --others --exclude-standard`，逐提交和逐路径核全量范围、README 原文保留、当前本任务自产文件及控制器许可的 manifest 行；全仓未跟踪先完整枚举再按实际本任务记录路径排除。对存在的 main 同步逐条用可信投影和实际 Git 核两父、真实 main ref 采样绑定、共同基线、上游是否触本任务产品/报告、完整 tree 归属；投影不足就写不能验。记录本轮 03/04 临时隐藏、当前可见工作区及“恢复尚未发生”，不读 03/04 或保护根，不 checkout/reset、删除、重建文件或重跑旧阶段。
期望: 当前 HEAD 与预览一致；固定 initial base 的完整 DAG、逐父 raw 身份、允许读取路径的正文差异及全仓现场可逐项归属，产品只限 README，历史报告不变，manifest 只见本轮可信控制器精确增量；可信 main 同步需 source gate 的独立来源与逐 blob/mode 全 tree 证明，QA 投影不能替代该门；03/04 正文身份与实际恢复由 source gate、会话后裁判独立证明，不能凭 raw blob/mode 或当前工作区宣称通过。未知路径、改后 revert、上游触本任务文件、缺投影、凭证或 Git 不一致均不得报 PASS。QA 只给当前可见范围结论，不宣称发布前 manifest 零差异、旧 verify 现场、会话后恢复或未来 CI/合并已通过；本轮全部 native 全账及实际恢复在发生后由对应控制器门、裁判和外层终验继续核。

## 铁律对照

- INV-2fe86d34：S-2、S-3、Q-3 覆盖（运行摘要与实际任务、PR、QA 事实分开，不能以同步状态或回执代替执行成功）。
- INV-b3a8bf82：S-3、S-4、Q-4 覆盖（任务、运行、版本与证据各用权威来源，保留引用关系）。
- INV-e5ab4826：S-4、S-5、Q-4 覆盖（本任务归位已有仓库、任务与运行账，不增平行账本）。
- INV-45cd3ec2：S-5、Q-4 覆盖（若控制器生成 QA smoke，未获写授权的既有安全跳过语义不改；本任务不手写 smoke）。
- INV-ff177feb：不适用：该旧退出码决策已由 INV-45cd3ec2 明确撤销，本次不改 smoke guard。
- INV-1100cb8f：S-4、Q-4 覆盖（共享 CI 与 smoke allowlist 不在产品授权范围）。
- INV-26886b60：S-4、S-5、Q-4 覆盖（实际合并 head 与裁判锚定 head 须由后续终验读取，不由当前回执推断）。
- INV-09fb5c69：S-5、Q-4 覆盖（正式 CI 绿不代替 QA/裁判或合同逐项验收）。
- INV-3c30394c：S-4、S-5、Q-4 覆盖（预览身份与真实 HEAD 核验；未来合并、Learning、回收缺实际证据不标完成）。
- INV-564802ee：S-1、S-4、Q-1 覆盖（示例仅用合成数据，不读、不写、不记录凭据）。
- INV-459b6ff9：S-2、Q-2 覆盖（FAQ 示例不含客户隐私或真实日志内容）。
- INV-5e125909：S-1、Q-1 覆盖（回执目录由实际参数/配置确定，不把某台机器路径当固定环境）。

## 判定点

- 回执状态｜候选: 文本行、JSON 解析分支、文件名推断｜所选: 对照 status.mjs 与 receipt.mjs 的 JSON 解析分支｜依据: 文本 completed 行会省略 pr_url_missing，非回执 JSON 也会进入扫描｜误判后果: 把无 PR 或 unreadable 误作成功或损坏并误清现场
- 最终成功｜候选: completed 回执、PR URL、单个 head、独立实际事实｜所选: 实际 PR/head 加 Brain merged/merge.merged/head 与 QA 终态，并由后续门独立核 Learning 和回收｜依据: terminal.mjs 先写 completed/awaiting_qa，merge 在后续发生｜误判后果: 提前宣称合并或闭环成功
- main 同步归属｜候选: 最终 diff 减 main、模型说明、可信来源链加完整 Git DAG/tree｜所选: QA 固定 initial base 全量核验与 source gate 受保护凭证双重成立｜依据: 最终字节相同不能证明过程、两父或来源｜误判后果: 放行未知改动或把上游变更冒充本任务产品

## 未覆盖真实链路

- 发布前 verify 的暂存区、工作区、全仓未跟踪及 manifest 零差异属于当时现场；当前 QA 只能核当前固定 HEAD/工作区，过去现场缺当时原生命令、完整输出、退出码和独立外层核验则发布前验收不能通过，不能由本轮重跑补造。
- 本轮 03-build/04-evidence 的原字节与 mode 恢复发生于 QA 会话后；QA 只验可信隐藏事实与当前可见范围，实际恢复和本轮绑定保护凭证由控制器与独立裁判在发生后核。
- 受保护 registration→stage→native、main ref 采样、local_controller_merge_only 与逐 blob/mode 全 tree 凭证不向 QA 开放；QA 只验固定字段投影及 Git，source gate 必须独立读真源，缺证不能归属同步。
- 正式 CI、实际 GitHub merge、Brain 终态、Learning ID/全文 hash 回读及下一实际 tick 预览回收尚未发生；当前 QA 最多核当前预览身份、README 与固定 HEAD，外层 C01–C12 需在各事实发生后逐项核验；新 HEAD 重新 QA、裁判、预览及正式 CI。
- 旧 A/A2–A9、A11、B/PR6635 的既有结果不是本轮 A12/B12 的信用；当前 QA 不改旧报告或状态，A12 与 B12 各自完整闭环后才可由外层判定 C12。
