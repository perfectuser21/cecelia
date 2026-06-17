# Sprint PRD — Harness Pipeline Cockpit · Phase 1（TaskPrdPage 显示完整 PrepPRD）

## OKR 对齐

- **对应 KR**：Harness Pipeline 可观测性（每个 pipeline 全程可见 cockpit 的第一刀）
- **当前进度**：cockpit 雏形（TaskPrdPage 已存在但只显示短摘要）
- **本次推进预期**：让 PRD 页显示真正的完整 PrepPRD，打通 cockpit「内容可见」的第一块

## 背景

Dashboard 从 PR body「📋 PRD」点进来的 `apps/dashboard/src/pages/tasks/TaskPrdPage.tsx` 是 cockpit 的雏形。当前 `pickPrdContent` 只读 `description / prd_content / payload.prd_summary`——全是短摘要或 null，**没读 Harness 真正存 PrepPRD 全文的字段 `payload.prep_prd_body`**；且用 `<pre>` 渲染 Markdown，无格式。本次为 4-Phase cockpit 整体的 thin 第一刀，Phase 2-4 后续 Run。

## Golden Path（核心场景）

用户从 [Dashboard PR body「📋 PRD」链接] → [打开某 harness task 的 PRD 页] → [看到完整且有格式的 PrepPRD 全文]

具体：
1. 用户点开一个 harness task 的 PRD 页（TaskPrdPage）
2. 系统读取 `task.payload.prep_prd_body`（完整 PrepPRD Markdown）；该字段为空时退回旧字段（`description / prd_content / payload.prd_summary`）
3. 页面以 **Markdown 渲染**显示完整 PrepPRD：含 Golden Path、前置、验收等全文，标题/列表/表格按格式呈现（不是 `<pre>` 纯文本）

## 边界情况

- `payload.prep_prd_body` 不存在或为空 → 退回旧字段，页面仍能显示已有内容（不报错、不空白）
- PrepPRD 含表格/嵌套列表/代码块 → 均按 Markdown 正确渲染

## 范围限定

**在范围内**：
- `pickPrdContent` 优先读 `task.payload.prep_prd_body`，再退回旧字段
- Task 类型 `payload` 增加 `prep_prd_body?: string`
- 用 Markdown 渲染替换 `<pre>`（dashboard 加 Markdown 渲染依赖，如 react-markdown 或已有 md 库）
- 先写 failing test 再实现

**不在范围内**：
- Phase 2 全生命周期左侧栏（PrepPRD/PRD/Contract/DoD/决策/留痕/Report 逐项）
- Phase 3 决策面板、Gate 1 决策扫描、「再来一轮」无头红队、点火端点
- Phase 4 Gate 2 闭环、题库

## 假设

- [ASSUMPTION: harness task 的完整 PrepPRD 已存于 `task.payload.prep_prd_body`（由 Harness 写入），本次只负责读取与渲染，不改写入侧]
- [ASSUMPTION: dashboard 现有依赖中若无 Markdown 渲染库，则新增 react-markdown]

## 预期受影响文件

- `apps/dashboard/src/pages/tasks/TaskPrdPage.tsx`：`pickPrdContent` 读取优先级 + `<pre>` 换 Markdown 渲染
- Task 类型定义（dashboard 内 task/payload 类型）：`payload` 加 `prep_prd_body?: string`
- `apps/dashboard/package.json`：若需新增 Markdown 渲染依赖
- dashboard 测试文件：新增 failing test 验证 prep_prd_body 优先读取 + Markdown 格式渲染

## E2E 验收

> Planner 初稿留占位，最终可执行 Playwright 脚本由 proposer 在 GAN 阶段按 target_environment=mac_web 产出。

```bash
# 占位：proposer 将填入 mac_web Playwright 脚本（localhost:5174）
# 期望验收点（自然语言）：
#   打开一个含 payload.prep_prd_body 的 harness task PRD 页 →
#   页面显示完整 PrepPRD 全文（能找到 Golden Path / 前置 / 验收 等小节标题文字）→
#   且为 Markdown 渲染（DOM 中存在 <h1>/<h2>/<ul>/<table> 等元素，而非单一 <pre> 纯文本）。
```

## journey_type: user_facing
## journey_type_reason: 涉及 apps/dashboard/ 前端页面（TaskPrdPage），命中 user_facing 优先级链第一条
## target_environment: mac_web
## target_environment_reason: Cecelia Dashboard Web UI，本机 Playwright 打开 localhost:5174 验证 PRD 页渲染
## journey_id: <来源 task.payload.journey_id（缺则 = Cecelia "Harness Pipeline" 唯一 Line）>
## step_id: <cockpit Phase 1 — TaskPrdPage 显示完整 PrepPRD（来源 PrepPRD Golden Path 锚定）>
