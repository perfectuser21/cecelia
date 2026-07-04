# Contract Draft: relay-runs 响应补裁决与成本字段

**Sprint Dir**: `sprints/07041845-relay-runs-verdicts/`
**Task ID**: `8aadc072-3367-4748-94bd-43578786548a`
**Branch**: `cp-07041834-ws-8aadc072`
**Date**: 2026-07-04
**Sprint**: N4 run-3（relay-runs-verdicts）

---

## Golden Path

### GP-1（列表端点新字段）
- 触发：`GET /api/brain/orchestrator/relay-runs`
- 期望：响应 JSON 数组，每个元素均含 `evaluate_verdict`、`judge_verdict`、`cost_usd`、`completed_at`、`failure_reason` 五个键
- 无值字段：返回 `null`（键必须存在，不得缺省）

### GP-2（详情端点补 cost_usd）
- 触发：`GET /api/brain/orchestrator/relay-runs/<initiative_id>`（存在的 id）
- 期望：响应 JSON 对象含 `cost_usd`（及已有的 `evaluate_verdict`、`judge_verdict`、`completed_at`、`failure_reason`）
- 无值字段：返回 `null`

### GP-3（回归：既有行为不变）
- 触发：所有既有请求模式（不带新字段的查询、`?phase=`、`?limit=`、错误请求）
- 期望：既有响应格式、状态码、过滤逻辑、错误格式完全不变

---

## Invariants

| ID | 断言 | 覆盖铁律 |
|----|------|---------|
| INV-1 | 响应字段名与 DB 列名完全一致（snake_case，无 camelCase 转换） | 铁律1 |
| INV-2 | 既有字段（`id/initiative_id/phase/started_at/deadline_at/orchestrator_heartbeat_at/orchestrator_host/pr_url`）必须保留 | 向后兼容 |
| INV-3 | `?phase=` / `?limit=` 过滤逻辑不变，ALLOWED_PHASES 枚举不扩展，limit 校验规则不变 | 铁律3 |
| INV-4 | DB 失败仍返回 HTTP 500 + `{ error: string }` JSON，不崩进程 | 铁律4 |
| INV-5 | 不带 `?phase` 时 SQL 不含 phase 过滤条件 | 既有断言 |
| INV-6 | 五个新字段无值时响应为 `null`，不得 omit 键（键必须出现在响应中） | 铁律2 |
| INV-7 | 列表端点 pr_url 回退路径（colErr 分支）时，其他四个新字段仍然出现在响应中 | 健壮性 |
| INV-8 | 所有状态码（200/400/404/500）的响应 Content-Type 均为 `application/json` | 铁律4 |

---

## [BEHAVIOR] 测试命令

```bash
# 单元测试（新增合同测试）
cd /workspace && npx vitest run packages/brain/src/__tests__/relay-runs-verdicts.test.js

# 回归测试（既有测试全绿）
cd /workspace && npx vitest run packages/brain/src/__tests__/relay-runs.test.js packages/brain/src/__tests__/relay-runs-filter.test.js

# 完整 brain 测试套件
cd /workspace && npx vitest run packages/brain/src/__tests__/
```

---

## [ARTIFACT] 产物

| 文件 | 类型 | 状态 |
|------|------|------|
| `packages/brain/src/routes/initiatives.js` | 实现（SELECT 扩展） | 待修改 |
| `packages/brain/src/__tests__/relay-runs-verdicts.test.js` | 合同测试 | 已生成 |
| `sprints/07041845-relay-runs-verdicts/contract-draft.md` | 本文件 | 已生成 |
| `sprints/07041845-relay-runs-verdicts/contract-dod.md` | DoD 断言清单 | 已生成 |

---

## E2E 验收

验收项目（按铁律顺序）：

1. **[INV-1/FR-10~14] 列表含五新字段**
   ```bash
   curl -s http://localhost:5221/api/brain/orchestrator/relay-runs | \
     jq '.[0] | keys' | grep -E 'evaluate_verdict|judge_verdict|cost_usd|completed_at|failure_reason'
   # 期望：输出五个字段名
   ```

2. **[INV-6] null 语义：字段存在但值为 null**
   ```bash
   curl -s http://localhost:5221/api/brain/orchestrator/relay-runs | \
     jq '.[0] | has("evaluate_verdict") and has("judge_verdict") and has("cost_usd") and has("completed_at") and has("failure_reason")'
   # 期望：true
   ```

3. **[FR-15] 详情端点含 cost_usd**
   ```bash
   curl -s http://localhost:5221/api/brain/orchestrator/relay-runs/<initiative_id> | \
     jq 'has("cost_usd")'
   # 期望：true
   ```

4. **[INV-3] 回归：?phase= 过滤不变**
   ```bash
   curl -s "http://localhost:5221/api/brain/orchestrator/relay-runs?phase=invalid_xyz" | jq '.allowed | length'
   # 期望：10
   ```

5. **[INV-8] Content-Type 验证**
   ```bash
   curl -si http://localhost:5221/api/brain/orchestrator/relay-runs | grep -i content-type
   # 期望：application/json
   ```
