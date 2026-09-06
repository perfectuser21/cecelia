# Sprint Contract Draft (Round 1) — check-handoffs.mjs 契约 schema 化（CHECKS→CONTRACTS 九格+八格）

## 锚定父路声明

独立小路（无父路）——本 line（journey e6f803f2 智能获客/kernel harness 契约域）done/working 过滤后累积 FR 为空，本 sprint 是新建的机械校验器 SSOT，无已验收父路可锚。

## Unified Map 影响半径

`[MAP_NOT_CONFIGURED]` — task.payload.map_scope=["F1"] 但 map_repo=null，radius 未配置，禁止回退领域硬编码；本合同影响面以「预期受影响文件」+ 禁 mock 边清单为准。

## Response Schema（推导来源: N/A — 无 HTTP 响应，纯 Node 模块/CLI）

本 sprint 交付 `check-handoffs.mjs`，是纯 Node 机械校验器（ESM 模块 + CLI），**不新增任何 HTTP 端点**。Reviewer 第 6 维「HTTP schema oracle」项按 PRD 规则自动满分（N/A — 任务无 HTTP 响应）。

其「结构化机械判定结果」是模块函数返回值 / CLI stdout JSON，schema 固定如下（这是本合同的验收 oracle 对象，不是 HTTP 契约）：

```json
// runCellContracts(cellId, handoff, ctx) 返回：
{
  "cell": "<格标识>",
  "ok": true,
  "results": [
    { "id": "<断言id>", "phase": "precondition|postcondition|side_effects",
      "category": "<六类之一>", "status": "PASS|FAIL|UNDECIDABLE", "reason": "<失败/不可判定原因，PASS 时可为空串>" }
  ]
}
```
- `ok` (boolean, 必填): 当且仅当 `results` 中**每条** `status === "PASS"` 时为 `true`；存在任一 `FAIL` 或 `UNDECIDABLE` → `false`（UNDECIDABLE 绝不等价 PASS，见边界情况）。
- `status` 三值封闭枚举: `PASS` / `FAIL` / `UNDECIDABLE`。禁用别名（`ok`/`pass`/`skip`/`n/a`）。
- 未知格标识: `runCellContracts` **抛错** `Error("unknown_cell:<id>")`；CLI 捕获后打印 `{"error":"unknown_cell:<id>"}` 并 `exit 2`。**不得**返回 `ok:true`（禁止静默 PASS）。

**CLI 契约**: `node packages/brain/src/orchestrator/check-handoffs.mjs <cellId> <handoffJsonPath> [contextJsonPath]`
- 全 PASS → stdout 先打印结果 JSON（含各断言 status），再打印一行 `SUMMARY cell=<格> ok=true`，`exit 0`
- 任一 FAIL / UNDECIDABLE → stdout 打印结果 JSON（含 `FAIL`/`UNDECIDABLE` 字面 status 与 reason），再打印 `SUMMARY cell=<格> ok=false`，`exit 1`
- 未知格标识 → stdout 打印 `{"error":"unknown_cell:<id>"}`，`exit 2`（禁止 `ok:true`/静默）
- `node ... --cells` 子命令 → stdout 打印一行 `CELLS coding=9 leadgen=8 total=17`，`exit 0`（供覆盖自检）
- CLI 的 record_persisted/externally_visible resolver **只从 `contextJsonPath` 读取权威值**（如 `db_default_count`/`external_default`），**绝不从 handoff 对象自报字段（如 `db_count`/`persisted`）取值**——无 context → 这两类断言 `UNDECIDABLE`（INV-1：不信工人抄写值）。

### CONTRACTS 格→类目映射（Proposer 锁定的代表性断言，generator 据此填 17 格；六类每类至少一格覆盖）

