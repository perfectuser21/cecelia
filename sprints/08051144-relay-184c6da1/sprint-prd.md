# Sprint PRD — 军师台形态对版收尾

**Task ID**: 184c6da1-ef57-4171-ba92-5b05711076e6  
**Sprint Dir**: sprints/08051144-relay-184c6da1  
**Priority**: P1  
**环境**: mac_web (Playwright, localhost:5174)  
**版式标杆**: artifact e67e7b0b（军师台可交互原型 v5）

---

## Invariant 约束

以下约束在任何情况下不得破坏：

1. **线列表不得污染 smoke 行**：`/strategist` 页面渲染的 line name 不得匹配 `/^\[smoke\]/i` 或 `/^gp-agg-smoke/i`
2. **要素页不得显示占位内容**：有账本数据的线（F1）进入要素页签，不得出现「建设中」「敬请期待」字样
3. **拍板卡标题不得裸 UUID**：待拍板卡片标题字段不得直接为 UUID 格式（`/^[0-9a-f-]{36}$/i`）
4. **对话页不得永久加载**：发送消息后页面不得无限停留在「加载中…」，最长等待 30s 后必须有状态变化
5. **数字行数据源唯一**：全貌页 GP数/决策数/在干活数必须从 Brain API 实时拉取，不得硬编码
6. **不破坏已有页签**：全貌/规划/晨报/投入页签的已有功能不得因本次修改出现回归

---

## 累积 FR

| # | 功能需求 | 对应 Fix |
|---|----------|----------|
| FR-1 | 要素页签从 `PlaceholderTab` 替换为 `ElementsTab`，以要素为纵轴、步骤为横轴展示覆盖矩阵，数据来源 `/api/brain/journey_step_links?cells=1` | Fix-1 |
| FR-2 | 拍板卡标题做 UUID 检测，匹配则降级显示 `description` 或「待拍板事项」；待拍板卡片内增加「✓ 通过」「✗ 否决」两个选项按钮（仅 UI） | Fix-2 |
| FR-3 | 对话页 `fetchMessages` 加 10s AbortController 超时，消息列表为空时显示「暂无消息，发送第一条吧」替代无限加载态 | Fix-3 |
| FR-4 | `StrategistPage` 顶栏下方增加四格数字行（Features数/GP数/决策数/在干活数），并发拉取 Brain API，误差 ≤ 5% | Fix-4 |
| FR-5 | `fetchLines` 回调对 `areas` 数据做 `.filter()` 过滤 smoke 行，匹配 `/^\[smoke\]/i` 或 `/^gp-agg-smoke/i` 的 line 不渲染 | Fix-5 |

---

## NFR

NFR: N/A（本次全为 UI 修复，无特殊非功能约束）

---

## 现状差距

| 页签 | 现状 | 目标 |
|------|------|------|
| 要素页 | `PlaceholderTab` 显示「建设中」 | 11要素覆盖/缺口清单，接 F1 真数据 |
| 拍板页 | 标题可能为裸 UUID，无 A/B 按钮 | 标题去 UUID，卡片含选项按钮 |
| 对话页 | fetch 失败可能永久「加载中…」 | 超时保护 + 空态兜底 |
| 全貌页 | 顶部无愿景/数字行区块 | 补 pano.nums 四格数字行 |
| 线列表 | 含 16+ 条 smoke 测试行 | 过滤掉，不渲染给用户 |

---

## 验收标准（Final E2E — mac_web Playwright）

### AC-1 要素页
- 访问 `/strategist/e6f803f2-8c48-4cce-a7a1-5b1bda5e9c29` 切到「要素」页签
- 断言页面**不含**「建设中」；断言出现「FR」「NFR」等要素关键词
- 快照：`screenshots/ac1-elements.png`

### AC-2 拍板页
- 访问线空间 decision 页签
- 断言：待拍板卡片标题不匹配 `/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/`
- 断言：卡片内存在「通过」或「否决」按钮
- 快照：`screenshots/ac2-decision.png`

### AC-3 对话页
- 进入对话，发送消息「你好」，等待 ≤ 30s
- 断言页面不永久停留「加载中…」
- 快照：`screenshots/ac3-conversation.png`

### AC-4 全貌页顶部数字行
- 访问 `/strategist`
- 断言：页面含 GP 数/决策数/在干活数四个数字区块
- Brain API 对账误差 ≤ 5%（基线：GP=25, 决策=100, 活跃任务=2）
- 快照：`screenshots/ac4-pano-nums.png`

### AC-5 线列表 smoke 过滤
- 访问 `/strategist`
- 断言：页面不出现 `/\[smoke\]/i` 或 `/gp-agg-smoke/i` 匹配文字
- 快照：`screenshots/ac5-line-list.png`

---

## 实现方案

### Fix-1：要素页接线（`StrategistLinePage.tsx` L1093）
替换 `PlaceholderTab` 为 `ElementsTab`，以 `STANDARD_ELEMENT_KEYS` 为纵轴、步骤为横轴展示覆盖矩阵；数据复用 `journey_step_links` API（L408-421 已有 `cells` 数据获取逻辑）。

### Fix-2：拍板卡带选项（`StrategistLinePage.tsx` `DecisionTab` L754）
- 标题：优先 `t.description`，fallback `t.title`；UUID 正则命中则显示「待拍板事项」
- 待处理卡片内追加「✓ 通过」「✗ 否决」两个 `<button>`（仅 UI，无后端调用）

### Fix-3：对话超时兜底（`ConversationsPanel.tsx` L130）
- `fetchMessages` 加 `AbortController` 10s 超时
- 空消息列表显示「暂无消息，发送第一条吧」

### Fix-4：全貌数字行（`StrategistPage.tsx`）
顶栏下方并发拉取四接口渲染 `PanoNums` 横排卡片：
```
Features数 | GP数(/golden-paths) | 决策数(/decisions?status=active) | 在干活数(/tasks?status=in_progress)
```

### Fix-5：smoke 过滤（`StrategistPage.tsx` `fetchLines` L180）
```tsx
lines: area.lines.filter(l =>
  !/^\[smoke\]/i.test(l.name) && !/^gp-agg-smoke/i.test(l.name)
)
```

---

## E2E 测试

**路径**: `sprints/08051144-relay-184c6da1/strategist-form-verify.spec.ts`

```
describe('军师台形态对版')
  test AC-1 要素页无「建设中」有账本数据
  test AC-2 拍板卡无裸uuid有选项按钮
  test AC-3 对话发消息不永久停留加载中
  test AC-4 全貌数字行四区块与API对账
  test AC-5 线列表不含smoke行
```

截图存档：`screenshots/ac{1-5}-*.png` 须进 PR diff。

---

## 不包含

- 四级下钻（批次1/2）
- C-suite 角色审线（另立 task）
- 要素页写入功能（只读）
- 拍板按钮后端接入（UI 即达标）

---

## 完成标准 Checklist

- [ ] Fix-1：要素页接真数据，无「建设中」
- [ ] Fix-2：拍板卡去 UUID + A/B 按钮
- [ ] Fix-3：对话超时兜底 + 空态文字
- [ ] Fix-4：全貌数字行四格
- [ ] Fix-5：smoke 行过滤
- [ ] E2E 五条全绿 + 截图存档
- [ ] CI 绿（workspace-ci.yml）

journey_type: feature
target_environment: mac_web
