# Sprint Contract Draft (Round 1) — 修复 Journey-only 锚触发 GP Contract 身份误判

**锚定父路声明**: 独立小路（无父路）— 本 sprint 修的是 dispatcher `spawn:generator` TaskBundle 装配的内部判定逻辑，不推进任何 product Golden Path 业务步骤。

**journey_type**: autonomous
**target_environment**: local_api
**Unified Map**: `[MAP_NOT_CONFIGURED]`（task.payload 未带 map_scope/map_repo，无 must_run_assertions 注入；不回退领域硬编码）
**contract-gate**: packages/brain/src/lib/contract-gate.js 存在（cecelia worktree）→ 代码层 Contract Gate 生效，本合同断言按合规惯用法编写（捕获变量 + 同段 grep 断言，无 `|| true` 吞错）。
**gp-anchor**: skipped (product-map.json not found)

---

## Response Schema（推导来源: PRD 字面）

N/A — 任务无 HTTP 响应。本刀是 `packages/brain/src/orchestrator/dispatcher.js` 纯内部装配逻辑（`gpContractIdentity` 判定 + `buildInputs` common bundle 组装），观测面是 in-process TaskBundle 结构与抛错行为，无 REST 端点。Reviewer 第 6 维 verification_oracle_completeness 就 Response Schema 项自动满分；oracle 完整性改由下方 vitest 断言矩阵承担。

---

## 已知约束（来自回归测试 + 累积 FR）

- [回归测试] `packages/brain/src/orchestrator/__tests__/dispatcher.test.js` → `it('把冻结 GP Contract 身份结构化注入下游 TaskBundle')`：完整 GP 合同（id/version/hash/golden_path_id/journey_id/step_id）必须结构化注入 `bundle.inputs.gp_contract`，本刀 RED-3 不得回退此断言。
- [回归测试] 同文件多条 `createDispatcher` 用例：`spawn:generator/evaluator` 在 mock deps 下装配至 `status=LAUNCHED` 且 `attemptStore.createAttempt` 被调用一次——本刀新增用例复用同款 mock 骨架，不引真实 Postgres/容器。
- [累积FR] 本 line（journey e6f803f2）暂无历史已验收 ability 行为（PRD 累积 FR 段声明 2 个 ability 均 status=planned）。context-manifest: not-fetched（postgres=false，Brain HTTP 不可达，按 PRD 累积 FR 段为准）。
- [MAP_NOT_CONFIGURED] Unified Map radius 未配置，无 `must_run_assertions`。

---

## Golden Path

[journey-only 锚的 spawn:generator dispatch] → [gpContractIdentity 判定] → [Generator TaskBundle 成功组装]

### Step 1: journey-only 锚触发 spawn:generator 装配
**来源**: `[FROM_PRD]` — PRD「Golden Path」第 1-3 步 + 背景（run 8b468cdd / journey e6f803f2，仅合法 `journey_id`、无 `gp_contract_*`）

**可观测行为**: payload 仅含合法 `journey_id`（UUID），无 `gp_contract_id/version/hash/golden_path_id`、无 `anchor.step_id` 时，`gpContractIdentity(payload)` 识别为 journey-only 锚，返回 null（不注入 `common.gp_contract`）；`buildInputs` 把 `journey_id` 保留进 common bundle；`spawn:generator` 组装出可用 TaskBundle，`createDispatcher` 返回 `status=LAUNCHED`（当前 RED：返回 `DONE_WITH_CONCERNS`、无 attempt 创建，即 assembly_fault）。

**验证命令**:
```bash
cd packages/brain
npx vitest run src/orchestrator/__tests__/dispatcher-gp-contract-identity.test.js -t 'RED-1 journey-only'
# 期望：Tests 1 passed（bundle.inputs.gp_contract 为 undefined 且 bundle.inputs.journey_id === journey_id 且 status=LAUNCHED）
```

**硬阈值**: 该命名测试 1 passed、0 failed。
**验证命令（硬阈值 codify）**: `OUT=$(cd packages/brain && npx vitest run src/orchestrator/__tests__/dispatcher-gp-contract-identity.test.js -t 'RED-1 journey-only' 2>&1); echo "$OUT" | grep -Eq 'Tests +1 passed' && ! echo "$OUT" | grep -Eq '[0-9]+ failed'`

---

