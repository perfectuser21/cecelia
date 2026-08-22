# Sprint Contract Draft (Round 1)

**Sprint**: publisher 纳入 INFRA_RETRY_ACTION_BY_ROLE — runner_failure 有界重派，不再 route_unknown
**journey_type**: autonomous
**target_environment**: local_api（纯 Brain 编排单测：从仓库根跑 vitest 直跑 derive.js；本 sprint runtime_resources.postgres=false，无 DB / 无 HTTP 端点）

gp-anchor: skipped (product-map.json not found)
contract-gate: cecelia worktree（packages/brain/src/lib/contract-gate.js 存在），本合同 E2E/BEHAVIOR 均为 vitest 真跑 + exit code 断言，无 curl/psql，不触发 API/DB 类 gate 规则。

## 锚定父路声明

覆盖父路 F1「工厂·开发闭环」第 3 步「造完真验」（journey_id e6f803f2-8c48-4cce-a7a1-5b1bda5e9c29 / step F1-step3）。

## Response Schema（推导来源: PRD 字面 + 代码 SSOT）

N/A — 任务无 HTTP 响应。本 sprint 是 `packages/brain/src/orchestrator/derive.js` 的纯内部编排决策改动，
无新增/修改 API 端点。被验证对象是纯函数 `derive(observed)` 的返回对象形状：

```json
{ "phase": "publish", "action": "publish:approved_ref", "reason": "callback_runner_failure_retry" }
```

字段来源均为代码 SSOT，非新造：
- `phase: "publish"` / `action: "publish:approved_ref"` — 来自 `ACTION.PUBLISH_APPROVED_REF`
  （`packages/brain/src/orchestrator/constants.js:64` = `'publish:approved_ref'`），与 derive.js:1358 publisher 既有 action 一致。
- `reason: "callback_runner_failure_retry"` — 来自 derive.js runner_failure 分支既有 retry 文案（derive.js:600）。

## Golden Path

[publisher attempt callback: status=failed, failure_class=runner_failure, role=publisher, priorRunnerFailures<2]
→ [derive 走 runner_failure 分支 → infrastructureRetryForCallback('publisher', …) 查 INFRA_RETRY_ACTION_BY_ROLE]
→ [命中 publisher 表项 → 返回 { phase:'publish', action:'publish:approved_ref', reason:'callback_runner_failure_retry' }，不再 route_unknown]

---

### Step 1: publisher runner 起不来，callback 回 runner_failure
**来源**: `[FROM_PRD]` — PRD「Golden Path」第 1 点：`status=failed, failure_class=runner_failure, role=publisher`，且本 run 之前 publisher runner_failure 次数 < 2。

**可观测行为**: derive 收到该 callback 后进入 runner_failure 分支（derive.js:575），而非通用 mark_failed。

**验证命令**:
```bash
# 见 ## E2E 验收 段：真 derive 对 publisher runner_failure 首次 callback 的返回 phase 不为 'failed'/'review'
npx vitest run sprints/08221235-kernel-3354cd28/tests/publisher-runner-failure-retry.test.js --no-cache -t "不判 run 终态"
```

**硬阈值**: derive 返回 `phase != 'failed'` 且 `action != 'mark_failed'`（对应验证命令 exit 0）。

---

### Step 2: derive 查 INFRA_RETRY_ACTION_BY_ROLE 命中 publisher 表项
**来源**: `[FROM_PRD]` — PRD「范围限定/在范围内」：`INFRA_RETRY_ACTION_BY_ROLE` 增加一行 `publisher: { phase: 'publish', action: ACTION.PUBLISH_APPROVED_REF }`。

**可观测行为**: `infrastructureRetryForCallback('publisher', …)`（derive.js:270，非 generator 分支直取 `INFRA_RETRY_ACTION_BY_ROLE[role]`）不再返回 undefined，而是返回 `{ phase:'publish', action:'publish:approved_ref' }`。

**验证命令**:
```bash
npx vitest run sprints/08221235-kernel-3354cd28/tests/publisher-runner-failure-retry.test.js --no-cache -t "publish 重派动作"
```

