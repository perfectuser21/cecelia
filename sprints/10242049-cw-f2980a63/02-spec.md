---
task_id: f2980a63-f4cd-4797-a2ab-7c2bd75728d4
step: spec
upstream: ["01-intent.md#I-1", "01-intent.md#I-2", "01-intent.md#I-3", "01-intent.md#I-4"]
---

# 提交编码任务手册实现规格

### S-1
对应：I-1。只改 `packages/brain/scripts/coding-workflow/runner/README.md`，新增“提交编码任务”小节。给出可解析的单任务 JSON，含 `title`、`change_kind`、`map_scope_hint`、非空 `acceptance`、`repo: "cecelia"` 和明确的 `gp_anchor`；示例只用现有合法的 `F1` 与 `none(docs)` 口径，不编地图 ID。给出 `node packages/brain/scripts/coding-workflow/new-task.mjs <plan.json> --repo cecelia --dry-run`。解释 `--dry-run` 只做计划格式和仓库名校验、输出预览，不 POST Brain、不创建任务，也不能证明实际提交成功；若有 `base_sha`，这里只检查 40 位小写十六进制格式，目标仓真实 commit 必须另行只读核实。写清仓库选择顺序为条目 `repo`、计划顶层 `repo`、命令行 `--repo`、默认 `cecelia`，未登记仓库拒绝；`change_kind`、`map_scope_hint` 必填。源码依据：`packages/brain/scripts/coding-workflow/new-task.mjs` 的 `validatePlan`、`parseArgs`、`main`，以及 `runner/lib/repos.mjs` 的 `resolveRepo`。

验证：用 `node` 读取 README 中的单任务 JSON 代码块并 `JSON.parse`，断言上述字段、命令和说明存在；对照上述源码中的优先级、`base_sha` 正则、dry-run 分支和无 POST 路径逐项检查。此为文档与真实 CLI 合同的静态核对，不运行 `new-task.mjs --dry-run`。命令行失败语义须写明：文件读取或 JSON 解析失败显示 `读不了计划文件` 并退出 2；JSON 可解析但字段校验失败显示 `计划不合格` 并退出 2，目标仓未知属于后者；dry-run 的退出 0 只代表静态校验通过，允许修正 JSON 后重试。输入对抗面须说明非法或超长到无法读取的 JSON 不会创建任务，空必填字段、非法 `base_sha`、未知仓库被拒；重复和依赖冲突见 S-2。

### S-2
对应：I-2。仅在同一 README 小节给出可解析的两任务批次 JSON：先定义前置 `key`，后项 `depends_on` 使用该前置 key 的数组，顶层带 `project_id` 或 `project` 中的一种；两项都为 `repo: "cecelia"` 或明确继承顶层 `repo: "cecelia"`。写清同批 key 会按已建 ID 替换、前向未知依赖、重复 key、缺项目以及 `project_id` 与 `project` 同时给出时拒绝；同时提醒当前实现可能放过字符串依赖，真实提交中途异常时须按 S-3 查账。依赖就绪须按 `packages/brain/scripts/coding-workflow/runner/lib/deps.mjs` 原样描述：前置先要 `status=completed`；可定位 PR URL 且无 `result.merged=true` 捷径时，GitHub `MERGED` 才就绪，`OPEN`/未知等待，`CLOSED` 拒绝；无 PR URL 或 `result.merged=true` 时源码直接就绪。正常 coding 任务仍应保留真实 PR URL 供外部核验，不把单纯 `completed` 说成 GitHub 已合并。依据还包括 `new-task.mjs` 的 `validatePlan`、`body` 和 `runner/lib/plan.mjs` 的 `depsOf`。

验证：`node` 解析 README 两任务 JSON，断言有序 key、后项 `depends_on` 为引用前置 key 的数组、项目字段恰好一类；逐条对照上述源码的 `depends_on_unknown`、`key_duplicate`、`project_required`、`project_conflict` 和 `depState` 分支，并核对字符串 `"a"` 可通过当前依赖校验却在真实提交的 `body()` 中因 `.map()` 异常退出。失败语义：上述静态计划冲突退出 2、不建任务，修正后可重试；字符串依赖不受此前保证，按 S-3 的异常无 ID 核账规则处理；运行中依赖未就绪时 runner 不认领、可待下一轮，前置失败或 PR `CLOSED` 不自动放行。输入对抗面：重复 key、前向引用、未知 key、互斥项目字段按现有校验拒绝，不臆造并发或跨批去重保证。

