---
id: instruction-daily-report
version: 1.0.0
created: 2026-03-30
updated: 2026-03-30
authority: USER_FACING
changelog:
  - 1.0.0: 初始版本 — 每日内容日报自动生成
---

# Daily Report — 每日内容日报

## What it is

Brain 每天北京时间 09:00（UTC 01:00）自动生成一份 ZenithJoy 内容运营日报，汇总前一天的产出数据并推送到飞书。

## 日报内容

日报包含四个板块：

| 板块 | 内容 |
|------|------|
| **内容产出** | 昨日完成的 content-pipeline 数量 + 关键词列表 |
| **发布情况** | 各平台发布数（成功/失败）汇总 |
| **数据回收** | 各平台阅读/点赞/评论数（来自 tasks payload） |
| **异常告警** | content_publish_jobs 失败数，便于及时排查 |

## 触发机制

- 每天 UTC 01:00–01:05（北京时间 09:00–09:05）自动触发
- **幂等**：同一天内重复触发只生成一次（通过 `working_memory` 记录）

## 存储与推送

- 日报文本存入 `working_memory`，key 格式：`daily_report_{YYYY-MM-DD}`
- 通过飞书群机器人（`notifier.js`）推送

## 相关文件

- `packages/brain/src/daily-report-generator.js` — 生成逻辑主体
- `packages/brain/src/tick.js` — 调度注册（10.17d 每日内容日报）
