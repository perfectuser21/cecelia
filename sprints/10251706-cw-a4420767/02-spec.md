---
task_id: a4420767-a098-47e1-96ee-710eb033dd85
step: spec
upstream: ["01-intent.md#I-1", "01-intent.md#I-2", "01-intent.md#I-3", "01-intent.md#I-4"]
---

### S-1

对应：I-1。要改文件：`packages/brain/scripts/coding-workflow/runner/README.md`，在原文之间插入“提交编码任务”小节。给出可复制的单任务 JSON，含 `title`、`change_kind`、`map_scope_hint`、非空 `acceptance`、`repo: "cecelia"`、明确的 `gp_anchor`；示例可取现有合法 `F1` 与 `none(docs)`，不可发明地图 ID。给出在仓库根目录执行的 `node packages/brain/scripts/coding-workflow/new-task.mjs <单任务计划.json> --repo cecelia --dry-run`。说明单任务字段和 `repo` 优先级为任务自身、计划顶层、`--repo`、默认 cecelia，未知仓库拒绝；`change_kind`、`map_scope_hint` 必填；`base_sha` 如给，需先在所选目标仓只读核实为真实的 40 位 commit，`--dry-run` 自身只验 40 位小写十六进制格式、不查对象存在；预检退出 0 仅表示计划本地格式通过，不建 Brain 任务、不证明运行成功。实际比较依据为 `packages/brain/scripts/coding-workflow/new-task.mjs`、`packages/brain/scripts/coding-workflow/repos.json`、`packages/brain/src/impact-contract/change-kind.js`。验证：从最终 README 提取示例并按这些源码的字段与优先级逐项作可失败的静态断言；断言 `--repo cecelia --dry-run`、非建单与 SHA 边界同时出现，且不以执行预检代替断言。真实调用方 shape：这是给操作者调用的命令行，入口是 `node .../new-task.mjs <plan.json> [--dry-run] [--repo <仓库>]`，输入为 UTF-8 JSON 计划文件，无 HTTP header 或鉴权；依据是该脚本的 `parseArgs`、`validatePlan` 和 `main`。失败语义与输入对抗面：文件读不到、非法 JSON、缺字段、非法 `change_kind`/仓库/SHA、超长或重复输入由当前 CLI/Brain 原有规则处理；本地校验失败输出错误并退出 2，可修正计划后重试；预检不会保证真实提交成功，不在文档中许诺未实现的长度或并发保护。

### S-2

对应：I-2。要改文件：`packages/brain/scripts/coding-workflow/runner/README.md`。给出同一批次两个任务 JSON：第一条有 `key`，第二条 `depends_on` 引用前面该 `key`，顶层给 `project_id` 或 `project: {"name": ...}` 之一，所有任务限定 `repo: "cecelia"` 或由顶层继承；说明脚本先整体校验、再按序建单，`depends_on` 的 key 换成本批已建任务真实 ID。说明前向或未知依赖、重复 key、`project_id` 与 `project` 同给、带依赖却无项目都会拒绝。按 `packages/brain/scripts/coding-workflow/new-task.mjs` 和 `packages/brain/scripts/coding-workflow/runner/lib/deps.mjs` 写明领单现状：前置 `status=completed` 为必要条件；可定位 PR URL 且无 `result.merged=true` 捷径时，GitHub `MERGED` 就绪、`OPEN` 或未知等待、`CLOSED` 拒绝；无 PR URL 或 `result.merged=true` 会直接就绪，不能称所有前置必经 GitHub，也不能把任务 `completed` 当成真实合并证明；正常 coding 任务应保留真实 PR URL 供外部核验。验证：对 README 示例做 JSON 结构及引用顺序断言，对文字逐分支对照两份源码，尤其断言 `CLOSED`、无 PR URL、`result.merged=true` 三个边界。真实调用方 shape：同 S-1 的 `node .../new-task.mjs <批次计划.json> --repo cecelia --dry-run`；真实提交时去掉 `--dry-run`，脚本 `POST /api/brain/projects`（若选 `project`），再 `POST /api/brain/tasks`，`content-type: application/json`，任务 body 含 `task_type: coding_workflow`、`change_kind`、`repo_hint`、`map_scope_hint`、`project_id`、`payload.depends_on` 的真实 ID；依据是 `new-task.mjs` 的 `body`、`postJson`、`main`。失败语义与输入对抗面：重复 key、前向/未知 key、项目冲突在写入前报校验错误并退出 2；建单中途网络或 Brain 拒绝会退出 1，已写的记录仍须按 S-3 核账，不能并发或重复整批提交来猜结果；不新增 CLI 限长或并发机制。

