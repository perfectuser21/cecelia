# Sprint Contract Draft (Round 1) — publisher runner_failure 有界重派

**journey_type**: autonomous
**target_environment**: local_api
**journey_id**: e6f803f2-8c48-4cce-a7a1-5b1bda5e9c29 · **step_id**: F1-S3

contract-gate: cecelia worktree（packages/brain/src/lib/contract-gate.js 存在，代码层 Contract Gate 生效）
gp-anchor: skipped (product-map.json not found)

---

## Response Schema（推导来源: PRD 字面）

N/A — 任务无 HTTP 响应。本 sprint 是纯内部调度决策改动：`derive()` 是纯函数，输入 `observed` 快照、输出路由决策对象 `{ phase, action, reason }`。无新增/修改任何 HTTP 端点、无 DB 写路径。验收 oracle = 真 `derive` 断言（vitest），不经 5221 端点。

（决策对象字面契约，proposer 不得漂移字段名——PRD 是法律）：
- publisher runner_failure 首次/二次（prior<2）→ `{ phase:'publish', action:'publish:approved_ref', reason:'callback_runner_failure_retry' }`
- publisher runner_failure 超限（prior>=2）→ `{ phase:'review', action:'wait:human_review', reason:'callback_runner_failure_exhausted' }`
- 禁用 reason 字面值（改动后 publisher 分支绝不得再出现）：`callback_runner_failure_route_unknown`

---

## 已知约束（来自回归测试 + 累积 FR）

- [回归测试] `tests/gp/f1/step3-runner-failure-retry.test.js` → 「evaluator 的 runner_failure（首次）→ 同 run 重派 evaluator，不判终态」「generator 的 runner_failure（首次）→ 重派 generator-fix 路由」「同一 run 第 3 次 runner_failure → 进人审」「product 类失败（无 failure_class）照旧判终态」「cancelled 照旧判终态」——本 sprint 不得回退这些既有绿。
- [累积FR] context-manifest: 本 line（e6f803f2）golden-paths 返回空集，暂无历史累积 FR。
- [铁律 INV] runner_failure 是基础设施故障非产品失败，同角色有界重派 ≤2 次，超限进人审，不静默无限重试（决策批次 109dd8eb）；不轮换账号（那是 account_exhausted 语义）；基础设施抖动不得落进通用 mark_failed 烧掉已收敛的 GAN/judge/PR 产物。
- [MAP_NOT_CONFIGURED] task.payload.map_scope/map_repo 未配置，无 Unified Map 影响半径注入。

---

## 锚定父路声明

覆盖父路 F1「工厂 · 开发闭环」第 3 步「造完真验」（step_id F1-S3）——补齐 attempt callback(runner_failure) ↔ derive 决策边上 publisher 角色的有界重派路由。

## Golden Path

[publisher runner 抖动回调] → [derive 查角色重试表命中 publisher + 有界计数] → [同角色有界重派或超限进人审]

---

### Step 1: publisher attempt 回调 runner_failure（首次/二次，prior<2）
**来源**: `[FROM_PRD]` — PRD「Golden Path」第 1-2 步 + 「范围限定/在范围内」直接定义

**可观测行为**: `derive(observed)`（observed.decisionLog 含一条 `role=publisher, status=failed, failure_class=runner_failure` 的 attempt callback，此前 runner_failure 计数 <2）返回同角色有界重派决策，**不再**返回 `callback_runner_failure_route_unknown` / `wait:human_review`。

**验证命令**:
```bash
node -e "const {derive}=await import('./packages/brain/src/orchestrator/derive.js');const cb=(h,d)=>({hop:h,action:'verdict:attempt_callback',detail:{hop:h-1,...d}});const o={run:{phase:'publish'},task:{status:'in_progress'},prdExists:true,contract:{approved:true},pr:null,inflight:{containers:[],host_pids:[],attempts:[]},lastAgentExit:{code:0,auth_failed:false},proposeBranchRn:1,ganLatestRoundVerdict:'APPROVED',generatorSpawned:true,evaluateVerdict:null,judgeVerdict:null,reviewRequired:false,reviewApproved:false,counters:{hops:30,fixRound:0,pollCount:0,noPushStreak:0,noVerdictStreak:0,ganCostUsd:0},decisionLog:[cb(29,{status:'failed',failure_class:'runner_failure',role:'publisher'})]};const r=derive(o);if(r.action!=='publish:approved_ref'||r.reason!=='callback_runner_failure_retry')process.exit(1)"
# 期望：exit 0（action=publish:approved_ref, reason=callback_runner_failure_retry）
```

