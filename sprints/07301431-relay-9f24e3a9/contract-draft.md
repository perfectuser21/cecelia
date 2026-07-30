# Sprint Contract Draft (Round 1)

Sprint: T10 统一收件箱完整性缺口修复（learnings → capture_atoms 路由补齐）
journey_type: autonomous
target_environment: local_api

## Response Schema

N/A — 任务无 HTTP 响应（纯内部函数调用/DB 写入路径修复，未新增/未变更任何 API 端点）。

## 已知约束（来自回归测试 + 累积 FR）

- [累积FR] context-manifest: unavailable（task.payload 无 journey_id，PRD 已注明"PrepPRD 未锚定，task payload 为紧急 issue 直派"）
- [packages/brain/src/__tests__/capture-inbox.test.js] → `pushCaptureAtom` 先写 `captures`（信封）再写 `capture_atoms`（两次 query）；内容超长截断；`targetType` 缺失时 resolve(null) 不抛异常
- [packages/brain/src/__tests__/learning-capture-push.test.js] → `recordLearning`（已接入路径）新 learning 落库成功后推送 atom，`targetSubtype=category`，`routedToTable='learnings'`，`routedToId=<新插入行 id>`；去重命中（已有同 hash）时不推送
- [packages/brain/src/__tests__/learnings-received.test.js] → `routes/tasks.js` learnings-received 端点（已接入路径）`next_steps_suggested` 插入 learnings 成功后调用 `pushCaptureAtom`；`pushCaptureAtom` 抛错不影响该端点的成功响应
- [packages/brain/src/__tests__/handoff.test.js] → 同一收件箱入口 `pushCaptureAtom` 在其他调用方（`handoff.js`）中的调用约定：`targetSubtype` 取值语义化（如 `PASS+NEXT`/`PASS`），无效场景不调用
- [packages/brain/src/__tests__/cortex-feedback-loop.test.js] → `cortex.js::recordLearnings` 写入 `learnings` 表（而非 `cecelia_events`）；INSERT 携带 `category='cortex_insight'`；相同 `content_hash` 去重跳过 INSERT（本次修复复用同一份 mock 编排，新增 `pushCaptureAtom` 断言）
- [packages/brain/src/capture-inbox.js] → `pushCaptureAtom(pool, { content, targetType, targetSubtype, _routedToTable, _routedToId })` 自身永不向调用方抛出异常（内部整体 try/catch，失败时 `console.warn` 并 resolve(null)）；`routedToTable`/`routedToId` 目前只作为调用参数留痕（形参名带下划线前缀 `_routedToTable`/`_routedToId`），并未持久化到 `capture_atoms.routed_to_table`/`routed_to_id` 列——本次沿用既有调用惯例传参，不改 `capture-inbox.js` 内部实现（超出范围限定）

## 八要素需求规范

