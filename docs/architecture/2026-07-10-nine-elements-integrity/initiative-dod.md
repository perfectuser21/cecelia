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
