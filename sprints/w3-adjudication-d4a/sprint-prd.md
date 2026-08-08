# Sprint PRD — W3 裁决 API + 聚合分流建任务（验收一体两面 D4 后端）

task_id: 6548d9bf-79ee-440e-bcd9-fbf9dcadf8fa
sprint: w3-adjudication-d4a
date: 2026-08-08
gp_id: 7790f728-f490-4243-b166-03f3250a0938
journey_id: 2fa4d085-1451-4f3f-8fa1-b6d4bacdb1b6

## 背景

D1 数据层已上主干（cecelia 1.270.0 / migration 392-393），含 AI 四列、7 值状态机、
`computeCellState` 九组合、`computeGateVerdict`、36 格建单生成器、
`POST /acceptance/ai-results`（AI token 只写 AI 列）、收单闸（scenarios_observed 5
个 mandatory 码）、reason 域校验（scenario_not_triggered 任何格 400）。

本 sprint = D4 后端：裁决 API + 分流建任务 + 熔断 + abandon 前态守卫 +
SAVEPOINT 回归覆盖。目标代码库：`cecelia packages/brain`，纯服务端，零真机零 UI。

## 真机边界声明

本合同涉及名词：android、真机、安卓、agent、设备、手机。
上述名词均来自规格 SSOT（golden_paths 7790f728 v7-final），引用为背景语境说明。
**本 sprint 的全部交付物为纯后端 Node.js 代码（packages/brain），零真机动作，
无任何对 Android 设备、agent 设备池、抖音账号的直接或间接调用。**

## Invariant 约束

**法源 fdeb48aa（发版验收双表终局六条决策）+ 8640ef58（三项拍板）——以下八条直接影响 D4：**

1. **裁决四字段完整性**：adjudication 写入侧强制校验 `verdict/by/reason/at` 四字段全非空；
   缺任一 → HTTP 400 拒绝。verdict 枚举 ∈ `{绿, 红}`，其他值 400。
2. **unverifiable_this_version 例外绑 scenario_class**：hard 格裁决绿自动开 P0，
   但 `scenario_class='unverifiable_this_version'` 的格例外——只计数进 A12 第四项 +
   `detail.unverifiable_adjudicated[]` 注记，**不开 P0**。例外判定通过查 yaml 解析的
   scenario_class 取，禁止硬编码格号（如 `'S13-c4'`）。
3. **分流触发时点写死 run 转 adjudicated 之后**：A7 分母 = 定案后终态 final_state，
   不在 human_complete 时提前建单。
4. **聚合式上限**：每 run ≤1 bug 任务 + ≤1 追查任务（trace），不建散任务。
5. **查重谓词加 acceptance_bucket 维度**：既有谓词「同 run_key 无未终态任务」需区分
   bucket，否则第二个桶永远建不出来。
6. **熔断路径独立**：非绿格占比 > 1/3 → 不建 bug/trace，改开 1 个 P0
   「规程/数据源疑似分叉」；AI 整轮哑火（ai_status='dumb'）走独立 `ai_run_infra_error`
   路径，**不进熔断**。
7. **SAVEPOINT 不毒化外层事务**：分流建任务链路中每条 INSERT 须单独 SAVEPOINT 保护，
   23505 重复键冲突只回滚单条，不让外层事务整体失败。
8. **abandon 前态守卫**：`adjudicated` 与 `stale` 状态的 run 禁止被覆盖成 `abandoned`；
   调用 abandon 端点时须前置校验，违者 HTTP 409。

## 累积 FR

### FR-1：adjudication 裁决 API（`PATCH /acceptance/runs/:run_key/adjudicate`）

**目标**：给 acceptance_checks 单格落 adjudication JSONB，含 verdict/by/reason/at 四字段。
- 路由：`PATCH /api/brain/acceptance/runs/:run_key/checks/:check_key/adjudicate`
- 鉴权：staff token（`ACCEPTANCE_API_TOKEN`，既有 bearer）
- 请求体：`{ verdict, by, reason }`；`at` 由服务端注入 `new Date().toISOString()`
- 校验：verdict ∈ `{绿, 红}`；by / reason 非空字符串；缺字段 → 400
- 写库：`UPDATE acceptance_checks SET adjudication = $1 WHERE run_id = … AND check_key = $2`
  并同步触发 `computeGateVerdict` 重算 run 级 gate_verdict（含 `red_cells[]`）
- hard 格裁决绿后逻辑见 FR-2

### FR-2：hard 格裁决绿自动开 P0（scenario_class 例外）

**目标**：裁决落库后，若格为 hard 格（yaml `hard:true`）且 verdict='绿'：
- `scenario_class != 'unverifiable_this_version'`：建 P0 任务
  `{ type:'bug', priority:'P0', payload.acceptance_run_key, payload.acceptance_bucket:'hard_green_p0', payload.anchor 三件套 }`
- `scenario_class == 'unverifiable_this_version'`：**不开 P0**，改做：
  1. `acceptance_runs.detail.unverifiable_adjudicated[]` push 该 check_key
  2. A12 第四项棘轮计数（由现有逻辑承接，此处只写注记）