| 格 | 段 | 类目 | 断言要点 |
|---|---|---|---|
| generate | postcondition | artifact_compliance | 复用真实 `validateHandoffObject('candidate_coordinates', handoff.candidate)`，缺 source_attempt_id 等 → FAIL 点名字段 |
| generate | postcondition | record_persisted | 候选 attempt 是否真落库（走 `ctx.resolvers.dbCount` 带 within_seconds 时间窗；无 resolver→UNDECIDABLE） |
| generate | side_effects | negative_boundary | 内置 tampered=非法 candidate，shape 层必须拒（漏网即 FAIL） |
| evaluate | postcondition | state_transition | `[prev_status,next_status]` 命中允许迁移集（in_progress→completed）→ PASS，非法→FAIL |
| evaluate | postcondition | numeric_threshold | `score >= min` → PASS（纯判定，无 resolver 依赖，合规 fixture 可全 PASS→exit 0） |
| publish | postcondition | externally_visible | published_pr 的 PR URL 外部真可见（走 `ctx.resolvers.probe`；无 resolver→UNDECIDABLE） |

> 其余各格（plan/contract/seal/judge/merge/cleanup + leadgen 八格）由 generator 按同构模式填三段断言，每格 union 非空、category ∈ 六类、id 唯一（冻结测试逐格结构校验）。leadgen 八格语义待确认（见 notes），机械只锁结构。

---

## Golden Path

[Commander 到达某格收口] → [调用 check-handoffs.mjs 传入 格标识 + 该格交接对象/坐标(+可选权威上下文)] → [按该格 CONTRACTS 执行 precondition/postcondition/side_effects 三段、六类可参数化断言] → [输出逐格逐断言 PASS/FAIL/UNDECIDABLE 结构化判定 + 退出码] → [Commander 据机械结果放行或打回，机械项不再进 LLM 语义审查]

### Step 1: 落盘 SSOT——CHECKS 扩为 CONTRACTS，覆盖 coding 九格 + leadgen 八格
**来源**: `[FROM_PRD]` — PRD「范围限定·在范围内」第 1 条 + 「预期受影响文件」check-handoffs.mjs 位置词铁律

**可观测行为**: `packages/brain/src/orchestrator/check-handoffs.mjs` 导出 `CODING_CELLS`（=home-sequencer `STAGE_ORDER` 去掉 `__run_init`/`__run_finalize` 的九格：plan/contract/seal/generate/evaluate/judge/publish/merge/cleanup）、`LEADGEN_CELLS`（8 格，本 sprint SSOT 新建）、`ASSERTION_CATEGORIES`（六类冻结）、`CONTRACTS`（17 格全覆盖，每格三段）。

**验证命令**:
```bash
node --input-type=module -e "import('./packages/brain/src/orchestrator/check-handoffs.mjs').then(m=>{const all=[...m.CODING_CELLS,...m.LEADGEN_CELLS];if(m.CODING_CELLS.length!==9||m.LEADGEN_CELLS.length!==8||Object.keys(m.CONTRACTS).length!==17)process.exit(1);console.log('OK 17 cells')})"
```
**硬阈值**: coding=9、leadgen=8、CONTRACTS keys=17，缺任一格 → exit 1

---

### Step 2: 六类断言可参数化、可执行、确定性判定
**来源**: `[FROM_PRD]` — PRD Golden Path 具体第 2 步「六类可参数化判据：产出物合规、记录落库、外部可见、状态迁移、数值达标、负向越界」

**可观测行为**: `evaluateAssertion(assertion, handoff, ctx)` 对六类中每一类返回确定性 `{status,reason}`：
- `artifact_compliance`：**复用真实 handoff-schemas 的 `validateHandoffObject`** 判交接对象 shape（禁止另写一套形状校验，见禁 mock 边清单）。
- `record_persisted`：需 `ctx.resolvers.dbCount({table,where,within_seconds})`（服务端权威计数，带时间窗）；resolver 缺席 → `UNDECIDABLE`（不可判定，非 PASS）。
- `externally_visible`：需 `ctx.resolvers.probe({probe_kind,target})`；resolver 缺席 → `UNDECIDABLE`。
- `state_transition`：`[handoff[from_field], handoff[to_field]]` 命中 `allowed` 迁移集 → PASS，否则 FAIL。
- `numeric_threshold`：`handoff[field]` 为 number 且落在 `[min,max]` → PASS。
- `negative_boundary`：对 `assertion.tampered`（本应非法的输入）跑 shape 校验，**被拒**→ PASS（越界真被拦）；**漏网**（校验通过）→ FAIL（视为漏洞）。

