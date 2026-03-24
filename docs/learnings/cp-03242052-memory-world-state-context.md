# Learning: PR3 记忆系统 — 条件注入 WORLD_STATE + token 预算

**分支**: cp-03242052-memory-world-state-context
**日期**: 2026-03-24

## 做了什么

在 `buildMemoryContext` 中让 WORLD_STATE 注入变得智能：
- 新增 `isWorldStateQuery(query)` — 识别 OKR/任务/项目类查询
- chat 模式下 WORLD_STATE 仅在 isWorldStateQuery=true 时才加入 distilledTypes
- USER_PROFILE + WORLD_STATE 合计 token 上限 1200，超出截断
- block 总字符 > 32000 时 console.warn

## 根本原因

闲聊/情感类查询（如"今天心情怎么样"）在 chat 模式下会拉入完整 WORLD_STATE（活跃 OKR/项目列表），浪费大量 token。
原设计 distilledTypes 在 chat 模式无条件包含 WORLD_STATE，未区分查询意图。
此外 system prompt 无总长度监控，distilled docs 各自独立截断但合计未受控。

## 下次预防

- [ ] 新增蒸馏文档类型时，评估是否需要加入条件注入逻辑（不是每种文档都应无条件注入）
- [ ] mock SQL 时用 `sql.includes('distilled_docs')` 匹配，不要加 `doc_type`（实际 SQL 用 `type = $1`）
- [ ] 测试 distilled docs 注入时，mock 的 `params[0]` 即为文档类型字符串

## 技术细节

`getDoc(type, dbPool)` 使用 `SELECT content FROM distilled_docs WHERE type = $1`，params = `[type]`。测试 mock 必须匹配 `sql.includes('distilled_docs')` + `params[0] === 'TYPE_NAME'`。