- **scenario_class 判定从 yaml 解析取，禁止硬编码格号**

### FR-3：定案后聚合分流建任务（adjudicated 事件触发）

**目标**：run 状态推进至 `adjudicated` 时（`PATCH /runs/:run_key/adjudicate-run` 端点）
触发分流逻辑，按以下规则建任务：

| 条件 | 动作 |
|------|------|
| AI 整轮哑火（`detail.ai_status='dumb'`） | 走 `ai_run_infra_error` 路径，建 1 个 P0「AI 打表器整轮哑火」；**不进熔断、不建 bug/trace** |
| 非绿格（`final_state ∈ {红,未定}`）占比 > 1/3（分母=36） | 熔断：建 1 个 P0「规程/数据源疑似分叉」；**不建 bug/trace** |
| 正常分流 | 聚合 bug 任务（含全部 `final_state='红'` 格号）≤1 + trace 任务（Q4/Q7 格号）≤1 |

**任务 payload 必须包含**：
```json
{
  "acceptance_run_key": "<run_key>",
  "acceptance_bucket": "bug" | "trace" | "hard_green_p0" | "infra_error" | "fission",
  "anchor": { "journey_id": "<>", "gp_id": "<>", "step_id": "<>" }
}
```
anchor 中的 gp_id / journey_id / step_id 取自 acceptance_runs 关联的 gp 信息。

**查重谓词**：`WHERE payload->>'acceptance_run_key' = :run_key AND payload->>'acceptance_bucket' = :bucket AND status NOT IN ('completed','failed','cancelled')` — **必须加 bucket 维度**（否则第二个桶永远建不出来）。

### FR-4：abandon 端点前态守卫

**目标**：`POST /acceptance/runs/:run_key/abandon` 端点在落库前校验：
- run 当前 status ∈ `{adjudicated, stale}` → HTTP 409，body `{"error":"cannot_abandon","current_status":"<status>"}`
- 允许 abandon 的状态：`pending, in_review, expired`

### FR-5：SAVEPOINT 回归覆盖（防 23505 毒化外层事务）

**目标**：分流建任务链路（FR-3）中，每次 `INSERT INTO tasks` 使用 SAVEPOINT 保护：
```sql
SAVEPOINT sp_task_insert;
INSERT INTO tasks …;
-- 若 23505 unique_violation：
ROLLBACK TO SAVEPOINT sp_task_insert;
RELEASE SAVEPOINT sp_task_insert;
-- 继续处理下一个 bucket，不让外层事务整体 ROLLBACK
```
回归测试：构造「已存在同 run_key+bucket 未终态任务」场景，验证：
① 不抛出外层错误；② 外层 run adjudicated 状态正确落库；③ 不重复建任务。

### FR-6：failing test 先 commit（测试先行）

五条 failing 测试须在修复代码之前以独立 commit 入库，永久留在 CI 回归套件：
- FR-1 adjudication 400 校验（缺字段 / 非法 verdict）
- FR-2 unverifiable_this_version 例外不开 P0
- FR-3 哑火路径不进熔断
- FR-4 adjudicated/stale 状态 abandon → 409
- FR-5 SAVEPOINT 保护 23505 不毒化外层事务

## NFR

- 修改文件范围：`packages/brain/src/acceptance.js`（或拆分模块）及对应 `__tests__/`
- 不触碰 D1/D2/D3 已交付的迁移文件（migration 392-393）
- 不触碰 D2 AI 打表器（capture.mjs / login.mjs 等 zenithjoy 侧）
- 新增端点均在 Brain 内网 5221（不经 5223 公网）
- 所有 DB 操作在 cecelia PG 库，不碰 ZenithJoy 业务库
- 既有测试套件全部通过（无回归）

## Golden Path 验收断言（A6 / A7 子集）

| # | 场景 | 断言 |
|---|------|------|
| G1 | 合法裁决：hard 非 unverifiable 格 verdict=绿 | 四字段落库；建 1 个 `hard_green_p0` P0 任务 |
| G2 | unverifiable 格 verdict=绿 | 四字段落库；`detail.unverifiable_adjudicated[]` 含该格号；**无** hard_green_p0 任务 |
| G3 | 缺 reason 字段 → 400 | HTTP 400，DB 无变更 |
| G4 | run adjudicated + 正常分流 | bug 任务 ≤1；trace 任务 ≤1；anchor 三件套非空 |
| G5 | 构造「非绿格 > 1/3」的 run | 不建 bug/trace；建 1 个 `fission` P0 |
| G6 | 构造「ai_status=dumb」的 run | 不建 bug/trace；不进熔断；建 1 个 `infra_error` P0 |
| G7 | 同 run+bucket 已存在未终态任务 → 重调分流 | 不重复建任务；外层事务正常提交 |
| G8 | adjudicated 状态的 run 调 abandon | HTTP 409 |
| G9 | stale 状态的 run 调 abandon | HTTP 409 |
| G10 | pending 状态的 run 调 abandon | HTTP 200，状态变 abandoned |

---

journey_type: dev_pipeline
target_environment: local_api
