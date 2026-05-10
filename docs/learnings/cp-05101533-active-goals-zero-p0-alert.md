---
branch: cp-05101533-active-goals-zero-p0-alert
created: 2026-05-10
type: insight-loop-closure
learning_ids:
  - ec71a550   # 首次 insight
  - e41acc59-f1a8-44da-994f-dc4e5b0bc95c   # 二次重复
related_prs:
  - "#2877"   # 已合并实现（main）
  - "#2873"   # OPEN — 被 #2877 取代的重复 PR
---

# 闭环：active_goals=0 P0 告警 insight 重复派发

## 现象

Cortex Insight 引擎在不同时间生成了**两个 learning_id**指向同一现象：

| learning_id | 文本 | 派发时间 |
|---|---|---|
| `ec71a550-…` | active_goals=0 是方向性崩溃前置指标，heartbeat 应监控并告警 | 2026-05-09 之前 |
| `e41acc59-f1a8-44da-994f-dc4e5b0bc95c` | active_goals=0 需要 heartbeat P0 告警：无战略锚点的系统会在任务队列中无意义消耗资源，这是方向性崩溃的先兆，不是普通状态 | 2026-05-10 |

两个 insight **语义同一**（"active_goals=0 是方向性崩溃前置信号 → heartbeat 必须发 P0 告警"），只是表述措辞不同。

## 根因

Cortex 的 insight 去重判定可能基于"文本相似度阈值"。当语义相同但措辞差异较大时（例如本例多了"无战略锚点"、"任务队列中无意义消耗"等修饰），相似度未达阈值，导致重复派发。

## 落地实现

`ec71a550` 已由 **PR #2877**（commit `45e019a9d`，2026-05-10 10:27 UTC）实现并合并到 main：

- `packages/brain/src/heartbeat-inspector.js:215-228` — `active_goals === 0` 时调用 `alerting.raise('P0', 'heartbeat_active_goals_zero', ...)`，含"方向性崩溃前置信号"语义
- `packages/brain/src/__tests__/heartbeat-inspector.test.js:331-394` — 3 个用例（触发/不触发/告警函数失败非阻塞）
- `alerting.raise` 自带 5 分钟限流，heartbeat 每 30 分钟跑一次不会被限流截断

新 insight `e41acc59` 已被同一实现完整覆盖，**无需新代码**。

## 本 PR 的动作

**只做闭环登记**，不重复实现：

1. `heartbeat-inspector.js` docstring + 第 215 行注释追加 `e41acc59` learning_id 引用，让未来 Cortex 再次派发相似 insight 时能 grep 到代码已存在
2. 写本文档存档两次派发的关系链
3. （建议但未执行）关闭 PR #2873（已被 #2877 取代）、Cortex 调高 insight 去重阈值

## 复发预防建议

- **代码层**：以后实现 Cortex insight 时，注释里登记**所有**相关 learning_id，而不仅仅是"触发本次实现的那一个"
- **Brain 层**：考虑给 insight 派发任务接口增加"已实现 learning_id 黑名单"，命中时直接 close 任务而不派发
- **Cortex 层**：相似度阈值可放宽，或在派发前 grep 主代码库 `learning_id` 字符串，命中即降级为 `won't_fix`
