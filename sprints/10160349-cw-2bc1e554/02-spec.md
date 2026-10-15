---
task_id: 2bc1e554-43fa-47f9-9ef4-8ab8b6c5baf3
step: spec
upstream: ["01-intent.md#I-1", "01-intent.md#I-2", "01-intent.md#I-3", "01-intent.md#I-4"]
---

# 运行回执判读手册实现规格

### S-1
对应: I-1

仅在 `packages/brain/scripts/coding-workflow/runner/README.md` 的现有运行状态说明附近新增“运行回执如何判读”：给出 `node packages/brain/scripts/coding-workflow/runner/status.mjs --log-dir <回执目录>` 和附加 `--json` 的实际用法；说明省略 `--log-dir` 时用 `CODING_WF_LOG_DIR` 或运行用户 home 下的默认目录，行按 JSON 文件 mtime 倒序。目录不存在或没有可列的 JSON 时，JSON 模式输出 `[]`，文本模式显示“没有运行记录”；二者只表示没有记录，不能推出服务健康。

真实调用方 shape：操作者直接运行上述 CLI，参数为 argv 中的 `--log-dir <目录>`、`--json`，没有 HTTP header、body 或鉴权；出处：`packages/brain/scripts/coding-workflow/runner/status.mjs` 的 `parseArgs/main` 与当前 README 的“无领单健康与运行状态”。失败语义及输入对抗面：目录不存在仍以退出码 0 输出空结果，需另查服务和主日志；目录里重复名称在文件系统层不能并存，同一文件更新后按新 mtime 排序；本次不改变 CLI 对非法参数、超长路径、并发改写或读取错误的既有行为，手册不得许诺源码没有的报错或健康结论。

验证：在临时目录写入两个有明确不同 mtime 的终态 JSON，执行上述文本与 JSON 命令，断言两种输出均为新文件在前；对不存在目录执行 `--json` 并断言精确为 `[]`。最终 README 中的命令和解释须与 `status.mjs`、`lib/config.mjs` 源码逐项一致。

### S-2
对应: I-2

只改 `packages/brain/scripts/coding-workflow/runner/README.md`。按 `status.mjs`、`lib/receipt.mjs` 和 `lib/cifix-scan.mjs` 的现行逻辑解释：可解析的 JSON 对象只要有 `last_event` 属性就显示 `running`；否则只要 `status` 是 `completed`、`partial` 或 `failed` 就按终态判读，不校验任务 ID、活动等回执字段。后两种终态从首个未完成且未跳过的 activity 取 `failed_activity`，`reason_code` 优先取该 activity 最后一次尝试；解析失败、值不是对象，或对象既无 `last_event` 又无上述终态 `status`，才显示 `unreadable`。`status.mjs` 扫描目录内除 `cifix-<数字>.json` 外的所有 `.json`，所以合法 qa/commander 状态文件和 `pr-sync-pending.json` 也可能显示 `unreadable`；带终态 `status` 的非回执 JSON 甚至可能显示 `completed` 等标签。不能仅凭标签断定文件确为任务回执、认定文件损坏、删除现场或删除终态回写待办。只有判读出的 PR URL 可提取 PR 编号且存在对应 cifix 状态时，才显示 `ci_fix` 的尝试次数和 `last_result`；没有则为 null 或文本行不显示。

真实调用方 shape：同 S-1 的只读 CLI argv；ci_fix 读取本地 `cifix-<PR号>.json`，不向 GitHub 或 Brain 发请求。失败语义及输入对抗面：坏 JSON 显示 `unreadable`；合法非回执 JSON 则按上述最小字段条件分类，单条坏文件不阻止其他条目列出。重复运行只读；对并发改写造成的瞬时不可解析不得建议清理文件，可重读并结合源文件用途排查。

验证：用独立临时目录分别造进度快照、三种终态、坏 JSON、qa/commander 状态、`pr-sync-pending.json`、带终态 `status` 的极简非回执 JSON 和关联 PR 的 cifix 状态，执行 CLI `--json`，断言各分类、`failed_activity`、`reason_code`、`ci_fix.attempts`、`ci_fix.last_result` 与源码一致，并断言 cifix 状态文件本身不出任务行。

