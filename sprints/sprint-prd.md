# Sprint PRD — Initiative B1 基线产物建立

## OKR 对齐

- **对应 KR**：KR-Harness-Reliability（Harness pipeline 端到端可信度）
- **当前进度**：未知（Brain API 不可达，假设进行中）
- **本次推进预期**：建立 B1 Initiative 的最小合规基线产物，验证 Planner → Runner → Generator → Evaluator 流水线在"最小可调度 Initiative"上的闭环

## 背景

Harness v2 流水线要求每个 Initiative 都必须产出 sprint-prd.md + task-plan.json 两份基线产物，供 Initiative Runner 入库并派发到下游 Generator/Evaluator。

Initiative B1 是一个"基线/烟囱测试"性质的 Initiative：它的存在本身就是为了验证 pre-flight check（描述长度、字段完整性、DAG 合法性）能正确通过，并让下游 agent 拿到一份结构合法但范围最小的 Task DAG 来跑通完整链路。

本次任务即在 `cp-04271301-ws-3bf39970` 分支上落地这份最小但合规的基线产物。

## 目标

让 Initiative B1 在 Brain 中成功入库，并产出一份能被下游 Generator 拓扑遍历执行的 4 Task DAG，每个 Task 都有可机器校验的 DoD。

## User Stories

**US-001**（P0）: 作为 Initiative Runner，我希望拿到一份字段完整、DAG 合法的 task-plan.json，以便能直接 `parseTaskPlan` 入库而不报错
**US-002**（P0）: 作为 Generator，我希望每个 Task 的 `dod / files / scope` 都有内容，以便能按 Task 单独产 PR
**US-003**（P1）: 作为 Evaluator，我希望每个 Task 的 DoD 至少有 1 条 `[BEHAVIOR]` 验收点，以便能机械跑命令判断 PASS/FAIL

## 验收场景（Given-When-Then）

**场景 1**（US-001）:
- Given Initiative B1 的 Planner 已完成
- When Brain Initiative Runner 抓取 stdout 末尾的 ```json``` 代码块并 `parseTaskPlan`
- Then 解析成功，Task 数量为 4，DAG 无环且无自指

**场景 2**（US-002）:
- Given Generator 按拓扑序取到 Task ws1
- When 读取该 Task 的 scope/files/dod
- Then 每个字段非空，files 至少 1 项，dod 至少 1 条

**场景 3**（US-003）:
- Given Evaluator 收到任一 Task 的 DoD 列表
- When 扫描 DoD 条目
- Then 至少存在 1 条带 `[BEHAVIOR]` 前缀的验收点

## 功能需求

- **FR-001**: 产出 `sprints/sprint-prd.md`，包含 OKR 对齐 / User Stories / 验收场景 / 功能需求 / 成功标准 / 假设 / 边界 / 范围限定 / 受影响文件 9 大段
- **FR-002**: stdout 末尾产出被 ```json``` 包裹的 task-plan.json
- **FR-003**: task-plan.json 中 tasks 数量为 4（在硬约束 4-5 区间内，无需 justification）
- **FR-004**: 每 Task 的 estimated_minutes ∈ [20, 60]
- **FR-005**: 每 Task 的 depends_on 显式存在（即便为空数组）

## 成功标准

- **SC-001**: Brain Initiative Runner `parseTaskPlan` 调用零报错
- **SC-002**: Task 总数 = 4，DAG 拓扑可达且无环
- **SC-003**: 每 Task 至少 1 条 `[BEHAVIOR]` DoD
- **SC-004**: PRD 字数 ≥ 800（满足 pre-flight check 长度阈值）

## 假设

- [ASSUMPTION: Brain API 当前不可达，capacity-budget 取 fallback（soft=200, hard=400 LOC）]
- [ASSUMPTION: Initiative B1 是验证 pipeline 自身的烟囱测试，不绑定具体业务功能]
- [ASSUMPTION: 当前分支 `cp-04271301-ws-3bf39970` 即本次 Initiative 的工作分支，无需另开 `-harness-prd` 分支]

## 边界情况

- Brain API 不可达 → 用 fallback 阈值，PRD 标注假设
- task-plan.json 解析失败 → Brain Runner 会回报 `parseTaskPlan` 错误，需重跑 Planner
- 单 Task LOC 预估超过 200 → 在该 Task scope 字段标注，Generator 决定是否再拆

## 范围限定

**在范围内**:
- 产出 sprint-prd.md（What 描述）
- 产出 4 Task 的 task-plan.json（DAG）
- 每 Task 给出 scope / files / dod / depends_on / complexity / estimated_minutes

**不在范围内**:
- 不写代码实现
- 不跑测试
- 不改 Brain / Engine 任何源码
- 不创建实际的 migration / API endpoint（Generator 阶段才做）

## 预期受影响文件

- `sprints/sprint-prd.md`: 本次新建的 PRD 文件
- `sprints/task-plan.json`: 本次新建的 DAG 文件（由 Runner 从 stdout 抓取后落盘，Planner 不直接写）
