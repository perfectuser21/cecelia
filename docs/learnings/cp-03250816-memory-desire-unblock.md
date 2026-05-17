# Learning: 记忆系统 PR6 — Desire Unblock

Branch: cp-03250816-memory-desire-unblock
Date: 2026-03-25

## 实现内容

新建 `suggestion-cycle.js` 将 active desires 注入 suggestion pipeline：
- `getActiveDesiresForSuggestion(dbPool)` 查询 status=pending、urgency≥7、未过期的 desires（最多5条）
- `buildSuggestionPrompt(context, desires)` 构建含欲望上下文的 prompt（无 desire 时返回纯上下文）
- `runSuggestionCycle(dbPool)` 编排两步：desires → 每条 desire 创建一条 suggestion 记录

## 关键决策

### desires 表无 salience_score 字段

原 PRD 写 `salience_score>=0.7`，但 desires 表实际没有此字段（salience_score 在 memory_stream）。
替代方案：用 `urgency >= 7`（1-10 量表），语义等价于"显著度 70% 以上"。

### 新建独立模块而非修改 suggestion-triage.js

suggestion-triage.js 负责评分/去重/处理现有 suggestions，职责已清晰。
新建 suggestion-cycle.js 专门负责"desires → suggestions"的生成路径，保持单一职责。

### 直接复用 createSuggestion 接口

`createSuggestion` 在 suggestion-triage.js 中已导出，直接调用避免重复逻辑。
desire.type='warn' 映射到 suggestion_type='alert'（最高优先），其他映射到 insight_action。

## 根本原因（本次修复的断链）

Desire 系统（formation → expression）与 suggestion pipeline 是两条并行路径，没有连接。
act/follow_up 类 desire 已经走 suggestions 表，但 propose/warn/explore 类 desire 只走 expression（口头表达）而不产生 suggestion 记录，导致 Brain 无法主动将欲望转化为可执行建议。
新的 suggestion-cycle 模块补上了这个闭环：所有 urgency≥7 的 pending desire → 生成 suggestion → 进入分发队列。

## 下次预防

- [ ] 新增 Brain 模块前先检查 DB schema，不依赖 PRD 描述的字段名（可能已过期）
- [ ] desire 类型到 suggestion_type 的映射已在 suggestion-cycle.js 中内联，后续扩展在同文件更新
- [ ] runSuggestionCycle 应在 tick.js 中按频率调用（如每 5 min），这是下一步接入
