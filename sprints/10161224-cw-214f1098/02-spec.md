---
task_id: 214f1098-a4b8-4c0b-9947-daf49a9bd929
step: spec
upstream: ["01-intent.md#I-1", "01-intent.md#I-2", "01-intent.md#I-3", "01-intent.md#I-4"]
---

# 运行回执判读手册实现规格

### S-1

对应：I-1。只在 `packages/brain/scripts/coding-workflow/runner/README.md` 的现有运行状态说明后新增“运行回执如何判读”小节，保留原文全部字节及顺序。给出从仓库根目录运行 `node packages/brain/scripts/coding-workflow/runner/status.mjs --log-dir <回执目录> --json` 和不带 `--json` 的示例：`--log-dir` 指定目录，省略时使用 `CODING_WF_LOG_DIR` 或运行用户 home 下的默认目录；`--json` 输出 JSON 数组；按文件 `mtime` 倒序。目录不存在或没有候选回执时 JSON 为 `[]`、文本提示“没有运行记录”，只代表无记录，不能推断服务健康。真实调用方 shape：操作者直接执行上述 Node CLI，参数是 `--log-dir <目录>`、可选 `--json`，无 HTTP header、body 或鉴权；依据 `status.mjs` 的 `parseArgs/main` 和现有 README“无领单健康与运行状态”。失败语义与输入对抗面：该 CLI 对不存在目录返回空结果并退出 0；非法目录或不可读目录也可能得到空结果，不能作为健康通过；文档不承诺未知参数、重复参数或超长路径的额外校验。验证：从仓库根目录创建临时空目录并运行上述两种命令，断言 JSON 精确为 `[]`、文本含“没有运行记录”；写两份不同 mtime 的临时回执，再断言新文件排前。

### S-2

对应：I-2。仍只改 `packages/brain/scripts/coding-workflow/runner/README.md`。按 `status.mjs` 的 `parseReceipt/collectStatus/formatStatus` 与 `lib/receipt.mjs` 的 `summarizeReceipt` 说明：带 `last_event` 的 JSON 显示 `running`；终态 `completed`、`partial`、`failed` 保留其状态；`partial/failed` 的 `failed_activity` 为首个未完成且未跳过活动，`reason_code` 优先取该活动最后一次 attempt、再取活动级、回执级，最后回落 `run_<status>`；解析失败或形状不是这些状态的 JSON 显示 `unreadable`。非 `cifix-<数字>.json` 的所有 JSON 都可能被扫描，合法 `qa-*.json`、`commander-*.json` 和 `pr-sync-pending.json` 可能显示 `unreadable`，不能据此判断文件损坏，更不能删除现场或待办。与回执 PR URL 的 `/pull/<编号>` 匹配的 `cifix-<编号>.json` 不单列任务行；有 `attempts` 时 `ci_fix.attempts` 是次数、`last_result` 是最后一次结果，无记录时 `ci_fix=null`。真实调用方 shape 同 S-1，依据 `status.mjs` 的 CLI 入口及 `lib/cifix-scan.mjs` 的 `readState`。失败语义与输入对抗面：损坏 JSON 只使该文件显示 `unreadable`，不妨碍其他行；重复运行只读，不消耗待办；恶意或超长内容不应被文档说成可安全删除。验证：在临时目录写进度、终态、形状不匹配 JSON 及 `cifix-<编号>.json`，运行 CLI `--json`，逐字段核对分类、次数和最后结果，并确认原文件仍存在。

### S-3

对应：I-3。仍只改 `packages/brain/scripts/coding-workflow/runner/README.md`。明确 `summarizeReceipt` 遇到 `completed` 但没有有效 `outputs.pr_url` 时仍返回 `status=completed`、`reason_code=pr_url_missing`；`formatStatus` 的普通 completed 行不打印此原因，故先看 `--json` 的 `pr_url/reason_code`，再只读核对相应 PR 的最终 head 是否合并，以及 Brain 里该任务的 `runner.phase=merged`、`merge.merged=true` 和 QA 终态，三者不能用回执 completed 替代。PR URL 缺失、PR 尚未合并、head 不符、Brain 终态未到时均不得写“最终成功”，保留现场按原流程继续核对；不得手改批准或 FAIL 记录。真实调用方 shape：操作者使用 S-1 的本地 CLI 读取回执，再通过已授权的 GitHub/Brain 只读界面核对对应任务；本次不新增或修改接口，也不对生产发送请求。失败语义与输入对抗面：缺 URL、伪造 URL、过期 head、重复读或并发状态变化时只能判“尚未证实最终合并”，重读真实最终状态后再判断。验证：构造无 `outputs.pr_url` 的 completed 临时回执，断言 JSON 仍为 completed 且 `reason_code=pr_url_missing`、`pr_url=null`，普通行没有该 reason；README 明文要求上述三处终态核对。