### S-3

对应：I-3。要改文件：`packages/brain/scripts/coding-workflow/runner/README.md`。说明去掉 `--dry-run` 才会向 Brain 写项目和任务；脚本按序返回 `[{key,id,title}]`，中途失败的 `已建` 数组含先前成功项，`task_route_mismatch` 错误对象自身也可能带一个已创建 `id`。操作者须把失败对象 ID 与 `已建` 数组合并后逐 ID 只读查 Brain，确认实际存在和路由，再决定只处理未建项，不能盲目整批重跑；不把返回码、回执 `completed` 或 `task.status=completed` 当成 PR 已合并。保留 README 现有“运行回执如何判读”、安全边界与文末 A12 FAQ 的全部原字节和相对顺序，不复制旧失败 PR6635 的提交章节，不引用旧任务 UUID/PR 充作本轮结果；说明本次仅写手册、不执行建单、不访问生产。验证：读取固定基线 `9834f4852ce3436252222b1fdfaf9d72e72bad24:packages/brain/scripts/coding-workflow/runner/README.md` 与最终 README 的原始字节，只允许在原有顶层 `##` 小节之间插入完整“提交编码任务”小节；删除新增小节后必须与基线逐字节相等，且其前后原有段落、表格、代码块和命令均为连续原字节，原小节顺序不变。断言原命令 `status.mjs [--log-dir <dir>] [--json]` 及所在代码块完整一致，任何命令内部插字均失败；不要求整篇原文在含新增小节的最终 README 中连续出现。再对照 `new-task.mjs` 的正常输出、普通失败与 `task_route_mismatch` 分支作可失败断言。真实调用方 shape 与失败语义、输入对抗面沿用 S-2；此处特别要求文档展示失败响应原文与退出码含义，网络超时或重复请求的实际写入状态未知时先按返回 ID 和只读账本核查，未查清不能重试整批。

### S-4

对应：I-4。产品要改文件仅 `packages/brain/scripts/coding-workflow/runner/README.md`；本规格与后续报告由流水线写入 `sprints/10251706-cw-a4420767/` 的合法 Markdown 路径，受控来源清单 `.implementation-source-relations.json` 只允许可信控制器按 I-4 的路径、`owner_path=packages/brain/scripts/coding-workflow/runner/run-once.mjs`、`role=documentation` 追加准确的当前任务来源行，模型不得编辑、暂存或提交。发布前 verify 使用固定 initial base `9834f4852ce3436252222b1fdfaf9d72e72bad24` 到当时 HEAD 的完整提交和路径清单，加 `git diff --cached`、`git diff`、`git ls-files --others --exclude-standard` 的全仓未跟踪清单；先全仓枚举，随后只按实际本任务流水线记录路径排除，不能先把枚举限制在 README。基线 README 按 S-3 的原字节和顺序保留；发布前 `.implementation-source-relations.json` 对固定基线零差异；任何自产程序、测试、配置、模式、删除、越界文件或先改后 revert 均失败。verify 只读 01-intent 与真实 Git/源码，不读其它 sprint 报告；其阶段可信控制器临时隐藏的 `03-build.md` 按原生隐藏事实解释，不误报漏产。验证：由发布前 verify 当场原生运行 `git rev-list --parents 9834f4852ce3436252222b1fdfaf9d72e72bad24..HEAD` 和 `git diff --name-status 9834f4852ce3436252222b1fdfaf9d72e72bad24 HEAD`；对清单中每个提交分别读取全部父 SHA，并对每条父子边运行 `git diff-tree -r --raw --no-commit-id <父> <提交>`，逐父核全路径、blob 和 mode，合并提交不省略第二父；只对产品 README 与受控 manifest 运行 `git diff --binary --full-index <父> <提交> -- packages/brain/scripts/coding-workflow/runner/README.md .implementation-source-relations.json` 核正文；不对其它 sprint 报告输出补丁或提取正文，03 的原字节和模式由当时可信隔离及来源证据核实；另运行上述 staged/worktree/untracked 命令并先保留全仓清单。完整原生命令、输出及退出码由当时控制器留存，核每次中间改动的归属、允许路径和 README 原文；`new-task.mjs` 即使后续提交撤销也失败。不可用后来的干净 HEAD 代替当时现场。发布、QA、judge、Commander、正式 CI、合并、Learning、预览回收在实际发生后由各自控制器门与外层 C01–C12 继续核验，不提前判通过。

