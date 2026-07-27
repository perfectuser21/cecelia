# Sprint PRD — Cecelia Harness Pipeline F1 账本归位与等价基线

## OKR 对齐

- **对应 KR**：Cecelia 基础稳固 — 系统可信赖、算力全开、管家闭环
- **当前进度**：82%
- **本次推进预期**：建立 Kernel Harness P0/P1 可审计基线，作为后续可信闭环加厚的起点；不虚构百分比增量

## 背景

数据库已有 `Cecelia Harness Pipeline` Journey（`bb8cc561-b3ee-4fec-b74d-2255694bd963`），它就是工厂域 F1 开发闭环。当前 endpoint 停在 PR 合并，本 sprint 只在该 Journey 原位建立 S0-S12、11 要素和旧 Claude Code P0/P1 等价基线，不改变 merge、staging 或 production 的实际运行时行为。

## Golden Path（核心场景）

**产品法律**：复用现有 Cecelia Harness Pipeline F1 Journey，原位补齐 S0-S12 × 11要素与旧 Claude Code P0/P1 等价基线；禁止新建平行账本或改变运行时行为。

审计者从现有 F1 Journey 及其历史 Planner/GAN/Generator/Evaluator/Final E2E 记录进入 → 将既有步骤映射到 S0-S12、补齐缺失步骤与 11 要素格子 → 核对 legacy 行为及真实 assertion_ref → 得到可追溯的 P0/P1 基线和下一刀顺序。

具体：
1. 系统识别且仅识别现有 `Cecelia Harness Pipeline` Journey，保留历史 Step ID、Notion 关联及已有证据，不删除重建。
2. 审计者可按 S0 Task Born 至 S12 Report / Learning / Complete 查看连续生命周期；现有步骤映射升级，缺失步骤补齐，每步均有 11 个既有 element cells。
3. 每个格子只呈现 `gray`、`red`、`pending`、`green` 或 `na`；状态来自当前仓库的可复验事实，文档或静态声明不能单独产生 `green`。
4. 旧 Claude Code P0/P1 行为逐项显示 legacy owner、`active|shadowed|retired|drifted|unknown` 状态、unified owner、缺口和下一刀顺序。
5. 可执行等价证据只归入根 `regression-contract.yaml` 的现有合同及真实测试引用；`packages/engine/regression-contract.yaml`、hooks、DevGate、CI 与 Kernel gates 只作为 legacy source。
6. 出口明确显示 merge 不是完成：F1 endpoint 延伸为 production verified、回滚锚点已记录且 report/learning 已收账；本 sprint 只建立验收地图，不启用该运行时终态。

## 边界情况

- 重跑或重复应用时不得产生第二条 Harness Journey、第二组同义 Step 或重复 element cells。
- 历史步骤不能可靠映射时保留原 ID 并标记缺口，不得以删除重建消除歧义。
- assertion_ref 不存在、不可执行或仅有静态文档时，相关格子不得标 `green`。
- legacy 行为证据冲突时标 `drifted`；尚未完成真实审计时标 `unknown`，不得乐观归类。
- production 数据只读；本 sprint 只能交付幂等 migration、代码、测试和非权威审计 artifact。

## 范围限定

**在范围内**：现有 F1 Journey 原位映射为 S0-S12；每步 11 要素格子；现有历史 ID/Notion 关联保留；legacy source 审计；P0/P1 状态、owner、缺口、下一刀基线；根回归合同 assertion_ref 校验；证明唯一 Journey、结构完整和 endpoint 语义的行为/集成测试。

**不在范围内**：新建 `Kernel Harness Delivery` Journey、Behavior Ledger、同义表或第二份 regression SSOT；删除旧 Controller 回滚通道；完成 Claude/Codex/Grok 全矩阵等价；改变 merge/staging/production 实际状态机、默认路由或发布行为；直接修改生产数据库。

## 假设

