# Sprint Contract Draft (Round 1)

**锚定父路声明**: 独立小路（无父路）—— 本 sprint 是 Harness orchestrator 自愈闭环改造，非产品线 Golden Path 步骤推进。

**journey_type**: autonomous
**target_environment**: local_api
**map**: `[MAP configured: scope=cecelia, repo=perfectuser21/cecelia; payload.expected_files 为空 → radius 为空, must_run_assertions=[]]`（无额外必跑回归断言注入）
**gp-anchor**: skipped (product-map.json not found)
**contract-gate**: cecelia worktree，`packages/brain/src/lib/contract-gate.js` 存在 → 代码层 Contract Gate 生效，本合同断言按速查表写 gate-clean。

gate-allow: domain/db-no-time-window 本合同的 psql 探针只对刚建的 TEMP/隔离库新表做连通性+建查验证（CREATE TEMP TABLE 后立即 count 本行 / SELECT 1），不是"聚合业务表历史数据冒充本轮产出"场景——被验证的行就是本探针刚 INSERT 的，时间窗不适用；跨轮防伪由集成测试隔离库 pid+uuid + attempt 独享销毁保证。

---

## Response Schema（推导来源: PRD 字面 + 内部接口契约；本 sprint 无对外 HTTP 端点）

本 sprint 改动是 Brain Harness orchestrator 内部数据流，**无新增对外 HTTP 端点**。可观测契约有三处（generator 必须逐字实现，evaluator 逐条机检）：

### A. Dispatcher 预检控制结果（PG 不可供给时的 fail-closed 形状）

`dispatch()` 返回对象（既有结构，本 sprint 复用）：
```json
{"control_status": "BLOCKED", "should_create_attempt": false, "should_enter_generator_fix": false, "action": "wait:human_review", "fallback_reason": "<string>"}
```
- `control_status` (string, 必填): 字面量 `"BLOCKED"`（PG 供给失败时）—— 来源 [PRD Golden Path 步骤2 「control_status=BLOCKED」字面]
- `should_create_attempt` (boolean, 必填): 字面 `false`（不创建会自报 PASS 的 Evaluator）—— 来源 [PRD 步骤2]
- **禁用字段名**: `PASS` / `ok:true` 作为 PG 不可供给时的返回（会掩盖 fail-closed）

### B. Evaluator TaskBundle inputs（recollect 时携带 Judge 反馈）

Evaluator TaskBundle 的 `inputs` 段（recollect 轮新增）：
```json
{"runtime_resources": {"postgres": true, "node_deps": true}, "judge_feedback": {"missing_evidence": ["<string>"], "raw_feedback": "<string>"}}
```
- `inputs.runtime_resources.postgres` (boolean, 必填): 合同含 PG 必验命令时机械派生为 `true` —— 来源 [PRD 步骤1]
- `inputs.judge_feedback` (object, recollect 轮必填): Judge 缺证清单 + 原始反馈；`missing_evidence` 为非空数组，`raw_feedback` 为非空字符串 —— 来源 [PRD 步骤5]
- **禁用行为**: recollect 轮 `inputs.judge_feedback` 缺失/为 null（=同构重跑，PRD 明确禁止）

### C. Evaluator `.brain-result.json` 出口（既有结构，本 sprint 强化）

```json
{"verdict": "PASS"|"FAIL", "exit_code": <number>, "log_tail": "<string>", "behavior_tests": [{"command": "<string>", "exit_code": <number>, "log_tail": "<string>"}]}
```
- 必验项 unverifiable（PG 未供给 / PG 命令未真跑）时 `verdict` **不得**为 `"PASS"` —— 来源 [PRD 步骤4]
- PG 必验项证据必须含真实 psql 命令的 stdout/stderr/exit code（不接受仅引用 GitHub CI）—— 来源 [PRD NFR 可观测 + Invariant judge证据结构]

---

## 内部接口契约（generator 必须按此实现，供 tests / BEHAVIOR 机检）

