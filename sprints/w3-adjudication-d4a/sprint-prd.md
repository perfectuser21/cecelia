# Sprint PRD — W3 裁决 API + 聚合分流建任务（验收一体两面 D4 后端）

**Task ID**: `6548d9bf-79ee-440e-bcd9-fbf9dcadf8fa`
**Sprint Dir**: `sprints/w3-adjudication-d4a`
**GP ID**: `7790f728-f490-4243-b166-03f3250a0938`（v7-final）
**锚点**: journey `2fa4d085` · step `817f59f5`
**Base Repo**: `cecelia`，改动范围 `packages/brain/`
**依赖前置**: D1 已上主干（cecelia 1.270.0，migration 392-393）

---

## 真机边界声明

本单涉及名词：android（出现于 GP spec 背景文本）、真机（出现于 GP spec 背景文本）。
**本单承诺：零真机动作，零 UI 操作，纯服务端后端变更。**
theater 闸语境化已上线，无此声明则 FAIL。

---

## 一、背景与范围

D1 数据层已就位：AI 四列、7 值状态机、`computeCellState`九组合、`computeGateVerdict`、36 格建单生成器、`POST /api/brain/acceptance/ai-results`（AI token 只写 AI 列）、收单闸（`scenarios_observed` 5 个 mandatory 码）、reason 域校验（`scenario_not_triggered` 任何格 400）。

D4 本批交付裁决与分流后端，对应 GP v7-final §Step 6、§A6、§A7、§A12（自动 P0 定义域）、§D4 后端部分。**不含** D4 里的 zenithjoy 前端页面（合看页、员工回显视图、建单页字段迁入、lib.mjs 收编）。

---

## 二、功能需求（FR）

### FR-1 · adjudication 裁决 API

**端点**：`PATCH /api/brain/acceptance/runs/:run_key/adjudicate-cell`

请求体：
```json
{ "check_key": "S5-c4", "verdict": "绿", "by": "alice", "reason": "现场录屏确认，红线可接受", "at": "2026-08-07T10:00:00Z" }
```

规则：
1. `verdict` 必须 ∈ `{'绿','红'}`，其他值 400。
2. 四字段（`verdict`/`by`/`reason`/`at`）全部必填，缺任一 400。
3. 写入 `acceptance_checks.adjudication`（jsonb 列，D1 migration 392/393 已建）。
4. 前态守卫：`acceptance_runs.status` 必须为 `human_complete`，其他前态（包括 `adjudicated`）返回 409，消息写明当前状态与期望前态。
5. 写入成功后：
   - 重算整个 run 的所有格 `final_state` + `gate_verdict`（调 `computeCellState` + `computeGateVerdict`）；
   - 若全部格 `final_state` 已填（无 `未定`/`null` 且 `gate_verdict` 有确定值）则推进 run `status` → `adjudicated`；否则 run 仍停在 `human_complete`。
   - 返回 `{ check_key, adjudication, final_state, run_status, gate_verdict }`。

### FR-2 · unverifiable_this_version 格的例外路径

1. 对 `scenario_class = 'unverifiable_this_version'` 的格（本版恰为 S13-c4），裁决绿时**不得**自动开 P0 任务。
2. 改为：写 `acceptance_runs.detail.unverifiable_adjudicated[]`（追加该格号，JSON array）并在 A12 棘轮计数中记录。
3. 其余 7 个 hard 格（`hard: true` 且 `scenario_class ≠ 'unverifiable_this_version'`）裁决绿仍自动开 P0。
4. **禁硬编码格号**：判断走 `scenario_class` 字段，不得写死 `'S13-c4'`。

### FR-3 · 聚合式分流建任务（触发时点 = run 转 adjudicated 之后）

触发点：FR-1 中 run status 推进到 `adjudicated` 那一刻（同一事务内或事务提交后立即异步）。

