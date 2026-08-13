# Map F1 下钻空白修复 + 骨干层装配 — Definition of Done

### [BEHAVIOR] D1：collectDescendants 双向 BFS（反向 implements/contains）

- [ ] F1 形态 fixture（所有边方向 feature→capability），`collectDescendants('F1', edges, nodes)` 返回 `feat-a`、`feat-b` 非空数组
- [ ] `owned_by` 反向边不纳入收集（语义：所属关系，不是子孙关系）
Test: `npx vitest run apps/api/features/planning/__tests__/map-collect-descendants.test.ts`

Evidence: PASS ≥ 2，含正向 fixtures（原有 downstream 边）和反向 implements/contains 边 fixtures。

### [BEHAVIOR] D2：projector.js runProjection() 追加 backbone 层

- [ ] backbone 节点由 journey_steps JOIN journeys（biz_area=scopeKey, capability_code IS NOT NULL）生成
- [ ] backbone 节点 attributes 含 promise / status / display_order / step_key 字段
- [ ] capability → backbone 边类型为 `contains`，from_key = capability_code
Test: `npx vitest run packages/brain/src/map/__tests__/projector-backbone.test.js`

Evidence: mock DB 查询返回四步，projector 输出 backbone 节点数 = 4，边数 = 4。

### [BEHAVIOR] D3：生产 /api/brain/map backbone ≥ 4

- [ ] `curl http://localhost:5221/api/brain/map?scope=cecelia | jq '[.nodes[] | select(.type=="backbone")] | length'` 输出 ≥ 4
Test: manual:bash -c "curl http://localhost:5221/api/brain/map?scope=cecelia | jq '[.nodes[] | select(.type==\"backbone\")] | length'"

Evidence: 命令输出 >= 4。

### [BEHAVIOR] D4：/map 页 F1 Level 2 骨干栏四步可见（截图）

- [ ] Playwright 截图显示 Level 2 面板 backbone 栏含「接单进车间即分档」「合同即法律」「造完真验」「交付有回执」四步节点
Test: manual:playwright — 截图路径 `sprints/08131750-relay-cb41e551/e2e-screenshot-F1-backbone.png`

Evidence: 截图文件存在，人工核查骨干栏四步文字可见。

### [BEHAVIOR] D5：StateBadge 人话文案

- [ ] `child_unknown` → 「子节点状态未知」
- [ ] `receipt_missing` → 「回执未提交」
- [ ] `no_anchor` → 「无事实锚点」
- [ ] 其余 6 个 reason_code 均有人话翻译（不裸显技术码）
Test: manual:visual — 在 /map 页面核查 StateBadge 显示文案

Evidence: 非绿节点 Badge 显示中文文案，无原始技术码暴露。

### [ARTIFACT] D6：回归测试永久进 CI

- [ ] `apps/api/features/planning/__tests__/map-collect-descendants.test.ts` 进入 `workspace-ci.yml`
- [ ] 测试文件本身 commit 进 repo，不可删除
Test: `grep -r "map-collect-descendants" .github/workflows/workspace-ci.yml`

Evidence: CI 文件包含对应测试路径或 glob 覆盖。
