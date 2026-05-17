## brain-test-pyramid L3 PR3: cross-domain-routing integration test（2026-05-02）

### 根本原因
pending-actions 审批流和 intent/match 路由是 Brain 跨域协作的核心，但因 actions.js 依赖 LLM/外部服务导致难以测试。通过分离：pending-actions 用 DB 直写，intent/match 直接 supertest（无外部依赖），可以有效覆盖。

### 下次预防
- [ ] 复杂路由（依赖 LLM）的 CRUD 部分可以用 DB 直写替代，避免 mock 地狱
- [ ] intent-match.js 只依赖 pool，是最干净的集成测试目标
