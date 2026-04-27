# Sprint PRD — Initiative B1 端到端 Harness Demo

## OKR 对齐

- **对应 KR**：KR-Harness（Harness v2 端到端流水可演示）
- **当前进度**：未知（Brain API 不可达，按 fallback 推断）
- **本次推进预期**：完成 1 个端到端可观测样例 Initiative，推进 ~10%

## 背景

Harness v2 阶段 A Layer 1 需要一个最小可重复执行的演示 Initiative，用于验证：
- Planner 能产出合规 PRD + task-plan.json
- Initiative Runner 能根据 DAG 拓扑序派发 Task
- pre-flight check 在描述足够长时能通过

任务描述明确说明本 Initiative 用于让 pre-flight check 通过，因此本 PRD 的核心价值是"流程跑通"，而非引入新业务功能。

## 目标

提供一个最小、可重复运行、能贯通 Planner → Runner → Generator → Evaluator 的演示 Initiative，让 Harness v2 自检路径有稳定 fixture。

## User Stories

**US-001**（P0）: 作为 Harness 维护者，我希望有一个固定的 demo Initiative，以便每次回归测试都能用相同输入复现端到端结果。
**US-002**（P1）: 作为 Brain 调度者，我希望该 Initiative 的 task-plan.json 包含线性 DAG，以便验证拓扑排序与依赖派发逻辑。
**US-003**（P2）: 作为 Evaluator，我希望每个 Task 都有可执行的 [BEHAVIOR] DoD，以便机械跑命令判定 PASS/FAIL。

## 验收场景（Given-When-Then）

**场景 1**（US-001）:
- Given Initiative B1 已入库且 task-plan.json 含 4 个 Task
- When Initiative Runner 启动调度
- Then 4 个 Task 按 ws1 → ws2 → ws3 → ws4 顺序逐一进入 in_progress

**场景 2**（US-002）:
- Given Brain `parseTaskPlan` 收到本 task-plan.json
- When 校验依赖图
- Then 不报环路错误，且每个 Task 的 estimated_minutes ∈ [20, 60]

**场景 3**（US-003）:
- Given Generator 完成 ws1 的 PR
- When Evaluator 跑 DoD 命令
- Then 至少 1 条 [BEHAVIOR] 验证可执行并返回 exit 0/非 0

## 功能需求

- **FR-001**: 提供一个最小演示功能模块（命名为 `b1-demo`），含一份 schema 描述、一份核心配置文件、一份对外查询入口、一份自检脚本
- **FR-002**: 模块每个产物文件单独由一个 Task 产出（1 PR / Task）
- **FR-003**: 自检脚本执行后返回明确 exit code，便于 Evaluator 验收
- **FR-004**: 全部产物文件存放在 `sprints/b1-demo/` 目录下，避免污染主代码

## 成功标准

- **SC-001**: task-plan.json 通过 Brain `parseTaskPlan` 校验（无环、estimated_minutes 合规）
- **SC-002**: 4 个 Task 均能被 Runner 拓扑序派发，无 stuck
- **SC-003**: 每个 Task 至少含 1 个 [BEHAVIOR] DoD 且可独立验证
- **SC-004**: 整体 Initiative 在 Generator + Evaluator 路径上端到端走通至少 1 次

## 假设

- [ASSUMPTION: 当前 Brain API (localhost:5221) 暂不可达，但 task-plan.json 仍按 v2 schema 输出，待 Runner 入库时由 Brain 映射 UUID]
- [ASSUMPTION: 任务描述 "Initiative B1 with sufficiently long description for pre-flight check passing" 表明本 Initiative 目的为 fixture，不引入业务侧改动]
- [ASSUMPTION: 产物全部落在 `sprints/b1-demo/` 子目录，不触碰 packages/brain 主代码以避免触发 DevGate]

## 边界情况

- 若 Brain `parseTaskPlan` 报 estimated_minutes 越界 → 拒绝
- 若 task-plan.json 不在 code fence 内 → Runner 抓不到，Initiative 失败
- 若 ws1 schema 文件名与已存在文件冲突 → 改用唯一前缀 `b1-`
- 若自检脚本执行权限缺失 → DoD 应显式 `bash` 调用绕过

## 范围限定

**在范围内**:
- 在 `sprints/b1-demo/` 下产出 4 份演示文件
- 输出合规 task-plan.json（4 Task，线性 DAG）
- 每 Task 包含 [BEHAVIOR] + [ARTIFACT] DoD

**不在范围内**:
- 不修改 packages/brain 任何代码
- 不引入新依赖
- 不改 CI 配置
- 不写迁移
- 不改 docs/current/

## 预期受影响文件

- `sprints/b1-demo/schema.md`: ws1 产物，描述 demo 模块 schema
- `sprints/b1-demo/config.json`: ws2 产物，模块运行配置
- `sprints/b1-demo/query.md`: ws3 产物，对外查询入口契约
- `sprints/b1-demo/selfcheck.sh`: ws4 产物，自检脚本
- `sprints/sprint-prd.md`: 本文件