规则：
1. **触发时点写死在 `adjudicated` 之后**，不在 `human_complete` 时建任务。
2. **每 run ≤1 bug 任务 + ≤1 追查任务**（聚合式：多格红合为一个任务，不按格建多个）。
3. bug 任务：`final_state = '红'` 的格（定案后终态），描述含所有红格的 `check_key` 清单。
4. 追查任务：`final_state = '未定'` 的格（Q4/Q7 形态——人列通过/无法验证 + AI 通过，但未经裁决），描述含所有相关格清单。
5. 查重谓词加 `acceptance_bucket` 维度（`bug` 桶和 `trace` 桶各自独立查重，不能两桶共用同一个「已有未终态任务即跳过」）：
   - `SELECT count(*) FROM tasks WHERE payload->>'acceptance_run_key'=:run_key AND payload->>'acceptance_bucket'='bug' AND status NOT IN ('completed','failed','cancelled')` == 0 才建 bug 任务；
   - trace 桶同理独立查重。
6. 任务 `payload.anchor` 三件套：
   ```json
   { "journey_id": "2fa4d085-1451-4f3f-8fa1-b6d4bacdb1b6", "gp_id": "7790f728-f490-4243-b166-03f3250a0938", "step_id": "817f59f5-02ff-4a70-bd81-f7ae65f77e02" }
   ```
   同时携带 `acceptance_run_key` 与 `acceptance_bucket`（`'bug'` 或 `'trace'`）。

### FR-4 · 熔断路径（非绿格占比 > 1/3）

1. 计算时机与分流相同（`adjudicated` 之后）。
2. 判据：`非绿格（final_state ∈ {'红','未定'}）/ 36 > 1/3`（即非绿格 ≥ 13）。
3. **熔断时不建 bug/trace 任务**，改开 1 个 P0「规程/数据源疑似分叉」，描述含非绿格数和比例。
4. 熔断与常规分流互斥：先判熔断，熔断时跳过常规分流逻辑。

### FR-5 · AI 整轮哑火走独立路径（不进熔断）

1. `acceptance_runs.detail.ai_incomplete = true`（由 D1 的 `computeAiStatus` 写入）的 run，**不走常规分流，不进熔断**。
2. 改走 `ai_run_infra_error` 路径：单开 1 个 P0「AI 打表器整轮哑火」，payload 含 `acceptance_run_key`、`acceptance_bucket: 'ai_run_infra_error'`、缺格格号清单（`detail.missing_cells`）。
3. 此 P0 的查重 bucket 为 `ai_run_infra_error`，同 run 同 bucket 查重防重复。

### FR-6 · SAVEPOINT 回滚不毒化外层事务

背景：D1 已有 SAVEPOINT 保护（`acceptance.js:179/189/195`，防单条 INSERT 23505 毒化整笔 batch）。本单在聚合分流建任务时新开事务链，需同等保护。

规则：分流建任务（FR-3/FR-4/FR-5）的每条 `INSERT INTO tasks` 各自包裹独立的 SAVEPOINT（命名如 `adj_task_insert_{bucket}`）：
- 成功：`RELEASE SAVEPOINT`；
- 23505（重复）或其他插入冲突：`ROLLBACK TO SAVEPOINT`，记录日志，继续下一条；
- 其他错误：让外层事务判断是否整体回滚。

### FR-7 · abandon 端点前态守卫

现状：`PATCH /runs/:run_key/abandon` 无前态检查，`adjudicated` 和 `stale` 的 run 可被直接写成 `abandoned`。

规则：
1. `adjudicated` 状态的 run **禁止** 被 abandon（返回 409，消息：`run already adjudicated, cannot abandon`）。
2. `stale` 状态的 run **禁止** 被 abandon（返回 409，消息：`run is stale, use re-open flow`）。
3. 其余前态（`pending`、`in_review`、`human_complete`）允许 abandon。
4. `expired` 状态允许 abandon（发起人显式确认放弃一个已过期 run 是合法操作）。

---

## 三、不变量（Invariants）

