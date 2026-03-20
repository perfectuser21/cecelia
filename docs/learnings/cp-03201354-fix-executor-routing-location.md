# Learning: executor routing 按 location 而非 task_type

## 日期
2026-03-20

### 根本原因
executor.js 用 `DEV_ONLY_TYPES = new Set(['dev'])` 判断路由，非 dev 任务一律走西安 Codex Bridge。但 task-router.js 的 LOCATION_MAP 已经为每个 task_type 定义了 location（us/xian/hk），审查类任务（cto_review/dod_verify/prd_audit）的 location='us' 应走本机 cecelia-bridge，不应走西安。

### 下次预防
- [ ] 新增 task_type 时检查 executor 路由逻辑是否尊重 LOCATION_MAP
- [ ] executor 路由决策应基于 location 字段（来自 task-router.js），不应用 task_type 硬编码集合
- [ ] 添加路由日志包含 location 值，方便排查
