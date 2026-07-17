# Sprint PRD: 修指挥舱路由接线

## 背景

主理人指挥舱（OwnerCockpitPage）已交付（task:80a5be84），但 App.tsx 无任何直接
import，且 `/` 路由仅挂在动态 manifest（apps/api/features/dashboard/index.ts:30）
中——没有静态防孤儿断言，真首页是否正确渲染无法被 CI 感知。

## 目标

1. 确认 `/` → `OwnerCockpitPage` 接线正确（manifest 已有，但需静态断言守护）
2. 在 App.tsx 层级增加防孤儿 import，并进永久测试
3. Final E2E 用 Playwright 验证真首页六指标卡与作战板真渲染

---

## 功能需求（FR）

### FR-1: App.tsx 防孤儿 import

App.tsx（或其入口文件）必须直接 import OwnerCockpitPage，使得静态分析（grep）
即可确认组件未被孤立。位置：`apps/dashboard/src/App.tsx`，采用
`import OwnerCockpitPage from './pages/owner-cockpit/OwnerCockpitPage'` 形式（可
用于类型守护，不必加入 JSX 树，但需在文件顶层出现）。

### FR-2: 路由表静态守护

`apps/api/features/dashboard/index.ts` 已有
`{ path: '/', component: 'OwnerCockpitPage', requireAuth: true }` ——不得删除或
改路径。永久测试必须 grep 断言此行存在。

### FR-3: 防孤儿永久测试（双断言）

新增测试文件（进 CI 永不删除）：
- **断言 A（grep 级）**：App.tsx 文件文本含 `OwnerCockpitPage`
- **断言 B（render 级）**：渲染 App 根节点时路由表中存在 `/` → OwnerCockpitPage
  的映射（通过 manifest allRoutes 检查）

### FR-4: Final E2E（Playwright，mac_web）

Playwright 真开 `http://localhost:5211/`，断言：
- `data-testid="owner-cockpit"` 元素存在且可见
- 至少一个 `data-testid` 含 `metric-card-` 前缀的元素存在（六指标卡）
- `data-testid="battle-card"` 元素存在（作战板）
- 截图存档

---

## Invariant 约束

| # | 约束 | 来源 |
|---|------|------|
| I-1 | App.tsx 必须 import OwnerCockpitPage（grep 可检出） | 防孤儿铁律 |
| I-2 | `apps/api/features/dashboard/index.ts` 的 allRoutes 必须含 `{ path: '/', component: 'OwnerCockpitPage' }` | 接线铁律 |
| I-3 | 防孤儿测试必须 commit 进 repo，永久留在 CI，不得删除 | Bug Fix 流程规则 |
| I-4 | Final E2E 必须用真 Playwright 浏览器打开，不得用组件单测替代 | E2E 验收标准规则 |

---

## NFR

- 现有 16 个二级页面路由全部保留，不得因本次改动丢失
- 改动不引入新的 console.log 或未使用 import
- 测试文件行数不超过 80 行

---

## 累积 FR

| FR | 状态 | 说明 |
|----|------|------|
| FR-1 | 待实现 | App.tsx 防孤儿 import |
| FR-2 | manifest 已有，需守护 | 路由表静态断言 |
| FR-3 | 待实现 | 双断言永久测试 |
| FR-4 | 待实现 | Playwright E2E 真首页验证 |

---

## E2E 验收方向

- Playwright 真开 `http://localhost:5211/`，断言 `data-testid="owner-cockpit"` 可见
- 至少一个 `[data-testid^="metric-card-"]` 存在（六指标卡真渲染）
- `data-testid="battle-card"` 存在（作战板真渲染）
- 截图存档于 `test-results/`

---

## 附录

```
journey_type: fix
target_environment: mac_web
task_id: ebc008a5-b887-4cbf-a382-d0bfd744c4ae
sprint_dir: sprints/07171640-cockpit-route-wire
```
