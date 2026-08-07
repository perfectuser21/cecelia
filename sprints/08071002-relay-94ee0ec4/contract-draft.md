# Sprint Contract Draft (Round 1)

Sprint: 修复 never_started 假杀失败模式（queued 未 spawn 任务被 liveness watchdog 杀死）
task_id: 94ee0ec4-e0e0-48ab-8606-e829ef0d4f07
journey_type: autonomous
target_environment: local_api

---

## Response Schema

N/A — 任务无 HTTP 响应。本 sprint 全部改动落在 Brain 内部调度/liveness/watchdog 链
（packages/brain），不新增/不变更任何 HTTP 端点。验收 oracle 为 psql（tasks / task_events /
decisions 表）+ vitest 集成测试 + 真实 tick 触发（POST /api/brain/tick 为既有生产端点，本合同只调用不改动）。

---

## 已知约束（来自回归测试）

来源文件 `packages/brain/src/__tests__/integration/liveness-never-started.integration.test.js`
（1dfa40f7 防复发测试族，永久 CI，本 sprint 不得删除、不得回退其行为）：

- [liveness-never-started.integration.test.js] → 从未启动任务（started_at=null 且无进程日志且 pid 未跟踪）双确认后 watchdog_kill.reason 为 never_started
- [liveness-never-started.integration.test.js] → 从未启动任务已有 error_message 与 payload.failure_class=missing_anchor 不被 watchdog 记账覆盖（铁律 56a0ba9f）
- [liveness-never-started.integration.test.js] → 回归：曾启动任务（started_at 非空 + 进程日志存在）仍判 process_disappeared，行为与现状一致
- [liveness-never-started.integration.test.js] → 从未启动任务的 failure learning 文本含真实根因标签 never_started 且不含 liveness_dead 假标签
- [liveness-never-started.integration.test.js] → 边界：started_at=null 但存在进程日志（确实曾启动）→ 不判 never_started，仍走既有 process_disappeared 判定
- [liveness-never-started.integration.test.js] → never_started 失败文本不落 transient 环境重试通道（liveness_dead 假分类）
- [累积FR] （本 line 无历史——PRD 累积 FR 段为空，task.payload.journey_id 为空）
- context-manifest: unavailable（journey_id=none，`GET /api/brain/line/none/context-manifest` 返回 Cannot GET）

**约束语义（本 sprint 修复不得破坏）**：既有 never_started 分类针对的是「派发被拒/失败且已有回执
（error_message）」的任务——这类任务仍必须被正确分类为 never_started。本次修的是另一形态：
**零留痕**（无 error_message、无事件行、无日志、无 spawn）的任务被假杀。两者必须同时成立。

---

## 八要素需求规范

| 要素 | 说明 | 本次答案（必填，可 N/A） |
|------|------|--------------------------|
| **FR（做什么）** | 功能需求 | ① 根因链 a/b/c 逐条实证并落 root-cause.md；② failing regression test 先行、永久入 CI；③ 修复：未真实 spawn（零 spawn 回执）的任务不得被 liveness 判 never_started 杀死；④ headed_manual 消费语义落地（不进无头派发/liveness 假杀路径）+ decisions 拍板留痕；⑤ b35bfa0c 数据若变更须留痕；⑥ 事故形态重放跨 ≥1 探测周期不再被假杀 |
| **NFR（做得多好）** | 性能/可靠性 | liveness 探测周期沿用现值（TICK 常量不动、不新增配置）；修复不增加每 tick 额外 DB 全表扫描（探测集合仍以 status='in_progress' 为基底谓词，只做收窄/排除，不放宽） |
| **Invariant（永不违反）** | 不变量 | watchdog kill 不覆盖已有 error_message/failure_class（56a0ba9f）；真死进程（曾 spawn 后消失）仍被双确认捕获——修复只堵假杀，不放过真死；见下方 INV 映射（在 contract-dod.md） |
| **判定点（怎么知道）** | 判断假设 | 见下方判定点登记表 |
| **保质期（何时过期）** | 失效与退役 | 回归测试永久入 CI（brain-integration job），无保质期；headed_manual 消费语义随 decisions 拍板记录长期有效，改语义须新 decision 废旧 |
| **死亡告警（停了谁知道）** | 告警手段 | 若修复回退（假杀复发），CI 回归测试（每 PR 必跑）先红；运行时假杀会在 learnings（trigger_event=watchdog_kill）留痕并进 capture-triage urgent 流（本次事故即由此上报，链路已验证有效） |
| **失败语义（挂了怎么办）** | 放行/拦截 | 见下方失败语义声明表 |
| **效果确认（已发≠已生效）** | 回执方式 | watchdog 每次处置（kill/requeue/跳过 headed）必须写 task_events 行（本次事故 0 行即缺口）；spawn 失败必须留 error_message 或 dispatch_events(failed_dispatch) 回执，杜绝零留痕 |

