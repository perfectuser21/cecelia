## Brain {VERSION} — 修错库孤儿链接无限重试（push 噪音 269次/2h）

- 249 条 legacy notion_id 绑到错库，PATCH 返回 400 schema 不符（非 404）→ 不命中既有解绑分支 → 每轮重试刷屏
- 新增 isWrongDatabaseError 判定，400 属性不符一并解绑重建
