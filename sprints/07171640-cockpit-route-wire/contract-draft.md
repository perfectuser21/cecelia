# Contract: 修指挥舱路由接线 [ebc008a5]

## 功能行为（BEHAVIOR）

[BEHAVIOR-1] App.tsx 文件顶层必须存在对 OwnerCockpitPage 的直接静态 import，形如
`import OwnerCockpitPage from './pages/owner-cockpit/OwnerCockpitPage'`，使 grep 可静态检出，组件不被孤立。

[BEHAVIOR-2] `apps/api/features/dashboard/index.ts` 的 routes 数组必须保留
`{ path: '/', component: 'OwnerCockpitPage', requireAuth: true }` 条目，不得删除或改路径，作为路由表接线静态守护断言。

[BEHAVIOR-3] 防孤儿永久测试（断言 A）：读取 App.tsx 文件文本，断言包含字符串
`OwnerCockpitPage`，以 grep 级断言确保静态可见性。

[BEHAVIOR-4] 防孤儿永久测试（断言 B）：检查 manifest allRoutes 数组，断言存在
`path: '/'` + `component: 'OwnerCockpitPage'` 的映射条目，以 render 级断言守护路由表接线。

[BEHAVIOR-5] Playwright E2E：在真实浏览器中打开 `http://localhost:5211/`，
`data-testid="owner-cockpit"` 根容器可见，六指标卡（`[data-testid^="metric-card-"]` ≥6 个）
和作战板（`data-testid="battle-card"` ≥1 个）真渲染，截图存档于 `test-results/`。

---

## E2E 验收

E2E 目标：Playwright 真开 `http://localhost:5211/`（dashboard 端口）断言：
- `[data-testid="owner-cockpit"]` 根容器可见
- 六指标卡 `[data-testid^="metric-card-"]` ≥6 个可见
- `[data-testid="battle-card"]` 至少 1 个可见（或展示"暂无进行中任务"占位符）
- 截图存档至 `test-results/cockpit-e2e.png`

```bash
# e2e-verify.sh 可执行验收命令
cd /Users/administrator/perfect21/cecelia
npx playwright test sprints/07171640-cockpit-route-wire/tests/e2e-verify.spec.ts --reporter=line
```

---

## Test Contract

| BEHAVIOR | 测试文件 | it() 描述 |
|----------|---------|-----------|
| App.tsx 顶层静态含 OwnerCockpitPage 引用（防孤儿断言） | tests/cockpit-route.test.ts | App.tsx 顶层静态含 OwnerCockpitPage 引用（防孤儿断言） |
| manifest / 路由指向 OwnerCockpitPage（防孤儿 manifest 断言） | tests/cockpit-route.test.ts | manifest / 路由指向 OwnerCockpitPage（防孤儿 manifest 断言） |
| 指挥舱首页 — 真首页渲染验收 | tests/e2e-verify.spec.ts | 指挥舱首页 — 真首页渲染验收 |

---

## 实现约束

1. **FR-1**：在 `apps/dashboard/src/App.tsx` 文件顶部 import 区域增加
   `import OwnerCockpitPage from './pages/owner-cockpit/OwnerCockpitPage';`。
   该 import 可仅用于类型守护，不必强制加入 JSX 树，但必须在文件顶层出现（grep 可检出）。

2. **FR-2**：`apps/api/features/dashboard/index.ts` 的 routes 数组中
   `{ path: '/', component: 'OwnerCockpitPage', requireAuth: true }` 行不得改动，
   manifest components 的 OwnerCockpitPage 懒加载路径也不得修改。

3. **FR-3**：测试文件放入 `sprints/07171640-cockpit-route-wire/tests/`，
   commit 1 写入测试（Red），commit 2+ 写实现（Green），测试文件 commit 1 后不可修改。

4. 现有 16 个二级页面路由全部保留，不因本次改动丢失任何路由。

5. 改动不引入新的 `console.log` 或未使用 import；测试文件行数不超过 80 行。

---

## 测试约束

- **commit 1** = 合同测试原样提交（Red，实现代码未改动时测试应失败或 skip）
- **commit 2+** = 实现代码（Green，测试通过）
- 测试文件 commit 1 后**不可改动**，永久留在 CI 防孤儿回归

---

## 判定点登记表

| # | 判定点 | 验证方式 |
|---|--------|---------|
| J-1 | App.tsx 顶层 import OwnerCockpitPage | grep |
| J-2 | allRoutes 含 `{ path: '/', component: 'OwnerCockpitPage' }` | grep manifest |
| J-3 | 断言 A：App.tsx 文件文本含 OwnerCockpitPage | vitest 文件读取断言 |
| J-4 | 断言 B：manifest allRoutes 路由映射存在 `/` → OwnerCockpitPage | vitest render/import 断言 |
| J-5 | `data-testid="owner-cockpit"` 根容器可见 | Playwright |
| J-6 | 六指标卡 ≥6 个（`[data-testid^="metric-card-"]`） | Playwright |
| J-7 | 作战板 `data-testid="battle-card"` 存在或占位符出现 | Playwright |
| J-8 | 截图存档于 test-results/cockpit-e2e.png | Playwright screenshot |

---

## 未覆盖真实链路清单

- Brain API（`localhost:5221`）六指标、任务列表、guard-drill、日报等接口：Playwright E2E 直接调用真实 Brain，若 Brain 未启动则指标显示 `--` 但 `owner-cockpit` 根容器和六指标卡 DOM 结构仍然渲染。
- DynamicRouter 内部的 `OwnerCockpitPage` 动态加载路径（`apps/api/features/dashboard/index.ts` components 懒加载）：E2E 会真实触发组件加载，不 mock。
- 认证流程（requireAuth: true）：E2E 在 localhost 本地环境需确保已登录或 auth 状态允许首页渲染，若有登录拦截需在测试中处理。
