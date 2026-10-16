---
task_id: ecd50ab6-7553-4633-9bfe-2ae9448af68d
step: spec
upstream: ["01-intent.md#I-1", "01-intent.md#I-2", "01-intent.md#I-3", "01-intent.md#I-4"]
---

# 运行回执判读实现规格

### S-1
对应：I-1。只改 `packages/brain/scripts/coding-workflow/runner/README.md`，在现有内容之间加入「运行回执如何判读」小节。给出仓库根目录下 `node packages/brain/scripts/coding-workflow/runner/status.mjs --log-dir <回执目录>` 与加 `--json` 的用法；说明省略 `--log-dir` 时使用 runner 配置的日志目录、按文件 mtime 倒序、目录不存在或没有可扫描 JSON 时 JSON 为 `[]`，仅代表无记录。出处：`packages/brain/scripts/coding-workflow/runner/status.mjs` 的 `parseArgs`、`collectStatus`、`main`，以及 `lib/config.mjs` 的 `logDir`。真实调用方 shape：运维人员直接运行 Node CLI，以 argv 传 `--log-dir <目录>`、`--json`；无 HTTP header、body 或鉴权。失败语义与输入对抗面：目录不存在时 CLI 退出 0，文本显示「没有运行记录」，JSON 显示 `[]`；`[]` 不作健康证明。目录路径由操作者指定，不将非法、过长参数的现有宽松解析说成已校验，也不承诺重复参数的语义。验证：在临时目录创建两份终态 JSON 并设置不同 mtime，运行上述 CLI 的文本和 JSON 两种形式，断言新文件先出现；对不存在目录断言 `[]` 和「没有运行记录」；用内容断言核对 README 的选项及空结果解释。

### S-2
对应：I-2。只改 `packages/brain/scripts/coding-workflow/runner/README.md`。逐项写明：含 `last_event` 的进度 JSON 显示 `running`；终态 `completed`、`partial`、`failed` 沿用回执状态，后两者展示首个非 completed/skipped 活动与原因；无法按回执 shape 识别的 JSON 或解析失败显示 `unreadable`。扫描范围是目录内除 `cifix-<数字>.json` 外的所有 `.json` 普通文件，因此合法的 `qa-*.json`、`commander-*.json` 和 `pr-sync-pending.json` 也可能显示 `unreadable`；该行不是文件损坏或删除待办的证据。`ci_fix` 仅在回执 `pr_url` 可提取 PR 号、对应 `cifix-<号>.json` 有 attempts 时出现，次数为 attempts 长度，`last_result` 为末次结果；它是修复记录摘要，不是 CI 通过或已合并判据。出处：`status.mjs` 的 `parseReceipt`、`ciFixSummary`、`formatStatus`，`lib/receipt.mjs` 的 `summarizeReceipt`，`lib/cifix-scan.mjs` 的 `readState`。真实调用方 shape 同 S-1。失败语义与输入对抗面：坏 JSON 与非回执 JSON 只令该行 `unreadable`，不阻断其他行；不存在的 cifix 状态只令 `ci_fix=null`；重复、超长或并发写入文件时只描述当前 CLI 读取到的结果，不宣称快照一致性。验证：CLI 读取自建进度、三个终态、非回执 JSON、坏 JSON、cifix 状态；逐行比对文本和 JSON 字段，并断言这些文件未被 CLI 删除。

### S-3
对应：I-3。只改 `packages/brain/scripts/coding-workflow/runner/README.md`。明确 `completed` 只是执行回执状态，不代表 PR 已合并；即使 `outputs.pr_url` 缺失，`summarizeReceipt` 仍给 `status=completed`、`reason_code=pr_url_missing`，而 `formatStatus` 的 completed 文本行默认不打印该 reason。要求先查 `--json` 的 `pr_url`、`reason_code`，再只读核对对应 GitHub PR 的最终 head 与合并事实，以及 Brain 同一任务的 `result.runner.phase=merged`、`result.merge.merged=true`、`result.qa_state` 终态；任一事实缺失或不一致不得宣称最终成功。说明只读诊断，不手工修改批准、FAIL 记录或运行状态。出处：`lib/receipt.mjs` 的 `summarizeReceipt`、`status.mjs` 的 `formatStatus`、`lib/terminal.mjs` 的初始 `awaiting_qa` 阶段及 runner 合并门。真实调用方 shape：运维人员用 S-1 的本地 CLI 查回执；对已有 PR 用 `gh pr view <PR号或URL> --json headRefOid,state,mergedAt,url` 只读查询，对已有任务使用预览环境同源的 `GET <预览环境>/api/brain/tasks/<任务ID>` 只读查询；本任务 QA 不新建 PR 或任务，不借生产数据伪造终态。失败语义与输入对抗面：无 PR URL、PR 查不到、head 不同、Brain 不可读或终态未齐，结论均为「未证实合并，可稍后重查」，不能用 completed 文本或重复查询改写状态。验证：自建缺 URL 的 completed 回执，断言 CLI JSON 中 `reason_code=pr_url_missing`、`pr_url=null`，文本行仍为 completed 且不打印该 reason；README 明确列出全部终态条件和只读处理。

