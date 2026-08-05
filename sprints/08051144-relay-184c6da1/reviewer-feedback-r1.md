# Contract Reviewer Feedback — R1
**Task ID**: 184c6da1-ef57-4171-ba92-5b05711076e6  
**评审日期**: 2026-08-05  
**评审轮次**: R1（首轮）  
**Verdict**: REVISION

---

## 总结

合同整体结构清晰，5 条 AC 全部有对应测试用例，但存在 **3 个必须修复的问题** 和 **2 个建议项**，主要集中在断言强度不足和判定点登记缺失两处硬伤。

---

## Rubric 打分（7 维）

```json
{
  "ac_coverage":        { "score": 5, "max": 5, "note": "AC-1~AC-5 全部覆盖，+Invariant 回归测试" },
  "assertion_testability": { "score": 3, "max": 5, "note": "AC-4 对账逻辑有降级漏洞；AC-2 UUID 选择器过宽" },
  "e2e_runnability":    { "score": 4, "max": 5, "note": "playwright.config.ts 配置正确；fetch() 在 Playwright 上下文可用需确认" },
  "prd_mapping":        { "score": 5, "max": 5, "note": "FR-1~FR-5 与 AC-1~AC-5 一一对应，无遗漏" },
  "behavior_tags":      { "score": 4, "max": 5, "note": "[BEHAVIOR-1~5] 注释已打标；测试代码内有引用但不系统" },
  "judgment_registry":  { "score": 0, "max": 5, "note": "测试文件无 judgments_written 计数表/注释" },
  "dod_completeness":   { "score": 4, "max": 5, "note": "DoD checklist 完整；BLOCK 条件清晰；BEHAVIOR-6 静态检查偏弱" }
}
```

**总分**: 25 / 35

---

## MUST FIX（阻断项）

### [M1] AC-4 对账逻辑存在假绿风险

**位置**: `strategist-form-verify.spec.ts` L247-250, L271-274

**问题**: 
```ts
// 降级：只验证数字区块存在
expect(numbers.length).toBeGreaterThan(0);
```
两处降级路径（GP 对账和决策对账）在 `hasCloseMatch === false` 时均退化为"页面有数字就通过"，这使得数字行根本不存在（比如硬编码了 0）也能绿过，违背了 PRD 中"数据源唯一、实时拉取、误差 ≤ 5%"的核心要求。

**修复方案**:
删除降级分支，改为强断言：
```ts
// GP 对账（L243-252）
expect(hasCloseMatch).toBe(true);

// 决策对账（L268-274）  
const hasCloseMatchDecision = numbers.some(n => Math.abs(n - apiDecisionCount) <= tolerance);
expect(hasCloseMatchDecision).toBe(true);
```
若担心 API 返回 0 的边缘情况，仅在 `apiGpCount === 0` 时 skip（已有的 skip 逻辑保留）。

---

### [M2] 测试文件无判定点登记表（judgments_written = 0）

**位置**: `strategist-form-verify.spec.ts` 全文

**问题**: 合同 DoD 要求"判定点完整性"，但测试文件中未登记 `judgments_written` 计数，无法机械验证判定点覆盖情况。

**修复方案**:
在文件顶部注释块末尾追加判定点登记表：
```ts
/**
 * judgments_written: 12
 * 判定点登记：
 * [J-01] bodyText 不含「建设中」           → AC-1 test 1, L53
 * [J-02] bodyText 不含「敬请期待」          → AC-1 test 1, L54
 * [J-03] 含要素关键词之一                   → AC-1 test 1, L59
 * [J-04] journey_step_links API 可用       → AC-1 test 2, L70
 * [J-05] 卡片标题不匹配 UUID 正则           → AC-2 test 1, L114
 * [J-06] 含「通过」或「否决」按钮           → AC-2 test 2, L140
 * [J-07] 不永久停留「加载中…」             → AC-3 test 1, L177
 * [J-08] 显示空态文字或消息内容             → AC-3 test 1, L188
 * [J-09] AbortController 代码存在          → AC-3 test 2, L200
 * [J-10] 数字行含 ≥2 个关键词             → AC-4 test 1, L222
 * [J-11] GP 数与 API 误差 ≤ 5%           → AC-4 test 2（待修复 M1）
 * [J-12] 决策数与 API 误差 ≤ 5%          → AC-4 test 3（待修复 M1）
 * [J-13] bodyText 不含 [smoke]            → AC-5 test 1, L292
 * [J-14] bodyText 不含 gp-agg-smoke      → AC-5 test 1, L293
 * [J-15] smoke 过滤源码存在               → AC-5 test 2, L305
 */
```
（实际计数根据最终测试用例调整）

