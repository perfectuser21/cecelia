# Sprint Contract Draft (Round 1)

**Sprint**: 合同重开后主链派全新 generator，根除 WORKSPACE_RESOLUTION_FAILED 必死（r73 台账 P1）
**journey_type**: autonomous
**target_environment**: local_api（纯 Brain 内部纯函数，本地 evaluator 直跑 vitest 真 import derive.js）
**contract-gate**: skipped (file not found, third-party repo) —— 见下（cecelia worktree 无 packages/brain/src/lib/contract-gate.js 时跳过代码层 gate，仅走 skill 内置规则）
gp-anchor: skipped (product-map.json not found)

> 实现基线（frozen）：`2caf256f2eb40358b4d0467ebac194d6c134c299`。derive.js 在 c7a40c75c 与 2caf256f2 逐字节一致（PRD 提交只加文档），Generator 从冻结基线实现。

## 锚定父路声明

覆盖父路 factory/F1「造完真验」第 3 步（合同批准后 no_pr 主链路由判定）。本 sprint 只收窄该步 `deriveTask` 3a `no_pr` 分支在**合同重开纪元**下的路由，不新增独立小路。

## Response Schema（推导来源: PRD 字面）

N/A — 任务无 HTTP 响应。`packages/brain/src/orchestrator/derive.js` 是纯函数状态机（`derive(observed) → {phase, action, reason}`），无端点、无 DB 写。验收对象是**函数返回对象**的三个字段：

- `phase` (string)
- `action` (string，取值 `spawn:generator` | `spawn:generator-fix`)
- `reason` (string，取值 `contract_reopened_fresh_generator` | `no_pr`)

**禁用字段名**：不得把 `reason` 写成 `contract_reopen`/`fresh_gen`/`reopen_no_pr` 等同义漂移词；`action` 不得写成 `spawn:generator_fresh` 之类新枚举——只能字面用 PRD 给的 `spawn:generator` + `contract_reopened_fresh_generator`。

---

## Golden Path

[合同重开后新合同批准 + no_pr] → [derive `deriveTask` 3a 观测 `decisionLog` 含 `REOPEN_GAN_CONTRACT` 行 + 纪元后未派全新 generator] → [返回 `spawn:generator` / `contract_reopened_fresh_generator`（从冻结基线重写）]

### Step 1: 合同重开纪元内 no_pr → 派全新 generator（根治 r73）
**来源**: `[FROM_PRD]` — PRD「Golden Path（核心场景）」第 1-3 条 + 「背景」段直接定义。

**可观测行为**: `derive(observed)` 在 `contract.approved=true`、`generatorSpawned=true`、`pr=null`、`candidate=null`（落 `deriveTask` 3a `no_pr`）且 `decisionLog` 内存在 `reopen_gan_contract` 行、该 reopen `hop` 之后无 `spawn:generator` 行时，返回 `{phase:'generate', action:'spawn:generator', reason:'contract_reopened_fresh_generator'}`。**不**返回 `spawn:generator-fix`。

**验证命令**:
```bash
# 从冻结基线复刻 r73 观测快照，断言修后路由（纯函数，无 I/O）
(cd /workspace && node -e '
  import("./packages/brain/src/orchestrator/derive.js").then(({derive})=>{
    const IDENTITY={contract_id:"c2",manifest_sha256:"m2",source_revision:"r2"};
    const log=[
      {hop:10,action:"spawn:generator",detail:{reason:"contract_approved"}},
      {hop:11,action:"verdict:attempt_callback",detail:{role:"generator",status:"completed"}},
      {hop:12,action:"reopen_gan_contract",detail:{reason:"contract_fault_reopen_gan",callback_hop:11}},
      {hop:13,action:"spawn:proposer",detail:{reason:"revision_requested"}},
      {hop:14,action:"verdict:reviewer",detail:{approved:true}}];
    const o={run:{phase:"generate"},task:{status:"in_progress"},prdExists:true,pr:null,candidate:null,
      contract:{approved:true,identity:IDENTITY},inflight:{containers:[],host_pids:[],attempts:[]},
      lastAgentExit:{code:0,auth_failed:false,action:"spawn:generator"},proposeBranchRn:2,
      ganLatestRoundVerdict:"APPROVED",generatorSpawned:true,evaluateVerdict:null,judgeVerdict:null,
      reviewRequired:false,reviewApproved:false,
      counters:{hops:30,fixRound:1,pollCount:0,noPushStreak:0,noVerdictStreak:0,ganCostUsd:0},decisionLog:log};
    const r=derive(o);
    if(r.action!=="spawn:generator"||r.reason!=="contract_reopened_fresh_generator"){console.error("FAIL",JSON.stringify(r));process.exit(1);}
    console.log("OK",JSON.stringify(r));
  });')
# 期望：OK {"phase":"generate","action":"spawn:generator","reason":"contract_reopened_fresh_generator"}
```