### S-5

对应：I-4、I-3。要改文件仍仅 `packages/brain/scripts/coding-workflow/runner/README.md`，正常流水线报告和可信来源增量遵守 S-4，不能为本条修改程序、测试或历史报告。发布后 QA 在当前精确测试 HEAD 和 PR 预览身份上，只读最终 README、固定 initial base 到当前 HEAD 的完整 DAG、逐提交及逐路径全量元数据差异、当前暂存区、工作区与全仓未跟踪文件；只对 README、受控 manifest 读取 Git 正文，对当前及历史 03/04 只核路径、blob、mode 和本轮可信来源投影；受保护报告的原字节、模式及内容归属由可信 source gate 和会话后裁判核实，缺证不通过。用允许读取的 Git 内容和本轮可信控制器提供的固定字段来源投影核验本任务自产仅有 README、合法本轮 Markdown 报告和准确受控来源增量。不得把发布前 manifest 零差异重新套在发布后，不得把 main 差异从最终 diff 简单相减，不得更换 initial base、拿本地同名 main ref/哈希/模型自述当来源。若有可信 main 同步，独立 source gate 还须从最早真实 intent 输入 HEAD 重验 registration→stage→native 来源链、每个同步提交精确两父及共同基线、前后独立实际 main ref 的 `gh pr view`/`git ls-remote` 原生事实、逐 blob 和 mode 的完整 tree、受保护 local_controller_merge_only 凭证、manifest 的确定性合并与历史条目；上游碰本任务 README 或报告、改后 revert、身份/树/路径不唯一、缺凭证均失败。该凭证不证明 push、QA/CI 或 GitHub 已合并；remote_pre_push、旧批准撤销、push、远端 HEAD、正式 CI、实际 merge 均交实际后续门只读核实。QA 只接收投影，不读取保护凭证根；投影缺失或与 Git/HEAD 不一致即不能验，不重跑控制器造证。QA 会话内只核本轮控制器提供的 `03-build.md`、`04-evidence.md` 临时隐藏事实和当前可见工作区，明确记录原字节/模式恢复尚未发生，不自行重建或提前宣布恢复完成。QA 会话结束后控制器原字节、原模式完整恢复；独立裁判再核绑定本轮 task、轮次、测试 HEAD、原生会话及恢复的保护凭证，第三文件异常或任何缺证均失败。控制器将本轮全部真实原生命令、完整实际捕获输出、退出码按顺序进入最终 05 报告，含失败、修正、重复、重测和零字节输出；保留模型原稿与 FAIL/CANNOT_VERIFY 语义，不能把 `aggregated_output` 冒称已证明任意子命令 stdout/stderr 未截断。历史失败及原件保留，旧 A/A2–A7、旧 B/PR6635 不修补、不追认；A11 历史成功不能替代 A12/B12。每个新 HEAD 重新真实 QA、裁判、预览和正式 CI；后续实际合并、Brain 终态、Learning ID 与全文哈希回读、下一真实 tick 停预览清 pending 由外层终验分别核实，A12 与 B12 各自完整闭环才计 C12。验证：QA 执行 Q-4 的只读 Git/README/来源检查，并逐父检查固定 initial base 至当前 HEAD 的每次提交；独立 source gate、会话后裁判与终态观察按本段各自真实阶段执行并留原生证据，不把当前 QA 可见结论扩成完整闭环。纯文档改动按原规则记录没有有效 API 回归 smoke 的事实，不伪造 smoke 或免除预览身份检查。

## QA 场景

### Q-1

对应: I-1
前提: 本 PR 预览身份已由控制器授予，QA 只读当前测试 HEAD 的 README 与同 HEAD 的 `new-task.mjs`、`repos.json`、`change-kind.js`；无需业务数据。
操作: 在预览版本对应的仓库只读打开 README 的“提交编码任务”单任务示例，逐字段抄录其 JSON 与命令；用 `rg -n 'validatePlan|parseArgs|dryRun|invalid_base_sha|repo_unknown' packages/brain/scripts/coding-workflow/new-task.mjs` 对照真实入口，再查 `repos.json` 和 `change-kind.js` 的合法值。不执行 `new-task.mjs`，不提交任务。
期望: 示例确有 `title/change_kind/map_scope_hint/acceptance/repo/gp_anchor`，repo 为 cecelia，命令确含 `--repo cecelia --dry-run`；文字准确说明优先级、必填、`base_sha` 的实际 SHA 须另核而预检只验格式，且预检不建单、不证明运行成功；任一字段、命令或边界缺失即失败。

