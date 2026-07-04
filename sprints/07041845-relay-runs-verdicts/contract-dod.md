# DoD 断言清单: relay-runs-verdicts

**Task ID**: `8aadc072-3367-4748-94bd-43578786548a`
**Date**: 2026-07-04

---

## DoD 断言（共 8 条，对应 8 条 Invariant）

### DOD-1（对应 INV-1）：字段名 snake_case，与 DB 列名完全一致

- **断言**：列表响应每项的新字段名为 `evaluate_verdict`、`judge_verdict`、`cost_usd`、`completed_at`、`failure_reason`（全小写+下划线，不含任何 camelCase 变体）
- **测试**：`relay-runs-verdicts.test.js` → "列表端点新字段名与 DB 列名一致（snake_case）"
- **验收命令**：`curl .../relay-runs | jq '.[0] | keys | map(test("evaluateVerdict|judgeVerdict|costUsd|completedAt|failureReason")) | any'` → `false`

### DOD-2（对应 INV-2）：既有字段不得移除

- **断言**：列表响应每项仍含 `id`、`initiative_id`、`phase`、`started_at`、`deadline_at`、`orchestrator_heartbeat_at`、`orchestrator_host`、`pr_url`
- **测试**：`relay-runs.test.js`（N3 原始测试，全绿 = DOD-2 通过）
- **验收命令**：`curl .../relay-runs | jq '.[0] | has("id") and has("phase") and has("pr_url")'` → `true`

### DOD-3（对应 INV-3）：?phase= / ?limit= 过滤逻辑不变

- **断言**：`?phase=invalid_xyz` → 400 + `allowed` 数组含 10 项；`?limit=abc` → 400；`?limit=0` → 400；`?limit=5` → SQL 含参数 5
- **测试**：`relay-runs-filter.test.js`（N4 过滤测试，全绿 = DOD-3 通过）
- **验收命令**：`curl ".../relay-runs?phase=INVALID" | jq '.allowed | length'` → `10`

### DOD-4（对应 INV-4）：DB 失败 → 500 + JSON，进程不崩

- **断言**：mock DB 抛错时，响应 HTTP 500 + `{ error: string }` JSON；后续请求仍可处理
- **测试**：`relay-runs-verdicts.test.js` → "DB 失败时新字段测试不引入崩溃路径"（通过既有 500 测试覆盖）
- **验收命令**：已由 N3/N4 测试覆盖，回归即可

### DOD-5（对应 INV-5）：不带 ?phase 时 SQL 无 phase 条件

- **断言**：不带 `?phase` 时，捕获的 SQL 字符串不含 `phase = $N` 模式；参数数组不含任何枚举值
- **测试**：`relay-runs-filter.test.js` INV-5 测试组（全绿 = DOD-5 通过）
- **验收命令**：回归即可

### DOD-6（对应 INV-6）：新字段无值时返回 null，键必须存在

- **断言**：mock DB 返回五字段均为 `null` 时，响应每项的 `evaluate_verdict/judge_verdict/cost_usd/completed_at/failure_reason` 键存在，值为 `null`（不得 omit）
- **测试**：`relay-runs-verdicts.test.js` → "列表字段 null 语义：键存在，值为 null"
- **验收命令**：`curl .../relay-runs | jq '.[0] | has("evaluate_verdict")'` → `true`（即使值为 null）

### DOD-7（对应 INV-7）：pr_url 回退路径时四个新字段仍出现

- **断言**：当 mock pool.query 第一次抛含 `pr_url` 的错误（触发 colErr 回退分支），第二次成功返回含四字段的行，响应仍含 `evaluate_verdict/judge_verdict/cost_usd/completed_at/failure_reason`（pr_url 除外）
- **测试**：`relay-runs-verdicts.test.js` → "pr_url 回退路径（colErr 分支）时，四个新字段仍出现在响应中"
- **验收命令**：单测覆盖

### DOD-8（对应 INV-8）：所有状态码响应 Content-Type 均为 application/json

- **断言**：200/400/404/500 响应头 `content-type` 均 match `/application\/json/`
- **测试**：`relay-runs-filter.test.js` 铁律3 测试组（全绿 = DOD-8 通过）
- **验收命令**：`curl -si .../relay-runs | grep content-type` → `application/json`

---

## 通过标准

所有 8 条 DoD 均通过 = 本 Sprint 完成。

具体指标：
- [ ] `relay-runs-verdicts.test.js` 全部用例通过（新增合同测试）
- [ ] `relay-runs.test.js` 全部 8 条用例通过（N3 回归）
- [ ] `relay-runs-filter.test.js` 全部 30+ 条用例通过（N4 回归）
- [ ] CI brain-ci.yml 全绿
