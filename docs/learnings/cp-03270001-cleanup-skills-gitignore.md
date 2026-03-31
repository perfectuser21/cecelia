# Learning: cleanup-skills-gitignore

## 背景
随着系统迭代，`packages/workflows/skills/` 下积累了大量已迁移或废弃的 skill（batch-luxury-card-generator、batch-notion-analyzer、content-analyzer、content-creator、content-rewriter、creator、image-gen-workflow、luxury-card-generator、two-layer-parallel-analyzer 等）。这些 skill 的 SKILL.md 和脚本文件已不再被系统使用，但仍留在仓库中造成噪音。同时 `.gitignore` 缺少对开发日志文件的忽略规则，导致临时调试文件容易被误提交。

## 根本原因
1. skill 生命周期管理缺失：skill 被迁移到新位置或废弃后，没有及时清理旧文件，随着版本迭代逐渐堆积，最终需要一次性批量清理。
2. `.gitignore` 规则不完整：开发过程中产生的 dev log 文件（如 `.prd-cp-*.md` 等临时文件）未被忽略，存在被误提交的风险，需要补充忽略规则。
3. 手动命令白名单脚本缺失：`scripts/devgate/check-manual-cmd-whitelist.cjs` 是 devgate 检查流程所需的白名单校验脚本，之前未被纳入版本控制，导致相关 CI gate 无法正常运行。

## 下次预防
废弃或迁移 skill 时，应在同一个 PR 中同步删除旧文件，并在 `.gitignore` 中及时补充临时文件的忽略规则，避免积累后需要大规模清理。

## Checklist
- [x] 删除 9 个废弃 skill 的 SKILL.md 及相关脚本文件
- [x] 更新 `skill-creator/skill-index.md`，移除废弃 skill 的索引记录
- [x] 在 `.gitignore` 中添加开发日志文件的忽略规则
- [x] 添加 `scripts/devgate/check-manual-cmd-whitelist.cjs` 白名单校验脚本
