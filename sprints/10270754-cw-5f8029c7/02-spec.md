---
task_id: 5f8029c7-6f55-441a-b7d0-70688ac0cfb9
step: spec
upstream: ["01-intent.md#I-1", "01-intent.md#I-2", "01-intent.md#I-3", "01-intent.md#I-4", "01-intent.md#I-5", "01-intent.md#I-6", "01-intent.md#I-7", "01-intent.md#I-8", "01-intent.md#I-9"]
---

# Coding 闭环一期 A：固定权威引用与 Native 隔离验收

### S-1
可信锚的具体入口：`authority-refs.mjs` 将 `docs/registry/coding-workflow-authority.json` 路径及其经交付版本核实的 Git commit SHA 固定为代码常量，活动按此 SHA 读取 Git 对象；不增产品端点或让任务传锚。任务声明、工作树修改和后来提交的索引均不能改变此锚。该固定索引须预先登记 QA 所用四类 path/kind；缺固定锚或登记时受管任务不能报 found，当前产品 QA 如实记不可验。
对应：I-1、I-2、I-6。改动 `packages/brain/scripts/coding-workflow/lib/authority-refs.mjs`（新增纯解析模块）、`packages/brain/scripts/coding-workflow/activities/intent.mjs`、必要的 `docs/registry/` 中 coding workflow 薄引用入口。只从任务绑定的可信 Git 索引版本解析 object_id/ref_id/kind/path/revision/digest/required；四类引用均须匹配已登记的固定 path 与 kind，正文用指定 commit 的 Git blob 计算 SHA-256，输出 found/missing/invalid/unsupported 与原因。固定索引自身也须有独立可信路径及版本锚，不能由工作树修改或任务自报索引给自己授权。合法的已登记历史 commit 可回放。缺文件、错摘要、绝对或越界路径、越界 symlink、不可用 revision 分别给出明确缺口；`path` 为 `http://` 或 `https://` URL 时先于 Git 路径及登记校验返回 `unsupported/external_authority_unsupported`，不得尝试联网或误报普通非法路径；不读取任意旧 sprint 或缓存充当长期权威。失败语义：required 未满足时活动 failed，后继停止；暂时不可读取的受控来源可按现有 retryable 分类重试，非法或未登记来源不能靠重试绕过。输入对抗面：重复 ref_id、超长或非法路径、并发更改工作树及相同 path 的替换必须按固定 Git 对象和登记唯一性拒绝或稳定解析。用户能看到 01 引用事实中的独立外部来源缺口及活动失败原因。验证：`CODING_WF_TEST_TRANSPORT=ipc CODING_WF_TEST_PROCESS_ENUM=owned npm exec --workspace cecelia-brain -- vitest run scripts/coding-workflow/__tests__/authority-refs.test.mjs --maxWorkers=1 --minWorkers=1`；断言 URL 不触发外部请求且给出上述原因、package.json 冒名且正确 digest 仍失败、索引未固定篡改失败、历史登记版本成功、Git replace 已实际生效但不污染固定原索引和正文。

