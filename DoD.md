# DoD: brain-test-pyramid L3 PR3 — cross-domain-routing

- [x] **[ARTIFACT]** 新增 `packages/brain/src/__tests__/integration/cross-domain-routing.integration.test.js`
  - Test: `node -e "require('fs').accessSync('packages/brain/src/__tests__/integration/cross-domain-routing.integration.test.js')"`
- [x] **[BEHAVIOR]** pending-actions 状态流转：pending_approval → rejected，幂等验证
  - Test: `tests/integration/cross-domain-routing.integration.test.js`
- [x] **[BEHAVIOR]** intent/match 自然语言能匹配到对应 OKR 记录
  - Test: `tests/integration/cross-domain-routing.integration.test.js`
- [x] **[BEHAVIOR]** intent/match 空 query / 无匹配词 → 正确响应
  - Test: `tests/integration/cross-domain-routing.integration.test.js`
