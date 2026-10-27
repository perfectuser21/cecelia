---
task_id: b3d6f213-3fa3-48f9-a2c1-6d7e3b68d132
step: spec
upstream: ["01-intent.md#I-1", "01-intent.md#I-2", "01-intent.md#I-3", "01-intent.md#I-4", "01-intent.md#I-5", "01-intent.md#I-6", "01-intent.md#I-7", "01-intent.md#I-8", "01-intent.md#I-9"]
---

# coding 一期 A 实现规格

实现范围以本轮固定 initial base `6e9076aab2002e301304256b4936e2790f9de8e7` 和已审候选 `e526517009e3a9523900dacd600b4228fca6d297` 的真实 Git 对象为准。build 前只读核 `git cat-file -t <sha>`、各目标路径的 `git rev-parse <sha>:<path>` 与 `git show <sha>:<path>`；只取下列 22 个产品路径的原字节，不搬旧 sprint、manifest、DoD、验收文件或旧 merge 提交。产品路径最终 blob 必须逐一等于该候选。若候选对象不可读或与上游冲突，停止并报告，不能用缓存或自造同名文件代替。

### S-1
对应：I-1。文件：`docs/registry/coding-workflow-authority.json`、`packages/brain/scripts/coding-workflow/lib/authority-refs.mjs`、`packages/brain/scripts/coding-workflow/activities/intent.mjs`、`packages/brain/scripts/coding-workflow/__tests__/authority-refs.test.mjs`、`packages/brain/scripts/coding-workflow/__tests__/intent.test.mjs`。按受管任务的 `object_id` 和登记 `ref_id`，在固定 Git commit 读取规格、规则、样本、实现，计算正文 digest，写入候选真实 intent 新生成的 `01-intent.md`：`object_id/ref_id/kind/path/revision/digest/required/status/reason`，状态由读取结果确定，不能信模型的 found。bootstrap 的本任务 `01-intent.md` 不改。验证：执行本规格 S-5 的完整 vitest 命令，并检查上述两个测试中真实 Git 仓库与 activity 子进程断言；预览黑盒见 Q-1。失败语义：引用失败给明确状态和原因，required 缺项阻断后继，修好登记或指定版本后才能重试。输入对抗面：重复引用、异常对象 ID、非法路径或伪造 found 都不能改变计算事实。

### S-2
对应：I-2、I-6。文件：`docs/registry/coding-workflow-authority.json`、`packages/brain/scripts/coding-workflow/lib/authority-refs.mjs`、`packages/brain/scripts/coding-workflow/__tests__/authority-refs.test.mjs`、`packages/brain/scripts/coding-workflow/__tests__/intent.test.mjs`。索引必须固定且可核来源；同一路径不同 commit 读各自版本。缺文件、错 digest、路径逃逸、越界 symlink、无效 revision、未支持的外部权威来源逐项 fail closed；把已登记 path 改成 `package.json` 并给正确 digest 仍拒绝，任务输入不能自行编辑索引取得权威身份。合法固定版本回放不变。验证：S-5 命令中真实 Git 两提交、Git replace 生效挑战和上述拒绝断言；Q-2、Q-3。失败语义：返回可识别缺口或拒绝原因，不产生可当 found 的记录；修正合法输入可新建场景重试。输入对抗面：绝对路径、`..`、symlink、未登记路径、同名不同版本、正确摘要的偷换路径以及并发场景均按固定索引和原 Git 对象判定。

