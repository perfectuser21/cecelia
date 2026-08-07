# Sprint PRD — 背靠背裁剪 D3（服务端读写隔离 + 三 token 分权 + 5223 休眠）

## 元信息
- **task_id**: 0b7df1ca-da50-4928-9d24-bfbb8ae7cd90
- **sprint_dir**: sprints/w2-backtoback-d3
- **gp_id**: 7790f728-f490-4243-b166-03f3250a0938
- **生成时间**: 2026-08-07
- **规格 SSOT**: Brain golden_paths(7790f728).proposal_doc (v7-final)

---

## 前置确认（D1 已上主干 cecelia 1.270.0）

ai_verdict/ai_evidence/ai_run_at 三列 / 7 值状态机 / POST /api/brain/acceptance/ai-results（AI token 专用）/ 收单闸（5 mandatory 场景码）/ scenario_not_triggered 任何格 400 已上线。**本 sprint 只交付 D3。**

---

## Invariant 约束

三源加载：Brain invariants（114 条）/ GP v7-final invariants / decisions 表。

| # | 来源 | 铁律 |
|---|---|---|
| I-1 | decisions fdeb48aa ① | AI 列与人列是同表两组独立列，不得合并写入路径 |
| I-2 | decisions fdeb48aa ② | 员工填表时不可见 AI 判定列（防锚定）——读侧默认不 SELECT AI 三列 |
| I-3 | decisions 8640ef58 ② | scenario_not_triggered 任何格均 400（D1 已实现，D3 不得回退） |
| I-4 | decisions 8640ef58 ③ | S13-c4 fail-closed；该格为绿必须经有名有姓裁决，无绿通道 |
| I-5 | GP v7-final Gate A ⑤ | AI job secrets 白名单只含 ACCEPTANCE_AI_TOKEN；ACCEPTANCE_API_TOKEN 移出 AI 车道 |
| I-6 | GP v7-final Gate B ③ | 三钥匙任一缺失只降级对应端点，不拖挂整个 listener |
| I-7 | GP v7-final D3（不变）| 本版只做读写隔离+三 token 分权+5223 休眠；不改 D2/D4 |
| I-8 | 决策 fc7b5dc0 休眠语义 | 端点下线 = 解挂路由不删码，改返 410 |

**invariant 数：8**

---

## 累积 FR

| FR | 已验收事实 |
|---|---|
| AI 三列结构 | acceptance_checks.ai_verdict/ai_evidence/ai_run_at 存在且有 CHECK 约束（migration 392） |
| 7 值状态机 | acceptance_runs.status 枚举 7 值（migration 392） |
| POST /ai-results | AI token 专用，只写 AI 列，写人列 4xx（acceptance-ai.js） |
| scenario_not_triggered 400 | 任何格提交均被服务端拒绝（D1 acceptance-ai.js） |
| 36 格建单 | GP yaml → acceptance_checks 自动生成（migration 393） |

**累积 FR 数：5**

---

## 功能需求（FR）

### FR-1：loadChecks / loadRunsWithChecks — SQL 列白名单
**文件**：`packages/brain/src/routes/acceptance.js`

`loadChecks` 从 `SELECT *` 改为列白名单（默认不含 ai_verdict/ai_evidence/ai_run_at），接收 `{ includeAi }` 参数；`loadRunsWithChecks` / `loadPendingRuns` 透传，默认 `includeAi=false`。

**断言**：GET /api/brain/acceptance/pending 返回的 checks 不含 ai_verdict 字段。

---

### FR-2：view 参数 + 服务端 human_complete 校验
**文件**：`packages/brain/src/routes/acceptance.js`

1. 读侧端点支持 `?view=ai`，携带 gate token 才透出 AI 三列（FR-5 的 ACCEPTANCE_GATE_TOKEN）。
2. `POST /results` 入口加服务端校验：`run.status` 须在 `('pending','in_review')` 内，否则 409（已定案/已完成轮拒绝人列重提），不靠前端隐藏。

**断言**：对 status=adjudicated 的 run POST /results → 409；status=pending → 200。

---

### FR-3：gp 级跨轮闸——活跃 run 谓词与 loadPendingRuns 对齐
**文件**：`packages/brain/src/routes/acceptance.js`（建单端点 POST /runs）

建单前 gp 级活跃 run 查询改为 `status IN ('pending','in_review')`（与 loadPendingRuns 完全对齐）：adjudicated / stale run 的存在不拦新建单。

