### 根本原因

实现 `/api/brain/ping-extended` 端点：GET 返回 `{status, timestamp, version}` 三字段 JSON，version 从 `package.json` 读取保证单一事实源。非 GET 方法通过 `router.all` 返回 405。

### 下次预防

- [ ] Brain 路由新增端点时，在 status.js 末尾添加，遵循文件内已有 router.get/router.all 模式
- [ ] 读取 package.json 使用 `readFileSync + new URL('../../package.json', import.meta.url)` 模式（与 goals.js 一致）
- [ ] 方法拒绝用 `router.all` 放在 `router.get` 之后，Express 路由按序匹配
