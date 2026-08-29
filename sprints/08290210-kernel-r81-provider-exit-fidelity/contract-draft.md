# Sprint Contract Draft (Round 1) — 结构化上报保真透传，根除 provider_exit 语义埋没 [r81]

**journey_type**: autonomous
**target_environment**: local_api（纯函数可重放，node 跑 tests/gp/f1 + 冻结 sprint 测试；无 DB、无 HTTP server）
**contract-gate**: present (cecelia worktree, packages/brain/src/lib/contract-gate.js 存在)

## 锚定父路声明

覆盖父路 F1「工厂 · 开发闭环」第 3 步「造完真验」——本 sprint 修复 runner→Brain 回执链路把结构化终态埋没为 `provider_exit` 的两个埋没点（entrypoint 与 kernel bridge），并补测 CONTRACT_* 家族分类。

## Response Schema（推导来源: PRD 明确 — 纯内部 kernel 逻辑）

N/A — 任务无 HTTP 响应。本 sprint 改动是 runner 回执规范化（bash）+ kernel bridge close-result 解析（纯函数）+ kernel 分类断言（derive 纯函数），无对外端点。Reviewer 第 6 维 verification_oracle_completeness 按「纯内部改动」豁免 HTTP schema 项，验证 oracle 全部落在纯函数/真跑 bash 断言。

## Golden Path

[执行体写出结构化终态 result.json（进程可能非零退出）] → [回执链路保真透传（entrypoint + kernel bridge）] → [kernel 按 error.code 分类：CONTRACT_* → 合同故障重开 GAN；无结构化产出 → provider_exit/infrastructure] → [失败留原因病族]

---

### Step 1: runner/entrypoint 保真透传（`normalize_provider_failure`）
**来源**: `[FROM_PRD]` — PRD「Golden Path」第 1 条 + 「预期受影响文件」`docker/cecelia-runner/entrypoint.sh`

**可观测行为**: `normalize_provider_failure` 在为非零退出（且非 124 超时）构造失败回执前，先读取执行体已写出的结构化终态 result.json。若该文件是合法结构化终态——success 家族（`contract_version=="1.0"` 且 `status ∈ {completed, completed_with_concerns, needs_context}`）或结构化 BLOCKED（`error.code` 匹配 `^CONTRACT_`）——则**原样透传**（保留 status 与 error），禁止覆盖为 `status:failed` + `error.code:provider_exit`。透传闸必须位于 124 超时分支之后、auth-unavailable 检测之前（结构化合同终态优先级最高）。

**验证命令**（真跑被改 bash 函数，非 mock；沿用 `tests/docker/entrypoint-stdout-tee.test.js` 抽取+spawnSync 范式）:
```bash
# 冻结 sprint 测试内实现：抽取 normalize_provider_failure，喂结构化 success result.json + exit 1
npx vitest run sprints/08290210-kernel-r81-provider-exit-fidelity/tests/step3-provider-exit-structured-fidelity.test.js -t "埋没点② entrypoint"
# 期望：结构化 success → normalized.status == "completed"；结构化 BLOCKED+CONTRACT_ → status=="blocked" 且 error.code=="CONTRACT_TEST_UNSATISFIABLE"
```

**硬阈值**: 结构化 success 入参时 `normalized.json .status == "completed"`（当前实现返回 `failed` → RED）；结构化 BLOCKED+CONTRACT_* 入参时 `.status=="blocked"` 且 `.error.code=="CONTRACT_TEST_UNSATISFIABLE"`。

---

### Step 2: kernel bridge close-result 保真透传（`kernel-attempt-handler` close handler）
**来源**: `[FROM_PRD]` — PRD「Golden Path」第 2 条 + 「预期受影响文件」`packages/brain/scripts/codex-bridge/kernel-attempt-handler.cjs`

**可观测行为**: close handler 在 `code !== 0` 时不再直接盖章 `provider_exit_${code}` 丢弃 result.json；而是先 `parseHarnessResult(resultPath)`，解析成功（即合法结构化终态）→ 保真透传该结果；解析失败（无结构化产出）→ 回退 `provider_exit_${code}`。为「纯函数可重放」，该解析回退逻辑抽取为导出的纯函数 `resolveProviderCloseResult({ exitCode, resultPath, attemptId })`（内部真调既有 `parseHarnessResult`，不 mock 被改的边），close handler 改为薄封装调用它。

**语义矩阵**（纯函数 `resolveProviderCloseResult`）:
| exitCode | result.json | 返回 |
|---|---|---|
| 任意（含 !=0） | 合法结构化终态 | 原样透传该结构化终态 |
| 0 | 缺失/非法 | `failedHarnessResult(attemptId, 'provider_result_invalid')` |
| !=0 | 缺失/非法 | `failedHarnessResult(attemptId, 'provider_exit_${code}')` |

