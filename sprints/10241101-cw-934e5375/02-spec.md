---
task_id: 934e5375-aac6-405e-8fad-57ecc9a8349d
step: spec
upstream: ["01-intent.md#I-1", "01-intent.md#I-2", "01-intent.md#I-3", "01-intent.md#I-4"]
---
# 运行回执判读手册实现规格

### S-1
对应：I-1。只改 `packages/brain/scripts/coding-workflow/runner/README.md`，在现有安装、安全与预览说明之间插入“运行回执如何判读”小节，保留原文字节和顺序。写明 `node packages/brain/scripts/coding-workflow/runner/status.mjs --log-dir <回执目录>` 与 `--json` 可组合使用；省略目录时取 `CODING_WF_LOG_DIR` 或运行用户 HOME 下的默认日志目录。结果按每个 JSON 文件的 mtime 倒序，非任务完成时间。目录不存在、无可扫描回执或当前账号无权读取目录时，文本同样输出“没有运行记录（目录）”、JSON 同样输出 `[]`；这只表示 CLI 未列出记录，不能断定目录实际为空或服务健康。手册指示只读检查目录路径、运行账号及目录读取权限，必要时由有权账号重查。依据：`status.mjs` 的 `parseArgs`、`collectStatus`、`main` 与 `lib/config.mjs` 的 `logDir`。

验证：用 `node packages/brain/scripts/coding-workflow/runner/status.mjs --log-dir <自建空目录> --json` 断言 stdout 为 `[]`；在自建临时目录写两个终态 JSON、设置不同 mtime，再运行同一命令断言倒序。另以实际无目录读取权限的账号运行同一 CLI，确认 JSON `[]` 与文本“没有运行记录”均不能区分权限失败和空目录；由有权账号只读重查能看到回执。逐项核对 README 的命令、歧义说明及原文保留。真实调用方 shape：运维人员在仓库根以 Node CLI 运行 `status.mjs [--log-dir <dir>] [--json]`，参数通过 argv 传入；该 CLI 无 HTTP 方法、header、body 或鉴权字段，操作系统文件读取权限决定能否读目录。出处：`README.md`“无领单健康与运行状态”现有示例和 `status.mjs` 的 `main`。失败语义与输入对抗面：缺失、空或不可读目录都返回空结果，可重复只读查询；不可读或非法 JSON 单文件见 S-2；不宣称 CLI 对未知参数、超长路径或并发写入提供额外校验和稳定快照。

### S-2
对应：I-2。只改同一 `README.md` 小节，按 `status.mjs`、`lib/receipt.mjs`、`lib/cifix-scan.mjs` 的现行行为解释：有 `last_event` 的对象为 `running`；终态 `completed`、`partial`、`failed` 的状态、首个未完成且未跳过活动的 `failed_activity`、末次尝试优先的 `reason_code`；不能解析或不符合回执形状的 JSON 为 `unreadable`。`completed` 缺 `outputs.pr_url` 时仍是 `completed`，JSON 带 `reason_code=pr_url_missing`，文本行默认不显示该原因，必须查 `--json` 和 `pr_url`。`ci_fix` 只在 PR URL 能解析 PR 编号且有 `cifix-<编号>.json` 尝试时显示次数与最后一次 `result`，否则为 null/不显示。扫描范围是目录内所有 `.json` 普通文件，唯独排除 `cifix-数字.json`；合法 qa/commander 状态文件和 `pr-sync-pending.json` 也可能显示 `unreadable`，这不是损坏或删除依据，尤其不能删除终态回写待办。

验证：在自建目录分别写进度、三种终态、缺 PR URL 的 completed、非回执 JSON、`pr-sync-pending.json`、`cifix-7.json`，运行 `node packages/brain/scripts/coding-workflow/runner/status.mjs --log-dir <目录> --json` 和文本模式，逐项断言 README 与实际字段、过滤和显示一致。真实调用方 shape 同 S-1。失败语义与输入对抗面：坏 JSON、非回执 JSON、部分写入中的文件会呈 `unreadable`，可在写入稳定后重查，不清理现场；同一目录重复运行不改数据。文档不把 `unreadable` 升格为服务故障或删除指令。

