# Sprint PRD: relay-runs since 过滤（v1.2.0 eval-1）

**Task ID**: 61fd2e5c-4c79-4184-8584-cab426596846  
**Sprint Dir**: sprints/07042120-relay-runs-since  
**Date**: 2026-07-04  
**Branch**: cp-07042114-ws-61fd2e5c

---

## 目标

为 `GET /api/brain/orchestrator/relay-runs` 增加 `?since=<ISO8601>` 查询参数，只返回 `started_at >= since` 的 v2 runs。可与既有 `?phase=` 和 `?limit=` 参数自由组合。

---

## Invariant 约束

| 编号 | 约束描述 | 来源 |
|------|----------|------|
| INV-1 | 所有响应字段名保持 snake_case，与 DB 列名完全一致，禁止 camelCase 变体 | relay-runs-verdicts 合同 |
| INV-2 | 既有测试（relay-runs.test.js、relay-runs-filter.test.js、relay-runs-verdicts.test.js、relay-v101.test.js）**零改动保持全绿** | PrepPRD 铁律 |
| INV-3 | 所有响应（200/400/500）返回 Content-Type: application/json | relay-runs-filter 合同 铁律3 |
| INV-4 | 错误响应不暴露内部信息（SQL/表名/stack trace）；500 body 只含 `{ error: string }` | relay-runs-filter 合同 铁律4 |
| INV-5 | 不带 `?since` 时行为与当前完全一致（向后兼容，不改已有查询逻辑） | PrepPRD 铁律 |
| INV-6 | 只读端点，不做任何 DB 写入 | PrepPRD 铁律 |
| INV-7 | 不动详情端点 `GET /relay-runs/:initiative_id`；不加排序参数 | PrepPRD 明确排除 |
| INV-8 | `?since` 非法格式 → 400 + `{ error: string }`（不到达 DB） | PrepPRD 出错场景 |
| INV-9 | `?since` + `?phase` + `?limit` 三参数同时传入时，三条件同时生效（AND 逻辑，单次 DB 查询） | PrepPRD Golden Path 2 |

---

## 累积 FR（已实现的相关能力）

| 编号 | 描述 | 所在 Sprint | 状态 |
|------|------|------------|------|
| FR-01 | `GET /relay-runs` 列出 v2 runs，`started_at DESC` 排序 | 07041710-relay-runs-endpoint | 已实现 |
| FR-02 | `?limit=N` 参数（默认 20，最大 100，非法值 400） | 07041710-relay-runs-endpoint | 已实现 |
| FR-03 | `?limit=0` 或非整数 → 400 + `{ error }` | 07041710-relay-runs-endpoint | 已实现 |
| FR-04 | DB 查询失败 → 500 + `{ error }` 不崩进程 | 07041710-relay-runs-endpoint | 已实现 |
| FR-05 | `?phase=<valid>` → SQL WHERE phase=$N 绑定 | 07041800-relay-runs-filter | 已实现 |
| FR-06 | `?phase=<invalid>` → 400 + `{ error, allowed: [...] }` | 07041800-relay-runs-filter | 已实现 |
| FR-07 | ALLOWED_PHASES 枚举（10 个值，与 migration 312 一致） | 07041800-relay-runs-filter | 已实现 |
| FR-08 | `?phase=A_planning&limit=5` 组合 → SQL 同时含两条件 | 07041800-relay-runs-filter | 已实现 |
| FR-09 | `GET /relay-runs/:initiative_id` 详情端点（200/404/500） | 07041800-relay-runs-filter | 已实现 |
| FR-10 | 列表响应含 evaluate_verdict（null-able） | 07041845-relay-runs-verdicts | 已实现 |
| FR-11 | 列表响应含 judge_verdict（null-able） | 07041845-relay-runs-verdicts | 已实现 |
| FR-12 | 列表响应含 cost_usd（null-able） | 07041845-relay-runs-verdicts | 已实现 |
| FR-13 | 列表响应含 completed_at（null-able） | 07041845-relay-runs-verdicts | 已实现 |
| FR-14 | 列表响应含 failure_reason（null-able） | 07041845-relay-runs-verdicts | 已实现 |
| FR-15 | 详情响应含 cost_usd（null-able） | 07041845-relay-runs-verdicts | 已实现 |
| FR-16 | null 字段键必须存在，值为 null（不得 omit） | 07041845-relay-runs-verdicts | 已实现 |
| FR-17 | colErr 回退路径（pr_url 列不存在）四个新字段仍出现 | 07041845-relay-runs-verdicts | 已实现 |
| FR-18 | PATCH `/relay-runs/:initiative_id` 终态回写（done/failed） | relay-v101 | 已实现 |

