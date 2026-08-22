# Sprint Contract Draft (Round 1)

Sprint: `08222322-kernel-69092ff0`
标题: runner_failure 有界重派计数按角色窗口化（priorRunnerFailures per-role）
journey_type: autonomous　target_environment: local_api

## 锚定父路声明

独立小路（无父路）—— 本 sprint 修 kernel `derive()` 纯函数决策窗口化（journey e6f803f2 / step
aad25bdb 的 planned 行为），不推进任何既有 done/working golden path 步骤。

## Response Schema（推导来源: PRD 字面）

N/A — 任务无 HTTP 响应。本 sprint 改动落在 `packages/brain/src/orchestrator/derive.js` 的
纯函数 `derive(observed)` 决策分支，无新增/变更端点，无 request/response body。验收对象是
`derive()` 返回对象 `{ phase, action, reason }`（内部路由决策，非对外 API）。

## 已知约束

**回归测试（Step 1.2）**：
- [packages/brain/src/orchestrator/__tests__/derive.test.js] → `runner failure retries bounded（首次重派，第 3 次进人审，不再一刀终态）`（同角色有界重派 ≤2、第 3 次 exhausted 语义——本 sprint 负向红线，不得回退）
- [同上] → `only infrastructure_blocked callback can retry the same role on another target`（infrastructure_blocked 分支独立，本 sprint 不触碰）

**累积 FR（[累积FR]）**：本 line journey golden-paths 均为 planned，无已验收历史行为可累计（PRD 明示）。

**Unified Map**：`[MAP_NOT_CONFIGURED]` — task.payload 无 map_scope/map_repo，跳过 radius 断言，不回退领域硬编码。

## Golden Path

[收到 runner_failure 回调] → [按当前角色 R 窗口化统计历史 runner_failure] → [同角色 ≤2 次重派、跨角色互不占用]

### Step 1: attempt_callback 到达 derive，status=failed && failure_class=runner_failure，callbackDetail(row).role = R
**来源**: `[FROM_PRD]` — PRD「Golden Path」第 1 步 + 范围限定直接定义。

**可观测行为**: `derive()` 进入 runner_failure 分支，以本行 callback 的 role（`role` = `callbackDetail(row).role`，line ~473 destructure）为窗口键。

**验证命令**:
```bash
npx vitest run sprints/08222322-kernel-69092ff0/tests/runner-failure-role-window.test.js -t "跨角色 runner_failure 不再互耗额度" --reporter=dot 2>&1 | grep -q "1 passed (1)"
# 期望：exit 0（修复后）
```
**硬阈值**: 该用例 GREEN（修复后 `1 passed (1)`）。

---

### Step 2: priorRunnerFailures 只统计同角色（callbackDetail(r).role === role）的历史 runner_failure
**来源**: `[FROM_PRD]` — PRD「范围限定·在范围内」：filter 增加同角色过滤条件；ASSUMPTION 指定角色取自 `callbackDetail(row).role`。

**可观测行为**:
- 同角色 R 累计 <2 → 重派（`reason=callback_runner_failure_retry`，phase/action 由 `infrastructureRetryForCallback(R,...)` 给出；publisher → `publish/publish:approved_ref`）
- 同角色 R 累计 ≥2 → 进人审（`reason=callback_runner_failure_exhausted`，语义不变）
- 其它角色的 runner_failure 不计入角色 R 的窗口
- 缺 role 字段的历史行 `callbackDetail(r).role === undefined ≠ R` → 不计入（等价旧行为保守子集）

**验证命令**:
```bash
# 跨角色不互耗：evaluator 2 败后 publisher 首败仍重派
npx vitest run sprints/08222322-kernel-69092ff0/tests/runner-failure-role-window.test.js -t "跨角色 runner_failure 不再互耗额度" --reporter=dot 2>&1 | grep -q "1 passed (1)"
# 缺 role 历史行不计入
npx vitest run sprints/08222322-kernel-69092ff0/tests/runner-failure-role-window.test.js -t "缺 role 字段的历史 runner_failure 行不计入当前角色窗口" --reporter=dot 2>&1 | grep -q "1 passed (1)"
```
**硬阈值**: 两用例均 GREEN。

---

### Step 3: 同角色 ≤2 重派、跨角色互不占用（出口）——负向语义不变
**来源**: `[FROM_PRD]` — PRD「边界情况·同角色 3 连败：仍在第 3 次进人审」+ Invariant「额度语义」。

**可观测行为**: 同一角色（如 publisher）3 连 runner_failure，第 3 次仍返回
`{ phase:'review', action:'wait:human_review', reason:'callback_runner_failure_exhausted' }`；既有
`runner failure retries bounded` 回归保持绿。