- [ASSUMPTION: 当前 Journey 的既有步骤允许一对一映射或保留 ID 后改名；无法自动判断的映射以缺口状态交付，不擅自重建。]
- [ASSUMPTION: 任务锚定 step `a6888ef3-2482-4655-8703-cf3b9f037cb9` 代表本次 F1 加厚入口，而非要求只修改单个生命周期 Step。]

## 预期受影响文件

- `packages/brain/migrations/`: 提交可重复应用的 F1 S0-S12 与 11 要素账本变更，不直接写生产库
- `packages/brain/src/lib/eleven-elements-ledger.js`: 使现有 11 要素结构承载本次真实基线
- `regression-contract.yaml`: 作为唯一可执行行为 SSOT，承载或引用有效 assertion_ref
- `packages/engine/regression-contract.yaml`: 仅标识 legacy source 的审计归属，不建立平行权威合同
- `packages/brain/src/`: 提供幂等归位入口及 endpoint 完成语义的可观察基线
- `packages/brain/` 下现有测试目录: 覆盖唯一 Journey、S0-S12 × 11 格子、endpoint 非 merge 完成及 assertion_ref 存在性

## NFR 约束

<!-- 来源: decisions 表 category=nfr，PrepPRD 显式值优先 -->
- 幂等性：重复执行 migration/API 不新增第二条 Journey、不复制 Step 或 element cells
- 数据保全：保留现有 Planner/GAN/Generator/Evaluator/Final E2E ID 与 Notion 关联
- 状态可信：格子状态仅允许 `gray|red|pending|green|na`；无绑定版本/SHA 的可重复行为证据不得标 `green`
- 合同纪律：CONTRACT IS LAW；TDD 必须先 Red commit 后 Green commit；1 Sprint = 1 Generator = 1 PR
- 权限：CI 只产证据；Evaluator PASS、Independent Judge PASS 与本任务人工批准后才可 merge
- 安全：禁止直接修改生产数据库；secrets、PII 与凭据不得进入提交、合同或日志
- 兼容性：本 sprint 不改变现有 merge、staging、production 运行时行为和默认路由
- 超时/频控/版本要求：待定（PrepPRD 未指定，decisions 副源为空）

## Invariant 约束（铁律，proposer/evaluator 不得违反）

