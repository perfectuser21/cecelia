# Sprint PRD — Initiative B2 Pre-flight 验证骨架

## OKR 对齐

- **对应 KR**：KR-未指定（任务描述为 pre-flight 验证占位，未携带 OKR 锚点）
- **当前进度**：未知
- **本次推进预期**：不直接推进业务 KR，目标是验证 Harness v2 阶段 A → 阶段 B 入库链路在 Initiative 级别可跑通

## 背景

任务描述为 "Initiative B2 with sufficiently long description for pre-flight check passing"，明确标示其为 Harness pre-flight 路径的合成 Initiative。它的存在意义是让 Planner → Initiative Runner → Generator 之间的契约（PRD 模板 + task-plan.json schema + DAG 校验）在被真实业务 Initiative 触发之前，先在受控合成数据上跑一次端到端，暴露 schema/路径/落库错误。

[ASSUMPTION: Brain API（localhost:5221）当前不可达，无法读取 OKR / 活跃任务 / 决策上下文，本 PRD 在缺少运行时上下文的前提下生成；若 pre-flight 路径下游需要真实 OKR 锚点，应在 Brain 恢复后由后续 PRD 修订补齐]

## 目标

让 Initiative B2 在 Harness v2 阶段 A（Planner）→ 阶段 B（Runner 入库）→ 阶段 C（Generator 取一个 Task 产 PR）的链路上完成一次最小可观测的端到端通过，证明：(1) Planner 能稳定输出 schema 合规的 PRD 与 task-plan.json，(2) Runner 能成功解析并把 4-5 Task DAG 落入 Brain，(3) 后续 Generator 可按拓扑序取首个 Task 推进。

## User Stories

**US-001**（P0）: 作为 Harness 维护者，我希望 Initiative B2 的 task-plan.json 能被 Brain `parseTaskPlan` 校验通过，以便确认 Planner 输出契约稳定。

**US-002**（P0）: 作为 Harness 维护者，我希望 Initiative B2 的 4-5 个逻辑 Task 形成无环 DAG 并被入库，以便后续 Generator 阶段能基于拓扑序取首个 Task。

**US-003**（P1）: 作为 Harness 维护者，我希望 sprint-prd.md 在 sprints/ 目录下被生成并提交到当前分支，以便复盘时可追溯 pre-flight 期间 Planner 实际产出。

## 验收场景（Given-When-Then）

**场景 1**（US-001）:
- Given Initiative B2 task 已派发到 harness-planner，task_id = 1e255b89-0cf6-4299-b72b-0adaa93b33f8
- When Planner skill 执行完毕并在 stdout 输出 ```json ... ``` 包裹的 task-plan.json
- Then Brain Runner 调用 parseTaskPlan 不返回 schema 错误，且 tasks 数量 ∈ [4, 5]

**场景 2**（US-002）:
- Given task-plan.json 已被解析
- When Runner 检查 depends_on 图
- Then 不存在自指、不存在环、所有 depends_on 引用的 task_id 都在同一份 plan 内

**场景 3**（US-003）:
- Given Planner 在分支 cp-04271313-ws-1e255b89 上运行
- When skill 执行结束
- Then sprints/sprint-prd.md 存在于工作树中并已 commit，文件非空且包含 OKR 对齐 / User Stories / 验收场景 / 功能需求 / 成功标准 五个段落

## 功能需求

- **FR-001**: Planner 必须在 sprints/ 目录写入 sprint-prd.md，遵循模板 9 个段落（OKR / 背景 / 目标 / US / 场景 / FR / SC / 假设 / 边界）
- **FR-002**: Planner 必须在 stdout 末尾以 ```json ... ``` 代码块输出 task-plan.json
- **FR-003**: task-plan.json 中 tasks 数量在 [4, 5] 区间，每个 task 的 estimated_minutes ∈ [20, 60]
- **FR-004**: task-plan.json 中至少有一个 task 的 depends_on 为 []（图的入口）
- **FR-005**: PRD 与 task-plan.json 的 task_id / files 描述不能引用真实业务模块路径，避免污染真实代码

## 成功标准

- **SC-001**: Brain Runner 对该 task-plan.json 调用 parseTaskPlan 返回 ok（exit 0，无 schema error 字段）
- **SC-002**: tasks.length ∈ {4, 5}；所有 estimated_minutes 之和 ≥ 80 分钟且 ≤ 300 分钟
- **SC-003**: sprints/sprint-prd.md 行数 ≥ 50（确保 PRD 非占位）
- **SC-004**: depends_on 关系构成一个连通的有向无环图（DAG），可从入口 task 拓扑遍历到所有其他 task

## 假设

- [ASSUMPTION: 任务描述 "Initiative B2 with sufficiently long description for pre-flight check passing" 是 Harness pre-flight 套件的合成测试，不对应任何真实业务功能]
- [ASSUMPTION: Brain API 不可达不阻塞 Planner 输出，pre-flight 链路只关心 PRD/JSON 契约结构合规，不要求真实 OKR/决策对齐]
- [ASSUMPTION: 本 Initiative 不会被 Generator 真实写代码——若 pre-flight 包含 Generator 阶段，Generator 应识别本 Initiative 为 dry-run]
- [ASSUMPTION: 由于是合成验证 Initiative，files 字段使用 sprints/ 下的虚拟路径，不指向 packages/* 真实代码]

## 边界情况

- Brain API 不可达：Planner 仍按 fallback 输出（已发生）
- task 数量 = 5：必须能被 Runner 接收且不触发 justification 必填
- task 数量 = 4：仍合法，本 PRD 选择 4 Task 以贴近常态分布
- depends_on 中引用未定义 task_id：Runner 应返回校验错误（本 plan 不应触发）
- 同名 task_id 重复：Runner 应返回校验错误（本 plan 不应触发）

## 范围限定

**在范围内**:
- 生成 sprints/sprint-prd.md（结构合规、段落完整）
- 生成 task-plan.json（4 Task 线性 DAG，schema 合规）
- 在当前 cp-04271313-ws-1e255b89 分支下 commit & push 上述文件

**不在范围内**:
- 真实业务功能实现
- 修改 packages/brain / packages/engine / apps/* 任意源文件
- 数据库 migration / Brain schema 变更
- CI 配置变更

## 预期受影响文件

- `sprints/sprint-prd.md`: 本次 Planner 产出 PRD 的落盘位置
- `sprints/task-plan.json`: 任务 DAG 的归档（同时也通过 stdout code block 提供给 Runner）
