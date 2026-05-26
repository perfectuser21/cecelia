# Learning: cp-0520195056-content-clipper

**PR**: Content Clipper — Brain API + Dashboard /clips

### 根本原因

首次在 Brain 中添加需要外部 callback 的采集功能。关键发现：Brain 运行在 38.23.47.81:5221，
公网可访问，因此 content-service (xian-m1) 可以直接回调 Brain，不需要 n8n 或 proxy 作为中间层。

SQL 参数编号陷阱：当主查询用 $1/$2 做 LIMIT/OFFSET，过滤条件从 $3 开始，
COUNT 子查询不能直接复用 params.slice(2)——需要独立构建 countParams 数组，从 $1 重新编号。

### 下次预防

- [ ] 新增需要外部 callback 的功能时，先 `curl http://38.23.47.81:{PORT}/healthz` 确认 Brain 对 xian-m1 可达
- [ ] 含 LIMIT/OFFSET 的分页查询，COUNT 子查询必须独立构建参数数组（不能 slice 主 params）
- [ ] `||` 会把 0 变成 falsy，数值字段用 `??` 做 null 回退
- [ ] retry 端点必须加状态守卫（`AND status IN ('failed', 'pending')`），防止覆盖 processing 记录
- [ ] detectPlatform 返回 null 而非 fallback 字符串，让上层显式处理未识别 URL
