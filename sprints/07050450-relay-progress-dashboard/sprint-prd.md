# Sprint PRD：Relay 进度条 Dashboard 页面

**Task ID**: d56d5ad9-0e03-4106-8b38-23507bb14dc6
**Sprint Dir**: sprints/07050450-relay-progress-dashboard
**Branch**: cp-07050456-ws-d56d5ad9
**日期**: 2026-07-04

---

## 1. 目标

在 Cecelia Dashboard 新增「Harness 进度」页面，从 `GET /api/brain/orchestrator/relay-runs` 拉取数据，将每个活跃 initiative 渲染为七段横向进度条，让主理人一眼看清每个 harness 任务跑到哪一棒，无需翻 API 或日志。

---

## 2. 数据源

**API**：`GET /api/brain/orchestrator/relay-runs`（已上线，packages/brain/src/routes/initiatives.js）

**响应字段**（每条 relay run）：
- `initiative_id` — UUID，短码取前 8 位显示
- `phase` — 当前阶段，枚举值见下方七段定义
- `verdict` — 最终裁决（若有）
- `cost` — 执行成本（若有）
- `started_at` — 开始时间
- `completed_at` — 完成时间（若有）
- `failure_reason` — 失败原因（若有）

**七段 Phase 顺序**（与 PrepPRD 定义对齐）：

| 顺序 | phase 值 | 显示标签 |
|------|----------|----------|
| 1 | planning | Planning |
| 2 | gan | GAN |
| 3 | generate | Generate |
| 4 | evaluate | Evaluate |
| 5 | judge | Judge |
| 6 | merge | Merge |
| 7 | report | Report |

> 注：Brain 侧 ALLOWED_PHASES 包含 `A_planning/A_contract/B_task_loop/C_final_e2e/done/failed/planning/gan/generate/evaluate`，新 relay v2 流程使用后七段；`judge/merge/report` 可能在 DB 迁移中未出现，前端需做容错（未出现则显示灰色）。

**查询参数**：
- `?limit=20`（默认，最大 100）
- `?phase=<phase>`（按阶段过滤，可选）
- `?since=<ISO8601>`（时间过滤，可选）

---

## 3. 新增文件清单

```
apps/dashboard/src/pages/harness-pipeline/
  RelayProgressPage.tsx          # 主页面（新增）

apps/dashboard/src/
  (可选) hooks/useRelayRuns.ts   # 数据拉取 hook（新增，如逻辑复杂）

apps/dashboard/e2e/
  relay-progress.spec.ts         # Playwright E2E 测试（新增）
```

**修改文件**：
- 导航配置（通过 Core Config / Feature Flag 机制）——需确认具体接入方式（见第 5 节）

---

## 4. 实现规格

### 4.1 RelayProgressPage.tsx

```
路由: /relay-progress（或 /harness/relay）
组件: RelayProgressPage
```

**布局**：
1. 页头：标题"Relay 进度"+ 自动刷新倒计时指示器（每 15 秒）
2. 列表区域：
   - 无活跃时：居中显示"暂无进行中的 relay"空态文案
   - 有数据时：每行一条 initiative 进度卡片
3. 每张卡片包含：
   - 首行：`initiative_id` 短码（前 8 位）+ 当前 phase 文字 badge + verdict badge（若有）+ cost（若有）
   - 进度条：七段横向，使用 flexbox 排列，每段含 phase 标签
     - 已完成（`phase_index < current`）：实色填充（绿色 `#10b981`）
     - 当前（`phase_index === current`）：高亮色（蓝色 `#3b82f6`，pulse 动画）
     - 未到（`phase_index > current`）：灰色 `#374151`

**自动刷新**：
```typescript
useEffect(() => {
  const timer = setInterval(fetchRelayRuns, 15000);
  return () => clearInterval(timer);
}, []);
```

**错误处理**：
- 加载中：skeleton 占位或 spinner
- 请求失败：显示错误提示 + 重试按钮
- 非 2xx 响应：展示 HTTP 状态码

**API 调用模式**（与现有页面一致）：
```typescript
const res = await fetch('/api/brain/orchestrator/relay-runs');
if (!res.ok) throw new Error(`HTTP ${res.status}`);
const data = await res.json();
```

### 4.2 导航接入

**方式**：通过 Core Config `navGroups`（`InstanceContext.coreConfig`）动态加载，不直接硬编码进 `App.tsx`。

需在后端 Core Config 或 feature flags 中添加：
```json
{
  "path": "/relay-progress",
  "icon": "Activity",
  "label": "Relay 进度",
  "featureKey": "relay_progress",
  "component": "RelayProgressPage"
}
```

> 若 Core Config 不在本 sprint 范围内，可临时在 `App.tsx` 的静态路由区添加 `<Route path="/relay-progress" element={<RelayProgressPage />} />`，并在 navigation 数组中追加菜单项。