**硬阈值**: derive 返回对象 `toMatchObject({ phase:'publish', action:'publish:approved_ref', reason:'callback_runner_failure_retry' })`（对应验证命令 exit 0）。

---

### Step 3: 返回 publish 重派动作，reason 不再 route_unknown（出口）
**来源**: `[FROM_PRD]` — PRD「Golden Path」第 3 点：`reason` 不再是 `callback_runner_failure_route_unknown`，同 run 有界重派 publisher。

**可观测行为**: derive 返回的 `reason === 'callback_runner_failure_retry'`，明确区别于 baseline 的 `callback_runner_failure_route_unknown`。

**验证命令**:
```bash
# RED 证据：baseline（未加表项）此断言 FAIL —— publisher 落 phase='review' reason=callback_runner_failure_route_unknown
npx vitest run sprints/08221235-kernel-3354cd28/tests/publisher-runner-failure-retry.test.js --no-cache -t "publish 重派动作"
```

**硬阈值**: `reason == 'callback_runner_failure_retry'` 且 `reason != 'callback_runner_failure_route_unknown'`（对应验证命令 exit 0）。

---

### Step 4（边界·守恒）: 超限第 3 次仍进人审，补表不改超限兜底
**来源**: `[FROM_PRD]` — PRD「边界情况/超限」：priorRunnerFailures ≥ 2 → 仍走 `callback_runner_failure_exhausted` 进人审。

**可观测行为**: 第 3 次 publisher runner_failure callback，derive 在查表之前就短路（derive.js:582 `priorRunnerFailures >= 2`）→ 返回 `wait:human_review` / `callback_runner_failure_exhausted`。

**验证命令**:
```bash
npx vitest run sprints/08221235-kernel-3354cd28/tests/publisher-runner-failure-retry.test.js --no-cache -t "超限守恒"
```

**硬阈值**: derive 返回 `{ phase:'review', action:'wait:human_review', reason:'callback_runner_failure_exhausted' }`（对应验证命令 exit 0）。

---

## 已知约束

### 来自回归测试（Step 1.2）
- [tests/gp/f1/step3-runner-failure-retry.test.js] → evaluator/generator runner_failure（首次）→ 同 run 重派同角色，reason=callback_runner_failure_retry；第 3 次 → callback_runner_failure_exhausted 进人审；product 类失败（无 failure_class）/cancelled 照旧判终态。**本 sprint 只补 publisher，不得回退这些既有角色行为**（回归守恒断言 B-05 守卫 evaluator）。
- [tests/gp/f1/step3-seal-test-contract-table-required.test.js] → 合同缺 `## Test Contract` 表 / rows=0 触封印校验拒绝（#5019 / 1.273.118）；本合同自身满足此闸（下方 Test Contract 表登记冻结测试）。

### 累积 FR（PRD「累积 FR」段，本 sprint 不得回退/重复）
- runner_failure 有界重派: evaluator/judge/generator 等角色 runner_failure 首次→同 run 重派同角色（reason=callback_runner_failure_retry），第 3 次→进人审（callback_runner_failure_exhausted）。本 sprint 只补 publisher。
- 封印强制表登记: 合同缺 `## Test Contract` 表拒封印打回 proposer；本合同须自身满足此闸。
- context-manifest: unavailable（runtime_resources.postgres=false，Brain API 端点在本 fleet-worker 会话不可达；累积 FR 以 PRD 内嵌段为准）。

### Unified Map
- [MAP_NOT_CONFIGURED]（task.payload 未配置 map_scope/map_repo；must_run_assertions 为空）。

## 八要素需求规范