### S-3
对应：I-3。只改同一 `README.md` 小节，清楚区分本地回执 `completed`、PR 已建立和 PR 已最终合并。给出只读核对顺序：从 `--json` 取得非空 `pr_url`，用 GitHub PR 查询核对目标 PR、最终 head 和 merged 事实，再按任务 ID 向该任务实际所属 Brain 的 `GET /api/brain/tasks/<task_id>` 查询终态，核实 `runner.phase=merged`、`merge.merged=true` 及 QA 终态。预览地址仅供当前 PR/head 获授权的 QA 会话使用；预览关闭后不得拿它作为最终成功诊断目标。任何一项缺失、冲突或仍待处理，都不能仅凭 `completed` 宣告最终成功；只诊断，不手工改批准或 FAIL 记录。本轮产品 QA 不调用生产，真实远端最终合并和实际 Brain 终态由后续控制器及外层终验核实。

验证：用 S-2 的缺 PR URL completed 实例运行 CLI，断言 JSON 的 `status=completed`、`pr_url=null`、`reason_code=pr_url_missing` 与文本行只显示 completed；人工对照 README 确认诊断目标是任务实际所属 Brain 的只读任务接口，不是预览地址，并写出 PR/head、Brain 三项和 QA 终态，且没有修改状态的命令。真实调用方 shape 是上述 Node CLI、已有 GitHub 只读 PR 查询与 Brain 只读任务查询；这里不新增 API，不臆造请求 header/body 或鉴权，Brain 请求按现场已有鉴权由控制器提供。失败语义与输入对抗面：PR URL 缺失、PR head 不符、GitHub 或 Brain 查询失败或超时均记为“尚不能确认最终成功”，可只读重查；同名 PR、重复查询和迟到终态不能覆盖已知 FAIL。

### S-4
对应：I-4。产品文件仍仅为 `packages/brain/scripts/coding-workflow/runner/README.md`。发布前范围检查固定以 `23cb825cc42b7a8c3a5b6ca86ec6d1cae12c47bd` 为基线，分别枚举基线至 HEAD 的全量提交/路径、暂存区、工作区，并先枚举全仓未跟踪路径，再只按本任务 `sprints/10241101-cw-934e5375/` 下真实流水线 Markdown 记录排除；不能先把未跟踪扫描限于 README。对 README 做基线原文字节与先后顺序保留断言，允许在原有段落之间插入新节；`.implementation-source-relations.json` 在发布前须与基线同字节。verify 只读本轮 `01-intent.md` 与当前可见仓库/源码，不读取其它 sprint 报告；被控制器临时隐藏的 `03-build.md` 不当作漏产。此规格不授权模型编辑、暂存或提交 manifest，不授权其他程序、测试、开关、凭据或运行状态变更。

验证：`git rev-list --parents --topo-order 23cb825cc42b7a8c3a5b6ca86ec6d1cae12c47bd..HEAD` 枚举提交与父 SHA；逐条对每个父 SHA 执行 `git diff --raw --no-renames <父SHA> <提交SHA>`，读取状态、旧/新 mode 和路径，含合并提交；另将 `git diff --name-status 23cb825cc42b7a8c3a5b6ca86ec6d1cae12c47bd HEAD`、`git diff --cached --name-status`、`git diff --name-status`、`git ls-files --others --exclude-standard` 分开记录并检查。`git diff 23cb825cc42b7a8c3a5b6ca86ec6d1cae12c47bd HEAD -- .implementation-source-relations.json` 发布前须为空。用只读脚本逐字节按序匹配基线 README 的所有原文片段并核对最终文件新增小节。失败语义与输入对抗面：任一自产越界路径、原文删改、manifest 差异或无法唯一归属的未跟踪路径均判失败；先改后恢复、跨提交改后 revert 不能仅凭最终树放行。

