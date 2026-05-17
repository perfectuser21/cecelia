# Learning: decisions-lifecycle integration test

## 背景

为 `/api/brain/strategic-decisions` 写完整链路 integration test（PR1 of brain-test-pyramid）。

### 根本原因

1. 任务背景说的 `/api/brain/decisions` 是只读 audit log（status.js/shared.js），完整 CRUD 实际挂在 `/api/brain/strategic-decisions`（strategic-decisions.js），路由用 PUT 而非 PATCH。
2. decisions 表 `made_by` 字段有 CHECK constraint，只允许 `user`/`cecelia`/`system`，测试数据不能用任意字符串。

### 下次预防

- [ ] 写 decisions 相关测试时先用 `\d decisions` 查约束，不要假设字段值随意填写
- [ ] 任务描述的 API 路径与实际挂载路径需要对照 server.js 确认，不能依赖文档
- [ ] integration test 的 `made_by`/`author` 等有约束的字段使用 schema 允许的值（如 `user`、`system`）
