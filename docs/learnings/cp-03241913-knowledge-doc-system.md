# Learning: Knowledge & Documentation System

## 根本原因

Cecelia 缺乏统一知识沉淀层，导致认知断层——每次新对话都从零开始，决策/PR记录/设计文档散落各处，无法复用。

## 方案概要

- 3张新 DB 表（dev_records/design_docs/user_annotations），迁移186-188
- 3组 Brain API 端点（CRUD with 参数化查询）
- 5个前端页面（useApi hook + Tailwind CSS）
- PR 合并自动写入 dev_records（pr-callback-handler.js 非致命扩展）
- 每日 15:00 UTC 生成日报 tick（diary-scheduler.js）

## 关键洞察

1. **迁移必须用 IF NOT EXISTS** — 测试套件在独立 DB 中重跑全部迁移，不加 IF NOT EXISTS 会导致测试失败（187_design_docs.sql: relation already exists）
2. **schema_version 更新需4处同步** — selfcheck.js + DEFINITION.md + 3个测试文件（desire-system/selfcheck/learnings-vectorize 都有硬编码 '185'）
3. **mock 顺序要匹配实际调用** — pr-callback-handler.test.js 的 pool.query mock 序列需随代码新增调用而扩展，否则 mock 耗尽后抛异常
4. **facts-check 是严格门禁** — DEFINITION.md 的 schema_version 不同步会阻止开发，必须同时更新
5. **Decision 表已存在** — PRD 中 Decision Registry 不需要新建表，decisions 表 migration 009 已存在，只需要前端页面复用现有 API

## 下次预防

- [ ] 每次新增迁移时，立即搜索所有测试文件中硬编码的版本号（grep -r "185\|schema_version" src/__tests__/）
- [ ] migration 模板要包含 IF NOT EXISTS（不要在首次执行后才加）
- [ ] 新增 pool.query 调用前，检查同文件的所有测试 mock 序列是否需要扩展
- [ ] facts-check 失败 → 立即更新 DEFINITION.md，不要跳过继续编码