**验证命令**:
```bash
node --input-type=module -e "import('./packages/brain/src/orchestrator/check-handoffs.mjs').then(async m=>{const r=await m.evaluateAssertion({id:'x',category:'record_persisted',table:'t',where:'w',min_count:1,within_seconds:300},{},{});if(r.status!=='UNDECIDABLE')process.exit(1);console.log('OK undecidable-not-pass')})"
```
**硬阈值**: 无 resolver 的 record_persisted/externally_visible 恒返回 `UNDECIDABLE` ≠ `PASS`

---

### Step 3: 未知格 / 缺资源 / 越界 三种边界确定性拦截，绝不静默 PASS
**来源**: `[FROM_PRD]` — PRD「边界情况」全 5 条

**可观测行为**:
- 未知格标识 → `runCellContracts` 抛 `unknown_cell:<id>`，CLI `exit 2`，绝不 `ok:true`。
- 断言依赖的 DB/产出物不可达（resolver 缺席）→ `UNDECIDABLE`，`ok=false`。
- 负向越界断言真拦（漏网即 FAIL）。
- coding 与 leadgen 断言集互不串用（CONTRACTS 按格独立键，无共享引用导致的串格）。

**验证命令**:
```bash
node --input-type=module -e "import('./packages/brain/src/orchestrator/check-handoffs.mjs').then(async m=>{try{await m.runCellContracts('bogus',{},{});console.error('FAIL: 未知格未抛错');process.exit(1)}catch(e){if(!/unknown_cell/.test(e.message))process.exit(1);console.log('OK unknown_cell throws')}})"
```
**硬阈值**: 未知格必抛 `unknown_cell`，exit 非 0

---

## 已知约束（来自回归测试 / 累积 FR / 铁律）

- [回归测试] `tests/gp/f1/step3-evaluator-authority-injection.test.js` 实证：check-handoffs 只查缺漏与格式，防不住编造值——本 sprint 的 record_persisted/externally_visible 类断言必须走服务端权威 resolver，不信 handoff 抄写值。
- [累积FR] context-manifest：journey e6f803f2 done/working 过滤后累积 FR 为空（PRD 已声明），无历史行为需保持。
- [shape 层] 复用 `handoff-schemas.js` 的 `HANDOFF_SCHEMAS`/`validateHandoffObject`（第 79 批五类交接对象契约），artifact_compliance/negative_boundary 一律走它，不重写形状校验。

### 历史约束三源——铁律逐条映射（INV）
- INV-1 [机械判定] 机械判定不建立在 LLM 自愿配合上，断言值以服务端权威产物为准 → 由 record_persisted/externally_visible 走 `ctx.resolvers.*`（权威源）+ negative_boundary 真拦 handoff 抄写值覆盖；DoD 有对应 [BEHAVIOR]。
- INV-2 [DIRTY路由] PR 与 main 冲突路由 generator-fix → **N/A**：本 sprint 不触及 dispatcher/PR 冲突路由逻辑。
- INV-3 [证据窗口] judge 证据窗口前 8×600 → **N/A**：本 sprint 不产 .brain-result 证据、不改 judge 消费。
- INV-4 [脚本隔离] evaluator/校验临时脚本落会话独享路径 → E2E 脚本用 `mktemp -d` 会话独享目录，不用 /tmp 固定文件名；DoD/E2E 已遵守。

---

## 八要素需求规范

| 要素 | 说明 | 本次答案（必填，可 N/A） |
|------|------|--------------------------|
| **FR（做什么）** | | check-handoffs.mjs 把 CHECKS 扩为 CONTRACTS（coding 九格+leadgen 八格），每格 precondition/postcondition/side_effects 三段、六类可参数化断言，输出确定性 PASS/FAIL/UNDECIDABLE。 |
| **NFR（做得多好）** | | 机械校验快速返回（纯 Node，无网络时纯内存判定 <100ms；带 resolver 时受 resolver 时延约束）；PrepPRD 未给硬上限。 |
| **Invariant（永不违反）** | | 机械判定不信 handoff 抄写值（INV-1）；未知格/不可达资源绝不静默 PASS（边界铁律）。 |
| **判定点（怎么知道）** | | 见下方登记表 |
| **保质期（何时过期）** | | CONTRACTS 是 SSOT 定义，随格序演进（home-sequencer STAGE_ORDER 变则 coding 侧自动跟随，因 CODING_CELLS 派生自它）；leadgen 侧 SSOT 需随真实 leadgen 格序确认后更新。 |
| **死亡告警（停了谁知道）** | | 本模块是被 Commander 同步调用的纯函数；调用失败即 Commander 收到 exit≠0/抛错，无独立后台进程，无需独立告警。 |
| **失败语义（挂了怎么办）** | | 见下方失败语义声明（fail-closed：不可判定拦截，不放行）。 |
| **效果确认（已发≠已生效）** | | 校验结果由调用方（Commander）同步消费退出码/返回对象即时确认，无异步生效延迟。 |

