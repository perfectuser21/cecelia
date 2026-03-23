# Learning: OKR 业务代码迁移 PR6 — MEDIUM 组A

**分支**: cp-03232334-okr-migration-pr6-medium-a
**日期**: 2026-03-23

## 概述

将 decomposition-checker.js / okr-tick.js / project-activator.js / project-compare.js
从旧 goals/projects 表迁移到新 OKR 7-表体系（key_results/objectives/okr_projects）。

## 根本原因

### 为什么需要这次迁移

migration 177-179 建立了新 OKR 7-表体系并完成数据迁移，但大量业务代码仍引用旧表。
为保证双写期后能安全废弃旧表，需逐批将业务代码切换到新表。

## 关键技术决策

### key_results 没有 priority 字段

`okr_projects` 和 `key_results` 均没有 `priority` 字段（旧 `goals` 表有）。
解决方案：`computeActivationScore` 接受 `priority=null` 时返回 0 分（与 P2 以下等效），
行为可接受。用 `NULL::text AS priority` 在 SQL 中返回 null。

### getGoalsByStatus 改为支持数组参数

原函数只接受单个 status 字符串，新函数改为接受数组（向后兼容，单值传入时转为 `['value']`）。
`WHERE status IN ($1, $2, ...)` 动态生成占位符。

### Check D (checkObjectiveWithoutKR) 查 objectives 表

旧代码查 `goals WHERE type IN ('vision', 'mission')`，新代码查 `objectives`（objectives 没有 type 字段）。
`objectives` 就是旧 `area_okr` goals 层。`NOT EXISTS (SELECT 1 FROM key_results WHERE objective_id = g.id)` 替代原来的 parent_id 查询。

### okr-tick.js 中 triggerPlannerForGoal 的回退逻辑

`UPDATE goals SET status='ready'` 由 Hook 自动修改为 `UPDATE key_results SET status='ready'`。
这是正确的，因为 goal.id 是 KR 的 UUID（双写同步保证了 goals 表也同步更新）。

## 下次预防

- [ ] 迁移前先检查目标表的字段完整性（新表没有 priority 等旧表字段）
- [ ] 使用 `NULL::text AS fieldname` 处理新表缺少的字段，不要硬编码默认值
- [ ] Check D 类型的 "objective 无 KR" 检查要注意新表用 `objective_id` 外键，不是 `parent_id`
- [ ] worktree 中 bash-guard/branch-protect Hook 的 `git rev-parse` 会在主仓库执行，
  seal 文件需要同时复制到主仓库根目录才能通过验证