### S-5
对应：I-4。后续 QA/evaluate 的范围证据沿用同一个固定 initial base，完整枚举至当前 HEAD 的 DAG、逐提交路径与全仓差异、暂存区、工作区、全仓未跟踪文件；发布后不能继续套用 S-4 的“manifest 零差异”。本任务自产仅允许 README 产品编辑、当前真实阶段的 Markdown 报告、确由本轮 QA 产生且经现有记录和来源门登记核实的 `sprints/10241101-cw-934e5375/qa-rN/` 非 Markdown 附件与必要原生证据，以及可信控制器按合同追加的 `.implementation-source-relations.json` 来源行；N 必须是实际轮次，未登记、错轮次或无法归属的附件仍失败。历史条目不改，manifest 来源行仅绑定本任务实际合法 Markdown，固定 `owner_path=packages/brain/scripts/coding-workflow/runner/run-once.mjs`、`role=documentation`；非 Markdown 附件不伪装为 Markdown 来源行，模型不得自行编辑或补造 manifest。若出现 main 同步，QA 根据可信控制器给出的同步事实投影和真实 Git 内容检查完整 DAG/路径；只有可信 source gate 另外核实实际 main ref 前后原生事实、精确两父及共同基线、受保护 merge 事件、原 registration→stage→native 链和逐 blob/mode 全 tree 后，才可单独归属上游。不能用本地同名 ref、最终 diff 减 main、模型说明、hash 相等或最终树碰巧相同代替来源证明。上游提交触及本任务 README/报告、随后 revert、身份不符或缺证都失败。新 HEAD 撤销旧批准并重新做 QA、裁判、预览和正式 CI。

验证：QA 只读检查固定基线 DAG，并逐提交对每个父提交执行 `git diff --raw --no-renames <父SHA> <提交SHA>`，记录普通及合并提交的变更路径、状态和旧/新 mode；再核对基线至 HEAD、暂存区、工作区的 `git diff` 及 `git ls-files --others --exclude-standard` 完整输出，与本轮可信投影逐提交逐路径对账。若有本轮 `qa-rN/` 附件，逐文件核对实际路径、轮次、原生内容与控制器的 QA 记录清单及来源登记；未登记或无法归属的文件不因位于该目录而放行。自产越界改动或上游触及本任务 README/报告，即使随后 revert 也失败；归属不明或投影与当前 HEAD 不一致即 `CANNOT_VERIFY`，不得重跑控制器补造。来源门和后续终验由独立控制器核实并留下精确 HEAD 回执，QA 不读取受保护凭证根。每轮 Q-4 只核实本轮可信控制器提供的 `03-build.md`、`04-evidence.md` 暂时隐藏事实及当下可见工作区，明确记录恢复尚未发生；不预先宣布恢复完成，不自行重建报告。QA 会话结束后控制器按原字节及文件模式恢复；独立裁判再核实绑定本任务、轮次、测试 HEAD、原生会话及完整恢复的受保护凭证。第三文件缺失、恢复不完整、内容或模式变更均失败。当前轮所有真实执行，包括失败、修正、重复和零字节输出，由可信控制器以完整命令、原生输出及退出码形成最终 05 报告有序全账；原始草稿完整留存，模型自填输出须逐字验真，FAIL/CANNOT_VERIFY 不得改写成 PASS。旧轮失败与证据原样保留，不追认。原生 `aggregated_output` 只证明实际捕获字节，不冒充每个子命令的完整 stdout/stderr。QA 的当前可见范围结论不等于会话后恢复、正式 CI、合并、Brain 终态、Learning 回读或下一 tick 回收已完成。

## QA 场景