**断言**：存在 pending run 时同 gp_id 建单 → 409；存在 adjudicated run 时建单 → 201。

---

### FR-4：9 条读侧出口覆盖 + 反向断言
**文件**：`packages/brain/src/__tests__/acceptance-read-outlets.test.js`（新建）

覆盖 9 条出口：内网 GET /pending、GET /runs?gp_id、GET /runs/:run_key、GET /runs/:run_key/checks、loadRunsWithChecks 函数、loadPendingRuns 函数；公网 GET /acceptance/pending、GET /acceptance/catalog、POST /acceptance/pending（若有）。

**反向断言**：adjudicated 与 stale run 并存时，GET /runs?gp_id 返回结果包含 adjudicated run（已定案轮不被过滤）。

---

### FR-5：createBearerAuth 下沉路由级 + 三 token 分权
**文件**：`acceptance-ai.js`、`acceptance-public-server.js`

| token | 环境变量 | 可访问端点 |
|---|---|---|
| AI token | `ACCEPTANCE_AI_TOKEN` | POST /api/brain/acceptance/ai-results |
| gate token | `ACCEPTANCE_GATE_TOKEN` | GET /acceptance/pending、GET /acceptance/catalog（5223 只读） |
| 既有 token | `ACCEPTANCE_API_TOKEN` | 内网 5221 全部端点（不变） |

三钥匙任一缺失只降级该端点（不挂载），不拖挂 listener（fail-closed）。

**断言**：AI token + POST /ai-results → 200；gate token + GET /acceptance/pending → 200；gate token + 任何写操作 → 401/404。

---

### FR-6：5223 公网 POST /acceptance/results 休眠（410）
**文件**：`packages/brain/src/routes/acceptance.js`（createAcceptancePublicRouter）

公网写端点改返 410 Gone（解挂路由，不删码）：

```js
// [休眠] 决策 fc7b5dc0
router.post('/acceptance/results', (_req, res) =>
  res.status(410).json({ error: 'endpoint_retired', hint: '已休眠，通过内网 5221 写入' })
);
```

只读 GET /acceptance/pending 保留（绑 gate token）。

**断言**：POST localhost:5223/acceptance/results → 410；GET localhost:5223/acceptance/pending（携带 gate token）→ 200。

---

### FR-7：写侧断言——AI token 写人列必 4xx
**文件**：`packages/brain/src/__tests__/acceptance-token-isolation.test.js`（新建）

- AI token + 写 result/submitted_by/decided_at → 4xx
- gate token + 任何写操作 → 4xx
- ACCEPTANCE_API_TOKEN + POST /ai-results → 401（AI token 独享）

---

## NFR

| # | 要求 |
|---|---|
| NFR-1 | 三 token 任一缺失只降级对应端点，不拖挂 listener |
| NFR-2 | 5223 公网写端点改 410 不删码（休眠语义） |
| NFR-3 | 改 packages/brain 前须通过 DevGate 三件套 |
| NFR-4 | 不改 D1 已交付能力；不改 D2/D4 |

---

## Final E2E 验收（local_api — curl localhost:5221 + psql cecelia）

1. GET /api/brain/acceptance/pending 返回 checks 不含 ai_verdict（列白名单有效）
2. POST /results 对 adjudicated run → 409（服务端拒，非前端控制）
3. 同 gp_id 建单（存在 pending run）→ 409；存在 adjudicated run → 201
4. adjudicated 与 stale 并存 → GET /runs?gp_id 含 adjudicated run（可见）
5. AI token + 写 result 字段 → 4xx
6. POST localhost:5223/acceptance/results → 410
7. npm test（acceptance-read-outlets + acceptance-token-isolation）全绿

---

## 交付物清单

| 文件 | 类型 | 关联 FR |
|---|---|---|
| `packages/brain/src/routes/acceptance.js` | 修改 | FR-1/2/3 |
| `packages/brain/src/routes/acceptance-ai.js` | 修改（AI token 路由级中间件） | FR-5 |
| `packages/brain/src/acceptance-public-server.js` | 修改（gate token + 410 休眠） | FR-5/6 |
| `packages/brain/src/__tests__/acceptance-read-outlets.test.js` | 新建 | FR-4 |
| `packages/brain/src/__tests__/acceptance-token-isolation.test.js` | 新建 | FR-7 |

---

journey_type: harness_initiative
target_environment: local_api
