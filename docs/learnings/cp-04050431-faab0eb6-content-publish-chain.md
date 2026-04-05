# Learning: content_publish 发布链路双 Bug — 命名不一致 + KR 查错表

## 根本原因

### Bug 1: escalation 取消 content_publish 任务（命名不一致）
`alertness/escalation.js` 的 `cancelPendingTasks` 保护列表包含 `'content-publish'`（连字符），
但 `content-pipeline-orchestrator.js` 创建的实际 task_type 是 `'content_publish'`（下划线）。

每次系统触发 escalation（如 heartbeat 任务完成后），所有 `content_publish` 发布任务都被批量取消，
导致发布链路完全中断。

### Bug 2: KR verifier 查旧架构的空表
两个 KR (`内容生成 65b4142d`、`自动发布 4b4d2262`) 的 verifier SQL 查 `content_publish_jobs`（旧架构表，只有2条 2026-03-19 的 running 记录）。
新架构的发布任务存储在 `tasks` 表（task_type='content_publish'）。
结果：KR progress = 2/150 ≈ 1%，完全反映不了实际状态。

## 诊断过程
1. 查 pipeline 任务发现多个 `completed` 但带 error_message → 状态矛盾
2. 查 `content_publish_jobs` 表 → 只有 2 条 2026-03-19 的旧记录
3. 查 `kr_verifiers` → SQL 查的是这个旧表
4. 查 `tasks` 表中 `content_publish` → 96 条记录，88 canceled，8 queued（后全 canceled）
5. 查 `cecelia_events` → 发现 `escalation:stop_dispatch` 和取消时间戳完全对应
6. 定位到 `escalation.js` 的 `cancelPendingTasks` 排除列表 → 发现连字符/下划线不一致

## 修复内容
- `packages/brain/src/alertness/escalation.js`: `cancelPendingTasks` NOT IN 列表加 `'content_publish'`
- `packages/brain/migrations/211_fix_publish_kr_verifiers.sql`: KR verifier SQL 改查 tasks 表（当日完成数，阈值改为每日目标）

## 下次预防

- [ ] **Task Type 命名规范**: 确保 orchestrator 创建任务时的 task_type 与 escalation 保护列表保持一致；新增 task_type 时同步更新 escalation 排除列表
- [ ] **KR verifier 冒烟测试**: 每次新增 task_type 时检查 kr_verifiers 是否引用了正确的数据表
- [ ] **数据库审计**: `timestamp without time zone` 列使用 `DATE(col) = CURRENT_DATE` 而不是 `AT TIME ZONE` 转换（服务器在 UTC-5）