### Q-1
对应: I-1
前提: 在 PR 预览版本对应仓库的隔离 QA 工作区新建空临时目录 `<临时目录>`，另备一个有回执但测试账号确实无目录读取权限的自造目录及可读取它的账号；不读取既有运行目录，不连接生产。
操作: 阅读最终 README 的“运行回执如何判读”；在仓库根对空目录运行 `node packages/brain/scripts/coding-workflow/runner/status.mjs --log-dir <临时目录> --json` 和文本模式；再在该目录写两个自造的 `completed` JSON 回执，用文件时间工具把 A 设为早于 B，重复运行两种命令。随后以无权账号对受限目录运行两种命令，核实确有读取权限错误，再由有权账号只读重查回执并按 README 检查路径、账号和权限。
期望: 空目录和实际无权读取目录的 JSON 都是 `[]`、文本都提示“没有运行记录”；有权账号可见受限目录的已有回执。README 明确空结果既不能证明健康，也不能断定目录里没有回执，并给出只读排查方法。A/B 写入后 B 在 A 前，文本和 JSON 都按 mtime 倒序，README 命令及默认目录说明与真实 CLI 一致。命令退出码和完整输出由本轮可信控制器记录。

### Q-2
对应: I-2, I-3
前提: 场景自建新的临时回执目录，并写入独立的进度 `last_event`、`completed`（含 PR URL）、`completed`（缺 PR URL）、`partial`（活动末次 `reason_code`）、`failed`、非法 JSON、合法非回执 qa/commander JSON、`pr-sync-pending.json`、`cifix-7.json`；所有文件均为本场景造数。
操作: 分别运行 `node packages/brain/scripts/coding-workflow/runner/status.mjs --log-dir <临时目录> --json` 与文本模式，查看各行，并阅读 README 的状态与误判说明；给含 `/pull/7` 的回执配上 `cifix-7.json` 两条 attempts，重复查询。
期望: 分别出现 `running/completed/partial/failed/unreadable`；非回执 JSON 和待办可能是 `unreadable`，README 明说不可因此删除现场；`cifix-7.json` 自身不成为状态行，关联 PR 行显示 `ci_fix.attempts=2` 及第二条 `last_result`。缺 PR URL 的回执在 JSON 仍是 `completed`，带 `reason_code=pr_url_missing` 且 `pr_url=null`，文本 completed 行不露该 reason；README 指示查看 JSON，不能把 completed 当合并证明。

### Q-3
对应: I-3
前提: 场景在全新临时目录写一个自造的 `completed` 回执，`outputs.pr_url` 指向自造但并未获证合并的 PR URL；不调用生产 Brain，不改批准或 FAIL 记录。
操作: 运行 `status.mjs --log-dir <临时目录> --json`；照 README 逐步指出 PR URL、最终 head、GitHub merged 事实和实际任务所属 Brain 的 `GET /api/brain/tasks/<task_id>` 只读终态查询入口，并检查 README 没有把预览地址写作最终诊断目标。因本轮没有真实任务授权，记录远端与 Brain 终态未查询。
期望: CLI 可显示 `completed`，但 README 明确此时不能宣告最终成功，且指出实际 Brain 的 `runner.phase`、`merge.merged` 与 QA 终态核对方法；查询失败或超时允许只读重查，不人工改状态。真实远端合并及 Brain 终态由后续控制器和外层终验检查，本轮 QA 如实记未覆盖。

### Q-4
对应: I-4
前提: QA 在本轮 PR 隔离工作区取可信控制器给出的当前完整测试 HEAD、固定 initial base `23cb825cc42b7a8c3a5b6ca86ec6d1cae12c47bd`、当前轮临时隐藏 `03-build.md` 与 `04-evidence.md` 的事实及可信同步投影；不依赖仓库既有任务记录。本场景先创建自己的临时目录用于保存只读命令结果。发布前零差异检查由 verify 在当时执行；QA 不重造发布前状态。
操作: 在当前 HEAD 执行 `git rev-list --parents --topo-order 23cb825cc42b7a8c3a5b6ca86ec6d1cae12c47bd..HEAD`；对所列每个提交和它的每个父提交运行 `git diff --raw --no-renames <父SHA> <提交SHA>`，逐条查看状态、旧/新 mode 和路径，包括两父合并及后来被 revert 的变更。再执行 `git diff --name-status 23cb825cc42b7a8c3a5b6ca86ec6d1cae12c47bd HEAD`、`git diff --cached --name-status`、`git diff --name-status`、`git ls-files --others --exclude-standard`，按提交、路径、模式及归属核对 README、当前真实报告、受控 manifest 增量；如有本轮 `qa-rN/` 附件，逐文件对照实际 QA 记录清单与可信来源登记，未登记文件不得略过；如有同步则对照本轮可信投影，缺投影就记不能核验。读取 README 验证基线全文原字节、顺序保留与新增小节。QA 只记录本轮隐藏事实和当前可见工作区，不读取保护根、不重建隐藏文件，注明会话结束后的恢复尚未发生。每条本轮真实命令的原生输出、退出码、失败和重复由可信控制器进入最终 05 报告有序全账，草稿语义不改写。
期望: 本任务自产产品修改仅 README；报告、来源增量及实际经门禁登记的本轮附件逐条符合真实阶段合同，未登记或错轮次附件仍拒；所有越界、来源缺口、上游触及本任务路径、改后 revert 或无法归属均失败或 `CANNOT_VERIFY`。QA 当前结论不声称已恢复或已完成后续门；控制器会话后恢复与独立裁判凭证核验、精确新 HEAD 的 QA/裁判/预览/正式 CI、真实合并、Brain 终态、Learning 回读和下一 tick 预览回收继续按原 C01-C12 终验，不由本场景预判。

