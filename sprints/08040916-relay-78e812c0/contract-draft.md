# Sprint Contract Draft (Round 1)

**Sprint**: ledger-hygiene m7 探针口径修正 + 自主循环产出登记覆盖
**TASK_ID**: 78e812c0-458e-4829-9b29-f2eda72c3ffb
**journey_type**: autonomous
**target_environment**: local_api

---

## Response Schema（推导来源: N/A）

N/A — 任务无新增 HTTP 响应。本 sprint 全部改动为 Brain 内部探针/登记链路：
- `PATCH /api/brain/tasks/:task_id` 响应结构**不变**（仍为 `{success, ...}`，仅在 `result.handoff` 有效时新增服务端副作用：写 1 条 capture_atom）
- `POST /api/brain/execution-callback` 响应结构**不变**（副作用变化：harness_initiative failed 现在会产 learning + atom）
- 无新端点、无字段增删

---

## 已知约束（来自回归测试）

- [ledger-hygiene-m7.test.js] → strategist 从未产出（design_docs 无 strategy_session）→ m7 enabled=false
- [ledger-hygiene-m7.test.js] → strategist 历史有产出但近 24h 零产出 → m7 debt=1, absolute=true（**注意：本 sprint 将统计窗改为上一完整北京日后，该文件内写死 `INTERVAL '24 hours'` 的 SQL 桩需同步更新，测试语义不变——"窗口内零产出 → debt=1"**）
- [ledger-hygiene-m7.test.js] → capture_atoms 表不存在（throw）→ 降级为未激活，m7 仍可用
- [ledger-hygiene-m7.test.js] → 两项都零产出 → debt=2；m7 首次 debt=1（absolute）→ 击穿；debt=0 → 不击穿；enabled=false → 不参与棘轮
- [ledger-hygiene.test.js] → isInLedgerHygieneWindow UTC 21:10-21:15 窗口 gate 不变；m1-m6 各指标定义不变；单指标 SQL 失败 → 该指标 enabled=false 不影响其他指标
- [capture-inbox.test.js] → pushCaptureAtom 先写 captures 再写 capture_atoms（两次 query）；content 超 2000 字截断；pool 抛错时吞掉不 throw 返回 null；缺 content 或 targetType 直接返回 null 不查库
- [handoff.test.js] → saveHandoff 先写 DB 再写镜像；task 不存在抛错不写镜像；DB 写成功后推送 atom（verdict=FAIL → subtype=FAIL）；PASS 且真实 next_steps → PASS+NEXT；DB 写失败 → 不推送
- [auto-learning.test.js] → 预算/去重/噪音类目拦截逻辑（createAutoLearning 既有行为不得回退）
- [learnings-capture-atom-routing.test.js]（结构性 source-inspection）→ 所有 `INSERT INTO learnings` 调用点外层函数必须含 pushCaptureAtom 调用
- [累积FR] context-manifest: unavailable（journey_id=none，非路径 C 点火，本 line 暂无历史 FR）

---

## 八要素需求规范

