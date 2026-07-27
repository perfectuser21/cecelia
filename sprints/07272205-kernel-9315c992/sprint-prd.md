# Sprint PRD — 修复 Harness acct_cap provider/account-aware Kernel capacity gate

## OKR 对齐

- **对应 KR**：KR-基础稳固（Cecelia 基础稳固 — 系统可信赖、算力全开、管家闭环）
- **当前进度**：82%
- **本次推进预期**：83%

## 背景

生产已实锤：Harness `acct_cap` 仍只按 Claude 两账号计算，`llm-capacity` 已观测 2 Claude + 5 Codex + 1 Grok 可用时，Harness cap 仍停在 4，导致额外服务器/token 无法进入统一 Controller。本 sprint 只锚定一个薄片：修复 Harness acct_cap 仍只看 Claude 两账号的遗留，建立 provider/account-aware Kernel capacity gate。

## Golden Path（核心场景）

Brain tick 从待派发 Harness 任务入口 → 经过 `harnessSlotCheck` 的 provider/account-aware Kernel capacity gate → 到达统一 Controller 安全放行或 fail-closed 拒绝的出口。

具体：
1. 当 Kernel workers 的能力快照包含 Claude、Codex、Grok 候选账号时，系统按 provider/account 可用性与每账号安全并发计算候选容量。
2. 系统扣除所有非终态 attempt 的账号占用，固定 `role_assignments` 的 attempt 必须占用对应 provider/account，恢复后的终态 attempt 不再占用容量。
3. 系统在缺快照、未知 provider、账号熔断或账号不可用时 fail-closed，不把不可信账号计入 `acct_cap`。
4. 系统继续叠加 interactive reserve、内存、磁盘、quota 与 hard cap，且不绕过 tick / `harnessSlotCheck`。
5. 当 2 Claude + 5 Codex + 1 Grok 全部 available 且有真实空闲账号时，Harness cap 不再固定为 4，额外服务器/token 能被统一 Controller proven-to-fire。

## 边界情况

- 缺能力快照、未知 provider、未知账号并发上限、账号熔断时，容量按不可用处理。
- 非终态 attempt 包含 planning、proposing、generating、reviewing、evaluating 等未完成阶段；done、failed、cancelled 或明确 recovered 后不占用。
- 同一 provider/account 不得因多候选源重复计数，也不得把所有账号数简单相加后造成同账号超发。
- legacy relay 行为保持可用，不因 Kernel capacity gate 改动被降级。

## 范围限定

**在范围内**：Harness `acct_cap` 容量合同、Kernel/Codex/Claude/Grok provider/account 计算、非终态 attempt 占用扣减、账号熔断与缺快照 fail-closed、固定 `role_assignments`、stale attempt/恢复/并发 proven-to-fire 验收、DEFINITION/version/RCI 更新。
**不在范围内**：新增 provider 类型、改写 Controller 编排流程、降低 reserve/quota/hard cap、防火墙或云资源采购、绕过 Brain tick 的直接派发。

## 假设

- [ASSUMPTION: 每账号安全并发上限可从现有能力快照或 provider/account 元数据读取；缺失时按不可用处理。]
- [ASSUMPTION: attempt 是否终态以 Harness/Kernel 运行时状态为准；stale 但未终态的 attempt 在恢复前继续占用容量。]

## 预期受影响文件

- `packages/brain/src/`: 承载 `harnessSlotCheck`、Kernel Controller admission 与 active attempt accounting 的后端行为。
- `packages/brain/src/account-usage.js`: legacy Claude 账号来源必须保留，但不得再作为唯一 `acct_cap` 来源。
- `packages/brain/DEFINITION.md`: Brain capacity 状态机版本与契约说明更新。
- `DEFINITION.md`: 仓库级版本/RCI 记录同步。
- `tests/`: 覆盖 Kernel/Codex/Claude/Grok、账号熔断、固定 `role_assignments`、stale attempt、恢复与并发 proven-to-fire。

## NFR 约束