### S-4
对应：I-4。产品文件仍仅为 `packages/brain/scripts/coding-workflow/runner/README.md`；`sprints/10170022-cw-ecd50ab6/01-intent.md`、`01-invariants.md`、本 `02-spec.md` 及后续真实阶段报告属于流水线证据，不作为产品改动。发布前 verify 固定 `base_sha=a2b043435339c90b40d6fa0c0df369d15b18eb49`，完整枚举从该提交到 HEAD 的每个提交和路径、暂存区、工作区与整个仓库未跟踪文件；先全仓枚举，再仅按本任务实际流水线报告路径排除，拒绝任何额外自产文件或先改后还原的越界提交。基线 README 的每一原始字节按原顺序仍在最终文件中，允许在原文之间插入新小节；此阶段 `.implementation-source-relations.json` 相对固定基线必须零差异。verify 只读 `01-intent.md` 与真实仓库/源码；`03-build.md` 临时隐藏不构成漏产。发布后 QA/evaluate 仍以相同 initial base 做完整 DAG 和全仓范围检查，但不再要求 manifest 相对基线零差异：本任务只接受真实报告与可信控制器对当前任务合法 Markdown 的精确来源增量，模型不得编辑、暂存或提交 manifest；仅在独立 source gate 对真实 main ref、两父同步提交、原 registration→stage→native 链、受保护 merge 事件、逐 blob/mode 全 tree 和恢复凭证均验证通过时，才将该同步单独归属上游。QA 只消费可信投影并结合实际 Git，不读取保护凭证根；投影缺失、上游碰本任务 README/报告、未知改动、先改后 revert 均不能放行。每个新 HEAD 重新 QA、裁判、预览、正式 CI；后续合并、Brain 终态、Learning 和预览回收由实际阶段及外层 C01-C12 验收，不能预先宣称完成。控制器仅可临时隐藏指定 03/04 报告并按原字节和模式恢复，非本任务文件无豁免。验证：发布前、发布后均从固定基线执行 `git rev-list --parents --reverse <base_sha>..HEAD`，取得每个提交及全部父 SHA；单父逐条比较 `git diff --no-renames --raw <父> <提交>`，双父同步提交分别对每条父边运行同一比较并核对路径、blob、mode、删除及实际内容，另检查第二父引入的上游历史是否曾触本任务 README/报告；不得以普通 `git diff-tree <merge>` 或最终树相等代替。合并逐父结果与 `git diff --name-status <base_sha> HEAD`、`git diff --cached --name-status`、`git diff --name-status`、`git ls-files --others --exclude-standard` 合并判定；以基线 README 行字节序列为最终 README 的有序子序列作断言，发布前另对 manifest 做零差异断言。发布后再结合来源门提供的本轮固定字段事实判定归属，不从最终 diff 简单减 main 差异；任一上游历史触本任务路径后还原也不能验收。本规格不要求产品 QA 自证其结束后才发生的提交、合并或回写。

## QA 场景

### Q-1
对应: I-1
前提: QA 在本 PR 预览版本对应的隔离 checkout 的仓库根目录；本场景用 `mktemp -d` 新建空目录，退出时清理。无需服务和既有任务数据。
操作: 在该目录写 `old.json` 为 `{"status":"completed","outputs":{"pr_url":"https://github.com/example/repo/pull/11"}}`，写 `new.json` 为 `{"status":"failed","reason_code":"fixture_failed"}`；用 `touch -t 202610010000` 和 `touch -t 202610020000` 分别设置 mtime。实际运行 `node packages/brain/scripts/coding-workflow/runner/status.mjs --log-dir "$目录"`，再运行相同命令加 `--json`；另以新建临时目录下尚不存在的子目录作 `--log-dir` 再运行两种格式，并阅读最终 README 新小节。
期望: 文本和 JSON 均先列 new、后列 old；JSON 包含两行对象及 mtime。不存在目录返回文本「没有运行记录」、JSON `[]`，两次退出码均为 0；README 明说该结果不能证明服务健康。