| 要素 | 说明 | 本次答案（必填，可 N/A） |
|------|------|--------------------------|
| **FR（做什么）** | 功能需求 | ① m7 统计窗改为上一完整北京日（Asia/Shanghai 00:00-24:00）；② m7 排除探针自产 atoms（lane='ledger-hygiene'）；③ debt 持平时 issue 文案不写"上升"；④ harness_initiative 纳入 auto-learning VALUABLE_TASK_TYPES；⑤ relay PATCH result.handoff 路径补 capture_atom 登记（与 saveHandoff 同口径）；⑥ 修 pushCaptureAtom 签名断裂，routed_to_table/routed_to_id/lane 真实落库 |
| **NFR（做得多好）** | 性能/可靠性 | 探针为每日批处理无实时性要求；频控"每指标每日最多一条 issue"不得回退（title 前缀 `[ledger-hygiene] <指标名>` 是去重键，不可改）；进箱失败绝不阻塞主流程（既有契约保持） |
| **Invariant（永不违反）** | 不变量 | ① design_docs(type=ledger_hygiene) 分数卡 + working_memory key=ledger_hygiene_ratchet 既有写入不破坏；② pushCaptureAtom 失败吞错不 throw；③ saveHandoff "DB 失败不写镜像不推 atom" 防分裂态保持；④ 真实零产出时 debt+1 照常（探针有效性保留，不因修误报而失明） |
| **判定点（怎么知道）** | 对模糊现实的判断假设 | 见下方登记表 |
| **保质期（何时过期）** | 何时失效 | 探针口径长期有效；若未来 m7 增加新自主产出信号源（如 conversation-claude 捕获，本次显式裁剪），统计口径需重审——届时以本合同 FR 为基线增量修订 |
| **死亡告警（停了谁知道）** | 停止工作谁知道 | 探针自身即死亡告警器（m7 击穿开 issue，streak≥3 升 P1+Bark）；探针整体停摆由 design_docs 分数卡断更暴露（晨报/军师消费方可见） |
| **失败语义（挂了怎么办）** | 故障时行为 | 见下方失败语义声明 |
| **效果确认（已发≠已生效）** | 动作生效确认 | issue 落库以 issues 表行存在为准（非 HTTP 200）；atom 登记以 capture_atoms 行 + routed_to 字段非空为准（语义字段判定，不 grep ok:true）；learning 以 learnings 表行为准 |

### 判定点登记表（对模糊现实的判断假设 — decisions e035dad8）

| 判定点 | 候选方法 | 所选方法 | 依据 | 误判后果 |
|--------|----------|----------|------|----------|
| （示例：微信群是否发送成功） | A. 监听发送按钮变灰; B. 读取聊天记录 API | A. 监听按钮变灰 | 聊天记录 API 不稳定 | 静默丢消息，用户不知 |
| ⚠️ 上一完整北京日是否有自主产出 | A. NOW()-24h 滑窗（现状，秒级漂移自我延续误报）; B. 上一完整北京日 00:00-24:00 固定窗 | B. 固定北京日窗（Asia/Shanghai 推导，不受服务器时区影响） | 滑窗漂移已实证误报 2 天，08-05 将无脑升 P1+Bark | 误报→紧急任务空转裂变+Bark 骚扰；漏报→自主循环真停摆无人知 |
| atom 是否探针自产 | A. content LIKE 'issue: [ledger-hygiene]%'（脆弱，文案改动即失效）; B. capture_atoms.lane='ledger-hygiene' 固定标识（写入时打标） | B. lane 标识（列已存在，零迁移） | PRD ASSUMPTION 指定固定来源标识；content 匹配与文案耦合 | 自产误算产出→债务永不击穿（探针失明）；误排非自产→误报 |
| relay handoff 是否有效（值得登记） | A. 只要 result.handoff 键存在就登记; B. handoff 为非空普通对象才登记 | B. 非空普通对象（typeof object、非 null、非数组、keys>0） | PRD 边界"为空或格式异常→不产 atom 不阻断" | 过宽→垃圾 atom 污染 m7 清偿判定；过严→登记缺口复发 |
| harness_initiative 失败是否有教训价值 | A. 一律产 learning; B. 走既有 content_hash 去重 + 每日预算 + 噪音类目拦截 | B. 既有三重闸（不新增逻辑） | 去重/预算机制已在产线验证 | 垃圾 learning 稀释反刍系统信号 |

### 失败语义声明

| 场景 | 失败行为 | 重试幂等？ | 降级策略 |
|------|----------|-----------|----------|
| pushCaptureAtom 写库失败（任意调用方） | 吞错返回 null，主流程（issue 落库/learning 落库/PATCH 响应）不受阻断 | 是（重跑最多重复一条 atom，m7 计数容忍） | console.warn 留痕 |
| PATCH result.handoff 的 atom 推送失败 | PATCH 仍 200，result 正常合并 | 是（PATCH 幂等覆盖写） | 吞错 warn，不回滚 result 合并 |
| 探针单指标 SQL 失败 | 该指标 enabled=false 不参与棘轮，其他指标照常 | 是（每日重算） | safeMetric 容错包装（既有） |
| execution-callback auto-learning 失败 | callback 主流程照常返回，non-fatal | 是（content_hash 去重） | catch + console.error（既有） |
| 上一北京日恰只有自产 atoms | 排除后为 0 → debt+1 正确击穿（这不是失败，是探针有效性） | — | — |

