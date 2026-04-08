---
branch: cp-04080313-0b18c6c6-98ff-4f1d-b772-629854
task_id: 0b18c6c6-98ff-4f1d-b772-62985455d797
date: 2026-04-08
---

# Learning: KR3/KR4 过时任务 — 诊断已完成修复

## 背景

SelfDrive 自动生成了任务"KR进度采集链路修复 — 恢复KR4/KR3实时更新"，任务创建时 KR3/KR4 进度为 0%。但该任务在执行前已被其他 PR 解决，后续 5 次执行均因技术原因失败（内存压力/API错误），不是代码问题。

## 现状（已修复）

- **KR3（微信小程序）**: current_value=25, progress=25%
- **KR4（geo SEO网站）**: current_value=25, progress=25%
- **verifier 上次运行**: 2026-04-08 04:59（US Central），60分钟轮询
- **采集逻辑**: 阶梯权重（completed=100/active=50/inactive=0），P1 active + P2 inactive → 25%

## 已修复的 PR 链

| PR | 修复内容 |
|----|---------|
| #2018 | 修复占位 SQL verifier 导致进度永远 0% |
| #2023 | 阶梯权重 verifier + P1 项目激活 + 立即回填 25% |
| #2024 | resetAllKrProgress 漏写 current_value + backfill API |

### 根本原因

任务在修复 PR 合并前被创建，修复后任务未被自动关闭。后续 5 次重试均因技术原因（watchdog OOM kill、API overloaded）失败，不是代码问题。

### 下次预防

- [ ] SelfDrive 在派发 dev 任务前，检查近期同主题 PR 是否已合并（避免重复修复）
- [ ] Brain 对于"失败因技术原因而非代码问题"的任务，在 3 次 task_error 后自动关闭而非继续重试
- [ ] watchdog OOM kill 后应记录 failure_class=resource_exhaustion 而非 task_error，避免无意义重试
