# Learning: 记忆系统 PR13 — Rumination 阈值对齐

## 背景

Branch: cp-03250948-memory-rumination-threshold
Task: 7e2939bb-d533-4d2d-b695-ee211de2b7fd
Date: 2026-03-25

## 做了什么

1. 在 `rumination.js` 中新增 3 个阈值常量 `SALIENCE_THRESHOLD_HIGH/MID/LOW`（0.85/0.75/0.55）
2. 新增 `classifySaliencePriority(score)` 函数，返回 HIGH/MID/LOW/SKIP 四级分桶
3. `fetchMemoryStreamItems` 的过滤阈值从硬编码 0.7 改为 `SALIENCE_THRESHOLD_LOW`（0.55）
4. `runRumination` 中 `allItems` 合并后按优先级排序（HIGH 先处理）
5. 新增 18 个单元测试覆盖所有分桶边界和向后兼容

### 根本原因

PR9 只更新了 `computeSalience`（生产侧），但消费侧 `rumination.js` 的过滤逻辑沿用旧的 0.7 单一阈值，导致：
- 计划类消息（0.70 分）恰好在边界，不稳定
- 长消息/疑问类（0.55 分）的有价值内容被遗漏
- 高 salience（纠正/决定 0.85+）与中 salience（洞察/情绪 0.80）混在同一优先级处理

### 下次预防

- [ ] 生产侧（computeSalience）和消费侧（rumination 过滤）应视为一对，同步更新
- [ ] 阈值应定义为有名常量（`SALIENCE_THRESHOLD_*`），不能散落在 SQL 字符串里
- [ ] 每次扩展 salience 维度时，检查所有用 `salience_score` 过滤的地方（grep: `salience_score >=`）

## 文件改动

- `packages/brain/src/rumination.js` — 新增常量 + classifySaliencePriority + 更新 fetchMemoryStreamItems + allItems 排序
- `packages/brain/src/__tests__/rumination-threshold.test.js` — 新增 18 个单元测试
