# Sprint PRD — Brain↔Notion 属性映射修复（R2 重发）

## OKR 对齐

- **对应 KR**：Cecelia Harness Pipeline 稳定性 KR
- **当前进度**：Deterministic Gate 第 7/7 条执行中
- **本次推进预期**：三处持续 400 清零，Notion 写入路径稳定

## 背景

2026-06-10 Notion schema 重构后，Brain 三处推送引用了已不存在的属性名，在生产日志持续报 400。前次 run（c0e2546b）合同质量过关，因 serial gate resume 误判（#3356 已修）重发。

## Golden Path（核心场景）

系统从 [Brain API 推送调用] → 经过 [属性名校验 + 未知属性剔除 + warn] → 到达 [Notion 真实页面创建成功 / 优雅降级]

具体步骤：

1. **Proposer 先实查 Notion API**：GET 三个目标 DB 的当前 schema，把真实属性名清单落成映射配置（含查询日期注释），作为修复依据——禁止猜测属性名
2. **POST /api/brain/notes（带 initiative_id）→ 200**：关联关系按新 schema 写入；若该 DB 确无对应关系属性则自动剔除该字段，响应含 `warnings` 数组说明跳过项；API GET 返回页面真实存在
3. **POST /api/brain/notion/task → 200**：Title 字段按新属性名写入，API GET 可访问真实页面
4. **触发 notion-push-sync（手动入口或 tick 日志）**：step_link 推送不再出现 "is not a property" 错误
5. **负向场景**：payload 带一个故意未知属性 → 不 500/502，降级成功，日志与 API 响应均含 warning 留痕

## 边界情况

- 三个目标 DB 可能是同一个或不同 DB，由 proposer 实查确认
- Notion API 网络超时 → 不应级联导致 Brain API 500，应返回 502/503 + 明确 error message
- 映射配置缺字段时的 fallback 策略：剔除该字段 + warn，不中断整体调用

## 范围限定

**在范围内**：
- POST /api/brain/notes 的 initiative_id 属性映射修复
- POST /api/brain/notion/task 的 Title 属性映射修复
- notion-push-sync 的 step_link/Order 属性映射修复
- 三处共用的统一"剔除+warn"未知属性策略
- 单测覆盖映射降级逻辑

**不在范围内**：
- 其他 Notion 同步路径（未在 PrepPRD 列出的）
- Notion schema 结构本身的改动
- 前端 Dashboard 展示

## 假设

- [ASSUMPTION: 三个修复点所在 DB 的真实属性名须由 proposer 在 Step 1.1 通过 Notion API 实查确认，本 PRD 不预填属性名]
- [ASSUMPTION: Brain 已配置有效 Notion token，proposer 直接使用现有机制，不需要新增凭据]
- [ASSUMPTION: E2E 测试页面统一前缀 [contract-e2e]，验收结束后 API PATCH archived=true 归档]

## 预期受影响文件

- `packages/brain/src/notion-push-sync.js`：step_link/Order 属性修复
- `packages/brain/src/server.js`（或 notes/task 路由文件）：initiative_id、Title 属性修复
- 新增或修改统一属性映射配置（单一映射表，三处共用）

## E2E 验收

> Planner 初稿此区块留自然语言描述，最终可执行脚本由 proposer 在 GAN 阶段按 target_environment=local_api 产出（curl+psql+jq-e pipeline）。

```bash
# 占位：proposer 将填入真实脚本（local_api → curl+psql+jq-e pipeline）
# 期望验收点（自然语言）：
# 1. POST /api/brain/notes（带 initiative_id）→ 状态码 200，响应含 notion_url，GET 该 url 200
# 2. POST /api/brain/notion/task → 状态码 200，响应含 notion_url，GET 该 url 200
# 3. notion-push-sync 触发后，Brain 日志不含 "is not a property"（grep 断言）
# 4. 带未知属性的 POST → 状态码 200 或 207，响应 warnings 数组含跳过字段名（jq -e 断言）
# 5. E2E 末尾：PATCH archived=true 归档全部 [contract-e2e] 测试页面，状态码 oracle 200 断言
# 合同提示：curl 断言优先写进同一 pipeline（| jq -e）；状态码 oracle 用 -w %{http_code} + 码断言；
#           可达性探测等弱断言场景用 gate-allow: <rule-id> <理由> 豁免留痕
```

## journey_type: autonomous
## journey_type_reason: 纯 packages/brain/ 后端 API 修复，无 UI / agent 协议 / engine hooks 涉及
## target_environment: local_api
## target_environment_reason: curl localhost:5221 + psql 本地 evaluator 验证，Brain 内部 API sprint
## journey_id: <来源 task.payload.journey_id — Cecelia Harness Pipeline Journey>
## step_id: <来源 PrepPRD 锚定 — Deterministic Gate 7/7>
