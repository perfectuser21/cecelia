# Learning: Dashboard 大脑模型切换面板

### 根本原因

Brain 的模型配置 API（model-profiles）早已存在，但前端一直没有对应的 UI，
导致每次切换模型都需要直接调 API 或改代码。

### 架构洞察

- Dashboard 路由通过 `apps/api/features/*/index.ts` 的 `components` 和 `routes` 注册，
  不是直接改 `DynamicRouter.tsx`——后者是纯动态渲染器
- model-profiles API 支持 Profile 级切换（一键切换整套配置）和 Organ 级调整（单独改某个 organ）
- MiniMax key 需要在 `.env` 中配置（`MINIMAX_API_KEY`），不会自动从 `~/.credentials/minimax.json` 读取

### 下次预防

- [ ] DoD 测试路由注册时，应检查 `apps/api/features/system-hub/index.ts`，而非 `DynamicRouter.tsx`
- [ ] Brain 进程启动脚本应自动从 `~/.credentials/` 同步关键 API key 到 `.env`，避免重启后丢失
- [ ] 新增 Dashboard 页面时，参考 `AccountUsagePage` 的深色主题风格规范
