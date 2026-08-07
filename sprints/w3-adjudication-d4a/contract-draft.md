# Contract Draft — W3 裁决 API + 聚合分流建任务（D4 后端）

**Task ID**: `6548d9bf-79ee-440e-bcd9-fbf9dcadf8fa`
**Sprint Dir**: `sprints/w3-adjudication-d4a`
**版本**: v1（首轮，无 reviewer feedback）
**生成时间**: 2026-08-07

---

## 真机边界确认

本合同零真机动作，零 UI 操作，纯服务端后端变更（`packages/brain/src/`）。
theater 闸语境化已在 D2-D5 前置修债中上线，本合同无需重复声明。

---

## 一、可观测行为清单（[BEHAVIOR]）

以下每条对应一个可独立验证的系统行为，排序与 FR 对齐。

### [BEHAVIOR-1] 裁决 API 四字段缺一返回 400
`PATCH /api/brain/acceptance/runs/:run_key/adjudicate-cell` 请求体缺 `verdict`/`by`/`reason`/`at` 任意一字段，服务器返回 HTTP 400。

### [BEHAVIOR-2] 裁决 API verdict 非法值返回 400
`verdict` 不在 `{'绿','红'}` 时返回 HTTP 400。

### [BEHAVIOR-3] 裁决 API 非 human_complete 前态返回 409
当 `acceptance_runs.status` 不是 `human_complete`（包括 `adjudicated`、`pending`、`in_review`、`stale` 等），调用裁决 API 返回 HTTP 409，响应体含当前 status 与期望前态说明。

### [BEHAVIOR-4] 裁决写入成功后 adjudication jsonb 落库
`human_complete` 状态 run 的某格调裁决 API，成功后 `acceptance_checks.adjudication` 的四字段全非空且与请求体一致。

### [BEHAVIOR-5] 裁决后全格 final_state 重算
裁决 API 成功后，该 run 所有格的 `final_state`（由 `computeCellState` 重算）在响应体中返回，并且 `gate_verdict` 已计算。

### [BEHAVIOR-6] 全格 final_state 无未定时 run 推进 adjudicated
所有格 `final_state` 均为 `'绿'` 或 `'红'` 时，裁决 API 响应体 `run_status` = `'adjudicated'`，数据库 `acceptance_runs.status` = `'adjudicated'`。

### [BEHAVIOR-7] 仍有未定格时 run 停在 human_complete
有格 `final_state = '未定'` 时，裁决 API 响应体 `run_status` = `'human_complete'`。

### [BEHAVIOR-8] unverifiable_this_version 格裁决绿不开 P0 任务
对 `scenario_class = 'unverifiable_this_version'` 的格调裁决 API `verdict='绿'`，数据库 `tasks` 表中不出现 `acceptance_bucket='hard_green_p0'` 的新任务。

### [BEHAVIOR-9] unverifiable_this_version 格裁决绿写入单头注记
`acceptance_runs.detail.unverifiable_adjudicated[]` JSON 数组包含该格号。

### [BEHAVIOR-10] hard 且非 unverifiable 格裁决绿开 P0 任务
对 `hard=true` 且 `scenario_class != 'unverifiable_this_version'` 的格裁决绿，创建 `acceptance_bucket='hard_green_p0'` 的任务，计数 +1。

### [BEHAVIOR-11] unverifiable 判断绑 scenario_class 不硬编码格号
代码中不存在字符串字面量 `'S13-c4'`（由 grep 静态验证）。

### [BEHAVIOR-12] adjudicated 之后才触发分流建任务
run 推进到 `adjudicated` 状态才触发分流；`human_complete` 时不建 bug/trace 任务。

### [BEHAVIOR-13] 多红格聚合为一个 bug 任务
`final_state='红'` 的格无论多少，只建 1 个 `acceptance_bucket='bug'` 的任务，任务描述包含所有红格的 `check_key`。

### [BEHAVIOR-14] 多未定格聚合为一个 trace 任务
`final_state='未定'` 的格只建 1 个 `acceptance_bucket='trace'` 的任务，任务描述包含所有未定格的 `check_key`。

### [BEHAVIOR-15] bug 桶与 trace 桶独立查重
已有 bug 桶未终态任务的 run 再次触发分流，bug 任务计数不增（仍=1）；trace 桶可独立新建（=1）。

### [BEHAVIOR-16] 分流任务 payload.anchor 三件套非空
所有分流任务的 `payload.anchor` 包含 `journey_id`、`gp_id`、`step_id` 三个非空字段。

