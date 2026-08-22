# Sprint Contract Draft (Round 1) — runner_failure 有界重派计数按角色窗口化

**journey_type**: autonomous
**target_environment**: local_api（纯 derive 纯函数，无 HTTP / 无 DB；本地 evaluator 跑 vitest 冻结守卫即可验，runtime postgres=false）

## 锚定父路声明

覆盖父路 F1「工厂 · 开发闭环」步骤 3「造完真验」第 2 步（attempt callback runner_failure ↔ derive 有界重派决策边）。

## Response Schema（推导来源: PRD 字面）

N/A — 任务无 HTTP 响应。本 sprint 改动落在 `packages/brain/src/orchestrator/derive.js` 的
`priorRunnerFailures` 统计逻辑（纯函数，输入 observed、输出 derive decision 对象），不新增/修改任何 API 端点。
Reviewer 第 6 维 verification_oracle_completeness 按「无 HTTP 响应」自动满分口径审 vitest oracle。

## Golden Path

覆盖父路 F1 步骤 3：[某角色 runner 起不来] → [derive 统计**同角色**历史 runner_failure 次数] → [每角色各自 ≤2 次重派额度，跨角色互不占用]

### Step 1: 某角色 runner 起不来（runner_failure）
**来源**: `[FROM_PRD]` — PRD「Golden Path」第 1 条：一条 run 内 evaluator 连续 2 次 runner_failure（已用满 evaluator 自己的重派额度）。

**可观测行为**: derive 读 decisionLog，识别当前 callback `status=failed && failure_class=runner_failure`，进入 runner_failure 有界重派分支。

**验证命令**:
```bash
npx vitest run tests/gp/f1/step3-runner-failure-retry.test.js -t "evaluator 的 runner_failure" 2>&1 | grep -qE "[1-9][0-9]* passed"
# 期望：evaluator 首次 runner_failure → 重派，不判终态
```

**硬阈值**: 首次 runner_failure 不判 `phase=failed`。

---

### Step 2: derive 统计**同角色**历史 runner_failure 次数
**来源**: `[FROM_PRD]` — PRD「Golden Path」第 2 条 + 「范围限定」：`priorRunnerFailures` filter 增加同角色条件 `&& callbackDetail(r).role === role`。

**可观测行为**: `priorRunnerFailures` 只累计与当前 callback 同角色（`callbackDetail(r).role === role`）的 runner_failure 行；跨角色的 runner_failure 行不计入当前角色的额度消耗。

**验证命令**:
```bash
# 跨角色不误耗：evaluator 已 2 次 runner_failure 后，publisher 首次 runner_failure 同角色计数=0 → 仍重派
npx vitest run sprints/08230711-kernel-bae539c8/tests/step3-runner-failure-role-window.test.js -t "仍走 publish 重派" 2>&1 | grep -qE "[1-9][0-9]* passed"
# 期望：publisher 首次 runner_failure 仍走 publish:approved_ref 重派，reason=callback_runner_failure_retry
```

**硬阈值**: publisher 首次 runner_failure → `phase=publish, action=publish:approved_ref, reason=callback_runner_failure_retry`（同角色历史=0 < 2）。

---

### Step 3: 每角色各自 ≤2 次重派额度，跨角色互不占用（同角色有界语义不变）
**来源**: `[FROM_PRD]` — PRD「Golden Path」第 3 条 + 「边界情况」：同角色累计语义不变，同一角色第 3 次 runner_failure 仍进人审 `callback_runner_failure_exhausted`。

**可观测行为**: 同角色累计到第 3 次仍进人审（有界不变）；负向（product 无 failure_class / cancelled）照旧判终态。

**验证命令**:
```bash
# 同角色第 3 次仍进人审 exhausted（有界语义不变）
npx vitest run sprints/08230711-kernel-bae539c8/tests/step3-runner-failure-role-window.test.js -t "仍进人审 exhausted" 2>&1 | grep -qE "[1-9][0-9]* passed"
# 负向守恒：product 类失败照旧判终态
npx vitest run tests/gp/f1/step3-runner-failure-retry.test.js -t "照旧判终态，不被本次放宽" 2>&1 | grep -qE "[1-9][0-9]* passed"
```

**硬阈值**: evaluator 同角色第 3 次 → `phase=review, action=wait:human_review, reason=callback_runner_failure_exhausted`；product/cancelled → `phase=failed, action=mark_failed`。

---

## 已知约束（来自回归测试 + 累积 FR）

- [回归守卫] `tests/gp/f1/step3-runner-failure-retry.test.js` → 5 条 it() 全绿不回退：
  - `evaluator 的 runner_failure（首次）→ 同 run 重派 evaluator，不判终态`
  - `generator 的 runner_failure（首次）→ 重派 generator-fix 路由，不判终态`
  - `同一 run 第 3 次 runner_failure → 进人审（有界，不无限重试）`
  - `负向：product 类失败（无 failure_class）照旧判终态，不被本次放宽`
  - `负向：cancelled 照旧判终态`
