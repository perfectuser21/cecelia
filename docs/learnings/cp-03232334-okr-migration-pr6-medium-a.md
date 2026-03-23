# Learning: OKR 业务代码迁移 PR6 MEDIUM 组A（2026-03-23）

### 根本原因

新 OKR 7-表体系（key_results/okr_projects）设计时未包含 `priority` 字段，导致
project-activator.js 和 project-compare.js 迁移时，通过 `LEFT JOIN goals` 获取的
priority 字段在改用 `LEFT JOIN key_results` 后变为 NULL。此外，worktree 开发时
bash-guard/branch-protect Hook 执行环境的 `git rev-parse --abbrev-ref HEAD` 返回主仓库
分支（main），而非 worktree 分支，导致 seal 文件路径不匹配。

### 下次预防

- [ ] 迁移前先确认新表字段完整性（特别是 priority/description 等旧表常用字段）
- [ ] 缺少字段时用 `NULL::text AS fieldname` 明确处理，加注释说明原因和后续补充计划
- [ ] Check D 类检查注意新表用 `objective_id` 外键替代旧 `parent_id`（关系结构已变）
- [ ] worktree 中写入 Gate seal 文件后，同步复制到主仓库根目录供 Hook 验证使用
- [ ] Learning 文件使用 `### 根本原因` 三级标题（不是 `##`），且内容紧接在标题后（不加子标题）
