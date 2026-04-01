# Learning: Task API 集成测试建立

### 根本原因
503 个 Brain 测试全部 vi.mock('../db.js')，没有一个测试真正验证 API → PostgreSQL 链路。
L4 CI 开了真实 PostgreSQL 但完全没有被测试使用。

### 解决方案
建立 tests/integration/ 目录，使用 skipIf 机制：
- 无 DB 环境（开发者本地快速跑）→ 自动跳过
- 有 DB 环境（L4 CI 或 RUN_INTEGRATION=true）→ 真实执行

### 下次预防
- [ ] 新增 API 端点时同步在 tests/integration/ 加一个集成测试
- [ ] test-registry.yaml 注册时 type 必须正确区分 unit vs integration
- [ ] integration 测试禁止使用 vi.mock 任何内部模块