| 模块 | 导出 / 行为 | 语义 |
|---|---|---|
| `preflight/requirements.js` | `contractRequiresPostgres(contractText: string): boolean` | 合同可执行验收文本含 `psql` 或 `pg_<x>` 命令 → `true`（机械识别，不做领域猜测） |
| `preflight/requirements.js` | `deriveCapabilityRequirements({ role, requirements, contract })` | 新增可选 `contract` 入参（批准合同文本/产物）；其可执行验收含 PG 使用时 `postgres:true`，**即使 `requirements` 未手填 postgres**。旧签名（无 contract）行为不变 |
| `orchestrator/dispatcher.js` | evaluator `buildInputs` | recollect 轮（route.reason=`judge_evidence_insufficient_recollect`）把 `observed.judgeVerdict` 的缺证清单+原始反馈注入 `inputs.judge_feedback` |
| `harness-judge.js` | verdict 结构 | `failure_class='evidence_insufficient'` 时 verdict 落库含结构化 `missing_evidence: string[]`（供 recollect 消费） |
| `orchestrator/execution-contract.js` | evaluator 出口守卫 | 合同必验项 unverifiable（要求 postgres 但 runtime 无 PG，或 behavior_tests 缺 PG 真跑证据）时，强制 `verdict != 'PASS'` |
| `orchestrator/derive.js` | 收敛护栏 | 同 SHA 已 `judge_evidence_insufficient_recollect` 一次仍 evidence_insufficient → `wait:human_review`（既有 `alreadyRecollected` 逻辑，本 sprint 加回归测试锁定） |

---

## 已知约束（来自回归测试 + 累积 FR）

- [回归] `orchestrator/__tests__/dispatcher.test.js` → dispatcher 预检 BLOCKED / runtime_resources 组装分支既有覆盖，不得回退
- [回归] `orchestrator/__tests__/derive.test.js` → `evidence_insufficient` recollect / `alreadyRecollected → wait:human_review` 既有分支覆盖，本 sprint 只增不改语义
- [回归] `__tests__/harness-judge.test.js` → `JUDGE_FAILURE_CLASSES=['evidence_insufficient','product_failure']`；behavior_tests 空 / 缺 exit_code / 缺 log_tail → FAIL（既有铁律）
- [回归] `preflight/capability-gate.test.js` / `requirements.test.js` → `parseCapabilityRequirements` / `deriveCapabilityRequirements` 既有 postgres 语义
- [回归] `fleet-node/node-admission.js` → `runtime_resources.postgres.available` / `postgres_runtime_unavailable` fail-closed 既有闸门
- [累积FR] context-manifest: 本 line（journey e6f803f2）暂无历史 FR（PRD「累积 FR」段为空）
- [回归] `__tests__/integration/gan-case-file.pg.integration.test.js` → 真库集成测试隔离库命名范式 `<name>_<pid>_<uuid>`（本 sprint 新 PG 集成测试沿用）

---

## Golden Path

[Dispatcher 派发 Evaluator（批准合同含 PG 必验命令）] → [机械派生 runtime_resources.postgres=true] → [preflight 供给隔离 PG / 不可供给则 fail-closed BLOCKED] → [Evaluator 容器真跑 PG 留 stdout/stderr/exit] → [必验项 unverifiable → 非 PASS] → [Judge evidence_insufficient → 结构化缺证清单落库 + recollect 注入下一轮 bundle] → [同 SHA 补证一次仍不足 → 收敛 wait:human_review]

---

### Step 1: 合同 → PG capability 机械派生
**来源**: `[FROM_PRD]` — PRD Golden Path 步骤1「从批准合同/可执行验收要求机械派生 PostgreSQL capability requirement（不依赖人工在 payload 手填）」

**可观测行为**: 批准合同的可执行验收文本含 `psql`/`pg_*` 命令时，`contractRequiresPostgres` 返回 true，且经 `deriveCapabilityRequirements({role:'evaluator', requirements:{}, contract})` 派生出 `postgres:true`（`requirements` 未手填 postgres 也成立）。