### S-3
对应：I-3。文件：`packages/brain/scripts/coding-workflow/new-task.mjs`、`packages/brain/scripts/coding-workflow/activities/intent.mjs`、`packages/brain/scripts/coding-workflow/__tests__/new-task.test.mjs`、`packages/brain/scripts/coding-workflow/__tests__/brain-transport.test.mjs`、`packages/brain/scripts/coding-workflow/__tests__/fixtures/brain-fetch-preload.mjs`、`packages/brain/scripts/coding-workflow/__tests__/helpers/brain-transport.mjs`。声明从 `new-task` 的 plan 进入 `POST /api/brain/tasks` 的 payload，再经受控服务 `GET /api/brain/tasks/{id}` 交给真实 intent 子进程；字段不丢。未声明对象的旧任务输出显式 `unconfigured`，不虚构旧要求；受管对象 required 缺项不能继续。真实调用方 shape：当前 `new-task.mjs` 的 `body()` 用 `POST /api/brain/tasks`、`content-type: application/json`，顶层 `task_type=coding_workflow`、`mutation_intent=write`、`change_kind`、`repo_hint`、`map_scope_hint`、`title`、`description`、`priority`、`trigger_source=manual`、可选 `base_sha/project_id`，`payload` 有 `coding_workflow=true`、`repo`、`gp_anchor`、`acceptance`；候选在此基础上携带受管声明，具体字段名以固定候选原字节与测试为准。脚本当前没有自造 Authorization header，预览鉴权由原允许 Unix 桥和任务服务上下文承担，不能更改鉴权门；读取是 `GET /api/brain/tasks/{id}`，出处：`new-task.mjs:65-100,156-175`、`activities/intent.mjs:20-29`。验证：S-5 命令核本地回归；Q-1 必须由 QA 调用固定 HEAD 的 `new-task.mjs <plan.json>` 真实建单，并以 CLI 输出 ID、任务 API payload、真实 intent 输入和新 01 核同一声明；Q-4 核旧任务兼容。手工 POST 不能替代 Q-1 的入口验证。失败语义：plan 校验失败不建单；服务拒绝退出非零；required 缺项给失败原因并停止后继，合法修复后另建任务重试。输入对抗面：空/错误声明、重复 ref、超长或非法路径、并发建单不得突破索引约束；保留当前建单服务已有的字段校验，不扩修别的字段。

### S-4
对应：I-4。文件：`packages/brain/scripts/coding-workflow/lib/intent.mjs`、`packages/brain/scripts/coding-workflow/activities/intent.mjs`、`packages/brain/scripts/coding-workflow/__tests__/intent.test.mjs`、`docs/registry/coding-workflow-authority.json`。候选真实 intent 在隔离场景中生成的新 `01-intent.md` 保留原背景和逐条 `I-n`，增加引用事实，`outputs.intent_sha256` 必须等于新文件原字节 SHA-256；对象索引先查现有 `docs/registry`，只补最薄引用，不新增规则真身，也不向 sprint 擅加附件。现有 `extractAcceptance` 以 `payload.acceptance` 优先、`renderIntent` 先背景后条目，保留原义。验证：S-5 中 `intent.test.mjs` 的真实子进程断言；Q-1 由 QA 外控制器提供本次 intent 子进程 stdout JSON 的只读封存副本及其执行输入/文件归属，QA 核任务 ID、场景 nonce 和新 01 路径后，独立重算文件 SHA-256 与该结果的 `outputs.intent_sha256` 比较；缺原生结果或归属证据不得判通过。本任务 bootstrap01 不用于这个功能断言。失败语义：摘要或条目不一致视为失败，不以输出文字或旧 01 顶替；可在新隔离场景重试。输入对抗面：背景里的伪 `### I-n` 不得制造条目，重复或超长背景仍按原规则渲染和原字节计摘要。

### S-5
对应：I-5。文件：`packages/brain/scripts/coding-workflow/__tests__/authority-refs.test.mjs`、`packages/brain/scripts/coding-workflow/__tests__/intent.test.mjs`、`packages/brain/scripts/coding-workflow/__tests__/new-task.test.mjs`、`packages/brain/scripts/coding-workflow/__tests__/protocol.test.mjs`、`packages/brain/scripts/coding-workflow/__tests__/helpers/procs.mjs`、`packages/brain/scripts/coding-workflow/__tests__/helpers/run-activity.mjs`。先只读核原 Git 和原运行记录的真实阶段：原 build 记录的 item93 测试变更、item94 `authority_non_regular_file` 真实断言 RED exit1、item95 实现修复、item96 同命令 2 tests 通过 exit0、item98 测试提交、item115 实现提交；核当前候选同断言保留。历史 TDD 不制造本轮 RED 提交，不把模块缺失或网络 EPERM 当业务 RED。然后本轮独立 verify 真跑完整命令：`CODING_WF_TEST_TRANSPORT=ipc CODING_WF_TEST_PROCESS_ENUM=owned npm exec --workspace cecelia-brain -- vitest run scripts/coding-workflow/__tests__/authority-refs.test.mjs scripts/coding-workflow/__tests__/intent.test.mjs scripts/coding-workflow/__tests__/new-task.test.mjs scripts/coding-workflow/__tests__/brain-transport.test.mjs scripts/coding-workflow/__tests__/protocol.test.mjs scripts/coding-workflow/runner/__tests__/run-once.test.mjs scripts/coding-workflow/runner/__tests__/run-once-recovery.test.mjs scripts/coding-workflow/runner/__tests__/owned-process-enum.test.mjs --maxWorkers=1 --minWorkers=1`；保存原生命令、完整输出和退出码。原运行记录路径和 SHA-256 按 01 背景核，不能用监督摘要代替原 JSONL。当前 QA 只核对应产品链，历史 RED 与 Native 回归由本轮 verify、独立 judge 负责；Q-5 只核固定 HEAD 的当前证据归属，不能重建过去现场。