**硬阈值**: `action === 'spawn:generator'` 且 `reason === 'contract_reopened_fresh_generator'`（修前为 `spawn:generator-fix`/`no_pr` → RED）。

---

### Step 2: 有界重发——重开后已派全新 generator，再 no_pr → 回落既有 fix 语义
**来源**: `[FROM_PRD]` — PRD「边界情况 · 有界重发」直接定义。

**可观测行为**: 同 Step 1，但 `decisionLog` 在 reopen `hop` **之后**已存在 `spawn:generator` 行（全新 generator 已派过一次）时，不再无限重发全新 generator，返回 `{action:'spawn:generator-fix', reason:'no_pr'}`（沿用既有 fix 计数语义，由结构化收敛探测器决定终止）。

**验证命令**:
```bash
# 见 sprints/08292318-kernel-a478def7/tests/derive-reopen-fresh-generator.test.js 的 B-02
(cd /workspace && npx vitest run sprints/08292318-kernel-a478def7/tests/derive-reopen-fresh-generator.test.js -t 'B-02' --reporter=basic)
# 期望：1 passed（action=spawn:generator-fix, reason=no_pr）
```

**硬阈值**: `action === 'spawn:generator-fix'` 且 `reason === 'no_pr'`。

---

### Step 3: 负向 + 纪元隔离——无重开历史仍 fix；重开前的 generator 不算「已派」
**来源**: `[FROM_PRD]` — PRD「边界情况 · 负向不变 / 纪元隔离」直接定义。

**可观测行为**:
- 无 `reopen_gan_contract` 行的 `no_pr` → 语义不变，仍 `{action:'spawn:generator-fix', reason:'no_pr'}`（B-03）。
- reopen `hop` **之前**的 `spawn:generator` 行不得被计入「重开后已派全新 generator」，仍派全新 generator（B-04）。

**验证命令**:
```bash
(cd /workspace && npx vitest run sprints/08292318-kernel-a478def7/tests/derive-reopen-fresh-generator.test.js -t 'B-03' --reporter=basic)
(cd /workspace && npx vitest run sprints/08292318-kernel-a478def7/tests/derive-reopen-fresh-generator.test.js -t 'B-04' --reporter=basic)
# 期望：B-03 → spawn:generator-fix/no_pr；B-04 → spawn:generator/contract_reopened_fresh_generator
```

**硬阈值**: B-03 `spawn:generator-fix`/`no_pr`；B-04 `spawn:generator`/`contract_reopened_fresh_generator`。

---

## 已知约束（来自回归测试 + 累积 FR + 铁律）