## 铁律对照

- INV-3a390000：S-5、Q-4 覆盖；预览候选未通过不宣告可晋级，后续正式门保留。
- INV-2fe86d34：S-3、Q-3 覆盖；以真实 PR、head 和 Brain 运行事实核对，不拿回执标签替代最终状态。
- INV-ff177feb：S-5、Q-4 覆盖；本轮原生命令失败和真实退出码完整留证，失败不变成通过。
- INV-02d8e749：S-5、Q-4 覆盖；保留独立 QA、裁判、预览与正式 CI 的后续门，不以文档检查缩减链路。
- INV-c906dd6c：S-1、Q-1 覆盖；验收命令执行目标 Node CLI 并记录实际退出码，不把未运行的测试冒作证据。
- INV-f200769d：S-5、Q-4 覆盖；本轮原生命令、完整捕获输出和实际退出码由可信控制器留证。
- INV-26886b60：S-5、Q-4 覆盖；真实合并须按精确 head 与裁判结论核对，不以前轮批准顶替。
- INV-8d92f7b1：S-5、Q-4 覆盖；只按 A9 当前真实轮次来源投影判定，不套用旧样本成功史。
- INV-dc18d43d：S-3、S-5、Q-4 覆盖；README 只说明诊断，生命周期、来源及最终验收仍由代码控制器机械判定。
- INV-3c30394c：S-3、Q-3 覆盖；未真查远端合并和 Brain 终态时只报尚不能确认成功。
- INV-564802ee：S-1、Q-1 覆盖；示例只用自建临时目录，不读取、记录或提交凭据。
- INV-459b6ff9：S-2、Q-2 覆盖；自造回执不含客户隐私，证据只保留必要状态字段。
- INV-e2551d59：不适用：本次不改 runner 镜像摘要、仓库 profile 或运行机器配置。
- INV-696c9f96：不适用：本次不命名、重构或接线 coding commander。

## 未覆盖真实链路

- 本轮产品 QA 以自建临时目录真跑 `status.mjs` 并读最终 README；不接真实运行目录、不领单、不装服务，因此未核实真实常驻实例的运行健康，验到 CLI 对自造回执的实际输出。
- PR 最终合并、精确 head 正式 CI、生产 Brain `runner.phase/merge/qa_state` 终态、Learning 全文回读及下一实际 tick 预览回收尚属后续事实；本轮 QA 只验到 README 诊断说明，独立控制器及外层 C01-C12 在发生后终验。
- 本轮 QA 会话内 03/04 仍处临时隐藏状态；原字节和模式完整恢复及受保护来源凭证须在会话后由控制器与独立裁判验，本轮只验到可信隐藏事实和当前可见范围。
- 若发生可信 main 同步，QA 只验实际 Git 与可信事实投影的一致性；独立 main ref 原生采样、registration→stage→native、受保护 merge 凭证和逐 blob/mode 全 tree 由可信 source gate 核验，缺证时不得判通过。
