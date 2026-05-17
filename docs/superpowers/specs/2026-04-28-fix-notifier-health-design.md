# Fix: Brain Notifier Health Status — 双通道检查

**日期**：2026-04-28  
**分支**：cp-0428214207-cp-04281400-fix-notifier-health  
**层级**：trivial fix（< 10 行，纯条件逻辑）

---

## 问题

`packages/brain/src/routes/goals.js:161` 的 notifier status 判断只看 `FEISHU_BOT_WEBHOOK`：

```js
notifier: { status: process.env.FEISHU_BOT_WEBHOOK ? 'configured' : 'unconfigured' }
```

但 `notifier.js` 实现了双通道：Webhook 优先，不存在则降级到 Open API（`FEISHU_APP_ID` + `FEISHU_APP_SECRET` + `FEISHU_OWNER_OPEN_IDS`）。现行判断导致只有 Open API 凭据时，notifier 功能正常但 health 报 `unconfigured`，产生误报。

---

## 修复方案

### 代码变更（`packages/brain/src/routes/goals.js`）

```js
notifier: {
  status: process.env.FEISHU_BOT_WEBHOOK
    ? 'configured'
    : (process.env.FEISHU_APP_ID && process.env.FEISHU_APP_SECRET && process.env.FEISHU_OWNER_OPEN_IDS)
      ? 'configured'
      : 'unconfigured',
  channel: process.env.FEISHU_BOT_WEBHOOK
    ? 'webhook'
    : (process.env.FEISHU_APP_ID ? 'open_api' : 'none')
}
```

### 运维变更（已完成）

`/Users/administrator/perfect21/cecelia/.env.docker` 追加：
- `FEISHU_APP_ID`
- `FEISHU_APP_SECRET`
- `FEISHU_OWNER_OPEN_IDS`（从 `~/.credentials/feishu.env` 的 `FEISHU_OWNER_OPEN_ID` 映射）

---

## 测试策略

**trivial 级**（纯条件逻辑，< 10 行）→ 1 个 unit test：

文件：`packages/brain/src/__tests__/notifier-health-status.test.js`

测试三种组合：
1. `FEISHU_BOT_WEBHOOK` 存在 → `{ status: 'configured', channel: 'webhook' }`
2. 只有 `FEISHU_APP_ID` + `FEISHU_APP_SECRET` + `FEISHU_OWNER_OPEN_IDS` → `{ status: 'configured', channel: 'open_api' }`
3. 三者都没有 → `{ status: 'unconfigured', channel: 'none' }`

---

## 成功标准

重启 Brain 容器后：
```bash
curl http://localhost:5221/api/brain/health | jq '.organs.notifier'
# => { "status": "configured", "channel": "open_api" }
```