### [BEHAVIOR-17] 熔断时只开一个规程 P0，不建 bug/trace 任务
非绿格 ≥ 13（占比 > 1/3）时，`acceptance_bucket IN ('bug','trace')` 任务计数 = 0，`task_type='p0'` 且描述含 `'规程/数据源疑似分叉'` 的任务计数 = 1。

### [BEHAVIOR-18] AI 哑火走独立路径，不进熔断，不建 bug/trace
`detail.ai_incomplete=true` 的 run：`acceptance_bucket IN ('bug','trace')` 任务计数 = 0，`acceptance_bucket='ai_run_infra_error'` 任务计数 = 1，任务 payload 含 `missing_cells`。

### [BEHAVIOR-19] SAVEPOINT 隔离：单条 INSERT 23505 不毒化外层事务
分流链路第一条任务 INSERT 触发 23505 唯一冲突时，第二条任务仍落库，外层事务整体提交。

### [BEHAVIOR-20] adjudicated run 调 abandon 返回 409
`PATCH /runs/:run_key/abandon` 在 run 状态为 `adjudicated` 时返回 HTTP 409，消息含 `already adjudicated`。

### [BEHAVIOR-21] stale run 调 abandon 返回 409
run 状态为 `stale` 时返回 HTTP 409，消息含 `stale`。

### [BEHAVIOR-22] pending/in_review/human_complete run 可 abandon（200）
这三个前态的 run 正常 abandon 返回 HTTP 200。

### [BEHAVIOR-23] expired run 可 abandon（200）
`expired` 状态的 run 正常 abandon 返回 HTTP 200。

---

## E2E 验收断言（Final E2E）

以下全部通过 psql 直查或 curl + psql 双证，不依赖 UI。

### E2E-1 · 裁决写入（对应 BEHAVIOR-4）
```sql
-- 前置：human_complete run，对 S5-c4（hard 格）调裁决 API verdict='绿'
SELECT adjudication->>'verdict', adjudication->>'by', adjudication->>'reason', adjudication->>'at'
FROM acceptance_checks WHERE run_id=:rid AND check_key='S5-c4';
-- 期望：四列非空，verdict='绿'
```

### E2E-2 · unverifiable 例外不开 P0（对应 BEHAVIOR-8/9/10）
```sql
-- 断言①：unverifiable 格裁决绿不建 P0
SELECT count(*) FROM tasks
WHERE payload->>'acceptance_run_key'=:run_key
  AND payload->>'acceptance_bucket'='hard_green_p0'; -- == 0

-- 断言②：单头注记存在
SELECT detail->'unverifiable_adjudicated'
FROM acceptance_runs WHERE id=:rid; -- JSON 数组含该格号

-- 对照：S5-c4（hard，非 unverifiable）裁决绿开 P0
SELECT count(*) FROM tasks
WHERE payload->>'acceptance_run_key'=:run_key2
  AND payload->>'acceptance_bucket'='hard_green_p0'; -- == 1
```

### E2E-3 · 分流建任务（对应 BEHAVIOR-13/14/16）
```sql
-- 前置：adjudicated run，有 2 格红（S2-c4, S8-c4）、1 格未定
SELECT count(*) FROM tasks WHERE payload->>'acceptance_run_key'=:run_key
  AND payload->>'acceptance_bucket'='bug'; -- == 1
SELECT count(*) FROM tasks WHERE payload->>'acceptance_run_key'=:run_key
  AND payload->>'acceptance_bucket'='trace'; -- == 1

-- anchor 三件套
SELECT payload->'anchor'->>'journey_id', payload->'anchor'->>'gp_id', payload->'anchor'->>'step_id'
FROM tasks WHERE payload->>'acceptance_run_key'=:run_key; -- 每行三项非空

-- bug 任务描述含所有红格格号
SELECT payload->>'description' FROM tasks
WHERE payload->>'acceptance_run_key'=:run_key AND payload->>'acceptance_bucket'='bug';
-- 含 'S2-c4' 且含 'S8-c4'
```

### E2E-4 · 查重谓词 bucket 维度（对应 BEHAVIOR-15）
```sql
-- 前置：已有 bug 桶未终态任务的 run，再次触发分流
SELECT count(*) FROM tasks WHERE payload->>'acceptance_run_key'=:run_key
  AND payload->>'acceptance_bucket'='bug'; -- 仍 == 1（不重建）
SELECT count(*) FROM tasks WHERE payload->>'acceptance_run_key'=:run_key
  AND payload->>'acceptance_bucket'='trace'; -- == 1（独立新建）
```