### 输入对抗面（对外暴露 agent 必填 — decisions 27b57469 第9要素）

N/A — 本 sprint 全部为 Brain 内网端点（localhost:5221）与内部批处理探针，无对外暴露 agent、无外部用户可写入面。PATCH/callback 端点鉴权面维持现状不变（本次不触及）。

---

## 真实调用方请求 shape

本 sprint 的真实调用方为 **skill-relay（headed Claude session）对 PATCH /api/brain/tasks/:task_id 的调用**（research-context 实证：relay 侧直接 PATCH tasks.result.handoff，不走 saveHandoff）。从 Brain 路由代码（packages/brain/src/routes/tasks.js:359-534）与 relay 行为摘录：

- 方法/路径：`PATCH /api/brain/tasks/{task_id}`（task_id 为 UUID 路径参数）
- 认证：内网 localhost 直连，无 header 认证（现状，本次不改）
- Content-Type: `application/json`
- Body 关键字段（逐字）：`result`（JSON object，jsonb `||` 合并语义），handoff 位于 `result.handoff`；`status` 可选（result 纯补写合法，issue a638f840 实证场景）
- handoff 对象 shape 与 `buildHandoff()` 产物一致：`schema_version/task_id/title/verdict/done/not_done/next_steps/data_sources/decision_refs/artifacts/created_at`

DoD 断言构造的请求与该 shape 逐字段一致（见 b6-handoff-patch.sh：PATCH + Content-Type application/json + body `{"result":{"handoff":{...buildHandoff shape...}}}`），无 body/header 双路径分叉。

execution-callback 的真实调用方为 cecelia-run 合成回调（body 字段 `task_id/status/exit_code/stderr`，见 routes/execution.js:41-54 解构），b5/b8 脚本与之逐字段一致。

---

## 禁 mock 边清单

本单涉及 DB 写路径 + 跨模块数据传递 + 探针统计逻辑，以下边**禁止 mock**（generator 测试中 vi.mock/stub 命中即 CONTRACT-IS-LAW 违约，evaluator 机械 grep 核查）：

- ledger-hygiene.js ↔ capture_atoms/captures/issues 表（本单改 m7 统计 SQL 与自产标识写入，测试必须真 Postgres 验窗口/排除/落库；TEMP 影子表属真 Postgres，允许）
- capture-inbox.js ↔ captures/capture_atoms 表（本单改 atom INSERT 列集合，测试必须真 Postgres 验 routed_to_table/routed_to_id/lane 行落库）
- handoff.js(pushHandoffAtom) ↔ capture-inbox.js(pushCaptureAtom)（本单新增该跨模块调用，测试必须真调 pushCaptureAtom 链路直至真库）
- routes/tasks.js PATCH ↔ handoff.js(pushHandoffAtom)（本单新增接线，由 final E2E 走真 Brain HTTP 验证，b6/b7 脚本）
- auto-learning.js ↔ learnings/capture_atoms 表（VALUABLE_TASK_TYPES 生效路径由 final E2E 走真 execution-callback 验证，b5/b8 脚本）

允许 mock 的外层无关依赖：sendBark/飞书通知（notifier.js，测试用 streak=2 避开触发，不 mock 也不触发）、LLM 调用（本单不触及）。

---

## Golden Path

[每日北京 05:10 探针触发 / harness 任务终态 / relay PATCH] → [自主侧产出被登记为 capture_atoms（带溯源）] → [m7 按上一完整北京日统计并排除自产] → [debt 如实反映真实产出，文案如实，误报不再自我延续]

### Step 1: harness_initiative 任务 failed → auto-learning 产 learning + 溯源 atom
**来源**: `[FROM_PRD]` — PRD Golden Path 第 1 条（"harness_initiative 任务 failed → auto-learning 生成 learning，并写入 1 条 capture_atom（routed_to_table/routed_to_id 指向该 learning）"）+ 范围限定"harness_initiative 纳入 auto-learning VALUABLE_TASK_TYPES"

