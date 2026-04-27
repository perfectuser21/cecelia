# Sprint PRD — Initiative B1 Harness 预检基线

## OKR 对齐

- **对应 KR**：KR-免疫系统（Harness 自我对抗与门禁基线）
- **当前进度**：未知（Brain context API 当前不可达，按 fallback 处理）
- **本次推进预期**：建立 Initiative B1 预检（pre-flight check）流水线最小闭环，使 Initiative 进入 Generator 之前先经过结构化校验

## 背景

Harness v2 阶段 A 由 Planner 输出 PRD + Task DAG，由 Initiative Runner 入库后驱动 Generator/Evaluator 多轮对抗。当前缺少一个明确的 **Initiative 级 pre-flight check**：在 Runner 拉起 Generator 之前，先校验 Initiative 描述足够具体、PRD 与 task-plan 结构合规、依赖图无环。本 Initiative B1 落地这一最小闭环，作为后续 Harness 任务的安全网。

## 目标

让任意进入 Harness 的 Initiative，都先通过一次结构化预检；预检失败的 Initiative 在调度前被拦截，并把失败原因写回 Brain，便于人工/自动修复。

## User Stories

**US-001**（P0）: 作为 Brain，我希望在派发 Generator 任务前先调用 Initiative 预检接口，以便阻止结构不合规的任务进入对抗循环。
**US-002**（P0）: 作为主理人，我希望在预检失败时能看到清晰的失败原因（缺字段 / DAG 有环 / Task 超时预算），以便快速修复 PRD 或 task-plan。
**US-003**（P1）: 作为 Evaluator，我希望读到一份 "已通过预检" 的 Initiative 元数据，以便专注于质量审查而不是结构校验。

## 验收场景（Given-When-Then）

**场景 1**（US-001）:
- Given Brain 收到一个 Initiative 描述短于阈值的请求
- When Runner 调用 pre-flight check
- Then 预检返回 `rejected`，且原因包含 `description_too_short`，Generator 不被拉起

**场景 2**（US-002）:
- Given task-plan.json 中 `ws2.depends_on=["ws3"]` 且 `ws3.depends_on=["ws2"]`
- When 预检解析 DAG
- Then 返回 `rejected`，原因包含 `dag_has_cycle`，并指出环上的 task_id

**场景 3**（US-003）:
- Given Initiative 通过预检
- When Evaluator 拉取 Initiative 元数据
- Then 元数据包含 `preflight_status="passed"` 与时间戳

## 功能需求

- **FR-001**: 预检接口接收 `initiative_id`，从 Brain 读取 Initiative 描述、PRD、task-plan，输出 `passed | rejected` 与原因列表。
- **FR-002**: 预检规则覆盖：描述长度阈值、PRD 必填字段（OKR 对齐 / 验收场景 / 成功标准）、task-plan schema、Task 数量上限、单 Task 时长区间、DAG 无环。
- **FR-003**: 预检结果写入 Brain，可被后续阶段查询。
- **FR-004**: 预检失败时 Runner 不进入 Generator 阶段，并把失败原因回写到原始任务的 `result` 字段。

## 成功标准

- **SC-001**: 在 task-plan.json 故意构造环依赖时，预检 100% 命中并返回 `dag_has_cycle`。
- **SC-002**: 在 PRD 缺少 "成功标准" 章节时，预检命中并返回 `prd_missing_section: success_criteria`。
- **SC-003**: 一个合规 Initiative 端到端通过预检的耗时 < 2 秒（不含外部 IO）。
- **SC-004**: 预检结果对应的 Brain 记录可通过 `GET /api/brain/initiatives/{id}/preflight` 查询到。

## 假设

- [ASSUMPTION: Brain 已存在 `initiatives` 与 `tasks` 数据表，本 Initiative 不重新设计基础 schema，只追加预检相关字段]
- [ASSUMPTION: PRD 与 task-plan.json 来自 Planner 推送的 commit，预检读取的是 Initiative Runner 已落库的版本而非 git 工作树]
- [ASSUMPTION: 预检失败原因列表足够指导人工修复，本期不做自动修复建议]

## 边界情况

- task-plan.json 解析失败（语法错误）→ 视为 `rejected`，原因 `task_plan_parse_error`
- Initiative 描述恰好等于阈值长度 → 通过（阈值取下界含等号）
- 单 Task estimated_minutes 缺失 → 视为 `rejected`，原因 `task_missing_field: estimated_minutes`
- 预检接口本身异常 → Runner 默认 fail-close（不放行），并打日志

## 范围限定

**在范围内**:
- Initiative 级预检接口（HTTP）
- 预检规则集（描述 / PRD / task-plan / DAG）
- 预检结果持久化与查询
- Runner 与预检的最小集成（失败拦截）

**不在范围内**:
- 预检失败的自动修复
- Generator/Evaluator 内部质量评估
- Initiative 删除 / 重排 等管理类操作
- 前端 Dashboard 上的预检结果展示

## 预期受影响文件

- `packages/brain/migrations/`: 新增预检结果存储字段
- `packages/brain/src/`: 新增预检模块与路由
- `packages/brain/src/initiative-runner.js` 或等价 Runner 入口: 在派发 Generator 前调用预检
- `packages/brain/test/`: 预检规则单元测试与端到端测试
