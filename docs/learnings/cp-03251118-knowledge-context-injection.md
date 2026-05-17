# Learning: 知识感知闭环 — Brain 工具地图注入

**Branch**: cp-03251118-knowledge-context-injection
**Date**: 2026-03-25

### 根本原因

Brain 已有 dev_records/design_docs/decisions/memory_stream 等多张表，数据是有的，但 Claude 每次开口时是白板状态——不知道这些表存在，不知道有哪些 API 可以查。
根本缺口不在于"没有数据"，而在于"没有工具感知层"：Claude 不被告知"你可以查什么"，自然也不会去查。
同时 conversation-consolidator 虽然存在，但 Stop Hook 从未触发它，对话结束时的 summary 形同虚设。

### 修复方案

1. 新建 `GET /api/brain/context` 汇总接口：一次返回 OKR进度 + 最近PR + 活跃任务 + 有效决策 + summary_text
2. 在 `okr-hierarchy.js` 加 `GET /api/brain/okr/current` 端点
3. 在 `.claude/CLAUDE.md` 加"Brain 知识查询工具"章节，让 Claude 每次对话开始就知道能查什么
4. `POST /api/brain/conversation-summary` + Stop Hook 触发，对话结束自动写 memory_stream

### 下次预防

- [ ] 新建 Brain 数据表时，同步在 CLAUDE.md 工具地图中登记对应查询接口
- [ ] 新建 Brain 模块时，检查是否需要在 `/api/brain/context` 汇总接口中体现
- [ ] stop.sh 改动后验证：非 dev/decomp/architect 模式下的普通对话能否正确触发 summary
