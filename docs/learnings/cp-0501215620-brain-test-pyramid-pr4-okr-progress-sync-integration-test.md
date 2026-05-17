# Learning: OKR KR 进度 Integration Test — progress 列 COALESCE 陷阱

**Branch**: cp-0501215620-brain-test-pyramid-pr4-okr-progress-sync-integration-test  
**Date**: 2026-05-01  
**PR**: brain-test-pyramid 第 4 个

---

### 根本原因

`key_results.progress` 列默认值为 `0`（非 NULL），而 `/api/brain/okr/current` 端点使用：

```sql
COALESCE(progress, CASE WHEN target_value > 0
  THEN ROUND(current_value / target_value * 100, 0)
  ELSE 0 END)::integer AS progress_pct
```

当 `progress=0`（非 NULL）时，COALESCE 永远取 `progress`，导致 `PATCH current_value` 不影响 `progress_pct`。Integration test 需要在 setup 阶段通过 DB 直连将 `progress` 设为 NULL，才能激活 `current_value` 计算路径。

### 次生问题：testPool DB 不匹配

vitest 运行时自动注入 `NODE_ENV=test`，`db-config.js` 的 guard 因此将 DB 默认为 `cecelia_test`，而本地 Brain 服务连的是 `cecelia`（生产）。导致 testPool 写入 `cecelia_test` 的数据，Brain API 却读 `cecelia`，两者完全不互通。

**解决方案**：testPool 不走 `db-config.js`，而是自己构建连接配置：
- CI：解析 `DATABASE_URL`（Brain 和 testPool 都指向 `cecelia_test`）
- 本地：默认连 `cecelia`（与 Brain 一致），通过 `BRAIN_DB_NAME` 或 `DATABASE_URL` 可覆盖

### 下次预防

- [ ] 新增 OKR 相关 integration test 时，先检查 `progress` vs `current_value` 哪个字段被 `/current` 优先使用
- [ ] testPool 在 integration test 里不应依赖 `db-config.js` + `DB_DEFAULTS`，应用独立连接配置避免 guard 干扰
- [ ] `COALESCE(progress, ...)` 设计导致两个字段控制同一显示值，建议在 PATCH allowed 里加入 `progress` 字段或统一用单字段
- [ ] CI brain-integration job 需要 `DATABASE_URL` 环境变量，确保 testPool 能自动找到正确 DB
