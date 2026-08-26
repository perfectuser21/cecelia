# Sprint Contract Draft (Round 1)

**Sprint**: 结构化上报保真透传，根除 provider_exit 语义埋没 [r78]
**journey_type**: autonomous ｜ **target_environment**: local_api（本 attempt 未配 Postgres/Brain server，`runtime_resources.postgres=false`；按 NFR「纯函数可重放」用 node/vitest 纯函数重放验收）
**锚定父路声明**: 覆盖父路 F1「工厂 · 开发闭环」第 3 步「造完真验」（journey e6f803f2；step_id=none，PrepPRD 未锚定）
**contract-gate**: skipped？→ 否，cecelia 仓存在 `packages/brain/src/lib/contract-gate.js`，本合同断言按 Contract Gate 速查表写（node 断言型，非 curl/psql）

---

## Response Schema（推导来源: N/A）

N/A — 任务无 HTTP 响应。本 sprint 为 kernel 内部路由 + runner 回执归一化纯函数改动，无对外端点。Reviewer 第 6 维按「无 HTTP 响应」自动满分；验证 oracle 由 node/vitest 纯函数断言承载。
（Step 1.0 Unified Map：`[MAP_NOT_CONFIGURED]` — task.payload 无 map_scope/map_repo，Brain 不可达，不回退领域硬编码。Step 1.1 registry：Brain 不可达 → `[NEW_PATTERN]`，按 PRD/现有代码字面。）

---

## Golden Path

[执行体产出结构化终态] → [runner 回执归一化保真透传（禁降级 provider_exit）] → [kernel 按 CONTRACT_* 家族路由合同故障重开 GAN] → [失败留原因病族；真崩溃仍判 infrastructure]

### Step 1: 执行体产出结构化终态（触发）
**来源**: `[FROM_PRD]` — Golden Path 第 1 点（结构化 success 结果 JSON / 结构化 BLOCKED + CONTRACT_* 错误码）

**可观测行为**: runner/entrypoint 拿到 provider stdout，其中含结构化终态：claude 成功结果 JSON（`type=result, subtype=success`，即便 provider 进程 exit≠0），或结构化 BLOCKED 且 `error.code` 属 CONTRACT_* 家族。

**验证命令**（纯函数重放 classifier 识别，见 Step 2）
**硬阈值**: classifier 对上述两类输入返回 `passthrough=true`

---

### Step 2: runner 回执归一化保真透传（禁降级 provider_exit）
**来源**: `[FROM_PRD]` — Golden Path 第 2 点 + 要求 1；`[AI_ADDED]` 抽纯函数 SSOT：把「结构化终态识别 → 保真透传 vs 降级 provider_exit」判定从 entrypoint.sh 内联 jq 抽为纯函数 `classifyProviderTerminal`，让 `docker/cecelia-runner/entrypoint.sh` 与 vitest 共用同一 SSOT（理由：本 attempt 无 docker，接缝行为唯有抽纯函数才可机检重放，且消除 bash/jq 与 JS 逻辑双写漂移）。

**可观测行为**: `normalize_provider_failure`（entrypoint.sh:2743）在 `provider_exit≠0` 时，**先**调用 `classifyProviderTerminal` 识别结构化终态；识别到即按其 `status` + `errorCode` 保真透传（success 判成功、BLOCKED 保留 `error.code` 病族），**禁止**无条件覆盖为 `error.code="provider_exit"`。仅当 classifier 判 `passthrough=false`（无结构化产出）才落 `provider_exit`/`provider_timeout`。

**验证命令**（纯函数重放 + 结构接线）
```bash
# ① 纯函数重放（结构化 success / commander 成功 / 结构化 BLOCKED+CONTRACT_* → passthrough）
(cd packages/brain && npx vitest run --no-cache \
  ../../tests/gp/f1/step3-provider-exit-structured-fidelity.test.js \
  -t "保真透传" --reporter=dot)
# ② 结构接线核验（entrypoint.sh 真调 classifier；接缝，无 docker 仅源码检视 + 语法）
grep -q "structured-terminal-classifier" docker/cecelia-runner/entrypoint.sh || { echo "FAIL: entrypoint 未接线 classifier"; exit 1; }
bash -n docker/cecelia-runner/entrypoint.sh || { echo "FAIL: entrypoint 语法错"; exit 1; }
```
**硬阈值**: ① exit 0（三类结构化终态全 passthrough）；② grep 命中 + `bash -n` 通过

