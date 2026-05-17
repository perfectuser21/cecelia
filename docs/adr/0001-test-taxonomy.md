# ADR 0001: 测试分类标准（Test Taxonomy）

**状态**: 已采纳（2026-04-01）
**决策人**: Alex（架构审查触发）
**背景**: 架构审查发现 25 个测试文件游离在 CI 之外，根因是系统没有定义测试分类标准。

---

## 问题

Cecelia 系统已有完善的 registry 生态（skills/workflows/brain-manifest），但测试文件缺乏统一注册机制，导致：
1. 新加测试文件后无人知晓是否接入 CI
2. 没有统一定义什么是单元测试、集成测试、E2E 测试
3. L3/L4 CI 层职责模糊

---

## 决策

### 测试类型定义

#### Unit Test（单元测试）
- **定义**：测试单个函数/模块的内部逻辑，所有外部依赖（DB/LLM/HTTP）全部 mock
- **判断标准**：能在没有 PostgreSQL 的机器上运行
- **CI 层级**：L3（快速，无副作用）
- **文件约定**：`*.test.ts` / `*.test.js`（默认类型）

#### Integration Test（集成测试）
- **定义**：测试两个真实组件之间的接口，至少有一个真实依赖（真实 DB 或真实 HTTP 端点）
- **判断标准**：需要 PostgreSQL 连接才能运行
- **CI 层级**：L4（需要 PostgreSQL 环境，4 shards 并行）
- **文件约定**：`*.integration.test.ts` / `*.integration.test.js`（推荐）

#### E2E Test（端到端测试）
- **定义**：从外部用户视角验证完整业务流程，不关心内部实现
- **判断标准**：验证一个完整 workflow（创建→处理→结果）
- **CI 层级**：L4 Shard 1（最重，最后运行）
- **文件约定**：`*-check.sh` 或 `*.e2e.test.ts`

---

### 注册机制

所有测试文件**必须**在 `test-registry.yaml` 中注册。

`status` 字段：
- `active` — 已接入 CI，正常运行
- `pending-ci` — 已注册，待接入 CI（需后续 PR 补充 CI 配置）
- `deprecated` — 已废弃，保留记录但不运行

---

## 执行机制

CI L2（`ci-l2-consistency.yml`）将增加 `orphan-test-check` job（独立 PR 实现）：
- 扫描所有 `*.test.*` 文件
- 对比 `test-registry.yaml`
- 未注册的文件导致 PR 失败

---

## 为什么不用文件命名约定（`*.unit.test.ts`）？

行业两种主流方案：
1. **文件命名约定**（Netflix/Meta）：靠文件后缀区分类型，CI 按 pattern 路由
2. **显式注册**（Google Bazel）：所有测试必须在 BUILD 文件声明

选择显式注册的原因：
- 系统已有 skills-registry、workflow-registry 等注册机制，风格一致
- AI agent 新增文件时，注册 registry 是一个明确的检查点
- 注册表作为"地图"，方便查看系统测试全景

---

## 影响

- `test-registry.yaml` 成为测试文件的 SSOT
- 所有新增 `*.test.*` 文件的 PR，必须同时更新 `test-registry.yaml`
- CI L2 orphan-check 将自动执行此规则（下一个 PR 实现）