<!-- 来源: decisions category=invariant，step + journey_feature + area 三源按 decision id 合并去重 -->
- [超时恢复] watchdog_overdue 标 failed 的 relay run 经 orphan requeue + 外部真相核查（PR/sprint 目录）后，从头重跑是安全恢复路径（来源: area）
- [语义成功] 通知/写库接口的成功判定必须检查 sent/accepted 等语义字段，不能只检查 ok:true（来源: area）
- [依赖修复] dep-audit 因新 advisory 翻红时先查 fixAvailable；存在兼容修复时先修复，不能急于加白名单（来源: area）
- [会话心跳] headed relay 长时间等待 CI 时必须周期性更新心跳，避免存活 session 被误标 failed（来源: area）
- [毕业检查] 测试入册 commit 后必须先跑 lint-tdd-commit-order 与 check-test-coverage 再 push（来源: area）
- [手工证据] 合同批准前必须记录 manual oracle 的真实 exit code，并确认目标解释器实际启动（来源: area）
- [真跑脚本] manual:node -e 双引号内的 JavaScript 模板表达式必须在 GAN 批准前逐条真跑，bash -n 不足以验证（来源: area）
- [冒烟一] smoke 铁律（decision 6041333c）（来源: area）
- [冒烟二] smoke 铁律（decision a3989e96）（来源: area）
- [多轮测试] 测试不能全部依赖冷启动式状态重置，必须覆盖状态不重置且时间真实流逝的多轮扫描（来源: area）
- [付费去重] 周期性重扫引入外部付费调用时必须检查是否已处理，防止重复调用（来源: area）
- [时间关系] 跨模块时间常数存在大小关系时必须显式声明并验证不变量（来源: area）
- [环境剧场] contract 文本的目标平台词会参与 theater_mismatch 检查，环境声明必须与真实被测服务一致（来源: area）
- [环境真相] target_environment 从 tasks.payload 读取，任务注册时必须明确设置（来源: area）
- [判决格式] Brain judge 结果必须含顶层 exit_code、log_tail 和逐项含 exit_code、log_tail 的 behavior_tests（来源: area）
- [字段长度] 无天然长度上限的数据写入受限 DB 字段前必须显式处理长度边界（来源: area）
- [退役溯源] 复活或重做已退役功能前必须读取删除前真实代码并核对 death cause（来源: area）
- [失败分支] 调用以 null/false 表示失败的函数时必须显式处理失败分支，不能只依赖 try/catch（来源: area）
- [冒烟三] smoke 铁律（decision 33ede9f1）（来源: area）
- [收账探针] journey_features.updated_at 长期早于对应 PR 合并时间可作为 report 漏跑探针（来源: area）
- [完成核验] Brain 不得只凭 relay 容器 exit code 0 判完成，必须校验 merge/report 的外部产出物（来源: area）
- [场景核对] host/环境白名单断言必须核对 headed 人工接管场景（来源: area）
- [点火锚点] headed relay 点火必须带 base_repo 或 pr_url，分支名必须可关联 task（来源: area）
- [退役事实] 退役判断必须依据生产数据和真实消费方，不得依赖记忆（来源: area）
- [吞错告警] catch 吞错的后台任务必须记录失败计数并在连续失败超阈值时告警（来源: area）
- [表名认领] 建表或复用表前必须核对全部写入方；共享表必须完成 schema 对齐评审（来源: area）
- [消费闭环] 新增后台任务必须声明真实下游消费方，无消费方的落库任务不得上线（来源: area）
- [多端完整] 设备或操作系统类型有多种时必须在设计与审查阶段核对每种类型的对应表现（来源: area）
- [语义一致] 同一语义在判变端和终验端必须采用同一处理策略（来源: area）
- [引用验证] git ref 存在性必须用 `git rev-parse --verify "<ref>^{commit}"` 验证（来源: area）
- [测试隔离] 使用真实 worktree 做测试根目录时必须核对并隔离可能触碰的生产资源（来源: area）
- [部署失败] 部署链任一失败路径必须明确 FAIL、告警并非零退出，禁止 warning 降级（来源: area）
- [生产自报] 判变基准必须使用生产实体自报的 build-info/health.git_sha 对账 origin/main（来源: area）
- [测试异步] lint-test-quality 要求测试实际 await 被测函数，源码读取场景也不得用同步读取冒充（来源: area）
- [合同表格] Test Contract 表格固定四列，testFile 用反引号包裹并位于解析器约定列（来源: area）
- [红测提交] Red commit 只能精确暂存测试路径，禁止使用 `git add .` 混入非测试文件（来源: area）
- [调度验证] 调度接线优先使用可验证真实接线的回归测试，不能仅靠 mock 证明（来源: area）
- [定时入口] 新增 cron 功能必须先核对 scheduler-jobs.js JOBS，不得接入已废弃 tick-runner.js（来源: area）
- [合并权限] generator 禁止自行 merge PR，只能推送 branch 并报告 ready，merge 权归 controller（来源: area）
- [环境继承] headed relay 的 tmux innerCmd 必须显式导出 session 所需 Harness 环境变量（来源: area）
- [先例核对] Proposer 复用历史 E2E 合同时必须核对本任务真实派发与执行历史（来源: area）
- [共享禁区] 共享 CI 判定文件未经合同显式授权不得修改，相关变更必须另开 sprint（来源: area）
- [合并漂移] CI 提前合并时必须核对 PR head SHA 与 evaluator/judge verdict 锚定 SHA 一致（来源: area）
- [冒烟四] smoke 铁律（decision 552520d0）（来源: area）
- [Brain冒烟] 修改 brain/src 的功能 PR 必须按现有门禁同时提供 smoke 与 allowlist 登记（来源: area）
- [任务接线] 新 task_type 必须覆盖数据库约束、路由表、执行器、override、skill 映射与 dispatcher 防线（来源: area）
- [存活双信] 服务存活判定必须结合服务管理状态与端口监听（来源: area）
- [常驻域] 美国 Mac mini 的常驻服务必须使用系统域 LaunchDaemon，禁止依赖不存在的用户 GUI 域（来源: area）
- [巡检登记] 新增常驻宿主服务必须同步登记 launchd-patrol 的运行、加载和监听清单（来源: area）
- [冒烟五] smoke 铁律（decision 4b73376c）（来源: area）
- [单槽串行] 一个 slot 内任务严格串行；任务内只读角色可并行，但同时只能有一个代码实现者（来源: area）
- [环境推导] 禁止写死环境假设值，必须从环境推导或在真实目标上校准（来源: area）
- [真验完成] 依赖真实调用方或生产环境的接缝必须在目标环境验证后才可标 done（来源: area）
- [租户测试] 涉及租户数据的单元/E2E 默认覆盖至少两个租户并断言隔离（来源: area）
- [凭据安全] secrets 不硬编码、不进 git、不进日志（来源: area）
- [日志脱敏] 客户隐私、PII 和聊天内容不得明文进入日志（来源: area）
- [端点鉴权] 每个 API endpoint 必须有鉴权，无鉴权端点不得发货（来源: area）
- [租户隔离] 涉及租户数据的查询和写入必须限定当前租户，禁止跨租户混读混写（来源: area）

