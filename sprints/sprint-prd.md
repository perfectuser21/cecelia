# Sprint PRD

> planner_task_id: b26e5c34-88f9-4fa9-b897-ce58df8bf473
> generated_at: 2026-04-09 11:55 CST

## 产品目标

运维人员需要在不重启 Brain 的情况下，快速查看当前 tick 循环的运行统计（执行次数、最近一次执行时间、平均耗时），以便在故障排查时判断 Brain 是否正常运转。目前 `/api/brain/health` 只返回简单的存活状态，缺少 tick 运行统计，运维需要翻日志才能判断。

## 功能清单

- [ ] Feature 1: `/api/brain/health` 响应中新增 `tick_stats` 字段，包含 tick 执行次数、最近执行时间戳（上海时区）、最近一次执行耗时（ms）

## 验收标准（用户视角）

### Feature 1 — tick_stats 字段

- 运维调用 `GET /api/brain/health`，响应 JSON 中包含 `tick_stats` 对象
- `tick_stats` 包含以下字段：
  - `total_executions`：整数，Brain 启动以来 tick 执行总次数
  - `last_executed_at`：字符串，最近一次 tick 执行的上海时区时间（格式 `YYYY-MM-DD HH:mm:ss`），若从未执行则为 `null`
  - `last_duration_ms`：数字，最近一次 tick 执行耗时（毫秒），若从未执行则为 `null`
- Brain 刚启动时，`total_executions` 为 0，`last_executed_at` 和 `last_duration_ms` 均为 `null`
- 每次 tick 循环执行后，上述字段即时更新，下次调用 `/api/brain/health` 可看到最新值
- `tick_stats` 字段与现有 `status`、`uptime` 等字段并列存在，不破坏现有响应结构

## AI 集成点（如适用）

无。纯统计暴露，不需要 AI 能力。

## 不在范围内

- 历史 tick 执行记录持久化到数据库
- tick 统计的图表或可视化
- 跨重启保留统计（重启清零即可）
- 告警或阈值配置
- 其他 API 端点的变更
