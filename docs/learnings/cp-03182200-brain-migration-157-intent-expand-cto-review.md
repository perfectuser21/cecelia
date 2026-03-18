# Learning: Brain Migration 157 — 新增 intent_expand + cto_review task_type

**分支**: cp-03182200-brain-migration-157-intent-expand-cto-review
**日期**: 2026-03-18
**任务**: fix(brain): migration 157 — 新增 intent_expand + cto_review task_type CHECK 约束

## 做了什么

新增 migration 157，将 `intent_expand` 和 `cto_review` 加入 tasks.task_type CHECK 约束，并在 actions.js 的 isSystemTask() 中豁免这两种类型，避免创建子任务时报 constraint violation 和 goal_id required 错误。

### 根本原因

task_type CHECK 约束没有随新类型的引入同步更新，导致向数据库插入 `intent_expand`/`cto_review` 类型任务时违反约束。同时 isSystemTask() 未豁免这两类型，导致系统自动创建时误报 goal_id required。

### 下次预防

- [ ] 每次新增业务动作类型时，必须同步：migration SQL（约束）+ task-router.js（路由）+ isSystemTask()（豁免）+ selfcheck.js（版本）+ 3 个测试文件（版本基线）
- [ ] facts-check.mjs 已自动校验 task_types 列表与 DEFINITION.md 一致，每次改动前运行可提前发现遗漏

## 技术细节

- migration 157 幂等设计（DROP CONSTRAINT IF EXISTS + ON CONFLICT DO NOTHING）
- facts-check.mjs 自动验证 selfcheck_version_sync（最高 migration 号 = EXPECTED_SCHEMA_VERSION）
- 修改了 6 个文件：migration SQL、actions.js、selfcheck.js、3 个测试基线
