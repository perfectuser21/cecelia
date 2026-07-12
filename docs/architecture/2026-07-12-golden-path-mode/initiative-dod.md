# Initiative DoD: AI 自提 Golden Path 模式

> Mode 3 逐条对照验收。B1-B7 与规格页 https://docs.zenjoymedia.media/strategist-node-v2-spec/ 的验收断言一一对应。

## 功能验收条件

- [ ] F1: `golden_paths` 表存在且状态 CHECK 含全部 10 态（candidate/proposed/converged/approved/in_dev/delivered/expired/rejected/blocked_gate/superseded）— 验证: `\d golden_paths` + 非法状态 INSERT 被拒
- [ ] F2: `golden_path_proposal` task_type 全链可派发——task-router 四处登记 + executor 分支 + relay loadSkill 选中 golden-path-controller — 验证: 建一条该类型任务，Brain 派发后 tmux 里起的是 golden-path-controller 而非 harness-controller
- [ ] F3: 圈选端点 candidate→proposed 且真实创建 golden_path_proposal 任务（DB 可查，规格 B2）— 验证: curl /select 后查 tasks 表
- [ ] F4: 批规模闸生效——单批圈选超 capacity-budget 反推上限（≤2 周产能）时拒绝并提示顺延 — 验证: fixture 造超限批次
- [ ] F5: 批准端点写 decisions(category='judgment', review_after=approved_at+14d, reason 含 gp:<id>)（规格 B3 先例 id 可解析）— 验证: /approve 后查 decisions
- [ ] F6: 报备 24h 否决窗——veto_deadline 过期未否决自动生效 approved 且留痕；否决→回 converged（规格 B6）— 验证: 缩短窗口 fixture 跑 tick
- [ ] F7: 保质期 delta 检查——approved 超 review_after 未开工被 job 翻 expired 并重上批审段（规格 B5）— 验证: 回拨 review_after 跑 job
- [ ] F8: 晨报军师节 v2 五段结构，无货段渲染空态而非缺失（规格 B1）— 验证: battle-report 渲染契约测试
- [ ] F9: 需动作条目 >7 发生截断与溢出顺延（规格 B4）— 验证: 9 条 fixture
- [ ] F10: 水位段计数与 `SELECT status,count(*) FROM golden_paths GROUP BY status` 一致（规格 B7）— 验证: 对账断言
- [ ] F11: direction-proposer 每周产出候选落 golden_paths(candidate) 且附 OKR 缺口全景（无候选覆盖的缺口显式列出）— 验证: 手动触发一次 job 查产物
- [ ] F12: capture-triage scope 分诊——repair 级维持自动建任务；capability 级写 golden_paths(candidate, source='capture_triage') 不再直接建任务 — 验证: 两类 fixture atom 各走一遍
- [ ] F13: 57d296a1 修订决策已落 decisions 表（引用原决策 id + cb6be3f6）— 验证: 查 decisions
- [ ] F14: 朋友圈试点 v2.1 提案文档已入库（repo 或 golden_paths.proposal_doc）作为 golden 样例 — 验证: 文件/行存在

## 集成测试通过条件

- [ ] I1: E2E proven-to-fire——真实 candidate 走完 圈选→proposed→converged→批准→judgment 落库+harness 任务注册，全链 DB 可查
- [ ] I2: 全部新增测试进 CI（smoke-allowlist 登记 + routes 同名 test 配对两闸过）

## 架构对齐条件

- [ ] A1: 数据模型按 architecture.md 实现（golden_paths 逐字段；既有 golden_path 表零改动）
- [ ] A2: API 六端点按 architecture.md 实现
- [ ] A3: 七项关键决策无偏离（尤其：新表不复用 golden_path、line-strategist 本体零改动、拍板通道走 Dashboard 非飞书卡片）

## 非功能条件

- [ ] N1: 无新增 L1 bug（code_review 无 BLOCK）
- [ ] N2: Brain CI 全通过；skills repo PR 过 eval
- [ ] N3: golden-path-controller 保持无 MAX_ROUNDS 纪律（发散兜底沿用 Brain 侧收敛趋势检测）
