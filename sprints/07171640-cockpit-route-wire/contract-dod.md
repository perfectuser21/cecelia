# DoD: 修指挥舱路由接线 [ebc008a5]

## 行为断言

[BEHAVIOR] App.tsx 直接 import OwnerCockpitPage（不依赖 coreConfig 动态加载，顶层静态可见）
manual:bash grep -q "OwnerCockpitPage" apps/dashboard/src/App.tsx && echo "PASS: App.tsx 含 OwnerCockpitPage" || echo "FAIL"

[BEHAVIOR] apps/api/features/dashboard/index.ts 的 routes 含 `{ path: '/', component: 'OwnerCockpitPage' }` 接线记录
manual:bash grep -q "path: '/'" apps/api/features/dashboard/index.ts && grep -q "OwnerCockpitPage" apps/api/features/dashboard/index.ts && echo "PASS: manifest 接线存在" || echo "FAIL"

[BEHAVIOR] 断言 A（grep 级）：App.tsx 文件文本包含字符串 OwnerCockpitPage
manual:bash npx vitest run sprints/07171640-cockpit-route-wire/tests/cockpit-route.test.ts --reporter=verbose 2>&1 | grep -E "PASS|FAIL|✓|×"

[BEHAVIOR] 断言 B（manifest 级）：allRoutes 数组存在 path='/' + component='OwnerCockpitPage' 映射
manual:bash npx vitest run sprints/07171640-cockpit-route-wire/tests/cockpit-route.test.ts --reporter=verbose 2>&1 | grep -E "PASS|FAIL|✓|×"

[BEHAVIOR] Playwright E2E：http://localhost:5211/ 首页 data-testid="owner-cockpit" 根容器可见
manual:bash npx playwright test sprints/07171640-cockpit-route-wire/tests/e2e-verify.spec.ts --reporter=line

[BEHAVIOR] Playwright E2E：http://localhost:5211/ 首页 六指标卡 [data-testid^="metric-card-"] ≥6 个可见
manual:bash npx playwright test sprints/07171640-cockpit-route-wire/tests/e2e-verify.spec.ts --reporter=line

[BEHAVIOR] Playwright E2E：http://localhost:5211/ 首页 data-testid="battle-card" 存在或"暂无进行中任务"占位符出现
manual:bash npx playwright test sprints/07171640-cockpit-route-wire/tests/e2e-verify.spec.ts --reporter=line

---

## DoD 完成条件

- [ ] App.tsx 顶层 import OwnerCockpitPage（grep 可检出）
- [ ] `apps/api/features/dashboard/index.ts` allRoutes 含 `{ path: '/', component: 'OwnerCockpitPage', requireAuth: true }`（不得删除）
- [ ] 单元测试 断言 A（grep 级）通过
- [ ] 单元测试 断言 B（manifest 路由映射级）通过
- [ ] Playwright E2E `data-testid="owner-cockpit"` 根容器可见
- [ ] Playwright E2E 六指标卡 ≥6 个可见
- [ ] Playwright E2E 作战板元素存在
- [ ] 截图存档于 test-results/cockpit-e2e.png
- [ ] CI 绿（engine-ci / workspace-ci）
- [ ] 测试文件已 commit 进 repo，永久留在 CI