- [回归守卫] `tests/gp/f1/step3-publisher-runner-failure-retry.test.js` → 4 条 it() 全绿不回退（含 `回归守恒：evaluator runner_failure 首次仍重派 evaluator（既有角色行为不回退）`）。
- [累积FR] 本 line 暂无历史（PRD「累积 FR」段声明）。context-manifest: unavailable（fleet-worker 环境，无 localhost:5221）。
- [MAP_NOT_CONFIGURED] payload 未配置 map_scope/map_repo，无 Unified Map radius 输入。
- contract-gate: present（cecelia worktree，packages/brain/src/lib/contract-gate.js 存在，代码层 gate 生效）。
- gp-anchor: skipped (product-map.json not found)。

## GP-Anchor

gp-anchor: skipped (product-map.json not found)

## 禁 mock 边清单

本单改动涉及**状态机/调度决策**（derive.js 的 runner_failure 有界重派分支判定），按 v9.12 硬规则禁 mock 被改的边：

- 代码 ↔ `packages/brain/src/orchestrator/derive.js` 的 `derive()` 纯函数（本单改 `priorRunnerFailures` 统计口径）：所有冻结守卫测试必须**真 import real derive.js**，禁止 `vi.mock`/stub `derive`、`attemptCallbackRoute`、`callbackDetail`、`infrastructureRetryForCallback`——mock 掉被改的决策函数则跨角色计数 bug 结构性抓不到。
- 无 DB 边：本单为纯函数计数逻辑，decisionLog 由测试直接以字面数组注入，runtime postgres=false，无 code↔DB 写路径接缝。

## 真实调用方请求 shape

N/A — 本单为 Brain 内部 derive 纯函数，无设备/agent 调服务端，无外部真实调用方。

## 未覆盖真实链路清单

（本合同无 mock 豁免，N/A）— 冻结守卫全部真 import real derive.js，无 force_*/stub/假数据。

## 八要素需求规范

| 要素 | 说明 | 本次答案（必填，可 N/A） |
|------|------|--------------------------|
| **FR（做什么）** | 功能需求 | `priorRunnerFailures` 只统计与当前 callback 同角色（`callbackDetail(r).role === role`）的 runner_failure 行，实现每角色各自 ≤2 次重派额度、跨角色互不占用。 |
| **NFR（做得多好）** | 非功能需求 | 纯 derive 纯函数无外部调用，无延迟/频控约束（PRD NFR 段待定）。 |
| **Invariant（永不违反）** | 不变量 | 有界重派同角色 ≤2 次超限进人审；基础设施重试保持角色身份一致；product/cancelled 负向守恒判终态。 |
| **判定点（怎么知道）** | 对模糊现实的判断 | 见下方登记表（同角色判定为确定性 `role` 字面相等，非模糊现实推断）。 |
| **保质期（何时过期）** | 失效退役 | N/A — derive 纯逻辑，无 token/数据保质期。 |
| **死亡告警（停了谁知道）** | 告警 | N/A — derive 是 kernel 同步决策路径，逻辑退化由冻结守卫 CI 拦截。 |
| **失败语义（挂了怎么办）** | 故障策略 | 见下方失败语义声明。 |
| **效果确认（已发≠已生效）** | 回执 | derive 返回决策对象（phase/action/reason），由 vitest toMatchObject 断言真实生效。 |

### 判定点登记表（对模糊现实的判断假设）

| 判定点 | 候选方法 | 所选方法 | 依据 | 误判后果 |
|--------|----------|----------|------|----------|
| （示例：微信群是否发送成功） | A. 监听发送按钮变灰; B. 读取聊天记录 API | A. 监听按钮变灰 | 聊天记录 API 不稳定 | 静默丢消息，用户不知 |
| 某历史 runner_failure 行是否属于当前失败角色 | A. `callbackDetail(r).role` 与当前 `role` 字面相等; B. 按 hop 邻接推断 | A. `callbackDetail(r).role === role` 字面相等 | role 字段是确定性数据（PRD ASSUMPTION 已核实 derive.js destructure `role`），非模糊现实推断 | 误判 → 跨角色误耗额度（本 bug）或额度隔离失效 |

> 本任务判定点为确定性字段相等比对，非真机/RPA 接缝推断。

### 失败语义声明

