---
task_id: 889f9288-5169-4341-acb8-f5cacc330bff
step: spec
upstream: ["01-intent.md#I-1", "01-intent.md#I-2", "01-intent.md#I-3", "01-intent.md#I-4"]
---

# 运行回执判读手册实现规格

### S-1
对应：I-1。仅修改 `packages/brain/scripts/coding-workflow/runner/README.md`，新增“运行回执如何判读”小节。按 `packages/brain/scripts/coding-workflow/runner/status.mjs` 与 `lib/config.mjs` 写出真实命令形状：`node packages/brain/scripts/coding-workflow/runner/status.mjs --log-dir <回执目录> --json`；`--log-dir` 覆盖默认 `CODING_WF_LOG_DIR`（未设时为运行用户 home 下 `.cecelia/coding-workflow-runner`），`--json` 输出 JSON 数组，不带它输出文本。行按文件 mtime 倒序。目录不存在、为空、路径为普通文件或目录不可读时，均可能返回 JSON `[]`、文本“没有运行记录”及退出码 0；应只读核对路径是否为目录及访问权限，不能以空结果证明服务健康或确有可读目录。现有 CLI 的输入对抗面须如实写明：未知参数被忽略；`--log-dir` 位于参数末尾才因缺值回落默认目录，若紧随 `--json` 则它被当作目录名，输出文本而非 JSON；该路径不存在时显示“没有运行记录（--json）”，不能当作默认目录的 JSON 检查结果。验证：QA 自建临时目录写两份 mtime 不同的回执，真运行命令断言 JSON 与文本行序；另对不存在目录、普通文件路径及 `--log-dir --json` 分别断言实际输出。

### S-2
对应：I-2。仅修改同一 `README.md`。对照 `status.mjs`、`lib/receipt.mjs`、`lib/cifix-scan.mjs` 描述：带 `last_event` 的 JSON 为 `running`；终态 `completed`、`partial`、`failed` 保留状态，其中未完成态显示首个非 completed/skipped 活动的 `failed_activity` 及最后一次尝试优先的 `reason_code`；解析失败或不符合上述形状为 `unreadable`。扫描规则是目录内所有 `.json` 普通文件，只有 `cifix-数字.json` 被排除；合法 QA/Commander 状态 JSON 和 `pr-sync-pending.json` 也可能被列为 `unreadable`，不能由此断定损坏或删除现场。关联 PR 的 `cifix-<PR号>.json` 若有 attempts，`ci_fix` 仅报告次数与最后一项 `result`，没有则为 null；它不证明 CI 已绿或 PR 已合并。失败语义与输入对抗面：坏 JSON、非回执 JSON 不阻断其他行；重复或大量文件按当前实现逐个扫描并按 mtime 排序，不建议凭文件名推断任务身份或删文件。验证：QA 用真实 CLI 扫描自造的五态、合法非回执 JSON、`pr-sync-pending.json` 与 cifix 文件，断言状态及 `ci_fix.attempts/last_result`。

### S-3
对应：I-3。仅修改同一 `README.md`。明确 `completed` 只是执行器回执：`lib/receipt.mjs` 在缺少 `outputs.pr_url` 时仍返回 `status=completed`，但 `reason_code=pr_url_missing`；`status.mjs` 的文本 completed 行默认不打印该 reason，须看 `--json` 并核实 `pr_url`。最终诊断应只读核对对应 GitHub PR 的最终 head 与已合并状态，以及 Brain 当前任务的 `runner.phase=merged`、`merge.merged=true`、QA 终态；各信号须绑定同一任务、PR 和 head，不能由一个 completed 行替代。发现 PR URL 缺失、head 不符、未合并、QA 未到终态或 Brain 未回写时，标为待核实，不手工改批准或 FAIL 记录，不把重试或删除现场写成处理方法。真实调用方 shape：运维从 README 运行 `node .../status.mjs --log-dir <回执目录> --json`，不是 HTTP 写入；Brain 只读任务详情由 `packages/brain/scripts/coding-workflow/runner/lib/brain.mjs` 的 `getTask` 使用 `GET /api/brain/tasks/<任务ID>`、无 body，GitHub PR 身份由 `lib/pr-sync.mjs` 的 `gh pr view <PR号> --json number,headRefName,headRefOid,url,state,closedAt,mergedAt` 取得。文档只指导读取，不加入凭据、生产地址或自动改状态命令。验证：QA 自造 completed 有/无 PR URL 两份回执，运行文本与 JSON CLI，断言缺 URL 行的 JSON reason 与文本缺失该 reason；逐字检查 README 列明完整终态核对链。