### S-3
对应: I-3

只改 `packages/brain/scripts/coding-workflow/runner/README.md`。明确 `summarizeReceipt` 对 `completed` 且没有 `outputs.pr_url` 仍返回 `status=completed`、`reason_code=pr_url_missing`，而 `formatStatus` 的 completed 文本行通常不打印该 reason；因此指导操作者用 `--json` 检查 `pr_url`。即使 PR URL 存在，也须只读核对 GitHub 对应 PR 的最终 head SHA 和合并状态、Brain 中同一任务的 `runner.phase=merged`、`merge.merged=true` 及 QA 终态，再判断完整成功。诊断不得手工改批准或 FAIL 记录，也不得把回执状态当作合并授权。

真实调用方 shape：README 的本地入口仍是 S-1 的 CLI；后续 GitHub/Brain 核对是操作者按既有权限只读查看同一 PR/任务，不新增接口调用方、header 或写入请求。失败语义及输入对抗面：缺 PR URL、PR 未合并、head 不匹配、Brain/QA 未达终态或只读查询失败时均不得写“已最终成功”；重复查看不改变状态，恶意或过长的 PR URL 不直接作为成功依据，须以真实 PR/head 回读为准。

验证：临时目录写入无 PR URL 的 completed 回执，执行文本与 `--json`，断言 JSON 有 `reason_code=pr_url_missing`、`pr_url=null`，文本虽为 completed 却不显示该 reason；逐句检查 README 将最终合并判据与回执判据分开。

### S-4
对应: I-4

产品文件只允许 `packages/brain/scripts/coding-workflow/runner/README.md`；新增小节，基线 README 原文逐字保留。发布前只读范围检查以固定 `52a9476e014f540d418014e7062ca66a72f38709` 为 base：联合 `git diff --name-only <base> HEAD`、`git diff --cached --name-only`、`git diff --name-only`，并从仓库根执行 `git ls-files --others --exclude-standard` 先完整枚举未跟踪文件，再仅按实际本任务 sprint 流水线记录路径排除。发布前 `.implementation-source-relations.json` 相对该 base 零差异；不因 `03-build.md` 在 verify 时暂时隐藏而误判。verify 只读本次 `01-intent.md` 和真实仓库/源码，不以其它 sprint 报告替代证据。

发布后的 QA/evaluate 不再要求 manifest 零差异；只接受可信 publish、QA、Commander 控制器在 `.implementation-source-relations.json` 前部为本任务真实 Markdown 报告增加的准确来源行，`owner_path=packages/brain/scripts/coding-workflow/runner/run-once.mjs`、`role=documentation`、路径属于本任务实际 sprint，历史条目逐字不变，幂等且冲突拒绝。模型不直接编辑、暂存或提交 manifest；不得为未发生阶段编造报告。流水线真实报告、原生命令与输出、退出码、精确 HEAD 批准、正式 CI 及后续外层终验继续按原合同执行，不以本次文档验收替代。

验证：发布前执行上述四类 Git 枚举，断言产品改动集合只有 README、基线原文为最终 README 的逐字连续内容、manifest 与 base 相同；发布后按实际生成的来源行逐条核对路径、owner、role、任务归属、历史不变和最终 HEAD，任何越界文件或伪造来源均失败。

## QA 场景

以下命令在本 PR 的检出目录运行，只读产品仓库；临时样本放系统临时目录，运行完清理。无需访问生产 Brain。涉及预览 Brain 的后续真实链路仅使用 `<预览环境>/api/brain/...`，本轮不写接口请求。

### Q-1
对应: I-1

前提: QA 在本 PR 检出目录自行建立全新临时回执目录，写入 `older.json` 与 `newer.json` 两个 `status=completed` JSON，并用 `touch -t` 使后者 mtime 晚一分钟。