### 判定点登记表（对模糊现实的判断假设）

| 判定点 | 候选方法 | 所选方法 | 依据 | 误判后果 |
|--------|----------|----------|------|----------|
| （示例：微信群是否发送成功） | A. 监听按钮变灰; B. 读聊天记录 API | A | API 不稳定 | 静默丢消息 |
| ⚠️ record_persisted 断言依赖的 DB 记录是否真落库 | A. 信 handoff 抄写的 count; B. 走 ctx.resolvers.dbCount 真查带时间窗 | B（真查，带 within_seconds 时间窗） | INV-1：不信工人抄写值，防历史数据/编造值冒充 | 误判 PASS = 未落库当已落库，Commander 放行假产物 |
| ⚠️ externally_visible 目标是否外部真可见 | A. 信 handoff 声明; B. 走 ctx.resolvers.probe 真探 | B（真探） | INV-1 | 误判 PASS = 外部不可见当可见，面客错误 |
| resolver 不可达时判什么 | A. 当 PASS 放行; B. 当 FAIL 打回; C. UNDECIDABLE | C（UNDECIDABLE，ok=false，不放行） | 边界情况：不可达=不可判定，绝不静默 PASS，但也不误报 FAIL 污染归因 | 若选 A=假绿；若选 B=误伤归因 |

> ⚠️ 行属「升拍板点」级别：两条 ⚠️ 判定点已在本合同锁定为「走权威 resolver」，PrepPRD 未逐条拍板，标注待确认见 notes。

### 失败语义声明

| 场景 | 失败行为 | 重试幂等？ | 降级策略 |
|------|----------|-----------|----------|
| 未知格标识 | 抛 `unknown_cell`，CLI exit 2 | 是（纯函数，同输入同输出） | 无降级——上游传对格标识 |
| resolver 不可达（DB/产出物） | 对应断言 UNDECIDABLE，ok=false，CLI exit 1 | 是 | fail-closed：不放行，Commander 择机重跑或升人 |
| 交接对象缺字段/格式非法 | 对应 artifact_compliance FAIL 点名字段 | 是 | 无降级——打回 generator-fix 补字段 |

### 输入对抗面（对外暴露 agent / 工人可写入接口）

| 输入来源 | 信任等级 | Prompt Injection 防护 | 越权指令拒绝策略 |
|----------|----------|----------------------|-----------------|
| worker 递交的 handoff 交接对象（坐标/断言值） | 不可信（工人可编造格式合法的假值，r40/r53 实证） | 断言值不信 handoff 自报，record_persisted/externally_visible 一律走服务端权威 resolver 复核；shape 层复用 zod 严格校验拒多余/畸形字段 | 未知格标识抛错拒绝；负向越界输入必须真被 shape 层拦；不可达资源判 UNDECIDABLE 不放行 |

---

## GP-Anchor

gp-anchor: skipped (product-map.json not found)

---

## 禁 mock 边清单

本单属「跨模块数据传递」（Commander→校验器传格标识+交接对象）+ 新建校验器复用既有 shape 层，以下边**禁 mock**，冻结测试必须 import 真实模块：

- check-handoffs.mjs ↔ `home-sequencer.js` `STAGE_ORDER`：本单 `CODING_CELLS` 必须**派生自真实 STAGE_ORDER**（去 `__` 前缀），禁止 hardcode 一份九格清单顶替。冻结测试 import 真实 `STAGE_ORDER` 逐一比对（若 hardcode 与真实格序漂移，测试当场红）。
- check-handoffs.mjs ↔ `handoff-schemas.js` `validateHandoffObject`/`HANDOFF_SCHEMAS`：artifact_compliance 与 negative_boundary 类断言必须**真调**该 shape 校验器，禁止另写一套宽松形状校验绕过。冻结测试用真实 candidate_coordinates（缺 source_attempt_id）验 FAIL 点名字段。