**可观测行为**: harness_initiative 任务经 execution-callback 报 failed 后，learnings 表新增 1 行（task_id 关联），capture_atoms 表新增 1 行且 `routed_to_table='learnings'`、`routed_to_id=该 learning id`。

**验证命令**:
```bash
bash "$(git rev-parse --show-toplevel)/sprints/08040916-relay-78e812c0/tests/e2e/b5-autolearn.sh"
# 期望：stdout 含 "OK b5"，exit 0（脚本内含 5 分钟时间窗防历史数据冒充 + 自清理）
```

**硬阈值**: learnings 行数 ≥ 1（task_id 匹配 + created_at 5 分钟窗）且对应 atom routed_to_id 非空；脚本 exit 0

---

### Step 2: relay PATCH result.handoff → handoff atom 登记（与 saveHandoff 同口径）
**来源**: `[FROM_PRD]` — PRD Golden Path 第 2 条（"skill-relay 完成任务写 handoff（PATCH tasks.result.handoff）→ 该路径同样产生 1 条 handoff 来源的 capture_atom"）；实现路线按 PRD ASSUMPTION 2 由 proposer 定为 **PATCH API 侧补登记**：handoff.js 新增导出 `pushHandoffAtom(pool, taskId, handoff)`（saveHandoff 内部复用同一函数保证同口径），routes/tasks.js PATCH 在 `result.handoff` 为非空普通对象时调用（吞错不阻断）。理由：relay 侧是外部 skill 不在本 repo 控制内，API 侧兜底覆盖所有 PATCH 写 handoff 的调用方。

**可观测行为**: `PATCH /api/brain/tasks/:id` body 含有效 `result.handoff` → 200 且 capture_atoms 新增 1 行 `target_type='handoff'`、`routed_to_table='tasks'`、`routed_to_id=task_id`、subtype 按 verdict 推导（与 saveHandoff 完全同口径）。

**验证命令**:
```bash
bash "$(git rev-parse --show-toplevel)/sprints/08040916-relay-78e812c0/tests/e2e/b6-handoff-patch.sh"
# 期望：stdout 含 "OK b6"，exit 0
```

**硬阈值**: atom count ≥ 1（target_type/routed_to 三字段全匹配 + 5 分钟时间窗）；PATCH 响应 success==true

---

### Step 3: 探针 m7 按上一完整北京日统计 + 排除自产 atoms
**来源**: `[FROM_PRD]` — PRD Golden Path 第 3 条（"m7 统计窗 = 上一个完整北京日（00:00-24:00），不再用 NOW()-24h；统计时排除 ledger-hygiene 探针自产的 issue atoms"）+ PRD ASSUMPTION 1（自产判别用固定来源标识；proposer 定为 `capture_atoms.lane='ledger-hygiene'`，列已存在零迁移，探针 raiseBreachAlerts 的 pushCaptureAtom 调用带 `lane:'ledger-hygiene'` 写入）

**可观测行为**: computeMetrics 的 m7：统计窗为上一完整北京日（Asia/Shanghai 固定 UTC+8 推导，不受服务器时区影响）；`lane='ledger-hygiene'` 的 atoms 不计入产出。

**验证命令**:
```bash
node "$(git rev-parse --show-toplevel)/sprints/08040916-relay-78e812c0/tests/e2e/m7-scenarios.mjs" window
node "$(git rev-parse --show-toplevel)/sprints/08040916-relay-78e812c0/tests/e2e/m7-scenarios.mjs" exclusion
# 期望：各 exit 0。window 场景在旧口径下必然假绿失败（当前时刻 atom 被 NOW()-24h 计入），
# exclusion 场景在不排除自产时必然失败——两条都是判别性断言，代码未改必 FAIL
```

**硬阈值**: window 场景 debt=1；exclusion 场景先 debt=1（仅自产）后 debt=0（加非自产）

---

### Step 4: debt 如实：非自产 atom 存在 → debt=0 + streak 复位；真实零产出 → debt+1 保留
**来源**: `[FROM_PRD]` — PRD Golden Path 第 4 条（"上一北京日内存在任意 1 条非自产 atom → m7 debt=0，不开新 issue，working_memory ratchet streak 复位；若真实零产出 → debt+1 照常"）+ 边界情况第 1 条（仅自产 → 正确击穿）