### S-4

对应：I-4。产品实现只修改 `packages/brain/scripts/coding-workflow/runner/README.md`；`status.mjs`、`lib/receipt.mjs`、测试、开关、凭据和运行状态均不改，原 README 全文逐字保留。发布前 verify 的控制器来源门以固定 `base_sha=1b253761280dac9bcbe8e56c6e5b13b23e3d5d1c` 检查 base 到 HEAD、暂存区、工作区和**全仓**未跟踪路径，再仅排除本任务实际 sprint 记录；确认可见产品差异只有 README，基线 README 原文字节有序保留，`.implementation-source-relations.json` 对基线零差异。verify 只读 `01-intent.md` 与真实仓库/源码；`03-build.md` 被临时隐藏不算漏产，不读取其他 sprint 报告，也不预判后续阶段。发布后的 QA/evaluate 则按当前 HEAD 检查范围：仅可信 publish、QA、Commander 控制器可在 manifest 前部新增本任务真实生成的白名单 Markdown 来源行，`owner_path=packages/brain/scripts/coding-workflow/runner/run-once.mjs`、`role=documentation`、路径绑定本 sprint；历史行逐字不变，重复登记幂等，冲突拒绝；其它 manifest 变化失败。模型不得编辑、暂存或提交 manifest。来源登记及其增量必须同提交，非 Markdown 原生证据仍按原门禁保存。失败语义与输入对抗面：越界、历史来源改写、假造轮次、漏扫未跟踪文件或只拿末次提交比较均失败并留证，不能用删附件或改名绕过。验证：控制器在发布前执行上述 Git 全范围及基线文本断言；QA 只核对发布后当前 HEAD 的实际来源增量，最终提交、正式 CI、合并、Brain 终态、Learning 与预览回收由各自后续控制器及外层 C01-C12 验收，不把其未来结果伪装为本步证据。

## QA 场景

以下 CLI 均在本 PR 的 QA 工作树仓库根目录运行，临时数据放 QA 自建临时目录；不调用生产 Brain，不安装或启动 runner 服务。QA 保留命令原生输出、退出码与断言结果，不省略失败输出。若需改动前对比，仅在本机从 `main` 起基线；本次可直接按源码和当前 README 断言，无需双端比对。

### Q-1

对应: I-1

前提: QA 用 `mktemp -d` 新建空回执目录，并在该目录自行写入两份带 `status=completed`、不同 `outputs.pr_url` 的 JSON；用 `touch -t` 将两份文件 mtime 设为不同时间。

操作: 阅读最终 README 新小节；从仓库根目录分别运行 `node packages/brain/scripts/coding-workflow/runner/status.mjs --log-dir "$DIR" --json` 和同命令去掉 `--json`；先在空目录执行，再写文件后执行；另指定一个由 QA 新生成、确定不存在的路径执行 `--json`。

期望: README 写明参数、默认目录、mtime 倒序和空结果含义；空目录及不存在目录的 JSON 均为 `[]`、普通输出含“没有运行记录”、退出码为 0，但文档不称其健康；有文件时两种输出均按较新 mtime 在前。

### Q-2

对应: I-2

前提: QA 用 `mktemp -d` 新建独立目录，写入进度 JSON（`last_event`）、`partial` 回执（首个失败活动的最后 attempt `reason_code=tests_failed`）、`failed` 回执、无回执形状的合法 `qa-check.json`、`commander-check.json`、`pr-sync-pending.json`，再写一个非法 JSON；另写带 `outputs.pr_url=https://github.com/example/repo/pull/77` 的 completed 回执及 `cifix-77.json`，其中 `attempts` 有 `push_failed`、`pushed` 两条。

操作: 运行 `node packages/brain/scripts/coding-workflow/runner/status.mjs --log-dir "$DIR" --json`，再运行不带 `--json` 的同一命令；之后重新列出 QA 创建的目录文件。

期望: 进度行为 `running`，两种失败终态保留 `partial/failed`，活动和 `reason_code` 与输入一致；非回执合法 JSON 及非法 JSON 均可能为 `unreadable`，其他回执仍可读；completed 行 `ci_fix.attempts=2`、`last_result=pushed`，`cifix-77.json` 不单列，目录文件未被删除；README 明确 `unreadable` 不授权清理，包括 `pr-sync-pending.json`。

### Q-3

对应: I-3

前提: QA 用 `mktemp -d` 新建目录，分别写入无 `outputs.pr_url` 的 completed 回执、带仅作示例且未验证合并的 PR URL 的 completed 回执；不使用环境既有 PR 或任务。

