---
task_id: 800eef4e-14b4-4532-a545-5c2d5cee53c6
step: spec
upstream: ["01-intent.md#I-1", "01-intent.md#I-2", "01-intent.md#I-3", "01-intent.md#I-4", "01-intent.md#I-5"]
---
# 实现规格：旧承诺引用与材料状态

### S-1
对应：I-1、I-2。先按 01 中后列出的十二个完整 SHA，在实际新 base 上依序接入必要实现、永久 RED 与修复提交；旧准备候选的九个短 SHA 不再执行，A 已合并部分不重复接入。保留来源提交的真实归属和固定 Git 原文字节，不复制旧 sprint 或 04 证据。修改 `packages/brain/scripts/coding-workflow/lib/baseline-context.mjs`、`lib/authority-refs.mjs`、`lib/claude.mjs`、`prompts/repo-rules/cecelia.md`、`activities/spec.mjs`、`activities/spec-review.mjs`：沿用 `loadBaselineContext/renderBaselineContext`，让 spec、spec-review、spec-revise 读同一 A 批固定基线；稳定规则锚点来自原 repo-rules 真身，不能用 I-n 充当规则 ID。资料正文只作为不可信数据展示，绝不执行其命令；通过固定 revision 的 Git 原文字节和摘要绑定，不能再读浮动工作树。`renderPrompt` 仅扫描原模板占位符，按字面值插入变量；旧规则原文含 `{{SPEC_PATH}}` 等其他变量名时不得再次展开，模型收到的正文须与固定 Git 原文字节一致。受管对象关键缺项失败关闭，legacy/unconfigured 明确标识未知并维持旧行为。真实调用方 shape：runner 经活动子进程标准输入送 JSON 信封，字段含 `task_id`、`worktree`、`sprint_dir`、`intent_ids`、`intent_sha256`、`repo_profile`、`budget`；`activities/spec.mjs` 与 `activities/spec-review.mjs` 的 `runActivity` 接收，出处为 `runner/lib/executor.mjs` 和 `lib/protocol.mjs`，无 HTTP header 或独立鉴权字段，授权由 runner 活动信封及文件边界承担。失败语义：缺失/不可信固定基线返回结构化失败且不进入下一棒，可在修正来源后重试；legacy 仍按既有流程走。输入对抗面：伪 revision、伪摘要、路径穿越、超大正文、重复引用及并发修改均按固定版本和既有边界拒绝或去重，不能退回读取当前文件。验证：发布前 verify 以 `CODING_WF_TEST_TRANSPORT=ipc npm exec --workspace cecelia-brain -- vitest run scripts/coding-workflow/__tests__/baseline-context.test.mjs scripts/coding-workflow/__tests__/baseline-prompt.test.mjs scripts/coding-workflow/__tests__/claude.test.mjs --maxWorkers=1 --minWorkers=1` 的本轮原生命令、完整输出、退出码核实；另用含字面量 `{{SPEC_PATH}}` 的固定原文，核 spec、review、revise 三次实际模型提示与 `git show <固定SHA>:<路径>` 的原文字节及摘要，独立 judge 核实际证据。候选来源核固定 initial base、完整 DAG 与逐提交归属；发布前当时的暂存区、工作区及全仓未跟踪范围由 verify 留存真实原生命令、完整输出和退出码，缺证不通过。

