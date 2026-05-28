# Sprint PRD — Brain /api/brain/health 新增 codex_bridge_status 字段

## OKR 对齐

- **对应 KR**：Cecelia Harness Pipeline 稳定性 KR
- **当前进度**：进行中
- **本次推进预期**：HARNESS_XIAN_ENABLED 路径可观测性增强

## 背景

HARNESS_XIAN_ENABLED=true 时 spawn 节点走 xian-m4 Codex Bridge，但 /api/brain/health 端点没有 bridge 在线状态字段，运维无法通过 health 接口判断路由是否可用。

## Golden Path（核心场景）

运维 / Brain Tick 从 `GET /api/brain/health` → 响应中读取 `codex_bridge_status` → 判断 xian-m4 bridge 是否 online。

具体：
1. 调用方发送 `GET /api/brain/health`
2. Brain 对 `XIAN_CODEX_BRIDGE_URL`（默认 `http://100.86.57.69:3458`）发起探活请求（超时 2s）
3. 探活成功 → `codex_bridge_status: "online"`；探活失败/超时 → `codex_bridge_status: "offline"`
4. 无论 HARNESS_XIAN_ENABLED 的值，该字段始终出现在响应中

## Response Schema

### Endpoint: GET /api/brain/health

**Success (HTTP 200)** — 在现有字段基础上新增 `codex_bridge_status`：
```json
{
  "status": "healthy|degraded",
  "codex_bridge_status": "online|offline",
  "uptime_seconds": 1234,
  "organs": {}
}
```
- `codex_bridge_status` (string, 必填): 字面量 `"online"` 或 `"offline"`
- **禁用变体**：`up`/`down`/`ok`/`reachable`/`active`/`unavailable`

**Error (HTTP 500)**:
```json
{"status": "error", "error": "<string>"}
```

## 边界情况

- bridge URL 环境变量未设置 → 用默认值 `http://100.86.57.69:3458`
- 探活超时（>2s）→ `"offline"`
- 探活返回非 2xx → `"offline"`
- bridge 探活本身 throw → catch，`"offline"`，不影响整体 health 响应

## 范围限定

**在范围内**：
- `packages/brain/src/routes/goals.js` `/health` 路由新增探活逻辑 + 字段
- 单元测试（mock fetch）验证 online/offline 两态

**不在范围内**：
- 不修改顶层 `status` 的降级规则（bridge offline 不触发 degraded）
- 不新增独立 bridge health 端点
- 不修改 HARNESS_XIAN_ENABLED 路由逻辑

## 假设

- [ASSUMPTION: bridge 探活目标 URL 为 `XIAN_CODEX_BRIDGE_URL/accounts`，与 credentials-health-scheduler.js 保持一致]
- [ASSUMPTION: 探活失败不导致整体 health degraded，仅字段值变为 offline]

## 预期受影响文件

- `packages/brain/src/routes/goals.js`: `/health` 路由新增 codex_bridge_status 探活
- `packages/brain/src/__tests__/integration/critical-routes.integration.test.js` 或新建单元测试: 验证字段存在且为 online|offline

## journey_type: autonomous
## journey_type_reason: 仅涉及 packages/brain/ 后端路由逻辑，无 UI 交互
## target_environment: local_api
## target_environment_reason: 纯 Brain 后端改动，curl localhost:5221/api/brain/health + 本地 Jest 单元测试验收