### Step 2: partial GP 字段仍 fail-closed（分支行为，不得回退）
**来源**: `[FROM_PRD]` — PRD「分支行为（不得回退）」第 1 条 + Invariant [fail-closed]

**可观测行为**: 只提供 `gp_contract_id`/`version`/`hash`/`golden_path_id`/`step_id` 中任一**部分**字段（journey 之外）→ 视为要声明完整合同却缺项 → `gpContractIdentity` 抛 `GP_CONTRACT_IDENTITY_INVALID`，装配 fail-closed，禁止静默降级为 journey-only。

**验证命令**:
```bash
cd packages/brain
npx vitest run src/orchestrator/__tests__/dispatcher-gp-contract-identity.test.js -t 'RED-2 partial'
# 期望：Tests 1 passed（buildInputs 抛 /GP_CONTRACT_IDENTITY_INVALID/）
```

**硬阈值**: 该命名测试 1 passed、0 failed（抛错断言命中）。
**验证命令（硬阈值 codify）**: `OUT=$(cd packages/brain && npx vitest run src/orchestrator/__tests__/dispatcher-gp-contract-identity.test.js -t 'RED-2 partial' 2>&1); echo "$OUT" | grep -Eq 'Tests +1 passed' && ! echo "$OUT" | grep -Eq '[0-9]+ failed'`

---

### Step 3: 完整合同结构化注入（不回归）
**来源**: `[FROM_PRD]` — PRD「分支行为（不得回退）」第 2 条 + NFR [一致性校验强度]（不得削弱）

**可观测行为**: 提供**完整** id/version/hash/golden_path_id/journey_id/step_id 且 `anchor.gp_id === golden_path_id` → 冻结结构化注入 `common.gp_contract`（与现状一致）；`anchor.gp_id` 与 `golden_path_id` 不一致 → 抛 `GP_CONTRACT_IDENTITY_INVALID`（一致性校验不削弱）。

**验证命令**:
```bash
cd packages/brain
npx vitest run src/orchestrator/__tests__/dispatcher-gp-contract-identity.test.js -t 'RED-3 完整'
npx vitest run src/orchestrator/__tests__/dispatcher.test.js -t '把冻结 GP Contract 身份结构化注入下游 TaskBundle'
# 期望：两条均 Tests 1 passed（gp_contract 深等于期望值 + 原有回归不破）
```

**硬阈值**: 两条命名测试各 1 passed、0 failed。
**验证命令（硬阈值 codify）**: `OUT=$(cd packages/brain && npx vitest run src/orchestrator/__tests__/dispatcher.test.js -t '把冻结 GP Contract 身份结构化注入下游 TaskBundle' 2>&1); echo "$OUT" | grep -Eq 'Tests +1 passed' && ! echo "$OUT" | grep -Eq '[0-9]+ failed'`

---

## 禁 mock 边清单

本单改动涉及 **跨模块数据传递**（`gpContractIdentity` 判定结果 → `buildInputs` 决定 `common.gp_contract`/`common.journey_id`）与 **装配路径**（`spawn:generator` TaskBundle 组装），故 failing test 必须真调被改的那条边：

- `gpContractIdentity` ↔ `buildInputs`（本单改了判定→common 装配的接力，测试必须真调 `__test__.buildInputs` / 经 `createDispatcher` 真跑装配，禁止 stub `gpContractIdentity` 或 `buildInputs`）
- `buildInputs` ↔ `buildBundle` ↔ `parseTaskBundle`（journey-only bundle 必须真过 `parseTaskBundle` zod 校验，禁止 mock 掉 TaskBundle 组装/校验）
- `createDispatcher` 装配链（RED-1/RED-3 经真实 `createDispatcher('spawn:generator', ...)` 装配，只 mock `attemptStore`/`launcher`/`registry`/`loadSkill` 等更外层持久化/启动依赖——这些非本单被改的边）

无 Postgres 参与（本刀不触 DB 写路径，`runtime_resources.postgres=false`）；被改的边全在 in-process 装配层，故无需真 Postgres。

---

## 真实调用方请求 shape

N/A — 本刀无「设备/agent 调服务端」外部调用方，改的是 dispatcher 进程内装配逻辑。事故权威调用面（run 8b468cdd 的 payload：仅 `journey_id`、无 `gp_contract_*`）已由 RED-1 用例逐字段还原（`{ journey_id: 'e6f803f2-...' }`）。

## 未覆盖真实链路清单

