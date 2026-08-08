# Contract Draft — W3 裁决 API + 聚合分流建任务（D4 后端）

sprint: w3-adjudication-d4a
task_id: 6548d9bf-79ee-440e-bcd9-fbf9dcadf8fa
date: 2026-08-08
round: 2

## 范围

本合同覆盖 `packages/brain` 纯后端交付，零真机、零 UI：
- FR-1：`PATCH /api/brain/acceptance/runs/:run_key/checks/:check_key/adjudicate` 裁决写入
- FR-2：hard 格裁决绿自动开 P0（`unverifiable_this_version` 例外）
- FR-3：`PATCH /api/brain/acceptance/runs/:run_key/adjudicate-run` 定案后聚合分流建任务
- FR-4：`PATCH /api/brain/acceptance/runs/:run_key/abandon` 前态守卫（adjudicated/stale → 409）
  （注：PRD FR-4 原文写 POST，但测试实现统一使用 .patch()，合同以 PATCH 为准——abandon 是状态变更，语义上更符合 PATCH 幂等语义）
- FR-5：分流建任务 SAVEPOINT 保护，23505 冲突不毒化外层事务

## 技术断言

### FR-1：adjudication API 校验

| 断言 | 验证方式 |
|------|----------|
| verdict 字段缺失 → HTTP 400 | 单元测试 |
| by 字段缺失 → HTTP 400 | 单元测试 |
| reason 字段缺失 → HTTP 400 | 单元测试 |
| verdict ∉ {绿,红} → HTTP 400 | 单元测试 |
| 合法请求 → HTTP 200，adjudication JSONB 含四字段（verdict/by/reason/at） | 单元测试 |
| at 字段由服务端注入（ISO 8601 格式） | 单元测试 |
| 触发 computeGateVerdict 重算 gate_verdict | 单元测试 |

### FR-2：hard 格裁决绿 P0 自动开单

| 断言 | 验证方式 |
|------|----------|
| hard 格且 scenario_class != 'unverifiable_this_version' → 建 1 个 hard_green_p0 任务 | 单元测试 |
| hard 格且 scenario_class == 'unverifiable_this_version' → 不建任何任务 | 单元测试 |
| unverifiable 例外：detail.unverifiable_adjudicated[] 含该 check_key | 单元测试 |
| scenario_class 从 yaml 解析取，禁止硬编码格号 | 代码审查 |

### FR-3：定案后聚合分流

| 断言 | 验证方式 |
|------|----------|
| ai_status='dumb' → 建 1 个 infra_error P0；不进熔断；不建 bug/trace | 单元测试 |
| 非绿格占比 > 1/3（分母 36）→ 建 1 个 fission P0；不建 bug/trace | 单元测试 |
| 正常分流 → bug 任务 ≤1，trace 任务 ≤1 | 单元测试 |
| 任务 payload 含 acceptance_run_key + acceptance_bucket + anchor 三件套 | 单元测试 |
| anchor.gp_id / journey_id / step_id 均非空 | 单元测试 |
| 查重谓词含 acceptance_bucket 维度（两个 bucket 都能独立建出） | 单元测试 |

### FR-4：abandon 前态守卫

| 断言 | 验证方式 |
|------|----------|
| status='adjudicated' 时调 abandon → HTTP 409 + body.current_status='adjudicated' | 单元测试 |
| status='stale' 时调 abandon → HTTP 409 + body.current_status='stale' | 单元测试 |
| status='pending' 时调 abandon → HTTP 200，状态变 abandoned | 单元测试 |
| status='in_review' 时调 abandon → HTTP 200，状态变 abandoned | 单元测试 |
| status='expired' 时调 abandon → HTTP 200，状态变 abandoned | 单元测试 |

### FR-5：SAVEPOINT 保护

| 断言 | 验证方式 |
|------|----------|
| 同 run_key+bucket 已存在未终态任务 → 不重复建任务 | 单元测试 |
| 23505 冲突后，外层 run 状态仍正确更新为 adjudicated | 单元测试 |
| 外层事务不抛出错误 | 单元测试 |

## E2E 验收

所有验收场景为纯 API 调用（localhost:5221），无浏览器、无真机。

### 场景 G1：hard 非 unverifiable 格裁决绿

```bash
# 前提：存在 run_key=test-run-g1，某格 check_key=S1-c1 为 hard 且 scenario_class != 'unverifiable_this_version'
PATCH /api/brain/acceptance/runs/test-run-g1/checks/S1-c1/adjudicate
Body: {"verdict":"绿","by":"staff-1","reason":"测试通过"}

# 断言：
# 1. HTTP 200
# 2. DB: acceptance_checks.adjudication->'verdict' = '绿'，四字段全非空
# 3. DB: tasks 表存在 payload->>'acceptance_bucket' = 'hard_green_p0' 且 run_key=test-run-g1
```

### 场景 G2：unverifiable 格裁决绿