**可观测行为**: debt=0 时 evaluateRatchet 无击穿且 `state.streaks.m7=0`；debt>0（absolute）击穿照常。

**验证命令**:
```bash
node "$(git rev-parse --show-toplevel)/sprints/08040916-relay-78e812c0/tests/e2e/m7-scenarios.mjs" reset
# 期望：exit 0（prev streak=2 → 复位 0，breaches 空）
```

**硬阈值**: state.streaks.m7 == 0 且 breaches.length == 0

---

### Step 5: debt 持平时 issue 文案如实（不写"上升"）+ 自产 atom 带标识与溯源
**来源**: `[FROM_PRD]` — PRD Golden Path 第 5 条（"absolute 指标 debt 与前日持平时，issue 文案不再写'上升 X→X'（改为如实表述持平/连续第 N 天）"）+ 第 6 条（routed_to 真实落库）

**可观测行为**: raiseBreachAlerts 对 prevDebt==debt 的击穿产生的 issue，title/body 不含"上升"、含"持平"或"连续第 N 天"；title 前缀 `[ledger-hygiene] <指标名>` 不变（频控去重键）；随之写入的自产 atom `lane='ledger-hygiene'` 且 `routed_to_table='issues'`、`routed_to_id` 非空。

**验证命令**:
```bash
node "$(git rev-parse --show-toplevel)/sprints/08040916-relay-78e812c0/tests/e2e/m7-scenarios.mjs" copy
# 期望：exit 0（TEMP 影子 issues 表，不污染真实 issues；streak=2 避开 Bark）
```

**硬阈值**: issue 行数 == 1；文案断言全过；atom lane/routed_to 三字段断言全过

---

### Step 6: 全部 pushCaptureAtom 调用方溯源字段真实落库
**来源**: `[FROM_PRD]` — PRD Golden Path 第 6 条（"全部 pushCaptureAtom 调用方（ledger-hygiene.js / cortex.js / auto-learning.js / handoff.js 等）传入的 routed_to_table/routed_to_id 被真实落库，不再静默丢弃"）

**可观测行为**: pushCaptureAtom 接受 `routedToTable/routedToId/lane`（弃用 `_routedToTable/_routedToId` 丢弃形态），atom INSERT 落库这三列；既有调用方（cortex.js:908 / learning.js:121,742,794 / chat-action-dispatcher.js:133,283 / conversation-consolidator.js:168 已在传 routedToTable/routedToId）无需改参即恢复溯源。未传时列为 NULL 不回退。

**验证命令**:
```bash
# 行为侧：Step 1/2/5 的验证命令已覆盖三类调用方（auto-learning/handoff/ledger-hygiene）真实落库
# 结构侧（cortex 等触发条件窄路径，铁律 INV-1 授权 source-code inspection）：
node -e "const c=require('fs').readFileSync('packages/brain/src/capture-inbox.js','utf8');if(c.includes('_routedToTable')||c.includes('_routedToId')){console.error('FAIL: 丢弃形态签名仍在');process.exit(1)};const m=c.match(/INSERT INTO capture_atoms[\s\S]*?RETURNING id/);if(!m||!/routed_to_table/.test(m[0])||!/routed_to_id/.test(m[0])||!/lane/.test(m[0])){console.error('FAIL: atom INSERT 未含溯源列');process.exit(1)};console.log('OK')"
# 期望：OK
```

**硬阈值**: capture-inbox.js 无 `_routedToTable/_routedToId`；atom INSERT 语句含 routed_to_table + routed_to_id + lane 三列

---

### Step 7: 登记链路防回退（时间窗 + 非 valuable 过滤 + 空 handoff 边界）
**来源**: `[AI_ADDED]` — GAN Round 1 Proposer 加入，理由：防造假与防 scope 蔓延双向卡位——① b5/b6 断言全部带 `created_at > NOW() - interval '5 minutes'` 时间窗，防 generator 用历史 atoms 冒充本轮产出；② code_review 等高频类型 failed 不产 learning（防 generator 图省事把 VALUABLE_TASK_TYPES 改成全量放行，制造垃圾 learning 稀释 m7）；③ 空 handoff 不产 atom（PRD 边界条款可执行化）