（本合同无 mock 豁免，N/A）——所有 [BEHAVIOR] 均真调被测装配链（`gpContractIdentity`/`buildInputs`/`createDispatcher`/`parseTaskBundle`），无 `force_*`/stub/假数据顶替被测逻辑；仅 mock 更外层持久化/启动依赖（`attemptStore`/`launcher`），属 Golden Path 无关边界。

---

## 八要素需求规范

| 要素 | 说明 | 本次答案（必填，可 N/A） |
|------|------|--------------------------|
| **FR（做什么）** | 功能需求 | journey-only 锚（仅合法 journey_id、无 GP 字段）→ `gpContractIdentity` 返回 null 且 `journey_id` 保留进 common bundle，`spawn:generator` 成功组装；partial GP 字段仍 fail-closed；完整合同结构化注入不回归。 |
| **NFR（做得多好）** | 性能/可靠性 | 完整 GP Contract 的 UUID/hash/step/anchor.gp_id 一致性校验强度**不得削弱**；dispatcher 单测永久留 CI；三态由 AI Evaluator 独立验证（不只看 CI）。无性能阈值（进程内判定，微秒级）。 |
| **Invariant（永不违反）** | 不变量 | [fail-closed] 声明部分 GP 字段却缺项一律抛错，禁静默降级；[test-include] 新测必须落在 vitest include 路径内（`packages/brain/src/**`）；完整合同一致性校验不削弱。 |
| **判定点（怎么知道）** | 判断假设 | 见下方登记表（journey-only vs partial 的边界判定）。 |
| **保质期（何时过期）** | 失效/退役 | 无过期语义；判定逻辑随 GP Contract 身份 schema 演进而演进（后续「机器身份硬闸」刀会再触及，本刀不预留）。 |
| **死亡告警（停了谁知道）** | 告警 | 该判定回归失效 → CI（brain-unit）跑 dispatcher 回归测试即红；生产装配再触发 `GP_CONTRACT_IDENTITY_INVALID` → run 落 `assembly_fault`，Kernel run failed 告警链已有。 |
| **失败语义（挂了怎么办）** | 故障策略 | fail-closed：声明部分 GP 合同缺项 → 抛错拦截（不放行装配）；journey-only 合法 → 放行装配但不注入 gp_contract。见失败语义声明。 |
| **效果确认（已发≠已生效）** | 回执 | 回执 = `spawn:generator` 装配出的 TaskBundle 结构（`bundle.inputs.gp_contract` 有无 + `bundle.inputs.journey_id` 值）+ `createDispatcher` 返回 `status=LAUNCHED`，由 vitest 断言直接观测。 |

### 判定点登记表（对模糊现实的判断假设）

| 判定点 | 候选方法 | 所选方法 | 依据 | 误判后果 |
|--------|----------|----------|------|----------|
| ⚠️ payload 是否为 journey-only 锚（应放行装配）vs partial GP 合同（应 fail-closed 抛错） | A. 5 个 GP 字段（id/version/hash/golden_path_id/step_id）全空 且 journey_id 为合法 UUID → journey-only；B. 沿用旧逻辑 `Object.values(含 journey_id).every(空)` | A. GP 字段与 journey_id 分离判定：GP 字段全空 → 进 journey-only 分支（journey_id 合法则返 null、非法则抛错）；任一 GP 字段非空 → 进全量严格校验 | PRD 根因：旧逻辑把 journey_id 并入 values，journey-only 绕过 null 分支被误判为缺项合同 | 误判为 partial → 合法 journey-only run 装配 fail-closed 终止（本次生产 RED，run failed）；误判为 journey-only → partial 缺项合同被静默放行（违反 fail-closed 铁律） |

> ⚠️ 行说明：该判定点误判两个方向都严重（一侧终止合法 run，一侧放行缺项合同）。PrepPRD 已明确判定规则（[ASSUMPTION] journey-only = journey_id 合法 UUID 且其余 5 GP 字段全空），无需再升拍板；notes 不加 judgment-pending-user。

### 失败语义声明