**验证命令**:
```bash
node --input-type=module -e '
import { contractRequiresPostgres, deriveCapabilityRequirements } from "./packages/brain/src/orchestrator/preflight/requirements.js";
const c = "## E2E\n```bash\npsql \"$DB_URL\" -c \"SELECT 1\"\n```";
if (contractRequiresPostgres(c) !== true) { console.error("FAIL: psql 合同未识别为需要 PG"); process.exit(1); }
const req = deriveCapabilityRequirements({ role: "evaluator", requirements: {}, contract: c });
if (req.postgres !== true) { console.error("FAIL: 机械派生 postgres!=true", JSON.stringify(req)); process.exit(1); }
console.log("OK step1");'
```
**硬阈值**: `contractRequiresPostgres` 与派生结果均 postgres=true（exit 0）

---

### Step 2: PG 不可供给 → fail-closed BLOCKED
**来源**: `[FROM_PRD]` — PRD Golden Path 步骤2「PG 不可满足时 fail-closed：Dispatcher 不创建会自报 PASS 的 Evaluator，返回 control_status=BLOCKED」

**可观测行为**: 当 requirements.postgres=true 但 preflightGate 判定 PG 不可供给（status != ok）时，`dispatch()` 返回 `control_status='BLOCKED'` 且 `should_create_attempt=false`，未创建 attempt。

**验证命令**: 见 `contract-dod.md` B-03（node -e 以 stub preflightGate 返回 non-ok 驱动真实 dispatcher 分支）+ `dispatcher.test.js` 新增用例。

**硬阈值**: `control_status === 'BLOCKED'` 且 `should_create_attempt === false`

---

### Step 3: Evaluator 容器真跑 PG，留 stdout/stderr/exit
**来源**: `[FROM_PRD]` — PRD Golden Path 步骤3 +「真实验收必须由 evaluator 容器留下 PG 命令 stdout/stderr/exit code」+ Invariant [真环境验证]

**可观测行为**: 在 runtime_resources.postgres=true 的执行位，真实 psql 建/查隔离库成功，命令 stdout/stderr/exit code 被采集进 `.brain-result.json` 的 behavior_tests[] 与 log_tail。

**验证命令**:
```bash
: "${DB_URL:?Fleet must inject an attempt-scoped DB_URL}"
export DATABASE_URL="$DB_URL"
# 真实 psql 建隔离库 + 查询，留 exit code（evaluator 容器内执行；非 GitHub CI 引用）
psql "$DB_URL" -v ON_ERROR_STOP=1 -c "CREATE TEMP TABLE harness_pg_probe(id int); INSERT INTO harness_pg_probe VALUES (1); SELECT count(*) FROM harness_pg_probe;" || { echo "FAIL: psql 真跑失败 exit=$?"; exit 1; }
```
**硬阈值**: psql exit 0，count=1；集成测试真库跑通（见 B-04）

---

### Step 4: 合同必验项 unverifiable → 非 PASS
**来源**: `[FROM_PRD]` — PRD Golden Path 步骤4「合同必验项 unresolved/unverifiable 时 Evaluator 不得产 PASS」

**可观测行为**: 当合同要求 postgres 但执行位 runtime_resources.postgres!=true（或 behavior_tests 缺 PG 真跑证据）时，execution-contract 出口守卫把 verdict 归为非 PASS（FAIL/DONE_WITH_CONCERNS，failure_class 反映缺证）。

**验证命令**: 见 `contract-dod.md` B-05（node -e 调 execution-contract 守卫，postgres required + runtime 无 PG → verdict != PASS）。

**硬阈值**: `verdict !== 'PASS'`

---

### Step 5: Judge evidence_insufficient → 结构化缺证清单落库
**来源**: `[FROM_PRD]` — PRD Golden Path 步骤5前半 + Invariant [judge证据结构]

**可观测行为**: Judge 判 `evidence_insufficient` 时，verdict 落库含非空结构化 `missing_evidence: string[]`（供 recollect 消费）。

**验证命令**: 见 `contract-dod.md` B-06（真库：写 judge verdict → 读回 missing_evidence 非空）。

**硬阈值**: `missing_evidence` 为非空数组

---

### Step 6: recollect 注入 Judge 缺证清单 + 原始反馈到下一轮 Evaluator bundle
**来源**: `[FROM_PRD]` — PRD Golden Path 步骤5后半「下一轮 Evaluator TaskBundle 的 inputs 必须携带 Judge 的缺证清单 + 原始反馈，打破同构重跑」

**可观测行为**: derive 路由为 `judge_evidence_insufficient_recollect` 时，dispatcher 组装的 Evaluator TaskBundle `inputs.judge_feedback.missing_evidence`（非空）+ `raw_feedback`（非空）来源于上一轮 judge verdict，与上一轮 bundle 不同构。

**验证命令**: 见 `contract-dod.md` B-06（真库全链：judge 落库 → recollect bundle inputs.judge_feedback 非空）。

**硬阈值**: `inputs.judge_feedback.missing_evidence.length >= 1` 且 `raw_feedback` 非空

---

### Step 7: 同 SHA 补证一次仍不足 → 收敛 wait:human_review
**来源**: `[FROM_PRD]` — PRD Golden Path 步骤6 + NFR「无进展重跑硬上限=同 SHA recollect 1 次」

**可观测行为**: 同一 head_sha 已有一条 `judge_evidence_insufficient_recollect` 且再次 evidence_insufficient 时，derive 路由为 `wait:human_review`（reason=`evidence_insufficient_after_recollect`），不再重派 evaluator。

**验证命令**: 见 `contract-dod.md` B-07（node -e 回放 decisionLog，断言 action=wait:human_review）。

**硬阈值**: `action === 'wait:human_review'`，不再 `spawn:evaluator`

---

## 禁 mock 边清单

本单改动涉及调度（dispatcher bundle 组装）、状态机路由（derive）、跨模块数据传递（judge verdict → evaluator bundle）、DB 写路径（judge 缺证清单落库）—— 属「禁 mock 被改的边」硬规则触发场景。failing test / 集成测试禁 mock 以下边（generator vi.mock/stub 命中 = CONTRACT-IS-LAW FAIL，evaluator 机械 grep 核查）：

- `requirements.deriveCapabilityRequirements` ↔ 合同可执行验收文本（本单新增机械派生，测试必须传真实合同 psql 文本走真实派生函数，禁 stub `contractRequiresPostgres`）
- dispatcher(evaluator buildInputs) ↔ Evaluator TaskBundle.inputs（recollect 注入 judge_feedback，测试断言真实组装出的 bundle.inputs 携带缺证清单，禁 mock buildInputs）
- `harness-judge` ↔ DB judge verdict 落库表（缺证清单结构化落库，集成测试必须真 Postgres 验行落库，禁 mock pool/client）
- derive(状态机路由) ↔ decisionLog（同 SHA 二次 recollect 收敛，测试真回放 decisionLog 数组走真实 `derive`，禁 mock derive/替身 decisionLog schema）
- evaluator 执行位 ↔ PostgreSQL（PG 必验命令真跑，集成测试真 psql 建/查隔离库，禁 mock pg/Pool）

允许 mock 的**更外层无关依赖**：preflightGate（作为 dispatcher 的注入依赖，其 evaluate 结果是 dispatcher 的外部边界，可在单测里以 stub 提供 status:ok / non-ok 输入——但由此驱动的 dispatcher 分支与 runtime_resources 组装必须真实）、GitHub API、通知渠道、provider adapter。

---

## 八要素需求规范

| 要素 | 说明 | 本次答案 |
|------|------|----------|
| **FR（做什么）** | 功能需求 | 合同→PG capability 机械派生；PG fail-closed；judge 缺证反馈跨轮回灌；必验项 unverifiable 禁 PASS；同 SHA 一次无进展收敛人审；PG 真跑留证 |
| **NFR（做得多好）** | 非功能 | 无进展重跑硬上限=同 SHA recollect 1 次；evaluator timeout 沿用 5400s；PG 供给失败/unverifiable 必写 Brain log + `.brain-result.json` |
| **Invariant（永不违反）** | 不变量 | 见下「Invariant 映射」；核心：真环境验证才算 done（PG 必跑留 exit code）、禁写死环境（PG 库名写入侧/校验侧同一变量）、会话独享隔离库、租户隔离、先分证据缺陷、judge 证据结构完整 |
| **判定点（怎么知道）** | 对外部状态推断 | 见下方登记表 |
| **保质期（何时过期）** | 失效 | judge_feedback 仅对同 SHA 当前 recollect 轮有效；换 SHA 后重置 recollect 计数（既有 SHA 锚定语义） |
| **死亡告警（停了谁知道）** | 告警 | PG 供给失败 → dispatch BLOCKED 写 Brain log + onPreflightBlocked；unverifiable → verdict FAIL 进 decisionLog，Harness 主线可见 |
| **失败语义（挂了怎么办）** | 故障 | 见下方失败语义声明 |
| **效果确认（已发≠已生效）** | 回执 | PG 必验项回执 = psql 命令 stdout/stderr/exit code 进 behavior_tests[]；judge 反馈回灌回执 = 下轮 bundle inputs.judge_feedback 非空 |

### 判定点登记表（对模糊现实的判断假设）

| 判定点 | 候选方法 | 所选方法 | 依据 | 误判后果 |
|--------|----------|----------|------|----------|
| ⚠️ 合同是否需要 PostgreSQL | A. 扫描可执行验收文本正则 `psql`/`pg_*`；B. 只读 `contract_requirements.postgres` 结构字段 | A + B 并集（文本机械识别为主，结构字段兜底） | PRD 假设「可执行验收要求已可机械识别 PG 依赖」，不做领域猜测；纯读结构字段=退回人工手填的老路 | 漏判 → Evaluator 无 PG 却自报 PASS（本 sprint 要修的假绿面） |
| ⚠️ PG 是否真正可供给 | A. preflightGate.evaluate status=ok；B. node-admission `runtime_resources.postgres.available` | A（dispatch 预检）+ B（fleet 节点准入） | 既有 fail-closed 闸门语义 | 误判可供给 → 派出无 PG 的 Evaluator；误判不可供给 → 无谓 BLOCKED |
| 必验项是否已真验 | A. behavior_tests 含 PG 真跑证据（exit_code + psql log_tail）；B. runtime_resources.postgres==true | A + B | Invariant [真环境验证]：source-only / 仅 CI 引用不算 | 误判已验 → 假绿 PASS（面客错误） |

### 失败语义声明

| 场景 | 失败行为 | 重试幂等？ | 降级策略 |
|------|----------|-----------|----------|
| PG 供给失败（连接/建库失败） | dispatch 返回 control_status=BLOCKED，不创建 attempt | 是（同 SHA 幂等，未产 attempt） | fail-closed 到 wait:human_review，**禁止**降级为「跳过 PG 仍 PASS」 |
| 合同必验项 unverifiable | verdict != PASS（FAIL/concerns），进 decisionLog | 是 | 拦截，不放行 |
| Judge feedback 为空/结构缺失 | recollect 仍执行，bundle 标注 feedback 缺失，不静默丢弃 | 是 | 降级为「无定向缺证清单」但仍注入原始 verdict 文本 |
| 同 SHA 二次仍 evidence_insufficient | 收敛 wait:human_review | 是（收敛终态） | 停止重派，交人审 |

### 输入对抗面

N/A —— 本 sprint 为 Brain 内部 orchestrator 调度闭环，无对外暴露 agent / 外部可写入接口。

---

## Invariant 映射（PRD 铁律 → 覆盖条目）

- INV-1 [真环境验证] → B-04（PG 必验项 evaluator 容器真跑留 exit code）
- INV-2 [禁写死环境] → B-04 断言隔离库名写入侧=校验侧同一变量（集成测试单一 `databaseName` 变量贯穿建库/查库）
- INV-3 [多租户/会话独享] → B-04 隔离库名含 pid+uuid（会话独享，禁固定库名/固定 /tmp）
- INV-4 [租户隔离] → B-04 隔离库 attempt 独享、用完销毁，不跨 attempt 泄漏
- INV-5 [先分证据缺陷] → B-07（evidence_insufficient 走 evaluator 补证/收敛人审，**不**误派 generator-fix）
- INV-6 [judge证据结构] → B-05 / B-06（.brain-result 顶层 exit_code+log_tail+behavior_tests[]，每条含 exit_code+log_tail；missing_evidence 结构化）

---

## E2E 验收（final-e2e 跑 — target_environment=local_api）

> evaluator 模式B 在 local_api 执行位按序拼接执行本段全部 bash 块（本合同只用单块）。
> DB_URL 由 Fleet 注入（runtime_resources.postgres=true 供给的隔离 PG）；脚本把 DB_URL 解析为 DB_* 供仓库 pg 集成测试（读 DB_DEFAULTS）使用。

```bash
#!/bin/bash
set -euo pipefail
: "${DB_URL:?Fleet must inject an attempt-scoped DB_URL (runtime_resources.postgres=true)}"
export DATABASE_URL="$DB_URL"
# DB_URL → DB_* 解析（仓库 pg 集成测试经 db-config.js DB_DEFAULTS 读这些 env；写入侧/校验侧同一解析，遵守 INV 禁写死环境）
export DB_HOST="$(node -e 'const u=new URL(process.env.DB_URL);console.log(u.hostname)')"
export DB_PORT="$(node -e 'const u=new URL(process.env.DB_URL);console.log(u.port||5432)')"
export DB_USER="$(node -e 'const u=new URL(process.env.DB_URL);console.log(decodeURIComponent(u.username||"cecelia"))')"
export DB_PASSWORD="$(node -e 'const u=new URL(process.env.DB_URL);console.log(decodeURIComponent(u.password||""))')"
export NODE_ENV=test
VITEST=/workspace/node_modules/vitest/vitest.mjs