**硬阈值**: `action === 'publish:approved_ref'` 且 `reason === 'callback_runner_failure_retry'` 且 `reason !== 'callback_runner_failure_route_unknown'`

---

### Step 2: derive 查角色重试表命中 publisher（有界计数）
**来源**: `[FROM_PRD]` — PRD「系统处理」第 2 步：`INFRA_RETRY_ACTION_BY_ROLE['publisher']` 命中 `{ phase:'publish', action:PUBLISH_APPROVED_REF }`

**可观测行为**: `derive.js` 的 `INFRA_RETRY_ACTION_BY_ROLE`（Object.freeze）新增 `publisher` 键，值为 `{ phase:'publish', action: ACTION.PUBLISH_APPROVED_REF }`，复用 publisher 正常派发（derive.js:1356 `!pr && candidate` 的 publish 路由）的 phase/action，与其它角色 INFRA_RETRY 条目「重派同角色原动作」语义一致。

**验证命令**:
```bash
node -e "const c=require('fs').readFileSync('packages/brain/src/orchestrator/derive.js','utf8');const m=c.match(/INFRA_RETRY_ACTION_BY_ROLE\s*=\s*Object\.freeze\(\{[\s\S]*?\}\)/);if(!m||!/publisher\s*:\s*\{[^}]*phase:\s*'publish'[^}]*PUBLISH_APPROVED_REF/.test(m[0]))process.exit(1)"
# 期望：exit 0（路由表已登记 publisher → publish/PUBLISH_APPROVED_REF）
```

**硬阈值**: `INFRA_RETRY_ACTION_BY_ROLE` 块内含 `publisher: { phase:'publish', action: ACTION.PUBLISH_APPROVED_REF }`

---

### Step 3: 超限进人审兜底（prior>=2，出口）
**来源**: `[FROM_PRD]` — PRD「边界情况/超限」+「Invariant/有界重派」：同 run 第 3 次 publisher runner_failure → 进人审，不再重派

**可观测行为**: 当本 run publisher runner_failure 已累计 ≥2 次时，`derive` 返回 `{ phase:'review', action:'wait:human_review', reason:'callback_runner_failure_exhausted' }`，不静默无限重试。

**验证命令**:
```bash
node -e "const {derive}=await import('./packages/brain/src/orchestrator/derive.js');const cb=(h,d)=>({hop:h,action:'verdict:attempt_callback',detail:{hop:h-1,...d}});const sp=(h)=>({hop:h,action:'spawn:publisher',detail:{reason:'callback_runner_failure_retry'}});const o={run:{phase:'publish'},task:{status:'in_progress'},prdExists:true,contract:{approved:true},pr:null,inflight:{containers:[],host_pids:[],attempts:[]},lastAgentExit:{code:0,auth_failed:false},proposeBranchRn:1,ganLatestRoundVerdict:'APPROVED',generatorSpawned:true,evaluateVerdict:null,judgeVerdict:null,reviewRequired:false,reviewApproved:false,counters:{hops:30,fixRound:0,pollCount:0,noPushStreak:0,noVerdictStreak:0,ganCostUsd:0},decisionLog:[cb(21,{status:'failed',failure_class:'runner_failure',role:'publisher'}),sp(22),cb(25,{status:'failed',failure_class:'runner_failure',role:'publisher'}),sp(26),cb(29,{status:'failed',failure_class:'runner_failure',role:'publisher'})]};const r=derive(o);if(r.action!=='wait:human_review'||r.reason!=='callback_runner_failure_exhausted')process.exit(1)"
# 期望：exit 0（action=wait:human_review, reason=callback_runner_failure_exhausted）
```

**硬阈值**: `action === 'wait:human_review'` 且 `reason === 'callback_runner_failure_exhausted'`

---

## 禁 mock 边清单

本单改动 = 状态机路由决策（`derive` 的 attempt callback runner_failure 分支 + `INFRA_RETRY_ACTION_BY_ROLE` 路由表），属「状态机 / 跨模块数据传递（callback detail → 路由决策）」类。

- 代码 ↔ `derive` 路由决策边：测试必须调**真** `derive()`，禁止 stub / vi.mock `attemptCallbackRoute` / `infrastructureRetryForCallback` / `INFRA_RETRY_ACTION_BY_ROLE`（被改的正是这条路由边，mock 掉即结构性失效）。
- 无 DB 写路径、无第三方 API、无跨进程边——`derive` 是纯函数，允许 mock 的更外层依赖：无（本单不需要任何 mock）。