---

### Step 3: kernel 按 CONTRACT_* 家族路由合同故障重开 GAN（不进黑名单/不 infra 重试）
**来源**: `[FROM_PRD]` — Golden Path 第 3 点 + 要求 2

**可观测行为**: `derive`（derive.js `attemptCallbackRoute`）收到 attempt callback，其 `error_code` 属 CONTRACT_* 家族（token 命中 `CONTRACT_FAULT_CORE_TOKENS`，如 `CONTRACT_TEST_UNSATISFIABLE`）时，**取路由优先级**：即便残留 `failure_class=infrastructure_blocked`，也不进 `infrastructure_blocked` 短路分支（derive.js:588），落到既有合同故障分支 → `arbitrate:contract_fault` / `reopen_gan_contract`。由此不进 `failed_targets` 黑名单（dispatcher 只对 infra 分类记 failed target）、不按 infrastructure 重试。

**验证命令**
```bash
(cd packages/brain && npx vitest run --no-cache \
  ../../tests/gp/f1/step3-provider-exit-structured-fidelity.test.js \
  -t "CONTRACT_ 家族故障码路由到合同故障重开" --reporter=dot)
```
**硬阈值**: exit 0（`derive().action === 'arbitrate:contract_fault'`，reason `contract_fault_appeal`，phase `gan`）

---

### Step 4: 失败留原因病族；真崩溃仍判 infrastructure（出口 + 负向铁律）
**来源**: `[FROM_PRD]` — Golden Path 第 4 点 + 边界情况「负向铁律」+ 要求 3

**可观测行为**: 无结构化产出的真实 provider 崩溃（`error_code=provider_exit`，不属 CONTRACT_* 家族）→ derive 仍走 `infrastructure_blocked` 有界重派（`spawn:generator-fix` / `callback_infrastructure_blocked`），仍可进黑名单/重试，语义不变；classifier 对 `structuredResult=null`（exit 1 / exit 124）返回 `passthrough=false` + `failureCode=provider_exit|provider_timeout`。

**验证命令**
```bash
(cd packages/brain && npx vitest run --no-cache \
  ../../tests/gp/f1/step3-provider-exit-structured-fidelity.test.js \
  -t "负向" --reporter=dot)
```
**硬阈值**: exit 0（负向两条：kernel 仍 infra 重派 + classifier 不透传落 provider_exit/provider_timeout）

---

## 禁 mock 边清单

本单涉及**状态机/分类路由**（derive attemptCallbackRoute）+ **回执归一化/生命周期钩子**（runner normalize），按刀2 硬规则逐条列禁 mock 的边：

- `derive`（`packages/brain/src/orchestrator/derive.js`）分类路由边 ↔ attempt callback：测试真调 `derive(observed)`，**禁** `vi.mock` derive / stub attemptCallbackRoute。derive 为纯函数无 DB 依赖，无需 Postgres。
- `classifyProviderTerminal`（`docker/cecelia-runner/structured-terminal-classifier.cjs`）纯函数边 ↔ runner 回执归一化：测试真 import 该 cjs，**禁** mock。
- 代码 ↔ DB：本单改动均为纯函数分类，**不触碰 DB 写路径**（故 `runtime_resources.postgres=false` 可全绿）；无 DB 边需禁 mock。
- 接缝（无 docker 不可行为验）：`entrypoint.sh` ↔ classifier 的 bash→node 接线，按铁律「接线用源码检视」以 grep + `bash -n` 核验，列入下方接缝清单 `logic-done-pending`。

---

## 接缝清单（接缝 vs 逻辑）

| 断言 | 类型 | 验证位置 | done 判定 |
|---|---|---|---|
| derive CONTRACT_* 路由优先级 | 逻辑 | vitest 纯函数 | 绿 = 真 done |
| derive 负向 provider_exit 仍 infra | 逻辑 | vitest 纯函数 | 绿 = 真 done |
| classifier 三类结构化终态 passthrough / 负向不透传 | 逻辑 | vitest 纯函数 | 绿 = 真 done |
| entrypoint.sh 真调 classifier 且透传生效 | **接缝** | 无 docker → 源码检视 grep + `bash -n`（真容器回执行为待真机） | `logic-done-pending`（真容器 e2e 未覆盖，见未覆盖清单） |