### S-2
对应：I-1、I-2、I-3、I-5。修改 `packages/brain/scripts/coding-workflow/lib/spec-materials.mjs`、`lib/spec-check.mjs`、`activities/spec.mjs`、`activities/spec-review.mjs`，复用单一 `parseMaterialPlan/materialPlanErrors` 校验入口，spec 生成后与 review/revise 改写后都调用它。02 的唯一「旧规则与材料计划」JSON 对受管基线逐项列出权威 ref、状态、理由、确认依据、验证方式及 I/S/Q 关联；状态仅 `keep/update/retire/conflict/not_applicable`。完整性以可信基线集合为准，拒绝遗漏、凭空规则、重复或不存在的 S/Q、无依据 update/retire、未批准 retire、未解决 conflict、未知状态、缺理由/验证/引用；明确批准的 retire 与有理由的 not_applicable 可继续，批准仅接受冻结 I 段显式 ref/rule 语句，未知写法失败关闭，不能自签。检查器只证明结构与可核对授权，不宣称已完成独立语义审查；语义审查须拿固定原文、冻结批准依据及实际 02 差异判读。保持 `lib/gan.mjs` 原预算与 FORCED 策略，结构缺口不能因评分或 FORCED 放行。真实调用方 shape 同 S-1，检查器由 `activities/spec.mjs` 生成后和 `activities/spec-review.mjs` 每轮修订后在进程内调用，不新增对外 HTTP 接口。失败语义：缺项和无授权返回稳定错误码，活动返回 `retryable/spec_invalid` 供同一阶段修订；可信来源失效或伪造不按评分放行。输入对抗面：空集、过深/过大 JSON、长字段、重复 ref、恶意正文、未知状态和并发写入都受解析边界与单一固定基线约束。验证：发布前 verify 真跑 `CODING_WF_TEST_TRANSPORT=ipc npm exec --workspace cecelia-brain -- vitest run scripts/coding-workflow/__tests__/spec-materials.test.mjs scripts/coding-workflow/__tests__/spec-check.test.mjs scripts/coding-workflow/__tests__/managed-spec-activity.test.mjs --maxWorkers=1 --minWorkers=1`，并对受控候选逐项实际运行共同检查器和活动调用，核输入候选、稳定错误码及没有进入下一棒；独立 judge 核原生命令、完整输出、退出码和原文差异。当前产品 QA 只核预览真实产出的 02 与活动回执，不负责注入负例候选。

### S-3
对应：I-1、I-2、I-3。修改 `packages/brain/scripts/coding-workflow/prompts/spec.md`、`prompts/spec-review.md`、`prompts/spec-revise.md`，只加入固定旧承诺原文、材料状态处理、确认依据与差异审查指令，不新增 agent 角色、业务规则库或模型自行签批。review/revise 每轮看到相同冻结引用；review 可指出字段齐全但语义遗漏，revise 只修改 02 和既有响应文件。`activities/spec-review.mjs` 保持原收敛、花费和 FORCED 行为；结构错误必须阻断下一阶段。验证：发布前 verify 真跑 `CODING_WF_TEST_TRANSPORT=ipc npm exec --workspace cecelia-brain -- vitest run scripts/coding-workflow/__tests__/spec.test.mjs scripts/coding-workflow/__tests__/spec-review.test.mjs --maxWorkers=1 --minWorkers=1`，并由独立 judge 对固定原文、批准依据和实际差异做语义审查；fake-provider 回归只证明软件传递，不冒称真实模型理解。

### S-4
对应：I-4。修改 `packages/brain/scripts/coding-workflow/prompts/spec.md`、`lib/spec-materials.mjs`、`lib/spec-check.mjs`，要求生成的 02 同时含旧规则计划及材料更新表，逐项说明 spec、implementation、sample 更新或保留的理由与验证方式，并关联 I/S/Q；索引仅存权威引用，规则真身仍在原位置，不另建 `plan.md`，原 I/S/Q、铁律、真实调用方 shape 的检查保持。材料状态与文件动作分别表达，不能因 `not_applicable` 自动抹去应有引用。验证：发布前 verify 在 `spec-materials.test.mjs` 与 `spec-check.test.mjs` 中核完整表、缺材料项、缺验证方式及旧格式兼容；独立 judge 核实际 02 的描述与固定材料一致。