**验证命令**（真 import 被改模块，真调 parseHarnessResult）:
```bash
npx vitest run sprints/08290210-kernel-r81-provider-exit-fidelity/tests/step3-provider-exit-structured-fidelity.test.js -t "埋没点① kernel-attempt-handler"
# 期望：exit 1 + 结构化 success → out.status=="completed" 且 out.error===null；
#       exit 1 + 结构化 BLOCKED+CONTRACT_ → out.error.code=="CONTRACT_TEST_UNSATISFIABLE"；
#       exit 3 + 无文件 → out.error.code=="provider_exit_3"（负向不变）；
#       exit 0 + 非法 json → out.error.code=="provider_result_invalid"（负向不变）
```

**硬阈值**: `typeof resolveProviderCloseResult === 'function'`（当前未导出 → RED）；四条语义矩阵断言全过。

---

### Step 3: kernel 分类 — CONTRACT_* 走合同故障重开而非 infrastructure（既有能力，补测护栏）
**来源**: `[FROM_PRD]` — PRD「Golden Path」第 3 条 +「假设」（CONTRACT_* 合同故障重开路径既已存在，本 sprint 仅保证结构化终态保真到达该路径、不新建路由）

**可观测行为**: 结构化终态经 Step 1/2 保真到达 kernel 后，`derive` 对 `role=generator` + `status=blocked`（或 failed+semantic_refusal）+ `error.code ∈ CONTRACT_*` 家族的回执，路由到 `arbitrate:contract_fault`（合同故障申诉→仲裁→重开 GAN），**不进 failed_targets 黑名单、不按 infrastructure 重试**。对照：`provider_exit` + infrastructure_blocked 仍走 `callback_infrastructure_blocked`（generator-fix / 有界重派）。此分类当前已支持，本 sprint 加回归护栏防止未来把结构化合同故障重新误分类为 infrastructure。

**验证命令**（真 import derive，被改边分类逻辑不 mock）:
```bash
npx vitest run tests/gp/f1/step3-contract-fault-not-infrastructure.test.js
# 期望：CONTRACT_TEST_UNSATISFIABLE blocked → action==ARBITRATE_CONTRACT_FAULT reason==contract_fault_appeal；
#       provider_exit infra → action != ARBITRATE_CONTRACT_FAULT 且 != REOPEN_GAN_CONTRACT，reason==callback_infrastructure_blocked
```

**硬阈值**: 两条断言全过（既有能力，green 护栏）。

---

## 已知约束

### 回归测试约束（来源: Step 1.2 定位）
- `tests/gp/f1/step3-commander-runner-failure-and-unanchored-review.test.js` → commander/generator runner_failure 有界重派、无锚人审落地（本 sprint 不改这些路由，只保证 CONTRACT_* 不落入该 infra 分支）
- `tests/gp/f1/step3-assertion-infra-not-evidence-invalid.test.js` → 信任断言 npm 失败归因为 infra 非 evidence-invalid（与本 sprint 同族「失败留原因病族」，不冲突）
- `tests/docker/entrypoint-stdout-tee.test.js` → entrypoint 函数抽取+spawnSync 真跑范式（本 sprint 冻结测试沿用同法测 `normalize_provider_failure`）

### 累积 FR（来源: `[累积FR]` context-manifest）
- context-manifest: 本 line 暂无历史累积 FR（PRD「累积 FR」段：journey golden-paths 返回跨域 ability，不作本 sprint 累积 FR）。端点未在本地可达，记一行 `context-manifest: unavailable`。

## 历史约束三源加载（EVA v2）

- **铁律清单 → INV 覆盖**：
  - INV-1 [语义不变]：真实 provider 崩溃（无结构化产出）仍 provider_exit/infrastructure，黑名单语义不动 → 有 [BEHAVIOR] 负向断言覆盖（DoD B-04/B-07/B-08）。
  - INV-2 [凭据隔离]：多人协作禁止混用授权凭据 → N/A：本 sprint 是纯回执分类逻辑，不触及账号凭据加载/切换路径。
- **累积 FR**：见上「已知约束」。
- **回归测试约束**：见上「已知约束」。

## 八要素需求规范