| 要素 | 说明 | 本次答案 |
|------|------|----------|
| **FR（做什么）** | 系统对外承诺 | publisher runner_failure（priorRunnerFailures<2）→ derive 返回 publish 有界重派动作，不再 route_unknown 进人审 |
| **NFR（做得多好）** | 性能/可靠性阈值 | 重派 ≤2 次（沿用既有 priorRunnerFailures 口径，不新增额度）；derive 为纯函数，单次调用 <10ms |
| **Invariant（永不违反）** | 不变量 | ①runner_failure 有界重派同角色 ≤2 次，超限进人审，不轮换账号、不无限重试；②基础设施重派复用同角色相位/动作，不变更执行身份；③补表不改超限兜底与其他角色分支 |
| **判定点（怎么知道）** | 对模糊现实的判断 | 见下方登记表 |
| **保质期（何时过期）** | 何时失效 | N/A — 编排决策表项，随 kernel 长期有效，无 token/时效退役 |
| **死亡告警（停了谁知道）** | 停摆谁知道 | 若 publisher 重派链回退，回归测试 B-01/B-02（sprint 冻结测试 + CI Sprint Tests 实跑）会红；生产侧 derive reason=route_unknown 会重新出现在 decision log |
| **失败语义（挂了怎么办）** | 故障放行/拦截 | runner_failure=基础设施故障，非产品失败：首次/第 2 次同 run 重派（不判终态），第 3 次拦截进人审（不静默无限重试）。重派幂等键沿用 run 内 priorRunnerFailures 计数 |
| **效果确认（已发≠已生效）** | 回执确认 | derive 返回对象即回执：`reason` 字段三态可区分（route_unknown / retry / exhausted）；冻结测试对三态各有断言 |

### 判定点登记表

（本任务无接缝判定点，N/A）
> 说明：本 sprint 为纯函数 derive 编排决策，输入是结构化 decisionLog，无 RPA/真机/外部真实状态推断接缝；failure_class=runner_failure 由上游 callback 明确给出，非本 sprint 推断。

### 失败语义声明

| 场景 | 失败行为 | 重试幂等？ | 降级策略 |
|------|----------|-----------|----------|
| publisher runner_failure 首次/第 2 次 | 不判 run 终态，同 run 重派 publisher（phase=publish, action=publish:approved_ref） | 是（幂等键=run 内 priorRunnerFailures 计数，≤2） | 有界重派 |
| publisher runner_failure 第 3 次（≥2 prior） | 进人审 wait:human_review | 是（短路于查表前，语义守恒） | 人工兜底，不无限重试 |
| publisher 普通 failed（无 failure_class） | 照旧 mark_failed（callback_failed） | N/A | 不被本次放宽触碰 |

### 输入对抗面

N/A — 本 sprint 不涉及对外暴露 agent / 外部可写入接口；derive 输入为 kernel 内部编排 observed 结构。

## 禁 mock 边清单

- attempt callback(runner_failure, role=publisher) ↔ derive 决策边（本单改了 derive 对 publisher runner_failure 的路由分支）：冻结测试必须真调 `derive(observed)`，**禁止** stub/mock `attemptCallbackRoute` / `infrastructureRetryForCallback` / `INFRA_RETRY_ACTION_BY_ROLE`。测试直接构造真实 decisionLog 喂进 real `derive`，断言其真实返回对象（本单属状态机 / 派发决策 / 生命周期钩子类，全 mock 单测结构性抓不到接缝断裂）。
> 说明：本 sprint runtime_resources.postgres=false，derive 为纯函数、无 DB 写路径，故禁 mock 边仅此一条（代码↔代码的路由决策边）；无跨节点 DB 时间窗断言需求。

## Test Contract

| Behavior | Test File | Case（it 名字面子串） | 预期红证据 |
|---|---|---|---|
| publisher runner_failure 首次 → derive 返回 publish 重派（GREEN 目标） | `sprints/08221235-kernel-3354cd28/tests/publisher-runner-failure-retry.test.js` | `publish 重派动作` | baseline 缺表项 → phase='review' reason=callback_runner_failure_route_unknown → 断言 FAIL（RED） |
| publisher runner_failure 首次不判 run 终态 | `sprints/08221235-kernel-3354cd28/tests/publisher-runner-failure-retry.test.js` | `不判 run 终态` | GREEN 后 phase != failed |
| 超限守恒：第 3 次 publisher runner_failure 进人审 | `sprints/08221235-kernel-3354cd28/tests/publisher-runner-failure-retry.test.js` | `超限守恒` | 守恒断言（补表前后均绿）|
| 负向：publisher 普通 failed 照旧判终态 | `sprints/08221235-kernel-3354cd28/tests/publisher-runner-failure-retry.test.js` | `负向` | 守恒断言（补表前后均绿）|
| 回归守恒：evaluator runner_failure 首次仍重派 evaluator | `sprints/08221235-kernel-3354cd28/tests/publisher-runner-failure-retry.test.js` | `回归守恒` | 累积 FR 不回退（补表前后均绿）|