### S-5
对应：I-5。修改 `packages/brain/scripts/coding-workflow/__tests__/baseline-context.test.mjs`、`spec-materials.test.mjs`、`managed-spec-activity.test.mjs`、`baseline-prompt.test.mjs`、`spec.test.mjs`、`spec-review.test.mjs`、`spec-check.test.mjs`、`claude.test.mjs`；先提交真正失败的行为断言，再提交实现及修复，测试真实引用模块、覆盖合法 keep/批准 update/批准 retire/有理由不涉及、遗漏/冲突/缺确认/伪造/无效 S/Q/旧任务；`claude.test.mjs` 断言先插入正文中的 `{{SPEC_PATH}}` 不二次展开，`baseline-prompt.test.mjs` 断言三阶段提示均保留固定原文。完整八组命令：`CODING_WF_TEST_TRANSPORT=ipc npm exec --workspace cecelia-brain -- vitest run scripts/coding-workflow/__tests__/baseline-context.test.mjs scripts/coding-workflow/__tests__/spec-materials.test.mjs scripts/coding-workflow/__tests__/managed-spec-activity.test.mjs scripts/coding-workflow/__tests__/baseline-prompt.test.mjs scripts/coding-workflow/__tests__/spec.test.mjs scripts/coding-workflow/__tests__/spec-review.test.mjs scripts/coding-workflow/__tests__/spec-check.test.mjs scripts/coding-workflow/__tests__/claude.test.mjs --maxWorkers=1 --minWorkers=1`。发布前 verify 必须自己执行并保存原生命令、完整输出、退出码，不取旧日志或旧 PASS；独立 judge 核软件证据。若实际改到 `packages/brain/src/**/*.js`，按仓库门禁补真实配套测试、smoke 和 allowlist；本规格不要求无关 src 改动。正式 PR、每个新 HEAD 的真实 QA、judge、预览与正式 CI，以及合并读回，由发布后监督与终态门在实际发生时核，verify 不能预填成功。

## 材料更新表

| 材料 | 本批动作 | 理由与验证 |
|---|---|---|
| 原 repo-rules 与 A 固定基线 | 保留原文和权威引用，接入共同读取 | `git show` 原文字节与摘要核对；不搬运规则真身 |
| 02 规格及三个提示 | 更新旧承诺 JSON、材料表与阶段提示 | 检查器和独立语义审查均对 I/S/Q 与原文差异 |
| coding-workflow 实现 | 接入共同解析、校验和活动阻断 | 八组本轮 IPC 回归及活动真实调用 |
| 样本与测试夹具 | 更新受管正反例，保留 legacy 兼容例 | 正反例错误码、固定版本和旧任务行为断言 |

## QA 场景

以下场景均由发布后的监督端预置隔离真实 Git 仓库、受控 Brain 预览服务、真实 activity 子进程与独立任务槽；正式 QA 只读 `/Users/administrator/research/coding-B-formal-qa/formal-resource-index.json` 的公开 manifest/client preload 和预声明 request。入口须记录实际 task_id、固定候选 HEAD、nonce、manifest 摘要、PID、锁和期限。QA 按公开预声明请求经原预览客户端 POST 任务，再 GET 真实输出；不把索引路径冒充 evaluate 参数，不直接运行受保护活动，不写私有来源根，不读本任务 03/04 或旧 QA 自述。资源未 ready 则相应场景为 `CANNOT_VERIFY`，不能由 QA 编造。接口地址由客户端从资源取得，若显式呈现 Brain 路径一律为 `<预览环境>/api/brain/...`；HTTP header、body、鉴权均沿资源中原客户端的实际请求，不新增自造 shape。

### Q-1
对应: I-1,I-4,I-5
前提: 监督端按上述绝对入口提供 ready 资源、固定 HEAD 和两个可独立使用的任务槽；每槽预置独立真实 Git、四类权威 ref 和含字面量 `{{SPEC_PATH}}` 的固定原规则输入，且公开预声明的合法 keep、批准 update、批准 retire、有理由 not_applicable 请求。QA 只读核 manifest 与客户端绑定的 HEAD/nonce/摘要及有效期。
操作: QA 使用入口公布的原 preview client preload 和预声明 request，向其给出的 `<预览环境>/api/brain/...` POST 第一槽实际任务，再按客户端给出的 GET 路径轮询输出；读取实际生成 02、公开固定原文与批准语句，逐条比对规则 ref、状态、I/S/Q、材料更新表及验证方式；只读核当前候选固定 initial base、完整 DAG、逐提交归属、当前暂存区/工作区及全仓未跟踪范围，并核资源声明的来源与隔离边界。
期望: 实际活动完成；02 对每条权威旧承诺均有唯一记录，批准 update/retire 保存冻结依据，有理由不涉及保存理由；材料表覆盖 spec、implementation、sample 的更新或保留及验证，不新增 plan.md。QA 可独立看见原文、候选 02、批准依据及差异，公开固定原文中的字面量 `{{SPEC_PATH}}` 保持原样，02 对该规则的引用和处理不出现由占位符展开导致的路径改写，不能只以 JSON 字段齐全判语义正确；当前 Git 来源和隔离状态可核。实际模型提示字节由发布前 verify 与独立 judge 核，QA 不读旧 03/04 或以当前现场替代发布前现场。