### S-3
对应：I-3。仅在 README 说明真实去掉 `--dry-run` 后会向 Brain 写 project（若选择新建）和任务；现有校验通过后逐条提交，中途失败可能已经产生部分任务。成功返回 `[{key,id,title}]`；打印失败响应时同时核对错误对象可能含的 `id`（尤其 `task_route_mismatch`）及 `已建` 数组，按所有 ID 查账。若命令异常退出、没有返回 ID 或 `已建` 数组，则按项目和任务的标题等已知信息只读核对 Brain 实账，确认实际已建范围后再决定处理；任何中途失败均禁止整批盲重跑。保留原“运行回执如何判读”小节和既有安全边界，不执行真实建单。真实调用方 shape：`new-task.mjs` 的 `postJson` 先以 `POST /api/brain/projects`（仅 `project` 分支，JSON `name`、`description`），再以 `POST /api/brain/tasks` 逐项发送，header `content-type: application/json`，body 含 `task_type: coding_workflow`、`mutation_intent: write`、`change_kind`、`repo_hint`、`map_scope_hint`、`title`、`description`、`priority`、`trigger_source: manual`、`payload`（`coding_workflow`、`repo`、`gp_anchor`、`acceptance`，有依赖时含 ID 数组 `depends_on`），可选 `project_id` 与 `base_sha`；该脚本没有自行附鉴权 header，其连接及鉴权由实际运行环境和 Brain 端控制，手册不暗示匿名接口可用。出处：`packages/brain/scripts/coding-workflow/new-task.mjs` 的 `body`、`postJson`、`main`。

验证：读取 README 与 `new-task.mjs`，断言真实提交、部分创建、有返回 ID 时双重核账、异常无 ID 时按项目和任务信息只读查账及不盲重跑描述都存在；确认原回执小节全文按原字节和先后顺序保留。失败语义：POST 失败或路由回显不符退出 1；`depends_on: "a"` 可在第一项建成后于第二项 `body()` 抛错，终端没有 `已建` 数组，不能据此推断没有建单；已产生的 ID 不自动撤销。输入对抗面：脚本只做现有计划校验；重复执行、并发提交或网络响应未知时可能重复建单，须先按返回信息及 Brain 实账核查，不写成自动去重。

### S-4
对应：I-4。发布前 verify 只读 `01-intent.md` 与真实仓库/源码，使用固定 `16a9032b8aed2ab8dfa65cc80b32f0321a76e9bd` 到当时 HEAD 的完整差异，连同暂存区、工作区和全仓未跟踪清单核范围；先枚举全仓未跟踪，再仅排除实际属于本任务 `sprints/10242049-cw-f2980a63/` 的流水线记录。产品编辑限 README；该基线 README 的原文字节和顺序均保留，允许间插新段；发布前 `.implementation-source-relations.json` 相对基线零差异。verify 不因临时隐藏的 `03-build.md` 判漏产，也不读取其它 sprint 报告，不预验尚未发生的阶段。实现者只编辑 README；报告由流水线按原合同产生；模型不得直接编辑、暂存、提交 manifest。验证命令由发布前 verify 真实执行并保留原生命令、完整输出、退出码：`git diff --name-status <固定基线> HEAD`、`git diff --cached --name-status`、`git diff --name-status`、`git ls-files --others --exclude-standard`、`git show <固定基线>:packages/brain/scripts/coding-workflow/runner/README.md` 和 `git diff <固定基线> HEAD -- .implementation-source-relations.json`；原文保留需按字节子序列且顺序核对，不要求连续。任一越界或证据缺失即失败，不得用当前干净 HEAD 或未来 QA 重跑替代发布前现场。