| 场景 | 失败行为 | 重试幂等？ | 降级策略 |
|------|----------|-----------|----------|
| partial GP 字段（缺 id/hash/step 之一等） | `gpContractIdentity` throw `GP_CONTRACT_IDENTITY_INVALID`，`buildInputs` 冒泡，装配 fail-closed（不创建 attempt） | 是（纯函数，同 payload 同结果） | 无降级——fail-closed，不静默补默认值 |
| 完整合同但 anchor.gp_id ≠ golden_path_id | 同上抛错 | 是 | 无降级（一致性校验不削弱） |
| journey_id 非 UUID 且无 GP 字段 | 同上抛错（非法输入） | 是 | 无降级 |
| journey-only（合法 journey_id、无 GP 字段） | 返回 null，不注入 gp_contract，journey_id 进 common，装配放行 | 是 | N/A（成功路径） |

### 输入对抗面（对外暴露 agent 必填）

N/A — 本刀改的是 Brain 进程内 dispatcher 装配逻辑，非对外暴露 agent 接口；payload 来自 Brain 自身 task 表（内部信任源），无外部用户直写、无 prompt injection 面。

---

## E2E 验收（最终 final-e2e 跑 — target_environment=local_api）

**journey_type**: autonomous
**target_environment**: local_api

> 本刀纯 Brain 后端装配逻辑，无 HTTP/UI/真机。oracle = vitest 跑永久回归文件（CI include 路径）+ 原 dispatcher 主测试无回归。runtime_resources.postgres=false（不触 DB 写路径），node_deps=true（npm ci 已就绪，vitest 可用）。三态（journey-only / partial / complete）独立断言，满足 NFR [验证独立性]。

```bash
#!/bin/bash
set -euo pipefail
cd packages/brain

REG="src/orchestrator/__tests__/dispatcher-gp-contract-identity.test.js"

# 1. 永久回归文件必须落在 CI include 路径（invariant [test-include]；sprints/** 不被扫描）
[ -f "$REG" ] || { echo "FAIL: 永久回归测试缺失 $REG（NFR 回归保留 / invariant test-include 未满足）"; exit 1; }

# 2. 三态独立验证：journey-only / partial / complete 各自命名用例必须存在且通过（NFR 验证独立性）
OUT=$(npx vitest run "$REG" 2>&1)
echo "$OUT" | tail -30
echo "$OUT" | grep -Eq 'Tests +[1-9][0-9]* passed' || { echo "FAIL: 回归文件无通过用例"; exit 1; }
echo "$OUT" | grep -Eq '[1-9][0-9]* failed' && { echo "FAIL: 回归文件存在失败用例"; exit 1; } || true
for NAME in 'RED-1 journey-only' 'RED-2 partial' 'RED-3 完整'; do
  echo "$OUT" | grep -Fq "$NAME" || { echo "FAIL: 缺三态断言 [$NAME]"; exit 1; }
done

# 3. 原 dispatcher 主测试无回归（完整 GP Contract 结构化注入不破 + 一致性校验不削弱）
DOUT=$(npx vitest run src/orchestrator/__tests__/dispatcher.test.js 2>&1)
echo "$DOUT" | tail -10
echo "$DOUT" | grep -Eq 'Tests +[1-9][0-9]* passed' || { echo "FAIL: dispatcher 主测试未跑通"; exit 1; }
echo "$DOUT" | grep -Eq '[1-9][0-9]* failed' && { echo "FAIL: dispatcher 主测试回归"; exit 1; } || true

echo "✅ Golden Path 验证通过（journey-only 放行装配 + partial fail-closed + complete 无回归）"
```

---

## 探索提示（L3 探索层 — evaluator 剧本全过后执行）

探索预算: 10 分钟 / 15 动作（默认；本刀纯装配判定逻辑，风险面窄，用默认预算）
高风险面:
- 错输入: `journey_id` 为空串 `''`、大小写混合 UUID、含前后空格的 UUID；`gp_contract_version` 传字符串 `"1"` / `0` / 负数
- 边界值: 仅 `anchor.gp_id` 非空（无 payload.golden_path_id）而其余 GP 字段空——应视为「声明了 GP 合同」进严格校验 fail-closed，还是 journey-only？（依 PRD：`golden_path_id ?? anchor.gp_id`，anchor.gp_id 非空即 GP 字段非空 → partial → fail-closed）
- 重复提交: 同一 journey-only payload 连续两次装配，`journey_id` 每次都稳定进 common（幂等）
- 中途中断: N/A（进程内纯函数，无异步中断面）
发现分级: P0/P1（合法 journey-only 被 fail-closed 终止 run / partial 缺项被静默放行）→ 阻塞 merge；P2/P3（错误信息不清晰等）→ 记 findings 不阻塞
