# Contract Draft — 军师台形态对版收尾

**Task ID**: 184c6da1-ef57-4171-ba92-5b05711076e6  
**Sprint Dir**: sprints/08051144-relay-184c6da1  
**环境**: mac_web (Playwright, localhost:5174)  
**合约版本**: v1（首轮）  
**日期**: 2026-08-05  

---

## 合约范围

本合约覆盖 5 项 UI 修复（Fix-1 ~ Fix-5），验收以 mac_web Playwright 真跑为准。

| Fix | 文件 | 改动摘要 |
|-----|------|----------|
| Fix-1 | `apps/dashboard/src/pages/strategist/StrategistLinePage.tsx` L1093 | 替换 `PlaceholderTab` 为 `ElementsTab` |
| Fix-2 | `apps/dashboard/src/pages/strategist/StrategistLinePage.tsx` L754 `DecisionTab` | UUID 检测降级 + A/B 按钮 |
| Fix-3 | `apps/dashboard/src/pages/warroom/ConversationsPanel.tsx` L130 | 10s AbortController 超时 + 空态文字 |
| Fix-4 | `apps/dashboard/src/pages/strategist/StrategistPage.tsx` | 顶栏数字行四格 |
| Fix-5 | `apps/dashboard/src/pages/strategist/StrategistPage.tsx` L180 `fetchLines` | smoke 行过滤 |

---

## 实现边界（明确不包含）

- 拍板按钮后端接入（「通过」「否决」仅 UI，无后端调用）
- 要素页写入功能（只读展示）
- 四级下钻功能
- C-suite 角色审线

---

## E2E 验收

### 前提条件

```bash
# 1. 启动 Dashboard（本机 mac_web 环境）
cd /workspace && pnpm --filter @cecelia/dashboard dev &
# 等待 localhost:5174 就绪

# 2. 确认 Brain 在线
curl -s http://localhost:5221/api/brain/context | jq '.status // "ok"'
```

### AC-1 要素页真数据（Fix-1）

**目标路径**: `/strategist/e6f803f2-8c48-4cce-a7a1-5b1bda5e9c29` → 切到「要素」页签

**验收断言**:
1. `page.textContent('body')` 不含「建设中」
2. `page.textContent('body')` 不含「敬请期待」
3. `page.textContent('body')` 含 `FR`、`NFR` 中至少一个（STANDARD_ELEMENT_KEYS 首两项）
4. 快照存档 `screenshots/ac1-elements.png`

**Playwright 真跑命令**:
```bash
cd /workspace && npx playwright test sprints/08051144-relay-184c6da1/tests/strategist-form-verify.spec.ts \
  --grep "AC-1" \
  --project=chromium \
  --headed=false \
  2>&1 | tee sprints/08051144-relay-184c6da1/screenshots/ac1-run.log
```

---

### AC-2 拍板卡去 UUID + A/B 按钮（Fix-2）

**目标路径**: `/strategist/{任意线ID}` → 切到「拍板」页签

**验收断言**:
1. 所有待拍板卡片标题文字不匹配 `/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i`
2. 页面含至少一个文字含「通过」或「否决」的按钮（无待拍板事项时跳过）
3. 快照存档 `screenshots/ac2-decision.png`

**Playwright 真跑命令**:
```bash
cd /workspace && npx playwright test sprints/08051144-relay-184c6da1/tests/strategist-form-verify.spec.ts \
  --grep "AC-2" \
  --project=chromium \
  --headed=false \
  2>&1 | tee sprints/08051144-relay-184c6da1/screenshots/ac2-run.log
```

---

### AC-3 对话超时保护（Fix-3）

**目标路径**: `/warroom` 或含 Conversations 面板的任意页面

**验收断言**:
1. 发送消息后 30s 内，`page.textContent('body')` 不再仅含「加载中…」
2. 若消息列表为空，页面含「暂无消息，发送第一条吧」
3. 快照存档 `screenshots/ac3-conversation.png`

**Playwright 真跑命令**:
```bash
cd /workspace && npx playwright test sprints/08051144-relay-184c6da1/tests/strategist-form-verify.spec.ts \
  --grep "AC-3" \
  --project=chromium \
  --headed=false \
  --timeout=45000 \
  2>&1 | tee sprints/08051144-relay-184c6da1/screenshots/ac3-run.log
```

---

### AC-4 全貌页数字行（Fix-4）

**目标路径**: `/strategist`

**验收断言**:
1. 页面含「GP数」或数字区块组件（至少 4 个数字计数块）
2. Features 数、GP 数、决策数、在干活数均显示数字（非空、非 loading）
3. GP 数与 `GET /api/brain/golden-paths` 响应条目数误差 ≤ 5%（基线参考 GP=25）
4. 决策数与 `GET /api/brain/decisions?status=active` 响应误差 ≤ 5%（基线参考 100）
5. 快照存档 `screenshots/ac4-pano-nums.png`

**Playwright 真跑命令**:
```bash
cd /workspace && npx playwright test sprints/08051144-relay-184c6da1/tests/strategist-form-verify.spec.ts \
  --grep "AC-4" \
  --project=chromium \
  --headed=false \
  2>&1 | tee sprints/08051144-relay-184c6da1/screenshots/ac4-run.log
```

---

### AC-5 线列表 smoke 过滤（Fix-5）

**目标路径**: `/strategist`

**验收断言**:
1. `page.textContent('body')` 不含匹配 `/\[smoke\]/i` 的文字
2. `page.textContent('body')` 不含匹配 `/gp-agg-smoke/i` 的文字
3. 快照存档 `screenshots/ac5-line-list.png`

**Playwright 真跑命令**:
```bash
cd /workspace && npx playwright test sprints/08051144-relay-184c6da1/tests/strategist-form-verify.spec.ts \
  --grep "AC-5" \
  --project=chromium \
  --headed=false \
  2>&1 | tee sprints/08051144-relay-184c6da1/screenshots/ac5-run.log
```

---

### 全套一次跑

```bash
cd /workspace && npx playwright test sprints/08051144-relay-184c6da1/tests/strategist-form-verify.spec.ts \
  --config=sprints/08051144-relay-184c6da1/tests/playwright.config.ts \
  --project=chromium \
  --headed=false \
  2>&1 | tee sprints/08051144-relay-184c6da1/screenshots/all-run.log
```

---

## 回归保护

本次修改不得破坏以下已有功能（Invariant 约束）：
- 全貌/规划/晨报/投入页签正常渲染
- `/strategist` 路由可访问
- Brain API 调用链路正常（`/api/brain/areas`、`/api/brain/journey_step_links` 等）