### S-5
对应：I-4。发布后产品 QA 对每个当前固定 HEAD 重新从同一 initial base 完整枚举 Git DAG 的每个提交和逐路径差异、暂存区、工作区及全仓未跟踪文件；分清本任务自产 README、真实本轮报告、可信控制器按准确 `path`/`owner_path=packages/brain/scripts/coding-workflow/runner/run-once.mjs`/`role=documentation` 新增的 manifest 来源行，以及经过证明的 main 同步。不能改用浮动 main、最近 merge-base 或最终 diff 减 main。QA 结合当前 Git 内容与可信同步事实投影，独立核 README 产品内容、原文字节与顺序、允许路径和逐提交归属；投影缺失或不符就 `CANNOT_VERIFY`/失败。上游若触本任务 README/报告，即使再 revert，仍拒绝；未知自产路径、模式变化或删除也拒绝。可信 source gate 另核最早真实 intent 输入 HEAD 起的 registration→stage→native 链、每个同步提交精确两父、独立真实 main ref 的前后原生采样、共同基线、逐 blob/mode 全 tree、受保护 local controller merge 凭证、manifest 以真实 main 历史为底的确定性结果；QA 不读保护根、不重跑控制器。`local_controller_merge_only` 不代表 push、QA/CI 或 GitHub 合并；推前观察、旧批准撤销、push、正式 CI 与合并由实际 ci_fix 和终态门另验。每个新 HEAD 必须重新真实 QA、裁判、预览、正式 CI。过去失败报告、草稿、原生记录不删改、不补写；当前轮所有真实执行含失败、修正、重复、零字节输出均由可信控制器按原生命令、完整输出、退出码有序编入最终 05 报告，模型自填输出须完整验真，FAIL/CANNOT_VERIFY 不被编译为 PASS；`aggregated_output` 只证明实际捕获字节。QA 只依据本轮可信控制器提供的 `03-build.md`、`04-evidence.md` 临时隐藏事实解释当前可见缺项，并明确记录“恢复尚未发生”；会话后控制器按原字节及模式恢复，独立裁判核本任务/轮次/HEAD/原生会话绑定和保护凭证，缺证、第三文件缺失、内容或模式变化均失败。A11/B 绑定、C01-C12、正式合并、Brain 终态、Learning 回读与下一 tick 预览回收仍由相应后续门及外层观察者在实际发生后核验，当前 QA 不预判。

验证：QA 当轮执行 `git rev-list --parents --topo-order <固定基线>..HEAD`、`git diff --name-status <固定基线> HEAD`、`git diff --cached --name-status`、`git diff --name-status`、`git ls-files --others --exclude-standard` 和必要的逐提交 `git show --format=fuller --name-status <sha>`、逐 blob/mode `git ls-tree`/`git cat-file`；逐项与当前可信投影核对。source gate 与会话后裁判各执行其原生来源核验，不能由 QA 的静态范围命令替代。

## QA 场景

### Q-1
对应: I-1
前提: 本 PR 当前固定 HEAD 的 README 和 `new-task.mjs` 可读；无需服务、账号或已有任务。
操作: 在仓库根用 `node` 只读提取 README“提交编码任务”里的单任务 JSON 代码块并 `JSON.parse`，逐字段检查 `title/change_kind/map_scope_hint/acceptance/repo/gp_anchor`；读取同一 HEAD 的 `new-task.mjs` 与 `runner/lib/repos.mjs`，对照 `main` 的读取/解析 `catch`、`validatePlan` 错误分支、`parseArgs`、dry-run 分支及 `resolveRepo`。核对文档命令确为 `node packages/brain/scripts/coding-workflow/new-task.mjs <plan.json> --repo cecelia --dry-run`，分别检查文件读取或 JSON 解析失败、可解析计划的空字段与未知 repo 校验失败、`base_sha` 格式与真实 commit 区别的说明。静态断言任一缺项即退出非零并留下原生命令、输出、退出码；不运行该 CLI。
期望: JSON 可解析，字段和命令齐全，README 明示 dry-run 不建单、不证明真实提交或 base SHA 存在；仓库优先级与源码一致，读取或解析失败对应 `读不了计划文件`/退出 2，字段校验失败对应 `计划不合格`/退出 2，用户可按实际提示排查。缺项或矛盾即本场景失败。