### Q-2
对应: I-2,I-3,I-5
前提: 同一正式入口提供 ready 的第二个独立任务槽、固定 Git 基线、冻结批准依据及预声明的受管对象正常请求；QA 不编辑权威资料或候选 02。
操作: QA 用入口公布的原 preview client POST 第二槽实际任务并 GET 活动回执与生成的 02；逐条对照公开固定原文、批准依据、材料计划及实际阶段状态，记录真实出现的缺口或拒绝。
期望: QA 可见的 02 对受管基线逐项给出有效 ref、状态、理由、验证方式及 I/S/Q 关联；明确批准的修改或退役保留确认依据，有理由的不涉及不丢引用；实际出现的未授权改废或未解决冲突不得进入 build。遗漏、伪造、无效 S/Q、缺确认等受控负例由 S-2、S-5 的发布前真实检查器和活动调用逐项验证，独立 judge 核证；当前 QA 不以正常请求必然生成负例为前提。

### Q-3
对应: I-1,I-2,I-3,I-5
前提: 正式入口提供 ready 的真实活动请求及固定原文、冻结批准依据、候选 02 差异；监督提供的模型能力若不能真调用须明确标记，QA 不以 fake-provider 代替。资源身份、HEAD、nonce、期限均只读核实。
操作: QA 用原 preview client POST 受管对象的预声明正常请求并 GET 实际 spec/review 产物；在真实输出中对照同一固定基线是否贯穿 spec、review、revise，并手工审阅一个结构齐全但含语义遗漏的差异及 review 的判断。
期望: 三阶段读取一致的固定原文与批准依据；review 能指出语义遗漏而不把结构合格当完整，revise 保留冲突并按批准依据处理；原 GAN 预算/FORCED 行为未变，结构缺口始终阻断。若正式资源未提供真实模型语义能力，只能记录软件链可见结果和 `CANNOT_VERIFY` 的语义条件。

### Q-4
对应: I-2,I-5
前提: 正式入口提供 ready 的预声明旧任务请求及独立槽或重置方式；公开入口能读回旧任务的活动状态。
操作: QA 用原 preview client POST 旧任务请求并 GET 实际产物与活动回执，核对 legacy/unconfigured 标记、既有流程状态及与第二槽的隔离结果。
期望: 旧任务明确显示 legacy/unconfigured 并保持兼容，两个任务槽产物不互相污染。空集、过大/过深 JSON、重复 ref、伪 revision/摘要和过期 nonce 的受控边界输入由发布前 verify 对真实检查器及活动调用核验，独立 judge 读原生命令、完整输出和退出码；当前 QA 不向受保护活动注入候选，也不以正常模型输出推断负例已测过。

## 铁律对照