### 判定点登记表（对模糊现实的判断假设 — decisions e035dad8）

| 判定点 | 候选方法 | 所选方法 | 依据 | 误判后果 |
|--------|----------|----------|------|----------|
| （示例：微信群是否发送成功） | A. 监听发送按钮变灰; B. 读取聊天记录 API | A. 监听按钮变灰 | 聊天记录 API 不稳定 | 静默丢消息，用户不知 |
| ⚠️ 任务是否曾真实 spawn（liveness 可否对其走 kill 分类） | A. activeProcesses 内存条目; B. /tmp/cecelia-{id}.log 存在; C. started_at 非空; D. 派发失败回执（error_message / dispatch_events 行）存在 | 组合判定：存在任一正向 spawn 证据（A/B）或派发回执（D）才允许进入 never_started/process_disappeared kill 分类；零证据（A/B/D 全无）→ 不得 kill，只做带留痕的安全处置。C（started_at）单独不可靠（requeue 会清空，1dfa40f7 已实证） | 本次事故实证：零证据任务被判 never_started 杀死；既有 isNeverStarted 已保守回落但只收窄「分类」不收窄「杀」 | 误判为可杀 → 假杀复发（本事故本体）；误判为不可杀 → 真僵尸任务滞留 in_progress（由回归护栏 it「带派发失败回执…」+「曾启动…」双向卡死） |
| ⚠️ 任务是否为 headed_manual（应走有头等待、不进无头派发） | A. payload->>'headed_manual' = 'true'（jsonb 布尔或字符串 true 均识别）; B. 新增独立列 | A（payload 旗标判定，兼容既有建单方写法——b35bfa0c 实证该旗标已在生产 payload 中） | 旗标由建单方写入，monorepo 此前零消费（controller 事实 4）；本 sprint 落地消费语义 | 误判非 headed → 有头任务被无头 spawn（本事故诱因之一）；误判为 headed → 普通任务滞留不派（由边界 it「非 headed…」+ E2E 反向面卡住） |
| 任务进程死亡双确认 | A. 单次探测即杀; B. suspectProcesses 两轮双确认 | B（既有机制，本 sprint 不改动双确认逻辑本身） | 既有生产机制，1dfa40f7 族测试覆盖 | 单轮误杀瞬时抖动任务（既有机制已防） |

> judgment-pending-user: 无 —— headed_manual 语义方向 PRD ASSUMPTION 已给默认拍板（消费方向），本合同锁定该方向并要求写 decisions 留痕；如用户后续改拍「拒绝」方向，属新 decision。

### 失败语义声明

| 场景 | 失败行为 | 重试幂等？ | 降级策略 |
|------|----------|-----------|----------|
| liveness 探测信号不完整（日志探测异常等） | 保守回落，不杀（沿用既有 isNeverStarted catch→false 语义） | 是（下轮探测重判） | 维持 process_disappeared 既有兜底 |
| dispatcher claim 后 spawn 失败 | fail-closed：必须写回执（error_message 或 dispatch_events failed_dispatch + task_events 行），任务回 queued 可重试 | 是（幂等键=task_id，回执允许多行） | 禁止静默：零留痕即视为本失败模式复发 |
| headed_manual 任务入队 | 不进无头自动派发；不被 liveness 假杀路径处置；保持等待有头执行（status 不被翻 in_progress/dispatched/failed） | 是（无副作用） | 无（拦截语义，不放行） |
| watchdog 处置任一任务 | 处置动作必须落 task_events 行（含 event_type 与 payload 摘要） | 是（事件表允许多行） | 写事件失败仅告警不阻断处置（可观测降级，不影响主链） |

