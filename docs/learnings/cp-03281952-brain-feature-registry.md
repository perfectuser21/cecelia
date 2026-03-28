---
branch: cp-03281952-brain-feature-registry
date: 2026-03-28
task: CI L2 扩展 — Brain 新文件强制登记 brain.md
---

# Learning: CI L2 扩展 Brain 新文件检查

## 背景

Brain 新增模块（如 `self-drive.js`、`dopamine.js`、`pipeline-patrol.js`）上线后，没有 CI 门禁要求同步更新 `.agent-knowledge/brain.md`，导致功能孤岛——Claude 对话系统无法感知新模块的存在和行为。

## 解决方案

在 `ci-l2-consistency.yml` 中新增 `brain-new-files-check` job：
- 仅在 PR 事件触发
- 用 `--diff-filter=A` 精准检测新增文件（避免修改现有文件误触发）
- 只关注 `packages/brain/src/*.js` 路径
- 有新增 Brain 模块时，强制要求 `.agent-knowledge/brain.md` 同步变动

### 根本原因

Engine 有 `feature-registry.yml` 作为能力登记 SSOT，Brain 没有对应的强制登记机制。`.agent-knowledge/brain.md` 是 Claude 感知 Brain 状态的 SSOT，但没有门禁保障其时效性。

### 下次预防

- [ ] 新增任何 CI 检查 job 后，必须同步更新 `l2-passed` gate job 的 needs 数组和其中的结果判断逻辑
- [ ] 只检测 `--diff-filter=A`（新增），不检测 `M`（修改），避免对已有文件的修改产生误报
- [ ] Brain 新增模块时，标准操作是：同一 PR 内更新 `.agent-knowledge/brain.md` 对应章节

## 关键决策

| 决策 | 选项 A | 选项 B（采用）| 理由 |
|------|--------|-------------|------|
| 目标文档 | `DEFINITION.md` | `.agent-knowledge/brain.md` | brain.md 是 Claude 感知 SSOT，DEFINITION.md 更偏系统级 |
| 检测粒度 | 所有变更 | 仅新增（`A`） | 修改现有文件时不应强制更新文档 |
| job 位置 | 嵌入 brain-l2 | 独立 job | 职责分离，与 Engine 的 new-files-need-rci-check 模式一致 |
