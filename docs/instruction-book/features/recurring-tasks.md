---
id: instruction-recurring-tasks
version: 1.0.0
created: 2026-03-10
updated: 2026-03-10
authority: USER_FACING
changelog:
  - 1.0.0: 初始版本
---

# Recurring Tasks — 定时自动任务

## What it is

Brain 的定时任务系统。可以配置按时间间隔或 cron 表达式自动创建并派发任务。
无需人工干预，24/7 自动运行。

## Trigger

Brain Tick Loop 每次执行时自动检查定时任务配置，到期则创建新任务。

## How to use

在 Brain 数据库中注册定时任务：

```bash
# 查看当前定时任务配置
curl -s localhost:5221/api/brain/recurring-tasks | jq

# 常见配置示例（每日架构审查）
curl -s -X POST localhost:5221/api/brain/recurring-tasks \
  -H "Content-Type: application/json" \
  -d '{
    "task_type": "arch_review",
    "interval_hours": 24,
    "title": "每日架构健康巡检"
  }'
```

## Output

- 按时间间隔自动创建 Brain Task
- Task 进入队列，等待 Brain Tick 派发
- 派发后由对应 skill 执行

## Added in

Brain 核心功能，持续演进中。