- `[回归测试]` `packages/brain/src/orchestrator/__tests__/derive.test.js` L1187/L1192：`no_pr（无 reopen）→ spawn:generator-fix，fixRound 仅观测`——本 sprint 的负向红线，**语义必须保持**（这些用例 `decisionLog` 无 reopen 行，我的门控改动不触达它们，静态确认无冲突）。
- `[回归测试]` `packages/brain/src/orchestrator/__tests__/derive.test.js` L67：`verified local candidate 无远端 PR 进 Evaluator，不误判 no_pr`——本改动只在 `!implementationTarget`（无候选无 PR）分支内，不影响有候选路径。
- `[回归测试]` `tests/gp/f1/step3-seal-reject-reopens-gan.test.js` / `step3-artifacts-missing-reopen.test.js`：reopen 触发链——本改动不动 reopen 触发本身（PRD「不在范围内」），仅消费 reopen 行做纪元识别。
- `[累积FR]` context-manifest: unavailable（本地无 Brain 5221 上下文端点，autonomous 纯函数 sprint，累积 FR 由 PRD「累积 FR」段声明为空）。
- `[铁律 INV]` `generator-infra-retry-identity`（首次 generator 重派 generator，generator-fix 重派 generator-fix）：本改动是**合同重开纪元**下对 no_pr 的**独立**判定，`reason=contract_reopened_fresh_generator` 与 infra-retry 身份正交，不改 generator-fix 的 infra 重派身份（DoD INV-1 守卫）。
- `[铁律 INV]` `kernel-validation-clock` / `planner-role-branch` / `fleet-brain-url`：本改动为纯函数路由，不触碰 validation clock / 分支 checkout / URL 注入（DoD INV-2/3/4 显式 N/A）。

## 真实调用方请求 shape

N/A — 无设备/agent 调服务端（纯 Brain 内部纯函数，`derive` 只读内存 observed 快照，不接外部请求）。

## 禁 mock 边清单

本单命中「状态机（no_pr 路由判定/纪元终态识别）」+「跨模块数据传递（`decisionLog` 行在 derive 内被读取解释）」两类，failing test 必须真跑被改的边：

- 代码 ↔ `derive.js` 路由逻辑（本单改 `deriveTask` 3a `no_pr` 分支）：测试 **真 import** `packages/brain/src/orchestrator/derive.js` 的 `derive`，禁止 `vi.mock`/stub derive 或其内部 helper（`sortedLogRows` / `ACTION` / `fixRoute`）。
- 路由 ↔ `decisionLog` 行（纪元识别读 `reopen_gan_contract` / `spawn:generator` 行）：测试用**真实结构**的 `decisionLog` 行喂入，不 mock 行解析。

`derive` 是纯函数、无 DB/无相邻模块 I/O（runtime_resources.postgres=false 已确认），故本单不需要真 Postgres，也无更外层依赖需 mock——**全链零 mock**。

## 未覆盖真实链路清单

（本合同无 mock 豁免，N/A）——测试全链零 mock，无 `force_*`/stub/假数据。

---

## 八要素需求规范

| 要素 | 说明 | 本次答案 |
|------|------|----------|
| **FR（做什么）** | 系统对外承诺 | 合同重开纪元内 no_pr 的 derive 路由从 `spawn:generator-fix` 改为 `spawn:generator`(`contract_reopened_fresh_generator`)；重开后已派过则回落 fix；无重开历史语义不变 |
| **NFR（做得多好）** | 性能/可靠性 | 纯函数、确定性可重放：同一 observed 快照必得同一路由结果（无 Date.now/Math.random/new Date） |
| **Invariant（永不违反）** | 不变量 | (a) 无 `reopen_gan_contract` 行时 no_pr 路由逐字节等价现行（零回归）；(b) 不引入无界重发全新 generator；(c) 不改 reopen 触发本身与 workspace 回收策略 |
| **判定点（怎么知道）** | 对模糊现实的判断 | 见判定点登记表 |
| **保质期（何时过期）** | 何时失效 | 路由规则随 derive 状态机长期有效；无 token/时效数据 |
| **死亡告警（停了谁知道）** | 告警 | 回归失效由 CI「Sprint Tests 实跑」+ `tests/gp/f1` 永久回归红灯即时暴露 |
| **失败语义（挂了怎么办）** | 故障策略 | 见失败语义声明 |
| **效果确认（已发≠已生效）** | 回执 | 路由结果即返回值，测试 `expect(r.action)`/`expect(r.reason)` 直接机检；无异步「已发未生效」窗口 |

