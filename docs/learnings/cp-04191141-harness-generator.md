### 根本原因

实现 Sprint WS-1：GET /api/brain/ping 冒烟端点。

- 路由通过 `api/routes.py` 的 `register_routes(app)` 统一挂载。
- 使用 Flask Blueprint（`api/brain/ping.py`），返回 `{pong: True, timestamp: <ISO 8601 UTC 字符串>}`。
- `timestamp` 使用 `datetime.now(timezone.utc).isoformat()` 并将 `+00:00` 规范为 `Z`，保证每次请求新鲜。
- 未 GET 的方法由 Flask 默认 405 响应。
- 测试覆盖：路由注册、happy path、ISO 解析/新鲜度、连续调用差异、非 GET 方法 405、大小写敏感。

### 下次预防

- [ ] 新增端点必须伴随 pytest 覆盖 happy path + 边界（方法/大小写/时间戳）
- [ ] ISO 8601 时间戳统一使用带时区的 UTC 格式，避免 `fromisoformat` 无时区失败
- [ ] 路由挂载保持通过 `register_routes` 单入口，便于单测构造空 app 验证