> Test File 列为完整真实路径（冻结测试落 `sprints/08221235-kernel-3354cd28/tests/`，已落盘并进 commit）。`tests/gp/f1/step3-runner-failure-retry.test.js` 为既有回归测试（补充引用，见「已知约束」），非本 sprint 冻结产物。

## E2E 验收（final-e2e 跑 — target_environment=local_api，纯 vitest 直跑 derive 单测）

> 本 sprint 无 DB / 无 HTTP 服务；E2E = 从仓库根用根 vitest 配置直跑 sprint 冻结测试（sprints/** 在根 vitest include 内，允许从仓库根 `npx vitest run`）。验收三点：RED 复现 route_unknown、GREEN 返回 publish 重派、超限守恒。

```bash
#!/bin/bash
set -euo pipefail
cd "${WORKSPACE_PATH:-/workspace}"

TEST_FILE="sprints/08221235-kernel-3354cd28/tests/publisher-runner-failure-retry.test.js"

# 1. GREEN 全量：合入 derive.js publisher 表项后，冻结测试全绿（5 tests passed）
OUT=$(npx vitest run "$TEST_FILE" --no-cache 2>&1)
echo "$OUT" | tail -20
echo "$OUT" | grep -qE "Tests[[:space:]]+5 passed" || { echo "FAIL: 冻结测试非 5 passed（GREEN 未达成）"; exit 1; }
echo "$OUT" | grep -q "No test files found" && { echo "FAIL: 未发现测试文件（路径/include 错）"; exit 1; } || true

# 2. GREEN 核心：publisher runner_failure 首次 → publish 重派动作，reason 不再 route_unknown
OUT2=$(npx vitest run "$TEST_FILE" --no-cache -t "publish 重派动作" 2>&1)
echo "$OUT2" | grep -qE "[1-9][0-9]* passed" || { echo "FAIL: publisher 重派动作断言未通过"; exit 1; }
echo "$OUT2" | grep -q "callback_runner_failure_route_unknown" && { echo "FAIL: 仍命中 route_unknown（表项未生效）"; exit 1; } || true

# 3. 超限守恒：第 3 次 publisher runner_failure 仍进人审 exhausted
OUT3=$(npx vitest run "$TEST_FILE" --no-cache -t "超限守恒" 2>&1)
echo "$OUT3" | grep -qE "[1-9][0-9]* passed" || { echo "FAIL: 超限守恒断言未通过"; exit 1; }

echo "✅ Golden Path 验证通过：publisher runner_failure 有界重派，不再 route_unknown；超限守恒"
```

## 探索提示（L3 探索层 — evaluator 剧本全过后执行）

探索预算: 10 分钟 / 15 动作（默认）
高风险面:
- 错输入: 构造 role='publisher' 但 failure_class 拼写变体（如 'runner-failure' / 'RUNNER_FAILURE'）→ 应落既有非 runner_failure 分支（不误命中重派），确认大小写/连字符不被宽松匹配。
- 重复提交: 连续两条 publisher runner_failure callback 但中间无 spawn:publisher 记录 → 确认 priorRunnerFailures 计数按 ATTEMPT_CALLBACK 行准确统计，不重复计。
- 中途中断: priorRunnerFailures 恰好 =2 的边界（第 3 次）→ 确认严格 `>= 2` 短路进人审，不出现 off-by-one 多重派一次。
- 边界值: role 字段缺失 / role='publisher' 但 status='blocked'（非 failed）→ 走 infrastructure_blocked 分支而非 runner_failure，确认不串线。
发现分级: P0/P1（重派额度突破 / route_unknown 回归 / 超限兜底失效）→ 阻塞 merge；P2/P3 → 记 findings 不阻塞。

## GP-Anchor

gp-anchor: skipped (product-map.json not found)