| # | 不变量 | 验证位置 |
|---|---|---|
| **INV-1** | 裁决四字段缺任一则 400（A6 psql 断言） | FR-1 输入校验 |
| **INV-2** | `verdict` 只接受 `{'绿','红'}`，其他值 400 | FR-1 输入校验 |
| **INV-3** | 非 `human_complete` 前态调裁决 API 返回 409 | FR-1 前态守卫 |
| **INV-4** | `scenario_class = 'unverifiable_this_version'` 的格裁决绿不开 P0，只计数 + 单头注记 | FR-2 |
| **INV-5** | 例外判断绑 `scenario_class` 字段，禁止硬编码格号 `'S13-c4'` | FR-2 |
| **INV-6** | 分流建任务触发时点 = `adjudicated` 之后，不在 `human_complete` 建任务 | FR-3 |
| **INV-7** | 每 run bug 桶 ≤1 任务，trace 桶 ≤1 任务（两桶独立查重） | FR-3 |
| **INV-8** | 分流任务 `payload.anchor` 三件套非空（`journey_id`/`gp_id`/`step_id`） | FR-3 |
| **INV-9** | 非绿格占比 > 1/3 时只开熔断 P0，不建 bug/trace 任务 | FR-4 |
| **INV-10** | `ai_incomplete = true` 时走 infra_error 路径，不进熔断，不建 bug/trace | FR-5 |
| **INV-11** | 分流链路的每条 INSERT 有独立 SAVEPOINT，23505 只回滚单条不毒化外层 | FR-6 |
| **INV-12** | `adjudicated` 和 `stale` 状态的 run 调 abandon 返回 409 | FR-7 |

---

## 四、验收断言（Final E2E 级）

以下全部通过 psql 直查或 curl + psql 双证，不依赖 UI。

### E2E-1 · 裁决写入（A6 对应）

```sql
-- 构造：human_complete 的 run，对 S5-c4（hard 格）调裁决 API verdict='绿'
-- 断言：四字段全非空
SELECT adjudication->>'verdict', adjudication->>'by', adjudication->>'reason', adjudication->>'at'
FROM acceptance_checks WHERE run_id=:rid AND check_key='S5-c4';
-- 期望：四列非空，verdict='绿'
```

### E2E-2 · unverifiable_this_version 例外不开 P0（A12 对应）

```sql
-- 构造：对 S13-c4（scenario_class='unverifiable_this_version'）调裁决 API verdict='绿'
-- 断言①：不建 P0 任务
SELECT count(*) FROM tasks
WHERE payload->>'acceptance_run_key'=:run_key AND payload->>'acceptance_bucket'='hard_green_p0'; -- == 0
-- 断言②：单头注记存在
SELECT detail->'unverifiable_adjudicated' FROM acceptance_runs WHERE id=:rid; -- JSON 数组含 'S13-c4'
```

```sql
-- 对照：对 S5-c4（hard，非 unverifiable）裁决绿
SELECT count(*) FROM tasks
WHERE payload->>'acceptance_run_key'=:run_key AND payload->>'acceptance_bucket'='hard_green_p0'; -- == 1
```

### E2E-3 · 分流建任务（A7 对应）

```sql
-- 构造：adjudicated run，有 2 格红（S2-c4, S8-c4）、1 格未定（Q4）
SELECT count(*) FROM tasks WHERE payload->>'acceptance_run_key'=:run_key
  AND payload->>'acceptance_bucket'='bug'; -- == 1
SELECT count(*) FROM tasks WHERE payload->>'acceptance_run_key'=:run_key
  AND payload->>'acceptance_bucket'='trace'; -- == 1
-- 断言 anchor 三件套
SELECT payload->'anchor'->>'journey_id', payload->'anchor'->>'gp_id', payload->'anchor'->>'step_id'
FROM tasks WHERE payload->>'acceptance_run_key'=:run_key; -- 每行三项非空
-- 断言 bug 任务描述含红格格号
SELECT payload->>'description' FROM tasks WHERE payload->>'acceptance_run_key'=:run_key
  AND payload->>'acceptance_bucket'='bug'; -- 含 'S2-c4' 且含 'S8-c4'
```

### E2E-4 · 查重谓词 bucket 维度（A7 查重）

```sql
-- 构造：已有 bug 桶未终态任务的 run，再次触发分流
SELECT count(*) FROM tasks WHERE payload->>'acceptance_run_key'=:run_key
  AND payload->>'acceptance_bucket'='bug'; -- 仍 == 1（不重建）
-- 但 trace 桶可独立建出
SELECT count(*) FROM tasks WHERE payload->>'acceptance_run_key'=:run_key
  AND payload->>'acceptance_bucket'='trace'; -- == 1（独立新建）
```

### E2E-5 · 熔断（A7 熔断分支）