---

## 未覆盖真实链路清单

- **entrypoint.sh 真容器回执行为**：本 attempt 无 docker，无法起真容器跑 provider→normalize→callback 全链。`classifyProviderTerminal` 纯函数逻辑已行为验；entrypoint.sh 调用该函数并据此透传的接线，仅以 grep（真调 classifier）+ `bash -n`（语法）源码检视验证。补位计划：真机/CI 侧 `docker/cecelia-runner/entrypoint-provider-contract.test.sh` 或后续带 docker 的 fleet-worker attempt 补真容器回执断言。标 `logic-done-pending`。

---

## 已知约束

**（来自回归测试 — Step 1.2）**
- `tests/gp/f1/step3-runner-failure-retry.test.js` → runner_failure 是 infrastructure 族，有界重派同角色（≤2 次），不一刀杀 run（本单不得回退此语义）。
- `tests/gp/f1/step3-commander-runner-failure-and-unanchored-review.test.js` → commander runner_failure 重派语义（r77 上产，本单不得回退）。
- derive.js `CONTRACT_FAULT_CORE_TOKENS` 子集匹配（run 8374ab73 实证）→ CONTRACT_* 家族用「核心 token 子集」判定，本单复用不新造。

**（累积 FR — 累积FR，Step 1.3）**: 本 line 暂无历史（context-manifest：本 attempt Brain 不可达，标 unavailable，按 PRD「本 line 暂无历史」）。

---

## 八要素需求规范

| 要素 | 说明 | 本次答案 |
|------|------|----------|
| **FR（做什么）** | | runner 识别结构化终态并保真透传（禁降级 provider_exit）；kernel 对 CONTRACT_* 家族走合同故障重开 GAN，不进黑名单/不 infra 重试 |
| **NFR（做得多好）** | | 纯函数可重放（结构化终态识别与分类无副作用、无 DB）；无并发/延迟阈值（PrepPRD 未指定） |
| **Invariant（永不违反）** | | 真崩溃（无结构化产出）仍判 provider_exit/infrastructure（负向铁律）；成功判定看语义字段（subtype=success/.status/.schema），非仅 `ok:true`；失败契约显式 else |
| **判定点（怎么知道）** | | 见判定点登记表 |
| **保质期（何时过期）** | | 无 token/凭据时效；结构化终态 schema 变更时需同步 classifier 识别集合（随 harness result schema 版本） |
| **死亡告警（停了谁知道）** | | 若 classifier 误判致假透传/假崩溃，表现为 run 走错分支（黑名单激增 / 假成功面客）→ 由既有 harness 台账「判定点活性」+ run 终态审计发现 |
| **失败语义（挂了怎么办）** | | 见失败语义声明 |
| **效果确认（已发≠已生效）** | | kernel：derive 返回值即路由决策，vitest 断言 action/reason；runner：classifier passthrough 决策 vitest 断言；entrypoint 接线源码检视（接缝） |

### 判定点登记表

| 判定点 | 候选方法 | 所选方法 | 依据 | 误判后果 |
|--------|----------|----------|------|----------|
| （示例：微信群是否发送成功） | A. 监听按钮变灰; B. 读聊天记录 API | A | 记录 API 不稳 | 静默丢消息 |
| ⚠️ provider stdout 是否为「须保真透传的结构化终态」 | A. 校验终态 schema（`.status`∈枚举 / `subtype=success` / commander `.schema=commander-directive/v1`）; B. 仅判 `.status` 字段存在; C. 仅判 exit code | A（schema/语义字段校验） | 铁律「成功判定看语义字段，非仅 `ok:true`/存在性」；C 已被病根证伪（exit≠0 但 stdout 是 success） | 假透传真崩溃 → 假成功面客/污染黑名单语义；假判崩溃真成功 → 白烧重派、病族丢失。PRD 显式拍板（Golden Path 第 2/4 点），非待确认 |
| CONTRACT_* 家族归属 | A. `CONTRACT_FAULT_CORE_TOKENS` 子集匹配; B. 精确字符串相等 | A（复用现有子集匹配） | run 8374ab73 实证：精确相等对词序/多词漂移漏判 | 漏判 → CONTRACT_* 被 infra 重试吞掉，回退病根 |

> ⚠️ 行误判后果严重但均由 PRD Golden Path 显式拍板，非 PrepPRD 未拍的模糊判定，无需 `judgment-pending-user`。

