# Sprint PRD — harness initiative_runs 列表查询 API（B48 诊断）

## OKR 对齐

- **对应 KR**：Cecelia harness pipeline 可观测性与稳定性
- **本次推进预期**：B48 修复后，操作员可通过 API 实时验证 initiative_runs.phase 未被误标为 done

## 背景

B48（#3209）修复了 harness graph interrupt 时 computeHarnessInitiativeOk 误标 completed 的问题。  
当前 `/api/brain/harness/initiative-runs/:id` 仅支持按单个 initiative_id 查最新一条 run，  
无法列出全部 run 并按 phase/状态过滤，无法快速诊断是否有 run 处于异常已完成状态。  
本 sprint 新增列表查询端点，使 B48 类问题可被操作员主动检测。

## Golden Path（核心场景）

操作员调用 `GET /api/brain/harness/initiative-runs?limit=20` →  
经过 Brain API 查询 initiative_runs 表 →  
返回最近 20 条 run 记录，含 phase、timing、failure_reason、journey_type。

具体：
1. `GET /api/brain/harness/initiative-runs` 无过滤，返回最近 50 条（默认）
2. `GET /api/brain/harness/initiative-runs?phase=done&limit=10` 返回 phase=done 的最近 10 条
3. `GET /api/brain/harness/initiative-runs?journey_id=<uuid>` 返回指定 journey 的全部 run

## Response Schema

### Endpoint: GET /api/brain/harness/initiative-runs

**Query Parameters**：
- `limit`（可选，整数，默认 50，最大 100）
- `phase`（可选，字符串，精确匹配 initiative_runs.phase）
- `journey_id`（可选，UUID，过滤 journey_id 字段）

**Success (HTTP 200)**:
```json
{
  "runs": [
    {
      "id": "uuid",
      "initiative_id": "uuid",
      "phase": "done",
      "journey_type": "autonomous",
      "journey_id": "uuid-or-null",
      "created_at": "2026-05-31T10:00:00.000Z",
      "completed_at": "2026-05-31T10:30:00.000Z",
      "deadline_at": "2026-05-31T16:00:00.000Z",
      "failure_reason": null,
      "cost_usd": 0.42
    }
  ],
  "total": 20
}
```

**字段约束**：
- `runs` 数组，按 `created_at DESC` 排序
- `total` = 实际返回条数（非全表计数，避免性能问题）
- `failure_reason` 为 null 或字符串
- `cost_usd` 为 number 或 null
- 不返回 `contract_id`、`current_task_id`、`merged_task_ids`（这些属于 initiative detail）

**Error (HTTP 400)**：`{ "error": "invalid limit: must be integer 1-100" }`  
**Error (HTTP 400)**：`{ "error": "invalid journey_id: must be a UUID" }`

## 边界情况

- `limit` 非整数或超出范围 → 400
- `journey_id` 不是合法 UUID → 400
- `phase` 为空字符串 → 忽略该过滤条件（等价于无 phase 过滤）
- 结果为空 → `{"runs": [], "total": 0}`（不返回 404）
- initiative_runs 表为空 → 正常返回空列表

## E2E 验收断言

1. `GET /api/brain/harness/initiative-runs` 响应 HTTP 200，body 含 `runs` 数组和 `total` 数字
2. `GET /api/brain/harness/initiative-runs?phase=done` 响应中 runs 每条的 `phase` 字段均为 `"done"`
3. `GET /api/brain/harness/initiative-runs?limit=abc` 响应 HTTP 400
4. `GET /api/brain/harness/initiative-runs?journey_id=not-a-uuid` 响应 HTTP 400
5. 空结果时 `runs` 为 `[]`，`total` 为 `0`

## 范围限定

**在范围内**：`packages/brain/src/routes/harness.js` 新增 `GET /initiative-runs` 路由（列表查询）  
**不在范围内**：initiative_runs 的写入逻辑、executor、现有 `GET /initiative-runs/:id` 单条查询、前端 Dashboard UI、initiative_runs 聚合统计

## 假设

- [ASSUMPTION: initiative_runs 表已存在，含 phase/journey_id/journey_type/cost_usd/failure_reason 字段]
- [ASSUMPTION: packages/brain/src/routes/harness.js 已挂载到 /api/brain/harness 前缀]
- [ASSUMPTION: UUID 校验使用现有 UUID_RE 正则]

## 预期受影响文件

- `packages/brain/src/routes/harness.js`：新增 `GET /initiative-runs` 路由

## journey_type: autonomous
## journey_type_reason: 纯 Brain API 端点，无 UI、无外部 agent 协议、无平台写入
## target_environment: brain
## target_environment_reason: 调用 Brain localhost:5221，在 Brain 集成测试中验证路由响应

{"verdict":"DONE","sprint_dir":"sprints/cecelia-harness-runs-api"}