- INV-818af041：S-1、Q-1 覆盖（沿用现有术语、规则锚点和协议，不另造业务层级）。
- INV-3a390000：S-5、Q-3 覆盖（候选验证、QA、judge 与正式 CI 实际通过后才由既有门晋级）。
- INV-91e9abe3：S-1、S-3 覆盖（coding 会话沿既有本机模型通道，不向其他机器扩散）。
- INV-3859041e：S-1、S-3 覆盖（只复用既有 coding 活动通道，不复活已关停桥接）。
- INV-067867c8：S-1 覆盖（不调用本机 :3457 旧桥）。
- INV-696c9f96：S-3 覆盖（保持现有 coding commander、spec/review/revise 角色边界）。
- INV-02d8e749：S-2、S-3、Q-3 覆盖（GAN 原收敛、独立 QA/judge 及阶段门不缩减）。
- INV-0dc6b84f：S-3 覆盖（沿现有本机 coding 模型别名，不写死新版本）。
- INV-ac7c8801：S-3 覆盖（按其后修订 INV-0dc6b84f 保持 MMV 执行，不另换执行地）。
- INV-ae4b4428：S-2、Q-2 覆盖（材料缺口由共用检查器活动内阻断）。
- INV-b3a8bf82：S-1、S-4 覆盖（仓库保存规则真身与版本引用，运行证据仍归既有活动账）。
- INV-e5ab4826：S-1、S-4 覆盖（复用既有树、仓库、任务和运行结构，不建平行规则库）。
- INV-3529e88f：S-2、Q-2 覆盖（结构覆盖由代码闸判，不依赖模型自愿承认）。
- INV-f2d2f383：S-2、Q-2 覆盖（I/S/Q 按稳定编号核对，不按措辞猜覆盖）。
- INV-5e125909：S-1、Q-1 覆盖（固定来源和 QA 地址均从真实资源取得，不写死环境值）。
- INV-3c30394c：S-5、Q-3 覆盖（真实活动和语义未真验时不能标已完成）。
- INV-564802ee：S-1、Q-1 覆盖（资源凭据只由受控客户端使用，规格与日志不写 key）。
- INV-459b6ff9：S-1、Q-1 覆盖（公开产物仅保留必要规则与摘要，不输出客户隐私）。
- INV-50954d28：S-1、Q-1 覆盖（沿原 preview client 的授权请求，不新开无鉴权端点）。
- INV-dc18d43d：S-2、Q-2 覆盖（生命周期阻断是代码判断，模型只做合同创造和语义审查）。
- INV-09fb5c69：S-5、Q-3 覆盖（CI 绿不代替真实 QA 与独立 judge）。
- INV-c906dd6c：S-5 覆盖（验证命令使用仓库实际 vitest include 路径，由 verify 真跑并核退出码）。
- INV-8d92f7b1：S-5、Q-1 覆盖（不照搬前次失败证据，按本次真实阶段与任务槽判定）。
- INV-26886b60：S-5 覆盖（最终实际 PR HEAD 与每次 QA/judge/CI 锚定 HEAD 由监督读回）。
- INV-7ccfa168：Q-1、Q-2 覆盖（任务槽彼此独立，单槽内请求按流程串行）。
- INV-06950012：S-1 覆盖（本批只改 Cecelia 本地 coding workflow，不放设备端 runner）。
- INV-1100cb8f：S-5 覆盖（无生产写、外发或资金动作；如后续命中仍由既有真人确认门处理）。

## 未覆盖真实链路

- 正式资源入口 `/Users/administrator/research/coding-B-formal-qa/formal-resource-index.json` 的 ready 状态、实际 task_id、候选 HEAD、nonce、manifest、PID、锁、期限、独立槽及预声明 request 均须发布后监督提供；本轮 spec 无法声明它们已存在，QA 最多核公开入口，缺项即 `CANNOT_VERIFY`。
- 真实模型的三阶段语义判断若预览资源只有 fake-provider，QA 最多核固定原文传递和软件活动输出；独立语义审查必须另用真实能力读取原文与实际 02 差异，不能以字段校验替代。
- 发布前本轮八组 IPC 测试、检查器、固定 Git 原文/候选核验及原生命令完整输出由当时 verify 和独立 judge 承担；正式 QA 不读取旧 03/04，也不能复原当时非 Git 现场，缺证时对应阶段与终态不通过。
- 正式 PR 号、最终 HEAD、预览、正式 CI、合并及报告恢复须发生后由监督控制器来源门和终态核验；当前 QA 最多验当前固定候选的产品结果，不能预证未来事实。
- C 批实际 diff 同步、D 批自动入口继承不属于本批 I-n；本批只交材料计划和受管检查。建议另立任务按原批次完成。
