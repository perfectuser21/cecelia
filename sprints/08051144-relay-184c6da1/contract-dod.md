# Contract DoD — 军师台形态对版收尾

**Task ID**: 184c6da1-ef57-4171-ba92-5b05711076e6  
**版本**: v1（首轮）  
**日期**: 2026-08-05  

---

## [BEHAVIOR] 断言清单

### [BEHAVIOR-1] 要素页不显示占位内容

**触发条件**: 用户访问任意线的要素页签（有账本数据的线，如 `e6f803f2-8c48-4cce-a7a1-5b1bda5e9c29`）  
**可观测结果**:
- 页面不出现「建设中」字样
- 页面不出现「敬请期待」字样
- 页面出现至少一个 STANDARD_ELEMENT_KEYS 的关键词（FR / NFR / 判定点 / 不变量 / 失败语义 / 效果确认 / 两轴衔接）
- 页面呈现表格/矩阵结构（含步骤轴与要素轴）

**manual:bash 验收命令**:
```bash
BRAIN_URL=http://localhost:5221
DASHBOARD_URL=http://localhost:5174

# 验证 journey_step_links API 有数据
curl -s "${BRAIN_URL}/api/brain/journey_step_links?journey_id=e6f803f2-8c48-4cce-a7a1-5b1bda5e9c29&cells=1&limit=10" \
  | jq '.total // (.items | length)'
```

---

### [BEHAVIOR-2] 拍板卡标题不裸显 UUID

**触发条件**: 用户进入线空间「拍板」页签，有待拍板事项时  
**可观测结果**:
- 所有待拍板卡片的标题文字不匹配 UUID 格式 `/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i`
- 若 `title` 为 UUID，则展示 `description` 内容；若 `description` 也为空则展示「待拍板事项」
- 每个待拍板卡片内含「通过」和「否决」两个按钮（纯 UI，点击无后端调用）

**manual:bash 验收命令**:
```bash
BRAIN_URL=http://localhost:5221

# 检查 decisions API 返回结构
curl -s "${BRAIN_URL}/api/brain/decisions?status=pending&limit=5" \
  | jq '.items[] | {id, title, description}' 2>/dev/null || \
  curl -s "${BRAIN_URL}/api/brain/decisions?limit=5" \
  | jq '.items[0:3] | .[] | {id, title, description}'
```

---

### [BEHAVIOR-3] 对话页发送消息不永久停留加载态

**触发条件**: 用户进入对话面板，列表为空或 fetch 超时时  
**可观测结果**:
- `fetchMessages` 调用有 10s AbortController 超时保护
- 超时或 fetch 失败后，不再显示「加载中…」
- 消息列表为空时，显示「暂无消息，发送第一条吧」
- 等待不超过 30s，页面必须脱离「加载中…」状态

**manual:bash 验收命令**:
```bash
# 验证 ConversationsPanel.tsx 中有 AbortController 超时代码
grep -n "AbortController\|setTimeout\|abort\|暂无消息" \
  /workspace/apps/dashboard/src/pages/warroom/ConversationsPanel.tsx
```

---

### [BEHAVIOR-4] 全貌页顶部显示四格数字行

**触发条件**: 用户访问 `/strategist` 主页  
**可观测结果**:
- 顶栏下方有四个数字区块：Features数 / GP数 / 决策数 / 在干活数
- 四格数字从 Brain API 并发实时拉取（非硬编码）
- GP数与 `/api/brain/golden-paths` 实际条目数误差 ≤ 5%
- 决策数与 `/api/brain/decisions?status=active` 实际条目数误差 ≤ 5%

