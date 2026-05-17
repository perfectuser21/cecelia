## ZenithJoy Feature Registry 补录（2026-05-01）

### 根本原因
- Migration 249（初始 feature registry）只登记了 Brain API 代理的 ZenithJoy 端点，遗漏了 ZenithJoy 原生服务（Works 管理、Creator 执行器、数据采集、AI 视频、JNSY 标注系统）
- 初始评估时未深入 `apps/api/src/routes/`、`services/creator/`、`services/jnsy-label/` 三个子目录
- Migration 编号冲突：手动创建文件时未检查已合并的 250_fix_cecelia_smoke_cmds.sql，导致编号重复

### 下次预防
- [ ] 新增 feature registry 时，先遍历 `apps/api/src/routes/` + `services/*/` 全部路由文件
- [ ] 创建 migration 文件前跑 `ls migrations/*.sql | sort | tail -5` 确认最新编号
- [ ] smoke_cmd 需 per-feature 真实端点验证，不能复用通用 health check
- [ ] 需要飞书 session 的端点（如 /api/works）smoke 应验证 401 响应，而非 200