### 4.3 DynamicRouter 接入

在 `DynamicRouter.tsx` 的组件映射中添加：
```typescript
'RelayProgressPage': lazy(() => import('../pages/harness-pipeline/RelayProgressPage')),
```

---

## 5. E2E 验收测试（mac_web Playwright）

**文件**：`apps/dashboard/e2e/relay-progress.spec.ts`

**测试环境**：mac_web（本机 Playwright，localhost:5174，内网）

**测试用例**：

### TC-1：页面可访问 + 进度条容器存在
```typescript
test('进度页加载，进度条容器存在', async ({ page }) => {
  await page.goto('http://localhost:5174/relay-progress');
  // 断言：进度条容器元素存在
  await expect(page.locator('[data-testid="relay-progress-list"]')).toBeVisible();
});
```

### TC-2：七段 phase 标签在 DOM 可见
```typescript
test('七段 phase 标签全部可见', async ({ page }) => {
  await page.goto('http://localhost:5174/relay-progress');
  const phases = ['Planning', 'GAN', 'Generate', 'Evaluate', 'Judge', 'Merge', 'Report'];
  for (const phase of phases) {
    await expect(page.locator(`text=${phase}`).first()).toBeVisible();
  }
});
```

### TC-3：initiative 短码渲染（真实数据或 mock）
```typescript
test('initiative 短码渲染', async ({ page }) => {
  // 若无活跃 relay，mock API：
  await page.route('**/api/brain/orchestrator/relay-runs', route =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify([{
        initiative_id: 'abcd1234-0000-0000-0000-000000000000',
        phase: 'generate',
        verdict: null,
        cost: null,
        started_at: new Date().toISOString(),
      }]),
    })
  );
  await page.goto('http://localhost:5174/relay-progress');
  await expect(page.locator('text=abcd1234')).toBeVisible();
});
```

### TC-4：空态文案
```typescript
test('无活跃 relay 显示空态文案', async ({ page }) => {
  await page.route('**/api/brain/orchestrator/relay-runs', route =>
    route.fulfill({ status: 200, contentType: 'application/json', body: '[]' })
  );
  await page.goto('http://localhost:5174/relay-progress');
  await expect(page.locator('text=暂无进行中的 relay')).toBeVisible();
});
```

---

## 6. 接受标准 Checklist（DoD）

- [ ] `RelayProgressPage.tsx` 新建，路由 `/relay-progress` 可访问
- [ ] 七段进度条 HTML 结构正确（planning/gan/generate/evaluate/judge/merge/report）
- [ ] 当前 phase 高亮（视觉区分已完成/当前/未到）
- [ ] 每行显示 initiative_id 短码（前 8 位）+ 当前 phase 文字
- [ ] 无活跃 relay 时显示"暂无进行中的 relay"
- [ ] 页面每 15 秒自动刷新
- [ ] Playwright TC-1/TC-2/TC-3/TC-4 全部通过
- [ ] `npm run build` 无 TypeScript 编译错误
- [ ] CI（workspace-ci.yml）绿灯

---

## 7. 不在本 Sprint 范围内

- relay-runs API 本身的修改（已上线，本 sprint 只做前端消费）
- judge / merge / report 三个 phase 的后端实现（前端做容错即可）
- 历史归档 relay 的展示（默认 limit=20 最近活跃）
- 移动端响应式优化（桌面优先，手机兼容即可）

---

## 8. 风险与注意事项

1. **Phase 枚举不完整**：Brain 侧 ALLOWED_PHASES 中未包含 `judge/merge/report`，这三个值可能不在 DB CHECK 约束中。前端进度条的七段顺序按 PrepPRD 定义，对于未知 phase 值做安全 fallback（显示当前 phase 名称，不崩溃）。

2. **DynamicRouter 组件映射**：需确认 `DynamicRouter.tsx` 当前组件映射表位置（`apps/dashboard/src/components/DynamicRouter.tsx`），将新页面加入 lazy import 列表。

3. **导航 Feature Flag**：`relay_progress` featureKey 需在后端 instance config 中启用，否则菜单不显示。开发阶段可使用临时静态路由。

4. **Vite proxy 配置**：`/api/brain/*` 请求需通过 Vite proxy 转发到 `localhost:5221`，确认 `vite.config.ts` 中已有相应 proxy 规则。

---

## 9. 实现步骤（执行顺序）

1. 读 `DynamicRouter.tsx`，确认组件映射方式
2. 新建 `RelayProgressPage.tsx`，实现数据拉取 + 进度条渲染 + 空态 + 自动刷新
3. 接入路由（静态或动态，视 Core Config 而定）
4. 新建 E2E 测试文件，4 条用例全写完
5. 本地 `npm run build` 验证无编译错误
6. 推送分支，等 CI workspace-ci.yml 通过
