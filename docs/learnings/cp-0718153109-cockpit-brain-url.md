## 指挥舱全空白——前端硬编码 localhost:5221（2026-07-18）

### 根本原因
harness 产的 OwnerCockpitPage 把 Brain 地址硬编码成 `http://localhost:5221`。浏览器端 localhost = 用户自己的设备，手机/HK 公网打开时请求全部落空，页面所有指标空白。生产 Brain 数据齐全，纯前端取数地址错。同病还有 pr-plans.api.ts。仓库正确先例是 staffApi.ts 的相对路径 `/api/brain`（走 frontend-proxy / HK 代理 / vite dev proxy）。

### 下次预防
- [ ] dashboard 前端调 Brain 一律相对路径 `/api/brain`，禁止任何 `localhost:5221` 字面量——回归守卫 tests/regression/no-hardcoded-brain-url/ 已扫死
- [ ] harness generator 产前端代码时的"本机可跑"不等于"真实入口可用"：E2E 若只在 mac_web 本机跑，localhost 硬编码永远测不出来；UI 验收应至少有一条非 localhost 入口断言
