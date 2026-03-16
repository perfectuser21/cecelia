---
version: 1.0.0
created: 2026-03-16
branch: cp-03161632-auto-update-skills-index
---

# Learning: Skills 索引自动生成脚本

## 根本原因

`.agent-knowledge/skills-index.md` 原为手动维护，新增 Skill 时容易遗漏。
`packages/workflows/skills/` 是仓库内的真实 Skills 来源（SSOT），但从未自动读取。

## 实现要点

- 扫描 `packages/workflows/skills/*/SKILL.md`，读取 frontmatter 的 `name` + `description`
- 保持现有分类（44个已分类 Skills 不动），新增 Skills 追加到"待分类"区块
- `--dry-run` 参数打印预览不写文件，方便 DoD 验证和日常检查
- 首次运行发现 19 个未索引的 Skills（autumnrice/cecelia/nobel 等）

## 下次预防

- [ ] 新增 Skill 到 `packages/workflows/skills/` 后，记得运行 `node scripts/generate-skills-index.mjs`
- [ ] Learning 文件必须在**第一次 push 前**写好，不能等 CI 报错再补
- [ ] SKILL.md 的 `description` 多行块格式要写清楚，脚本会取第一行作为摘要