（本单无 Postgres/网络接缝，runtime_resources.postgres=false 与之一致。）

## 八要素需求规范

| 要素 | 说明 | 本次答案 |
|------|------|----------|
| **FR（做什么）** | 功能需求 | publisher runner_failure 回调走 `INFRA_RETRY_ACTION_BY_ROLE['publisher']` 有界重派（phase=publish, action=publish:approved_ref），超限进人审 |
| **NFR（做得多好）** | 性能/可靠性 | `derive` 纯函数，单次决策 <1ms；重试上界 = 2（沿用 runner_failure 同族） |
| **Invariant（永不违反）** | 不变量 | runner_failure 同角色有界重派 ≤2 次；不轮换账号；不落通用 mark_failed 烧产物；publisher 分支永不再返回 `callback_runner_failure_route_unknown` |
| **判定点（怎么知道）** | 判断假设 | （本任务无接缝判定点，N/A —— 全部为确定性纯函数分支判定，无对外部真实状态的推断） |
| **保质期（何时过期）** | 失效退役 | 路由表条目常驻，无过期；随 runner_failure 语义若整体重构则同步退役 |
| **死亡告警（停了谁知道）** | 告警 | 若 publisher runner_failure 再度回落 route_unknown → run hop 累积至确定性杀死，Kernel 案卷记录 + 冻结守卫测试 CI 红即告警 |
| **失败语义（挂了怎么办）** | 故障策略 | 见「失败语义声明」表 |
| **效果确认（已发≠已生效）** | 回执确认 | derive 决策对象 `{phase,action,reason}` 即回执；vitest 真 derive 断言确认路由生效 |

### 判定点登记表

| 判定点 | 候选方法 | 所选方法 | 依据 | 误判后果 |
|--------|----------|----------|------|----------|
| （示例：微信群是否发送成功） | A. 监听按钮变灰; B. 读聊天记录 | A | API 不稳 | 静默丢消息 |

（本任务无接缝判定点，N/A —— publisher runner_failure 分支为确定性 decisionLog 计数 + 路由表查表，不推断任何外部真实状态。）

### 失败语义声明

| 场景 | 失败行为 | 重试幂等？ | 降级策略 |
|------|----------|-----------|----------|
| publisher runner（容器/guard/依赖装配）起不来，failure_class=runner_failure | 有界重派同角色 publisher（phase=publish, action=publish:approved_ref） | 是（幂等键=run 内 runner_failure 计数；同一 candidate 重派） | 累计 ≥2 次 → 进人审 wait:human_review，不再重派 |
| publisher product 类失败（无 failure_class） | 照旧 mark_failed（callback_failed）| N/A | 不被本次放宽误命中 |

### 输入对抗面

N/A —— 本单为内部调度决策纯函数，无对外暴露 agent / 用户可写入接口，输入为 Kernel 自产 decisionLog 快照。

---

## E2E 验收（最终 final-e2e 跑 — target_environment=local_api）

**journey_type**: autonomous
**target_environment**: local_api