### S-6
对应：I-7。文件：`packages/brain/scripts/coding-workflow/runner/run-once.mjs`、`packages/brain/scripts/coding-workflow/runner/__tests__/run-once.test.mjs`、`packages/brain/scripts/coding-workflow/runner/__tests__/run-once-recovery.test.mjs`、`packages/brain/scripts/coding-workflow/runner/__tests__/fixtures/fake-executor.mjs`。保留 `hasRunResult` 的已运行结果检查与失败收尾：已有运行结果不能重新认领或再执行；本轮 verify 失败写 failed 和真实原因、保留现场，不能写 completed。软件行为由受控任务服务与真实 runner 子进程在 S-5 命令核；生产旧失败任务由监督端在隔离 verify 外单独只读读回，旧 `verification_failed` 不改。当前 QA 对 I-7 只核本轮可见的失败任务 API 状态与固定 HEAD 事实，具体场景 Q-6；不能用 QA 重跑替代 verify 时现场。失败语义：runner 非零、任务保持 failed 和原因；恢复必须由原控制器规则处理，不重复副作用。输入对抗面：重复调度、并发认领、已有 result 或无效旧回执不能凭空产生 completed。

### S-7
对应：I-8。文件：`packages/brain/scripts/coding-workflow/__tests__/brain-transport.test.mjs`、`packages/brain/scripts/coding-workflow/__tests__/fixtures/brain-fetch-preload.mjs`、`packages/brain/scripts/coding-workflow/__tests__/helpers/brain-transport.mjs`、`packages/brain/scripts/coding-workflow/__tests__/authority-refs.test.mjs`、`packages/brain/scripts/coding-workflow/__tests__/intent.test.mjs`、`packages/brain/scripts/coding-workflow/__tests__/new-task.test.mjs`。原 verify 禁网环境用 `CODING_WF_TEST_TRANSPORT=ipc` 跑 S-5 同一整套用例，保留默认 HTTP 路径和全部既有断言；IPC 报告标明不代表 TCP 验收，不改生产 fetch、不开放网络、不跳过失败。Git replace 攻击先证明确实替换成功，再核原索引和正文不受替换。验证责任在本轮独立 verify 和 judge；当前 QA 在真实预览经原允许 Unix 桥走真实 HTTP API，Q-1、Q-2、Q-3 是产品可观察面，不声称复现禁网 Native。失败语义：fixture 或挑战失败则 verify 非零，不能报 PASS。输入对抗面：替换对象、错误摘要、网络受限输入均不能降级为 found。

### S-8
对应：I-9。文件：`packages/brain/scripts/coding-workflow/runner/__tests__/owned-process-enum.test.mjs`、`packages/brain/scripts/coding-workflow/runner/__tests__/helpers/owned-processes.mjs`、`packages/brain/scripts/coding-workflow/runner/__tests__/helpers/sandbox.mjs`、`packages/brain/scripts/coding-workflow/runner/__tests__/fixtures/executor-ipc-preload.mjs`、`packages/brain/scripts/coding-workflow/runner/__tests__/fixtures/fake-executor.mjs`、`packages/brain/scripts/coding-workflow/runner/__tests__/run-once.test.mjs`、`packages/brain/scripts/coding-workflow/runner/README.md`、`packages/brain/scripts/smoke/coding-workflow-runner-smoke.sh`。本轮 verify 在真正 Native Codex 禁网络、禁宿主进程枚举环境显式设置 `CODING_WF_TEST_TRANSPORT=ipc` 与 `CODING_WF_TEST_PROCESS_ENUM=owned` 跑 S-5 完整命令，189 原项及 5 新项共 194 项全过；verify 本身不再嵌套 sandbox，监督端独立外层核验才使用 `codex sandbox -P :workspace`。owned 只读本轮随机真实 PID/PPID 登记，签名和 nonce 挑战确认身份；未知、坏签名或身份无法确认则报错，不回退宿主枚举，不误杀复用 PID；finally 认证清理本轮全部 PID，失败仍失败。默认 HTTP、系统 pgrep、detached 进程组、忽略 TERM、KILL、expectGone 原行为保留；不改生产 executor、隔离或超时。验证责任为 verify 原生命令、进程观察、退出码及 judge；Q-6 只看本轮失败对外状态，Q-5 看现有固定 HEAD，不把 QA 会话当 Native 进程测试。