```sql
-- 构造：非绿格占 36 格的 14 格（> 1/3）
SELECT count(*) FROM tasks WHERE payload->>'acceptance_run_key'=:run_key
  AND payload->>'acceptance_bucket' IN ('bug','trace'); -- == 0（不建散任务）
SELECT count(*) FROM tasks WHERE payload->>'acceptance_run_key'=:run_key
  AND payload->>'task_type'='p0' AND payload->>'description' LIKE '%规程/数据源疑似分叉%'; -- == 1
```

### E2E-6 · AI 哑火独立路径（A7 哑火）

```sql
-- 构造：detail.ai_incomplete=true 的 run
SELECT count(*) FROM tasks WHERE payload->>'acceptance_run_key'=:run_key
  AND payload->>'acceptance_bucket' IN ('bug','trace'); -- == 0
SELECT count(*) FROM tasks WHERE payload->>'acceptance_run_key'=:run_key
  AND payload->>'acceptance_bucket'='ai_run_infra_error'; -- == 1
```

### E2E-7 · SAVEPOINT 不毒化外层（FR-6 回归）

```
构造：分流建两条任务，其中第一条 INSERT 制造 23505（重复键）冲突。
断言：第二条任务仍成功落库，外层事务整体提交。
```

### E2E-8 · abandon 前态守卫（FR-7）

```bash
# adjudicated run 调 abandon → 409
test "$(curl -s -o /dev/null -w '%{http_code}' -X PATCH \
  "localhost:5221/api/brain/acceptance/runs/$ADJ_RUN_KEY/abandon" \
  -H 'Content-Type: application/json' -d '{"reason":"test","by":"ci"}')" = "409"

# stale run 调 abandon → 409
test "$(curl -s -o /dev/null -w '%{http_code}' -X PATCH \
  "localhost:5221/api/brain/acceptance/runs/$STALE_RUN_KEY/abandon" \
  -H 'Content-Type: application/json' -d '{"reason":"test","by":"ci"}')" = "409"

# pending run 调 abandon → 200
test "$(curl -s -o /dev/null -w '%{http_code}' -X PATCH \
  "localhost:5221/api/brain/acceptance/runs/$PENDING_RUN_KEY/abandon" \
  -H 'Content-Type: application/json' -d '{"reason":"test","by":"ci"}')" = "200"
```

---

## 五、实现提示（非规范，供参考）

1. **裁决 API 文件**：建议新增 `packages/brain/src/routes/acceptance-adjudication.js`，并在 `acceptance.js` 的 `createAcceptanceRouter` 里 `registerAdjudicationRoutes(router, { pool })`。

2. **分流建任务**：建议新增 `packages/brain/src/acceptance-divert.js`，导出 `divertAfterAdjudicated(pool, runKey)`，在裁决 API 确认 run 推进到 `adjudicated` 后调用。

3. **D1 已有工具**：`computeCellState`、`computeGateVerdict`、`computeAiStatus` 在 `acceptance-state.js`；`loadSpecForRun` / `unverifiableList` 在 `acceptance-spec.js`（`scenario_class='unverifiable_this_version'` 取数已有）。

4. **任务建单**：参考 `acceptance.js:179` 的 SAVEPOINT 模式复制到分流链路。查重用事务内 `SELECT … FOR UPDATE` 或乐观 SAVEPOINT 兜底均可，但 SAVEPOINT 模式已有先例且更简单。

5. **不需要新的 migration**：`adjudication` 列（jsonb）已由 D1 migration 392/393 建好；`detail` 列（jsonb）在 `acceptance_runs` 已存在。

---

## 六、边界（不做）

- 合看页 / 员工回显 / 建单页前端（zenithjoy，属 D4 前端，另开任务）
- `lib.mjs` 收编（D4 前端）
- 侧边栏待办角标与仪式通知（D4 前端）
- Gate B 首日清单的实际探明工作
- D5 放行闸第三证据项（另开 D5 任务）

---

## 七、提交规范

- 改动范围：`packages/brain/src/`
- 提交格式：`feat(brain): D4后端 裁决API+聚合分流+熔断+SAVEPOINT回归`
- 分支：`cp-08071826-ws-6548d9bf`（当前分支）
- CI：`brain-ci.yml` 须绿
