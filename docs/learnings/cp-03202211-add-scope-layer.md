# Learning: 添加 Scope 层级

## 背景
在 Project 和 Initiative 之间加入 Scope 层（Shape Up 方法论），解决拆解粒度过粗的问题。

### 根本原因
Project（1周）直接拆到 Initiative（1-2小时）跨度太大，导致 `/decomp` 拆解质量不够细。行业最佳实践（Shape Up、SPIDR）建议加中间缓冲层。

### 下次预防
- [ ] 新增层级时同步更新所有检查器（initiative-closer、decomposition-checker、tick.js）
- [ ] 同一张表加新 type 值时，搜索所有 `type = 'initiative'` 和 `type = 'project'` 的 SQL 查询，评估是否需要加入新 type
- [ ] Engine 的 `generate-feedback-report.test.ts` 在 worktree 环境下有 flaky 问题（脚本读的 `.dev-execution-log.jsonl` 被 cwd 影响），需要独立修复

### 关键决策
- Scope 复用 `projects` 表，通过 `type='scope'` 区分，无需新表
- `decomposition_depth` 调整：0=project, 1=scope, 2=initiative
- 向后兼容：Project 完成检查同时支持 `type IN ('initiative', 'scope')`