> `ctx.resolvers.dbCount/probe`（DB/外部产出物）属**更外层无关依赖**，冻结测试允许注入 fn 桩验证 dispatch/阈值逻辑；真实 DB 时间窗查询在 E2E 用真 psql 覆盖（见未覆盖真实链路清单）。这不违反禁 mock 边——被改的边是「校验器↔格序/shape 层」，不是「校验器↔DB」。

---

## 未覆盖真实链路清单

- **record_persisted 生产接线**：本 sprint 交付断言引擎 + `ctx.resolvers.dbCount` 接口 + UNDECIDABLE 兜底；把 resolver 接到真实 pg（Commander 验收时注入真库连接）是 `commander-contract.js` 接入点的后续接线（Crystal 后续件/接入 sprint）。E2E 已用真 psql（$DB_URL）+ 时间窗证明引擎在真值上判定正确；生产调用方注入 resolver 的接线补位计划：接入 sprint / 何时=CONTRACTS SSOT 合入后 / 环境=local_api Brain 侧。
- **externally_visible 生产接线**：同上，接口 + UNDECIDABLE 兜底已交付，生产 probe（如 gh PR URL 真探）接线为后续件。E2E 用真文件产物证明引擎判定正确。
- **leadgen 八格语义**：leadgen 线现驻 OpenClaw（DEFINITION.md「leadgen 留 OpenClaw 不动」），repo 无权威 leadgen 格序。本 sprint 按 PRD 授权把 leadgen 8 格作为 SSOT **新建**于 check-handoffs.mjs（`[NEW_PATTERN]`），机械验收只锁「恰 8 格 + 与 coding 无交集 + 三段结构完备」，不锁具体业务语义；真实 leadgen 格序待主理人确认（见 notes judgment-pending-user）。

---

## E2E 验收（final-e2e 跑 — target_environment=local_api）

**journey_type**: autonomous
**target_environment**: local_api

> 本 sprint 核心是纯 Node 机械校验器，无 UI/无远端机器。E2E 以 `node` 为主：pure 类断言纯内存判定；record_persisted 用真 psql（$DB_URL）+ 时间窗、externally_visible 用真文件产物，证明六类断言在**真实权威值**上确定性判定。所有临时脚本落 `mktemp -d` 会话独享目录（INV-4）。