### S-2
受管单条计划的对象字段定为 `authority: { object_id, refs: [{ ref_id, kind, path, revision, digest, required }] }`，经 `payload.authority` 送到 intent；未支持外部来源用现有 `path` 填完整 `https://` URL，建单校验允许其作为待报告的来源声明并原样传递，intent 识别并报告 S-1 的独立缺口，不增加来源字段或联网入口。其余必填沿用 `title/change_kind/map_scope_hint/acceptance`，`base_sha` 为真实固定基线，`repo` 只接受 `repos.json` 已登记 key。`--repo` 与计划 `repo` 均不能用临时目录路径代替仓库登记。
对应：I-3、I-4。改动 `packages/brain/scripts/coding-workflow/new-task.mjs`、`packages/brain/scripts/coding-workflow/activities/intent.mjs`、`packages/brain/scripts/coding-workflow/lib/intent.mjs`。new-task 的计划声明随 POST task payload 原样保留必要对象引用字段，intent 从 GET 返回的真实任务取值；未声明旧任务标记 legacy/unconfigured，不能写成“无旧要求”。受管对象 required 缺项阻断后继。`01-intent.md` 保留原背景、I-n 与既有 `intent_sha256`，在背景和条目之外加可审计引用事实，不增加新的任意 sprint 附件。失败语义：计划结构或受管引用不完整在建单前或 intent 活动明确失败；旧任务继续按原链走。输入对抗面：空、重复、超长、伪造 found 与并发任务 payload 改动不能覆盖程序计算的引用状态。真实调用方 shape：`new-task.mjs <plan.json> [--repo ...]` 以 `POST <预览环境>/api/brain/tasks`、`Content-Type: application/json` 发送 `task_type=coding_workflow`、`repo_hint`、`map_scope_hint`、`change_kind`、`base_sha` 和 `payload.acceptance` 及对象引用（出处：`new-task.mjs` 的 `body`、`postJson`）；intent 子进程 stdin 为 `run_tag/task_id/worktree/sprint_dir/brain_url`，以无额外 header 的 `GET <预览环境>/api/brain/tasks/{task_id}` 及 `GET .../decisions?category=invariant&status=active&limit=1000` 取资料（出处：`activities/intent.mjs`）。鉴权由预览环境既有入口/本地受控服务提供，不新增端点或绕过其鉴权。验证：运行同一完整验收命令中的 `new-task.test.mjs`、`intent.test.mjs`、`protocol.test.mjs`；断言 payload→子进程→01 字段一致，旧任务显式 legacy，required 缺项失败，原 I-n 与输出 SHA 一致。

### S-3
对应：I-5、I-8。改动 `packages/brain/scripts/coding-workflow/__tests__/authority-refs.test.mjs`、`__tests__/intent.test.mjs`、`__tests__/new-task.test.mjs`、`__tests__/brain-transport.test.mjs`、`__tests__/protocol.test.mjs`、`__tests__/helpers/run-activity.mjs` 及测试专用 IPC preload/helper。先提交真实 Git 仓库和真实 activity 子进程的失败行为测试，再提交实现；保留旧断言。默认真实 HTTP；只有显式 `CODING_WF_TEST_TRANSPORT=ipc` 时测试 helper 通过 `--import` 注入子进程 fetch 适配，并复用父进程假 Brain 的业务路由；生产活动与 `fetch` 不读取测试开关，也没有真实 fetch 失败后自动回退。IPC 只证明业务请求响应，不宣称 TCP、重定向或 `Response.url`。失败语义：IPC 路由或子进程连接失效要使测试真实失败，不能空跑或跳过。输入对抗面：未识别传输值、并发子进程和错误响应不可隐式改走生产 HTTP。验证：本轮 verify 在原 Native 无网络隔离环境执行 I-9 所列完整命令，保存原生命令、完整输出、退出码及外层独立核验；默认 HTTP 在有头受控环境跑原用例。当前 QA 只能观察已交付版本的外部行为，不代替发布前 RED/GREEN 历史验收。

### S-4
对应：I-7。改动 `packages/brain/scripts/coding-workflow/runner/__tests__/run-once.test.mjs`、`runner/__tests__/run-once-recovery.test.mjs` 及为两者共享受控任务服务所需的 `runner/__tests__/helpers/sandbox.mjs`、定向 `runner/__tests__/fixtures/fake-executor.mjs`。仅测试辅助层接入 IPC；生产 `runner/run-once.mjs`、`runner/lib/plan.mjs`、`runner/lib/terminal.mjs` 的既有“有结果不再认领”和失败留痕语义保持。真实调用方 shape：runner 向 Brain `GET /api/brain/tasks?status=queued...`、`POST /api/brain/tasks/{id}/claim`（JSON `claimer/executor_kind`）、`PATCH /api/brain/tasks/{id}`（JSON status/result）请求，鉴权由受控 Brain 原入口处理；出处 `runner/run-once.mjs`、`runner/lib/brain.mjs`。失败语义：已有结果不重跑；verify 失败以 failed 和原因留痕，不能写 completed；写回失败不能报成功。输入对抗面：重复 tick、已有 result、服务端 409、回执丢失均不得重复执行。验证：完整命令中的 `run-once.test.mjs`、`run-once-recovery.test.mjs` 真子进程回归。生产旧失败三条的旧状态和最终状态由监督端凭生产 Brain 独立 GET 及既有基线 SHA 比对；隔离 verify 不联网，也不把旧执行者自述当本轮证据。

