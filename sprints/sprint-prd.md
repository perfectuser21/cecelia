# Sprint PRD

## 产品目标

Brain 任务执行完成后，result 字段应记录本次执行的成本与效率数据（耗时、token 用量、费用），让系统管理员可以通过 API 查询每个任务的资源消耗，为成本优化和效率分析提供数据基础。

## 功能清单

- [ ] Feature 1: 执行回调写入成本数据 — 任务执行结束时，result 字段自动包含 duration_ms、total_cost_usd、num_turns、input_tokens、output_tokens
- [ ] Feature 2: API 可查询成本字段 — 通过现有任务查询 API 能取到 result 里的成本数据
- [ ] Feature 3: 历史任务成本可见 — 已完成任务的 result 字段中可以看到成本信息（如果执行时有记录）

## 验收标准（用户视角）

### Feature 1: 执行回调写入成本数据
- 任务执行完成后，通过 API 查询该任务，result 字段中可以看到 `duration_ms`（整数，毫秒）
- result 字段中可以看到 `total_cost_usd`（浮点数，美元）
- result 字段中可以看到 `num_turns`（整数，对话轮次）
- result 字段中可以看到 `input_tokens` 和 `output_tokens`（整数）
- 当执行器无法获取 token 信息时，对应字段为 null 而非报错

### Feature 2: API 可查询成本字段
- `GET /api/brain/tasks/:id` 返回的 result 对象中包含上述成本字段
- `GET /api/brain/tasks?status=completed` 列表中每个任务的 result 也包含成本数据

### Feature 3: 历史任务成本可见
- 新功能上线后执行的任务，result 中有完整成本数据
- 上线前已完成的旧任务，result 为空或原有内容不受影响

## AI 集成点

不适用（此功能是对 AI 执行过程的数据采集，非 AI 能力集成）。

## 不在范围内

- 不做成本聚合报表或图表展示（只写入原始数据）
- 不做按 agent/模型维度的成本汇总
- 不做成本预警或限额控制
- 不修改现有 result 字段的其他内容
- 不对旧任务做回填

## 成功标准

执行一个 Brain 任务后，通过以下查询能看到非空的成本字段：

```
GET /api/brain/tasks/:id  →  result.duration_ms 为正整数
```