---

## 本次新增 FR

| 编号 | 描述 |
|------|------|
| FR-19 | `?since=<ISO8601>` → SQL WHERE `started_at >= $N`（参数化绑定，防注入） |
| FR-20 | `?since` 缺失 → 不添加任何 since 条件（完全向后兼容，INV-5） |
| FR-21 | `?since` + `?phase` + `?limit` 三参数组合同时生效 |
| FR-22 | `?since=<非法>` → 400 + `{ error: string }`，不执行 DB 查询（INV-8） |
| FR-23 | `?since` 合法性判断：`new Date(rawSince)` isNaN → 非法；空字符串 → 非法 |
| FR-24 | colErr 回退路径（pr_url 缺列）中同样支持 since 过滤 |

---

## 实现计划

### 技术背景

当前路由文件：`/workspace/packages/brain/src/routes/initiatives.js`  
目标函数：`router.get('/relay-runs', ...)` （大约第 212 行）

现有 SQL 结构（简化）：
```sql
SELECT id, initiative_id, phase, ..., failure_reason
FROM initiative_runs
WHERE orchestrator_version = 'v2'
[AND phase = $N]
ORDER BY started_at DESC
LIMIT $1
```

`started_at` 列来源：migration 238（`TIMESTAMPTZ DEFAULT NOW()`）。

### 步骤

#### Step 1：解析 `?since` 参数（在 `?phase` 校验块之后，try 块之前）

```js
// 解析并校验 since 参数
const rawSince = req.query.since;
if (rawSince !== undefined) {
  if (!rawSince || isNaN(new Date(rawSince).getTime())) {
    return res.status(400).json({ error: 'since 参数必须为合法 ISO8601 时间戳' });
  }
}
```

#### Step 2：扩展动态 WHERE 子句构建逻辑

在 `params = [limit]` 初始化后，将现有 `phaseCondition` 变量扩展为通用条件追加模式：

```js
const params = [limit];
let conditions = `orchestrator_version = 'v2'`;

if (rawPhase !== undefined) {
  params.push(rawPhase);
  conditions += ` AND phase = $${params.length}`;
}

if (rawSince !== undefined) {
  params.push(rawSince);
  conditions += ` AND started_at >= $${params.length}`;
}
```

然后将 SQL 中的 `WHERE orchestrator_version = 'v2' ${phaseCondition}` 替换为 `WHERE ${conditions}`。

#### Step 3：同步更新 colErr 回退路径

colErr 回退查询（pr_url 缺列情况）使用相同的 `conditions` 和 `params`，自动继承 since 过滤。

#### Step 4：编写单元测试

新建文件：`/workspace/packages/brain/src/__tests__/relay-runs-since.test.js`

覆盖（见下方"合同测试提纲"）：
- since 生效（SQL 参数含 ISO8601 值，started_at >= $N 条件出现）
- since + phase + limit 三条件同时生效
- since 非法格式 → 400 + error
- since 空字符串 → 400 + error
- since 缺失 → 不含 since 条件（INV-5 回归）

---

## DoD 条目

- [ ] FR-19: `?since=<合法ISO8601>` → SQL WHERE 含 `started_at >= $N`，参数绑定（非字符串拼接）
- [ ] FR-20: `?since` 缺失 → SQL 无 since 条件，行为与当前一致
- [ ] FR-21: `?since=T&phase=P&limit=N` → SQL 含三条件，结果正确
- [ ] FR-22: `?since=not-a-date` → HTTP 400 + `{ error: string }`，不执行 DB 查询
- [ ] FR-23: `?since=` (空字符串) → HTTP 400 + `{ error: string }`
- [ ] FR-24: colErr 回退路径（pr_url 缺列）中 since 条件同样生效
- [ ] INV-2: 既有四份测试文件（relay-runs.test.js、relay-runs-filter.test.js、relay-runs-verdicts.test.js、relay-v101.test.js）全绿，零改动
- [ ] INV-3: 400 响应 Content-Type: application/json
- [ ] INV-5: 不带 since 时，所有既有测试行为不变
- [ ] 单测文件：`relay-runs-since.test.js` 新建，覆盖上述所有场景
- [ ] CI 全绿（brain-ci.yml）

---

## 合同测试提纲

### 测试文件：`packages/brain/src/__tests__/relay-runs-since.test.js`

**测试结构**（描述性，供 GAN 阶段生成测试代码用）：

---

#### 描述块 1：`FR-19 since 参数生效`

