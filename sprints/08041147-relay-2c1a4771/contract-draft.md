# Sprint Contract Draft (Round 2)

Sprint: watchdog liveness 探针「从未启动任务」误判 liveness_dead 修复（防复发）
TASK_ID: 2c1a4771-3424-45ea-b6e4-19ae980edb95

---

## Response Schema（推导来源: N/A）

N/A — 任务无 HTTP 响应（纯 Brain 内部 watchdog 分类修复，不新增/不改任何 API 端点）。

**可观测数据 Schema（DB 层，PRD NFR「失败分类结果必须落 watchdog_kill.reason 字段」）**：

- 字段：`tasks.payload -> 'watchdog_kill' ->> 'reason'`（jsonb，由 executor.js watchdog 记账写入）
- 枚举（现有，来源: executor.js checkExitReason 实现）：`oom_killed | oom_likely | killed_signal | process_error | timeout | process_disappeared`
- 本 sprint 新增值（来源: PRD Golden Path 第 3 点字面）：`never_started`
- **禁用**：从未启动场景下 `watchdog_kill.reason` 不得为 `liveness_dead` 或 `process_disappeared`（PRD 行 19「不再落入 process_disappeared/liveness_dead 兜底」）；`liveness_dead` 是 requeue 通道名，不是 exit reason 枚举值
- 伴随不变量（PRD 行 19/25）：已有 `tasks.error_message` 与 `payload.failure_class`（如 `missing_anchor`）不被 watchdog 记账覆盖
- 伴随可观测（PRD 行 20，r2 补）：`learnings` 表该任务的失败学习行（category=failure_pattern, trigger_event=watchdog_kill）title/content 含真实根因标签 `never_started`（或既有 failure_class），**不含** `liveness_dead` 假标签——该 INSERT 在 executor.js requeueTask 内（PRD 预期受影响文件第一项），属本 sprint 范围

---

## 已知约束（来自回归测试 + 累积 FR）

来源 [回归测试] `packages/brain/src/__tests__/liveness-probe.test.js`：
- should mark task as suspect on first probe failure（双确认第一轮只标 suspect）
- should requeue task on second probe failure (double-confirm)
- should clear suspect status when process recovers
- should use grace period for recently dispatched tasks without run_id（派发后 60s 宽限）
- should NOT mark decomposition task as dead within 60min grace period

来源 [回归测试] `packages/brain/src/__tests__/t2-liveness-four-blades-regression.test.js`：
- verdict=alive 时：不调用 UPDATE tasks SET status=failed 也不调用 status=queued
- dead + release-claim-and-alert → UPDATE status=queued 且不是 failed

来源 [回归测试] `packages/brain/src/__tests__/executor-requeue-learning.test.js`：
- learning INSERT uses correct category=failure_pattern and includes content_hash
- learning error does not prevent requeue from succeeding

**约束含义**：本 sprint 只改「从未启动」场景的 reason 分类与字段保护，双确认节奏、suspect 恢复、宽限期、requeue→queued 状态迁移、learning 写入链均不得破坏（上述测试必须继续全绿）。

来源 [累积FR]：context-manifest: unavailable（PRD journey_id=none，端点 404，无历史 FR）。

---

## 真实调用方请求 shape

N/A — 本 sprint 无设备/agent/外部 webhook 调用方。触发方是 Brain 自身 tick 循环内的 `probeTaskLiveness()` 进程内函数调用，无网络请求 shape 可摘录。

---

## 未覆盖真实链路清单（规则 C）

- **生产 Brain 运行时 tick 内触发**未在本合同 E2E 覆盖｜原因：evaluate 在 merge 前的 worktree 执行，运行中的生产 Brain（localhost:5221）尚未加载新代码，等真实 tick 双确认需 ≥2 个 tick 周期且需真实制造孤儿任务污染生产库｜补位计划：merge 后 brain-deploy 流程重启 Brain，生产端按 PRD NFR「watchdog_kill.reason 可由 Brain DB 直查验证」直接观测（下一个真实从未启动任务出现时 psql 直查）。本合同以「worktree 真代码 + 真 Postgres(cecelia_test) + 真 ps 进程探测」零 mock 覆盖同一代码路径。
- 除上条外**本合同无 mock 豁免**：tests/ 与 E2E 零 vi.mock、零 stub、零假数据注入（fixture 行为真实 INSERT 的 DB 行，非 mock）。