## 累积 FR（本 line 已验收行为，本 sprint 不得回退/重复）

<!-- 来源: 本 line 已完成 ability 的 golden_path，按 ability 分组、order_no 排序 -->
（本 line 暂无历史）

## E2E 验收

> Proposer 必须把以下验收点转换为 `local_api` 可执行脚本，并以独立、可恢复的测试数据验证；不得直接修改生产数据库。

```bash
# 占位：proposer 按 local_api 填入真实 curl + 测试数据库/隔离事务脚本
# 期望验收点 1：查询后仍只有 journey_id=bb8cc561-b3ee-4fec-b74d-2255694bd963 的唯一 Cecelia Harness Pipeline F1 Journey，不出现 Kernel Harness Delivery 或平行账本。
# 期望验收点 2：重复应用变更两次，S0-S12 恰好各一项；每个 Step 恰有 11 个既有要素格子，且状态枚举合法。
# 期望验收点 3：已有 Planner/GAN/Generator/Evaluator/Final E2E Step ID 与 Notion 关联在映射前后保持不变。
# 期望验收点 4：F1 endpoint 的合同语义包含 production verified、rollback anchor、report/learning，且 merge 不再等于 completed。
# 期望验收点 5：所有非空 assertion_ref 指向真实存在的根 regression-contract 条目或可执行测试；静态文档证据不会产生 green。
# 期望验收点 6：legacy P0/P1 基线逐项具有合法状态、legacy owner、unified owner、缺口与下一刀顺序；审计报告不是权威账本。
# 期望验收点 7：本 sprint 未改变 merge/staging/production 运行时路径，未新增平行状态机、账本表或 regression SSOT。
```

## journey_type: dev_pipeline
## journey_type_reason: 本 sprint 加厚 Cecelia Harness 开发闭环，并涉及 engine hooks、DevGate、CI 与 Kernel gates 的 legacy 审计。
## target_environment: local_api
## target_environment_reason: task.payload 明确指定 local_api；结构、合同引用与幂等行为由本地 Brain API 和隔离测试数据库验收。
## journey_id: bb8cc561-b3ee-4fec-b74d-2255694bd963
## step_id: a6888ef3-2482-4655-8703-cf3b9f037cb9
