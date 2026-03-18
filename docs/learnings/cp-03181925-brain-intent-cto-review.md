# Brain 新增 task_type 的注册模式（2026-03-18）

## intent_expand + cto_review 两阶段前置审查注册

### 根本原因

本次开发流程顺畅，CI 0 次失败，本地验证 0 次失败。

发现一个设计盲区：任务描述中写的 location 是 `local`（意图：本机执行），但 Brain task-router.js 的 `isValidLocation` 只接受 `us`/`hk`/`xian` 三个值，`local` 会路由失败。

根本原因：PRD 描述用了语义性的 "local"，但系统约定的物理 location 编码是基础设施节点名称。US 就是美国本机（美国 Mac mini M4），不需要单独的 "local"。

### 下次预防

- [ ] 新增 task_type 时，location 值必须从 `isValidLocation` 函数确认：只允许 `us`/`hk`/`xian`，不能用 `local`/`cn` 等语义名称
- [ ] Brain 新增 task_type 必须同步修改 5 个文件：task-router.js（VALID_TASK_TYPES + SKILL_WHITELIST + LOCATION_MAP）、executor.js（skillMap）、model-registry.js（AGENTS）、routes/tasks.js（API 端点）、DEFINITION.md（task_types 表格）
- [ ] 修改 DEFINITION.md task_types 表格后，facts-check.mjs 会自动校验字母序是否与 task-router.js LOCATION_MAP 一致，需要先运行再 push
- [ ] API 端点的 [BEHAVIOR] DoD Test 用 curl 验证时，需要 Brain 重启才能加载新代码，CI 环境会自动重启，本地测试需手动重启 Brain

### 技术备注

- intent_expand 职责：沿 `task.project_id → projects.kr_id (or project_kr_links) → goals.parent_id × 2` 链查 OKR/Vision 上下文，补全 PRD 写入 `task.metadata.enriched_prd`
- cto_review 职责：读 enriched_prd + pr_number（获取 diff），独立判断 PASS/FAIL，结果写入已有的 `tasks.review_result` 字段（migration 156 已存在，不需新增 migration）
- `project_kr_links` 表是 project→KR 的关联表，部分 project 不直接有 `kr_id` 字段，需要走 `project_kr_links` 查询
