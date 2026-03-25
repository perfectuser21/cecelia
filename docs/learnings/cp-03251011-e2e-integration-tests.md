# Learning: E2E集成测试补全 — 记忆路由链 + Thalamus动作验证

**Branch**: cp-03251011-e2e-integration-tests  
**Date**: 2026-03-25  
**PR**: TBD

## 交付内容

新增 2 个跨模块集成测试文件（共 29 个新测试用例）：
1. `memory-router-retriever.integration.test.js` — routeMemory × buildMemoryContext 联动
2. `thalamus-action-whitelist.integration.test.js` — ACTION_WHITELIST × validateDecision 验证链

### 根本原因

现有 integration/ 目录仅有 3 个测试（tick 循环），记忆系统（6 个 PR）和 Thalamus 验证链缺少集成级覆盖。单元测试各自 mock 隔离，无法验证模块间合约（跨模块接口不一致时无法发现）。

核心发现：`routeMemory` 返回的 `MEMORY_STRATEGY` 中 `episodic`/`semantic`/`events` 布尔值直接决定 `buildMemoryContext` 的 DB 查询路径，但这条联动链从未被测试过。

`ACTION_WHITELIST` 和 `validateDecision` 的字段契约（`rationale`/`confidence`/`safety`）也未被集成测试覆盖，配置删除时无法检测。

### 下次预防

- [ ] 新增跨模块功能时，同步在 `src/__tests__/integration/` 添加集成测试
- [ ] `manual:` BEHAVIOR 测试断言不能是恒真条件（`>= 0` 类），用 code_review_gate 检查
- [ ] 测试 thalamus 时，注意 `validateDecision` 需要 `rationale`/`confidence`/`safety` 三个必填字段（非 `reasoning`）
- [ ] mock `similarity.js` 时需要包含 `searchWithVectors` 方法（非 `search`）

## 技术要点

### Mock 策略

```
memory-router-retriever 集成测试:
  真实: memory-router.js + memory-retriever.js
  Mock: db.js, openai-client.js, similarity.js(含 searchWithVectors), 
        learning.js, distilled-docs.js, embedding-service.js

thalamus 集成测试:
  真实: thalamus.js (ACTION_WHITELIST + validateDecision)
  Mock: db.js, llm-caller.js, memory-retriever.js, learning.js,
        embedding-service.js, role-registry.js, distilled-docs.js,
        decisions-context.js, cortex.js
```

### 正确的验证模式

```js
// ❌ 恒真断言（无效）
expect(callCount).toBeGreaterThanOrEqual(0);

// ✅ 负向路径验证
const embeddingQuery = mockPool.query.mock.calls.some(
  ([sql]) => sql.includes('memory_stream') && sql.includes('embedding')
);
expect(embeddingQuery).toBe(false); // STATUS_CHECK 不应触发 embedding 查询

// ✅ 代理指标验证语义搜索路径
expect(searchRelevantLearnings).toHaveBeenCalled(); // TASK_QUERY 触发语义搜索
```