```bash
# 前提：存在 run_key=test-run-g2，某格 scenario_class='unverifiable_this_version' 且 is_hard=true
# 格号由运行时从 yaml 解析获取，不可硬编码（Invariant-2）；
# 测试中通过 __UNVERIFIABLE_CHECK_KEY__ 变量指代，实际值在 beforeAll 从 yaml 读取。
PATCH /api/brain/acceptance/runs/test-run-g2/checks/__UNVERIFIABLE_CHECK_KEY__/adjudicate
Body: {"verdict":"绿","by":"staff-1","reason":"无法验证但绿"}

# 断言：
# 1. HTTP 200
# 2. DB: acceptance_checks.adjudication 四字段落库
# 3. DB: tasks 表 无 hard_green_p0 bucket 记录（run_key=test-run-g2）
# 4. DB: acceptance_runs.detail->'unverifiable_adjudicated' @> '"__UNVERIFIABLE_CHECK_KEY__"'
#    （__UNVERIFIABLE_CHECK_KEY__ 运行时替换为实际格号）
```

### 场景 G3：缺 reason 字段 → 400

```bash
PATCH /api/brain/acceptance/runs/test-run-g3/checks/S1-c1/adjudicate
Body: {"verdict":"绿","by":"staff-1"}

# 断言：HTTP 400，DB 无 adjudication 变更
```

### 场景 G4：run adjudicated 正常分流

```bash
PATCH /api/brain/acceptance/runs/test-run-g4/adjudicate-run
Body: {"by":"adjudicator-1"}

# 断言：
# 1. HTTP 200
# 2. DB: acceptance_runs.status = 'adjudicated'
# 3. DB: tasks 表 acceptance_run_key=test-run-g4 的 bug 任务 ≤1 条
# 4. DB: tasks 表 acceptance_run_key=test-run-g4 的 trace 任务 ≤1 条
# 5. DB: 每条任务的 payload 含 anchor.gp_id、anchor.journey_id、anchor.step_id（均非空）
```

### 场景 G5：非绿格 > 1/3 → 熔断

```bash
# 前提：构造 run 含 13 个红/未定格（>36*1/3=12）
PATCH /api/brain/acceptance/runs/test-run-g5/adjudicate-run
Body: {"by":"adjudicator-1"}

# 断言：
# 1. DB: tasks 表 acceptance_bucket='fission' 且 run_key=test-run-g5 存在 1 条
# 2. DB: tasks 表 无 bug/trace bucket（run_key=test-run-g5）
```

### 场景 G6：ai_status=dumb → 哑火路径

```bash
# 前提：acceptance_runs.detail->'ai_status' = '"dumb"'
PATCH /api/brain/acceptance/runs/test-run-g6/adjudicate-run
Body: {"by":"adjudicator-1"}

# 断言：
# 1. DB: tasks 表 acceptance_bucket='infra_error' 且 run_key=test-run-g6 存在 1 条
# 2. DB: tasks 表 无 bug/trace/fission bucket（run_key=test-run-g6）
```

### 场景 G7：SAVEPOINT 幂等重调

```bash
# 前提：run_key=test-run-g7 的 bug bucket 任务已存在（status=pending）
PATCH /api/brain/acceptance/runs/test-run-g7/adjudicate-run
Body: {"by":"adjudicator-1"}

# 断言：
# 1. HTTP 200（无错误）
# 2. DB: acceptance_runs.status = 'adjudicated'（外层事务成功）
# 3. DB: bug bucket 任务仍只有 1 条（无重复）
```

### 场景 G8：adjudicated 状态 abandon → 409

```bash
# 前提：run_key=test-run-g8，status=adjudicated
PATCH /api/brain/acceptance/runs/test-run-g8/abandon
Body: {"reason":"test","by":"user-1"}

# 断言：HTTP 409，body.error='cannot_abandon'，body.current_status='adjudicated'
```

### 场景 G9：stale 状态 abandon → 409

```bash
# 前提：run_key=test-run-g9，status=stale
PATCH /api/brain/acceptance/runs/test-run-g9/abandon
Body: {"reason":"test","by":"user-1"}

# 断言：HTTP 409，body.error='cannot_abandon'，body.current_status='stale'
```

### 场景 G10：pending 状态 abandon → 200

```bash
# 前提：run_key=test-run-g10，status=pending
PATCH /api/brain/acceptance/runs/test-run-g10/abandon
Body: {"reason":"test","by":"user-1"}

# 断言：HTTP 200，DB: acceptance_runs.status = 'abandoned'
```

## Test Contract

| Workstream | Test File | BEHAVIOR 覆盖 | 预期红证据 |
|---|---|---|---|
| FR-1 adjudication 400 校验 | `tests/d4-adjudication-contract.test.js` | `[BEHAVIOR-1]` | createAcceptanceInternalRouter 未实现 → 全失败，Red |
| FR-2 unverifiable 例外 | `tests/d4-adjudication-contract.test.js` | `[BEHAVIOR-2]` | 同上，Red |
| FR-3 哑火/熔断/正常分流 | `tests/d4-adjudication-contract.test.js` | `[BEHAVIOR-3]` | 同上，Red |
| FR-4 abandon 前态守卫 | `tests/d4-adjudication-contract.test.js` | `[BEHAVIOR-4]` | 同上，Red |
| FR-5 SAVEPOINT 保护 | `tests/d4-adjudication-contract.test.js` | `[BEHAVIOR-5]` | 同上，Red |

## 非功能要求

- 修改范围：`packages/brain/src/routes/acceptance.js`（或拆分模块）及对应测试
- 不碰 migration 392-393
- 既有测试套件全部通过（无回归）
- 所有端点在内网 5221，不经 5223
