## brain-test-pyramid Layer 2 PR2: works-crud integration test（2026-05-02）

### 根本原因
content_publish_jobs CRUD 接口缺少真实 DB 验证，单元测试全量 mock 导致持久化行为覆盖盲区。integration test 文件最初放在 repo 根 `tests/integration/`，import 路径为 `../../packages/brain/src/`，移到 `packages/brain/src/__tests__/integration/` 后需改为 `../`。

### 下次预防
- [ ] 新增 CRUD 路由时同步添加 integration test，验证 POST+GET+DB直查 三步链路
- [ ] retry 接口必须在 integration test 中覆盖状态回退验证
- [ ] integration test 文件必须直接放在 `packages/brain/src/__tests__/integration/`，避免根目录 `tests/` 的路径引用层级错误