| 场景 | 失败行为 | 重试幂等？ | 降级策略 |
|------|----------|-----------|----------|
| （示例：Brain API 超时） | 返回 503，不写入 DB | 是（幂等键=task_id） | 客户端重试，Brain 端 dedup |
| 同角色 runner_failure ≤2 次 | 非终态，同角色重派（不轮换账号） | 是（derive 纯函数，同输入同输出） | 重派同角色 runner |
| 同角色 runner_failure 第 3 次（超限） | 进人审 `callback_runner_failure_exhausted`，不判 run 终态 | 是 | 人工兜底 |
| product 类失败（无 failure_class）/ cancelled | 照旧判终态 `mark_failed` | 是 | 不被本次放宽 |

### 输入对抗面（对外暴露 agent 必填）

N/A — 本单为 Brain 内部 kernel derive 纯函数，无对外暴露 agent、无外部用户可写入接口。

## E2E 验收（final-e2e 跑 — target_environment=local_api，纯 derive vitest 冻结守卫）

> 纯函数 kernel 变更，无 DB、无 API server：evaluator 从仓库根跑 vitest（三个测试文件全在根 vitest.config.js include：sprints/**、tests/**）。
> RED 证据（修前）：`sprints/08230711-kernel-bae539c8/tests/step3-runner-failure-role-window.test.js` 中「仍走 publish 重派」「同角色计数只数自己」2 条 it() 因跨角色误耗额度而 FAIL（derive 返回 exhausted/wait:human_review）。
> GREEN（修后，加 `&& callbackDetail(r).role === role`）：三文件 12 条 it() 全绿，既有 9 条守卫零回退。

```bash
#!/bin/bash
set -euo pipefail
cd "${WORKSPACE_PATH:-/workspace}"
SPRINT_TEST="sprints/08230711-kernel-bae539c8/tests/step3-runner-failure-role-window.test.js"
GUARD1="tests/gp/f1/step3-runner-failure-retry.test.js"
GUARD2="tests/gp/f1/step3-publisher-runner-failure-retry.test.js"

# Golden Path 全绿：本 sprint 冻结守卫 + 既有两条 repo 守卫，共 12 条 it() 必须全过（修后）
npx vitest run "$SPRINT_TEST" "$GUARD1" "$GUARD2" 2>&1 | tee /tmp/e2e-role-window.log
grep -qE "Test Files +3 passed \(3\)" /tmp/e2e-role-window.log || { echo "FAIL: 3 个测试文件未全绿"; exit 1; }
grep -qE "Tests +12 passed \(12\)" /tmp/e2e-role-window.log || { echo "FAIL: 12 条 it 未全绿"; exit 1; }
echo "OK: Golden Path 全绿（跨角色窗口化修复生效，既有守卫不回退）"
```

## 探索提示（L3 探索层 — evaluator 剧本全过后执行）

探索预算: 10 分钟 / 15 动作（默认）
高风险面:
- 错输入: decisionLog 中 runner_failure 行 `role` 字段缺失/为 undefined 时 `callbackDetail(r).role === role` 是否稳定不误算（应不匹配 → 不计入，语义安全）
- 重复提交: 同一 hop 出现多条 attempt_callback 行时 priorRunnerFailures 是否重复计数（应按 hop < row.hop 去重语义不变）
- 中途中断: 混合角色交错失败（evaluator/publisher/generator 交替各 1-2 次）时各角色额度是否严格独立计数
- 边界值: 同角色恰好第 2 次（应仍重派）vs 第 3 次（应 exhausted）边界
发现分级: P0/P1（跨角色误耗额度 / 额度隔离失效 / 有界语义被破坏）→ 阻塞 merge；P2/P3 → 记 findings 不阻塞

## Test Contract

| 功能 | Test File | BEHAVIOR 覆盖 | 预期红证据 |
|---|---|---|---|
| 跨角色窗口化核心（本 sprint 冻结） | `sprints/08230711-kernel-bae539c8/tests/step3-runner-failure-role-window.test.js` | 仍走 publish 重派 / 仍进人审 exhausted / 同角色计数只数自己 | RED: 2 failed（`仍走 publish 重派` + `同角色计数只数自己` 复现跨角色误耗，derive 返回 exhausted） |
| 既有 runner_failure 有界重派守卫（repo 补充） | `tests/gp/f1/step3-runner-failure-retry.test.js` | 同一 run 第 3 次 runner_failure / 照旧判终态，不被本次放宽 | GREEN 全绿不回退（5 条 it()） |
| publisher runner_failure 守卫（repo 补充） | `tests/gp/f1/step3-publisher-runner-failure-retry.test.js` | 回归守恒 | GREEN 全绿不回退（4 条 it()） |

> Test Contract 首行为本 sprint 冻结测试（`sprints/08230711-kernel-bae539c8/tests/step3-runner-failure-role-window.test.js`，已落盘并进 commit）；后两行为 repo 既有守卫补充。「BEHAVIOR 覆盖」列每项均为对应文件真实 it() 名的字面子串。