### S-9
对应：I-1、I-2、I-3、I-4、I-5、I-6、I-7、I-8、I-9。文件：以上 22 路径及本轮新 `sprints/10272102-cw-b3d6f213/01-intent.md`、`02-spec.md`、`03-*`、`04-*`、由原登记程序生成的来源 manifest。控制器从固定 initial base 建本任务分支，按原七步链实际运行；发布前 verify 核当时完整暂存区、工作区、全仓未跟踪清单，记录原生命令、完整输出、退出码及独立外层核验。发布后 QA 在固定新 HEAD 只读核 initial base、完整 DAG 和逐提交归属、当前暂存区/工作区与全仓未跟踪范围；真实来源事件、阶段回执与精确提交由独立来源门核。重叠上游同步必须停止，只有原 `createSourceMerge` 可产生受控 merge；旧 PR/失败记录保留。新 HEAD 均需重新走真实预览、QA、独立 judge 与正式 CI，之后才允许正常合并；未来报告恢复、登记、合并、清理由实际发生后的控制器和终态验收负责。Q-5 核 QA 当下合法可观察部分；其他时点不能用当前 clean、hash、metadata 或旧 PASS 代证。

## QA 场景

所有 Q-n 在本 PR 固定 HEAD 的真实预览 Brain 和隔离数据库副本执行，地址写作 `<预览环境>/api/brain/...`。QA 只读 01/02 和允许的前轮裁决；监督端预先提供已核固定 HEAD、隔离真实 Git/固定索引、唯一 nonce、精确任务与 payload allowlist、场景 plan、标准客户端传输配置和原允许 Unix 桥。QA 使用固定 Node 24 与仓库 `undici@6.29.1` 的标准 `Agent({connect:{socketPath}})`、`setGlobalDispatcher`，经 `--import` 运行固定 HEAD 的 `new-task.mjs` 或控制器预备客户端；不覆写 fetch、不写来源根、Git 元数据或业务产物。控制器在 QA 外运行真实候选 intent 并正常封存；QA 建单后可读任务 API、新 01 原字节、原 Git，以及控制器只读交付的本次 intent 原生结果与执行归属，不读取 03/04 或保护来源根。若入口、封存结果或真实预览未提供，相应场景记 CANNOT_VERIFY，不能换旧预览、健康夹具或生产。

### Q-1
对应: I-1,I-3,I-4,I-8
前提: 控制器为本场景预建独立真实 Git 仓库、固定索引、允许入口及场景 plan 文件；plan 含受管对象、两个合法登记引用、两条 `acceptance` 和含伪锚点的背景；预览 health 的 `git_sha` 等于本 PR 固定 HEAD；控制器须在活动结束后只读交付该次 intent 原生 stdout JSON、执行输入与新 01 文件归属，并绑定预先给 QA 的唯一场景 nonce。
操作: QA 用控制器提供的标准 `--import` 传输配置、预览 `BRAIN_URL` 和场景 plan 路径，实际运行固定 HEAD 的 `node packages/brain/scripts/coding-workflow/new-task.mjs <plan.json>`；核 CLI 退出码和输出任务 ID，再 GET `<预览环境>/api/brain/tasks/{id}`，逐项比对 plan 的受管对象、两个引用和验收条目与任务 payload；等待 QA 外控制器只执行该 ID 的真实 intent；再 GET 任务并读取新 01 原字节、只读封存的 stdout JSON 与执行输入/归属，核执行输入的 `task_id` 等于 CLI 与任务 API id、封存归属的 nonce 等于本场景 nonce 且阶段为 intent、`worktree/sprint_dir/01-intent.md` 指向该新文件且文件 frontmatter 的 `task_id` 一致；独立计算文件 SHA-256，与 stdout JSON 的 `outputs.intent_sha256` 比较，并从固定 Git commit 核每条引用原字节。
期望: 受管声明从 plan 经 `new-task.mjs`、真实任务 API 到 intent 新 01 不丢，也不变成 `unconfigured`；新 01 背景与两条 I-n 原义保留，伪锚点不增条目；每条引用的对象、版本、摘要、状态和原因等于原 Git；本次已封存原生结果的 `outputs.intent_sha256` 等于新 01 原字节摘要，活动 completed 不冒充整条 workflow completed；CLI 失败、字段丢失、缺封存结果或归属核对失败均不能判 PASS。IPC 的 Native 结论仍交 verify。

