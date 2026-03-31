# Capture Digestion Pipeline

## 功能概述

Capture Digestion Pipeline 是 Cecelia 的信息消化系统，负责将用户在 `/inbox` 页面快速捕获的原始内容（captures 表）通过 LLM 自动拆解为原子事件（capture_atoms），再由用户逐条确认路由到对应目标表。

## 架构

```
captures 表（status=inbox）
    ↓ Brain tick（每轮）
capture-digestion.js（runCaptureDigestion）
    ↓ LLM 拆解
capture_atoms 表（status=pending_review）
    ↓ 用户在 /inbox Captures tab 确认
目标表（notes/tasks/decisions/events/knowledge/content_topics）
```

## 数据表

### capture_atoms
- `id`, `capture_id`（外键到 captures）
- `content`：原子事件内容
- `target_type`：notes/knowledge/content_seed/task/decision/event
- `target_subtype`：各类型下的子类型
- `suggested_area_id`：AI 推荐的 area
- `status`：pending_review/confirmed/dismissed
- `routed_to_table`/`routed_to_id`：确认后路由目标

### life_events（事件路由目标）
生活事件（旅行/聚餐/看病等），capture_atoms target_type=event 时写入此表。

## API

### GET /api/brain/capture-atoms
查询 pending_review atoms，支持 `status`、`limit` 参数。

### PATCH /api/brain/capture-atoms/:id
- `action=confirm`：确认 atom，调 routeAtomToTarget 写入目标表
- `action=dismiss`：忽略 atom

## 路由规则（6条）

| target_type | 写入目标表 |
|-------------|-----------|
| notes | notes 表 |
| knowledge | knowledge 表 |
| content_seed | content_topics 表 |
| task | tasks 表 |
| decision | decisions 表 |
| event | life_events 表 |

## Brain tick 集成

在 `packages/brain/src/tick.js` 中，capture-digestion job 以 `Promise.resolve().then(() => runCaptureDigestion()).catch()` 方式异步触发，与 conversation-digest 同级。

## 前端

在 `/inbox` 页面新增 Captures Review tab，展示所有 pending_review atoms，用户可逐条 confirm（路由到目标表）或 dismiss（忽略）。
