# Learning: 数据闭环 v1 — 周报路由架构

## 根本原因

Dashboard 路由不在 `App.tsx` 手动注册，而是通过 feature manifest 动态加载：
- 路由定义在 `apps/api/features/<feature>/index.ts` 的 `routes[]` 数组
- 组件映射在同文件 `components:{}` 对象
- `DynamicRouter.tsx` 从 `coreConfig.allRoutes` 自动渲染所有路由

## 下次预防

- [ ] 新增 Dashboard 页面时，必须同时修改对应 feature 的 `index.ts`（routes + components 两处）
- [ ] Brain API 路由需在 `server.js` 同时添加 import 和 `app.use()`
- [ ] DoD 中 curl 测试只能在 Brain 重启后通过，commit 前改用文件内容检查（`node -e "readFileSync..."`）
- [ ] `weekly_content_reports` 唯一约束在 `week_label`，UPSERT 时用 `ON CONFLICT (week_label) DO UPDATE`