---

## 禁 mock 边清单

本单改动涉及：状态判定（watchdog exit reason 分类）+ 跨模块数据传递（checkExitReason → probeTaskLiveness → requeueTask 的 reason 接力）+ DB 写路径（tasks.payload.watchdog_kill / error_message / failure_class）。逐条禁 mock 边：

- `probeTaskLiveness`/`requeueTask` ↔ DB `tasks` 表（本单改 watchdog_kill.reason 写路径与 error_message/failure_class 保护，测试必须真 Postgres cecelia_test 验行落库，禁止 mock `db.js`）
- `checkExitReason` ↔ `probeTaskLiveness`（本单改两者间 reason 数据接力与「从未启动」判定输入，测试必须真调同模块真函数，禁止 stub checkExitReason）
- `probeTaskLiveness` ↔ OS 进程探测（ps/execSync）（「pid 未跟踪且无进程」是判定输入之一，测试用随机 UUID 天然无匹配进程，真 ps 探测，禁止 mock child_process）
- `requeueTask` ↔ DB `learnings` 表（r2 补：本单钉失败学习文本真根因标签——watchdog 路径唯一的 failure learning 落库点在 executor.js requeueTask 内，测试必须真 Postgres 验 learnings 行落库与文本内容，禁止 mock）
- 允许不真触发的更外层：`auto-learning.js`（fire-and-forget，requeue 路径下 status='requeued' 走 no-op 分支，真 import 真执行但无副作用——watchdog 路径的 failure learning 由上一条 requeueTask↔learnings 边真验覆盖）、dmesg（macOS 平台天然返回 null，无需注入）

**执行落地**：tests/liveness-never-started.integration.test.ts 零 `vi.mock`/`stub`（generator 复制后不得加 mock，evaluator 可机械 grep 核查）。

---

## 八要素需求规范

| 要素 | 说明 | 本次答案（必填，可 N/A） |
|------|------|--------------------------|
| **FR（做什么）** | 功能需求 | watchdog liveness 探针识别「从未启动」任务（pid 未跟踪 ∧ 无进程日志 ∧ started_at=null），分类为 `never_started`，不落 `process_disappeared`/`liveness_dead` 兜底；已有 error_message / payload.failure_class 不被覆盖 |
| **NFR（做得多好）** | 非功能需求 | 可观测：分类结果落 `watchdog_kill.reason`，Brain DB 直查可验（PRD NFR 段字面）；其余（超时/频控）PRD 标注待定，本合同不加码 |
| **Invariant（永不违反）** | 不变量 | ① 曾启动进程消失场景分类行为与现状完全一致（process_disappeared，回归保护）② 双确认节奏/宽限期/requeue→queued 迁移不变 ③ 已有 error_message 与 failure_class 永不被 watchdog 记账覆盖 |
| **判定点（怎么知道）** | 判断假设 | 见下方登记表 |
| **保质期（何时过期）** | 失效与退役 | 分类逻辑随 executor.js 长期有效；回归测试永久入 CI（brain-integration job），退役需走正式测试退役流程 |
| **死亡告警（停了谁知道）** | 停止工作的感知 | 若分类退化，CI 每晚 brain-integration job 跑回归测试红（integration-nightly 开 [integration-red] Issue）；生产侧误判复发时 capture_atoms urgent 学习链会再次出现 liveness_dead 假标签（与本次事故同信号，Brain DB 可查） |
| **失败语义（挂了怎么办）** | 故障策略 | 分类函数不抛异常：无法确认「从未启动」时保守回落现有 process_disappeared 兜底（宁可漏判不可误判曾启动任务）；requeue/退避/隔离链路行为不变 |
| **效果确认（已发≠已生效）** | 回执验证 | watchdog 记账后 psql 直查 `payload->'watchdog_kill'->>'reason'`（含 ts 5 分钟时间窗防历史冒充）；E2E 脚本即回执 |

