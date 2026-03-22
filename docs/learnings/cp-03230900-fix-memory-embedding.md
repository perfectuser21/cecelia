# Learning - learnings 向量化管道静默失败根因分析

**Branch**: cp-03230900-fix-memory-embedding
**PR**: #1399

### 根本原因

`embedding-service.js` 中 `generateLearningEmbeddingAsync` 的 catch 块是空的（`catch (_err) {}`），所有 OpenAI API 调用失败都被静默吞掉，既无日志也无重试。558 条历史 learnings 全部 embedding=null 正是因为这个原因——OPENAI_API_KEY 已正确配置，但错误从未被感知。

### 下次预防

- [ ] 任何 fire-and-forget 的异步函数，catch 块至少要有 `console.warn`，禁止空 catch
- [ ] 新增向量化路径时，同步加上 backfill 机制（启动时扫描 embedding=null 的记录）
- [ ] DB migration 添加新 migration 后，必须同步更新 `selfcheck.js` 中的 `EXPECTED_SCHEMA_VERSION`
