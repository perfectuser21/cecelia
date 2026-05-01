# Memory Search Roundtrip Integration Test — Design Spec

**日期**: 2026-05-01  
**Brain Task**: f42e41d7-9303-461b-93d1-27f7f9a500ed  
**PR**: brain-test-pyramid PR2

---

## 背景

Memory 搜索 API（`/api/brain/memory/search`）目前只有端点存活检查（HTTP 200），
没有"存入内容→语义搜索→验证检索到"的闭环测试。本 PR 补充这条闭环 integration test。

---

## 架构理解

### Memory 搜索链路

```
POST /api/brain/memory/search
  → MemoryService.search(query, options)
    → SimilarityService.searchWithVectors(query, {topK})
      → 尝试 OpenAI embedding（CI 无 API Key，会失败）
      → fallback: SimilarityService.searchSimilar()（Jaccard 相似度）
        → 从 tasks 表 + okr_initiatives 表读取数据
        → 计算 Jaccard score + keyword boost
        → 返回 topK 结果
```

**关键点**：Memory 没有独立的 store 端点，数据来源是 tasks 表。  
闭环测试的方式：直接往 tasks 表 INSERT 测试数据 → 调用 search → 验证找到 → afterAll 清理。

### Jaccard Score 机制

- score = (token intersection) / (token union) + keyword boost(+0.1 per match, max 0.3)
- 过滤阈值：score > 0.3（searchSimilar 会 filter 掉低于 0.3 的结果）
- 测试数据需要有足够的词汇重叠，确保 score > 0.3

---

## 测试方案

### 文件位置

`packages/brain/src/__tests__/integration/memory-search-roundtrip.integration.test.js`

### 测试范围（行为级，非端点存活）

1. **闭环测试**：直接 INSERT 带唯一标识的 task → POST /api/brain/memory/search → 验证结果包含该 task
2. **字段验证**：结果包含 `id`, `level`, `title`, `similarity`, `preview` 字段
3. **score 有效性**：similarity 在 [0, 1] 范围内
4. **唯一标识匹配**：通过 task ID 确认是刚写入的那条
5. **teardown 清理**：afterAll 删除测试数据

### Mock 策略

- **mock openai-client.js**：让 embedding 生成失败 → 触发 Jaccard fallback（CI 无 OpenAI Key）
- **真实 DB 连接**：使用 cecelia_test 数据库（brain-integration job 提供 PostgreSQL service）
- **supertest + express**：挂载 memory router，发 HTTP 请求测试完整链路

### 测试数据设计

写入的 task 必须含有与搜索查询重叠的词汇，确保 Jaccard score > 0.3：
- title: `[memory-roundtrip-test] 用户认证登录鉴权集成测试` 
- description: `用户登录认证鉴权 JWT token 验证集成测试专用数据`
- 搜索词: `用户认证登录` → 与 title/description 大量 token 重叠

---

## 测试策略

**测试类型**: Integration Test（跨模块：HTTP 路由 → Service → DB）

**分类依据**:
- 跨 3 个模块（memory.js 路由 → memory-service.js → similarity.js → DB）
- 涉及真实 DB I/O
- 验证端到端行为而非单函数

**运行环境**: `brain-integration` CI job（pgvector/pgvector:pg15 service + 迁移已跑）

---

## 成功标准

- [ ] 写入 task 后 search API 能找到它（通过 task ID 匹配）
- [ ] 返回结果包含 `id`, `level`, `title`, `similarity`, `preview` 字段
- [ ] `similarity` 在 (0, 1] 范围内（Jaccard > 0 证明搜索有效）
- [ ] afterAll 清理后 DB 无残留测试数据
- [ ] CI brain-integration job 通过