### 判定点登记表（对模糊现实的判断假设 — decisions e035dad8）

| 判定点 | 候选方法 | 所选方法 | 依据 | 误判后果 |
|--------|----------|----------|------|----------|
| （示例：微信群是否发送成功） | A. 监听发送按钮变灰; B. 读取聊天记录 API | A. 监听按钮变灰 | 聊天记录 API 不稳定 | 静默丢消息，用户不知 |
| 任务进程是否「从未启动」 | A. pid 未跟踪 ∧ 无 /tmp/cecelia-{id}.log ∧ (started_at=null ∨ 已有派发失败 error_message) 联合判定; B. 新增 DB 字段记录点火尝试 | A（PRD ASSUMPTION 字面拍板，无需新增 DB 字段） | 三信号在 1dfa40f7 事故证据链中全部命中且互相佐证；B 需 migration 超出范围 | 反向误判（把曾启动判成 never_started）会掩盖真实进程消失事件——故边界规则：只要存在进程日志即回落 process_disappeared |
| 任务是否「曾启动过」 | A. 存在进程日志或 started_at 非空; B. 仅看 started_at | A（日志存在 = 曾启动的强证据，即使 started_at 被 requeue 清空） | PRD 边界行 24 字面：「pid=null 但任务确实曾启动（有进程日志/started_at 非空）→ 仍走既有 process_disappeared」 | 把曾启动任务误判 never_started → 真实 OOM/抢占事件被静默改写根因 |

（判定方法已由 PrepPRD ASSUMPTION 段拍板，无 judgment-pending-user 项）

### 失败语义声明

| 场景 | 失败行为 | 重试幂等？ | 降级策略 |
|------|----------|-----------|----------|
| 「从未启动」信号不完整（如日志读取异常） | 保守回落现有 process_disappeared 兜底，不猜测 | 是（探针每 tick 幂等重跑） | 分类不确定时维持现状行为，杜绝新误判面 |
| cecelia_test DB 不可达（测试/E2E 时） | E2E/测试显式 FAIL exit 非 0 | 是 | 无降级——环境未就绪 = FAIL，禁止 skip 当 PASS |
| never_started 任务后续消费 | requeue/退避/隔离链路维持现有行为（本 sprint 不改策略），仅分类标签保真 | 与现状一致 | N/A |

### 输入对抗面（对外暴露 agent 必填）

N/A — 纯 Brain 内部调度逻辑，无外部用户/agent 可写入的输入面。

---

## 接缝断言清单（接缝 vs 逻辑）

| # | 接缝点 | 真目标验证方式 | 状态 |
|---|--------|----------------|------|
| 1 | 代码 ↔ 真 Postgres（watchdog_kill/error_message/failure_class + learnings 失败学习行落库） | tests + E2E 真连 cecelia_test（db-config.js 同源解析），psql 直查断言 | 本合同内真验 |
| 2 | 代码 ↔ OS 真 ps 进程探测（「无进程」信号） | tests + E2E 真跑 execSync ps，随机 UUID 天然无进程 | 本合同内真验 |
| 3 | 生产 Brain 运行时 tick 触发 | merge 后 brain-deploy 重启，生产 DB 直查 watchdog_kill.reason（PRD NFR 条款） | logic-done-pending（入未覆盖真实链路清单，merge 前无法真验，非静默） |

其余断言（分类条件组合、classifier 枚举识别）为环境无关逻辑断言，CI 单测/integration 绿 = done。

---

## Golden Path
[从未启动任务出现] → [watchdog 双确认探针] → [分类 never_started + 字段不覆盖] → [failure learning 文本真根因] → [下游分类保真] → [回归护栏 + 永久入 CI]

### Step 1: 前置——构造「从未启动」任务特征
**来源**: `[FROM_PRD]` — PRD 行 18「任务被 S2 锚点执法拒绝点火…进程从未启动：pid=null、无进程日志、started_at=null」

**可观测行为**: DB 中存在一条 in_progress 任务：started_at=null、pid 未被 executor 跟踪、无 /tmp/cecelia-{id}.log、error_message=S2 拒绝文本、payload.failure_class=missing_anchor（1dfa40f7 完整复现）

