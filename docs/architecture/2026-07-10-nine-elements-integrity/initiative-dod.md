# Initiative DoD: 九要素完备化——账本通电 + 保鲜守卫 + 两轴衔接

## 功能验收条件（Mode 3 逐条检查）

- [ ] F1: 保鲜守卫每晚产出卫生分 — 验证方式: `design_docs` 出现 type='ledger_hygiene' 当日记录，含 5 项指标数值
- [ ] F2: 棘轮击穿自动开 issue — 验证方式: 手工制造一条欠账（终态 harness 任务不写 golden_path），次日出现 `[ledger-hygiene]` P2 issue
- [ ] F3: 累积 FR 通电 — 验证方式: 任一 harness 任务 PR merged 后 `SELECT count(*) FROM golden_path` 增长；planner Step 0.4 注入的「## 累积 FR」段非空
- [ ] F4: 注入扩容生效 — 验证方式: harness-line-context 单测断言 12000 上限；GET /line/:id/context-manifest 返回含 line_ledger 摘要段
- [ ] F5: 回执闭环 — 验证方式: 触发一次飞书/Bark 通知 → action_receipts 出现 pending → collector 核销为 confirmed；人为断网一次 → timeout 进战报未确认段
- [ ] F6: 判定点入库 — 验证方式: 新 harness 合同含「判定点登记表」段，decisions 出现 category='judgment' 记录（≥1 条真实数据）
- [ ] F7: 两轴对账 — 验证方式: 任一 KR 的 metadata.target_abilities 写入后，GET /okr/kr/:id/ability-progress 返回各 ability 厚度与推进项完成度

## 集成测试通过条件

- [ ] I1: 最后一个 dev task 的集成测试套件全绿（brain-integration，真 postgres）
- [ ] I2: 端到端：一条 harness 任务从派发→merged→golden_path 落行→次日保鲜分变化，全链可查

## 架构对齐条件（Mode 3 自动校验）

- [ ] A1: 数据模型零新表零 migration（golden_path 结构未动、target_abilities 走 metadata）
- [ ] A2: 新端点 /line/:id/context-manifest、/okr/kr/:id/ability-progress 存在
- [ ] A3: 关键决策落地——golden_path 写入点在 callback-processor（非 skill curl）、读端走 feature_id、保鲜为 tick job 非 skill

## 非功能条件

- [ ] N1: 无新增 L1 bug（code_review 无 BLOCK）
- [ ] N2: Brain CI 全通过；promoteToRegression 接入为 fail-open（其失败不阻塞任务终态回写）

## Addendum 01 功能验收条件（07-10 追加：执行遥测复活 + 统一收件箱）

- [ ] F8: phase-event 复活 — 验证方式: 新跑一次 harness_initiative 任务，`initiative_run_events` 出现该任务对应 node 记录，非 07-04 前的历史数据
- [ ] F9: zombie-reaper 不再误杀有心跳任务 — 验证方式: 手工制造一个 phase-event 心跳新鲜但 `tasks.updated_at` 超 60min 的场景，reaper 不将其标记 failed
- [ ] F10: decisions 垃圾归零 — 验证方式: `SELECT count(*) FROM decisions WHERE topic IS NULL AND decision IS NULL` 清理后为 0，且此后 consciousness_loop 触发不再产生内容相同的重复行
- [ ] F11: learnings 噪音过滤生效 — 验证方式: 新的 task_completion 类任务完成不再在 `learnings` 表产生新行
- [ ] F12: learnings 摘要生成可靠性提升 — 验证方式: 新产出的非噪音 learning，`summary` 字段非空比例较修复前（6%）显著提升（目标 ≥80%）
- [ ] F13: 统一收件箱通电 — 验证方式: 新产出一条 handoff/learning/issue 后，`capture_atoms` 出现对应 `status='pending_review'` 记录
- [ ] F14: 分诊 tick 生效 — 验证方式: capture-triage tick 跑过一轮后，F13 产出的记录 status 变为非 pending_review（已分诊），`routed_to_table`/`routed_to_id` 有值
- [ ] F15: Invariant Gate 拦截生效 — 验证方式: 构造一条与既有铁律冲突的候选内容，分诊后落 `pending_review` 而非直接写入 `decisions category=invariant`

## Addendum 01 架构对齐条件

- [ ] A4: 数据模型零新表零 migration（全部复用 `initiative_run_events`/`decisions`/`learnings`/`capture_atoms` 既有 schema）
- [ ] A5: 关键决策落地——phase-event 由 skill markdown 自报（非 Brain 后端拦截）、收件箱进箱方式为推非拉、分诊为异步 tick 非同步阻塞写入路径