### 失败语义声明

| 场景 | 失败行为 | 重试幂等？ | 降级策略 |
|------|----------|-----------|----------|
| classifier 收到 null/垃圾结构化产出 | 返回 `passthrough=false` + `failureCode=provider_exit`（exit124→provider_timeout） | 是（纯函数，同输入同输出） | 落 provider_exit，走既有 infrastructure 有界重派 |
| derive 收到非 CONTRACT_* 的 infra 失败 | 走既有 infrastructure_blocked 有界重派 | 是（纯函数） | 语义不变（负向铁律） |
| classifier 识别到结构化 BLOCKED 非 CONTRACT_* 家族 | 透传 BLOCKED + 原 error.code，但 kernel 不走合同重开 | 是 | 维持既有分类（边界情况铁律） |

### 输入对抗面

N/A — 本 sprint 为 kernel 内部路由 + runner 回执归一化，非对外暴露 agent，输入源为受信 provider stdout 与内部 decisionLog。

---

## E2E 验收（final-e2e — target_environment=local_api，纯函数重放）

> 本 attempt `runtime_resources.postgres=false` 且无 Brain server；被改逻辑均为纯函数（NFR 纯函数可重放）。故 E2E 用 node/vitest 从 `packages/brain` 工作目录跑 `tests/gp/**`（该目录仅由 packages/brain/vitest.config.js 的 `../../tests/gp/**` include 覆盖，禁从仓库根跑——根 config 不含 tests/gp），并对 runner 接线做源码检视。全绿 = Golden Path 四步（结构化终态 → 保真透传 → CONTRACT_* 合同重开 → 负向不变）端到端可重放通过。

```bash
#!/bin/bash
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"

# Step 1-4 纯函数重放：kernel 路由 + runner classifier（真 import 被改模块，禁 mock 被改边）
( cd packages/brain && npx vitest run --no-cache \
    ../../tests/gp/f1/step3-provider-exit-structured-fidelity.test.js --reporter=verbose )

# Step 2 接缝：entrypoint.sh 真调 classifier + 语法（无 docker，源码检视）
grep -q "structured-terminal-classifier" docker/cecelia-runner/entrypoint.sh \
  || { echo "FAIL: entrypoint.sh 未接线 structured-terminal-classifier"; exit 1; }
bash -n docker/cecelia-runner/entrypoint.sh \
  || { echo "FAIL: entrypoint.sh bash 语法错"; exit 1; }

# classifier 为可 require 的纯函数 SSOT（导出面存在）
node -e "const m=require('./docker/cecelia-runner/structured-terminal-classifier.cjs'); if(typeof m.classifyProviderTerminal!=='function'){console.error('FAIL: classifyProviderTerminal 未导出');process.exit(1)}; console.log('OK classifier export')"

echo "✅ Golden Path 纯函数重放全过（结构化保真透传 + CONTRACT_* 合同重开 + 负向不变）"
```

## 探索提示（L3 探索层 — evaluator 剧本全过后执行）

探索预算: 10 分钟 / 15 动作（默认；kernel 分类改动，风险集中在分类边界）
高风险面:
- 错输入: classifier 传 `structuredResult` 为数组 / 字符串 / `{status:'blocked'}` 但无 `error` 字段 → 应 `passthrough` 还是落 `provider_exit`？（须与 entrypoint 现有 jq 提取语义一致，不得抛异常）
- 边界值: `error_code` 为 `CONTRACT_ARTIFACTS_MISSING`（FROZEN 家族，已有 mark_failed 分支）→ 确认不被本单 CONTRACT_* 优先级误抢路由（须仍走 assembly mark_failed）
- 大小写/词序: `error_code='CONTRACT_TEST_CONTRACT_UNRESOLVABLE'` / 混词序 → 子集匹配是否稳定命中且不误伤无关产品 bug
- 中途中断: derive 收到 CONTRACT_* 但 decisionLog 已有一次 `reopen_gan_contract` → 应回落既有「第二次同类回人工」语义，不得无限重开
发现分级: P0/P1（假透传真崩溃 / CONTRACT_* 漏判回退病根 / FROZEN 家族被误抢）→ 阻塞 merge；P2/P3 → 记 findings 不阻塞

## GP-Anchor

gp-anchor: skipped (product-map.json not found)