**验证命令**:
```bash
TEST_DB_URL="postgresql://localhost:5432/cecelia_test"
TID=$(psql "$TEST_DB_URL" -t -A -c "INSERT INTO tasks (title, task_type, status, payload, error_message, started_at) VALUES ('e2e-never-started 探针场景', 'dev', 'in_progress', '{\"failure_class\":\"missing_anchor\"}', 'S2锚点执法：task缺少 payload.anchor.{journey_id,gp_id,step_id}，拒绝点火', NULL) RETURNING id")
[ -n "$TID" ] || { echo "FAIL: 注入失败"; exit 1; }
rm -f "/tmp/cecelia-${TID}.log"
```

**硬阈值**: INSERT RETURNING id 非空（列名 started_at/error_message/payload 已 psql 实查核对存在）

---

### Step 2: watchdog 双确认探针分类为 never_started
**来源**: `[FROM_PRD]` — PRD 行 19「watchdog liveness 探针识别『从未启动』特征，分类为 never_started，不再落入 process_disappeared/liveness_dead 兜底」；时间窗防伪部分 `[AI_ADDED]` — 防止 generator 用历史残留 watchdog_kill payload 冒充本轮分类产出

**可观测行为**: 真实两轮探针（suspect → confirmed dead）后，该任务 `payload->'watchdog_kill'->>'reason'` = `never_started`，且 watchdog_kill.ts 在本轮 5 分钟窗内

**验证命令**:
```bash
cat > /tmp/e2e-never-started-probe.mjs <<'MJS'
process.env.NODE_ENV = process.env.NODE_ENV || 'test';
const { probeTaskLiveness } = await import('./packages/brain/src/executor.js');
await probeTaskLiveness();
await probeTaskLiveness();
process.exit(0);
MJS
NODE_ENV=test node /tmp/e2e-never-started-probe.mjs || { echo "FAIL: 探针执行失败"; exit 1; }
REASON=$(psql "$TEST_DB_URL" -t -A -c "SELECT payload->'watchdog_kill'->>'reason' FROM tasks WHERE id='$TID' AND (payload->'watchdog_kill'->>'ts')::timestamptz > NOW() - interval '5 minutes'")
[ "$REASON" = "never_started" ] || { echo "FAIL: watchdog_kill.reason=$REASON 期望 never_started"; exit 1; }
```

**硬阈值**: reason 字面等于 `never_started`（非 process_disappeared/liveness_dead），ts 时间窗 5 分钟

---

### Step 3: 已有 error_message / failure_class 不被覆盖
**来源**: `[FROM_PRD]` — PRD 行 19「已有的 error_message / payload.failure_class（如 missing_anchor）不被覆盖」+ 边界行 25

**可观测行为**: 双确认记账后，error_message 仍为 S2 拒绝原文，payload.failure_class 仍为 missing_anchor

**验证命令**:
```bash
EM=$(psql "$TEST_DB_URL" -t -A -c "SELECT error_message FROM tasks WHERE id='$TID'")
echo "$EM" | grep -q 'S2锚点执法' || { echo "FAIL: error_message 被覆盖为 $EM"; exit 1; }
FC=$(psql "$TEST_DB_URL" -t -A -c "SELECT payload->>'failure_class' FROM tasks WHERE id='$TID'")
[ "$FC" = "missing_anchor" ] || { echo "FAIL: failure_class 被覆盖为 $FC"; exit 1; }
```

**硬阈值**: error_message 含 S2 原文、failure_class 字面等于 missing_anchor

---

### Step 4: 回归护栏——曾启动场景仍判 process_disappeared
**来源**: `[FROM_PRD]` — PRD 边界行 24「pid=null 但任务确实曾启动（有进程日志/started_at 非空）→ 仍走既有 process_disappeared 判定，不误改」+ 行 26「真正的进程中途消失…分类行为与现状完全一致」

**可观测行为**: started_at 非空 + 进程日志存在的死任务仍分类 process_disappeared；started_at=null 但有日志（确实曾启动）也不判 never_started