### S-4
对应：I-4。产品修改文件仅为 `packages/brain/scripts/coding-workflow/runner/README.md`；不修改 `status.mjs`、`lib/receipt.mjs`、测试、开关、凭据、运行状态或任何验收器。本次 `02-spec.md` 及后续必要 Markdown 报告属于当前 sprint 的流水线记录，由对应阶段按原合同产生，不能为缩小差异而删改。README 基线原字节须按先后顺序全部保留，允许在原文之间插入新小节。发布前 verify 以固定 `6073eac1d35e652e3ea6b71fc040878c95864cd7` 检查该基线到 HEAD、暂存区、工作区及全仓未跟踪文件；先枚举全仓未跟踪，再仅排除实际属于本任务 sprint 的流水线记录。发布前 `.implementation-source-relations.json` 对基线零差异，模型不编辑、不暂存、不提交。发布后 QA/evaluate 应保留产品范围检查，但不复用发布前 manifest 零差异：只有可信 publish、QA、Commander 控制器可为本任务真实报告按许可文件名新增准确来源行，owner_path 固定为 `packages/brain/scripts/coding-workflow/runner/run-once.mjs`、role 为 `documentation`，历史条目不变；身份、原生回执、精确 HEAD 和完整恢复由独立来源门核验，不能用 Git 作者或模型自述代替。verify 期间 `03-build.md` 暂时隐藏、QA/evaluate 期间 `03-build.md` 和 `04-evidence.md` 暂时隐藏，只接受绑定本任务和本轮且原字节/模式恢复的控制器凭证；产品 QA 不推断自身结束后才会发生的登记、提交、合并或清理。验证：发布前由 verify 比较固定基线及各 Git 层；发布后由 QA 对实际 HEAD 做只读范围和 README 保留检查，由控制器来源门核对 manifest 与隔离凭证；不得据尚未发生的后续条件判本轮产品失败。

## QA 场景

QA 在本 PR 预览环境所绑定的仓库版本执行本地 CLI。该产品仅改手册，按本次任务约束不启动或安装服务，不调生产、Brain API 或 GitHub 真 PR；CLI 与自建临时回执是真命令黑盒验收。每个场景新建独立临时目录，不依赖现场回执。涉及基线时由 QA 在本机从固定 base commit 读取，不能借生产作基线。

### Q-1
对应: I-1
前提: 在本 PR 工作树创建专属临时空目录 `mktemp -d`；在目录内先用 `node -e` 写入 `old.json` 为 `{"status":"completed","outputs":{"pr_url":"https://github.com/example/repo/pull/101"}}`、`new.json` 为 `{"status":"partial","activities":[{"key":"build","status":"failed","reason_code":"build_failed"}]}`，用 `fs.utimesSync` 将前者 mtime 设为 2026-10-01T00:00:00Z、后者设为 2026-10-02T00:00:00Z。
操作: 运行 `node packages/brain/scripts/coding-workflow/runner/status.mjs --log-dir "$QA_LOG_DIR" --json`，再去掉 `--json` 运行一次；阅读最终 README 新小节中的两种命令、默认目录、排序与空结果说明。
期望: JSON 为数组，`new` 在 `old` 前，文本同序；README 与观察一致，明确 `[]` 不代表健康。

### Q-2
对应: I-1,I-2
前提: 另建空临时目录，在其中创建一个普通文本文件，并构造一个不存在的子目录路径；从仓库根目录运行 CLI，确认根目录不存在名为 `--json` 的路径；不复用 Q-1 数据。
操作: 对空目录、不存在子目录和普通文件路径各运行一次 `node packages/brain/scripts/coding-workflow/runner/status.mjs --log-dir <该路径> --json`，再对不存在目录运行不带 `--json` 的文本命令；单独运行 `node packages/brain/scripts/coding-workflow/runner/status.mjs --log-dir --json`；阅读 README 的故障判读。
期望: 前三次 JSON 均为 `[]` 且退出码 0，文本含“没有运行记录”；漏值命令输出文本“没有运行记录（--json）”，不是 JSON 或默认目录检查结果。手册要求只读核对路径类型与访问权限，不将空结果解释为服务正常，也不建议删除或重启。