```bash
#!/bin/bash
set -euo pipefail
: "${DB_URL:?Fleet must inject an attempt-scoped DB_URL}"
CHK_REL="packages/brain/src/orchestrator/check-handoffs.mjs"
CHK_ABS="$(pwd)/$CHK_REL"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

# 0. 机检实现落位（位置词铁律：必须落在 check-handoffs.mjs）——验内容（含 CONTRACTS 导出），非仅存在性
grep -q 'export const CONTRACTS' "$CHK_REL" || { echo "FAIL: 实现未落在 check-handoffs.mjs 或缺 CONTRACTS 导出"; exit 1; }

# 1. 空库 bootstrap 探针表 + 落一条真实记录（记录落库类断言的服务端权威源，带 created_at 供时间窗）
# gate-allow: domain/db-no-time-window to_regclass 是 schema 存在性检查（非计数聚合），无时间窗语义，时间窗断言在下方 harness.mjs 的 count(*) 查询里
psql "$DB_URL" -v ON_ERROR_STOP=1 -c "CREATE TABLE IF NOT EXISTS handoff_probe (id serial primary key, run_id text, created_at timestamptz default now())"
psql "$DB_URL" -tAc "SELECT to_regclass('public.handoff_probe') IS NOT NULL" | grep -qx t || { echo "FAIL: 探针表未建"; exit 1; }
RID="e2e-$$-${RANDOM}"
psql "$DB_URL" -v ON_ERROR_STOP=1 -c "INSERT INTO handoff_probe(run_id) VALUES ('$RID')"

# 2. 外部可见类断言的真实产物文件
EXT="$WORK/pr-artifact.json"
printf '%s' '{"pr":1}' > "$EXT"

# 3. Part A: 六类断言在真实权威值上全 PASS（PRD E2E 点 1）——真 psql 时间窗 + 真文件探针
cat > "$WORK/harness.mjs" <<'MJS'
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
const m = await import(process.env.CHK_ABS);
const dbCount = async ({ within_seconds }) => {
  const q = "SELECT count(*) FROM handoff_probe WHERE run_id='" + process.env.RID + "' AND created_at > NOW() - (" + Number(within_seconds) + " * interval '1 second')";
  return Number(execFileSync('psql', [process.env.DB_URL, '-tAc', q]).toString().trim());
};
const probe = async () => { readFileSync(process.env.EXT); return true; };
const ctx = { resolvers: { dbCount, probe } };
const cand = { repo: 'perfectuser21/cecelia', branch: 'cp-x', head_sha: 'a'.repeat(40), bridge_run_id: '11111111-1111-4111-8111-111111111111', source_attempt_id: '22222222-2222-4222-8222-222222222222' };
const cases = [
  [{ id: 'a', category: 'artifact_compliance', handoff_kind: 'candidate_coordinates', field: 'candidate' }, { candidate: cand }],
  [{ id: 'r', category: 'record_persisted', table: 'handoff_probe', where: 'run_id', min_count: 1, within_seconds: 300 }, {}],
  [{ id: 'e', category: 'externally_visible', probe_kind: 'file', target: process.env.EXT }, {}],
  [{ id: 's', category: 'state_transition', from_field: 'p', to_field: 'n', allowed: [['in_progress', 'completed']] }, { p: 'in_progress', n: 'completed' }],
  [{ id: 'm', category: 'numeric_threshold', field: 'score', min: 7 }, { score: 9 }],
  [{ id: 'b', category: 'negative_boundary', handoff_kind: 'candidate_coordinates', tampered: { repo: 'x' } }, {}],
];
const results = [];
for (const [desc, h] of cases) results.push(await m.evaluateAssertion(desc, h, ctx));
console.log(JSON.stringify(results));
const covered = new Set(cases.map((c) => c[0].category));
const allSix = [...m.ASSERTION_CATEGORIES].every((c) => covered.has(c)) && [...covered].length === 6;
const allPass = results.every((r) => r.status === 'PASS');
if (!allSix) { console.error('FAIL: 未覆盖六类'); process.exit(1); }
if (!allPass) { console.error('FAIL: 六类断言未全 PASS'); process.exit(1); }
console.log('OK: 六类断言全 PASS（真实权威值）');
MJS
CHK_ABS="$CHK_ABS" RID="$RID" EXT="$EXT" DB_URL="$DB_URL" node "$WORK/harness.mjs" || { echo "FAIL: Part A"; exit 1; }

# 4. Part B: 负向越界/缺字段交接对象经 CLI → 对应断言 FAIL，exit 非 0（PRD E2E 点 2）
printf '%s' '{"candidate":{"repo":"perfectuser21/cecelia","branch":"cp-x"}}' > "$WORK/bad.json"
set +e
OUT_B="$(node "$CHK_ABS" generate "$WORK/bad.json")"; CODE_B=$?
set -e
echo "$OUT_B"
[ "$CODE_B" -ne 0 ] || { echo "FAIL: 缺字段交接对象未被拦（exit 0）"; exit 1; }
echo "$OUT_B" | node --input-type=module -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const j=JSON.parse(s);if(j.ok!==false||!j.results.some(r=>r.status==='FAIL'))process.exit(1);console.log('OK: 负向越界真被拦')})" || { echo "FAIL: 未产出 FAIL 判定"; exit 1; }

# 5. Part C: 覆盖 17 格 + 未知格显式报错不静默 PASS（PRD E2E 点 3）
set +e
OUT_C="$(node "$CHK_ABS" bogus_cell "$WORK/bad.json")"; CODE_C=$?
set -e
echo "$OUT_C"
[ "$CODE_C" -eq 2 ] || { echo "FAIL: 未知格未按 exit 2 报错（实得 $CODE_C）"; exit 1; }
echo "$OUT_C" | grep -q 'unknown_cell' || { echo "FAIL: 未知格未显式报 unknown_cell"; exit 1; }
node --input-type=module -e "import(process.env.CHK_ABS).then(m=>{const all=[...m.CODING_CELLS,...m.LEADGEN_CELLS];const cov=all.every(c=>m.CONTRACTS[c]);if(m.CODING_CELLS.length!==9||m.LEADGEN_CELLS.length!==8||!cov)process.exit(1);console.log('OK: 覆盖 coding 九格 + leadgen 八格')})" CHK_ABS="$CHK_ABS" || { echo "FAIL: 覆盖不全"; exit 1; }

echo "✅ Golden Path 验证通过（六类全 PASS + 负向真拦 + 未知格显式报错 + 17 格全覆盖）"
```