**用例 1.1**：`?since=2026-07-04T00:00:00Z` → HTTP 200，SQL 含 `started_at >= $N`
- mock pool 返回一行 V2_RUN
- 断言 HTTP 200，body 是数组
- 断言 SQL 匹配 `/started_at\s*>=\s*\$\d+/i`
- 断言 params 包含 `'2026-07-04T00:00:00Z'`

**用例 1.2**：`?since=2026-07-04T00:00:00Z` → SQL 使用 **参数化绑定**（非字符串拼接）
- 断言 SQL 中无裸 ISO 字符串（字面量不出现在 SQL 里）
- 断言 params 数组包含该值

**用例 1.3**：返回数组中每项都包含 `started_at` 字段（防字段丢失回归）
- 断言 body[0] 含 `started_at`

---

#### 描述块 2：`FR-21 三参数组合同时生效`

**用例 2.1**：`?since=2026-07-04T00:00:00Z&phase=A_planning&limit=5`
- mock pool 返回 V2_RUN_PLANNING
- 断言 HTTP 200
- 断言 SQL 含 `started_at >= $N`
- 断言 SQL 含 `phase = $M`
- 断言 params 含 `'2026-07-04T00:00:00Z'`、`'A_planning'`、`5`

**用例 2.2**：`?since=2026-07-04T00:00:00Z&limit=3`（无 phase）
- 断言 SQL 含 since 条件，不含 phase 条件
- 断言 params 含 `3`

**用例 2.3**：`?since=2026-07-04T00:00:00Z&phase=done`（无 limit）
- 断言 SQL 含 since + phase 条件
- 断言默认 limit=20（params 含 `20`）

---

#### 描述块 3：`FR-22/FR-23 非法 since → 400`

**用例 3.1**：`?since=not-a-date` → HTTP 400 + `{ error: string }`
- 不执行 DB 查询（断言 mockPool.query 未调用）
- 断言 body.error 是字符串

**用例 3.2**：`?since=` (空字符串) → HTTP 400 + `{ error: string }`
- 不执行 DB 查询
- 断言 body.error 是字符串

**用例 3.3**：`?since=2026-13-99T00:00:00Z` (非法日期) → HTTP 400
- 断言 body.error 是字符串

**用例 3.4**：400 响应 Content-Type: application/json（INV-3）
- 断言 res.headers['content-type'] 匹配 `/application\/json/`

---

#### 描述块 4：`INV-5 since 缺失时行为不变（向后兼容）`

**用例 4.1**：不带 `?since` → SQL 不含 `started_at >=` 条件
- 断言 SQL 不匹配 `/started_at\s*>=/i`

**用例 4.2**：不带 `?since`，`?limit=10` → SQL 不含 since，params 含 `10`
- 断言组合正确

**用例 4.3**：不带任何参数 → 默认 limit=20，无 since/phase 条件（完整 INV-5 回归）

---

#### 描述块 5：`FR-24 colErr 回退路径中 since 条件生效`

**用例 5.1**：`?since=2026-07-04T00:00:00Z` → 第一次 query 抛 `pr_url does not exist` → 回退路径 SQL 含 since 条件
- mock pool 第一次 reject（含 'pr_url'）
- mock pool 第二次 resolve 空数组
- 断言 query 调用了两次
- 断言第二次 SQL 含 `started_at >= $N`
- 断言第二次 params 含 since 值

---

### 测试辅助数据（沿用既有风格）

```js
const V2_RUN = {
  id: 'aaaabbbb-1111-2222-3333-444455556666',
  initiative_id: 'bbbbcccc-1111-2222-3333-444455556666',
  phase: 'A_planning',
  orchestrator_heartbeat_at: null,
  orchestrator_host: null,
  pr_url: null,
  started_at: '2026-07-04T10:00:00.000Z',
  deadline_at: '2026-07-04T16:00:00.000Z',
  evaluate_verdict: null,
  judge_verdict: null,
  cost_usd: null,
  completed_at: null,
  failure_reason: null,
};
```

---

## 文件变更清单

| 文件 | 操作 | 说明 |
|------|------|------|
| `packages/brain/src/routes/initiatives.js` | 修改 | `GET /relay-runs` 增加 since 参数解析与 SQL 注入 |
| `packages/brain/src/__tests__/relay-runs-since.test.js` | 新建 | since 参数完整合同测试 |

---

## 不在本次范围

- 详情端点 `GET /relay-runs/:initiative_id` 不加 since 过滤
- 不加任何排序参数（ORDER BY 保持 `started_at DESC`）
- 不加分页（cursor/offset）
- 不做数据库索引变更（`started_at` 上已无需额外 index，`orchestrator_version` + `started_at` 组合查询量小）