**验证命令**:
```bash
NODE_ENV=test npx vitest run sprints/08041147-relay-2c1a4771/tests/liveness-never-started.integration.test.ts -t "仍判 process_disappeared" || { echo "FAIL: 回归护栏破坏"; exit 1; }
NODE_ENV=test npx vitest run sprints/08041147-relay-2c1a4771/tests/liveness-never-started.integration.test.ts -t "不判 never_started" || { echo "FAIL: 边界护栏破坏"; exit 1; }
```

**硬阈值**: 两条 vitest -t 过滤各 exit 0（已实测过滤精确命中单条 it）

---

### Step 5: failure learning 文本携带真实根因标签（r2 补，Reviewer 阻塞项）
**来源**: `[FROM_PRD]` — PRD 行 20「由此产生的 failure learning / capture atom 文本含真实根因标签（never_started 或已有 failure_class），不再出现 liveness_dead 假标签」。代码实证：executor.js requeueTask 内 learnings INSERT（category=failure_pattern, trigger_event=watchdog_kill）的 title/content 现取 requeue 通道参数 `liveness_dead`——原事故（urgent 学习流被假根因污染）的直接伤害面。时间窗防伪部分 `[AI_ADDED]` — task_id 定位 + created_at 5 分钟窗，防历史 learnings 行冒充本轮产出

**可观测行为**: never_started 任务双确认后，learnings 表该任务的失败学习行（task_id=$TID ∧ trigger_event='watchdog_kill' ∧ created_at 5 分钟窗内）存在，且 title/content 含 `never_started`（或既有 failure_class），**不含** `liveness_dead`

**验证命令**:
```bash
L=$(psql "$TEST_DB_URL" -t -A -c "SELECT title || ' ' || content FROM learnings WHERE task_id='$TID' AND trigger_event='watchdog_kill' AND created_at > NOW() - interval '5 minutes'")
[ -n "$L" ] || { echo "FAIL: 该任务无 watchdog_kill 失败学习行"; exit 1; }
echo "$L" | grep -q 'never_started' || { echo "FAIL: 学习文本缺真根因标签"; exit 1; }
if echo "$L" | grep -q 'liveness_dead'; then echo "FAIL: 学习文本仍含 liveness_dead 假标签"; exit 1; fi
```

**硬阈值**: 学习行存在（5 分钟时间窗）+ 文本含 never_started + 不含 liveness_dead

**钉窄声明（防 scope 蔓延）**: 本步只钉**学习文本标签保真**，不钉 requeue 通道退避/隔离策略——15min 最短退避、3 次隔离阈值继续按 liveness 通道语义走（PRD「requeue/退避/隔离链路行为不变」已由失败语义声明表第 3 行覆盖）。generator 自选实现方式（如学习文本取 evidence 内真实 exit reason 而非通道参数），合同不钉 How。

---

### Step 6: 下游分类保真——classifier 不落 transient 假通道
**来源**: `[FROM_PRD]` — PRD 行 20「failure learning / capture atom 文本含真实根因标签…不再出现 liveness_dead 假标签」+ 预期受影响文件「dev-failure-classifier.js 若消费 reason 枚举需识别 never_started」。断言形态 `[AI_ADDED]` — 现状实测：classifyDevFailure 对含 `[watchdog] reason=never_started` 的文本命中 TRANSIENT_PATTERNS（/\[watchdog\]/i）误判 transient（= liveness_dead 环境重试假通道），这是假标签进入学习链的下游闸口，必须钉死

**可观测行为**: `classifyDevFailure({error: '…reason=never_started…'})` 返回的 class 不是 `transient`（目标类别 generator 可选 unknown 或新增枚举，合同只钉「不落 transient」，不加码）

**验证命令**:
```bash
node -e "import('./packages/brain/src/dev-failure-classifier.js').then(m=>{const r=m.classifyDevFailure({error:'[watchdog] liveness_probe_failed reason=never_started 进程从未启动'});if(r.class==='transient'){console.error('FAIL: never_started 误分类 transient');process.exit(1);}console.log('classifier class='+r.class);})" || exit 1
```

**硬阈值**: r.class !== 'transient'，node exit 0

---

### Step 7: 回归测试永久入 CI
**来源**: `[FROM_PRD]` — PRD 行 30「能复现本次误判的 failing test 先行 + 永久回归测试入 CI」