### Q-2
对应: I-2
前提: QA 自建独立临时目录并在场景末清理，不读取运行机历史日志。
操作: 写入 `run.json`=`{"last_event":"build","status":"partial"}`、`ok.json`=`{"status":"completed","outputs":{"pr_url":"https://github.com/example/repo/pull/77"}}`、`part.json`=`{"status":"partial","activities":[{"key":"build","status":"failed","attempts":[{"reason_code":"tests_failed"}]}]}`、`fail.json`=`{"status":"failed","reason_code":"run_failed"}`、`broken.json`=`{bad`、`qa-77.json`=`{"passed":true}`、`commander-77.json`=`{"human":{}}`、`pr-sync-pending.json`=`{"pending":true}`、`cifix-77.json`=`{"attempts":[{"result":"push_failed"},{"result":"pushed"}]}`。实际运行 `node packages/brain/scripts/coding-workflow/runner/status.mjs --log-dir "$目录" --json` 及文本格式，并在前后列目录文件名。
期望: run 为 running，ok 为 completed 且 `ci_fix={"attempts":2,"last_result":"pushed"}`，part 为 partial 且 `failed_activity=build`、`reason_code=tests_failed`，fail 为 failed 且原因是 run_failed；broken、qa-77、commander-77、pr-sync-pending 均为 unreadable，`cifix-77` 本身不成任务行；文本 ok 行含 `ci_fix=2次 last=pushed`。文件前后均存在，README 明说非回执 JSON 的 unreadable 不可作为损坏或删除依据，尤其不删除 pr-sync 待办。

### Q-3
对应: I-3
前提: QA 另建临时目录；本场景没有 PR、Brain 任务或生产访问。
操作: 写入 `missing-pr.json`=`{"status":"completed"}`，运行真实 CLI 的文本及 `--json` 两种输出，随后按 README 的步骤阅读 JSON、检查应核对的 GitHub PR/head 与 Brain 终态字段说明。
期望: JSON 中 `status=completed`、`reason_code=pr_url_missing`、`pr_url=null`；文本 completed 行不显示该 reason，README 警告不能由该行推断有效 PR，更不能推断合并。README 给出只读核对 PR/head、`runner.phase=merged`、`merge.merged=true`、`qa_state` 终态的完整方法，并要求无法核实时保持「未证实」，不修改批准或 FAIL 记录。

### Q-4
对应: I-4
前提: QA 使用本轮真实 PR 的隔离 checkout、固定 initial base `a2b043435339c90b40d6fa0c0df369d15b18eb49` 及控制器交付的本轮固定字段来源/隔离事实；不用生产仓库状态或历史 QA 自述。发布前 manifest 零差异由当时的 verify 控制器独立记录，QA 不重造发布前状态。
操作: 从仓库根目录运行 `git rev-list --parents --reverse a2b043435339c90b40d6fa0c0df369d15b18eb49..HEAD`，对每条单父提交运行 `git diff --no-renames --raw <父> <提交>`，对每条双父同步提交分别以第一父、第二父运行该命令，核对路径、blob、mode、删除和内容，并沿第二父引入的上游提交检查是否曾触本任务 README/报告；运行 `git diff --name-status a2b043435339c90b40d6fa0c0df369d15b18eb49 HEAD`、`git diff --cached --name-status`、`git diff --name-status`、`git ls-files --others --exclude-standard`，先全仓枚举未跟踪，再按本任务真实 sprint 报告路径剔除。用 `git show a2b043435339c90b40d6fa0c0df369d15b18eb49:packages/brain/scripts/coding-workflow/runner/README.md` 取得基线，逐行按字节核对其为最终 README 的有序子序列。阅读本轮可信同步投影并对照实际提交和路径；若有当前轮 03/04 暂时隐藏，只接受控制器给出的本轮隐藏与完整恢复事实。另在临时 Git 仓库作反例：`git init -b task` 后设置该临时仓库的提交身份，写 `README.md` 并提交为基线；`git branch upstream`，在 task 分支提交另一文件，在 upstream 分支改 README 并提交；切回 task 执行 `git merge --no-ff upstream`，再用 `git show <基线>:README.md` 恢复 README 并提交。运行 `git rev-list --parents --reverse <基线>..HEAD` 和 `git diff --no-renames --raw <合并第一父> <合并>`，沿 upstream 历史查看 README 改动，并比较基线与最终 README，最后清理临时仓库。
期望: 本任务自产产品路径仅 README，旧文原字节及顺序保留；没有未知自产文件、越界提交或被伪装的先改后还原。反例最终 README 可与基线相同，但合并提交第一父边及上游历史仍显示 README 曾被触碰，必须报不能验收；普通 `git diff-tree <merge>` 的空输出不能放行。发布后的合法报告/manifest 来源增量单独识别，不能用发布前零差异要求否决；可信同步只在独立 source gate 全部通过且 Git 相符时归属上游，缺投影/缺证/冲突即不能验收。QA 不把后续尚未发生的 CI、合并、Learning 或停预览写成已通过。