| 要素 | 说明 | 本次答案 |
|------|------|----------|
| **FR** | 系统对外承诺 | 执行体产出结构化终态（success / 结构化 BLOCKED+CONTRACT_*）时，回执链路（entrypoint + kernel bridge）保真透传，不降级为 provider_exit；CONTRACT_* 走合同故障重开而非 infrastructure |
| **NFR** | 性能/可靠 | 纯函数可重放、离线可复跑（RED 复刻 r69/r77）；无新增外部依赖/进程 |
| **Invariant** | 永不违反 | 真崩溃（无结构化产出）仍 provider_exit/provider_result_invalid/provider_spawn_failed；exit 124 仍 provider_timeout；黑名单语义不动 |
| **判定点** | 对模糊现实的判断 | 见下「判定点登记表」 |
| **保质期** | 何时过期 | N/A：分类逻辑无时效 token；随 parseHarnessResult 契约（contract_version=1.0）演进 |
| **死亡告警** | 停了谁知道 | 回退型故障：若透传闸误伤真崩溃，负向回归测试（无结构化产出→provider_exit）会在 CI 红；kernel 侧合同故障重开由 GAN 循环可观测 |
| **失败语义** | 挂了怎么办 | 见下「失败语义声明」 |
| **效果确认** | 已发≠已生效 | 回执 normalized.json 的 status/error.code 即效果凭证；测试断言其字段值（非「跑过就算」） |

### 判定点登记表

| 判定点 | 候选方法 | 所选方法 | 依据 | 误判后果 |
|--------|----------|----------|------|----------|
| ⚠️ result.json 是否为「合法结构化终态」 | A. 仅看进程 exit code；B. 解析并校验结构（contract_version/status/error.code）；C. 只看文件是否存在 | B. 解析并校验结构 | exit code 与结构化产出正交（CLI 可诊断非零 + 成功产出并存，正是 r69/r77 根因）；文件存在≠合法 | 静默丢失成功/合同故障产出（面客：失败不留原因病族） |
| 结构化 BLOCKED 是否属合同故障家族 | A. `error.code` 前缀 `^CONTRACT_`；B. 白名单精确码集合 | A. `^CONTRACT_` 前缀 + kernel 侧既有 core-token 子集匹配 | 与 derive.js 既有 CONTRACT_FAULT_CORE_TOKENS 子集匹配对齐（防词序/增删词漂移） | 误分类：合同故障被当 infra 无限重试，或产品 bug 被误当合同申诉 |

> ⚠️ 行说明：「result.json 是否合法结构化终态」误判后果严重（静默丢产出、直接面客失败无因），PrepPRD/对齐会已由本主题第六次点火明确「保真透传」为核心 NFR，判定方法 B（解析校验）已拍。`judgment-pending-user`: 无（判定方法本轮已定，见 notes）。

### 失败语义声明

| 场景 | 失败行为 | 重试幂等？ | 降级策略 |
|------|----------|-----------|----------|
| result.json 解析失败（非法结构） | 回退 provider_result_invalid（exit 0）/ provider_exit_${code}（exit!=0），status=failed | 是（纯函数，同输入同输出） | 按 infrastructure 处理，走既有 provider 崩溃语义 |
| result.json 缺失（spawn 失败/真崩溃） | provider_spawn_failed / provider_exit，status=failed | 是 | 黑名单/有界重派语义不动 |
| CONTRACT_* 合同故障保真到达 | derive → arbitrate:contract_fault（仲裁→重开 GAN，每 run 至多重开 1 次） | 是 | 仲裁不可用→人审；重开耗尽→人审（既有路径，本 sprint 不改） |

### 输入对抗面

N/A — 本 sprint 是 kernel 内部回执分类逻辑，输入来自可信执行体自身写出的 result.json（同一 attempt 沙箱），非对外暴露 agent。result.json 结构校验（parseHarnessResult 契约）已是防线，无 prompt injection 面。

## 禁 mock 边清单

本单涉及「跨模块数据传递（runner→Brain 回执）」+「生命周期钩子（provider close handler）」+「状态机（derive 分类路由）」，failing test 必须不 mock 被改的那条边：

- **entrypoint `normalize_provider_failure` ↔ result.json**（runner→Brain 回执数据）：冻结测试真跑该 bash 函数、读真实 result.json，禁 mock（真 spawnSync bash，非替身）。
- **kernel-attempt-handler `resolveProviderCloseResult` ↔ `parseHarnessResult`（result.json 解析）**（close 生命周期钩子 + 回执数据）：冻结测试真 import 被改模块、真调其内部 parseHarnessResult，禁 mock 被改边（只允许真临时文件 fixtures）。
- **derive ↔ error.code 分类**（状态机路由）：护栏测试真 import derive、真跑分类，禁 mock derive/constants。

（本单无更外层第三方依赖需 mock；无空清单。）

## GP-Anchor

gp-anchor: skipped (product-map.json not found)

## E2E 验收（final-e2e 跑 — target_environment=local_api，纯函数/真跑 bash 可重放）