| 要素 | 说明 | 本次答案 |
|------|------|----------|
| **FR（做什么）** | 功能需求：系统对外承诺做什么 | `packages/brain/src/` 下 11 处 `INSERT INTO learnings` 调用点（`cortex.js:890`、`executor.js:1106`、`conversation-consolidator.js:161`、`learning.js:728`、`learning.js:779`、`auto-learning.js:98`、`chat-action-dispatcher.js:126`、`chat-action-dispatcher.js:267`、`decision-executor.js:321`、`decision-executor.js:400`、`fact-extractor.js:384`）在成功写入 `learnings` 表后，必须在同一函数体内追加调用 `pushCaptureAtom`，将该产出同步推送进 T10 统一收件箱（`captures`/`capture_atoms` 表） |
| **NFR（做得多好）** | 非功能需求：性能/可靠性/并发阈值等 | 无新增超时/并发要求；额外开销 = 1 次 `pushCaptureAtom` 调用（内部 1-2 次 INSERT），量级与既有 2 处已接入路径一致，可忽略不计 |
| **Invariant（永不违反）** | 任何情况下不得打破的不变量 | ① `pushCaptureAtom` 调用失败不得抛出未捕获异常导致 `learnings` 主写入回滚（对齐 `learning.js:121` 既有容错模式，且由 `pushCaptureAtom` 自身 try/catch 结构性保证）；② 已接入的 2 处（`learning.js::recordLearning`、`routes/tasks.js` learnings-received 端点）不得被重复接入或改动其现有调用 |
| **判定点（怎么知道）** | 对模糊现实的判断假设 | 见下方判定点登记表 |
| **保质期（何时过期）** | 该能力/数据/token 何时失效，谁负责退役 | 结构性回归测试（source-code inspection）本身无过期时间——只要 `learnings` 表仍通过裸 SQL 字符串 `INSERT INTO learnings` 写入就持续有效；已知局限：若未来 `learnings` 写入方式改为 ORM/查询构造器（不再出现字面量 `INSERT INTO learnings` 文本），该断言会失效，需要新的检测手段（不在本次范围内，仅登记风险） |
| **死亡告警（停了谁知道）** | 该功能停止工作后，谁在多久内会知道 | 本次新增的结构性回归测试本身就是"死亡告警"机制——未来若再有人新增一处 `INSERT INTO learnings` 却忘记接 `pushCaptureAtom`，CI 会在该 PR 上直接 FAIL（而不是像本次一样等 `ledger-hygiene.js` m7 探针几周后才误报发现） |
| **失败语义（挂了怎么办）** | 故障时放行还是拦截？重试幂等？降级策略？ | `pushCaptureAtom` 内部失败 → `console.warn` 记录 + resolve(null)，不重试、不告警（对齐既有 wired 路径行为）；降级策略：静默丢失这一条 `capture_atoms` 记录，但 `learnings` 主记录完整性不受影响 |
| **效果确认（已发≠已生效）** | 每个对外动作如何确认真实生效 | ① 结构性测试保证"调用存在于源码"；② `## E2E 验收` 对 `auto-learning.js::createAutoLearning`（11 处之一）做真实 Postgres 触发，`psql` 查询在 5 分钟时间窗口内确认 `capture_atoms`/`captures` 新增了对应记录 |

### 判定点登记表

（本任务无接缝判定点——纯代码路径接线补齐，不涉及 RPA/真机/外部系统状态推断，N/A）

### 失败语义声明

| 场景 | 失败行为 | 重试幂等？ | 降级策略 |
|------|----------|-----------|----------|
| `pushCaptureAtom` 内部写 `captures`/`capture_atoms` 失败（DB 异常/约束冲突） | `pushCaptureAtom` 内部 catch，`console.warn`，resolve(null)，不向调用方抛出 | 否（不重试） | 静默丢失该条 capture_atoms 记录；`learnings` 主写入已完成，不受影响、不回滚 |
| `learnings` 主 INSERT 本身失败 | 沿用各调用点既有行为（各自的既有 try/catch，未在本次改动范围内），`pushCaptureAtom` 不会被调用（因为主写入未成功，不产生 `learning.id`） | 沿用既有逻辑 | 沿用既有逻辑 |

### 输入对抗面

（本任务不涉及对外暴露 agent / 外部用户可写入接口，均为系统内部代码路径，N/A）

## 禁 mock 边清单

本单改动的核心是"跨模块调用边"（11 处代码路径 → `capture-inbox.js::pushCaptureAtom`）与"DB 写路径"（`capture_atoms`/`captures` 表新增写入），命中 v9.12 硬规则的适用范围，逐条列出：

- **11 处代码路径 ↔ `capture-inbox.js::pushCaptureAtom`**（跨模块数据传递边）：主验证手段为「结构性 source-code inspection 测试」（`tests/learnings-capture-atom-routing.test.js`，**零 mock**，直接读取源码文本断言调用存在）+ `## E2E 验收` 对 `auto-learning.js::createAutoLearning` 的真实触发（**零 mock**，真实 Node 进程调用 + 真实 Postgres）。两者都不 mock 这条边。
- **代码 ↔ `capture_atoms`/`captures` 表**（DB 写路径）：由 `## E2E 验收` 脚本真实 Postgres 验证覆盖（`psql` 时间窗口查询），不 mock。
- `cortex.js::recordLearnings` 的行为级复现测试（`tests/cortex-learnings-capture-push.test.js`）对 `db.js`/`capture-inbox.js` 做了隔离 mock（对齐仓库既有同类测试 `cortex-feedback-loop.test.js`/`learning-capture-push.test.js` 的一贯写法）——这条边的真实链路验证由本节前两条兜底覆盖，详见下方「## 未覆盖真实链路清单」，非静默豁免。

## 未覆盖真实链路清单