**可观测行为**: 毕业测试文件存在于 `packages/brain/src/__tests__/integration/liveness-never-started.integration.test.js` 且已登记 `packages/brain/vitest.config.js` 的 `POSTGRES_INTEGRATION_TESTS` 白名单（brain-integration job 的机械入口，未登记则 integration config 下 vitest 报 No test files found exit 1——登记被执行路径隐式强制）

**验证命令**:
```bash
cd packages/brain
npx vitest run src/__tests__/integration/liveness-never-started.integration.test.js --config vitest.integration.config.js || { echo "FAIL: 毕业回归测试未通过或未登记"; exit 1; }
cd ../..
node -e "const c=require('fs').readFileSync('packages/brain/vitest.config.js','utf8');if(!c.includes('liveness-never-started.integration.test.js'))process.exit(1)" || { echo "FAIL: POSTGRES_INTEGRATION_TESTS 未登记"; exit 1; }
```

**硬阈值**: integration config 下 vitest exit 0 + 白名单登记内容断言通过

---

### Step 8: 枚举硬编码全仓库复查
**来源**: `[AI_ADDED]` — PRD ASSUMPTION「never_started 作为新 reason 枚举值不破坏下游…新增值需全仓库 grep 复查枚举硬编码断言」+ 铁律「新增状态值应全仓库 grep 复查避免遗漏同类枚举检查点」。理由：防止某个消费 exit reason 枚举的生产文件漏配 never_started 分支形成静默漏洞

**可观测行为**: 所有引用 process_disappeared 枚举的生产源文件（非测试）同时含 never_started 处理

**验证命令**:
```bash
for f in $(grep -rln "process_disappeared" packages/brain/src --include="*.js" | grep -v __tests__); do grep -q "never_started" "$f" || { echo "FAIL: $f 缺 never_started"; exit 1; }; done; echo OK
```

**硬阈值**: 逐文件通过（当前仅 executor.js 命中，实现前该命令 FAIL = 真红）

---

## E2E 验收（最终 final-e2e 跑）

**journey_type**: autonomous
**target_environment**: local_api

