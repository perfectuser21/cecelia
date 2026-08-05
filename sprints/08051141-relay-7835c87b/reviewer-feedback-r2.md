# Reviewer 打回反馈（第1轮，verdict=REVISION）

## P0 必须修复（否则不能 APPROVE）

### P0-1: Scenario 3 紫 diff 必须改为强断言
当前 `e2e-gp-drill.spec.ts` Scenario 3 有软降级逻辑：
```typescript
// 无 changed 格子时不 fail
```
**必须修改为**：fixture 注入两个 approved GP 后，`gp-version-cell-changed` 必须硬断言：
```typescript
const changedCells = page.locator('[data-testid="gp-version-cell-changed"]');
await expect(changedCells).toHaveCount(count => count > 0);
// 或: expect(await changedCells.count()).toBeGreaterThan(0);
```

同时，fixture 必须确保两个 GP 版本间存在可对比的 cell_status 差异（注入两条 journey_step_links，一条 candidate、一条 delivered/approved），否则两版本间无差异永远无紫 diff。

### P0-2: Scenario 4 禁止 test.skip()
当前代码：
```typescript
if (await versionTable.count() === 0) {
  test.skip();
  return;
}
```
**必须删除 test.skip()**。fixture GP 注入成功后版本对比表必须渲染——若不渲染即为功能未实现，应让测试 fail 而不是 skip。改为硬断言：
```typescript
await expect(versionTable).toBeVisible({ timeout: 5000 });
```

### P0-3: Scenario 4 日期断言必须生效
当前 `dateItems` 被 locator 但从未 `expect`：
```typescript
const dateItems = detailPanel.locator('...');
// 注释：仅说明，未断言
```
**必须加**：
```typescript
expect(await dateItems.count()).toBeGreaterThan(0);
// 或: await expect(dateItems.first()).toBeVisible();
```

## P1 建议修复（提升合同质量）

### P1-1: 空态文本对齐
contract-dod.md FR-7 断言文本"本线暂无批准版本记录"与现有代码"本线暂无 GP 版本记录"不一致。
**选择一种**：
- 方案A：DoD 明确要求 Generator 将 UI 文字改为"本线暂无批准版本记录"（在代码层 checkitem 中列出）
- 方案B：FR-7 断言文本改为与现有代码一致

### P1-2: FR-3 表头选择器明确化  
`th, [data-version-col]` 宽松选择器若现有代码用 `<span>` 渲染版本号则永远找不到。
在不变量或合同中约定：版本列标签必须渲染在 `<th>` 内，或 Generator 为列头加 `data-version-col` 属性。

### P1-3: 补边界条件 DoD checkitem
PRD 第4条边界（步骤未选中时点击版本格子不响应）在 DoD 中无对应条目。
在代码层 checkitem 加一行：`- [ ] 未选中步骤时版本对比格子点击无响应（UI 不抛异常）`

### P1-4: 不变量豁免说明
在合同不变量条目里补一句：「测试常量 `ANCHOR_JOURNEY_ID` 为 PRD 预约定 journey，允许作为测试固定值声明，但 UI 组件逻辑中 lineId/journeyId 不得硬编码」

## 其余内容质量良好，保留不变
- contract-draft.md 场景地图、FR-1/FR-2/FR-5/FR-6/FR-8 断言、E2E 验收段
- contract-dod.md DoD 三层结构、[BEHAVIOR] 标签段（9条）、manual:bash 命令
- data-testid 锚点清单（6个锚点）