### Q-3
对应: I-2
前提: 新建专属临时目录，先写 `running.json` 为 `{"last_event":"build"}`，`partial.json` 为 `{"status":"partial","activities":[{"key":"intent","status":"completed"},{"key":"build","status":"failed","attempts":[{"reason_code":"tests_failed"}]}]}`，`failed.json` 为 `{"status":"failed","reason_code":"run_failed"}`，`completed.json` 为带 `outputs.pr_url=https://github.com/example/repo/pull/77` 的 completed 回执，`bad.json` 为非法 JSON，`qa-state.json` 为合法但非回执的 `{"qa_state":"PASS"}`，`commander-state.json` 为合法但非回执的 `{"commander_state":"pending"}`，`pr-sync-pending.json` 为合法终态待办形状 `{"repo":"cecelia","entries":{}}`；再写 `cifix-77.json` 为 `{"attempts":[{"result":"push_failed"},{"result":"pushed"}]}`。
操作: 真运行 `node packages/brain/scripts/coding-workflow/runner/status.mjs --log-dir "$QA_LOG_DIR" --json`，逐行查看 JSON；随后运行文本命令并阅读 README 的每类解释。
期望: running/partial/failed/completed 正确；partial 的 `failed_activity=build`、`reason_code=tests_failed`；bad、qa-state、commander-state、pr-sync-pending 均显示 `unreadable`，但不影响其余行；没有 `cifix-77` 任务行，completed 行的 `ci_fix` 为 `{attempts:2,last_result:"pushed"}`。README 点名合法 QA/Commander 状态 JSON 与 `pr-sync-pending.json` 可能被扫成 unreadable，禁止据此删待办或现场，ci_fix 不等于 CI 成功。

### Q-4
对应: I-3
前提: 新建专属临时目录，先写 `has-pr.json` 为 `{"status":"completed","outputs":{"pr_url":"https://github.com/example/repo/pull/77"}}`，`no-pr.json` 为 `{"status":"completed","outputs":{}}`；这些示例 URL 不作真实外部请求。
操作: 对该目录分别运行 `node packages/brain/scripts/coding-workflow/runner/status.mjs --log-dir "$QA_LOG_DIR"` 和追加 `--json` 的命令，再按 README 的说明尝试从本次自造记录判断是否可宣布最终合并。
期望: 两行均为 completed；无 PR 行的 JSON 有 `reason_code=pr_url_missing`、`pr_url=null`，文本 completed 行不显示该 reason。README 要求继续只读核对真实 PR 最终 head 与合并状态、Brain `runner.phase=merged`、`merge.merged=true` 和 QA 终态；自造回执不足以宣布成功，不建议手工改批准或 FAIL 记录。

### Q-5
对应: I-4
前提: QA 在本机从固定基线 `6073eac1d35e652e3ea6b71fc040878c95864cd7` 读取 README 原始字节；QA 取得本轮 PR 实际 HEAD 和当前 sprint 路径，不读取受隔离的 03/04 报告。发布前的 manifest 零差异由 verify 已在其阶段独立核验，不要求 QA 重造该阶段。
操作: 用 `git show 6073eac1d35e652e3ea6b71fc040878c95864cd7:packages/brain/scripts/coding-workflow/runner/README.md` 读取基线原文；对本轮 HEAD 的 README 逐字扫描基线字节作为保序子序列，核对原文没有删改且新增小节存在。运行 `git diff --name-status 6073eac1d35e652e3ea6b71fc040878c95864cd7 HEAD`、`git diff --cached --name-status`、`git diff --name-status` 逐层列改动，再先用 `git ls-files --others --exclude-standard` 枚举全仓未跟踪路径，仅排除本任务实际 sprint 报告路径。查看当前 manifest 差异是否仅含许可的本任务报告来源行；将来源身份、精确提交和临时隔离恢复交给控制器来源门按本轮原生凭证核实。
期望: 产品文件差异仅 README；原文保字节保顺序，可在其间插入新节；无越界未跟踪文件。发布后 manifest 仅允许可信控制器的本任务准确增量，不要求零差异；QA 不凭 Git 作者、受隔离报告或自身自述证明来源，也不预判其结束后才发生的登记、提交、CI、合并、Learning 和预览回收。