### Q-2
对应: I-1,I-2,I-6
前提: 控制器给场景独立仓库中的同一路径两个真实 commit，内容不同，索引分别固定合法 digest；场景任务现场新建。
操作: 按 Q-1 真实 POST shape 分别建两项场景任务，使用同一路径、不同登记 revision；等 QA 外控制器各执行真实 intent；读取两个新 01 和两版 `git show <commit>:<path>`，独立重算摘要。
期望: 两个结果各对应指定版本，digest 与相应 Git 字节一致；重复回放合法固定版本仍一致，不取当前工作树或旧 sprint 缓存。

### Q-3
对应: I-2,I-3,I-6,I-8
前提: 控制器为各次请求预建独立任务槽、真实 Git 文件与固定索引；无效路径、越界 symlink、缺文件、错 digest、不可用版本、未支持外部来源和将登记 path 偷换为 `package.json` 的输入由本场景逐项造出。
操作: 按 Q-1 的真实 POST shape 为每种输入各建一项；等待外部控制器分别运行 intent；GET 各任务结果与新 01。另在独立隔离 Git 场景由 verify 执行先确认替换生效的 Git replace 挑战，QA 只读其固定字段裁决。
期望: 每项给明确拒绝或缺口及原因，required 缺项不推进后继；即使 `package.json` digest 正确也不被授予权威；无有效 found。Git replace 的原始命令与退出码由 verify/judge 判，QA 不把其裁决文本当现场。

### Q-4
对应: I-3,I-4
前提: 场景独立任务槽；本场景新建一个未声明受管对象的旧式合法任务，另建一个声明对象但缺 required 引用的任务。
操作: 用 Q-1 的建单字段，第一项省略受管声明，第二项填缺 required 的声明；等外部控制器执行 intent；GET 任务和各自产出的新 01。
期望: 第一项为显式 `unconfigured`，原背景/I-n 完整且不说成“旧资料不存在”；第二项有 required 缺项事实和失败原因、不进入后继。预览所见失败可按修正输入另建任务重试。

### Q-5
对应: I-5,I-7,I-8,I-9
前提: 本轮 PR 固定 HEAD、initial base 和真实 Git 历史可只读访问；本场景不制造过去 verify 的工作区或进程现场。
操作: QA 运行只读 `git cat-file -t <initial-base>`、`git merge-base <initial-base> HEAD`、`git log --format=fuller --parents <initial-base>..HEAD`、`git diff --name-status <initial-base>...HEAD`、`git diff --cached --name-status`、`git diff --name-status`、`git ls-files --others --exclude-standard`，逐提交核 22 产品路径归属与候选逐 blob，相对固定 base 核范围；核预览 `/api/brain/health` 的 `git_sha`；从独立来源门领取仅限固定字段的阶段和来源裁决。
期望: 真实 DAG、逐提交归属、当前工作区范围与本轮目标一致；每个产品 blob 等于固定候选；预览 HEAD 匹配。过去现场、原 RED、禁网 Native 的 194 项、真实进程清理、生产旧状态及未来合并仍由对应 verify、监督端、来源门、judge、终态门据原生证据核；缺证不通过对应阶段。

### Q-6
对应: I-7,I-9
前提: 控制器在 QA 外为本场景隔离任务服务准备一条真实失败执行场景与一条已有运行结果任务，且运行真实 runner 子进程；QA 只得到本轮允许的任务 ID，不写 runner 回执或来源文件。
操作: GET `<预览环境>/api/brain/tasks/{id}` 读取两条任务的状态、result 与错误原因；在控制器执行前后各读取一次，结合独立控制器给出的“认领/执行次数”固定字段事实；不重新触发 runner。
期望: 已有结果任务没有再次认领和执行；失败任务保持 failed、原因与现场引用可见，不是 completed。Native owned/pgrep、认证清理及本轮 verify 的失败现场仍由 verify 原生记录核，预览任务状态不替代它们。

## 铁律对照