### S-5
对应：I-9。改动 `packages/brain/scripts/coding-workflow/runner/__tests__/helpers/owned-process-enum.mjs`、`runner/__tests__/owned-process-enum.test.mjs` 及 `runner/__tests__/helpers/sandbox.mjs`、定向 `runner/__tests__/fixtures/fake-executor.mjs` 中的测试适配；实际文件名以固定候选提交为准。`CODING_WF_TEST_PROCESS_ENUM=owned` 只在显式测试模式枚举本轮随机登记的真实 PID/PPID，必须以签名与 nonce 挑战确认活实例；未知/坏登记或身份不能确认时报错，不回退宿主 pgrep，也不对复用 PID 发信号。finally 只清本轮经认证的 PID；失败仍失败。真实 detached 进程组、忽略 SIGTERM、SIGKILL 和 expectGone 断言保留；默认系统 pgrep 路径也保留。失败语义：枚举受限、认证失败或进程清理失败要返回非零和原始原因，不能把失败改成功；可在新隔离会话重试验证，不能重试杀未认证 PID。输入对抗面：伪造登记、重复 PID、PID 回收、并发测试轮次由 nonce/签名与归属检查拦住。验证：原 Native Codex 沙箱内实际运行 `CODING_WF_TEST_TRANSPORT=ipc CODING_WF_TEST_PROCESS_ENUM=owned npm exec --workspace cecelia-brain -- vitest run scripts/coding-workflow/__tests__/authority-refs.test.mjs scripts/coding-workflow/__tests__/intent.test.mjs scripts/coding-workflow/__tests__/new-task.test.mjs scripts/coding-workflow/__tests__/brain-transport.test.mjs scripts/coding-workflow/__tests__/protocol.test.mjs scripts/coding-workflow/runner/__tests__/run-once.test.mjs scripts/coding-workflow/runner/__tests__/run-once-recovery.test.mjs scripts/coding-workflow/runner/__tests__/owned-process-enum.test.mjs --maxWorkers=1 --minWorkers=1`，194 项全过并保存本轮原始命令、输出与退出码；不嵌套 sandbox，不增加超时掩盖失败。默认 HTTP/pgrep 在允许的有头环境另行验证。

### S-6
对应：I-5、I-7、I-8、I-9。候选复用的版本归属与验收责任：先只读核实 `/Users/administrator/worktrees/cecelia-cw/coding-ipc-verification` 的固定 HEAD `65664cf3f` 及九个提交的完整 DAG，再按 `13028ddb4、208d380bd、7da5bdf16、c8eeedf0a、c350c78a0、0a44e2530、6855250e3、a7fe39fa3、65664cf3f` 顺序 cherry-pick 到新分支；这些是本次改动来源，不复制旧 sprint/证据，也不改旧现场。受影响文件限 S-1 至 S-5 所列及候选中的测试专用辅助文件。发布前 verify 必须对当时暂存区、工作区、全仓未跟踪文件以及本轮原生命令、完整输出、退出码和独立外层核验负责；当前 QA 只核固定 initial base、当前 HEAD 的完整 DAG/逐提交归属与当前现场，不能凭当前干净状态倒推过去现场。后续登记、报告恢复、提交、PR、每个新 HEAD 的 QA/裁判/预览与正式 CI、合并和清理由实际控制器门及终态验收核实，旧失败记录保留。验证：`git rev-parse HEAD`、`git merge-base HEAD <固定initial-base>`、`git log --format='%H %P %s' <固定initial-base>..HEAD`、`git status --porcelain=v1 --untracked-files=all` 以及固定候选各 `git show --format=fuller --stat <SHA>`；initial base 和来源事实必须只读核实，缺失即不能验，不创建替代历史。

## QA 场景

