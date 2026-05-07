# Sprint PRD — task-plan.json 生成端到端验证（#2820）

## OKR 对齐

- **对应 KR**：KR-Harness 可靠性（[ASSUMPTION: Brain API 不可达，依据近期 W1+W3+W4/W7 系列 PR 推断 Harness Pipeline 健康 KR 为当前活跃 KR]）
- **当前进度**：[ASSUMPTION: 未知，Brain context 5221 端口超时]
- **本次推进预期**：闭环验证 #2819/#2820 修复，Harness Initiative 流程冒烟可信度从 0 → 1

## 背景

#2819/#2820 修复了 Harness v8 的根因 Bug：proposer 看不到 reviewer 判决导致 task-plan.json 永不生成。修复涉及三处：
1. Skill Step 3 改成每轮都写 task-plan.json
2. harness-gan.graph.js proposer node 加 access 校验
3. harness-initiative.graph.js inferTaskPlan catch 返回 `{ error }` 走 stateHasError → END

修复已合入 main，但缺少端到端验证：当一个真实 Planner agent 跑完整流程时，task-plan.json 是否真的会被生成、且能被 graph 抽取。本 Sprint 目标即是通过运行一个最小可信的 Planner Run（即本任务自身）来验证这条路径在生产代码库上闭环。

## Golden Path（核心场景）

Brain Tick Loop 派发 `harness_initiative` 任务 → Planner subagent 在 worktree 中跑 SKILL → 在 stdout 末尾产出包裹在 ```json``` 代码块中的 task-plan.json → harness-initiative.graph.js 的 inferTaskPlanNode 通过正则抽取该 JSON → 状态机推进到下一阶段（不进 stateHasError 分支）。

具体：
1. **触发条件**：Brain 派发 task_type=harness_initiative，传入 task_id `c5d80a6f-5ee4-4044-b031-ebcffaac61ce` 与 sprint_dir `sprints/verify-2820`
2. **系统处理**：
   - Planner agent 读取 SKILL prompt 和 task 描述
   - Planner 跳过 Step 0（Brain API 5221 超时，记录假设继续）
   - Planner 推断 journey_type 并写 sprint-prd.md 到 sprint_dir
   - Planner 在最终消息 stdout 中输出 ```json ... ``` 包裹的 task-plan.json
3. **可观测结果**：
   - 文件 `sprints/verify-2820/sprint-prd.md` 已创建并提交（包含 journey_type 末尾标注）
   - stdout 末尾包含一段合法 JSON，含 `tasks` 数组，每项有 `id` `title` `dod`
   - graph 端 inferTaskPlanNode 解析成功，不抛 `{ error }`
   - 分支 `cp-*-harness-prd` 推到 origin

## 边界情况

- **Brain API 不可达**：5221 端口超时（本次实际命中）→ 不阻塞流程，OKR 对齐字段标 [ASSUMPTION] 后继续，避免 #2819 描述的"静默失败"
- **stdout 没有 ```json``` 代码块**：inferTaskPlan 抓不到 → graph 走 stateHasError END，任务标 failed（这是 #2820 修复想保证的"显式失败"）
- **task-plan.json 解析失败**：JSON.parse 抛错 → graph catch 返回 `{ error }` 而非静默推空
- **同 task_id 重复派发**：worktree owner_session 互斥 + Brain dev-record 幂等键保护

## 范围限定

**在范围内**：
- 在 `sprints/verify-2820/` 目录下生成 `sprint-prd.md`
- 在本 agent 的最终 stdout 输出 task-plan.json 代码块
- task-plan.json 至少包含 1 个用于本验证场景的最小骨架任务

**不在范围内**：
- 修改 `packages/brain/src/workflows/harness-initiative.graph.js`（已在 #2820 修好）
- 修改 SKILL 文档本身
- 跑 unit/smoke 测试（已在 #2820 PR 中通过）
- Proposer / Evaluator 阶段产物（本 Sprint 只验 Planner→inferTaskPlan 链路）

## 假设

- [ASSUMPTION: Brain API 5221 端口暂时不可达，但不影响 Planner 单步产物正确性，因为 Step 0 在 SKILL 中只是上下文采集而非阻塞门]
- [ASSUMPTION: 当前任务被 v2 输出要求覆盖了 v8 默认"不再拆任务"约束，因此 stdout 必须输出 task-plan.json，否则验证失败（依据：任务描述明确要求"在 stdout 末尾输出 task-plan.json"）]
- [ASSUMPTION: sprint_dir 由 prompt 注入为 `sprints/verify-2820`，无需自行生成时间戳目录]

## 预期受影响文件

- `sprints/verify-2820/sprint-prd.md`：本 PRD（新增）
- `sprints/verify-2820/`：新增目录
- 无源码改动（验证型 Sprint，纯产出文档 + stdout 信号）

## journey_type: autonomous
## journey_type_reason: 本任务由 Brain Tick Loop 自动派发给 harness_initiative executor，无前端 UI 与远端 agent 协议参与，仅 Brain 内部 graph 流转