## 铁律对照

- INV-2fe86d34：S-2、S-3、Q-2、Q-3 覆盖；运行回执、CI 修复摘要与最终合并分开判读，不能用单个状态冒充执行成功。
- INV-b3a8bf82：S-3、S-4、Q-4 覆盖；文档分别引用运行账、任务账及版本事实，保留各自权威来源。
- INV-e5ab4826：S-3、S-4、Q-4 覆盖；不另建状态真身，以现有仓库、任务、运行和版本证据定位。
- INV-02d8e749：S-3、S-4、Q-3、Q-4 覆盖；保留真实 QA、独立裁判与合并门的阶段边界，不以回执替代门禁。
- INV-dc18d43d：S-3、S-4、Q-4 覆盖；手册仅提供只读判读，生命周期仍由控制器按外部事实决定。
- INV-26886b60：S-3、S-4、Q-4 覆盖；最终合并须对应精确 head，不能凭早期批准或 CI 状态推断完整流程。
- INV-09fb5c69：S-4、Q-4 覆盖；验收仍逐条对应合同，CI 绿不替代 QA 结论。
- INV-5e125909：S-1、S-3、Q-1、Q-3 覆盖；日志目录用实际配置或 CLI 参数，PR/head 和 Brain 状态通过真实读数核实。
- INV-3c30394c：S-3、Q-3 覆盖；本次未真核实的合并与 Brain 接缝保持未证实，不标为完成。
- INV-564802ee：S-1、S-3、Q-1、Q-3 覆盖；只读本地回执和获授权的查询，不读取、写入或展示凭据。

## 判定点

- 回执是否代表最终合并｜候选: completed 文本行、JSON 加 PR/head 与 Brain 终态｜所选: 后者｜依据: completed 可缺 PR URL，初始 runner 阶段仍可能是 awaiting_qa｜误判后果: 将未合并 PR 错报成功。
- JSON 文件是否损坏｜候选: status 的 unreadable、按文件实际用途及内容核实｜所选: 后者｜依据: status 扫描非 cifix 的普通 JSON，合法 QA/Commander/待办文件也可显示 unreadable｜误判后果: 误删真实待办或证据。

## 未覆盖真实链路

- 本次产品仅是 README，QA 用自建临时回执目录真跑 CLI 到输出；没有真实任务、GitHub PR 或 Brain 终态数据，故不将模拟 completed 判作真实合并。对应 PR/head、Brain 终态、正式 CI、Learning 和预览回收由后续真实控制器及外层 C01-C12 核验。
- 发布前 manifest 零差异、受保护来源链、可信 main 同步与报告临时隔离/完整恢复属于独立控制器来源门；QA 只核对其固定字段投影和实际 Git，不能读取保护凭证根或重造发布前现场。缺少可信投影时，本链路结论为不能验收。

## commander 裁决（第 1 次）

### T-4 / Q-4：采纳，补清每轮证据和阶段边界

第 1 轮裁判 J-1 的结论维持 FAIL：该轮三次失败执行的原生命令、完整输出和退出码缺失，不能通过重跑、推测或修改旧报告追认。需求 01 要求新 HEAD 重新真实 QA 与裁判，且新记录不得重写历史报告；因此第 1 轮的证据缺口须在历史中明确保留，但不作为下一轮独立执行 Q-4 的先验失败条件。第 2 轮 T-4 因旧轮缺口而 CANNOT_VERIFY，混淆了两轮验收。新一轮仍须对本轮固定 HEAD、固定 initial base、完整 DAG 和全仓差异执行 Q-4，核对本轮可信来源投影，并逐字记录本轮所有执行（包括失败及修正重测）的原生命令、完整输出和真实退出码；任一当轮缺证、来源投影缺失或与 Git 不符，照旧不能验收。旧轮的缺失只能如实注明，不能冒充已补齐，也不能把旧轮改判 PASS。

补充 S-5：Q-4 在 QA 会话内只核实本轮控制器提供的 03-build.md、04-evidence.md 临时隐藏事实及当前可见工作区；QA 必须明确记录完整恢复尚未发生，不能预先判定其通过。控制器在 QA 会话结束后按原字节和文件模式恢复，独立裁判再核实绑定本轮任务、轮次、测试 HEAD、原生会话和实际完整恢复的保护凭证；缺证、恢复不完整或第三文件缺失仍为失败。该后续凭证是完整闭环的必要条件，不是 QA 当场给 Q-4 结论的前置事实。正式 CI、合并、Brain 终态、Learning 和预览回收仍由后续阶段核验，不得提前宣称完成。
