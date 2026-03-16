---
id: learning-cp-03161732-fix-skill-md-descriptions
version: 1.0.0
created: 2026-03-16
updated: 2026-03-16
changelog:
  - 1.0.0: 初始版本
---

# Learning: 补全 11 个 SKILL.md description 字段

## 任务概要

给 `packages/workflows/skills/` 下 11 个缺少 `description:` frontmatter 字段的 SKILL.md 添加描述，防止 `generate-skills-index.mjs` 回退到文件前 100 字降级。

## 根本原因

arch-review 巡检发现：51 个 SKILL.md 中有 10 个缺少 `description:` frontmatter，导致 `generate-skills-index.mjs` 生成 skills-index 时回退到读取文件正文前 100 字，输出质量差（如 `/content-analyzer skill`）。

## 解决方案

为 11 个 SKILL.md 添加 `description:` frontmatter 字段：
- 无 frontmatter 的文件：添加完整 `---` 块（仅含 `description:`）
- 已有 frontmatter 但无 description 的文件：在 frontmatter 内追加 `description:` 字段

## 技术要点

### branch-protect hook 在 packages/ 子目录的行为

hook v25 的 `find_prd_dod_dir` 函数从被编辑文件向上查找 PRD 文件。当文件在 `packages/workflows/skills/` 下时：

1. 向上查找，遇到 `packages/workflows/.prd.md`（旧任务残留），立即返回 `packages/workflows/` 作为 PRD 目录
2. 在 `packages/workflows/` 里查找 `.task-{branch}.md`，找不到就报错"PRD 文件未更新"

**解决方法**：在 `packages/workflows/` 目录下同时放置：
- `.prd-{branch}.md`（让 hook 优先找到 per-branch PRD）
- `.task-{branch}.md`（task card 包含 DoD，hook 用 TASK_CARD 模式）

### .dev-mode 需要 tasks_created: true

branch-protect hook 还检查 `.dev-mode` 文件中是否有 `tasks_created: true`（表示已创建 Task Checkpoint）。新的 `.dev-mode` 文件需要显式加上这一行。

### generate-skills-index.mjs 只追加不更新

该脚本只会把"不在 skills-index.md 中"的新 skill 追加进去，不会更新已有条目的 description。所以即使补全了 frontmatter，已经在 index 里的 skill 条目不会被自动刷新。

## 下次预防

- [ ] 新建 SKILL.md 时，模板必须包含 `description:` 字段
- [ ] generate-skills-index.mjs 考虑增加 `--rescan` 模式，强制更新已有条目
- [ ] packages/workflows/ 子目录开发时，记得在该目录下放置 `.task-{branch}.md`