### 输入对抗面（对外暴露 agent 必填 — decisions 27b57469 第9要素）

N/A — 本 sprint 为 Brain 内部调度链修复，无对外暴露 agent、无外部用户可写入接口。E2E 使用的
POST /api/brain/tick 为既有内网端点，不在本次改动面。

---

## 真实调用方请求 shape

N/A — 本 sprint 无「设备/agent 调服务端」链路。真实调用方即 Brain tick 自身
（tick-runner.js → probeTaskLiveness / 派发选择），E2E 通过真实生产入口 POST /api/brain/tick
触发真实 tick，不构造任何模拟请求 shape。

## 未覆盖真实链路清单

（本合同无 mock 豁免，N/A）— tests/ 零 vi.mock/stub/假数据（参照既有 liveness-never-started
测试族「禁 mock 被测边」写法：真 Postgres、真 executor.js、真 ps 进程探测）；E2E 走真实 Brain +
真实 DB + 真实 tick 端点。

## 禁 mock 边清单

本单涉及调度、状态机、生命周期钩子、DB 写路径四类，以下边禁 mock（generator 测试中
vi.mock/stub 命中即 CONTRACT-IS-LAW 违约）：

- probeTaskLiveness ↔ tasks 表（本单改 liveness 探测/kill 谓词，测试必须真 Postgres 插行、真跑 probeTaskLiveness 双轮，验 status/payload 落库结果）
- probeTaskLiveness ↔ executor.js 内部判定（isNeverStarted / suspectProcesses / requeueTask）（本单改这条分类→处置链，测试必须 import 真 executor.js 模块，不 mock 任何内部函数）
- watchdog 处置 ↔ task_events 表（本单新增处置留痕写路径，测试必须真 Postgres 验 task_events 行落库）
- 无头派发选择 ↔ tasks 表（本单为派发选择加 headed_manual 排除，E2E 必须经真实 Brain tick 验证 queued+headed_manual 任务不被翻 in_progress/dispatched）
- 允许 mock 的仅有：无（本单测试面不需要触达第三方 API/通知渠道）

---

## Golden Path

[任务入队 queued（headed_manual=true）] → [根因实证 root-cause.md] → [failing regression test 先行]
→ [修复：零 spawn 证据任务不被假杀 + headed_manual 消费语义 + 处置留痕] → [事故形态重放跨探测周期不再被杀]
→ [反例：真死进程仍被捕获] → [DevGate + 决策留痕出口]

### Step 1: 根因链 a/b/c 逐条实证，结论落 root-cause.md
**来源**: `[FROM_PRD]` — PRD「FR-根因实证」条（Golden Path 具体步骤 1）

**可观测行为**: `sprints/08071002-relay-94ee0ec4/root-cause.md` 存在；对 a)探测谓词过宽/错标运行中、
b)claim 后 spawn 静默失败缺 fail-closed 回执、c)headed_manual 语义悬空 三条各给出「证实/证伪」结论 +
一手证据（代码位置/DB 查询/日志）；含「b35bfa0c 处置」一节（说明是否变更原任务数据及留痕方式，FR-5）。

**验证命令**:
```bash
RC="sprints/08071002-relay-94ee0ec4/root-cause.md"
grep -q 'a)' "$RC" && grep -q 'b)' "$RC" && grep -q 'c)' "$RC" || { echo "FAIL: root-cause.md 缺 a/b/c 结论"; exit 1; }
grep -qE '证实|证伪' "$RC" || { echo "FAIL: 无证实/证伪结论"; exit 1; }
grep -q 'b35bfa0c' "$RC" || { echo "FAIL: 缺 b35bfa0c 处置节"; exit 1; }
```

