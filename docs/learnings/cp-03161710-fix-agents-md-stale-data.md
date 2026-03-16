---
id: learning-cp-03161710-fix-agents-md-stale-data
version: 1.0.0
created: 2026-03-16
branch: cp-03161710-fix-agents-md-stale-data
---

# Learning: AGENTS.md 文档与实际状态漂移

## 背景

arch-review 每日巡检发现 AGENTS.md 中 Skills 计数停留在 44，而 `.agent-knowledge/skills-index.md` 已经被 PR #983 更新到 63。此外，AGENTS.md 模块地图引用了 `.agent-knowledge/engine.md`，但该文件从未被创建。

## 根本原因

1. **Skills 计数硬编码**：AGENTS.md 中 Skills 数量是手写数字，没有机制强制与 skills-index.md 保持同步。当 `generate-skills-index.mjs` 更新了 skills-index 之后，AGENTS.md 主文件没有联动更新。

2. **跨文件引用缺乏验证**：`engine.md` 被写进了 AGENTS.md 模块地图，但从未真正创建对应文件。没有 CI 检查来验证引用链路是否完整。

## 下次预防

- [ ] 考虑在 `generate-skills-index.mjs` 执行后，同时更新 AGENTS.md 中的 Skills 计数（或用占位符替代硬编码数字）
- [ ] 在 arch-review 的 4A Drift 检查中加入"引用文件是否存在"的自动化验证
- [ ] AGENTS.md 末尾脚注的版本/计数改为注释说明"通过 generate-skills-index.mjs 自动维护"

## 结果

- AGENTS.md 修正为 63 Skills（3处）
- `.agent-knowledge/engine.md` 补全，包含 Engine 组件结构、Hooks 职责、DevGate 脚本清单