```bash
#!/bin/bash
set -euo pipefail

# DB_NAME 同源纪律（铁律）：写入侧 node(db-config.js: NODE_ENV=test → cecelia_test)
# 与校验侧 psql 同一库名变量派生，禁止两处各自默认值
TEST_DB_NAME="cecelia_test"
TEST_DB_URL="postgresql://localhost:5432/${TEST_DB_NAME}"

# 0. 环境预检（不可用 = 环境未就绪 = FAIL，禁止 exit 0 兜底）
psql "$TEST_DB_URL" -t -A -c "SELECT 1" >/dev/null || { echo "FAIL: ${TEST_DB_NAME} 不可达"; exit 1; }
curl -sf -m 5 localhost:5221/api/brain/health | jq -e '.status == "healthy"' >/dev/null || { echo "FAIL: Brain 不健康(环境未就绪)"; exit 1; }

# 1. 回归测试已毕业入 CI 且全绿（brain-integration job 同款入口，真 Postgres）
cd packages/brain
npx vitest run src/__tests__/integration/liveness-never-started.integration.test.js --config vitest.integration.config.js --reporter=verbose || { echo "FAIL: never_started 毕业回归测试未通过"; exit 1; }
cd ../..
node -e "const c=require('fs').readFileSync('packages/brain/vitest.config.js','utf8');if(!c.includes('liveness-never-started.integration.test.js'))process.exit(1)" || { echo "FAIL: POSTGRES_INTEGRATION_TESTS 未登记，非永久入 CI"; exit 1; }

# 2. Golden Path 场景直验：注入「从未启动」任务（1dfa40f7 复现）
# fixture 标题带时间戳唯一化：learnings 以 content_hash（title+content 派生）去重，
# 固定标题会命中历史 is_latest 行跳写，导致步骤 6 学习行断言在复跑时假红
TID=$(psql "$TEST_DB_URL" -t -A -c "INSERT INTO tasks (title, task_type, status, payload, error_message, started_at) VALUES ('e2e-never-started 探针场景 '||extract(epoch from now())::bigint, 'dev', 'in_progress', '{\"failure_class\":\"missing_anchor\"}', 'S2锚点执法：task缺少 payload.anchor.{journey_id,gp_id,step_id}，拒绝点火', NULL) RETURNING id")
[ -n "$TID" ] || { echo "FAIL: fixture 注入失败"; exit 1; }
trap "psql \"$TEST_DB_URL\" -c \"DELETE FROM learnings WHERE task_id='$TID'\" >/dev/null 2>&1; psql \"$TEST_DB_URL\" -c \"DELETE FROM tasks WHERE id='$TID'\" >/dev/null 2>&1 || true" EXIT
rm -f "/tmp/cecelia-${TID}.log"

# 3. 真实两轮探针（suspect → confirmed dead），worktree 真代码 + 真 DB + 真 ps
cat > /tmp/e2e-never-started-probe.mjs <<'MJS'
process.env.NODE_ENV = process.env.NODE_ENV || 'test';
const { probeTaskLiveness } = await import('./packages/brain/src/executor.js');
await probeTaskLiveness();
await probeTaskLiveness();
process.exit(0);
MJS
NODE_ENV=test node /tmp/e2e-never-started-probe.mjs || { echo "FAIL: 探针执行失败"; exit 1; }

# 4. 分类保真断言（时间窗防历史数据冒充：watchdog_kill.ts 须在 5 分钟内）
REASON=$(psql "$TEST_DB_URL" -t -A -c "SELECT payload->'watchdog_kill'->>'reason' FROM tasks WHERE id='$TID' AND (payload->'watchdog_kill'->>'ts')::timestamptz > NOW() - interval '5 minutes'")
[ "$REASON" = "never_started" ] || { echo "FAIL: watchdog_kill.reason=$REASON 期望 never_started"; exit 1; }

# 5. 已有 error_message / failure_class 不被覆盖（PRD 边界）
EM=$(psql "$TEST_DB_URL" -t -A -c "SELECT error_message FROM tasks WHERE id='$TID'")
echo "$EM" | grep -q 'S2锚点执法' || { echo "FAIL: error_message 被覆盖为 $EM"; exit 1; }
FC=$(psql "$TEST_DB_URL" -t -A -c "SELECT payload->>'failure_class' FROM tasks WHERE id='$TID'")
[ "$FC" = "missing_anchor" ] || { echo "FAIL: failure_class 被覆盖为 $FC"; exit 1; }

# 6. failure learning 文本真根因保真（PRD 行 20，r2 补：task_id 定位 + 5 分钟时间窗防历史冒充）
L=$(psql "$TEST_DB_URL" -t -A -c "SELECT title || ' ' || content FROM learnings WHERE task_id='$TID' AND trigger_event='watchdog_kill' AND created_at > NOW() - interval '5 minutes'")
[ -n "$L" ] || { echo "FAIL: 该任务无 watchdog_kill 失败学习行"; exit 1; }
echo "$L" | grep -q 'never_started' || { echo "FAIL: 学习文本缺真根因标签 never_started"; exit 1; }
if echo "$L" | grep -q 'liveness_dead'; then echo "FAIL: 学习文本仍含 liveness_dead 假标签"; exit 1; fi

# 7. 下游分类保真：never_started 文本不落 transient 环境重试假通道
node -e "import('./packages/brain/src/dev-failure-classifier.js').then(m=>{const r=m.classifyDevFailure({error:'[watchdog] liveness_probe_failed reason=never_started 进程从未启动'});if(r.class==='transient'){console.error('FAIL: never_started 误分类 transient');process.exit(1);}console.log('classifier class='+r.class);})" || { echo "FAIL: classifier 分类保真失败"; exit 1; }

# 8. 枚举硬编码全仓库复查（ASSUMPTION 兑现）
for f in $(grep -rln "process_disappeared" packages/brain/src --include="*.js" | grep -v __tests__); do grep -q "never_started" "$f" || { echo "FAIL: $f 引用 exit reason 枚举但缺 never_started"; exit 1; }; done

echo "OK Golden Path 验证通过: never_started 分类保真 + 字段不覆盖 + 学习文本真根因 + 回归护栏 + 永久入 CI"
```