### 判定点登记表

| 判定点 | 候选方法 | 所选方法 | 依据 | 误判后果 |
|--------|----------|----------|------|----------|
| ⚠️「合同重开发生过」 | A. `decisionLog` 存在 `reopen_gan_contract` 行; B. 比对 `proposeBranchRn` 与 reviewer verdict 时序 | A. `decisionLog` 存在 `reopen_gan_contract` 行 | reopen 是 derive 自己写入的权威动作行（`ACTION.REOPEN_GAN_CONTRACT`），是纪元起点的最可靠锚 | 误判「未重开」→ 仍走 fix → 复撞 WORKSPACE_RESOLUTION_FAILED 必死（r73 原病） |
| ⚠️「重开后已派过全新 generator」 | A. 纪元起点 hop 之后存在 `spawn:generator` 行; B. 计 fixRound 数 | A. `latestReopenHop` 之后存在 `spawn:generator` 行 | 与纪元起点同源（hop 时序），可重放；避免把重开**前**的 generator 误计入 | 误判「已派」→ 该重写却回落 fix → 复死；误判「未派」→ 无界重发全新 generator（烧算力） |

> ⚠️ 两判定点误判后果均为「确定性必死或无界重发」，属升拍板级；PrepPRD 已在「假设 [ASSUMPTION]」段拍定用 `REOPEN_GAN_CONTRACT` 行 + 纪元后 `spawn:generator` 判定，锚点交由读 derive.js 现有 helper（`sortedLogRows`）实现，无待确认项。

### 失败语义声明

| 场景 | 失败行为 | 重试幂等？ | 降级策略 |
|------|----------|-----------|----------|
| observed 缺 `decisionLog` | `sortedLogRows(undefined)` 返回 `[]`（现有语义），`latestReopenHop=null` → 回落 fixRoute('no_pr')（等价现行） | 是（纯函数） | 无 reopen 行即等价旧行为，fail-safe 到现行语义 |
| reopen 行存在但 hop 字段异常 | `Number(hop)` NaN 比较为 false → 保守回落 fix | 是 | 不误升级为无界重发 |

### 输入对抗面

N/A — 非对外暴露 agent；`derive` 只被 Brain reconcile loop 以内部 observed 快照调用，无外部可写输入、无 prompt injection 面。

---

## E2E 验收（final-e2e 跑 — target_environment=local_api，纯函数 vitest 真 import）

> 纯 Brain 内部纯函数，无需真实后端/DB（runtime_resources.postgres=false）。E2E = 从仓库根跑 vitest（冻结测试落 `sprints/**`，被根 `vitest.config.js` include 覆盖），真 import `packages/brain/src/orchestrator/derive.js`，断言三类场景路由。测试文件在 `sprints/**` 与 `tests/**`，允许从仓库根 `npx vitest run`（非 `packages/<pkg>/src/**`，无需子 shell）。