### E2E-5 · 熔断（对应 BEHAVIOR-17）
```sql
-- 前置：非绿格占 36 格的 14 格（> 1/3）
SELECT count(*) FROM tasks WHERE payload->>'acceptance_run_key'=:run_key
  AND payload->>'acceptance_bucket' IN ('bug','trace'); -- == 0
SELECT count(*) FROM tasks WHERE payload->>'acceptance_run_key'=:run_key
  AND payload->>'task_type'='p0'
  AND payload->>'description' LIKE '%规程/数据源疑似分叉%'; -- == 1
```

### E2E-6 · AI 哑火（对应 BEHAVIOR-18）
```sql
-- 前置：detail.ai_incomplete=true 的 run
SELECT count(*) FROM tasks WHERE payload->>'acceptance_run_key'=:run_key
  AND payload->>'acceptance_bucket' IN ('bug','trace'); -- == 0
SELECT count(*) FROM tasks WHERE payload->>'acceptance_run_key'=:run_key
  AND payload->>'acceptance_bucket'='ai_run_infra_error'; -- == 1
```

### E2E-7 · SAVEPOINT 不毒化外层（对应 BEHAVIOR-19）
```sql
-- 前置：对同一 run 触发两次分流，第一条 bug 任务 INSERT 因唯一键冲突失败（23505）
-- 断言：第二条 trace 任务仍成功落库
SELECT count(*) FROM tasks
WHERE payload->>'acceptance_run_key'=:'run_key'
  AND payload->>'acceptance_bucket'='trace';
-- 期望：count = 1（trace 任务落库成功，外层事务未毒化）
```

### E2E-8 · abandon 前态守卫（对应 BEHAVIOR-20/21/22/23）
```bash
# adjudicated run → 409
test "$(curl -s -o /dev/null -w '%{http_code}' -X PATCH \
  "localhost:5221/api/brain/acceptance/runs/$ADJ_RUN_KEY/abandon" \
  -H 'Content-Type: application/json' -d '{"reason":"test","by":"ci"}')" = "409"

# stale run → 409
test "$(curl -s -o /dev/null -w '%{http_code}' -X PATCH \
  "localhost:5221/api/brain/acceptance/runs/$STALE_RUN_KEY/abandon" \
  -H 'Content-Type: application/json' -d '{"reason":"test","by":"ci"}')" = "409"

# pending run → 200
test "$(curl -s -o /dev/null -w '%{http_code}' -X PATCH \
  "localhost:5221/api/brain/acceptance/runs/$PENDING_RUN_KEY/abandon" \
  -H 'Content-Type: application/json' -d '{"reason":"test","by":"ci"}')" = "200"
```

---

## 三、不变量绑定

| 不变量 | 验证方式 |
|---|---|
| INV-1/INV-2 | 单元测试（BEHAVIOR-1/2） |
| INV-3 | E2E → BEHAVIOR-3 + 单元测试 |
| INV-4 | E2E-2 + BEHAVIOR-8/9 |
| INV-5 | grep 静态检查（BEHAVIOR-11）|
| INV-6 | BEHAVIOR-12 单元测试 |
| INV-7 | E2E-3/4 + BEHAVIOR-13/14/15 |
| INV-8 | E2E-3 + BEHAVIOR-16 |
| INV-9 | E2E-5 + BEHAVIOR-17 |
| INV-10 | E2E-6 + BEHAVIOR-18 |
| INV-11 | E2E-7 + BEHAVIOR-19 |
| INV-12 | E2E-8 + BEHAVIOR-20/21/22/23 |

---

## 四、实现文件边界

| 新增文件 | 职责 |
|---|---|
| `packages/brain/src/routes/acceptance-adjudication.js` | FR-1/FR-2 裁决 API 端点 |
| `packages/brain/src/acceptance-divert.js` | FR-3/FR-4/FR-5/FR-6 聚合分流建任务 |

修改文件：
- `packages/brain/src/routes/acceptance.js`：注册裁决路由 + abandon 前态守卫（FR-7）

---

## 五、边界外（不做）

- 合看页/员工回显/建单页前端（zenithjoy D4 前端）
- `lib.mjs` 收编
- 侧边栏待办角标与仪式通知
- Gate B 首日清单探明
- D5 放行闸第三证据项