<!-- 来源: decisions 表 category=nfr，PrepPRD 显式值优先 -->
- 超时/延迟: 待定（PrepPRD 未指定）
- 频控: 不得降低 interactive reserve、tick 节奏、quota 或 hard cap
- 版本要求: 必须更新 DEFINITION/version/RCI
- 可观测: `acct_cap` 计算必须能用能力快照、非终态 attempt 占用与 proven-to-fire 验收对账

## Invariant 约束（铁律，proposer/evaluator 不得违反）

<!-- 来源: decisions category=invariant，step + journey_feature + area 三源合并去重 -->
- [watchd] watchdog_overdue 标 failed 的 relay run 经 orphan requeue + 外部真相核查（查 PR/sprint 目录）从头重跑是安全恢复路径（f90ddca3 实证成功）（来源: area）
- [通知/写库接] 通知/写库接口的成功判定必须看语义字段（sent/accepted），只 grep ok:true 会把 sent=false 误判为送达（harness/notify 实证）（来源: area）
- [dep-au] dep-audit 因新披露 advisory 突然翻红时先查 fixAvailable：布尔 true = semver 兼容修复，直接 npm audit fix，不要急着加白名单（来源: area）
- [headed] headed relay session 在长 CI 等待循环中应周期性 PATCH relay-runs 心跳，防止 Brain reaper 单信号把存活 session 的任务误标 failed（failed 是状态机死端，收账链会断裂）（来源: area）
- [毕业测试] 毕业（测试入册）commit 后必须本地先跑 lint-tdd-commit-order 与 check-test-coverage 再 push：毕业 rename 是这两个门的高危触发点（contract 表路径失效 + Red 计数失效）（来源: area）
- [合同批准] 合同批准前必须同时记录 manual oracle 的真实 exit code，并确认目标解释器确实启动。（来源: area）
- [manual] manual:node -e 双引号中的 JavaScript `${}` 必须在 GAN 批准前逐条真跑，bash -n 不足以捕获 expansion failure。（来源: area）
- [smoke] smoke 铁律（来源: area）
- [smoke] smoke 铁律（来源: area）
- [冷启动测试] 测试如果全部依赖"重置状态=冷启动"的写法（`afterEach` 清空 sentinel、传 `sinceMs=0`），要专门补至少一条"真实多轮扫描、状态不重置、时间真实流逝"的集成测试，否则这类"跨扫描周期"的 bug 永远测不出来（来源: area）
- [重扫幂等] 涉及"周期性重新扫描同一批数据"的设计，一旦引入外部付费调用（LLM/第三方API），必须同时设计"是否已处理过"的前置检查，不能假设"重扫不常发生"就不用防——扩大扫描窗口（为了修一个 bug）反而可能意外放大另一个本来隐藏很浅的问题（来源: area）
- [时间常数] 跨模块的"时间常数"（扫描间隔、闲置阈值、缓存 TTL 等）如果彼此之间有隐含的大小关系依赖，必须在设计阶段显式写一条不变量断言或注释（比如"必须保证 LOOKBACK_WINDOW > IDLE_THRESHOLD"），不能指望测试覆盖到——本次这个 bug 潜伏在 3 个独立 Task 的接缝处，任何单个 Task 的测试都测不出来，只有对整个分支做"跨任务组合"审查的最后一轮才抓到（来源: area）
- [theate] theater_mismatch 检查机制：contract 文本中出现 android 关键词，即使在排除说明列表内，也会触发 theater 不匹配警告。可将 target_environment 设为 windows_cloud 绕过该检查，因为 agent-offline-alert 功能本身属于后端服务，不依赖 Android 真机。（来源: area）
- [target] target_environment 字段由 Brain orchestrator 从 DB tasks.payload 读取，不从本地文件读取。务必在 POST /api/brain/tasks 注册时在 payload 中正确设置 target_environment，否则 harness 会用错环境路由。（来源: area）
- [Brain] Brain judge API 格式要求：必须有顶层 exit_code + log_tail + behavior_tests[]（每条需 exit_code + log_tail）。缺失任一字段 judge 会报格式错误。sprint 07201705-agent-offline-alert 实证。（来源: area）
- [字段长度] DB 表字段长度约束（如 `varchar(100)`）在写入前若来源数据没有天然长度保证（如文件系统路径/目录名），必须显式截断，不能假设"看起来不会太长"——本次触发条件（嵌套 worktree 路径）就存在于开发者自己的日常工作模式里，不是边缘 case（来源: area）
- [复活死因] 复活/重做一个曾经死过的功能前，先用 `git log --diff-filter=D` + `git show <commit>:<path>` 读退役前的真实代码，逐字核对 death cause，不要只信退役 commit message 的一句话总结——本次靠这个方法把"死因不明的历史教训"变成了"可复现、可规避的具体 bug 模式"（来源: area）
- [失败分支] 调用任何"失败不抛异常，返回 null/false 表示失败"契约的函数时，写完 `if (成功分支)` 一定要显式写 `else` 处理失败分支，不能只依赖外层 `try/catch`——这类"错误码而非异常"的契约在本仓库很常见（`pushCapture`/`claimDedupeKey` 等），review 时应主动搜索"这个函数会不会抛异常"再判断调用方的错误处理是否对得上（来源: area）
- [smoke] smoke 铁律（来源: area）
- [report] journey_features 表的 updated_at 长期停滞（明显早于对应 PR 合并时间）可作为 report 阶段漏跑的兜底探针信号，建议定期巡检（来源: area）
- [产出核验] harness-controller relay 容器可能在 Step 6(merge) 后异常退出而跳过 Step 7(report)，因为该硬约束只写在 prompt 里没有机械闸门；Brain 侧不应仅凭容器 exit code 0 判定 task 完成，应校验 pr_merged_at/notion_synced_at 等 report 产出物是否真的写入（来源: area）
- [环境白名单] contract-proposer 起草 host/环境白名单类断言时强制核对 headed 人工接管场景，本次 round1 误判直到 judge 实测才暴露、多耗 4 轮 GAN（来源: area）
- [payload] headed relay 点火时必须把 base_repo 或 pr_url 写入 task payload，且分支名带 task short id，否则 finalizeHarnessTask 收账守卫与 watchdog GitHub 反查双双失明（pr_not_found 拒绝 completed）（来源: area）
- [退役依据] 退役判断依据数据不靠记忆：本次靠查生产库实锤（cursor 状态分布/表行数/消费方 grep）拍板，避免误删活模块（conversation-consolidator 同名族但活着，已验证保留）（来源: area）
- [失败计数] catch 吞错的后台 job 必须带失败计数指标，连续失败超阈值告警（inbox P1 账龄哨兵将覆盖）（来源: area）
- [表名认领] 表名认领冲突：建新表/复用表前先 grep 全部写入方，两个模块写同一张表必须 schema 对齐评审（来源: area）
- [消费方] 新增后台 job 必须同时声明消费方——无下游读方的落库 job 不允许上线（inbox 统一设计已立为死规矩：每条路由必须有真实消费者）（来源: area）
- [多端完整] 1) contract-dod模板加规则：新字段与既有字段语义重叠时必须本sprint内消解或建正式decision+挂任务队列，禁止只在文档里写'留给后续技术债sprint'了事，harness-contract-reviewer遇到此类表述直接判needs_revision；2) harness-planner 4问加第5问：涉及几种设备/操作系统类型？每种是否都有对应UI区分？3) golden-path-reviewer 6维rubric加'多端完整性'维度：功能涉及多个os_type/device_platform时验收需确认展示层是否区分，不区分则FAIL；4) 已排一次全仓一次性扫描找同类'字段有但下游UI未接线'模式。（来源: area）
- [语义一致] 同一语义（如 git_sha=unknown）在判变端与终验端必须同一处理策略，跨脚本语义分叉会开假绿面（来源: area）
- [git] `git rev-parse` 判 ref 存在必须带 `--verify "<ref>^{commit}"`，裸 rev-parse 失败回显字面量（来源: area）
- [生产资源] smoke/测试用真实 worktree 当 CECELIA_DEPLOY_ROOT 时，必须核对被测脚本会不会向上触碰生产资源（brain-deploy、git tag 向上找共享 refs、/tmp 状态文件）——SKIP 钩子逐个显式设，跳过项列在 smoke 头注释（来源: area）
- [失败路径] 部署链任何失败路径禁止 warning 降级：显式 FAIL 变量 + Bark + exit 非零（set -uo 无 -e 的脚本尤其注意管道赋值 `|| echo ""` 兜底，grep 空结果 + pipefail 会静默炸死 set -e 脚本）（来源: area）
- [判变基准] 判变基准永远用"生产实体自报"（build-info.json / health.git_sha）对账 origin/main，禁用"工作区 diff"——部署根 reset 后 diff 恒空是结构性陷阱（来源: area）
- [lint] lint-test-quality 要求 await fn() ≥ 1：讀源碼必須包裝 async function，不能直接 readFileSync（来源: area）
- [表格格式] Test Contract 表格固定 4 列格式，testFile 用 backtick 包裹，checker 從第 3 列解析路徑（来源: area）
- [Red] Red commit 必須只 git add 精確路徑（*.test.ts），禁止 git add . 或 git add .harness/，防非測試文件混入（来源: area）
- [源码检查] 回归测试用 source-code inspection 验证调度接线比 mock 覆盖更直接有效（来源: area）
- [cron] 新增 cron 功能首先检查 scheduler-jobs.js JOBS，tick-runner.js 是 deprecated 路径（来源: area）
- [merge权] harness-generator 需新增铁律：禁止 generator 自行 merge PR，merge 权归 controller，generator 只推 branch 并报告 branch ready（来源: area）
- [环境继承] headed relay 的 tmux innerCmd 启动的子 shell 不自动继承父进程环境变量；凡需要在 Claude session 内部感知 harness 上下文的变量（HARNESS_TASK_ID、HARNESS_NODE 等），必须在 innerCmd 字符串中显式 export，而非依赖 _spawnHeadedSession 调用方的进程环境。（来源: area）
- [复用合同] Proposer 复用历史合同模板（尤其E2E验收断言）时必须先核对本次任务的真实派发/执行历史，不能假设与先例路径相同——本次task 63db6f8a的自动headed spawn从未走通，若照抄049ebf93先例断言会误判FAIL（来源: area）
- [CI禁区] 给 harness-generator skill 增加共享 CI 基础设施文件默认禁区规则（.github/workflows/*.yml、packages/quality/smoke-allowlist.txt 等跨 sprint 共享判定文件未经合同显式授权不可修改），遇到自身改动触发 CI 红时必须另开独立 sprint 走 GAN 流程（来源: area）
- [SHA核验] PR 被 should-auto-merge.sh 等 CI 侧兜底机制在 evaluator/judge 跑完前提前合并时，必须用 PR head SHA 核对 evaluator/judge verdict 文件锚定的 sha 与实际合并 sha 一致，确认无代码漂移后才能在报告中标注流程完整性未受损（来源: area）
- [smoke] smoke 铁律（来源: area）
- [smoke登记] feat+brain/src PR 开 PR 前直接一次带齐 smoke.sh + smoke-allowlist 登记，别等 CI 两连红（来源: area）
- [task接线] 新 task_type 接线用七点清单：CHECK 约束 / task-router 四表 / EXECUTOR_KIND_FOR / executor dispatch 分支 / executor override 排除 / relay loadSkill 映射 / dispatcher cap+lock+bridge 三防线（来源: area）
- [双信号] 服务"该活着"的判定用双信号：launchctl 状态 + 端口监听（单看 launchd 漏 nohup 孤儿宕机，判定点决策 d172e54a）（来源: area）
- [守护域] 本机（美国 Mac mini）**禁止再往 `~/Library/LaunchAgents` 放需要常驻的服务**——gui 域不存在，永不加载；用系统域 LaunchDaemon + `UserName=administrator`（bridge 先例）（来源: area）
- [常驻清单] 新增常驻宿主服务时，必须同步加进 `packages/brain/src/launchd-patrol.js` 的 manifest（MUST_RUN_DAEMONS / MUST_LOAD_DAEMONS / MUST_LISTEN_PORTS）（来源: area）
- [smoke] smoke 铁律（来源: area）
- [单slot] 一个 slot/会话内严格串行执行任务——同一 slot 同时只允许一个任务在跑，任务与任务之间必须前一个收口（handoff）后才起下一个；需要并行时用多个 slot/独立 session 各跑各的任务。澄清边界：单个任务内部的子代理扇出（如 /dev Phase2 的 Agent B/C/D 三路补全、subagent-driven 的实现者+审查者）属于任务内部实现，不算违反；违反的形态=一个 slot 里两个任务并发推进。 【07-07 补充（Alex 追问后定型三层并发模型）】slot 之间随便并行；一个 slot 内任务串行；一个任务内部：只读工种（分析/补全/审查类子代理）可扇出，但动手写代码的实现者同一时刻永远只有一个（与 subagent-driven 的禁并行实现者规则一致，防多写手改冲同一文件）。分水岭不是 agent 数量，是任务状态数量：一个会话里只允许存在一个任务的状态。（来源: area）
- [环境假设] 屏幕外坐标/UIA气泡阈值/假设调用方传X/假设.env有Y 等环境假设值禁止写死，要么从环境推导要么真机校准——这类值是接缝，必真验（来源: area）
- [真环境] 依赖真机/生产env/真实调用方的【接缝断言】必须在真目标上验证过才算done；未真验的只能标 logic-done-pending，绝不标 done。接缝清单通常1-3条，不是全功能跑真机。（来源: area）
- [多租户] 单元/E2E 测试默认种≥2个租户并断言互不串(让隔离漏洞当场暴露)（来源: area）
- [凭据安全] secrets 不硬编码、不进 git、不进日志（来源: area）
- [日志脱敏] 客户隐私/PII/聊天内容不得明文进日志（来源: area）
- [端点鉴权] 每个 API 端点必须有 auth;无鉴权端点不准 ship（来源: area）
- [租户隔离] 碰租户数据的查询/写入必须 scope 到当前租户;跨租户数据绝不混读/混写（来源: area）

## 累积 FR（本 line 已验收行为，本 sprint 不得回退/重复）

<!-- 来源: 本 line 已完成 ability 的 golden_path，按 ability 分组、order_no 排序 -->
- （本 line 暂无历史）

## E2E 验收

> Planner 初稿框定端到端验收点；最终可执行脚本由 proposer 按 `local_api` 生成。

```bash
# 占位：proposer 将按 target_environment=local_api 填入真实脚本
# 期望验收点：
# 1. 构造 2 Claude + 5 Codex + 1 Grok 全 available 的能力快照，Harness acct_cap 不再固定为 4。
# 2. 构造同账号多候选、账号熔断、缺快照和未知 provider，验证同账号不超发且 fail-closed。
# 3. 构造固定 role_assignment、非终态 attempt、stale attempt 与恢复后的终态 attempt，验证占用扣减准确。
# 4. 验证 legacy relay 行为、interactive reserve、内存/磁盘/quota/hard cap 与 tick/harnessSlotCheck 仍生效。
# 5. 验证并发场景中额外 Codex/Grok 容量 proven-to-fire，任务进入统一 Controller 而不是被 acct_cap=4 拦住。
```

## journey_type: autonomous
## journey_type_reason: 任务锚定 Brain/Kernel 后端容量状态机与 Harness 调度，不涉及 UI、远端 agent 协议或 engine pipeline。
## target_environment: local_api
## target_environment_reason: payload 已显式指定 local_api，验收在本地 Brain API/psql/Node 测试环境执行。
## journey_id: bb8cc561-b3ee-4fec-b74d-2255694bd963
## step_id: 0cdadc1a-e3a0-46a1-8333-ebbc102883f7
