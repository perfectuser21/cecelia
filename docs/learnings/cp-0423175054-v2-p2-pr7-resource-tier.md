## v2 P2 PR7 resource-tier Middleware（2026-04-23）

### 根本原因

v2 P2 第 7 PR，抽 docker-executor.js:47-93 的 RESOURCE_TIERS + TASK_TYPE_TIER + resolveResourceTier 到独立 middleware。保留 re-export 兼容 executor.js:3735 和 docker-executor.test.js。纯代码搬家。

和 PR5/PR6（新增）不同，PR7 是"搬家 + re-export"模式（同 PR3 account-rotation）。这两种模式在 P2 里混合出现是合理的：已有逻辑该搬则搬，新增能力直接建新模块。

### 下次预防

- [ ] **资源 tier 表扩展路径清晰**：加新 task_type 只需改 `TASK_TYPE_TIER` 单个 map。未来若需要更细粒度（按 task_type + priority 动态 tier）再单独设计，不要在这里加条件逻辑
- [ ] **re-export 是兼容层而非持久方案**：spawn/middleware/ 里的 RESOURCE_TIERS export 是 SoT，docker-executor.js 的 re-export 到 v2 PR11 清理 SPAWN_V2_ENABLED flag 时一并删除，强制外部 caller 直接 import from spawn/middleware
