# Sprint PRD: relay-runs 响应补裁决与成本字段

**Sprint Dir**: `sprints/07041845-relay-runs-verdicts/`
**Task ID**: `8aadc072-3367-4748-94bd-43578786548a`
**Branch**: `cp-07041834-ws-8aadc072`
**Date**: 2026-07-04
**Sprint**: N4 run-3（relay-runs-verdicts）

---

## 背景

`GET /api/brain/orchestrator/relay-runs`（列表）与 `GET /api/brain/orchestrator/relay-runs/:initiative_id`（详情）端点已在前两个 sprint（N3/N4）实现并通过 CI。

本次 sprint（run-3）目标：将 `initiative_runs` 表中已有但响应中缺少的五个字段追加到两个端点响应对象：

| 字段 | DB 列 | 来源 migration |
|------|-------|---------------|
| `evaluate_verdict` | `initiative_runs.evaluate_verdict` | migration 312 |
| `judge_verdict` | `initiative_runs.judge_verdict` | migration 312 |
| `cost_usd` | `initiative_runs.cost_usd` | migration 238 |
| `completed_at` | `initiative_runs.completed_at` | migration 238 |
| `failure_reason` | `initiative_runs.failure_reason` | migration 238 |

---

## 现状分析

**列表端点** (`routes/initiatives.js` → `router.get('/relay-runs', ...)`):
- 当前 SELECT 字段：`id, initiative_id, phase, orchestrator_heartbeat_at, orchestrator_host, pr_url, started_at, deadline_at`
- **缺少**：`evaluate_verdict, judge_verdict, cost_usd, completed_at, failure_reason`

**详情端点** (`router.get('/relay-runs/:initiative_id', ...)`):
- 当前 SELECT 字段：`id, initiative_id, phase, started_at, deadline_at, completed_at, failure_reason, orchestrator_version, orchestrator_heartbeat_at, orchestrator_host, orchestrator_pid, pr_url, round, evaluate_verdict, judge_verdict`
- **缺少**：`cost_usd`

**结论**：改动范围极小 —— 列表端点 SELECT 追加 5 列，详情端点 SELECT 追加 1 列（`cost_usd`）。不改 DB、不加端点、不做聚合。

---

## Golden Path

1. **GP-1（列表）**：`curl /api/brain/orchestrator/relay-runs` → 响应数组每项含 `evaluate_verdict、judge_verdict、cost_usd、completed_at、failure_reason`（无值为 null）
2. **GP-2（详情）**：`curl /api/brain/orchestrator/relay-runs/<initiative_id>` → 响应对象含全部五字段
3. **GP-3（回归）**：既有字段、过滤行为（`?phase=`/`?limit=`）、错误响应格式不变

---

## 不包含

- 不新增端点
- 不修改 DB schema（不加列、不加索引、不改约束）
- 不做聚合统计
- 不改 `evaluate_verdict` / `judge_verdict` 值域逻辑

---

## 文件变更范围

**唯一改动文件**：`packages/brain/src/routes/initiatives.js`

1. **列表端点 SQL**（`router.get('/relay-runs', ...)`）：
   - 主路径 SELECT 追加 `evaluate_verdict, judge_verdict, cost_usd, completed_at, failure_reason`
   - 回退路径（pr_url 列不存在时）同步追加同五列（其中 pr_url 回退路径不含 pr_url，其他四列正常追加）

2. **详情端点 SQL**（`router.get('/relay-runs/:initiative_id', ...)`）：
   - SELECT 追加 `cost_usd`

**测试文件**：`packages/brain/src/__tests__/relay-runs-verdicts.test.js`（新建）

---

## Invariant 约束

| ID | 约束 | 来源 |
|----|------|------|
| INV-1 | 响应字段名必须与 DB 列名完全一致（不做 camelCase 转换） | PrepPRD 铁律 |
| INV-2 | 既有字段（id/initiative_id/phase/started_at/deadline_at/orchestrator_heartbeat_at/orchestrator_host/pr_url）必须保留，不得移除 | 向后兼容 |
| INV-3 | `?phase=` / `?limit=` 过滤逻辑不变（ALLOWED_PHASES 枚举不扩展、limit 校验规则不变） | 回归保护 |
| INV-4 | DB 失败仍返回 HTTP 500 + `{ error: string }` JSON，不崩进程 | 既有错误协议 |
| INV-5 | 不带 `?phase` 时 SQL 不含 phase 过滤条件（向后兼容） | 既有测试断言 |
| INV-6 | `evaluate_verdict`/`judge_verdict` 无值时响应为 `null`，不得 omit 键 | null 语义 |
| INV-7 | 列表端点 pr_url 回退路径（colErr 分支）存在时，其他四个新字段仍然出现 | 健壮性 |
| INV-8 | 所有响应 Content-Type: application/json | 既有铁律3 |