- **被 mock 的边**：`cortex.js::recordLearnings` 行为级测试（`tests/cortex-learnings-capture-push.test.js`）中 `db.js`（`pool.query`）与 `capture-inbox.js`（`pushCaptureAtom`）均被 `vi.doMock` 替身。
- **为什么**：① 对齐仓库现存的同一函数家族测试写法（`cortex-feedback-loop.test.js` 已用同样的 `mockPool` + `vi.doMock` 编排验证 `analyzeDeep`→`recordLearnings` 全链路，本次只是在其基础上追加 `pushCaptureAtom` 断言，沿用同一套 mock 保持一致性与可维护性）；② `analyzeDeep` 调用链上还有 reflection/dedup/decision_log/system_status/cross-task-pattern 等 7-8 次前置 `pool.query`，若改为真实 Postgres 需要为这些无关依赖也搭建真实数据前置条件，成本与本次"补齐调用点"这一改动的范围不成比例。
- **真验证补位**：① `tests/learnings-capture-atom-routing.test.js`（结构性，零 mock）直接断言 `cortex.js:890` 所在的 `recordLearnings` 函数体内确实包含 `pushCaptureAtom` 调用——这是对"接线是否存在"最直接的真实验证；② `## E2E 验收` 脚本对同一收件箱入口的另一处调用点（`auto-learning.js::createAutoLearning`）做真实 Postgres 端到端触发，证明"调用 → 真实落库"整条链路可用，两者共同覆盖了 `cortex.js` mock 测试未覆盖的真实写库路径；③ 若后续需要 `cortex.js` 专属的真实 Postgres 集成测试（对齐 `src/__tests__/integration/` 目录既有模式），留作独立 sprint，不在本次范围内（PRD「不在范围内」已声明本次聚焦路由补齐本身，不重构测试基础设施）。

## 真实调用方请求 shape

N/A — 本次改动不涉及"设备/agent 调服务端"场景（Android agent / Windows agent / 外部 webhook 等），全部是 Brain 进程内部代码路径之间的调用，无外部请求 shape 需要对齐。

## Golden Path

[代码路径执行 INSERT INTO learnings 成功] → [同一函数体内追加调用 pushCaptureAtom] → [capture_atoms 表同步新增记录] → [m7 探针不再误判"自主循环零产出"]

### Step 1: 11 处代码路径之一成功执行 `INSERT INTO learnings`

**来源**: `[FROM_PRD]` — PRD 背景段逐条列出的 11 处调用点（`cortex.js:890` 等），Golden Path 第 1 点"上述 11 处任一调用点执行 `INSERT INTO learnings` 成功"

**可观测行为**: `learnings` 表新增一条记录，返回新记录 `id`

**验证命令**:
```bash
LEARNING_ID=$(psql "$DB" -t -c "SELECT id FROM learnings WHERE title = '${MARKER_TITLE}' ORDER BY created_at DESC LIMIT 1" | tr -d ' ')
[ -n "$LEARNING_ID" ] || { echo "FAIL: learnings 主写入未成功"; exit 1; }
```

**硬阈值**: `learnings` 表在触发后 5 秒内出现对应新记录

---

### Step 2: 同一函数体内追加调用 `pushCaptureAtom`

**来源**: `[FROM_PRD]` — PRD Golden Path 第 2 点"该调用点在同一函数内追加调用 `pushCaptureAtom(pool, { targetType: 'learning', targetSubtype, routedToTable: 'learnings', routedToId: <新插入行 id> })`，失败按现有 wired 路径（`learning.js:121`）的容错模式处理"

**可观测行为**: 源码层面，含 `INSERT INTO learnings` 的函数体内同时含 `pushCaptureAtom` 调用；运行时层面，该调用成功写入 `captures`（信封）+ `capture_atoms`（原子）两张表

**验证命令**:
```bash
# 源码层（结构性，永久 CI）
cd packages/brain && npx vitest run src/__tests__/learnings-capture-atom-routing.test.js --reporter=verbose

# 运行时层（真实触发，见 E2E 验收 Step 3）
```

**硬阈值**: 结构性测试 exit 0（全部 `INSERT INTO learnings` 调用点函数体内含 `pushCaptureAtom`）

---

### Step 3: `capture_atoms` 表同步新增对应记录

**来源**: `[FROM_PRD]` — PRD Golden Path 第 3 点"`capture_atoms` 表在同一 24h 窗口内的行数与 `learnings` 表新增行数一致（允许合理去重差异），m7 探针不再误判"

**可观测行为**: `capture_atoms`（经 `captures.id` 关联）新增一条 `target_type='learning'` 的记录，内容可追溯到触发它的 learning