---

### [M3] AC-2 UUID 检测选择器过宽，存在误判风险

**位置**: `strategist-form-verify.spec.ts` L106

**问题**:
```ts
const cardTitles = page.locator('.font-medium, .card-title, h3, h4').filter({
  hasNotText: '待拍板',
});
```
`.font-medium` 是 Tailwind 通用类，会命中导航栏、侧边栏、数字行等所有加粗文字，导致断言的"卡片标题"实际上涵盖了非决策卡片区域，产生误判（把导航栏文字也当成卡片标题检查）。

**修复方案**:
精确定位决策卡片容器，建议改用数据属性或已知的组件类名：
```ts
// 优先用数据属性（需 Fix-2 实现时添加 data-testid）
const cardTitles = page.locator('[data-testid="decision-card-title"]');

// 如无 data-testid，退而用 DecisionTab 容器内的标题选择器
const decisionSection = page.locator('[data-tab="decision"], .decision-tab-content');
const cardTitles = decisionSection.locator('.font-medium, h3, h4');
```
同步要求：Fix-2 实现时在待拍板卡片标题元素上加 `data-testid="decision-card-title"`。

---

## 建议项（非阻断）

### [S1] AC-3 对话测试等待策略可更确定

**位置**: L159-178

当前用 `waitForTimeout(2000)` + 条件判断 + 再 `waitForTimeout(5000)` 的方式较脆弱。建议改用 `waitForFunction` 轮询：
```ts
await page.waitForFunction(
  () => !document.body.textContent?.includes('加载中'),
  { timeout: 30_000 }
).catch(() => {}); // 超时后继续检查 —— 用于断言"不永久加载"
```

### [S2] AC-4 Features 数 API 路径未确认

**位置**: `contract-dod.md` L94, DoD BEHAVIOR-4

`/api/brain/features` 端点在 DoD 中有 `|| echo "features endpoint - check actual endpoint path"` 的注释，说明该端点存在不确定性。测试代码中 AC-4 test 1 仅检查关键词包含 `Features`/`Feature`（L219），未实际调 features API 对账。

建议在实现 Fix-4 前确认正确的 API 路径，并在 AC-4 test 1 中补一个 API 可用性断言（类似 AC-1 test 2 对 journey_step_links 的做法）。

---

## 合约完整性确认

| 检查项 | 结论 |
|--------|------|
| AC-1 要素页覆盖 | 已覆盖 |
| AC-2 拍板卡覆盖 | 已覆盖（选择器需修复） |
| AC-3 对话页覆盖 | 已覆盖 |
| AC-4 全貌数字行覆盖 | 已覆盖（对账逻辑需修复） |
| AC-5 smoke 过滤覆盖 | 已覆盖 |
| PrepPRD 6条铁律映射 | Invariant 1-5 全部有 [BEHAVIOR-N] 对应 |
| 判定点登记表 | **缺失**（M2 阻断项） |
| Playwright 配置 | 正确（chromium, timeout=60s, retries=1） |
| 截图路径规范 | ac1~ac5 命名符合 PRD 要求 |
| E2E 运行命令 | contract-draft.md 中每条 AC 均有独立命令 |

---

## 解除阻断条件

修复 M1、M2、M3 后可重提 R2 评审。预计改动量：
- M1：删除两处降级分支（~4 行改动）
- M2：追加顶部注释判定点表（~20 行注释）
- M3：精化选择器 + Fix-2 实现时加 data-testid（~5 行改动）
