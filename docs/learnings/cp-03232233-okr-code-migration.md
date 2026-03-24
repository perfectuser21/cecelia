# Learning: OKR 业务代码迁移（批次1）

branch: cp-03232233-okr-code-migration
date: 2026-03-23

## 背景

将 kr-verifier.js、orchestrator-realtime.js、heartbeat-inspector.js 从旧 `goals`/`projects` 表迁移到新 OKR 表（key_results、UNION 全表）。

### 根本原因

迁移旧表代码时，只关注了实现文件（heartbeat-inspector.js），忘记同步更新对应的测试文件。
heartbeat-inspector.test.js 的断言 `expect(calls[3]).toContain('goals')` 仍然检查旧表名，
而实现已改为 `key_results`，导致本地 vitest 测试失败（需要进入 worktree 目录单独运行才能发现）。

### 下次预防

- [ ] 改 SQL 查询的表名后，立即搜索对应测试文件中所有 `.toContain('旧表名')` 断言并同步更新
- [ ] 在修改实现文件前，先用 `grep -r '旧表名' __tests__/` 找出所有相关测试，列出待更新清单
- [ ] vitest 从根目录运行会扫描所有 worktree，失败可能来自其他 worktree 的预存在问题，需要单独进入 worktree 目录验证

## 技术备忘

- key_results 的状态值在新表中为 `'active'` 和 `'in_progress'`，不是旧表的单一 `'in_progress'`
- orchestrator-realtime.js 的 UNION 查询合并 6 张新 OKR 表状态，返回字段需与原始接口兼容（goals.reduce 仍有效）
- UUID 在 migration 179 中完全保留：`goals.id == key_results.id`，无需改 WHERE id=$1 逻辑