**Invariant 数量：8**

---

## 累积 FR

| FR-ID | 描述 | 端点 | 状态 |
|-------|------|------|------|
| FR-01 | 列表返回 v2 initiative_runs，按 started_at DESC | `/relay-runs` | ✅ 已实现（N3） |
| FR-02 | `?limit=N` 参数控制返回数量，默认 20，最大 100 | `/relay-runs` | ✅ 已实现（N3） |
| FR-03 | `?limit` 非法值 → 400 + { error } | `/relay-runs` | ✅ 已实现（N3） |
| FR-04 | DB 失败 → 500 + { error } JSON | 两端点 | ✅ 已实现（N3） |
| FR-05 | `?phase=<value>` 过滤，ALLOWED_PHASES 枚举白名单（10项） | `/relay-runs` | ✅ 已实现（N4） |
| FR-06 | `?phase=invalid` → 400 + { error, allowed: [...] } | `/relay-runs` | ✅ 已实现（N4） |
| FR-07 | 不带 `?phase` 时不过滤，SQL 无 phase 条件 | `/relay-runs` | ✅ 已实现（N4） |
| FR-08 | `/:initiative_id` 详情：找到 → 200 + 对象 | `/relay-runs/:id` | ✅ 已实现（N4） |
| FR-09 | `/:initiative_id` 详情：不存在 → 404 + { error: "not found" } | `/relay-runs/:id` | ✅ 已实现（N4） |
| FR-10 | **[本次] 列表响应含 evaluate_verdict（null-able）** | `/relay-runs` | 🔴 待实现 |
| FR-11 | **[本次] 列表响应含 judge_verdict（null-able）** | `/relay-runs` | 🔴 待实现 |
| FR-12 | **[本次] 列表响应含 cost_usd（null-able）** | `/relay-runs` | 🔴 待实现 |
| FR-13 | **[本次] 列表响应含 completed_at（null-able）** | `/relay-runs` | 🔴 待实现 |
| FR-14 | **[本次] 列表响应含 failure_reason（null-able）** | `/relay-runs` | 🔴 待实现 |
| FR-15 | **[本次] 详情响应含 cost_usd（null-able，补全最后缺失字段）** | `/relay-runs/:id` | 🔴 待实现 |

**累积 FR 数量：15（已实现 9，本次新增 6）**

---

## 测试计划

### 新增单测（relay-runs-verdicts.test.js）

1. **列表端点新字段存在性**：mock DB 返回含五字段的行，断言响应每项均含 `evaluate_verdict/judge_verdict/cost_usd/completed_at/failure_reason`
2. **列表字段 null 语义**：mock DB 返回字段值为 null，断言响应键存在且值为 null（不得 omit）
3. **详情端点含 cost_usd**：mock DB 返回含 cost_usd 的行，断言响应含该字段
4. **SQL SELECT 包含新列**：断言 `mockPool.query.mock.calls[0][0]` 含 `cost_usd`/`evaluate_verdict`/`judge_verdict`/`completed_at`/`failure_reason`

### 既有测试必须全绿（回归）

- `packages/brain/src/__tests__/relay-runs.test.js`（N3 原始测试，8 条）
- `packages/brain/src/__tests__/relay-runs-filter.test.js`（N4 过滤测试，30+ 条）

---

## 验收标准（Final E2E）

- [ ] `curl /api/brain/orchestrator/relay-runs` 响应每项含五新字段（无值为 null）
- [ ] `curl /api/brain/orchestrator/relay-runs/<initiative_id>` 详情含 cost_usd 及其余四字段
- [ ] 新增单测断言字段存在与 null 语义全绿
- [ ] 既有 relay-runs + relay-runs-filter 测试保持全绿
- [ ] CI 全绿（brain-ci.yml）

---

## 风险评估

**低风险**：纯字段追加，无逻辑变更，无 schema 变更。唯一需注意：
- 列表端点有 pr_url 回退路径（内嵌 catch 分支），需同步追加新字段，否则回退路径响应不一致。
- `cost_usd` 在 migration 238 中类型为 `NUMERIC(8,2)`，PostgreSQL 返回字符串，前端如需数值类型请在路由层做 `Number()` 转换——但现有代码未做此转换，本次不引入差异行为，保持 DB 原样返回。