操作: 执行 `node packages/brain/scripts/coding-workflow/runner/status.mjs --log-dir "$临时目录"`，再执行同命令加 `--json`；阅读 README 新小节中的两种命令和排序说明。

期望: 两种输出里 `newer` 均在 `older` 前，JSON 是数组；README 对 `--log-dir`、`--json`、mtime 倒序的描述与可见行为一致。

### Q-2
对应: I-1

前提: QA 自行建立一个空临时目录，并在其下指定一个从未创建的子目录。

操作: 分别对空目录和不存在的子目录执行 `node packages/brain/scripts/coding-workflow/runner/status.mjs --log-dir <该目录> --json`，并对不存在目录执行文本模式；阅读 README 空结果说明。

期望: 两次 JSON 输出均精确为 `[]` 且退出码 0，文本提示“没有运行记录”；README 明示这不是服务健康证明。

### Q-3
对应: I-2

前提: QA 自行建立全新临时目录并写入 `running.json`（含 `last_event`）、`completed.json`（终态且含 PR URL）、`partial.json` 和 `failed.json`（各含一个失败 activity 及最后尝试的 `reason_code`）。再按 completed 中的 PR 编号写入 `cifix-<编号>.json`，`attempts` 含两次不同 result。

操作: 执行 `node packages/brain/scripts/coding-workflow/runner/status.mjs --log-dir "$临时目录" --json` 并阅读 README 的状态/CI 修复摘要说明。

期望: 四条回执分别是 `running/completed/partial/failed`；partial、failed 的失败活动与最后一次原因可见；completed 的 `ci_fix` 是次数 2 和最后一次 result；`cifix-<编号>.json` 不作为任务行出现。

### Q-4
对应: I-2

前提: QA 自行建立全新临时目录，写入一条有效 completed 回执、一份语法错误的 `.json`、各一份不含 `last_event` 或终态 `status` 的合法非回执 `qa-state.json`、`commander-state.json` 和 `pr-sync-pending.json`，再写入极简非回执 `minimal.json`，内容为 `{"status":"completed","outputs":{}}`。

操作: 运行 `node packages/brain/scripts/coding-workflow/runner/status.mjs --log-dir "$临时目录" --json`，随后按 README 的提示判读每一行，保留所有原文件。

期望: 坏 JSON 与三种无判读字段的非回执 JSON 显示 `unreadable`，有效回执仍可显示；`minimal.json` 显示 `completed`、`reason_code=pr_url_missing`，但不能由此认定它是真任务回执。README 明确 `unreadable` 不能单独作为损坏或删除依据，并点名不得删除 `pr-sync-pending.json` 待办。

### Q-5
对应: I-3

前提: QA 自行建立全新临时目录并写入 `no-pr.json`，内容为 `{"status":"completed","outputs":{}}`；该样本不对应真实 PR。

操作: 对该目录分别运行 status CLI 文本模式和 `--json` 模式，按 README 中的步骤尝试判定是否已最终成功。

期望: 文本出现 completed 而不展示 `pr_url_missing`；JSON 保持 `status=completed`，同时显示 `reason_code=pr_url_missing`、`pr_url=null`。README 要求继续核实 PR URL、GitHub 最终 head/合并状态、Brain `runner.phase`、`merge.merged`、QA 终态，不能因文本 completed 宣告已合并或手工改批准/FAIL。

### Q-6
对应: I-3

前提: QA 自行建立全新临时目录，写入一个 completed 回执，`outputs.pr_url` 使用 QA 自造的、尚未合并的示例 PR URL；不要求环境中已有真实 PR。

操作: 运行 status CLI `--json` 并按 README 的判读步骤检查该 URL 是否足以宣告最终成功。

期望: JSON 可显示 PR URL，但 README 明确仅有 URL 仍不足以判成功；无法回读对应真实 PR/head、Brain 和 QA 终态时结论为“尚未核实”，不把虚构 URL 当已合并。

### Q-7
对应: I-4

前提: QA 使用本 PR 的检出目录和固定 base SHA；临时状态文件由 QA 自行创建在系统临时目录，不使用已有业务数据。