---

## 探索提示（L3 探索层 — evaluator 剧本全过后执行）

探索预算: 10 分钟 / 15 动作（默认）
高风险面:
- 错输入: `evaluateAssertion` 传未知 category（如 `category:"foobar"`）→ 应显式抛错/FAIL，不得静默 PASS；`numeric_threshold` 的 `field` 值为字符串/NaN/null → 应 FAIL 非 PASS。
- 重复提交: 同一格标识同一 handoff 连跑两次 → 结果确定性一致（纯函数幂等），无副作用残留。
- 中途中断: `ctx.resolvers.dbCount` 抛异常（DB 连接中断）→ 应判 UNDECIDABLE（不可判定），不得当 PASS 也不得未捕获崩溃整个校验。
- 边界值: `record_persisted` 的 `within_seconds=0`、`min_count=0`；`state_transition` 的 `allowed=[]`（空迁移集）→ 任何迁移都应 FAIL。
发现分级: P0/P1（未知 category 静默 PASS / resolver 异常当 PASS / 越界漏网）→ 阻塞 merge；P2/P3 → 记 findings 不阻塞

## Test Contract

| 功能 | Test File | BEHAVIOR 覆盖 | 预期红证据 |
|---|---|---|---|
| 整个 Sprint（CONTRACTS schema 化 + 六类断言引擎 + 边界拦截） | `sprints/09052200-kernel-b6faa20c/tests/check-handoffs-contracts.test.js` | 恰为 home-sequencer STAGE_ORDER 去掉 init/finalize 的九格 / 恰 8 格且与 CODING_CELLS 无交集 / 恰为六类且冻结不可变 / 覆盖全部 17 格且每格含 precondition/postcondition/side_effects 三段 / 合规交接对象判 PASS / 缺 source_attempt_id 判 FAIL 并点名字段 / 合法迁移判 PASS 非法迁移判 FAIL / 达标判 PASS 未达标判 FAIL / 越界输入被真拦判 PASS 漏网判 FAIL / 无 db resolver 判 UNDECIDABLE 不判 PASS / resolver 计数达标判 PASS 不足判 FAIL / 无 probe resolver 判 UNDECIDABLE 不判 PASS / 未知格标识抛错 / 存在 FAIL 或 UNDECIDABLE 时 ok=false | import check-handoffs.mjs 失败（文件不存在）→ 13 tests 全红（已实证：Failed to load url check-handoffs.mjs） |

## notes

- `judgment-pending-user: leadgen 八格真实格序`——leadgen 线现驻 OpenClaw（DEFINITION.md），repo 无权威格序。本合同按 PRD 授权把 leadgen 8 格作为 SSOT 新建，机械验收只锁「恰 8 格 + 与 coding 无交集 + 三段结构」，不锁具体格名语义；建议命名 `source/enrich/score/qualify/route/outreach/nurture/handoff`（`[NEW_PATTERN]`，funnel 惯例），真实格序待主理人/leadgen owner 确认后按 SSOT 更新（仅改 8 个格名，引擎与结构不变）。
- `judgment-pending-user: record_persisted/externally_visible 生产 resolver 接线时机`——本 sprint 交付引擎+接口+UNDECIDABLE 兜底，真实 pg/gh 接线为后续接入件（见未覆盖真实链路清单）。
- `contract-gate: applies (cecelia repo, contract-gate.js present)`
- 授权依据: 决策 28ca1f69（PRD 假设声明）。
