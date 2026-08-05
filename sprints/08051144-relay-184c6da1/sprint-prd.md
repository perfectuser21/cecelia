# Sprint PRD — 军师台形态对版收尾

**Task ID**: 184c6da1-ef57-4171-ba92-5b05711076e6  
**Sprint Dir**: sprints/08051144-relay-184c6da1  
**Priority**: P1  
**环境**: mac_web (Playwright, localhost:5174)  
**版式标杆**: artifact e67e7b0b（军师台可交互原型 v5）

---

## 现状差距分析

| 页签 | 现状 | 目标状态 |
|------|------|----------|
| 要素页 | `PlaceholderTab` 渲染「建设中，敬请期待」 | 11要素覆盖/缺口清单，接 F1 账本真数据 |
| 拍板页 | `DecisionTab` 渲染卡片，但标题直接用 `t.title`（可能为裸uuid），无 A/B 选项按钮 | 卡片含问题描述 + 可点击选项按钮，标题无裸uuid |
| 对话页 | `ConversationsPanel` 发消息后若 `loadingMsgs=true` 显示「加载中…」，响应后显示内容 | 发消息后不永久停留在「加载中…」；显示应答或明确空态/错误提示 |
| 全貌页 | Step×要素矩阵（存在），但**顶部无**愿景/数字行区块（Features数/GP数/决策数/在干活数） | 顶部补 pano.nums 数字行，数字与 Brain API 对账 |
| 线列表 | `/strategist` 渲染所有 journey，包含 `[smoke]%` 和 `gp-agg-smoke%` 行（已确认 16+ 条） | 过滤掉这些测试污染行，不渲染给用户 |

---

## 验收标准（Final E2E — mac_web Playwright）

### AC-1 要素页
- 访问 `/strategist/e6f803f2-8c48-4cce-a7a1-5b1bda5e9c29`（工厂 F1 — 有账本数据）切到「要素」页签
- 断言页面**不含**文字「建设中」
- 断言出现 11要素相关的关键词（如「FR」「NFR」「覆盖」「缺口」）或格子状态指示
- 快照：`screenshots/ac1-elements.png`

### AC-2 拍板页
- 访问线空间 decision 页签，找到待拍板卡片
- 断言：每张待拍板卡片标题**不匹配** `/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/`（无裸 UUID）
- 断言：卡片内存在可点击的选项按钮（`button` 包含「同意」「否决」或「A」「B」等选项文字）
- 快照：`screenshots/ac2-decision.png`

### AC-3 对话页
- 访问线空间 conversation 页签，进入或创建一条对话，发送消息「你好」
- 等待不超过 30s
- 断言页面**不**仅显示「加载中…」（即应答出现，或出现错误提示、空态文字）
- 快照：`screenshots/ac3-conversation.png`

### AC-4 全貌页顶部数字行
- 访问 `/strategist`（线列表）或任意线的全貌页
- 断言：页面顶部包含 Features 数/GP 数/决策数/在干活数四个数字区块
- 通过 Brain API 对账：`GET /api/brain/context` 返回值 vs 页面显示值误差 ≤ 5%
- 快照：`screenshots/ac4-pano-nums.png`

### AC-5 线列表 smoke 行过滤
- 访问 `/strategist`
- 断言：页面上不出现匹配 `/\[smoke\]/i` 的文字
- 断言：页面上不出现匹配 `/gp-agg-smoke/i` 的文字
- 快照：`screenshots/ac5-line-list.png`

---

## 实现方案

### Fix-1：要素页接线（`StrategistLinePage.tsx`）

**当前代码**（Line 1093）:
```tsx
{activeTab === 'elements' && <PlaceholderTab label="要素" icon={Activity} />}
```

**目标**：实现 `ElementsTab` 组件，复用 `OverviewTab` 中已有的 `StepLedgerPanel` + 格子账本数据获取逻辑，但改为以「要素维度」为主轴展示：
- 纵轴：11要素键（FR/NFR/判定点/不变量/失败语义/效果确认/两轴衔接等）
- 横轴：各步骤的覆盖状态
- 汇总行：已覆盖数 / 总格子数 / 缺口高亮（red/gray 格子）
- 数据 API：`/api/brain/journey_step_links?journey_id=<lineId>&cells=1&limit=500`（已有，直接复用）

### Fix-2：拍板卡带选项（`StrategistLinePage.tsx` `DecisionTab`）

**当前问题**：
1. 标题来源 `t.title`，可能直接是 UUID
2. 无 A/B 选项按钮渲染

**目标**：
- 标题显示 `t.description`（优先）或 `t.title`（fallback，且做 UUID 检测裁剪为「待拍板事项」）
- UUID 检测正则：`/^[0-9a-f-]{36}$/i`
- 对 `queued/in_progress` 状态任务，卡片内增加「✓ 通过」「✗ 否决」两个行动按钮（仅 UI，不做后端 POST，显示即达标）

### Fix-3：对话页加载状态（`ConversationsPanel.tsx`）

**当前问题**：`loadingMsgs` 为 true 时显示「加载中…」；若 fetch 失败或超时未 catch，可能永久停留