**验证命令**:
```bash
npx vitest run sprints/08222322-kernel-69092ff0/tests/runner-failure-role-window.test.js -t "同角色 runner_failure 3 连败第 3 次仍进人审" --reporter=dot 2>&1 | grep -q "1 passed (1)"
( cd packages/brain && npx vitest run src/orchestrator/__tests__/derive.test.js -t "runner failure retries bounded" --no-cache --reporter=dot 2>&1 ) | grep -q "1 passed (1)"
```
**硬阈值**: 两条均 GREEN，负向语义未放宽。

---

## 禁 mock 边清单

本单改动属「状态机 / 跨阶段决策计数」类（derive 路由 + 读 decisionLog 历史行），故：

- `derive()` ↔ `decisionLog` 历史行（本单改 `priorRunnerFailures` 对 decisionLog 的统计口径，测试必须真调 `derive(observed)`，喂真实内存 decisionLog，**禁止** stub/mock `derive`、`callbackDetail`、`infrastructureRetryForCallback`、`latestUnconsumedAttemptResult` 任一被改路径上的函数）

无 DB 边（`derive` 为纯函数，不触碰 Postgres；runtime_resources.postgres=false 与之一致）。合同 tests/ 内无 `vi.mock`/`stub` 命中上述边（机械 grep 可核）。

## 真实调用方请求 shape

N/A — 本单无设备/agent 调服务端路径，`derive` 是 kernel 内部纯函数，无外部调用方 request shape。

## 未覆盖真实链路清单

（本合同无 mock 豁免，N/A）——三条 BEHAVIOR 均真调 `derive()` 真逻辑，无 force_*/stub/假数据。

## 八要素需求规范

| 要素 | 说明 | 本次答案 |
|------|------|----------|
| **FR（做什么）** | 功能需求 | `priorRunnerFailures` 只统计与当前 callback 同角色（`callbackDetail(r).role === role`）的历史 runner_failure 行 |
| **NFR（做得多好）** | 非功能 | 纯函数，无 I/O；每角色重派额度 ≤2，超限进人审兜底 |
| **Invariant（永不违反）** | 不变量 | 同角色累计语义不变（3 连败第 3 次仍 exhausted，不得因窗口化放宽）；仅新增过滤，不改阈值/路由/其它 failure_class 分支 |
| **判定点（怎么知道）** | 判断假设 | 见判定点登记表 |
| **保质期（何时过期）** | 失效 | 长期规则，随 derive 路由表演进；无 token/数据过期 |
| **死亡告警（停了谁知道）** | 告警 | 冻结合同测试 + 既有 derive 回归进 CI（Sprint Tests / brain-ci），回退即红 |
| **失败语义（挂了怎么办）** | 故障 | 见失败语义声明 |
| **效果确认（已发≠已生效）** | 回执 | `derive()` 返回 `{phase,action,reason}` 即时可断言（同步纯函数），无异步生效延迟 |

### 判定点登记表

| 判定点 | 候选方法 | 所选方法 | 依据 | 误判后果 |
|--------|----------|----------|------|----------|
| ⚠️ 历史 runner_failure 归属哪个角色窗口 | A. 用当前 callback 的 role 逐行比对 `callbackDetail(r).role`；B. 不区分角色全 run 累计（旧行为） | A. 同角色比对 | 全 run 累计会让早期角色抖动误耗后期角色额度（r40/r45/r50 实证） | 一次瞬时抖动即 exhausted 进人审，破坏零人碰闭环（面客/流程停滞） |
| 缺 role 字段的历史行如何处置 | A. 不匹配任何具体角色，不计入；B. 视为通配计入 | A. 不计入（`undefined !== R`） | 保守等价旧行为子集，避免误耗 | 若计入则退化回跨角色误耗 |

> `judgment-pending-user`: 无（PrepPRD 阶段窗口化方向已在 PRD Golden Path/Invariant 明确，属确定性 kernel 规则）。

### 失败语义声明

| 场景 | 失败行为 | 重试幂等？ | 降级策略 |
|------|----------|-----------|----------|
| 同角色 runner_failure 累计 ≥2 | 返回 `wait:human_review` / `callback_runner_failure_exhausted`（拦截，不重派） | 是（derive 纯函数，同输入同输出） | 人审兜底 |
| 同角色累计 <2 | 返回同角色重派（`callback_runner_failure_retry`） | 是 | 有界重试，超限即上一行 |
| decisionLog 缺 role 字段 | 该行不计入当前角色窗口（保守） | 是 | 等价旧行为保守子集 |

### 输入对抗面