**硬阈值**: 三条根因各有结论行；grep 全部命中，exit 0

---

### Step 2: failing regression test 先行（TDD Red），永久入 CI
**来源**: `[FROM_PRD]` — PRD「FR-失败复现测试先行」条 + Bug Fix 铁律

**可观测行为**: 合同 `tests/liveness-queued-never-spawned.integration.test.ts` 被原样复制（仅允许改
import 相对路径与去除 TS 类型标注，describe/it 名与 expect 断言逐字不变——参照既有毕业先例）至
`packages/brain/src/__tests__/integration/liveness-queued-never-spawned.integration.test.js`，
并登记进 `packages/brain/vitest.config.js` 的 `POSTGRES_INTEGRATION_TESTS` 列表（CI brain-integration
job 起真 Postgres 跑）。generator commit 1 提供该测试在修复前的 Red 运行证据（2 条核心 it 失败）。

**验证命令**:
```bash
TF="packages/brain/src/__tests__/integration/liveness-queued-never-spawned.integration.test.js"
node -e "require('fs').accessSync('$TF')" || { echo "FAIL: 回归测试未毕业入 CI 测试族目录"; exit 1; }
grep -q 'liveness-queued-never-spawned.integration.test.js' packages/brain/vitest.config.js || { echo "FAIL: 未登记 POSTGRES_INTEGRATION_TESTS"; exit 1; }
```

**硬阈值**: 文件存在 + vitest.config.js 登记命中，exit 0

---

### Step 3: 修复后回归测试 Green（含既有测试族不回退）
**来源**: `[FROM_PRD]` — PRD「FR-根因修复」条 + 边界情况「真实 spawn 后进程立死的任务仍必须被 watchdog 正常捕获」

**可观测行为**: 新增回归测试 4 条 it 全 Green；既有 1dfa40f7 测试族
`liveness-never-started.integration.test.js` 全 Green（真死进程/带回执 never_started 语义不回退）。

**验证命令**:
```bash
cd packages/brain && npx vitest run --config vitest.integration.config.js \
  src/__tests__/integration/liveness-queued-never-spawned.integration.test.js \
  src/__tests__/integration/liveness-never-started.integration.test.js \
  --reporter=verbose || { echo "FAIL: 回归测试族未通过"; exit 1; }
```

**硬阈值**: vitest exit 0，0 failed

---

### Step 4: 事故形态重放——跨 ≥1 个完整 liveness 探测周期不被假杀
**来源**: `[FROM_PRD]` — PRD「FR-假杀不再发生断言」条（queued、无进程、无日志、headed_manual=true 重放）

**可观测行为**: 向真实 Brain DB 插入事故同形态任务（status=queued、payload.headed_manual=true、
无进程、无日志文件），经两次真实 tick（双确认探测窗口）后：status 不为 failed、payload 无
watchdog_kill、error_message 未被写入；且未被无头派发翻 in_progress/dispatched（headed_manual
消费语义，FR-4）。

**验证命令**:
```bash
bash sprints/08071002-relay-94ee0ec4/tests/replay-incident.sh
```
（脚本内容见合同 tests/，psql 插入 + curl POST /api/brain/tick ×2 + psql 断言 + trap 清理）

**硬阈值**: 脚本 exit 0；断言集：status != failed ∧ status NOT IN (in_progress, dispatched) ∧ payload->watchdog_kill 不存在 ∧ error_message IS NULL

---

### Step 5: headed_manual 语义拍板写 decisions 表留痕
**来源**: `[FROM_PRD]` — PRD「FR-headed_manual 语义落地」条（拍板结论写 Brain decisions 表留痕；ASSUMPTION 默认「消费」方向）

**可观测行为**: decisions 表存在 headed_manual 语义拍板记录（消费方向：headed_manual=true 任务
不进入无头自动派发与 liveness 假杀路径）。

**验证命令**:
```bash
DC=$(psql "${DB_URL:-postgresql://localhost/cecelia}" -t -A -c "SELECT count(*) FROM decisions WHERE (title ILIKE '%headed_manual%' OR content ILIKE '%headed_manual%') AND created_at > NOW() - interval '14 days'")
[ "$DC" -ge 1 ] || { echo "FAIL: decisions 无 headed_manual 拍板留痕"; exit 1; }
```