**目标**：
- `fetchMessages` 加超时保护（10s timeout via `AbortController`）
- 无论成功失败，`finally` 确保 `setLoadingMsgs(false)`（现已有，但校验错误路径覆盖）
- 消息列表为空时显示明确空态文字：「暂无消息，发送第一条吧」（替代无限加载中）

### Fix-4：全貌页顶部数字行（`StrategistPage.tsx` 或新 `PanoNums` 组件）

**目标**：在 `StrategistPage`（线列表入口）顶栏下方增加四格数字行：
```
Features数 | GP数 | 决策数 | 在干活数
```
数据源：
- Features 数 → `GET /api/brain/warroom/lines` 聚合 `task_total`（或新增 feature count 接口）
- GP 数 → `GET /api/brain/golden-paths?limit=1` → 取响应总数（目前已知 25）
- 决策数 → `GET /api/brain/decisions?status=active&limit=1` → 取总数（100）
- 在干活数 → `GET /api/brain/tasks?status=in_progress` → 取总数（2）

实现：在 `StrategistPage` 主内容区顶部插入 `PanoNums` 组件，独立 `useEffect` 并发拉取四个数字，渲染为横排卡片条。

### Fix-5：线列表 smoke 过滤（`StrategistPage.tsx`）

**目标**：在渲染前过滤 `LineSummary.name` 匹配以下模式的条目：
- `/^\[smoke\]/i`
- `/^gp-agg-smoke/i`

修改位置：`fetchLines` 回调中对 `areas` 数据做 `line.filter()` 处理：
```tsx
const filteredAreas = data.areas.map(area => ({
  ...area,
  lines: area.lines.filter(l =>
    !/^\[smoke\]/i.test(l.name) && !/^gp-agg-smoke/i.test(l.name)
  ),
}));
setAreas(filteredAreas.filter(a => a.lines.length > 0));
```

---

## E2E 测试文件

**路径**: `sprints/08051144-relay-184c6da1/strategist-form-verify.spec.ts`  
**运行器**: `npx playwright test --config=playwright.config.ts sprints/08051144-relay-184c6da1/strategist-form-verify.spec.ts`

测试套件结构：
```
describe('军师台形态对版')
  test('AC-1 要素页显示账本真数据无「建设中」字样')
  test('AC-2 拍板卡无裸uuid且有选项按钮')
  test('AC-3 对话发消息不永久停留加载中')
  test('AC-4 全貌页顶部有愿景/数字行区块')
  test('AC-5 线列表不含smoke行')
```

---

## 截图存档要求

| 文件名 | 对应 AC |
|--------|---------|
| `screenshots/ac1-elements.png` | 要素页真数据 |
| `screenshots/ac2-decision.png` | 拍板卡片带选项 |
| `screenshots/ac3-conversation.png` | 对话应答状态 |
| `screenshots/ac4-pano-nums.png` | 全貌数字行 |
| `screenshots/ac5-line-list.png` | 线列表无smoke |

所有截图须进 PR diff（`git add screenshots/`）。

---

## 不包含

- 四级下钻（批次1/2）
- C-suite 四角色审线（规划页换帽，另立 task）
- 要素页写入功能（只做只读展示）
- 拍板按钮后端接入（UI 渲染即达标）

---

## 技术上下文

### 关键文件
- `apps/dashboard/src/pages/strategist/StrategistLinePage.tsx` — 七页签主文件（1106 行，Fix-1/2/3 均在此）
- `apps/dashboard/src/pages/strategist/StrategistPage.tsx` — 线列表入口（Fix-4/5 在此）
- `apps/dashboard/src/pages/warroom/ConversationsPanel.tsx` — 对话面板（Fix-3 协同）

### Brain API 对账基线（2026-08-05 实测）
- 活跃 GP 数：25
- 活跃决策数：100
- 进行中任务数：2
- 线总数：cecelia 38 条 + zenithjoy 8 条 = 46 条（含 smoke，过滤后约 30 条）
- F1（工厂·开发闭环）journey_id：`e6f803f2-8c48-4cce-a7a1-5b1bda5e9c29`，有 20 个格子账本

### 当前 `elements` 页签状态
```tsx
// StrategistLinePage.tsx Line 1093 — 待替换
{activeTab === 'elements' && <PlaceholderTab label="要素" icon={Activity} />}
```

`STANDARD_ELEMENT_KEYS`（已在文件中定义）：
```ts
['FR', 'NFR', '判定点', '不变量', '失败语义', '效果确认', '两轴衔接']
```

---

## 完成标准 Checklist

- [ ] Fix-1 落地：要素页用真数据替换 PlaceholderTab
- [ ] Fix-2 落地：拍板卡标题去 uuid，增加 A/B 选项按钮
- [ ] Fix-3 落地：对话页加载状态兜底，不永久停留
- [ ] Fix-4 落地：全貌页/线列表顶部数字行（Features/GP/决策/在干活）
- [ ] Fix-5 落地：线列表过滤 smoke 行
- [ ] E2E 测试文件写完并全绿
- [ ] 五处截图存入 PR
- [ ] CI 绿（workspace-ci.yml）
