# Learning: Brain test-step API

## 变更概述
新增 POST /api/brain/content-types/test-step API，让前端工作流编辑器可以测试单个 pipeline 节点。

### 根本原因
员工在前端编辑 pipeline 节点的 prompt 时，需要立刻看到效果（调 LLM 返回结果）。
类似 N8N/扣子的单节点测试功能。
没有这个 API，员工只能发起完整 pipeline 等所有步骤跑完才能验证。
现在可以直接测单个步骤，快速迭代 prompt。

### 下次预防
- [ ] 新 API 路由添加后必须重启 Brain 才生效（PM2 或手动 kill + node server.js）
- [ ] callLLM 需要 provider 参数：anthropic 走 bridge，anthropic-api 走直连（API key）
- [ ] test-step 超时设 60 秒（LLM 生成长文案可能需要时间）
