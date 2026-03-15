---
id: learning-cp-03152237-fix-dev-skill-docs
version: 1.0.0
created: 2026-03-15
updated: 2026-03-15
changelog:
  - 1.0.0: 初始版本
---

# Learning: Dev Skill 文档一致性修复

## 背景

SKILL.md 在 v4.0 Task Card 重构后（11步 → Step 0-5），遗留了若干文档未同步更新的问题：track.sh 调用仍引用旧的 11 步编号，Task Checkpoint 仍有 11 个 TaskCreate，--task-id 步骤引用仍是 Step 2-11。

## 根本原因

### 根本原因

文档重构时只更新了流程图和步骤映射表，但未同步更新：
1. `## 状态追踪` 中的 track.sh 调用列表（仍为 step 1~11）
2. `## Task Checkpoint 追踪` 中的 TaskCreate 列表（仍为 11 个旧步骤名）
3. `## --task-id 参数` 中的流程图（仍写 Step 2-11）

另外 03-prci.md 的 CI 状态查询在 `gh run list` 返回空数组时会 jq 报错（`null` 状态）。

### 下次预防

- [ ] 每次做步骤重构时，同时检查 `## 状态追踪` 和 `## Task Checkpoint 追踪` 两节的枚举列表是否与新步骤对齐
- [ ] CI 查询脚本中 `jq -r '.[0].xxx'` 前必须加 `jq 'length'` 空值检查，防止空数组时输出 `null`
- [ ] SKILL.md frontmatter 的 version/updated 字段在每次 skills 改动时必须同步更新
