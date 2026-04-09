# Sprint PRD

## 产品目标

Brain Harness 链路在 `harness_contract_propose` 阶段偶发 `verdict=null`（AI 未返回有效裁决），导致任务静默中断，既不重试也不报错。本次目标：为该场景实现自动 fallback 机制，确保链路在任何 verdict 异常时均能自愈，无需人工介入。

## 功能清单

- [ ] Feature 1: verdict=null 检测 — 当合同提案任务返回 verdict 为 null 或缺失时，系统能识别该异常状态（而非视为成功）
- [ ] Feature 2: 自动 fallback — 检测到 verdict=null 后，系统将任务状态重置为 PROPOSED，触发重试而非中断
- [ ] Feature 3: R1 自动创建 — fallback 触发后，系统自动创建新的 R1 合同提案轮次，链路继续推进

## 验收标准（用户视角）

### Feature 1: verdict=null 检测
- 当一次合同提案完成但 verdict 字段为 null 时，系统日志中出现明确的 fallback 触发记录，不会将其当作正常完成处理

### Feature 2: 自动 fallback
- fallback 发生后，该任务的状态在 Brain DB 中变为 PROPOSED（可在任务详情 API 中观察到），而不是停留在 in_progress 或 completed
- 整个过程无需人工操作，Brain tick 自动处理

### Feature 3: R1 自动创建
- PROPOSED 状态触发后，Brain 在下一个 tick 周期自动创建新的 `harness_contract_propose` 子任务（R1）
- 新任务中携带上轮失败信息（round 编号递增），Generator 收到后可重新提合同草案
- 从用户视角：harness 流程在 verdict=null 后，自动在几秒到几分钟内恢复运行，不需要任何手动干预

## AI 集成点（如适用）

- fallback 策略可附带上轮 null 原因摘要，作为 R1 prompt 的附加上下文，帮助 AI 下次输出更结构化的 verdict

## 不在范围内

- 修改正常 APPROVED / REVISION / REJECTED verdict 的处理逻辑
- 增加最大重试次数限制（GAN 无上限是刻意设计，见 harness-gan-design.md）
- 处理 verdict=null 以外的其他异常类型（超时、网络错误等）
- 修改 Evaluator 或 Generator 阶段的 fallback 逻辑
- UI/Dashboard 展示变更
