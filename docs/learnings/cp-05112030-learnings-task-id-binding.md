# Learning: learning 入库强制 task_id 列绑定 — 闭合 Insight-to-Action 断裂

**Branch**: cp-05112030-learnings-task-id-binding
**Date**: 2026-05-11
**PR**: #2915
**触发 Insight**: 1961d5f3-d79e-4184-a7ff-b4556f0f51a7（第 3 次复现）

## 根本原因

Cortex Insight 已 3 次复现"Insight-to-Action 断裂"。根因不是单次失误，是**结构性漏洞**：

1. **routes/tasks.js:228** 的 `learnings-received` 端点早就接收 `task_id` 参数，但
   line 262-269 的 INSERT 语句**完全丢弃了它**。dev workflow 每次 PR merge 都通过
   `fire-learnings-event.sh` 明确传了 task_id，Brain 静默扔掉。
2. **learning.js:80-93** `recordLearning` / **auto-learning.js:84-94** `createAutoLearning`
   把 task_id 塞进 `metadata` JSONB —— SQL 查询不到、索引不到、反查不到。
3. **schema 缺列**：`learnings` 表根本就没有 `task_id` 列。
4. 结果：learning 与具体任务彻底脱钩，"知识"只能停留在文档层。CI 跑过、PR 合过，但
   下次该任务复现时，调度器无法把这条 learning 当作硬约束注入决策。

**"接收参数但 INSERT 不存"是最典型的代码层漏洞** —— 编译/lint 都不报错，单元测试不覆盖时
完全隐形，必须靠数据反查或人工 grep 才能发现。

## 下次预防

- [ ] **任何接收 task_id 的 API，INSERT 都必须把它写入一等列**，禁止只塞 metadata JSONB。
      schema 上没有列就先加列，不能"先存 metadata 以后再说"。
- [ ] **每加一个外部传入字段，单元测试必须断言 INSERT params 命中它**。tests/learnings-task-id-binding.test.js
      的 4 个测试就是模板：mock pool + 拦截 SQL + 检查 params。
- [ ] **学习类表必须有 task_id 外键**（ON DELETE SET NULL，nullable 允许对话类无主 learning），
      让 task 删除时数据库自己处理引用，而不是靠应用层维护。
- [ ] **缺失关键关联时主动告警 + 留痕到 cecelia_events**，而不是静默写 null。
      learnings-received 缺 task_id → console.warn + 写 `learnings_received_missing_task_id` 事件。
      这样未来谁再丢字段，dashboard 能查得到。
- [ ] **migration 改 schema 时同步升 EXPECTED_SCHEMA_VERSION**，并 grep 所有硬编码版本号的测试。
      本次 selfcheck.test.js / learnings-vectorize.test.js 各漏了一处 270 硬编码导致 CI 失败。
- [ ] **回填历史数据**：新增列时不能只管新写入，应该用 migration 内的 UPDATE 把
      `metadata->>'task_id'`（合法 UUID 且 tasks 表存在）回填到新列，保证历史可查。

## 变更摘要

- `packages/brain/migrations/271_learnings_task_id_binding.sql`：加 task_id 列（外键 + 索引）+ 回填
- `packages/brain/src/routes/tasks.js`：learnings-received 把 task_id 写列；缺失告警 + 写事件
- `packages/brain/src/learning.js`：recordLearning task_id 写列（同时保留 metadata 兼容）
- `packages/brain/src/auto-learning.js`：createAutoLearning 从 metadata.task_id（合法 UUID）提升为列
- `packages/brain/src/selfcheck.js`：EXPECTED_SCHEMA_VERSION 270 → 271
- `packages/brain/tests/learnings-task-id-binding.test.js`：4 例验收（recordLearning ×2，createAutoLearning ×2）
- `packages/brain/src/__tests__/selfcheck.test.js` & `learnings-vectorize.test.js`：同步硬断言 271