**manual:bash 验收命令**:
```bash
BRAIN_URL=http://localhost:5221

echo "=== GP 数 ==="
curl -s "${BRAIN_URL}/api/brain/golden-paths?limit=1" | jq '.total // (.items | length)'

echo "=== 决策数（active） ==="
curl -s "${BRAIN_URL}/api/brain/decisions?status=active&limit=1" | jq '.total // (.items | length)'

echo "=== 在干活数（in_progress） ==="
curl -s "${BRAIN_URL}/api/brain/tasks?status=in_progress&limit=1" | jq '.total // (.items | length)'

echo "=== Features 数 ==="
curl -s "${BRAIN_URL}/api/brain/features?limit=1" 2>/dev/null | jq '.total // (.items | length)' || \
  echo "features endpoint - check actual endpoint path"
```

---

### [BEHAVIOR-5] 线列表不含 smoke 行

**触发条件**: 用户访问 `/strategist`，`fetchLines` 加载 areas 数据  
**可观测结果**:
- 页面线列表不出现名称匹配 `/^\[smoke\]/i` 的条目
- 页面线列表不出现名称匹配 `/^gp-agg-smoke/i` 的条目
- 其余真实业务线正常渲染

**manual:bash 验收命令**:
```bash
BRAIN_URL=http://localhost:5221

# 查看 areas API 中有多少 smoke 行（应被过滤）
curl -s "${BRAIN_URL}/api/brain/areas?include_lines=true&limit=50" \
  | jq '[.items[]?.lines[]? | select(.name | test("^\\[smoke\\]|^gp-agg-smoke"; "i"))] | length' \
  2>/dev/null || \
  curl -s "${BRAIN_URL}/api/brain/areas" \
  | jq 'if type == "array" then [.[]?.lines[]? | select(.name | test("^\\[smoke\\]|^gp-agg-smoke"; "i"))] | length else "check response format" end'
```

---

### [BEHAVIOR-6] 已有页签无回归

**触发条件**: 全貌/规划/晨报/投入页签被访问  
**可观测结果**:
- 四个已有页签渲染无 JS 报错
- 页签内容与修改前一致（无空白、无崩溃）

**manual:bash 验收命令**:
```bash
# 验证源文件存在且无语法错误（TypeScript 编译）
cd /workspace && npx tsc --noEmit --project apps/dashboard/tsconfig.json 2>&1 | head -20
```

---

## DoD Checklist

| 项 | 标准 | 验证方式 |
|----|------|----------|
| Fix-1 完成 | `PlaceholderTab` 在要素页签处被 `ElementsTab` 替换 | grep 代码 + AC-1 E2E |
| Fix-2 完成 | `DecisionTab` UUID 降级逻辑 + A/B 按钮 | grep 代码 + AC-2 E2E |
| Fix-3 完成 | `fetchMessages` 含 AbortController 10s 超时 + 空态文字 | grep 代码 + AC-3 E2E |
| Fix-4 完成 | `StrategistPage` 含 PanoNums 四格组件 | grep 代码 + AC-4 E2E |
| Fix-5 完成 | `fetchLines` 含 `.filter()` smoke 过滤 | grep 代码 + AC-5 E2E |
| E2E 五条全绿 | AC-1~AC-5 Playwright 全通过 | CI mac_web runner |
| 截图存档 | `screenshots/ac{1-5}-*.png` 进 PR diff | git diff --stat |
| 无回归 | 全貌/规划/晨报/投入页签正常 | [BEHAVIOR-6] |
| CI 绿 | `workspace-ci.yml` 通过 | GitHub Actions |
| TypeScript 编译无错 | `tsc --noEmit` 无错误 | [BEHAVIOR-6] 命令 |

---

## 不合格判定（自动 BLOCK）

以下任意一条不满足即视为 BLOCKED：
1. `StrategistLinePage.tsx` L1093 仍使用 `PlaceholderTab` 渲染要素页签
2. 要素页出现「建设中」或「敬请期待」字样
3. 任何待拍板卡片标题显示裸 UUID
4. 全貌页无数字行（缺失 Features/GP/决策/任务 四格中任意一格）
5. 线列表中出现 smoke 行名称
6. ConversationsPanel `fetchMessages` 无超时保护（无 AbortController）