### Q-2
对应: I-2
前提: 同一当前 HEAD 的 README、`new-task.mjs`、`runner/lib/deps.mjs` 与 `runner/lib/plan.mjs` 可读。
操作: 用 `node` 只读提取两任务批次 JSON 并 `JSON.parse`；断言第一个 key 先出现、第二个 `depends_on` 为引用它的数组、项目字段恰好一种。逐条对照 `validatePlan` 中未知/前向依赖、重复 key、缺项目、项目冲突的拒绝分支、字符串依赖的校验缺口及 `deps.mjs` 中 `completed`、PR URL、`result.merged`、`MERGED/OPEN/CLOSED/未知` 分支；文档每少一个现行分支即令静态断言非零退出。
期望: 示例可解析且结构合法；用户能读到每种拒绝或等待结果、字符串依赖的现有风险，以及无 PR URL、`result.merged=true` 的直接就绪现状和保留真实 PR URL 的建议；不会把 `completed` 单独解释为 GitHub 已合并。

### Q-3
对应: I-3
前提: 同一当前 HEAD 的 README 与 `new-task.mjs` 可读；不配置 Brain 写入权限。
操作: 用 `node` 静态断言 README 描述去掉 `--dry-run` 后的真实 POST、成功 ID 数组、有失败响应时已建数组与失败对象自身 ID 双重核查、异常无 ID 时按项目和任务信息只读查 Brain 实账、任何中途失败不整批盲重跑；逐字段对照 `validatePlan` 对字符串 `"a"` 的遍历、`body` 的 `.map()`、`postJson`、`main` 的真实请求 shape。再只读检查原“运行回执如何判读”小节原文字节与顺序仍在，且手册保留不访问生产、不真正建单的边界。
期望: 文档与真实 `POST /api/brain/projects`、`POST /api/brain/tasks` shape 和退出语义相符；部分提交、`task_route_mismatch` 返回 ID 及异常无返回 ID 均有核账说明，用户不会把终端没有 `已建` 数组误判为零建单；原回执判读内容仍可读。本轮不产生任务记录。

### Q-4
对应: I-4
前提: QA 在本 PR 预览阶段、当前固定 HEAD 的真实仓库运行；固定 initial base 为 `16a9032b8aed2ab8dfa65cc80b32f0321a76e9bd`。可信控制器向 QA 提供本轮实际同步事实投影及 `03-build.md`、`04-evidence.md` 临时隐藏事实；没有提供的事实不得补造。QA 只读 `01-intent.md`、`02-spec.md`、允许的前轮裁决和实际 Git，不读 `03/04` 或旧 QA 自述。
操作: 记录 `git rev-parse HEAD`；运行 `git rev-list --parents --topo-order 16a9032b8aed2ab8dfa65cc80b32f0321a76e9bd..HEAD`、`git diff --name-status 16a9032b8aed2ab8dfa65cc80b32f0321a76e9bd HEAD`、`git diff --cached --name-status`、`git diff --name-status`、`git ls-files --others --exclude-standard`，先保留全仓未跟踪清单再逐项归属本任务实际流水线记录。对每一提交以 `git show --format=fuller --name-status <sha>` 查路径与父节点，并按需以 `git ls-tree`、`git cat-file` 核字节和模式；从固定基线 README 读取原文字节，验证当前 README 保留其子序列和先后顺序且新增内容限任务小节。将 manifest 的新增来源行与真实 sprint 路径、owner、role、历史不动及可信投影逐项核对；如有 main 同步，逐提交比对投影和 Git，检查两父及 README/本任务报告整个上游历史未被触碰，不用最终差异相减放行。只记录本轮 03/04 的可信隐藏事实、当前可见工作区和“恢复尚未发生”，不读取保护根或自行重建文件。保存所有本轮实际原生命令、完整输出、退出码，包括失败、重测、零字节输出；任一投影或现场证据缺失如实判不能验。
期望: 当前 HEAD 的完整 DAG、全量范围及本任务产品内容可独立核实；仅准确自产路径与已证明同步可归属。越界、改后 revert、缺投影、模式/字节异常或第三文件缺失均不能通过。当前 Q-4 只给本轮可见事实结论，不声称发布前 manifest 零差异、03/04 已恢复、后续 CI/合并等已发生；这些分别由当时 verify、会话后控制器/裁判、source gate 和终态观察者根据原生证据核验。最终 05 报告必须有当前轮完整有序原生全账，旧轮 FAIL/CANNOT_VERIFY 及其原始证据保持不动。