### Q-2

对应: I-2
前提: 与 Q-1 同一当前 HEAD 的只读文件；无需已有项目或任务。
操作: 打开 README 的两任务批次 JSON，按 JSON 结构逐项核第一条 `key`、第二条 `depends_on` 引用顺序、顶层恰有 `project_id` 或 `project`；只读对照 `new-task.mjs` 的 `validatePlan/body/main` 与 `runner/lib/deps.mjs` 的 `depState`。逐个查找前向未知 key、重复 key、项目冲突、无项目依赖、`OPEN`/未知、`CLOSED`、无 PR URL、`result.merged=true` 的文字解释。
期望: 两任务示例结构可按源码解释；上述非法输入明确会拒绝而非静默建单；`completed` 必要但不等于真实合并，有 URL 且无捷径才查 GitHub，`MERGED` 就绪、`OPEN`/未知等待、`CLOSED` 拒绝，两个直接就绪分支如实写出；缺一或把分支改写成“一律查 GitHub”即失败。

### Q-3

对应: I-3
前提: 当前 HEAD 的 README、固定基线 README 与 `new-task.mjs` 可只读取得；本场景不使用生产 Brain 或历史失败 PR 内容。
操作: 阅读 README 真实提交和失败核账段；分别按脚本正常输出、普通中途失败、`task_route_mismatch` 三处源码核对 IDs 来源；用 `git show 9834f4852ce3436252222b1fdfaf9d72e72bad24:packages/brain/scripts/coding-workflow/runner/README.md` 取得绑定基线原文，定位最终 README 新增的完整顶层小节，移除它后作与基线逐字节相等的可失败断言；另核 `status.mjs [--log-dir <dir>] [--json]` 原命令及代码块未被拆开，“运行回执如何判读”和文末 FAQ 顺序仍在。
期望: 文档说明去掉 `--dry-run` 会写 Brain，普通失败查 `已建` IDs，路由不符还查失败对象自身 ID，未知写入先核账、不盲重跑；新增小节仅插在原顶层小节边界，原 README 段落、表格、代码块和命令原字节连续且顺序不变，命令中插字会令断言失败；旧失败 PR6635 不被当成当前 main 或本次实跑证据。

### Q-4

对应: I-4, I-3
前提: QA 已取得本轮控制器授予的预览地址与测试 HEAD、可信同步事实投影及本轮 03/04 临时隐藏事实；固定 initial base 为 `9834f4852ce3436252222b1fdfaf9d72e72bad24`，不是 QA 自造。缺预览身份或投影时记录 CANNOT_VERIFY。
操作: 在受控 QA 会话用 `curl -fsS '<预览环境>/api/brain/health'` 只读核 `git_sha` 等于当前测试 HEAD；在本 PR 工作树执行 `git rev-list --parents 9834f4852ce3436252222b1fdfaf9d72e72bad24..HEAD`、`git diff --name-status 9834f4852ce3436252222b1fdfaf9d72e72bad24 HEAD`、`git diff --cached --name-status`、`git diff --name-status`、`git ls-files --others --exclude-standard`，先记录全仓原始清单；再对 `git rev-list --parents` 列出的每个提交、每个父 SHA 分别只读运行 `git diff-tree -r --raw --no-commit-id <父> <提交>`，逐父核全路径、blob 和 mode；只对产品和来源清单运行 `git diff --binary --full-index <父> <提交> -- packages/brain/scripts/coding-workflow/runner/README.md .implementation-source-relations.json` 核正文，03/04 及其它 sprint 报告不输出补丁、不从 Git 提取正文，合并提交检查两个父边，再与 README 正文、合法本轮 Markdown 的路径元数据、受控 manifest 来源行和可信投影比对。只用逐父 blob/mode 元数据核历史报告未改，原字节由可信来源门和会话后裁判核实；对本轮隐藏的 03/04 仅据控制器本轮事实解释可见缺口，不读取保护根、不重建文件、不读旧 QA 自述，也不要求此时核未来恢复。
期望: 预览 SHA 与本轮测试 HEAD 精确一致；完整 DAG 每条父子边及全仓清单均可唯一归属；曾修改 `new-task.mjs` 再撤销也会从逐提交元数据被检出并拒绝，产品仅 README，报告与来源增量只在许可的本轮路径及精确 owner/role，历史字节和模式未被自产改写。若有 main 同步，只有投影与实际 Git 一致且独立 source gate 已证明严格两父、真实 main ref、完整 tree、受保护 merge 与来源链时才归上游；缺证、上游碰产品/报告、先改后 revert、第三文件异常一律不能通过。QA 只声明当前可见范围和本轮临时隐藏事实，明确恢复尚未发生；本轮所有实际 QA 原生命令的完整捕获输出与退出码须由控制器日后按序编入 05 全账，不由 QA 提前声称会话后恢复、正式 CI、GitHub 合并或终态成功。

