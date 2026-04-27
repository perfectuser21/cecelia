# Sprint PRD — Initiative B2 Pre-flight Validation

## OKR 对齐

- **对应 KR**：KR-Harness-Pipeline-Reliability（Harness v2 流水线可靠性）
- **当前进度**：[ASSUMPTION: 未读到 Brain context，进度未知]
- **本次推进预期**：完成 Initiative B2 级别的 pre-flight 校验闭环，预计推进 10-15%

## 背景

Harness v2 流水线在 Planner → Generator → Evaluator 三阶段切换时，需要一道 pre-flight 校验门禁，确保每个 Initiative 在进入 Generator 阶段前满足结构化最低标准（PRD 完整、DAG 有效、Task 数量合规）。Initiative B2 是该校验门禁的目标 Initiative：它必须能稳定通过 pre-flight 检查，作为后续 Initiative 的回归基线。

[ASSUMPTION: 任务描述仅给出 "Initiative B2 with sufficiently long description for pre-flight check passing"，推断本 Initiative 的核心价值是建立 pre-flight 门禁基线。]

## 目标

让 Initiative B2 在进入 Generator 前能稳定通过 pre-flight 校验，并把校验结果记入 Brain，供后续 Initiative 复用为基线契约。

## User Stories

**US-001**（P0）: 作为 Initiative Runner，我希望在收到 Planner 产物后能一键校验 PRD 与 task-plan.json 的结构合法性，以便在不合规时立即拒收并回退给 Planner，不浪费 Generator 算力
**US-002**（P0）: 作为 Brain，我希望把每次 pre-flight 的判定（pass/fail + 失败原因清单）落库，以便给 Initiative 提供可追溯的质量历史
**US-003**（P1）: 作为运维者，我希望通过 API 端点查询某个 Initiative 的最近一次 pre-flight 结果，以便在排查"为何卡在 Planner"时快速定位

## 验收场景（Given-When-Then）

**场景 1**（US-001）— PRD 缺失必填段：
- Given 一个 Initiative 的 sprint-prd.md 缺少"成功标准"小节
- When Runner 调用 pre-flight 校验
- Then 校验返回 fail，错误清单包含 `missing_section: 成功标准`，Initiative 状态保持 `awaiting_plan`

**场景 2**（US-001）— task-plan.json 拓扑非法：
- Given task-plan.json 中存在依赖环（ws1 → ws2 → ws1）
- When Runner 调用 pre-flight 校验
- Then 校验返回 fail，错误清单包含 `dag_cycle_detected`，并列出环路节点

**场景 3**（US-002）— 校验结果落库：
- Given 任意一次 pre-flight 调用（无论 pass 或 fail）
- When 校验完成
- Then Brain `preflight_results` 表新增一行，含 initiative_id、verdict、failures[]、created_at

**场景 4**（US-003）— API 查询历史：
- Given Initiative B2 已经过 3 次 pre-flight（2 fail / 1 pass）
- When 调用 `GET /api/brain/initiatives/{id}/preflight`
- Then 按时间倒序返回 3 条记录

**场景 5**（US-001）— 合法 Initiative 直通：
- Given Initiative B2 的 PRD 与 task-plan.json 均合规
- When Runner 调用 pre-flight 校验
- Then 校验返回 pass，Initiative 状态推进到 `ready_for_generator`

## 功能需求

- **FR-001**: 提供 pre-flight 校验入口，输入为 Initiative 目录路径，输出为结构化判定（verdict + failures[]）
- **FR-002**: PRD 结构校验：必须包含目标、User Stories、验收场景、功能需求、成功标准 5 个段
- **FR-003**: task-plan.json 结构校验：tasks 数量在 1-8、每条 dod 至少 1 项、estimated_minutes ∈ [20, 60]、depends_on 字段必填
- **FR-004**: DAG 拓扑校验：禁止自指、禁止环路、所有 depends_on 引用的 task_id 必须在同文件中存在
- **FR-005**: 校验结果落 Brain `preflight_results` 表，含 verdict、failures、created_at
- **FR-006**: 提供 `GET /api/brain/initiatives/{id}/preflight` 端点返回最近 N 次校验记录

## 成功标准

- **SC-001**: 对一组覆盖 9 类已知违规的 fixture 集合，pre-flight 命中率 = 100%（不漏报）
- **SC-002**: 对一组合规 fixture，pre-flight 误报率 = 0%
- **SC-003**: 单次校验在 200ms 以内返回（非网络瓶颈场景）
- **SC-004**: Initiative B2 自身在最终交付时一次性通过 pre-flight（pass）
- **SC-005**: API 端点对不存在的 initiative_id 返回 404，不抛 500

## 假设

- [ASSUMPTION: Brain context 端点（localhost:5221/api/brain/context）当前不可达，OKR/历史 PR 数据未读取，KR 对齐基于任务描述推断]
- [ASSUMPTION: capacity-budget 端点不可达，使用硬编码 LOC 阈值 soft=200 / hard=400]
- [ASSUMPTION: Brain 已存在 PostgreSQL 与迁移机制，新增 preflight_results 表走标准 migration 路径]
- [ASSUMPTION: pre-flight 校验由 Brain 同进程实现，不引入新服务]

## 边界情况

- 空 sprint-prd.md（0 字节）→ 视为 fail，failures 含 `prd_empty`
- task-plan.json 不存在 → 视为 fail，failures 含 `task_plan_missing`
- task-plan.json 是合法 JSON 但 schema 不符 → 失败时给出具体字段路径
- 单 Initiative 短时间内（< 1s）多次触发 pre-flight → 每次都落库，不去重（追溯优先）
- depends_on 引用了不存在的 task_id → fail，failures 含 `dangling_dependency: <id>`

## 范围限定

**在范围内**:
- pre-flight 校验逻辑（PRD 段校验 + task-plan.json schema 校验 + DAG 拓扑校验）
- Brain `preflight_results` 表 schema + migration
- `GET /api/brain/initiatives/{id}/preflight` 端点
- 集成进 Initiative Runner 的 Planner → Generator 切换点
- Initiative B2 自身的 PRD/task-plan 合规化（确保 SC-004）

**不在范围内**:
- Generator 阶段的代码质量校验（Evaluator 负责）
- 校验失败后的自动重写（Planner 负责）
- 前端 Dashboard 可视化 pre-flight 历史
- 跨 Initiative 的依赖图分析
- 性能优化（除 SC-003 的基线要求外）

## 预期受影响文件

- `packages/brain/migrations/XXX_preflight_results.sql`: 新增 preflight_results 表
- `packages/brain/src/preflight.js`: pre-flight 校验核心逻辑
- `packages/brain/src/server.js`: 注册 `GET /api/brain/initiatives/:id/preflight` 路由
- `packages/brain/src/initiative-runner.js`: 在 Planner → Generator 切换点插入 pre-flight 调用
- `packages/brain/test/preflight.test.js`: pre-flight 单元测试（覆盖 9 类违规 + 合规 fixture）
- `sprints/sprint-prd.md`: 本 PRD（自身需通过 pre-flight）