**验证命令**:
```bash
COUNT=$(psql "$DB" -t -c "
  SELECT count(*) FROM capture_atoms ca
  JOIN captures c ON c.id = ca.capture_id
  WHERE ca.target_type = 'learning'
    AND c.content ILIKE '%${MARKER_TITLE}%'
    AND ca.created_at > NOW() - interval '5 minutes'
" | tr -d ' ')
[ "$COUNT" -ge 1 ] || { echo "FAIL: capture_atoms 未同步产出"; exit 1; }
```

**硬阈值**: `COUNT >= 1`，且落在 5 分钟时间窗口内（防止历史数据冒充本轮产出）

---

### Step 4: 已接入的 2 处保持不变（防回归护栏）

**来源**: `[FROM_PRD]` — PRD 边界情况段"已接入的 2 处（`learning.js::recordLearning`、`routes/tasks.js` learnings-received）不得重复接入或改动其现有 `pushCaptureAtom` 调用"

**可观测行为**: 这 2 处调用点的既有回归测试（`learning-capture-push.test.js`、`learnings-received.test.js`）保持全绿；结构性测试同样确认这 2 处 `hasPushCaptureAtom=true`

**验证命令**:
```bash
cd packages/brain && npx vitest run \
  src/__tests__/learning-capture-push.test.js \
  src/__tests__/learnings-received.test.js \
  src/__tests__/learnings-capture-atom-routing.test.js \
  --reporter=verbose
```

**硬阈值**: exit 0，且结构性测试第三个 `it()`（"已接入的 2 处…保持不变"）通过

---

### Step 5: 结构性回归测试永久防止未来新增写入点再次漏接

**来源**: `[FROM_PRD]` — PRD 范围限定段"一条能复现『写 learnings 但 capture_atoms 零增长』的回归测试，永久保留在 CI"；PRD Invariant 段"[回归测试用 source-code inspection] 验证调度接线比 mock 覆盖更直接有效"

**可观测行为**: `packages/brain/src/__tests__/learnings-capture-atom-routing.test.js` 提交进仓库并在 `brain-unit` CI job 中持续运行，对任何未来新增的 `INSERT INTO learnings` 调用点自动生效（无需为每个新调用点单独写测试）

**验证命令**:
```bash
cd packages/brain && npx vitest run src/__tests__/learnings-capture-atom-routing.test.js --reporter=verbose
git log --oneline -1 -- packages/brain/src/__tests__/learnings-capture-atom-routing.test.js
```

**硬阈值**: 测试文件存在于 `packages/brain/src/__tests__/` 且被 `brain-unit` CI job 的 include glob（`src/**/*.{test,spec}.?(c|m)[jt]s?(x)`）自动匹配（无需额外接线，无 exclude 命中）

---

## E2E 验收（最终 final-e2e 跑）

**journey_type**: autonomous
**target_environment**: local_api

```bash
#!/bin/bash
set -euo pipefail

DB="${DB:-postgresql://cecelia@localhost:5432/cecelia_test}"
cd packages/brain

# ── Step A：结构性回归测试（零 mock，全部 INSERT INTO learnings 调用点）────
npx vitest run src/__tests__/learnings-capture-atom-routing.test.js --reporter=verbose

# ── Step B：cortex.js::recordLearnings 行为级复现测试 ─────────────────────
npx vitest run src/__tests__/cortex-learnings-capture-push.test.js --reporter=verbose

# ── Step C：已接入 2 处防回归护栏 ──────────────────────────────────────────
npx vitest run src/__tests__/learning-capture-push.test.js src/__tests__/learnings-received.test.js --reporter=verbose

# ── Step D：真实触发（零 mock，真 Postgres）── auto-learning.js::createAutoLearning ─
MARKER_TITLE="harness-e2e-$(date +%s)-${RANDOM}"

RESULT=$(node --input-type=module -e "
import { createAutoLearning } from './src/auto-learning.js';
import pool from './src/db.js';
const r = await createAutoLearning({
  title: '${MARKER_TITLE}',
  category: 'dev_insight',
  content: 'harness E2E 验证：createAutoLearning 写 learnings 后应同步推送 capture_atoms',
  triggerEvent: 'harness_e2e',
  metadata: {},
});
console.log(JSON.stringify(r));
await pool.end();
")

LEARNING_ID=$(echo "$RESULT" | node -e "
let d = '';
process.stdin.on('data', c => d += c);
process.stdin.on('end', () => {
  const j = JSON.parse(d.trim());
  if (!j || !j.id) { process.exit(1); }
  console.log(j.id);
});
")
[ -n "$LEARNING_ID" ] || { echo "FAIL: createAutoLearning 未返回 id（learnings 主写入未成功）"; exit 1; }
echo "learning_id=${LEARNING_ID}"

COUNT=$(psql "$DB" -t -c "
  SELECT count(*) FROM capture_atoms ca
  JOIN captures c ON c.id = ca.capture_id
  WHERE ca.target_type = 'learning'
    AND c.content ILIKE '%${MARKER_TITLE}%'
    AND ca.created_at > NOW() - interval '5 minutes'
" | tr -d ' ')
[ "$COUNT" -ge 1 ] || { echo "FAIL: capture_atoms 未在 5 分钟窗口内同步产出 marker=${MARKER_TITLE}"; exit 1; }

echo "✅ Golden Path 验证通过 learning_id=${LEARNING_ID} capture_atoms_count=${COUNT}"
```