**硬阈值**: count ≥ 1，14 天时间窗内（`[AI_ADDED]` 时间窗防历史数据冒充——monorepo 此前 headed_manual 零命中，无历史可冒充，窗口取 14 天覆盖 sprint 全周期）

---

### Step 6: watchdog 处置留痕（零留痕堵死）
**来源**: `[FROM_PRD]` — PRD NFR 可观测条「watchdog kill 与 spawn 失败必须在 Brain 日志 + 事件表双留痕（本次事故零留痕即缺口，属修复验收面）」

**可观测行为**: 非 headed 的未 spawn in_progress 任务被 watchdog 处置后，task_events 表有该
task_id 的处置行（5 分钟时间窗）。由回归测试 it「非 headed 未 spawn 任务被 watchdog 处置后
task_events 表有留痕行」真 Postgres 断言（现状 0 行 → Red；修复后 ≥1 行 → Green）。

**验证命令**:
```bash
cd packages/brain && npx vitest run --config vitest.integration.config.js \
  src/__tests__/integration/liveness-queued-never-spawned.integration.test.js \
  -t '留痕行' --reporter=verbose || { echo "FAIL: 留痕断言未通过"; exit 1; }
```

**硬阈值**: vitest -t 命中 ≥1 条测试且全 Green

---

### Step 7: DevGate 三件套出口
**来源**: `[FROM_PRD]` — PRD「预期受影响文件」段末条「Brain 改动走 DevGate 三件套」

**可观测行为**: facts-check / check-version-sync / check-dod-mapping 全过。

**验证命令**:
```bash
node scripts/facts-check.mjs && bash scripts/check-version-sync.sh && node packages/quality/scripts/devgate/check-dod-mapping.cjs || { echo "FAIL: DevGate"; exit 1; }
```

**硬阈值**: 三命令串联 exit 0

---

## E2E 验收（最终 final-e2e 跑 — target_environment = local_api）

**journey_type**: autonomous
**target_environment**: local_api

```bash
#!/bin/bash
set -euo pipefail

DB="${DB_URL:-postgresql://localhost/cecelia}"
BRAIN="${BRAIN_URL:-http://localhost:5221}"
SPRINT_DIR="sprints/08071002-relay-94ee0ec4"

# 0. 前置守卫 —— Brain 可达（不可用 = 环境未就绪 = FAIL，禁止兜底）
curl -sf -m 10 "$BRAIN/api/brain/health" >/dev/null || { echo "FAIL: Brain 不可达"; exit 1; }

# 1. 回归测试族 Green —— 新增事故复现测试 + 既有 1dfa40f7 测试族（真 Postgres，CI 同款）
(cd packages/brain && npx vitest run --config vitest.integration.config.js \
  src/__tests__/integration/liveness-queued-never-spawned.integration.test.js \
  src/__tests__/integration/liveness-never-started.integration.test.js \
  --reporter=verbose) || { echo "FAIL: 回归测试族未通过"; exit 1; }

# 2. 事故形态重放：queued、无进程、无日志、headed_manual=true —— 跨两次真实 tick 不被假杀
bash "$SPRINT_DIR/tests/replay-incident.sh" || { echo "FAIL: 事故重放断言未通过"; exit 1; }

# 3. headed_manual 拍板 decisions 留痕（14 天时间窗防历史冒充）
DC=$(psql "$DB" -t -A -c "SELECT count(*) FROM decisions WHERE (title ILIKE '%headed_manual%' OR content ILIKE '%headed_manual%') AND created_at > NOW() - interval '14 days'")
[ "$DC" -ge 1 ] || { echo "FAIL: decisions 表无 headed_manual 拍板留痕"; exit 1; }

# 4. root-cause.md 三条根因结论 + b35bfa0c 处置节
RC="$SPRINT_DIR/root-cause.md"
grep -q 'a)' "$RC" || { echo "FAIL: root-cause.md 缺 a) 结论"; exit 1; }
grep -q 'b)' "$RC" || { echo "FAIL: root-cause.md 缺 b) 结论"; exit 1; }
grep -q 'c)' "$RC" || { echo "FAIL: root-cause.md 缺 c) 结论"; exit 1; }
grep -qE '证实|证伪' "$RC" || { echo "FAIL: root-cause.md 无 证实/证伪 结论"; exit 1; }
grep -q 'b35bfa0c' "$RC" || { echo "FAIL: root-cause.md 缺 b35bfa0c 处置节"; exit 1; }

# 5. 回归测试已永久入 CI（毕业目录 + vitest.config.js 登记）
node -e "require('fs').accessSync('packages/brain/src/__tests__/integration/liveness-queued-never-spawned.integration.test.js')" || { echo "FAIL: 回归测试未入 CI 测试族"; exit 1; }
grep -q 'liveness-queued-never-spawned.integration.test.js' packages/brain/vitest.config.js || { echo "FAIL: 未登记 POSTGRES_INTEGRATION_TESTS"; exit 1; }

# 6. DevGate 三件套
node scripts/facts-check.mjs || { echo "FAIL: facts-check"; exit 1; }
bash scripts/check-version-sync.sh || { echo "FAIL: check-version-sync"; exit 1; }
node packages/quality/scripts/devgate/check-dod-mapping.cjs || { echo "FAIL: check-dod-mapping"; exit 1; }

echo "✅ Golden Path 验证通过"
```