N/A — 无对外暴露 agent；`derive` 输入为 kernel 内部可信 observed（decisionLog 由 Brain 自身 append-only 写入），非外部用户可写入。

## GP-Anchor

gp-anchor: skipped (product-map.json not found)

## Test Contract

| 功能 | Test File | BEHAVIOR 覆盖 | 预期红证据 |
|---|---|---|---|
| 跨角色不互耗 + 缺 role 不计入 + 同角色 3 连败 exhausted（冻结主测试） | `sprints/08222322-kernel-69092ff0/tests/runner-failure-role-window.test.js` | 跨角色 runner_failure 不再互耗额度 / 缺 role 字段的历史 runner_failure 行不计入当前角色窗口 / 同角色 runner_failure 3 连败第 3 次仍进人审 | → 2 failures（跨角色、缺 role 两用例；同角色用例现码即绿） |
| 同角色有界重派负向回归（既有仓库测试，补充行） | `packages/brain/src/orchestrator/__tests__/derive.test.js` | runner failure retries bounded | → 0 failures（修复后仍绿，语义不变） |

> 说明：两行「BEHAVIOR 覆盖」均逐词取自对应测试文件真实 `it()` 名的字面子串，多值以 `/` 分隔；含 repo 路径行（#5027 1.273.123 封印时机械同尺校验）。冻结主测试落 `sprints/.../tests/`，随本轮 commit 冻结。

## E2E 验收（最终 final-e2e 跑 — target_environment=local_api）

**journey_type**: autonomous
**target_environment**: local_api（纯 kernel 后端逻辑，node/vitest 单测断言 derive 输出；本单为纯函数，无 DB 依赖，postgres 未注入与之一致，无需 migration/bootstrap）

```bash
#!/bin/bash
set -euo pipefail
cd "${WORKSPACE_PATH:-/workspace}"
FROZEN="sprints/08222322-kernel-69092ff0/tests/runner-failure-role-window.test.js"

# 1. 冻结合同测试全绿（修复后三条全过）
npx vitest run "$FROZEN" --reporter=dot 2>&1 | grep -q "3 passed (3)" || { echo "FAIL: 冻结合同测试未全绿"; exit 1; }

# 2. 跨角色误耗已修：evaluator 2 败后 publisher 首败仍重派
npx vitest run "$FROZEN" -t "跨角色 runner_failure 不再互耗额度" --reporter=dot 2>&1 | grep -q "1 passed (1)" || { echo "FAIL: 跨角色重派未生效"; exit 1; }

# 3. 缺 role 历史行不计入当前角色窗口
npx vitest run "$FROZEN" -t "缺 role 字段的历史 runner_failure 行不计入当前角色窗口" --reporter=dot 2>&1 | grep -q "1 passed (1)" || { echo "FAIL: 缺 role 历史行被误计入"; exit 1; }

# 4. 负向语义不变：同角色 3 连败第 3 次仍 exhausted
npx vitest run "$FROZEN" -t "同角色 runner_failure 3 连败第 3 次仍进人审" --reporter=dot 2>&1 | grep -q "1 passed (1)" || { echo "FAIL: 同角色 exhausted 语义被放宽"; exit 1; }

# 5. 既有 derive 有界重派回归保持绿（bounded 语义无回退）
( cd packages/brain && npx vitest run src/orchestrator/__tests__/derive.test.js -t "runner failure retries bounded" --no-cache --reporter=dot 2>&1 ) | grep -q "1 passed (1)" || { echo "FAIL: 既有 derive 有界重派回归红"; exit 1; }

echo "✅ Golden Path 验证通过"
```

## 探索提示（L3 探索层 — evaluator 剧本全过后执行）

探索预算: 10 分钟 / 15 动作（默认）
高风险面:
- 错输入: decisionLog 中 role 为空串 `""` / 大小写不一致（如 `Publisher` vs `publisher`）的历史 runner_failure 行——确认严格相等不误匹配（不计入当前角色窗口）
- 重复提交: 同角色第 2 次重派边界（累计=1 时重派、累计=2 时 exhausted），off-by-one 是否正确落在「第 3 次进人审」
- 中途中断: 混合 failure_class（同角色掺入 infrastructure_blocked / account_exhausted 行）时，runner_failure 窗口是否只数 runner_failure（不被其它 class 污染）
- 边界值: 单角色首败（0 prior）必重派；跨多角色交错（evaluator/generator/publisher 各 1-2 败）互不占用
发现分级: P0/P1（同角色语义放宽 / 跨角色仍误耗 / 阈值漂移）→ 阻塞 merge；P2/P3 → 记 findings 不阻塞