## 铁律对照

- INV-02d8e749：S-3、S-4、Q-4、Q-5 覆盖（手册区分回执与终态，保留独立 QA 和后续合并门）。
- INV-2fe86d34：S-2、S-3、Q-3、Q-4 覆盖（运行记录与 PR、Brain 终态分开读取，不把单一状态当执行成功）。
- INV-b3a8bf82：S-3、S-4、Q-4、Q-5 覆盖（手册只引用任务、运行、版本既有真身，不建平行状态账）。
- INV-e5ab4826：S-3、S-4、Q-5 覆盖（实现归仓库 README，运行事实按既有任务和运行账诊断）。
- INV-696c9f96：S-3、Q-4 覆盖（coding runner 回执与 coding commander 后续终态分别判读）。
- INV-45cd3ec2：不适用：本次不新建或修改回归 smoke，既有 guard 行为不变。
- INV-ff177feb：不适用：已被 INV-45cd3ec2 撤销，本次不修改 smoke 退出码。
- INV-91e9abe3：不适用：只写 CLI 判读手册，不改变开发会话模型或执行地。
- INV-0dc6b84f：不适用：只写手册，不配置 Claude 模型或执行地。
- INV-ac7c8801：不适用：已由 INV-0dc6b84f 修订，且本次不配置模型。
- INV-564802ee：S-3、Q-4 覆盖（示例不含真凭据，不把 token 或账号文件写入手册）。
- INV-459b6ff9：S-1、S-3、Q-1 覆盖（示例只含虚构回执，不记录客户隐私；现有主日志的保密提醒保留）。
- INV-5e125909：S-1、Q-1、Q-5 覆盖（目录取实际配置或自建临时目录，不写死生产地址）。
- INV-3c30394c：S-3、Q-4 覆盖（自造回执只验证判读，未做真实 GitHub/Brain 终态核对时不声称最终成功）。
- INV-26886b60：S-3、S-4、Q-5 覆盖（最终合并须对精确 head，不能拿别轮裁决或单个 completed 替代）。
- INV-09fb5c69：S-3、S-4、Q-4、Q-5 覆盖（CI 状态和 completed 回执均不顶替独立 QA/裁判及最终交付清单核验）。
- INV-3529e88f：S-4、Q-5 覆盖（范围与来源由机械检查和独立来源门核验，不依赖手册或模型自述放行）。
- INV-dc18d43d：S-3、S-4、Q-5 覆盖（本次仅文档解释现有闸，不将生命周期判定交给手册或模型）。

## 判定点

- 回执状态与最终合并｜候选: 仅看文本 completed、查看 JSON 并按任务/PR/head 对 GitHub 与 Brain 终态｜所选: 后者｜依据: 缺 PR URL 仍可 completed 且文本不显示 `pr_url_missing`｜误判后果: 未合并 PR 被报告为已完成。
- unreadable 文件处置｜候选: 当作损坏立即删除、先核对 JSON 用途与文件名｜所选: 后者｜依据: status 扫描非 cifix JSON，合法 QA/Commander 状态与 pr-sync 待办也可能显示 unreadable｜误判后果: 删除真实验收或终态回写证据。

## 未覆盖真实链路

- 本次产品 QA 只用自造回执真跑本仓 CLI 并核对最终 README；不领真实任务、不调用生产 Brain、GitHub 真 PR 或账号，也不证明某个真实任务已最终合并。实际 PR/head、Brain 终态、正式 CI、Learning 和预览回收由后续控制器门及外层 C01-C12 在发生后核验。
- QA 不能自行证明 manifest 新行由可信控制器生成，或 03/04 临时隔离已按原字节和文件模式恢复；QA 只核对可见产品范围，当前任务/轮次/HEAD 绑定和原生保护凭证由独立来源门核验，缺证不得判来源通过。
- 若本轮 QA 预览环境不提供本仓 CLI 工作树，则上述 CLI 场景标记 `CANNOT_VERIFY`，记录已完成的 README 检查与缺少工作树的事实；不以单元测试或 dry-run 替代真实命令。