### Q-1
对应: I-1、I-3、I-4
前提: PR 预览环境已接受 `repos.json` 登记的 `cecelia` key；QA 在隔离目录克隆该注册仓库，临时目录只作真实 Git 工作树。交付代码中的索引路径与 commit SHA 常量先于任务存在，其 Git 对象已登记四类测试 path/kind；QA 只读核对固定 SHA 与内容，不靠本场景提交的索引自我授权。另有已核实 initial base 供建单使用。受控 Brain、任务与工作目录隔离于生产；缺任一前提如实报当前产品场景不可验。
操作: 在隔离克隆的已登记四类正文 path 提交版本，分别取 `git rev-parse HEAD` 的 revision 及对应 Git blob 的 digest。计划 JSON 填 `repo:"cecelia"`、`title`、`change_kind:"bugfix"`、`map_scope_hint:["F1"]`、`acceptance:["引用事实与 Git 一致"]`、`base_sha:<固定 initial base>`、`authority:{object_id:<已登记 ID>,refs:[{ref_id,kind,path,revision,digest,required:true},...]}`。运行 `BRAIN_URL=<预览环境> node packages/brain/scripts/coding-workflow/new-task.mjs <计划文件> --repo cecelia`；用返回 id 启动 `activities/intent.mjs`，stdin 传 `run_tag/task_id/worktree:<隔离克隆>/sprint_dir/brain_url`；读取 01 并运行 `shasum -a 256`。
期望: 已登记 key 建单成功；01 保留原背景及 I-n，逐项列 object_id/ref_id/kind/path/revision/digest/required/status/reason，found 摘要等于对应 Git blob 的实际摘要，活动 outputs.intent_sha256 等于 01 文件摘要；没有额外任意附件。未登记 key 或未预锚索引不能得到 found。

### Q-2
对应: I-2、I-6
前提: 沿用 Q-1 已登记的 `cecelia` key、隔离克隆与任务之前固定的可信索引锚；在已登记正文 path 提交 V1、V2，两个 revision 均由真实 `git rev-parse` 读取；受控 Brain 中分别新建指向 V1/V2 的任务。
操作: 依 Q-1 的计划字段、`BRAIN_URL` 与 `--repo cecelia` 命令分别建单并运行 intent；再建缺文件、错 digest、路径逃逸、越界 symlink、不可用 revision 及“将四类 path 全换 package.json 且 digest 正确”的任务并逐条运行。外部来源任务沿用同一计划形状，将一项 required 引用的 `path` 写为 `https://example.invalid/authority.md`，保留 `ref_id/kind/revision/digest/required`，经 new-task 建单后运行 intent；最后仅在工作树修改索引、不改变预先固定的可信锚，再运行。
期望: V1/V2 各取指定版本且内容不同；合法已登记 V1 回放成功；异常逐条返回可区分的缺口或失败，外部 URL 返回 `unsupported/external_authority_unsupported` 且不发起外部请求，package.json 冒名和未固定索引篡改不能得到 found，required 异常阻断后继。

### Q-3
对应: I-3、I-4
前提: 在预览 Brain 新建一条不带对象声明、但有 acceptance 的旧形状任务；另由 Q-1 新建受管任务。数据均由本场景创建。
操作: 按真实 stdin shape 分别启动 intent 并读取 01 和活动回执；给受管任务删去一个 required 引用后重新建单或运行活动。
期望: 旧任务仍生成原 I-n 并明确 legacy/unconfigured，不声称无旧要求；受管缺项明确 failed 且不进入后继；两者均保留既有 intent_sha256 语义。

### Q-4
对应: I-5、I-8
前提: PR 预览环境有可用的受控 Brain 服务与隔离 Git 仓库；本场景不读取前轮 verify 自述。
操作: 以 Q-1/Q-2 的真实命令行再走一次正常、错误引用的活动子进程；另由 QA 只读核实交付版本中测试专用双传输和生产默认 HTTP 的代码边界及本轮来源门给出的固定字段事实。
期望: 子进程回执与生成文件和真实 Git 内容一致，错误输入非零；默认生产请求走真实 HTTP。发布前 RED/GREEN、Native IPC 完整测试和 Git replace 攻击的原生命令及结果仍由当时 verify 与独立来源门负责，QA 当前不能重跑替代或据旧 PASS 宣称通过。