**可观测行为**: 非 valuable 类型 failed → learnings 零新增；`result.handoff` 空对象 → PATCH 200 且 atoms 零新增。

**验证命令**:
```bash
bash "$(git rev-parse --show-toplevel)/sprints/08040916-relay-78e812c0/tests/e2e/b7-handoff-empty.sh"
bash "$(git rev-parse --show-toplevel)/sprints/08040916-relay-78e812c0/tests/e2e/b8-nonvaluable-skip.sh"
# 期望：各 exit 0
```

**硬阈值**: b7 atom count == 0；b8 learning count == 0

---

### Step 8: DevGate 三件套 + 回归测试永久入 CI
**来源**: `[FROM_PRD]` — PRD ASSUMPTION 3（"改动全部落在 packages/brain，须先过 DevGate 三件套"）+ NFR 可观测（"修 bug 的 failing test 必须 commit 进 CI 永久保留"）

**可观测行为**: facts-check / check-version-sync / check-dod-mapping 全过；本合同 5 个测试文件毕业入册 `packages/brain/src/__tests__/`（真 PG 的 4 个 `*.integration.test.ts` 进 `src/__tests__/integration/` 并登记 `vitest.config.js` 的 `POSTGRES_INTEGRATION_TESTS`；纯逻辑的 auto-learning-harness.test.ts 进 `src/__tests__/` 默认 CI 直跑）。

**验证命令**:
```bash
node scripts/facts-check.mjs && bash scripts/check-version-sync.sh && node packages/quality/scripts/devgate/check-dod-mapping.cjs
# 期望：三条全 exit 0
```

**硬阈值**: 三命令 exit 0；入册文件存在且与合同 tests/ 同名同断言

---

## E2E 验收（最终 final-e2e 跑 — 按 target_environment 选模板）

**journey_type**: autonomous
**target_environment**: local_api

```bash
#!/bin/bash
# final-e2e — ledger-hygiene m7 探针口径修正 + 自主循环产出登记覆盖（local_api: curl localhost:5221 + psql）
set -euo pipefail
ROOT="$(git rev-parse --show-toplevel)"
cd "$ROOT"
DB="${DB:-cecelia}"
SPRINT_DIR="sprints/08040916-relay-78e812c0"

# 0. 前置：Brain 健康 + brain 依赖（场景脚本需 packages/brain/node_modules/pg）
curl -sf -m 5 localhost:5221/api/brain/health | jq -e '.status == "healthy"' >/dev/null || { echo "FAIL: Brain 5221 不健康"; exit 1; }
if [ ! -d packages/brain/node_modules ]; then
  (cd packages/brain && npm ci --prefer-offline >/dev/null 2>&1) || { echo "FAIL: packages/brain 依赖安装失败"; exit 1; }
fi

# 1. m7 统计窗 = 上一完整北京日（判别性：旧口径 NOW()-24h 必 FAIL）
node "$SPRINT_DIR/tests/e2e/m7-scenarios.mjs" window

# 2. m7 排除自产 atoms + 非自产清偿（判别性：不排除自产必 FAIL）
node "$SPRINT_DIR/tests/e2e/m7-scenarios.mjs" exclusion

# 3. debt=0 时 ratchet streak 复位
node "$SPRINT_DIR/tests/e2e/m7-scenarios.mjs" reset

# 4. debt 持平文案不写"上升" + 自产 atom lane 标识 + routed_to 落库
node "$SPRINT_DIR/tests/e2e/m7-scenarios.mjs" copy

# 5. harness_initiative failed → auto-learning → learning + 溯源 atom（真 Brain + 真 DB，5 分钟时间窗，自清理）
bash "$SPRINT_DIR/tests/e2e/b5-autolearn.sh"

# 6. relay PATCH result.handoff → handoff atom（真 Brain，时间窗，自清理）
bash "$SPRINT_DIR/tests/e2e/b6-handoff-patch.sh"

# 7. 边界：空 handoff → 200 且不产 atom
bash "$SPRINT_DIR/tests/e2e/b7-handoff-empty.sh"

# 8. 边界：非 valuable 类型 failed → 不产 learning
bash "$SPRINT_DIR/tests/e2e/b8-nonvaluable-skip.sh"

# 9. DevGate 三件套（PRD ASSUMPTION 3）
node scripts/facts-check.mjs
bash scripts/check-version-sync.sh
node packages/quality/scripts/devgate/check-dod-mapping.cjs

# 10. 回归测试永久入 CI（NFR：修 bug 的 failing test 必须 commit 进 repo）
for f in ledger-hygiene-m7-beijing-window.integration.test.ts breach-issue-copy.integration.test.ts capture-atom-routing.integration.test.ts handoff-atom-relay.integration.test.ts; do
  [ -f "packages/brain/src/__tests__/integration/$f" ] || { echo "FAIL: 回归测试未入册 $f"; exit 1; }
done
[ -f "packages/brain/src/__tests__/auto-learning-harness.test.ts" ] || { echo "FAIL: 回归测试未入册 auto-learning-harness.test.ts"; exit 1; }
grep -q 'ledger-hygiene-m7-beijing-window.integration.test.ts' packages/brain/vitest.config.js || { echo "FAIL: POSTGRES_INTEGRATION_TESTS 未登记"; exit 1; }

echo "✅ Golden Path 验证通过"
```