## 铁律对照

- INV-e5ab4826：S-3、S-5、Q-4 覆盖（任务写 Brain、运行与版本证据留原有账，不另造平行真身）。
- INV-696c9f96：S-4、Q-4 覆盖（只使用现行 coding workflow 身份，不把旧代际记录当本轮结果）。
- INV-02d8e749：S-5、Q-4 覆盖（文档任务不缩减独立 QA、裁判、预览及后续真实闭环）。
- INV-c906dd6c：S-1、S-5、Q-1 覆盖（断言须可失败且核真实命令语义，不用伪绿预检或空 smoke）。
- INV-f200769d：S-4、S-5、Q-4 覆盖（后续真实执行保留原生命令、完整输出与退出码，不能凭摘要判 PASS）。
- INV-26886b60：S-5、Q-4 覆盖（后续合并以精确测试 HEAD 及真实裁判、CI、远端事实核对）。
- INV-dc18d43d：S-4、S-5、Q-4 覆盖（模型只编写文档和规格，生命周期与来源由控制器及 Brain 原生事实判定）。
- INV-09fb5c69：S-5、Q-4 覆盖（CI 绿不能代替独立产品 QA 与裁判）。
- INV-7ccfa168：S-5、Q-4 覆盖（本轮任务顺序推进，A12 历史或其它任务不能替 B12 收口）。
- INV-5e125909：S-1、S-5、Q-1、Q-4 覆盖（repo、SHA、预览身份来自真实配置和只读事实，不假定环境值）。
- INV-3c30394c：S-5、Q-4 覆盖（当前 QA 只报已真验的文档与 Git 事实，其它接缝待实际阶段核验）。
- INV-564802ee：S-1、S-3、Q-1 覆盖（文档示例无真实密钥，QA 不读取或记录凭据）。
- INV-50954d28：不适用：没有新增或修改 API 端点；QA 只读既有受控预览健康端点。
- INV-52f1801e：不适用：本任务不安装仓库依赖或运行 `npm ci`。
- INV-e2551d59：不适用：本任务不修改 runner 镜像或摘要。
- INV-5775d866：不适用：本任务不判定生产部署是否变更；Q-4 只核本轮预览自报 SHA。
- INV-1100cb8f：不适用：本任务不修改 harness-generator 或共享 CI 基础设施文件。

## 未覆盖真实链路

- 真实 `new-task.mjs --dry-run` 和无 `--dry-run` 建单、Brain 持久化及 runner 领单：本次 QA 按 I-1 至 I-3 只读 README 与真实源码并执行可失败的静态断言；命令不在当前 evaluate 许可内，也不访问生产，未验真实建单或 GitHub 依赖查询。
- 发布前 verify 当时的暂存区、工作区和全仓未跟踪现场：当前发布后 QA 仅核固定 Git 历史及当前现场；过去现场须由当时 verify 原生命令、完整输出、退出码和外层独立核验承担，缺证不能补演通过。
- 本轮 03-build/04-evidence 的会话后原字节及模式恢复、完整 05 原生全账：当前 QA 仅核本轮临时隐藏事实和当前可见范围；实际恢复及报告装配须在会话后由可信控制器、独立裁判核实，缺证不得判完整通过。
- 可信 main 同步的保护凭证根、registration→stage→native 全链及逐 blob/mode 全 tree：QA 仅以固定字段投影和实际 Git 核对；独立 source gate 必须真实核验原始受保护事实，缺投影或 gate 结论时 QA 如实 CANNOT_VERIFY。
- 后续新 HEAD 的重跑 QA/裁判/预览/正式 CI、远端合并、Brain 终态、Learning 全文回读及下一 tick 预览回收：当前 QA 验到当前测试 HEAD 的预览身份和文档/范围；这些未来事件由实际控制器与外层 C01–C12 在发生后逐项核验，A12/B12 未双闭环前不能报 C12 成功。