# 0. 真实 PG 探针：evaluator 容器内真跑 psql，留 stdout/exit（非 GitHub CI 引用）
psql "$DB_URL" -v ON_ERROR_STOP=1 -c "SELECT 1 AS harness_pg_probe;" || { echo "FAIL: PG 探针失败 exit=$?"; exit 1; }

cd /workspace/packages/brain

# 1. Step1/2/4/7 单元回归（真实 orchestrator 函数，禁 mock 被改的边）
node "$VITEST" run \
  src/orchestrator/__tests__/dispatcher-pg-capability.test.js \
  src/orchestrator/__tests__/derive-recollect-convergence.test.js \
  src/orchestrator/preflight/requirements-contract-pg.test.js \
  src/orchestrator/execution-contract-unverifiable.test.js \
  --reporter=verbose || { echo "FAIL: 单元回归红"; exit 1; }

# 2. Step3/5/6 真库集成（真 PostgreSQL 建隔离库、真 judge 落库、真 recollect bundle 组装）
node "$VITEST" run --config vitest.integration.config.js \
  src/__tests__/integration/harness-evaluator-pg-recollect.pg.integration.test.js \
  --reporter=verbose || { echo "FAIL: PG 集成测试红"; exit 1; }

echo "✅ Golden Path 全链验证通过（PG 真跑 + 单元回归 + 真库集成）"
```

---

## 探索提示（L3 探索层 — evaluator 剧本全过后执行）

探索预算: 10 分钟 / 15 动作
高风险面:
- 错输入: 合同可执行验收文本含 `psql` 但在注释行/字符串字面里 → `contractRequiresPostgres` 是否误判（应按可执行命令识别，注释豁免逻辑边界）
- 重复提交: 同一 head_sha 连续多次 evidence_insufficient → 收敛计数是否严格「1 次 recollect」后即人审（不因并发多写 decisionLog 而放宽到 2+ 次）
- 中途中断: PG 供给成功但 psql 中途连接断开 → verdict 是否 fail-closed（不得因部分证据而 PASS）
- 边界值: judge missing_evidence 为空数组 vs null → recollect bundle 注入行为（空数组=有结构无内容 vs null=结构缺失，两者都不得静默丢弃 raw_feedback）
- 租户串扰: 并发两个 sprint 的 PG 隔离库同 pid 不同 uuid → 是否互不可见
发现分级: P0/P1（无 PG 却 PASS / judge 反馈丢失致同构重跑 / 跨 attempt PG 数据泄漏）→ 阻塞 merge；P2/P3 → 记 findings 不阻塞

---

## Test Contract

| 功能 | Test File | BEHAVIOR 覆盖 | 预期红证据 |
|---|---|---|---|
| 合同→PG 机械派生 | `src/orchestrator/preflight/requirements-contract-pg.test.js` | `合同含 psql 命令派生 postgres 为 true` / `无 PG 要求合同派生 postgres 为 false` | → import/断言 fail |
| dispatcher PG capability + fail-closed | `src/orchestrator/__tests__/dispatcher-pg-capability.test.js` | `PG 不可供给返回 control_status BLOCKED` / `recollect 轮 bundle inputs 携带 judge_feedback` | → 分支未实现 fail |
| derive recollect 收敛 | `src/orchestrator/__tests__/derive-recollect-convergence.test.js` | `同 SHA 已 recollect 一次再判不足收敛 wait human_review` | → 回归锁定 |
| execution-contract 出口守卫 | `src/orchestrator/execution-contract-unverifiable.test.js` | `必验项 unverifiable 时 verdict 不为 PASS` | → 守卫未实现 fail |
| judge 缺证落库 + PG 真跑 + recollect 全链 | `src/__tests__/integration/harness-evaluator-pg-recollect.pg.integration.test.js` | `judge evidence_insufficient 落库 missing_evidence 非空` / `PG 真跑留 exit code` | → 真库红 |

> 「BEHAVIOR 覆盖」列每个覆盖名均为对应 `it()` 测试名的字面子串（下游按字符串匹配回映 DoD）。