**通过标准**: 脚本 exit 0
**FAIL 标准**: 任一步 exit 非 0（set -e 传播）

---

## Test Contract

| 功能 | Test File | BEHAVIOR 覆盖 | 预期红证据 |
|---|---|---|---|
| m7 北京日窗口 + 自产排除 + streak 复位 | `tests/ledger-hygiene-m7-beijing-window.integration.test.ts` | m7 统计窗为上一完整北京日：仅当前时刻 atom 不计入 → debt=1 / m7 排除探针自产 atoms：上一北京日仅 lane=ledger-hygiene 自产 issue atom → debt=1 正确击穿 / 上一北京日存在非自产 atom → m7 debt=0 清偿 / debt=0 无击穿 → ratchet streak 复位为 0 | → 2 failures（窗口/排除未实现），2 pass（清偿/复位为既有行为保留断言） |
| debt 持平文案 + 自产标识 | `tests/breach-issue-copy.integration.test.ts` | debt 持平时 issue 文案不含「上升」且含持平或连续第 N 天表述 / 探针自产 issue atom 带 lane=ledger-hygiene 且 routed_to_table=issues routed_to_id 非空 / issue title 保持 [ledger-hygiene] 指标名前缀不变 | → 2 failures（文案/lane 未实现），2 pass |
| pushCaptureAtom 溯源落库 | `tests/capture-atom-routing.integration.test.ts` | pushCaptureAtom 传 routedToTable/routedToId 真实落库到 capture_atoms / pushCaptureAtom 透传 lane 落库 / routedToTable/routedToId 未传时列为 NULL（可选参数不回退既有调用方） / 缺 content 或 targetType 返回 null 不写库 | → 2 failures（签名断裂未修），2 pass |
| VALUABLE_TASK_TYPES 覆盖 | `tests/auto-learning-harness.test.ts` | VALUABLE_TASK_TYPES 含 harness_initiative / VALUABLE_TASK_TYPES 保留 dev feature research 不回退 / VALUABLE_TASK_TYPES 不纳入 code_review 等高频低价值类型 | → 1 failure，2 pass |
| relay handoff 登记（pushHandoffAtom） | `tests/handoff-atom-relay.integration.test.ts` | pushHandoffAtom 写入 target_type=handoff 且 routed_to_table=tasks routed_to_id=task_id / handoff 为空对象或非对象时不产 atom 且不抛异常 / verdict=PASS 且含真实 next_steps → target_subtype=PASS+NEXT 与 saveHandoff 同口径 | → 3 failures（pushHandoffAtom 未导出，import 失败整文件红） |

**测试运行方式**（generator TDD 用，evaluator 不以此为 oracle）：
```bash
bash packages/brain/scripts/setup-test-db.sh   # 首次：建 cecelia_test
cd packages/brain && npx vitest run --config ../../sprints/08040916-relay-78e812c0/tests/vitest.config.mjs
```

---

## 未覆盖真实链路清单

