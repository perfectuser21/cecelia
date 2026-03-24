# Learning: 记忆系统修复 — 对话写入 memory_stream（salience_score + emotion_tag）

Branch: cp-03241902-memory-conversation-write
PR: #1508
Date: 2026-03-24

---

### 根本原因

Cecelia 的 memory-retriever 从 `cecelia_events`（无 embedding）读取对话历史，
导致对话记录无法参与语义检索，只能按时间顺序读取最近 N 条。

同时，`memory_stream` 写入对话时：
1. 无 `salience_score`：所有对话等权重，无法区分纠正/决策类高 RPE 事件
2. 无 `emotion_tag`：情绪状态未与记忆绑定
3. source_type='orchestrator_chat'：语义不清晰，与事件总线的 source 混淆

CI 过程暴露了 4 个额外问题（见下方预防清单）。

---

### 修复内容

1. **DB migration 187**：memory_stream 新增 `salience_score FLOAT` + `emotion_tag TEXT` + conversation_turn 索引
2. **computeSalience()**：纠正→0.9 / 决策→0.8 / 疑问→0.6 / 普通→0.3，基于 RPE 原理
3. **orchestrator-chat.js**：两处 INSERT 改用 source_type='conversation_turn'，写入 salience_score 和 emotion_tag
4. **memory-retriever.js**：loadConversationHistory 主路径改用 memory_stream，空时 fallback cecelia_events
5. **ci-l3-code.yml**：workflow_dispatch 时 BASE_REF 空值加 `:-main` fallback

---

### 下次预防

- [ ] **Migration 编号前检查**：写新 migration 前执行 `ls packages/brain/migrations/ | sort -n | tail -1` 确认最大编号，避免并行 PR 碰撞。本 PR 与 OKR PR12 同时使用 186，需重命名为 187。

- [ ] **workflow_dispatch BASE_REF 防御**：凡使用 `github.base_ref` 的 CI 步骤，必须加 `BASE_REF="${BASE_REF:-main}"` fallback，防止 manual dispatch 时空值破坏 git diff 命令。

- [ ] **改写主路径后更新测试 mock**：当函数新增前置查询路径时，相关测试的 mock 必须按 SQL 内容区分返回（`mockImplementation((sql) => sql.includes('...') ? ... : ...)`），不能用统一 `mockResolvedValue`。本 PR 中旧 mock 导致 memory_stream 路径拿到 cecelia_events 格式行，`content` 为空，断言失败。

- [ ] **DoD Test 中避免嵌套双引号**：`manual:node -e "..."` 命令内需要匹配含单引号字符串时，用变量赋值替代内联 includes 参数：`const t='conversation_turn';if(!c.includes(t))` 而非 `c.includes("'conversation_turn'")`。

- [ ] **selfcheck + DEFINITION + 测试文件四处同步**：修改 migration 编号后需同步更新：selfcheck.js EXPECTED_SCHEMA_VERSION、DEFINITION.md schema_version、selfcheck.test.js 断言、desire-system.test.js 断言（及任何其他引用版本号的测试文件）。

- [ ] 新增 memory_stream source_type 时，同步在 memory-retriever 注册检索路径
- [ ] 每条 memory_stream 写入应携带显著性评分，避免均等权重

---

### 关键洞察

- 情节记忆（memory_stream）和事件总线（cecelia_events）职责分离：
  事件总线是操作日志（无 embedding），记忆流是可检索的经历（有 embedding）
- salience_score 是记忆巩固优先级的关键机制（对应神经科学 RPE 概念）
- 情绪标签（emotion_tag）与记忆强度正相关，高情绪唤醒事件应优先巩固