```bash
#!/bin/bash
set -euo pipefail
cd /workspace

# 1. 冻结合同测试（sprints/<sprint_dir>/tests/）真 import derive.js，四场景全绿（修后）
npx vitest run sprints/08292318-kernel-a478def7/tests/derive-reopen-fresh-generator.test.js --reporter=basic

# 2. 永久回归（tests/gp/f1/）同样全绿
npx vitest run tests/gp/f1/step3-contract-reopen-fresh-generator.test.js --reporter=basic

# 3. 直跑纯函数 oracle：复刻 r73 观测快照 → 断言修后路由（不依赖 vitest，独立可复跑）
node -e '
  import("./packages/brain/src/orchestrator/derive.js").then(({derive})=>{
    const IDENTITY={contract_id:"c2",manifest_sha256:"m2",source_revision:"r2"};
    const mk=(log)=>({run:{phase:"generate"},task:{status:"in_progress"},prdExists:true,pr:null,candidate:null,
      contract:{approved:true,identity:IDENTITY},inflight:{containers:[],host_pids:[],attempts:[]},
      lastAgentExit:{code:0,auth_failed:false,action:"spawn:generator"},proposeBranchRn:2,
      ganLatestRoundVerdict:"APPROVED",generatorSpawned:true,evaluateVerdict:null,judgeVerdict:null,
      reviewRequired:false,reviewApproved:false,
      counters:{hops:30,fixRound:1,pollCount:0,noPushStreak:0,noVerdictStreak:0,ganCostUsd:0},decisionLog:log});
    const reopen=[{hop:10,action:"spawn:generator",detail:{reason:"contract_approved"}},
      {hop:11,action:"verdict:attempt_callback",detail:{role:"generator",status:"completed"}},
      {hop:12,action:"reopen_gan_contract",detail:{reason:"contract_fault_reopen_gan",callback_hop:11}},
      {hop:13,action:"spawn:proposer",detail:{reason:"revision_requested"}},
      {hop:14,action:"verdict:reviewer",detail:{approved:true}}];
    const neg=[{hop:10,action:"spawn:generator",detail:{reason:"contract_approved"}},
      {hop:11,action:"verdict:attempt_callback",detail:{role:"generator",status:"completed"}},
      {hop:12,action:"spawn:generator-fix",detail:{reason:"no_pr"}}];
    const r1=derive(mk(reopen));
    const r3=derive(mk(neg));
    const ok = r1.action==="spawn:generator" && r1.reason==="contract_reopened_fresh_generator"
      && r3.action==="spawn:generator-fix" && r3.reason==="no_pr";
    if(!ok){console.error("FAIL",JSON.stringify({r1,r3}));process.exit(1);}
    console.log("OK r73-route",JSON.stringify({r1,r3}));
  });'

echo "✅ Golden Path 验证通过（r73 合同重开纪元派全新 generator）"
```

---

## 探索提示（L3 探索层 — evaluator 剧本全过后执行）

探索预算: 10 分钟 / 15 动作（默认；纯函数低风险，不上调）
高风险面:
- 错输入: `decisionLog` 传 `null` / `[]` / 缺 `hop` 字段的 reopen 行 → 断言不崩溃且回落 fix（fail-safe）。
- 重复提交: 多条 `reopen_gan_contract` 行（连续两次重开）→ 只认最新 `latestReopenHop`，纪元后判定仍正确。
- 中途中断: reopen 行 hop 大于所有 `spawn:generator` hop（重开后一次未派）vs 小于（已派）边界值（hop 相等的边界）。
- 边界值: reopen 行与 `spawn:generator` 行同 hop（`>` 严格比较，同 hop 不算「纪元后已派」）。
发现分级: P0/P1（无重开却误派 generator / 重开却仍 fix 必死 / 无界重发）→ 阻塞 merge；P2/P3 → 记 findings 不阻塞

---

## Test Contract

| 功能 | Test File | BEHAVIOR 覆盖 | 预期红证据 |
|---|---|---|---|
| 合同重开纪元 no_pr 派全新 generator（r73 根治） | `sprints/08292318-kernel-a478def7/tests/derive-reopen-fresh-generator.test.js` | B-01 / B-02 / B-03 / B-04 | 修前 B-01、B-04 断言 `spawn:generator` 失败（实得 `spawn:generator-fix`）→ 2 failed / 2 passed |
| 同上（永久回归副本，PRD 指定家目录） | `tests/gp/f1/step3-contract-reopen-fresh-generator.test.js` | B-01 / B-02 / B-03 / B-04 | 同上（永久保留为回归，硬规则 #20） |

> 冻结测试（seal 必收）：`sprints/08292318-kernel-a478def7/tests/derive-reopen-fresh-generator.test.js`（已落盘、进 commit）。`tests/gp/f1/...` 为补充回归行（PRD 要求的永久回归家目录）。BEHAVIOR 覆盖名 `B-01`…`B-04` 均为对应 `it()` 名的字面子串。
