## Feature Registry Brain DB — feature-ledger.yaml 变成活数据库（2026-04-30）

### 根本原因

feature-ledger.yaml 是静态文件，Agent 无法查询"哪些 feature 缺 smoke test""当前哪些 failing"——没有运行时状态，没有回写机制，反馈回路断开。159 个功能的测试覆盖状态全凭人工维护，形同虚设。

### 下次预防

- [ ] 新功能上线时同步注册到 features 表（`POST /api/brain/features` 或 `POST /api/brain/features/seed`）
- [ ] smoke_cmd 非 null 的 P0 feature 必须在 CI smoke job 里覆盖，不能只靠 vitest mock
- [ ] seed 后立即验证：`curl /api/brain/features?priority=P0 | jq '.total'` > 0 才算完成
- [ ] migration 编号依赖前序（本次 249 依赖 248 先合入），合并前确认 248 状态
- [ ] selfcheck.js EXPECTED_SCHEMA_VERSION 必须与最新 migration 同步，两处都改才算完整
