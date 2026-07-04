# Sprint PRD: relay-runs 过滤与详情

**Sprint**: 07041800-relay-runs-filter
**Task ID**: c66bbedc-5804-4d53-9eb9-4385d0b8d325
**Journey ID**: bb8cc561-b3ee-4fec-b74d-2255694bd963
**Target Environment**: local_api
**日期**: 2026-07-04

---

## Golden Path

### GP-1：按 phase 过滤列表
```
GET /api/brain/orchestrator/relay-runs?phase=A_planning
→ 200 JSON 数组，每条 orchestrator_version='v2' 且 phase='A_planning'
```

### GP-2：查单条 run 详情
```
GET /api/brain/orchestrator/relay-runs/<initiative_id>
→ 200 JSON 对象，含 failure_reason / completed_at 等完整字段
```

### GP-3：查不存在的 initiative_id
```
GET /api/brain/orchestrator/relay-runs/nonexistent-id
→ 404 { "error": "not found" }
```

---

## Response Schema

### 列表端点 `GET /relay-runs`（含原有字段 + 新增过滤）
```json
[
  {
    "id": "uuid",
    "initiative_id": "uuid",
    "phase": "string",
    "orchestrator_heartbeat_at": "timestamp | null",
    "orchestrator_host": "string | null",
    "pr_url": "string | null",
    "started_at": "timestamp",
    "deadline_at": "timestamp | null"
  }
]
```
支持查询参数：
- `?limit=N`（已有，默认 20，最大 100，正整数）
- `?phase=<value>`（新增，枚举值过滤，非枚举值 → 400）

### 详情端点 `GET /relay-runs/:initiative_id`（完整字段）
```json
{
  "id": "uuid",
  "initiative_id": "uuid",
  "phase": "string",
  "started_at": "timestamp",
  "deadline_at": "timestamp | null",
  "completed_at": "timestamp | null",
  "failure_reason": "string | null",
  "orchestrator_version": "string",
  "orchestrator_heartbeat_at": "timestamp | null",
  "orchestrator_host": "string | null",
  "orchestrator_pid": "integer | null",
  "pr_url": "string | null",
  "round": "integer | null",
  "evaluate_verdict": "string | null",
  "judge_verdict": "string | null"
}
```

### 错误响应（统一格式）
```json
{ "error": "描述字符串" }
// 400 时附加：
{ "error": "...", "allowed": ["A_planning", "A_contract", ...] }
```

---

## Invariant 约束

**INV-1 phase 枚举铁律**
`?phase=` 仅接受 migration 312 CHECK 约束内的值：
`'A_planning','A_contract','B_task_loop','C_final_e2e','done','failed','planning','gan','generate','evaluate'`
传枚举外任意值 → 400 + `{ error, allowed: [...] }`。
单测必须钉定枚举白名单与 migration CHECK 一致，两者不能分叉。

**INV-2 只读铁律**
两个端点均为 GET，不得有任何写库操作（INSERT/UPDATE/DELETE）。

**INV-3 JSON 格式铁律**
所有响应（2xx/4xx/5xx）Content-Type 均为 `application/json`，body 为合法 JSON，不返回 HTML/纯文本。

**INV-4 404 不泄露内部信息**
`initiative_id` 不存在时只返回 `{ "error": "not found" }`，不暴露 SQL 错误或表结构。

**INV-5 列表端点向后兼容**
已有 `?limit` 行为不变；不带 `?phase=` 时返回全部 v2 runs（行为不变）。

---

## 累积 FR（Feature Registry）

| FR | 描述 | 状态 |
|----|------|------|
| FR-1 | `GET /relay-runs` 支持 `?limit=N`（默认 20，最大 100，非正整数 → 400） | 已有 |
| FR-2 | `GET /relay-runs` 仅返回 `orchestrator_version='v2'` 的记录，按 `started_at DESC` 排序 | 已有 |
| FR-3 | `GET /relay-runs?phase=<value>` 按 phase 枚举过滤（非枚举值 → 400 + allowed 列表） | 新增 |
| FR-4 | `GET /relay-runs/:initiative_id` 返回单条完整详情（含 failure_reason/completed_at 等） | 新增 |
| FR-5 | `GET /relay-runs/:initiative_id` 查不存在的 id → 404 + `{ error }` | 新增 |

---

## 不包含

- 不做任何 UI 展示
- 不改动列表端点已有响应字段
- 不支持 phase 以外的其他字段过滤（本次范围）
- 不做分页（cursor/offset），limit 已满足当前需求
