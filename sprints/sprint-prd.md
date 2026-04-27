# Sprint PRD — Initiative B1：Pre-flight 描述长度校验

## OKR 对齐

- **对应 KR**：[ASSUMPTION: 关联 Brain 健壮性/质量门禁类 KR — Brain context API 当前不可达，无法精确读取]
- **当前进度**：未知（Brain context API 不可达）
- **本次推进预期**：完成 1 个 Initiative 派发链路上的质量校验点

## 背景

Brain 在派发 Initiative 给 Harness 流水线之前，需要确保 Initiative 描述具备足够信息密度，避免 Planner 拿到一句两词的需求就强行展开成 PRD（下游 Generator/Reviewer 会浪费 token 在猜测意图上）。本 Initiative 在 Brain 端引入 pre-flight check：派发前对 Initiative 描述做最低长度校验，并对未通过的 Initiative 阻断派发、回写明确错误。

## 目标

Initiative 派发到 Harness 流水线前，被 Brain pre-flight 拦住描述过短的 Initiative，避免下游空跑。

## User Stories

**US-001**（P0）: 作为 Brain 调度器，我希望在派发 Initiative 前自动拒绝描述过短的 Initiative，以便不浪费下游 Planner / Generator / Evaluator 的 token。

**US-002**（P0）: 作为主理人，我希望被拒绝的 Initiative 在 Brain 任务记录里看到清晰的失败原因，以便我知道要补什么再重新派发。

**US-003**（P1）: 作为开发者维护 Brain，我希望 pre-flight 阈值是配置项而不是硬编码，以便后续根据实际效果调整。

## 验收场景（Given-When-Then）

**场景 1**（US-001）:
- Given Initiative 描述长度小于配置阈值
- When Brain 尝试派发到 Harness 流水线
- Then 派发被阻断，Initiative status 转为 `rejected_preflight`，不创建任何 Harness 子任务

**场景 2**（US-001）:
- Given Initiative 描述长度大于等于阈值
- When Brain 尝试派发
- Then 派发正常进行，进入 Planner 阶段

**场景 3**（US-002）:
- Given Initiative 因描述过短被拒
- When 主理人查询该 Initiative 的 task 记录
- Then 看到 `result.preflight_failure_reason` 字段，包含实际长度、阈值、提示文案

**场景 4**（US-003）:
- Given 配置文件中的阈值被修改
- When Brain 重启或热加载配置
- Then 新阈值生效，无需改代码

## 功能需求

- **FR-001**: 在 Brain 派发 Initiative 入口处加入 pre-flight check 函数，校验 `description.length >= MIN_DESCRIPTION_LENGTH`
- **FR-002**: pre-flight 失败时，写入 Initiative 的 result 字段，记录失败原因和实际长度
- **FR-003**: 阈值通过环境变量或配置文件暴露（默认值 60 字符）
- **FR-004**: 添加单元测试覆盖：通过 / 拒绝 / 边界长度三种情况
- **FR-005**: 在 DEFINITION.md 或运行时文档中记录该校验点

## 成功标准

- **SC-001**: 描述短于阈值的 Initiative 被 Brain 在派发前拦截，不会进入 Planner 阶段
- **SC-002**: 被拦 Initiative 的 task 记录包含可读的失败原因
- **SC-003**: 阈值修改后不需要改代码即可生效
- **SC-004**: pre-flight 单元测试覆盖率 100%（通过 / 拒绝 / 边界三场景）

## 假设

- [ASSUMPTION: Brain 派发 Initiative 的入口在 packages/brain/src 内可定位的单点函数]
- [ASSUMPTION: Initiative 表已存在 description 字段]
- [ASSUMPTION: Brain 已有任务 result 字段用于回写失败原因]
- [ASSUMPTION: 阈值默认 60 字符是合理起点 — 后续可根据真实数据调整]

## 边界情况

- 描述恰好等于阈值长度 → 通过
- 描述为空字符串 → 拒绝
- 描述包含大量空白字符 → 按 trim 后长度判断
- 多语言字符（中文/emoji）→ 按字符数计算，不按字节
- 同一 Initiative 被反复派发 → 每次都重新校验

## 范围限定

**在范围内**:
- Brain 派发入口的 pre-flight check 实现
- 失败原因回写
- 阈值配置化
- 单元测试

**不在范围内**:
- 描述质量评估（语义层面，例如"是否清晰"）
- 自动改写过短的描述
- Dashboard 上的可视化提示
- 其他类型的 pre-flight 校验（如关联 KR、估时合理性）

## 预期受影响文件

- `packages/brain/src/`（派发入口模块）：加入 pre-flight check 调用
- `packages/brain/src/`（新增 preflight 模块）：实现校验函数
- `packages/brain/test/`（新增测试）：覆盖通过 / 拒绝 / 边界
- `packages/brain/.env.example` 或配置入口：声明 `INITIATIVE_MIN_DESCRIPTION_LENGTH`
- `DEFINITION.md` 或对应运行时文档：记录新校验点