操作: 从仓库根分别运行 `git diff --name-only 52a9476e014f540d418014e7062ca66a72f38709 HEAD`、`git diff --cached --name-only`、`git diff --name-only`、`git ls-files --others --exclude-standard`；先查看未跟踪文件全集，再仅排除本任务真实流水线记录路径。用 `git show 52a9476e014f540d418014e7062ca66a72f38709:packages/brain/scripts/coding-workflow/runner/README.md` 获取基线原文并与当前 README 比对；查看 manifest 相对 base 的实际差异及每条新增来源所指报告。

期望: 产品文件差异仅 README，基线 README 全文逐字保留；本轮 QA 已处于发布后，manifest 允许且仅允许本任务可信控制器为实际报告添加的精确来源行，历史不变、owner/role/路径合法；不得将发布前零差异条件错误套用于此时。发现越界或伪造来源即失败，不用 CI 绿替代此核对。

## 铁律对照

- INV-2fe86d34：S-3、Q-5 覆盖（回执与最终运行、合并、QA 事实分开判读）。
- INV-b3a8bf82：S-3、S-4、Q-7 覆盖（任务、运行、版本与合并证据各取其真实来源）。
- INV-e5ab4826：S-4、Q-7 覆盖（文档归现有仓库与流水线记录，不新增平行账本）。
- INV-02d8e749：S-3、S-4、Q-5、Q-7 覆盖（保留真实 QA、独立裁判与合并终验，不以回执 completed 缩减关卡）。
- INV-696c9f96：S-3 覆盖（明确本手册是现行 coding runner 的回执判读，不混用其它 Commander 代际）。
- INV-91e9abe3：S-4、Q-7 覆盖（仅写手册，不改 coding 执行机器或模型通道）。
- INV-3c30394c：S-3、Q-5、Q-6 覆盖（未真查 PR/Brain/QA 的最终接缝时不宣称 done）。
- INV-564802ee：S-1、Q-1 覆盖（样本仅用无凭据的本地 JSON，不在文档、命令或日志写密钥）。
- INV-26886b60：S-3、Q-5 覆盖（最终成功要核对实际 PR head 与裁决所依附的版本）。
- INV-09fb5c69：S-3、S-4、Q-7 覆盖（CI 绿不能代替逐条产品及范围验收）。
- INV-45cd3ec2：不适用：本次不新增或修改 smoke 及其生产写入保护逻辑。
- INV-ff177feb：不适用：该条已被 INV-45cd3ec2 撤销，本次也不涉及 smoke 退出码。
- INV-50954d28：不适用：本次不新增或修改 API 端点。

## 判定点

- 回执 completed 是否代表最终成功｜候选: 只看文本状态、JSON 加 GitHub/Brain/QA 回读｜所选: JSON 加 GitHub/Brain/QA 回读｜依据: `summarizeReceipt` 可对缺 PR URL 仍返回 completed，文本默认隐藏该 reason｜误判后果: 将未建 PR 或未合并任务误报完成。
- unreadable 是否代表现场损坏｜候选: 仅看标签、结合文件用途与 JSON 结构｜所选: 结合文件用途与 JSON 结构｜依据: `status.mjs` 扫描所有非 cifix 的 JSON｜误判后果: 误删合法 QA/Commander 状态或 `pr-sync-pending.json` 待办。

## 未覆盖真实链路

- 本次 QA 使用自行创建的本地回执验证真实 CLI 和 README；不触发真实 coding 领单、GitHub PR 合并、Brain 终态回写或下一次 tick 预览回收。QA 验到只读判读和本 PR 文件/来源范围；这些运行链路由后续既有控制器与外层 C01-C12 在实际发生后核验，未发生不得宣称通过。
- 发布前 I-4 的 manifest 零差异和 `03-build.md` 暂时隐藏状态只由发布前 verify 在当时现场核实；本轮发布后 QA 只能回查当时原生证据及核对当前可信来源增量，不伪造发布前状态。
