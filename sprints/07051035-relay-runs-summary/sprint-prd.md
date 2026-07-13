# Sprint PRD: relay-runs 阶段汇总端点

## 任务概述
给 Brain 加 `GET /api/brain/orchestrator/relay-runs/summary` 端点，返回当前各 phase 的 relay run 计数，供 dashboard 一眼看全局分布。

## Golden Path（单线性）
1. 调用方 `GET /api/brain/orchestrator/relay-runs/summary`
2. 系统查 `initiative_runs` 表，按 `phase` GROUP BY 计数
3. 返回 JSON `{ phases: { planning: N, gan: N, generate: N, evaluate: N, done: N, failed: N }, total: N }`
4. 无数据时返回各 phase=0 + total=0（不报错）

## 涉及文件
- `packages/brain/src/routes/initiatives.js`（唯一改动点）

## 技术约束
- summary 路由必须注册在 `:initiative_id` 通配路由**之前**，否则 `summary` 被当作 initiative_id 匹配
- 查询只计 `orchestrator_version = 'v2'` 的行（与现有 relay-runs 端点一致）
- 返回的 phase 枚举固定：planning / gan / generate / evaluate / done / failed（来自 migration 312）
- 无数据场景：phases 里每个 key=0，不是空对象

## Invariant 约束
- 新端点不得破坏现有 GET /relay-runs 列表端点和 GET /relay-runs/:initiative_id 端点
- 不允许暴露 DB 内部错误信息（500 只返回通用 error 字符串）
- 路由注册顺序：summary 在 :initiative_id 之前

## 累积 FR
- FR-01: 返回 200 + JSON 对象，含 phases + total 字段
- FR-02: phases 包含固定六个枚举 key（无论是否有数据）
- FR-03: 无数据时全部为 0，不报错
- FR-04: 只统计 orchestrator_version='v2' 的行

## NFR
- 响应时间 < 500ms（单次聚合查询，本地 DB）
- 不增加额外依赖

## 验收标准（Final E2E, local_api）
- [ ] `curl GET /api/brain/orchestrator/relay-runs/summary` 返回 200
- [ ] 响应含 phases 对象 + total 字段
- [ ] phases 包含六个 key（planning/gan/generate/evaluate/done/failed）
- [ ] 无数据场景返回 0 不报错
- [ ] CI 全绿

journey_type: harness-pipeline
target_environment: local_api
