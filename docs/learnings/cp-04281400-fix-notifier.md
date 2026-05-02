# Learning: Brain Notifier Health 双通道检查修复

### 根本原因

`routes/goals.js` 的 `organs.notifier.status` 判断只看 `FEISHU_BOT_WEBHOOK`，
忽略了 `notifier.js` 已实现的 Open API 降级通道。
当系统只有 App ID/Secret/Owner Open IDs 时，notifier 功能正常但 health 误报 `unconfigured`。

同时 `.env.docker` 缺少飞书凭据（`FEISHU_APP_ID`/`FEISHU_APP_SECRET`/`FEISHU_OWNER_OPEN_IDS`），
导致 Open API 通道也无法工作。

### 下次预防

- [ ] health endpoint 的 organ status 判断必须与对应模块的实际功能判断逻辑保持一致
- [ ] 新增 notifier 通道时，同步更新 `routes/goals.js` 的 status 判断
- [ ] `.env.docker` 添加新凭据时，验证容器里 `process.env` 确实能读到
- [ ] Brain 镜像是 pre-built immutable，改代码后必须 `bash scripts/brain-build.sh` 重新构建才能生效