## 铁律对照

- INV-02d8e749：S-5、Q-4 覆盖；文档任务不缩减独立 QA、裁判、预览和正式 CI 的原有闭环。
- INV-2fe86d34：S-4、S-5、Q-4 覆盖；运行事实与报告来源按真实阶段、HEAD 和控制器回执追溯。
- INV-e5ab4826：S-3、Q-3 覆盖；手册区分仓库、任务账、运行账和版本记录，不以回执代替实账。
- INV-ff177feb：不适用：本次不修改或运行 coding workflow 回归 smoke 的生产保护退出码。
- INV-696c9f96：S-1、S-3 覆盖；只描述当前 coding workflow runner 及其 CLI，不混称旧代际。
- INV-edbf1fb9：不适用：未改变候选出口或 PR handler。
- INV-3529e88f：S-5、Q-4 覆盖；范围与来源用原生 Git 和可信控制器证据机械核对，不信模型 PASS 措辞。
- INV-f2d2f383：不适用：未改变 Golden Path 步序覆盖算法。
- INV-15e28dee：不适用：未改候选止损闸或 head_sha 判定代码。
- INV-c906dd6c：S-1、Q-1 覆盖；静态断言按非零失败设计，不拿未执行的 vitest/dry-run 冒充通过。
- INV-3b9804e6：S-5、Q-4 覆盖；若 QA 需临时断言脚本，使用本轮会话独享路径，避免并发互踩。
- INV-26886b60：S-5、Q-4 覆盖；终态仍核精确 PR head 与 QA/裁判 HEAD，提前合并不豁免漂移检查。
- INV-09fb5c69：S-5、Q-4 覆盖；正式 CI 不能替代独立产品 QA、裁判及完整交付清单验收。
- INV-3c30394c：S-3、S-5、Q-3、Q-4 覆盖；本次只验证文档与静态 CLI 合同，真实写 Brain 等未执行链路如实列在下节。
- INV-564802ee：S-1、S-3、Q-3 覆盖；示例不含凭据，静态核查不读取或输出密钥。
- INV-50954d28：S-3、Q-3 覆盖；仅记录脚本实际不附鉴权 header，未真调用接口，不宣称匿名端点可用。

## 未覆盖真实链路

- `new-task.mjs --dry-run` 未在当前 QA 的 evaluate 命令许可内执行；QA 只读最终 README 和当前源码，静态断言到 CLI 合同，未声称运行成功。
- 正式 Brain 建 project/任务、部分失败后的按 ID 查账、runner 后续认领与 GitHub PR 状态查询均未真执行；本次不访问生产、不建单，QA 只验到 README 与真实源码一致。
- 发布前暂存区、工作区、全仓未跟踪和 manifest 零差异属于当时 verify 的现场；当前 QA 只核当前 HEAD 与现存范围，发布前原生命令/输出/退出码缺失时由原阶段及终态如实失败，不能重建。
- QA 会话结束后的 03/04 原字节及模式恢复、保护凭证核验、最终 05 原生全账装配、未来新 HEAD 重验、正式 CI、实际合并、Brain 终态、Learning 全文回读及下一 tick 预览回收，须实际发生后由控制器、裁判、source gate 与外层 C01-C12 分别核验；当前 QA 只验本轮可见 Git 和可信投影。
- A11 独立 C01-C11 全 PASS 后才可正式绑定并创建 B，B 完整闭环后才可判 C12；本次 README QA 不创建或替代这些任务与历史事实，旧 A/A2–A7 失败记录保持原样。