### Q-5
对应: I-7
前提: 在预览环境受控 Brain 新建一条 coding_workflow 任务和隔离 runner 工作目录；使用受控真实 runner 子进程/活动替身，不触生产任务。场景内先造一条已有 `result.coding_workflow` 的 queued 任务及一条会在 verify 失败的任务。
操作: 启动一次 `runner/run-once.mjs` 指向 `<预览环境>` 与隔离仓库，读回两条任务；对已有结果任务再启动一轮。
期望: 已有结果任务无新的 claim/执行记录；verify 失败任务保留 failed、失败原因与现场引用，不出现 completed。三条生产旧失败的旧状态及最终状态由监督端对生产 Brain 独立 GET 与既有基线 SHA 比对，QA 不访问生产或伪造旧现场。

### Q-6
对应: I-9
前提: PR 预览环境可启动隔离受控 runner 和真实 detached 子孙进程；QA 记录本场景所建进程 PID，不借宿主已有进程。
操作: 让受控 runner 执行会超时的活动，使其 detached 子孙进程忽略 SIGTERM；记录该子孙进程 PID，等待 runner 终止路径结束，再检查该 PID 的实例已消失，并查看 runner 的失败回执。
期望: 本场景的子孙进程被清理，runner 留下超时失败而非成功；伪造/损坏登记、重复 PID、身份挑战、Native owned 枚举、194 项全过及默认 pgrep 路径由发布前 verify 的原生命令、完整输出、退出码和独立外层核验负责，缺证不得通过；当前 QA 不把预览环境等同 Native 隔离。

### Q-7
对应: I-5、I-7、I-8、I-9
前提: 固定 initial base、候选九个真实提交及当前 HEAD 可由只读 Git 历史核实；任一事实缺失即标不可验，不创建替代提交。QA 只拿 01/02 与来源门允许的固定字段。
操作: 对当前 QA checkout 执行 `git rev-parse HEAD`、`git merge-base HEAD <固定initial-base>`、`git log --format='%H %P %s' <固定initial-base>..HEAD`、`git status --porcelain=v1 --untracked-files=all`；逐提交核对来源与改动路径。
期望: 当前 HEAD 的完整 DAG、逐提交归属及当前暂存/工作/全仓未跟踪范围可解释且无超出 I-n 的改动。过去发布前现场、将来阶段回执与每个新 HEAD 的门禁由各自阶段原生核验；当前 HEAD 或旧 PASS 不能补过去缺证。

## 铁律对照