```bash
#!/bin/bash
set -euo pipefail
# 纯函数可重放：无 DB、无 HTTP server（runtime_resources.postgres=false）。
# 全部真 import 被改模块 / 真跑被改 bash 函数，禁 mock 被改的边。
cd "${WORKSPACE_PATH:-/workspace}"

# 1. 冻结 RED（埋没点①② 保真透传）——修复后必须全绿
npx vitest run \
  sprints/08290210-kernel-r81-provider-exit-fidelity/tests/step3-provider-exit-structured-fidelity.test.js \
  --reporter=basic 2>&1 | tee /tmp/r81-frozen.log
grep -Eq "Tests +[0-9]+ passed" /tmp/r81-frozen.log || { echo "FAIL: 冻结测试未全绿"; exit 1; }
grep -Eq "[1-9][0-9]* failed" /tmp/r81-frozen.log && { echo "FAIL: 冻结测试仍有 failed"; exit 1; }

# 2. 需求3 分类护栏（CONTRACT_* → 合同故障重开，非 infrastructure）
npx vitest run \
  tests/gp/f1/step3-contract-fault-not-infrastructure.test.js \
  --reporter=basic 2>&1 | tee /tmp/r81-derive.log
grep -Eq "[1-9][0-9]* failed" /tmp/r81-derive.log && { echo "FAIL: derive 护栏有 failed"; exit 1; }
grep -Eq "Tests +[0-9]+ passed" /tmp/r81-derive.log || { echo "FAIL: derive 护栏未跑"; exit 1; }

# 3. 相邻既有回归不回退（entrypoint 抽取范式 + commander runner_failure 路由）
npx vitest run \
  tests/docker/entrypoint-stdout-tee.test.js \
  tests/gp/f1/step3-commander-runner-failure-and-unanchored-review.test.js \
  --reporter=basic 2>&1 | tee /tmp/r81-regress.log
grep -Eq "[1-9][0-9]* failed" /tmp/r81-regress.log && { echo "FAIL: 相邻回归回退"; exit 1; }

echo "✅ r81 Golden Path 保真透传 E2E 验证通过"
```

## 探索提示（L3 探索层 — evaluator 剧本全过后执行）

探索预算: 10 分钟 / 15 动作（默认）
高风险面:
- 错输入: result.json 里 `error.code` 大小写/前缀变体（`contract_test_unsatisfiable` 小写、`APPROVED_CONTRACT_CI_CONFLICT` 多修饰词）——透传闸 `^CONTRACT_` 与 kernel core-token 子集匹配是否一致命中，不漏不误放。
- 结构化边界: `status=completed` 但 `error` 非 null / `status=failed` 但 `error.code=CONTRACT_*`（结构化 BLOCKED 以 failed+semantic_refusal 落盘）——透传后 derive 是否仍正确分流。
- 中途中断: result.json 半写入（截断 JSON）+ exit!=0 → 必须回退 provider_exit（不得把半截当合法透传）。
- 边界值: exit 124 + 存在合法结构化 success result.json → 铁律要求仍 provider_timeout（超时优先，不被 success 透传抢占）。
发现分级: P0/P1（真崩溃被误透传成 completed / 合同故障被误当 infra）→ 阻塞 merge；P2/P3 → 记 findings 不阻塞

## Test Contract

| 功能 | Test File | BEHAVIOR 覆盖 | 预期红证据 |
|---|---|---|---|
| 埋没点①② 保真透传（冻结·封印） | `sprints/08290210-kernel-r81-provider-exit-fidelity/tests/step3-provider-exit-structured-fidelity.test.js` | 导出纯函数 resolveProviderCloseResult；非零退出 + 结构化 success；非零退出 + 结构化 BLOCKED；无 result.json；exit 0 + 非法；埋没点② 非零退出 + 结构化 success；埋没点② 非零退出 + 结构化 BLOCKED；exit 124 | RED 7/9（当前实现埋没 → provider_exit/failed；导出缺失） |
| 需求3 CONTRACT_* 分类护栏（补充） | `tests/gp/f1/step3-contract-fault-not-infrastructure.test.js` | error.code=CONTRACT_TEST_UNSATISFIABLE；provider_exit（infrastructure） | 既有能力，green 护栏 |

> 封印说明（skill v9.27）：冻结测试落 `sprints/08290210-kernel-r81-provider-exit-fidelity/tests/`（seal 闸 assertTestContractResolvable 校验此路径，Test File 列写完整真实路径无省略号）。`tests/gp/f1/` 的分类护栏为补充行（PRD 需求5 的 tests/gp/f1 归属 + 需求3 既有能力回归）。冻结测试的两条埋没点断言当前 RED（真 import/真跑被改边），是本 sprint 的 r69/r77 复刻。
