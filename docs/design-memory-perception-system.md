---
id: design-memory-perception-system
version: 1.0.0
created: 2026-02-28
updated: 2026-02-28
changelog:
  - 1.0.0: 初始架构设计
---

# Cecelia 感知与记忆系统架构设计

## 一、现状诊断：七个断层

### 断层1：user_profile_facts 的 117 条 Facts 的 embedding 全为 NULL
`user-profile.js` 向量搜索失效，`loadUserProfile()` 读的是不存在的 `user_profiles` 表，永远返回 null。主人信息从未注入任何 LLM 调用。

### 断层2：memory-retriever 完全不查 user_profile_facts
`loadActiveProfile()` 只查 `user_profiles`（不存在）和 `goals`，117 条主人 Facts 对 Cecelia 记忆检索完全不可见。

### 断层3：对话内容没有产生 suggestions
`orchestrator-chat.js` 在对话后只做 `extractAndSaveUserFacts()`，用户说的话（意图、请求）不会变成 Brain 的输入信号。

### 断层4：Rumination 洞察不创建 suggestions
`rumination.js` 产生洞察后只写 memory_stream 或直接 createTask()，跳过了 suggestion 管道层。

### 断层5：Desire System 产生的 desires 从不变成 suggestions
374 条 desires 和 suggestions 表完全隔离，高质量 desire 永远不进入 dispatch 管道。

### 断层6：Suggestion 分数永远无法突破 0.7 阈值（最关键）
即使最高来源权重（goal_evaluator=0.9）+ 刚创建，最终分数只有 0.696，dispatcher 的 >= 0.7 过滤永远是空集。整个 suggestions 管道实际上完全不工作。

### 断层7：self_loop 产生内容没有 suggestion source 标签
5963 条 memory_stream 中 source_type 几乎全为 NULL，无法区分来源做差异化处理。

---

## 二、完整架构图

```
=== 写入侧（三个渠道）===

渠道1：主人声音（owner_input）
  对话 → orchestrator-chat.js
    ├── extractAndSaveUserFacts() → user_profile_facts [已有✅]
    └── ★NEW: extractSuggestionsFromChat() → suggestions
                source='owner_input', type='owner_request'

渠道2：自我感知（self_loop）
  Rumination → digestLearnings()
    ├── memory_stream [已有✅]
    └── ★NEW: createSuggestion() → source='rumination', type='insight_action'

  Desire System → runDesireSystem()
    ├── desires 表 [已有✅]
    └── ★NEW: act/propose/warn 类型 → createSuggestion()
                source='desire_system'

渠道3：外部世界（external）[已有但评分失效]
  goal_evaluator → suggestions [已有✅ 但分数0.60过不了阈值]
  agent_feedback → suggestions [已有✅]

           ↓
      suggestions 表
           ↓
  executeTriage()（算法评分，★修复权重）
           ↓
  dispatchPendingSuggestions()（threshold >= 0.7）
           ↓
  suggestion_plan 任务 → /plan skill → 创建结构


=== 读取侧（四层路由）===

第0层：Facts（永远加载，精确查询，不走语义）
  ★NEW: loadOwnerFacts() → user_profile_facts LIMIT 10
  约200 tokens，每次对话必加载

第1层：意图路由（memory-router.js）[已有✅]
  SELF_REFLECTION / TASK_QUERY / STATUS_CHECK / GENERAL

第2层：按需语义检索（memory-retriever.js）[已有✅]
  ★修复: loadActiveProfile() 改查 user_profile_facts
  ★新增: searchProfileFacts() 向量搜索

第3层：工作记忆（当前会话上下文）[已有✅]
```

---

## 三、PR 拆分（4个，顺序依赖）

### PR-A：修复 suggestion 分数算法（最优先，其他 PR 依赖）
- 文件：`suggestion-triage.js`（~50行）
- 改动：PRIORITY_WEIGHTS 权重表，新增 owner_input/rumination/desire_system 来源，让高质量来源基础分达到 0.75+
- 无数据库变更

### PR-B：user_profile_facts 接入记忆检索（读取侧修复）
- 文件：`memory-retriever.js`（~80行）+ 复用 `backfill-memory-embeddings.mjs`
- 改动：`loadActiveProfile()` 改查 `user_profile_facts`，新增向量搜索路径
- 无数据库变更

### PR-C：owner_input 渠道（对话生成 suggestions）
- 文件：`orchestrator-chat.js`（~20行）+ 新增 `owner-input-extractor.js`（~80行）
- 改动：对话结束后 fire-and-forget 提取可执行意图 → suggestions
- 无数据库变更

### PR-D：self_loop 渠道（rumination/desire 产生 suggestions）
- 文件：`rumination.js`（~25行）+ `desire/index.js`（~20行）
- 改动：洞察和高价值 desire 桥接到 suggestion 管道
- 无数据库变更

**依赖顺序**：PR-A → PR-B（并行 PR-C）→ PR-D

---

## 四、风险点

| 风险 | 级别 | 缓解 |
|------|------|------|
| suggestion 洪峰 | 高 | limit=2 已限流，去重已有，expires_at 7天自动清理 |
| user_profile_facts 无 embedding | 中 | 降级为最新10条精确查询，功能可用 |
| user_profiles 表不存在报错 | 中 | PR-B 绕过该查询，直接查 user_profile_facts |
| PR-A 分数调整影响历史 suggestion | 低 | triage 每 tick 重计算，是预期行为 |

---

## 五、明确不做（防止范围蔓延）

- ❌ 丘脑 LLM 评分（第二阶段再加，先算法修复）
- ❌ 创建 user_profiles 表（user_profile_facts 已足够）
- ❌ memory_stream source_type 历史清理（成本高收益低）
- ❌ Desire System LLM 评分改造（现有机制已运转）
