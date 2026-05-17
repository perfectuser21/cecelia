## brain-test-pyramid L3 PR2: learning-loop integration test（2026-05-02）

### 根本原因
Brain 知识留存路径（design-doc + decisions/match）无集成测试。matchDecisions 使用关键词匹配，若 decisions 表 schema 或查询逻辑变化，知识检索静默失效。

### 下次预防
- [ ] decisions.js 支持 db 注入（第三参数）- 测试中传入 pool 避免 decisions.js 内部另起连接
- [ ] design-docs 的 type 字段是必填项，测试要覆盖缺失时的 400 响应