- INV-3a390000：S-9、Q-5 覆盖，固定 HEAD 的预览、QA、judge、正式 CI 未过不晋级。
- INV-02d8e749：S-7、S-9、Q-1 覆盖，保留真实产品 QA 与独立裁判门。
- INV-2fe86d34：S-6、S-9、Q-6 覆盖，运行结果以真实任务和运行回执为来源。
- INV-b3a8bf82：S-1、S-9、Q-1 覆盖，定义引用与本次运行事实分别落权威来源。
- INV-e5ab4826：S-1、S-9、Q-5 覆盖，仓库版本、任务、运行、来源事件可追溯。
- INV-ff177feb：不适用：已被 INV-45cd3ec2 撤销，不沿用其退出码口径。
- INV-45cd3ec2：S-8 覆盖，保留既有 smoke 生产保护约定，不把安全跳过算产品通过。
- INV-3529e88f：S-1、S-4、Q-1 覆盖，引用状态和摘要由程序算，不能靠模型自报。
- INV-29e7d8f8：S-9、Q-5 覆盖，预览探针核实际使用的固定 HEAD 和任务入口。
- INV-8d92f7b1：S-5、S-9、Q-5 覆盖，先核原真实运行与 Git，不照抄旧轮断言。
- INV-26886b60：S-9、Q-5 覆盖，合并时由终态门对账裁判 HEAD 与实际合并 SHA。
- INV-dc18d43d：S-6、S-9、Q-6 覆盖，生命周期及终态以控制器和任务服务真实状态判定。
- INV-3c30394c：S-3、Q-1 覆盖，真实调用接缝在预览任务服务和原允许桥验证；缺环境如实记不能验。
- INV-5e125909：S-3、Q-1 覆盖，调用 shape 取自真实脚本，不写死预览地址或假定配置。
- INV-564802ee：S-3、Q-1 覆盖，桥凭据不写代码、Git、日志或规格值。
- INV-50954d28：S-3、Q-1 覆盖，使用既有受控预览桥和服务鉴权，不添加无鉴权端点。
- INV-e8230eb5：S-9 覆盖，合并只归控制器，不由构建或 QA 直接完成。
- INV-c906dd6c：S-5 覆盖，verify 要保留真实命令、完整输出与退出码，不能只看绿色摘要。
- INV-46e9afb4：S-5、S-9 覆盖，如发生测试入册提交，提交后先核 TDD 与覆盖门再 push。
- INV-6ede438b：S-5 覆盖，复用实现前读原 Git 对象和 RED 行为，不凭旧总结恢复。

## 判定点

- 引用 found 判定｜候选: 模型自报、工作树文件、固定 Git 原字节与索引核对｜所选: 固定 Git 原字节与索引核对｜依据: 指定 revision 和 digest 均可机械复算｜误判后果: 冒认长期权威来源。
- 进程身份判定｜候选: 宿主枚举、裸 PID、owned 登记加签名与 nonce｜所选: owned 登记加签名与 nonce｜依据: Native 禁宿主枚举且 PID 会复用｜误判后果: 漏清理或误杀他人进程。
- 候选验收判定｜候选: 旧 PR PASS、当前 health、固定 HEAD 的完整阶段证据｜所选: 固定 HEAD 的完整阶段证据｜依据: health 和旧结果不含本轮来源与现场｜误判后果: 无真实 QA 或无 controller receipt 的合并被误判合格。

## 未覆盖真实链路

- 当前产品 QA 不能重建发布前 verify 的暂存区、工作区、全仓未跟踪现场及 Native 禁网进程现场；QA 验到当前固定 HEAD、当前范围与预览行为，过去现场由当时 verify 的原生命令、完整输出、退出码及独立外层核验承担，缺证则该阶段不能通过。
- QA 会话结束后才发生的来源登记、报告恢复、正式 CI、合并与清理，QA 验到预览固定 HEAD；实际发生后由独立来源门、控制器与终态验收核，不能提前报完成。
- 生产旧失败任务的状态不在隔离 QA 中读取；QA 验本场景失败任务，生产旧任务由监督端单独只读取证，不改其状态。
- 若控制器未提供隔离真实 Git、任务服务、原允许 Unix 桥、标准客户端及精确 allowlist，Q-1 至 Q-4、Q-6 无法真跑；QA 最多核预览 HEAD 和当前 Git，逐项记 CANNOT_VERIFY，不能以旧预览或夹具替代。
- 除本需求外发现的字段校验、其它调用方写法或存量来源问题不改，建议另立任务。
