# Learning: Content-Type 配置 YAML→DB 迁移

## 背景
将 content-type 配置从 YAML 文件迁移到数据库，提供 CRUD API。

### 根本原因
1. YAML 文件硬编码配置无法通过前端编辑，每次修改都需要改代码并重新部署
2. 内容类型配置需要频繁调整（提示词、审查规则等），DB 存储支持运行时动态修改
3. 迁移过程必须保持向后兼容：DB 优先查询，YAML 作为兜底，DB 不可用时静默降级

### 下次预防
- [ ] DB 优先 + YAML 兜底模式：import pool 后必须加 try/catch 降级，确保 DB 不可用时不影响现有功能
- [ ] 修改 selfcheck EXPECTED_SCHEMA_VERSION 时，必须同步更新 DEFINITION.md 中的 schema_version
- [ ] 新增 DB 查询的模块，测试需要 mock pool（vi.mock），不能依赖实际 DB 连接