> 纯 derive 逻辑验收，无需 Postgres（runtime_resources.postgres=false）、无 HTTP 端点。evaluator 从仓库根跑 vitest（tests/** 与 sprints/** 均在根 vitest.config.js include 内，允许从根跑）。

```bash
#!/bin/bash
set -euo pipefail
cd "${WORKSPACE_PATH:-/workspace}"

# 1. 冻结守卫（本 sprint 新写，真 derive）必须全绿：publisher 有界重派 + 超限进人审 + 负向 + 他族回归
OUT_GUARD=$(npx vitest run "sprints/08220927-kernel-5b3f73e5/tests/publisher-runner-failure-retry.test.js" --reporter=verbose 2>&1) || true
echo "$OUT_GUARD" | tail -30
echo "$OUT_GUARD" | grep -Eq "[1-9][0-9]* passed" || { echo "FAIL: 冻结守卫无通过用例"; exit 1; }
echo "$OUT_GUARD" | grep -Eq "[1-9][0-9]* failed" && { echo "FAIL: 冻结守卫存在失败用例"; exit 1; }

# 2. 回归：既有 runner_failure 守卫（evaluator/generator/超限/负向）仍全绿，publisher 补丁不越权他族
OUT_REG=$(npx vitest run "tests/gp/f1/step3-runner-failure-retry.test.js" --reporter=verbose 2>&1) || true
echo "$OUT_REG" | tail -20
echo "$OUT_REG" | grep -Eq "[1-9][0-9]* passed" || { echo "FAIL: 回归守卫无通过用例"; exit 1; }
echo "$OUT_REG" | grep -Eq "[1-9][0-9]* failed" && { echo "FAIL: 回归守卫存在失败用例"; exit 1; }

# 3. 源码闸：INFRA_RETRY_ACTION_BY_ROLE 已登记 publisher → publish/PUBLISH_APPROVED_REF（route_unknown 分支不再命中）
node -e "const c=require('fs').readFileSync('packages/brain/src/orchestrator/derive.js','utf8');const m=c.match(/INFRA_RETRY_ACTION_BY_ROLE\s*=\s*Object\.freeze\(\{[\s\S]*?\}\)/);if(!m||!/publisher\s*:\s*\{[^}]*PUBLISH_APPROVED_REF/.test(m[0])){console.error('publisher 未登记');process.exit(1)}"

# 4. 直验：真 derive publisher runner_failure 首次 → 有界重派（防守卫文件被篡改绕过）
node -e "const {derive}=await import('./packages/brain/src/orchestrator/derive.js');const cb=(h,d)=>({hop:h,action:'verdict:attempt_callback',detail:{hop:h-1,...d}});const o={run:{phase:'publish'},task:{status:'in_progress'},prdExists:true,contract:{approved:true},pr:null,inflight:{containers:[],host_pids:[],attempts:[]},lastAgentExit:{code:0,auth_failed:false},proposeBranchRn:1,ganLatestRoundVerdict:'APPROVED',generatorSpawned:true,evaluateVerdict:null,judgeVerdict:null,reviewRequired:false,reviewApproved:false,counters:{hops:30,fixRound:0,pollCount:0,noPushStreak:0,noVerdictStreak:0,ganCostUsd:0},decisionLog:[cb(29,{status:'failed',failure_class:'runner_failure',role:'publisher'})]};const r=derive(o);if(r.action!=='publish:approved_ref'||r.reason!=='callback_runner_failure_retry'){console.error('FAIL',JSON.stringify(r));process.exit(1)}"

echo "PASS: publisher runner_failure 有界重派验收通过"
```

---

## 探索提示（L3 探索层 — evaluator 剧本全过后执行）

探索预算: 10 分钟 / 15 动作（默认）
高风险面:
- 错输入: decisionLog 里 publisher runner_failure 与他族（evaluator）runner_failure 交错混排 → 确认 priorRunnerFailures 计数只按 hop<row.hop 的 ATTEMPT_CALLBACK 全局计数（现有实现按 failure_class 计数不分角色），publisher 补丁不改变计数语义。
- 重复提交: 连续多条同 hop 的 publisher runner_failure callback → 确认 latestUnconsumedAttemptResult 只取最新一条，不双计。
- 中途中断: prior=1 时插入一条 account_exhausted callback → 确认不误命中 account_exhausted 分支（本单只碰 runner_failure）。
- 边界值: prior 恰好=2（第 3 次）→ exhausted；prior=1（第 2 次）→ 仍重派。边界不得 off-by-one。
发现分级: P0/P1（publisher 回落 route_unknown / 误杀 run / 越权他族路由）→ 阻塞 merge；P2/P3 → 记 findings 不阻塞

---

## Test Contract

| 功能 | Test File | BEHAVIOR 覆盖 | 预期红证据 |
|---|---|---|---|
| publisher runner_failure 有界重派（冻结守卫，真 derive）| `sprints/08220927-kernel-5b3f73e5/tests/publisher-runner-failure-retry.test.js` | `runner_failure（首次）→ 同角色有界重派 publish:approved_ref`；`runner_failure（第二次，prior=1）→ 仍有界重派`；`第 3 次 publisher runner_failure（prior>=2）→ 进人审 exhausted`；`product 类失败（无 failure_class）照旧判终态 mark_failed`；`evaluator 的 runner_failure（首次）仍重派 evaluator` | 补丁前 2 failed（首次/二次重派返回 route_unknown+wait:human_review）\| 3 passed（超限/负向/他族回归） |
| 既有 runner_failure 守卫回归（补充行，repo 既有测试）| `tests/gp/f1/step3-runner-failure-retry.test.js` | evaluator/generator 首次重派、第 3 次进人审、product/cancelled 终态 | 补丁前后恒绿（回归护栏）|