- INV-3a390000：S-6、Q-7 覆盖；候选独立验证不过不晋级，后续发布门另核。
- INV-2fe86d34：S-2、S-4、Q-5 覆盖；任务与运行事实以真实回执关联，不用自述代替。
- INV-b3a8bf82：S-1、S-2、Q-1 覆盖；索引存引用，实际运行值写活动事实，避免双真身。
- INV-e5ab4826：S-1、S-2、Q-1 覆盖；沿用仓库、任务账和运行账，不新建平行账本。
- INV-91e9abe3：S-3、S-5、Q-6 覆盖；Native Codex 走其真实隔离，未启用 Claude 无头通道。
- INV-3859041e：S-3、Q-4 覆盖；本次不恢复 Claude Code 无头调用。
- INV-067867c8：S-3、Q-4 覆盖；IPC 只作测试注入，不重开本机桥接。
- INV-696c9f96：S-2、Q-1 覆盖；沿用现有 coding workflow 命名及对象。
- INV-02d8e749：S-1 至 S-6、Q-1 至 Q-7 覆盖；保留原来源、隔离、裁判与合并条件。
- INV-0dc6b84f：S-3、S-5、Q-6 覆盖；按原 Native 执行地验收，不用预览代替。
- INV-ac7c8801：S-3、S-5、Q-6 覆盖；维持本 coding 线既定执行环境与模型边界。
- INV-52f1801e：S-5 覆盖；如需安装依赖仅在仓库根执行 `npm ci`。
- INV-751f73be：S-3、Q-4 覆盖；不激活 Claude Code 自动通道。
- INV-ae4b4428：S-1、S-2、Q-2 覆盖；required 和可信路径拦截写在代码判断中。
- INV-e2551d59：S-1、S-6、Q-7 覆盖；版本与摘要以固定仓库 Git 对象为真身。
- INV-edbf1fb9：S-4、S-5、Q-5、Q-6 覆盖；正常、失败、重试及清理出口均验证。
- INV-3529e88f：S-1、S-2、Q-2 覆盖；权威与 required 由代码校验，不依赖模型自报 found。
- INV-f2d2f383：S-1、Q-2 覆盖；按登记 ID/path/Git blob 机械判定。
- INV-15e28dee：S-1、Q-2 覆盖；本地候选同样受 required 拦截。
- INV-b19c8ab8：S-1、S-4、Q-2、Q-5 覆盖；失败回执保留具体原因和现场。
- INV-8d92f7b1：S-6、Q-7 覆盖；只读核实真实历史，不照抄旧任务验收自述。
- INV-c906dd6c：S-5 覆盖；verify 命令必须实跑并记录退出码及完整输出。
- INV-f200769d：S-5 覆盖；原生验证须确认实际解释器运行及退出码。
- INV-09fb5c69：S-6、Q-7 覆盖；CI 绿不顶替独立验收及阶段来源门。
- INV-6d11717d：S-5、S-6、Q-7 覆盖；测试是否真执行按原生输出判断，不用总绿态替代。
- INV-dc18d43d：S-1、S-2、S-4 覆盖；权威、阻断和运行状态由代码机械判定。
- INV-7ccfa168：S-4、Q-5 覆盖；同一 runner 轮次串行且已有结果不重跑。
- INV-06950012：S-4、Q-5 覆盖；Cecelia runner 留在本仓，不下发真机。
- INV-5e125909：S-1、S-5、Q-2、Q-6 覆盖；Git SHA、路径和本轮 PID 从真实环境取得。
- INV-3c30394c：S-3、S-5、Q-4、Q-6 覆盖；Native 接缝由真隔离 verify 验证，缺证不标完成。
- INV-564802ee：S-2、Q-1 覆盖；受控服务鉴权凭据从环境提供，不写入文件或日志。
- INV-50954d28：S-2、Q-1 覆盖；沿用受控 Brain 现有鉴权，不新增无鉴权端点。

## 判定点

- 权威引用 found｜候选: 模型自报、工作树文件、固定 Git 对象与登记索引核对｜所选: 固定 Git 对象与登记索引核对｜依据: 可绑定版本、路径和摘要｜误判后果: 任意文件冒充权威要求。
- owned 进程身份｜候选: 仅 PID、宿主 pgrep、签名加 nonce 挑战｜所选: 签名加 nonce 挑战｜依据: Native 隔离禁止宿主枚举且 PID 可复用｜误判后果: 误杀无关进程或留下孤儿。

## 未覆盖真实链路

- 当前产品 QA 不能重现发布前 Native Codex 的网络与宿主枚举双禁现场，也不能证明当时 RED/GREEN、194 项完整命令和默认 HTTP/pgrep 两环境原生退出码；QA 验到预览环境的真实 Git、活动及子进程行为，该部分交原 verify 与独立外层来源门。
- 当前产品 QA 不能读取过去发布前的暂存区、工作区、全仓未跟踪清单；QA 只读核当前固定 initial base、完整 DAG、HEAD 与当前现场，过去现场由当时 verify 原生命令、完整输出、退出码和独立外层核验负责，缺证不能补造。
- 生产旧失败三条的原状态及最终状态不由隔离 QA/verify 访问；QA 只验预览任务的失败留痕，监督端须独立 GET 生产 Brain 并与既有基线 SHA 对照。
- 后续登记、报告完整恢复、提交、每个新 HEAD 的 QA/裁判/预览与正式 CI、合并及清理由实际控制器门和终态验收负责；当前 QA 只验当前已发生的可观察条件。