## Test Contract

| 功能 | Test File | BEHAVIOR 覆盖 | 预期红证据 |
|---|---|---|---|
| 结构性回归：所有 INSERT INTO learnings 调用点必含 pushCaptureAtom | `tests/learnings-capture-atom-routing.test.js` | 每一处 INSERT INTO learnings 调用点，其所在函数体内必须包含 pushCaptureAtom 调用（防止未来新增写入点再次漏接 T10 收件箱） | → 1 failure（11 处违规，本地已验证：`auto-learning.js:98`/`chat-action-dispatcher.js:126,267`/`conversation-consolidator.js:161`/`cortex.js:890`/`decision-executor.js:321,400`/`executor.js:1106`/`fact-extractor.js:384`/`learning.js:728,779`） |
| 结构性回归：扫描器本身有效 | `tests/learnings-capture-atom-routing.test.js` | 下必须能扫描到至少 13 处 INSERT INTO learnings 调用点 | → 0 failure（修复前后均应通过，扫描器自身不依赖修复结果） |
| 结构性回归：已接入 2 处防回归 | `tests/learnings-capture-atom-routing.test.js` | 已接入的 2 处（learning.js::recordLearning、routes/tasks.js learnings-received 端点）保持 pushCaptureAtom 接线不变 | → 0 failure（修复前后均应通过） |
| cortex.js::recordLearnings 行为级复现 | `tests/cortex-learnings-capture-push.test.js` | cortex.js::recordLearnings 写入 learnings 成功后应调用 pushCaptureAtom（复现 m7 探针误报的原始 issue 场景） | → 1 failure（本地已验证：expected "spy" to be called 1 times, but got 0 times） |
| cortex.js::recordLearnings 字段约定 | `tests/cortex-learnings-capture-push.test.js` | pushCaptureAtom 推送字段（targetType/targetSubtype/routedToTable/routedToId）与 learning.js::recordLearning 既有约定一致 | → 1 failure（同上，spy 未被调用） |
| cortex.js::recordLearnings 去重不重复推送 | `tests/cortex-learnings-capture-push.test.js` | recordLearnings 去重命中（相同 content_hash 已存在）时不应调用 pushCaptureAtom | → 0 failure（修复前后均应通过，去重分支本就不到达 INSERT） |
| cortex.js::recordLearnings 容错护栏 | `tests/cortex-learnings-capture-push.test.js` | pushCaptureAtom 抛错时 recordLearnings 不应向上抛出未捕获异常（learnings 主写入已完成，不回滚，对齐 learning.js:121 既有容错模式） | → 0 failure（修复前后均应通过，既有 per-learning try/catch 结构性保证） |

**本地 Red 证据（2026-07-30 已实跑验证，详见 `tests/` 两个文件本身，运行方式：临时拷贝至 `packages/brain/src/__tests__/` 执行 `npx vitest run` 后删除）**：
- `learnings-capture-atom-routing.test.js`：3 个 `it()` 中 1 个 FAIL（"每一处 INSERT INTO learnings…"），列出的 11 处违规文件/行号与 PRD 背景段逐条比对完全一致
- `cortex-learnings-capture-push.test.js`：4 个 `it()` 中 2 个 FAIL（"写入 learnings 成功后应调用 pushCaptureAtom" / "推送字段…与既有约定一致"），另 2 个（去重不推送、容错护栏）修复前即通过——符合预期，这两条验证的是既有逻辑而非本次新增行为
