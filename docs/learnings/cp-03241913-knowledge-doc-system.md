# Learning: Knowledge & Documentation System

## Knowledge & Documentation System（2026-03-24）

### 根本原因

Cecelia 缺乏统一知识沉淀层，导致认知断层——每次新对话都从零开始，决策/PR记录/设计文档散落各处无法复用。
同时存在 migration 编号冲突风险：并行开发时多分支可能选用相同编号，需在 push 前对齐 main 最新状态。
测试套件在独立 DB 重跑全部迁移，migration 表创建语句必须加 IF NOT EXISTS，否则重跑必报 "relation already exists"。
schema_version 更新需要同步 5 处：selfcheck.js + DEFINITION.md + desire-system/selfcheck/learnings-vectorize 三个测试文件。

### 下次预防

- [ ] 新增 migration 前先 git fetch + 检查 main 最新 migration 编号，避免编号冲突
- [ ] migration SQL 模板统一使用 IF NOT EXISTS（写模板时就加，不要事后补）
- [ ] schema_version 更新用 checklist：selfcheck.js / DEFINITION.md / 3 个测试文件同时修改
- [ ] 新增 pool.query 调用前，检查同文件测试 mock 序列是否需要同步扩展
- [ ] facts-check 失败立即修 DEFINITION.md，不跳过继续编码