操作: 对该目录执行 status CLI 的 `--json` 与普通模式，阅读最终 README 中的终态核对步骤；仅根据这两条自造回执作判断，不向生产写入。

期望: 缺 URL 的 JSON 行仍为 `completed`，同时 `reason_code=pr_url_missing`、`pr_url=null`；普通 completed 行不显示 `pr_url_missing`。README 明确两条都不能仅凭 completed 断定合并，须核对对应 PR 的最终 head、Brain `runner.phase=merged`、`merge.merged=true` 及 QA 终态，且不得手改批准/FAIL。自造 PR URL 无真实对应对象时结论是“未证实”，而非成功。

### Q-4

对应: I-4

前提: QA 以本轮 PR 的实际 HEAD 和固定 `1b253761280dac9bcbe8e56c6e5b13b23e3d5d1c` 为输入；先枚举全仓未跟踪路径，再按本任务实际 sprint 证据路径排除。manifest 来源行由前序可信控制器实际生成，QA 不新造、改写或删除。

操作: QA 只读查看 base 到 HEAD、暂存区、工作区和全仓未跟踪文件清单；将基线 README 原文与最终 README 按原顺序逐字核对；查看当前 manifest 相对基线的可见增量。控制器来源事实只消费独立来源门交付的固定字段（任务、阶段、精确 HEAD、登记结果、提交结果），不读取隔离报告，也不以 Git 作者身份代替来源证明。

期望: 产品差异仅 README 且原文保留；除实际本任务流水线记录及控制器白名单来源增量外无越界文件；发布后的 manifest 可以有符合合同的真实新增行，历史行不变，任何其它改动判失败。QA 不要求重新制造发布前 manifest 零差异，也不把尚未发生的 CI、合并、Brain 终态、Learning 或预览回收判为本场景通过。

## 铁律对照

- INV-2fe86d34：S-3、Q-3 覆盖（运行回执和 Brain/GitHub 终态分别引用真实来源，不以 completed 标签冒充合并）。
- INV-b3a8bf82：S-3、Q-3 覆盖（区分任务账、运行回执与版本/合并事实，不重建平行真身）。
- INV-e5ab4826：S-3、Q-3 覆盖（诊断沿用既有仓库、任务和运行账坐标）。
- INV-02d8e749：S-4、Q-4 覆盖（保留后续真实 QA、独立裁判和最终合并门，不用文档验收替代）。
- INV-45cd3ec2：S-4、Q-4 覆盖（本次不改 smoke；后续生成回归 smoke 仍遵守未授权安全跳过的现行规则）。
- INV-ff177feb：不适用：已被 INV-45cd3ec2 撤销，本次不修改 smoke 退出码。
- INV-91e9abe3：S-4、Q-4 覆盖（只写文档，不改变 coding 执行通道或其他机器任务通道）。
- INV-0dc6b84f：不适用：本次不改模型配置或执行地。
- INV-ac7c8801：不适用：已由 INV-0dc6b84f 修订，本次不改模型配置。
- INV-751f73be：S-4、Q-4 覆盖（不启动无人值守 Claude 或生产 runner）。
- INV-09fb5c69：S-4、Q-4 覆盖（保留后续独立 QA，不以 CI 绿或文档对照取代真实验收）。
- INV-dc18d43d：S-3、Q-3 覆盖（文档只解释既有机械状态判据，不让模型改写生命周期）。
- INV-5e125909：S-1、Q-1 覆盖（目录由 CLI 参数或运行配置推导，不写死 QA 服务地址或路径）。
- INV-3c30394c：S-4、Q-4 覆盖（本次只断言真实 CLI 和文档；未发生的 PR/Brain 终态不标完成）。
- INV-564802ee：S-4、Q-4 覆盖（不读取、写入或输出凭据）。
- INV-459b6ff9：S-4、Q-4 覆盖（QA 仅使用自造无隐私回执，不复制生产日志）。
- INV-50954d28：不适用：未新增或修改 API 端点。

## 未覆盖真实链路

- 本次 QA 只在本 PR 工作树用自造回执真跑现有 CLI、核对最终 README 和发布后 Git 来源；不启动/安装 system LaunchDaemon、不领真实任务，不验证生产 runner 健康。缺少本任务授权的真实运行现场，QA 验到只读判读层。
- 自造 PR URL 不代表实际 GitHub PR；QA 验到“不能仅凭 completed 判合并”的诊断步骤，真实 PR/head 合并、Brain `runner.phase`/`merge`/QA 终态由后续控制器及外层 C01-C12 在事件发生后核验。
- 发布前 verify 的 manifest 零差异与精确来源提交由独立控制器来源门核验；发布后的 QA 只能读取当时真实 HEAD 增量，不能重演发布前状态。正式 CI、Learning 回读、下一次 tick 停预览也待相应阶段与外层终验。
