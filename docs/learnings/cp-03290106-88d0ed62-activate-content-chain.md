# Learning: 激活内容生成链路（Project#17）

## 任务概要
- Branch: cp-03290106-88d0ed62-155c-482e-bbd8-6a6faa
- 完成时间: 2026-03-29

### 根本原因
SelfDrive 自动生成任务「激活内容生成链路 Project#17」时，Project#17 在 `getActiveProjects()` 查询中按 `created_at DESC` 排序为第17条（`093ea455` 每日≥5条可靠产量调度）。问题是该 project 缺少：
1. 没有 kr_id（未链接到任何 KR）
2. 没有对应的 recurring task（无法驱动每日内容生成流程）
3. status = planning（tick 的 project-activator 会激活，但没有数据驱动）

### 下次预防
- [ ] 新 Project 创建时，SelfDrive 或 thalamus 应自动检查 kr_id 是否已设置，未设置则触发 intent_expand
- [ ] Project 状态变 active 时，如果关联了 KR，应自动检查是否有对应 recurring task
- [ ] migration 版本号要先查当前最高 schema_version，避免冲突（本次 204 被并行任务占用，改用 205）

### 关键发现
1. SelfDrive 的 `getActiveProjects()` 按 `created_at DESC` 排序，`#N` 编号是动态的，不是固定 ID
2. schema_version 204 被并行任务（清理 goals 表占位符 KR）率先占用，本迁移改用 205
3. migration 的 UPDATE 使用 `WHERE status = 'planning'` 保护，幂等安全
4. recurring_tasks 的 `INSERT ... WHERE NOT EXISTS` 也保护幂等，不会重复创建
5. DoD 测试用文件内容检查（`readFileSync`）而非 curl/psql，CI 兼容

<!-- ci-trigger: SKIP-DOCS -->