---

## Test Contract

| 功能 | Test File | BEHAVIOR 覆盖 | 预期红证据 |
|---|---|---|---|
| headed_manual 零留痕任务不被假杀 | `tests/liveness-queued-never-spawned.integration.test.ts` | 不被打 watchdog_kill 且不置 failed | → 现状 requeueTask 写入 watchdog_kill，Red |
| watchdog 处置留痕 | `tests/liveness-queued-never-spawned.integration.test.ts` | task_events 表有留痕行 | → 现状 requeueTask 只写 learnings 不写 task_events（0 行），Red |
| 带回执 never_started 语义护栏 | `tests/liveness-queued-never-spawned.integration.test.ts` | 仍分类 never_started | → 现状 Green（护栏，修复后不得变 Red） |
| 真死进程捕获护栏 | `tests/liveness-queued-never-spawned.integration.test.ts` | 仍判 process_disappeared | → 现状 Green（护栏，修复后不得变 Red） |
| 事故重放（E2E 层） | `tests/replay-incident.sh` | 跨两次真实 tick 不被假杀不被无头派发 | → 修复前任务会被无头派发/假杀，Red |

（前 4 行「BEHAVIOR 覆盖」均为对应 it() 名字面子串，`grep -F` 可命中；第 5 行为 bash 脚本无 it()，覆盖名为脚本断言语义摘要。）

---

## 接缝清单（接缝断言 vs 逻辑断言）

| # | 接缝点 | 碰真实世界在哪 | 真目标验证方式 | 状态 |
|---|---|---|---|---|
| 1 | liveness/派发 ↔ 真实 Brain 运行时（tick 循环、suspectProcesses 跨 tick 内存态） | vitest 里直接调 probeTaskLiveness 与生产 tick 有进程环境差异 | E2E `replay-incident.sh`：对本机真实运行的 Brain（localhost:5221）POST /api/brain/tick 两次，真 DB 断言 | 由 evaluator final-e2e 在真目标验证 |
| 2 | watchdog 处置 ↔ cecelia 生产库表结构（task_events/decisions） | 测试库 cecelia_test 与生产 cecelia 表结构可能漂移 | E2E psql 直查 `${DB_URL:-postgresql://localhost/cecelia}`（本机生产同款库） | 由 evaluator final-e2e 在真目标验证 |

本合同无 `logic-done-pending` 项：两条接缝均已写进 final-e2e，evaluator 模式 B 在真目标执行后才判 done。

---

## contract-gate

cecelia 本仓，packages/brain/src/lib/contract-gate.js 存在 → 走代码层 Contract Gate，无跳过。