**PASS 标准**: 脚本 exit 0
**FAIL 标准**: 任一断言 exit 非 0（含环境不可达——禁止 skip 当 PASS）

---

## Test Contract

| 功能 | Test File | BEHAVIOR 覆盖 | 预期红证据 |
|---|---|---|---|
| 从未启动分类 | `tests/liveness-never-started.integration.test.ts` | watchdog_kill.reason 为 never_started | → 1 failure（现返 process_disappeared，已实测） |
| 字段不覆盖 | `tests/liveness-never-started.integration.test.ts` | 不被 watchdog 记账覆盖 | → 1 failure（分类断言红，已实测） |
| 学习文本保真 | `tests/liveness-never-started.integration.test.ts` | failure learning 文本含真实根因标签 | → 1 failure（现 title/content 取通道参数 [liveness_dead]，已实测） |
| 曾启动回归 | `tests/liveness-never-started.integration.test.ts` | 仍判 process_disappeared | 现状绿（回归护栏，已实测 exit 0） |
| 有日志边界 | `tests/liveness-never-started.integration.test.ts` | 不判 never_started | 现状绿（边界护栏，已实测） |
| classifier 保真 | `tests/liveness-never-started.integration.test.ts` | 不落 transient 环境重试通道 | → 1 failure（现命中 /\[watchdog\]/i 判 transient，已实测） |

**Red 实测证据（proposer 本机，2026-08-03，r2 复测）**：`NODE_ENV=test npx vitest run sprints/08041147-relay-2c1a4771/tests/` → **Tests 4 failed | 2 passed (6)**，失败原因与预期逐条一致（process_disappeared / transient / 学习文本现含 [liveness_dead] 缺 never_started）。

**测试不可变纪律**：generator commit 1（Red）原样提交本 tests/ 文件；毕业到 `packages/brain/src/__tests__/integration/liveness-never-started.integration.test.js` 时仅允许改 import 相对路径与去除 TS 类型标注，describe/it 名与 expect 断言逐字不变；毕业 commit 前本地先跑 lint-tdd-commit-order 与 check-test-coverage（铁律）。

---

## generator 义务硬条款（合同法律部分）

1. **禁改共享 CI 基础设施**：`.github/workflows/` 零改动；唯一允许触碰的测试注册点 = `packages/brain/vitest.config.js` 的 `POSTGRES_INTEGRATION_TESTS` 数组追加一行
2. **DevGate**：改 packages/brain 前过 facts-check.mjs / check-version-sync.sh / check-dod-mapping.cjs
3. **禁自行 merge PR**：merge 权归 controller，generator 只推分支报告 ready
4. **Red commit 只 add 精确测试路径**，禁止 git add . 混入
5. **错误码契约**：checkExitReason 消费处若新增「失败返 null/false」形态分支，必须显式 else 处理（铁律）
6. **保守回落**：「从未启动」信号不完整时回落 process_disappeared 现状兜底，禁止扩大 never_started 判定面（判定点登记表方法 A 的三信号缺一不可，其中 started_at=null 与「已有派发失败 error_message」为 PRD ASSUMPTION 的或关系）

---

## contract-gate 备注

- 本合同所有 psql 计数/取值断言带 5 分钟时间窗或定点读（id 定位），无历史数据冒充面
- E2E 中 `trap ... || true` 为清理路径（非断言），`import(...).then` node 断言以 process.exit(1) 传播失败

gate-allow: domain/db-no-time-window E2E 步骤 0 的 `SELECT 1` 为 DB 连通性预检（不可达即 FAIL exit 1 的环境就绪探测），非业务数据聚合，无历史数据冒充面
gate-allow: cheat/or-true E2E trap 行为 fixture 清理路径（DELETE learnings/tasks），非断言路径；全部断言路径均显式 exit 1 传播失败
- manual oracle 真实 exit code 记录见 contract-dod.md 附录（铁律：合同批准前逐条真跑）
- contract-gate: 若 packages/brain/src/lib/contract-gate.js 存在则照常过 gate（cecelia 仓库场景）

## journey_type: autonomous
## target_environment: local_api
