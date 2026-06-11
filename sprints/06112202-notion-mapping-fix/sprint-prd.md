# Sprint PRD — Brain↔Notion 属性映射修复（notes/notion-task/step_link 三处 400）

## OKR 对齐

- **对应 KR**：Cecelia Harness Pipeline 稳定性（Deterministic Gate 第 7/7 条）
- **当前进度**：Gate 6/7 通过，本条为最终门禁
- **本次推进预期**：三处 Notion 推送 400 归零，harness report Notion 关联恢复

## 背景

Notion 模型 2026-06-10 重构后，Brain 三处推送引用属性已不存在，持续 400（生产日志实证）：
- `POST /api/brain/notes` 带 `initiative_id` → "Initiative ID is not a property"
- `POST /api/brain/notion/task` → "Title is not a property"
- `notion-push-sync` 的 `step_link` → "Order is not a property"

后台同步持续失败，harness report 的 Notion 关联缺失。

## Golden Path（核心场景）

系统从 [Brain 路由/定时同步触发] → 经过 [按新 schema 映射属性、未知属性剔除+warn] → 到达 [Notion 页面成功创建 or 优雅降级并返回 warnings]

1. **触发条件**：任一推送端点被调用（notes / notion-task / notion-push-sync tick）
2. **系统处理**：用 Notion API 实查目标 DB 当前属性清单，结果落为单一映射常量（注明查询日期）；按新 schema 构建 payload；未知属性自动剔除，不抛出
3. **可观测结果**：
   - 成功路径 → HTTP 200，响应含 `{url: "https://notion.so/...", warnings: []}`，GET 该 url 返回 200
   - 降级路径（payload 含未知属性）→ HTTP 200，响应含 `{url: ..., warnings: ["initiative_id skipped: not in schema"]}`，不 500/400

## 边界情况

- Payload 带故意未知属性 → 剔除 + warnings 数组，返回 200
- Notion API 超时 / 401 → 现有 error handler 处理，不在本次范围
- 属性名大小写：[ASSUMPTION: 映射常量 key 与 Notion 返回属性名精确匹配（大小写严格）]

## 范围限定

**在范围内**：
- `POST /api/brain/notes` 属性映射修复（initiative_id → 新 schema 属性名）
- `POST /api/brain/notion/task` 属性映射修复（Title → 新 schema 属性名）
- `notion-push-sync` step_link / Order 属性修复
- 三处共用单一映射常量 + 统一剔除函数
- 未知属性"剔除+warn"降级策略

**不在范围内**：
- Notion API 超时/限流/401 处理
- 映射表迁入数据库（本次为代码常量）
- Dashboard UI 变更

## 假设

- [ASSUMPTION: 映射常量以 JS 对象维护在 packages/brain/src/ 内，非外部配置文件]
- [ASSUMPTION: E2E 创建的测试页面统一加标题前缀 `[contract-e2e]`，脚本末尾调 Notion delete API 清理]
- [ASSUMPTION: warnings 在 HTTP 200 响应 body 中作为数组字段返回，降级时 url 可为 null]

## 预期受影响文件

- `packages/brain/src/routes/notes.js`（或同路径）：修复 initiative_id 属性映射
- `packages/brain/src/routes/notion-task.js`（或同路径）：修复 Title 属性映射
- `packages/brain/src/notion-push-sync.js`（或同路径）：修复 step_link / Order 映射
- `packages/brain/src/notion-property-map.js`（新建）：三处共用映射常量 + 剔除 warn 函数

## E2E 验收

> Planner 框定验收点；最终可执行脚本由 proposer 在 GAN 阶段产出（target_environment=local_api → bash curl）。

```bash
# 占位：proposer 按 target_environment=local_api 填入真实脚本
# 期望验收点（自然语言）：
# 1. POST localhost:5221/api/brain/notes 带 initiative_id → 200，响应含 notion url，GET 该 url 200
# 2. POST localhost:5221/api/brain/notion/task → 200，响应含 notion url，GET 该 url 200
# 3. 触发 notion-push-sync → 日志无 "is not a property" 字符串
# 4. POST 带故意未知属性 → 200，warnings 数组含跳过说明，无 500
# 5. E2E 末尾清理所有 [contract-e2e] 前缀的 Notion 测试页面
```

## journey_type: autonomous
## journey_type_reason: 全程 packages/brain/ 后端路由 + 定时同步修复，无 UI、无远端 agent 协议
## target_environment: local_api
## target_environment_reason: 仅需 curl localhost:5221 + 日志验证，无浏览器或 Windows 环境依赖
## journey_id: <来源 = task.payload.journey_id — Cecelia Harness Pipeline Journey>
## step_id: Deterministic Gate Step 7/7