（本合同无 mock 豁免，N/A——全部 [BEHAVIOR] 断言走真 Postgres / 真 Brain HTTP；TEMP 影子表为真 Postgres session 级隔离手段而非 mock；唯一未在 final E2E 内真跑的链路为「北京 05:10 定时窗口触发 maybeRunLedgerHygiene」——窗口 gate `isInLedgerHygieneWindow` 为既有逻辑本次不改，且无法在任意时刻的 E2E 中等待真实 05:10，探针主体 computeMetrics/evaluateRatchet/raiseBreachAlerts 均已用真库直调覆盖；该 gate 由既有单测 ledger-hygiene.test.js 持续守护）

---

## 接缝清单（接缝断言 — 必须在真目标验证）

1. **Brain 进程 ↔ cecelia 库（登记链路）**：b5/b6/b7/b8 直接打本机运行中的 Brain（localhost:5221）+ psql cecelia 验行落库——evaluator 执行前 Brain 必须已重启加载本 PR 代码（harness 部署流程既有职责），否则接缝断言如实 FAIL。已列入 DoD BEHAVIOR，非 logic-done-pending。
2. **探针 SQL ↔ Postgres 时区语义**：北京日窗口 SQL 在真 Postgres 上执行（m7-scenarios.mjs 真库直调），非 mock SQL 字符串匹配。已真验，非 logic-done-pending。
3. **生产 brain checkout 落后 66 commit 的部署问题**：PRD 显式裁剪不在范围内——本合同验收以本地 local_api 为真目标；生产机生效依赖既有部署链（brain-ci-deploy），不在本单断言。

---

## 附：实现口径备忘（合同硬条款，generator 不得偏离）

1. **m7 统计窗 SQL 口径**：上一完整北京日 = `[前一日 00:00, 当日 00:00)`（Asia/Shanghai）。参考实现（等价即可，行为以场景断言为准）：
   `created_at >= ((date_trunc('day', now() AT TIME ZONE 'Asia/Shanghai') - interval '1 day') AT TIME ZONE 'Asia/Shanghai') AND created_at < (date_trunc('day', now() AT TIME ZONE 'Asia/Shanghai') AT TIME ZONE 'Asia/Shanghai')`；strategist 子项 (a) 与 capture 子项 (b) 同窗口口径。
2. **自产排除**：`AND (lane IS DISTINCT FROM 'ledger-hygiene')`（仅作用于 capture 子项计数）。
3. **自产打标**：raiseBreachAlerts 的 pushCaptureAtom 调用增加 `lane: 'ledger-hygiene'`。
4. **pushCaptureAtom 新签名**：`{ content, targetType, targetSubtype = null, routedToTable = null, routedToId = null, lane = null }`，经 pushCapture 落至 atom INSERT 的 `routed_to_table/routed_to_id/lane` 列；pushCapture 对应参数透传。既有调用方传参不变即恢复溯源。
5. **pushHandoffAtom**：`export async function pushHandoffAtom(pool, taskId, handoff)`——handoff 非普通非空对象（null/非 object/数组/keys==0）→ 返回 null 不写不抛；有效 → 与 saveHandoff 现有 atom 段完全同口径（content 首行 `handoff: ${handoff.title || taskId}`、targetType 'handoff'、subtype 按 verdict + 真实 next_steps 推导、routedToTable 'tasks'、routedToId taskId）；saveHandoff 内部改为复用本函数；routes/tasks.js PATCH 在 `result.handoff` 有效时调用（吞错不阻断响应）。
6. **文案**：`prevDebt === debt` 时 title 用「欠账持平 ${debt}（连续第 ${streak} 天，${today}）」类如实表述；`debt > prevDebt` 保留「上升」；title 前缀 `[ledger-hygiene] ${b.name}` 逐字不变（频控去重键）。
7. **既有测试同步**：packages/brain/src/__tests__/ledger-hygiene-m7.test.js 中 mock pool 按 SQL 片段匹配 `INTERVAL '24 hours'` 的桩需随新 SQL 更新（测试语义不变），不得删除任何既有 it()。
8. **contract-gate**: cecelia 仓库，代码层 Contract Gate 照常执行（无跳过）。
