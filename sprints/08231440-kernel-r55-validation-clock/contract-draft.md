# Sprint Contract Draft (Round 1)

**Sprint**: kernel validation clock 按 fix 轮自动顺延（有界）——长跑 run 不再被固定窗口误杀 [r55]
**journey_type**: autonomous
**target_environment**: local_api（postgres:false — 本 attempt 无真库；改动为纯函数选点逻辑，用 vitest 真 import 被改模块 `validation-clock.js` 逐字锁定顺延语义，无 mock）
**contract-gate**: present（cecelia worktree，走代码层 Contract Gate + skill 内置规则）
**map**: `[MAP_NOT_CONFIGURED]` — payload.map_scope 未含 map_repo，radius 无法解析，must_run_assertions 为空，不回退领域硬编码。
**gp-anchor**: skipped (product-map.json not found)

## 锚定父路声明

独立小路（无父路）—— journey e6f803f2 下 ability 均 status=planned，step_id=none（PrepPRD 未锚定，见 sprint-prd `## step_id: none`）。本 sprint 为 harness kernel 单点机制债修复（validation clock 顺延），不推进具体业务 GP。

---

## Response Schema（推导来源: PRD 字面）

N/A — 任务无 HTTP 响应。本 sprint 改动为 `packages/brain/src/orchestrator/validation-clock.js` 的纯函数 `resolveValidationClock({action, decisionLog, intentAt, timeoutSeconds, allowEvaluatorOrigin})` 的**原点选点逻辑**，返回 `{pipeline_started_at, deadline_at}`（既有内部对象，非对外 endpoint）。Reviewer 第 6 维按下方 Test Contract / BEHAVIOR 的可执行断言完整性审查。

---

## Golden Path

覆盖父路：独立小路（无父路）。

[长跑 run 进入多轮 fix] → [每次 spawn:generator-fix 派发成功即以最新 generator 系 spawn 为新原点重设时钟] → [管线健康推进时不被固定窗口误杀；顺延达上限（6 次）后到期照常判死]

### Step 1: run 进入 fix 循环，时钟以最新 generator 系 spawn 为新原点重新起算
**来源**: `[FROM_PRD]` — sprint-prd「Golden Path」第 1-2 条 + thin_prd 要求 #1（「以最新的 generator 系 spawn 行为新原点重新起算 timeout_seconds，而不是永远锚定首个 generator」）。

**可观测行为**: `decisionLog` 中存在 N 轮 `spawn:generator-fix`（N≥1）时，`resolveValidationClock` 不再锚定 hop 最小的首个 generator，而是以「最新的 generator 系 spawn」（GENERATOR_ACTIONS = `spawn:generator` + `spawn:generator-fix` 中 hop 最大者，受下方上限约束）的 spawn 时刻（该行 `created_at`）为 `pipeline_started_at`，`deadline_at = created_at + timeout_seconds`。两轮 fix 后原以 T0 起算的窗口被顺延到第 2 轮 fix 的时刻（r50 复刻：原窗口耗尽但管线仍推进 → 存活）。

**验证命令**:
```bash
npx vitest run sprints/08231440-kernel-r55-validation-clock/tests/step3-validation-clock-fix-round-slide.test.js \
  -t "两轮 fix 后时钟顺延至最新 generator-fix 存活" 2>&1 | grep -qE "[1-9][0-9]* passed"
```
**硬阈值**: 2 轮 fix（首 generator `created_at=T0`，fix#1=T0+1h，fix#2=T0+2h，timeout=5400s）时，`pipeline_started_at == T0+2h` 且 `deadline_at == T0+2h+5400s`，且 `deadline_at != T0+5400s`（旧窗口已被甩开）。

---

### Step 2: 顺延「重新起算」——以最新 fix 行 spawn 时刻为准，不复用其陈旧 persisted 时钟
**来源**: `[FROM_PRD]` — thin_prd 要求 #1「**重新起算** timeout_seconds」+ sprint-prd「可观测结果」（新 deadline_at 顺延）。「重新起算」= 以最新 generator 系 spawn 的 spawn 时刻为新原点重算 deadline，而非沿用行内被首窗污染的旧时钟。

**可观测行为**: 生产实况下 buggy 代码把首窗 T0 时钟 persist 进每个 decision 行的 `detail`（`pipeline_started_at`/`deadline_at`）。顺延必须忽略最新 fix 行 `detail` 里陈旧的首窗 `deadline_at`，以该行 `created_at` 重新起算——否则「选了新行仍读旧 persisted 时钟」= 假绿（顺延无效）。

**验证命令**:
```bash
npx vitest run sprints/08231440-kernel-r55-validation-clock/tests/step3-validation-clock-fix-round-slide.test.js \
  -t "顺延重新起算" 2>&1 | grep -qE "[1-9][0-9]* passed"
```
**硬阈值**: 最新 fix 行 `detail={pipeline_started_at:T0, deadline_at:T0+5400s}`（陈旧首窗）但 `created_at=T0+2h` 时，`deadline_at == T0+2h+5400s`（以 spawn 时刻重算），`deadline_at != T0+5400s`（不回落陈旧首窗）。

---

### Step 3: 顺延有界——超过上限（6 次）后锚定第 6 次 fix 不再前移，到期照常判死
**来源**: `[FROM_PRD]` — thin_prd 要求 #2（「顺延必须有界：每 run 顺延次数上限（建议 6 次）……超过上限不再顺延，到期照常判死——防无限续命」）+ sprint-prd「边界情况/顺延超上限」+ ASSUMPTION（上限 6，与 fix 收敛探测器边界一致）。

**可观测行为**: `spawn:generator-fix` 累计超过 6 次时，顺延次数封顶 6：原点锚定第 6 轮 fix（generator 系 spawn 按 hop 升序的第 `min(fixCount, 6)` 个），第 7 轮及以后不再顺延；`deadline_at` 停在第 6 轮 fix + timeout，不前移到第 7 轮——管线仍红则到期照常被 validation_clock 判死。

**验证命令**:
```bash
npx vitest run sprints/08231440-kernel-r55-validation-clock/tests/step3-validation-clock-fix-round-slide.test.js \
  -t "超过 6 次上限后锚定第 6 次 fix 不再前移" 2>&1 | grep -qE "[1-9][0-9]* passed"
```
**硬阈值**: 7 轮 fix（fix#i `created_at=T0+i·1h`）时，`pipeline_started_at == T0+6h`（第 6 轮）且 `deadline_at == T0+6h+5400s`，且 `deadline_at != T0+7h+5400s`（不顺延到第 7 轮，防无限续命）。

---

### Step 4（边界不变量）: 无 fix 轮时窗口语义不变，仍锚定首个 generator
**来源**: `[FROM_PRD]` — sprint-prd「边界情况/无 fix 轮」（「run 只有首个 spawn:generator，无 spawn:generator-fix → 窗口语义不变，仍以首 generator 为原点」）+ Invariant `validation-clock-fail-closed`（下游角色无 clock 仍 fail-closed）。

**可观测行为**: `decisionLog` 只有首 `spawn:generator`（携带 persisted 首窗时钟）、无 `spawn:generator-fix` → 顺延次数 0 → 复用首 generator 的 persisted clock，语义与本 sprint 前完全一致（含既有 fail-closed / verified-existing-PR evaluator origin / malformed throw 三条语义不回退，由 repo 既有 `validation-clock.test.js` 全绿守卫）。

**验证命令**:
```bash
npx vitest run sprints/08231440-kernel-r55-validation-clock/tests/step3-validation-clock-fix-round-slide.test.js \
  -t "无 fix 轮时窗口语义不变" 2>&1 | grep -qE "[1-9][0-9]* passed"
# repo 既有 validation-clock 单测（fail-closed / evaluator-origin / malformed）语义不回退
( cd packages/brain && npx vitest run --no-cache ./src/orchestrator/__tests__/validation-clock.test.js ) 2>&1 | grep -qE "[1-9][0-9]* passed"
```
**硬阈值**: 无 fix 行时返回首 generator 的 persisted clock（`{pipeline_started_at:T0, deadline_at:T0+5400s}`）；repo 既有 `validation-clock.test.js` 全绿（0 failed）。

---

### Step 5（不变量）: 纯函数可重放——同一 decisionLog 两次调用结果一致
**来源**: `[FROM_PRD]` — thin_prd 要求 #3（「纯函数可重放：顺延判定只依赖 orchestrator_decision_log 行（hop 时序），禁 Date.now 之外的墙钟状态」）+ sprint-prd「边界情况/可重放」。

**可观测行为**: 顺延判定只读 `decisionLog` 行（`action`/`hop`/`created_at`/`detail`），不引入 `intentAt` 外的墙钟态；同一 `decisionLog` 传不同 `intentAt` 两次调用，返回时钟对象逐字相等。

**验证命令**:
```bash
npx vitest run sprints/08231440-kernel-r55-validation-clock/tests/step3-validation-clock-fix-round-slide.test.js \
  -t "纯函数可重放" 2>&1 | grep -qE "[1-9][0-9]* passed"
```
**硬阈值**: 同一 3 轮 fix 的 `decisionLog`、不同 `intentAt` 两次调用返回对象 `toEqual`（deep 相等）。

---

## 已知约束（来自回归测试 + 累积 FR）

- [packages/brain/src/orchestrator/__tests__/validation-clock.test.js] — 既有 8 条 it() 锁定：①首 generator 起单一共享窗口 ②下游角色复用 persisted clock ③pre-fix in-flight 从首 generator `created_at` 恢复 ④下游无 clock → `throw 'validation_clock_required'`（fail-closed）⑤verified-existing-PR evaluator 起窗 + judge 复用 ⑥persisted clock malformed → `throw 'validation_clock_invalid'` ⑦authoring 角色返回 null。**本 sprint 只改「多 generator 系 spawn 时选哪一行为原点」，以上语义（尤其 ④⑤⑥ fail-closed 系）不得回退**——由 DoD B-06 承载全绿核对。
- [累积FR] 本 line（journey e6f803f2）暂无历史已验收行为（sprint-prd「累积 FR/本 line 暂无历史」）；context-manifest: not queried（postgres:false，Brain API 本 attempt 不可依赖）。
- [MAP_NOT_CONFIGURED] must_run_assertions 为空（map_repo 缺失），无额外回归约束注入。
- [永久回归归属] 本 sprint 冻结测试将由 generator 在实现（绿）阶段提升为永久 F1 守卫 `tests/gp/f1/step3-validation-clock-fix-round-slide.test.js`（sprint-prd「预期受影响文件」+ 硬规则 #20：failing test 修复后永久留在 CI）。tests/gp/f1/ 属 repo 既有守卫目录（CI 照管），不作为封印 Test Contract 表行（避免 seal 的 readRepoFile 脆弱路径）。

---

## 八要素需求规范

| 要素 | 说明 | 本次答案 |
|------|------|----------|
| **FR（做什么）** | 功能需求 | `resolveValidationClock` 在存在 `spawn:generator-fix` 时，以最新 generator 系 spawn 的 `created_at` 为新原点重算 pipeline 窗口（顺延），而非永远锚定首个 generator |
| **NFR（做得多好）** | 非功能 | timeout_seconds 默认 5400s 不变；顺延上限每 run 6 次；纯函数无副作用、可重放（只读 decisionLog 行） |
| **Invariant（永不违反）** | 不变量 | ①无 fix 轮时窗口语义不变（锚定首 generator）②既有 fail-closed（下游无 clock throw required）/ verified-existing-PR evaluator origin / malformed throw 语义不回退 ③顺延有界（≤6），到期照常判死不无限续命 ④只依赖 decisionLog（hop 时序），禁 Date.now 外墙钟态 |
| **判定点（怎么知道）** | 模糊现实判断 | 见下方登记表 |
| **保质期（何时过期）** | 失效 | pipeline 窗口保质期 = 最新 generator 系 spawn + timeout_seconds（顺延后自然延长，上限 6 次）；超上限窗口即到期退役，不再人工 psql 续命 |
| **死亡告警（停了谁知道）** | 告警 | 沿用现有 validation_clock 到期判死路径（orchestrator 既有 decision）；本改动降低误判死误触发，不新增告警通道（N/A 新告警） |
| **失败语义（挂了怎么办）** | 故障 | 见下方失败语义声明 |
| **效果确认（已发≠已生效）** | 回执 | 效果由冻结测试断言 `resolveValidationClock` 对构造 decisionLog 返回的 `{pipeline_started_at, deadline_at}` 逐字确认；真库 orchestrator_decision_log 上的运行时窗口比较属接缝（见未覆盖真实链路清单） |

### 判定点登记表（对模糊现实的判断假设 — decisions e035dad8）

| 判定点 | 候选方法 | 所选方法 | 依据 | 误判后果 |
|--------|----------|----------|------|----------|
| （示例：微信群是否发送成功） | A. 监听按钮变灰; B. 读取聊天记录 API | A. 监听按钮变灰 | 聊天记录 API 不稳定 | 静默丢消息，用户不知 |
| 「最新 generator 系 spawn」如何识别 | A. GENERATOR_ACTIONS（spawn:generator+spawn:generator-fix）按 hop 升序取最大; B. 按 created_at 取最大 | A. hop 升序取最大（受上限截断到第 min(fixCount,6) 个） | hop 是 decision_log 单调派发时序（可重放，禁墙钟）；created_at 可能因写入抖动倒挂 | 若用 created_at 排序，时钟受写库抖动影响不可重放（违反纯函数铁律） |
| 顺延「原点时刻」取该行哪个字段 | A. 该行 created_at（spawn 时刻）重新起算; B. 复用该行 detail.persisted deadline | A. created_at 重新起算 | thin_prd「重新起算 timeout_seconds」；生产 fix 行 detail 被首窗污染，复用即顺延无效 | 若复用 persisted，选了新行也拿旧窗口 → 顺延假绿，长跑 run 仍被误杀 |
| ⚠️ 顺延上限取值 | A. 6 次（与 fix 收敛探测器边界一致）; B. 其他值 | A. 6 次 | thin_prd 建议 6 且与 fix 收敛探测器边界对齐（sprint-prd ASSUMPTION） | 上限过大 → 近似无限续命（防不住失控 run）；过小 → 正常多轮 fix 仍被误杀。judgment-pending-user: 顺延上限 6（PrepPRD 建议值，未经主理人显式拍板；若后续实测需调整以此为准） |

> ⚠️ 行说明：顺延上限 6 属「建议值」（thin_prd/ASSUMPTION），未经主理人显式拍板，按 e035dad8 第②条在 notes 标注待确认；误判后果为「续命过宽/过窄」（可回退调参，非不可逆/直接面客）。

### 失败语义声明

| 场景 | 失败行为 | 重试幂等？ | 降级策略 |
|------|----------|-----------|----------|
| 下游角色（evaluator/judge）decisionLog 无任何 generator 系 origin | `throw 'validation_clock_required'`（既有 fail-closed，不变） | 是（纯读幂等） | 保持 fail-closed，不伪造 Generator intent |
| 最新 generator 系 spawn 行 persisted clock malformed（如 deadline_at 非法且该行为 origin） | 既有 `throw 'validation_clock_invalid'` 语义在「不顺延路径」保持不变；顺延路径以 created_at 重算不读该行陈旧 deadline | 是（纯读幂等） | 不吞错，向上抛既有异常 |
| 顺延次数超上限（>6） | 不再顺延，锚定第 6 轮 fix，窗口到期照常判死 | 是（纯函数可重放） | 有界续命，防无限拖延 |

### 输入对抗面

N/A — 本改动为 Brain 内部 orchestrator 纯函数，输入 `decisionLog` 由 kernel 自身 append 的 orchestrator_decision_log 行构成，无对外暴露 agent 输入面（无 prompt injection / 越权指令面）。

---

## 禁 mock 边清单

本单改动触及 **状态机 / 生命周期钩子**（validation clock 判死是 run 生命周期的终止判定）与 **纯函数选点逻辑读 orchestrator_decision_log 行**。

- 代码 ↔ `resolveValidationClock`（被改的函数本身）：冻结测试必须**真 import** `packages/brain/src/orchestrator/validation-clock.js` 的 `resolveValidationClock`，**禁止 `vi.mock`/stub** 该函数或其内部 `persistedClock`/`exactClock`。
- `resolveValidationClock` ↔ decisionLog（被改的数据边）：顺延判定读的 `decisionLog` 行**用真实构造的 plain object 数组**喂入（模拟 orchestrator_decision_log 真实行 shape：`action`/`hop`/`created_at`/`detail`），**禁止 mock 掉「读 decisionLog 得出原点」这条边**——正是本单改的边。

**执行说明（诚实登记）**：本 attempt `runtime_resources.postgres=false`，`resolveValidationClock` 是**不碰 DB 的纯函数**（decisionLog 由调用方 loop.js 从库读出后传入），因此真 import + 真实行数组即完整覆盖被改的边，无需真库。真 Postgres 上 orchestrator_decision_log 行的实际 append 时序与 loop.js:1528 调用点的集成（`observed.decisionLog` 装载 → 顺延 deadline 落 detail → 下游读回）属接缝，登记进「## 未覆盖真实链路清单」。

---

## 未覆盖真实链路清单

| 真实链路点 | 为什么被 mock 顶替 | 真验证补位计划（谁/何时/什么环境） |
|-----------|-------------------|-----------------------------------|
| loop.js:1528 集成：真 Postgres 上 `observed.decisionLog` 装载真实 orchestrator_decision_log 行 → 顺延后的 `deadline_at` 写回 detail → 下游 hop 读回该顺延窗口 | 本 attempt postgres=false，无真库；且 `resolveValidationClock` 是纯函数，被改的选点逻辑用真实行数组已逐字锁定，集成边（loop.js 读写库）不在本单 scope（sprint-prd「不在范围内」不动人审 deadline / 只改选点） | Commander/evaluator 在带 Postgres 的 brain-integration 环境造多轮 spawn:generator-fix 的 orchestrator_decision_log 真实行，实跑 loop.js 一 hop，断言写回 detail 的 deadline_at 已顺延；本合同已把该断言以自然语言写入本清单供带库时通电 |

> 本清单存在未真验项：真库 loop.js 集成的**运行时**顺延写回标 `logic-done-pending`；纯函数选点逻辑（本单唯一改动）由冻结测试真 import 真验为 done。

---

## Invariant 覆盖映射（PRD 铁律 → 可执行断言）

- INV-1 [无 fix 轮语义不变]：由 BEHAVIOR B-04（冻结测试「无 fix 轮时窗口语义不变」）覆盖。
- INV-2 [fail-closed / evaluator-origin / malformed 语义不回退]：由 BEHAVIOR B-06（repo 既有 `validation-clock.test.js` 全绿，含 `validation_clock_required` / verified-existing-PR evaluator origin / `validation_clock_invalid` 三语义）覆盖。铁律 `validation-clock-fail-closed` 逐条锚定于此。
- INV-3 [顺延有界防无限续命]：由 BEHAVIOR B-03（超 6 次上限锚定第 6 次不前移）覆盖。
- INV-4 [纯函数可重放 / 禁 Date.now 外墙钟]：由 BEHAVIOR B-05（同一 decisionLog 两次调用结果一致）覆盖。

---

## 探索提示（L3 探索层 — evaluator 剧本全过后执行）

探索预算: 10 分钟 / 15 动作（默认；本 sprint 为单纯函数选点逻辑低风险改动）
高风险面:
- 错输入: `decisionLog` 传乱序 hop（fix 行 hop 小于首 generator）、重复 hop、缺 created_at 的 generator 系行 — 断言排序稳定、缺 created_at 走既有 persistedClock throw/回退，不产出非法时钟。
- 重复提交: 同一 decisionLog 连续多次调用 — 纯函数幂等，返回逐字一致（B-05 已锚）。
- 中途中断: fixCount 恰为 6 / 恰为 7 边界 — 6 时锚第 6 轮、7 时仍锚第 6 轮（上限内含），不 off-by-one 顺延到第 7 轮。
- 边界值: 0 轮 fix（无 fix，锚首 generator）/ 1 轮 fix（顺延到第 1 轮）/ 恰 6 轮（顶格顺延）/ >6 轮（封顶）。
发现分级: P0/P1（长跑 run 仍被误杀 / 顺延无上限无限续命 / fail-closed 语义回退）→ 阻塞 merge；P2/P3（措辞/日志）→ 记 findings 不阻塞

---

## E2E 验收（final-e2e 跑 — target_environment=local_api）

**journey_type**: autonomous
**target_environment**: local_api（postgres:false → vitest 单测；真库 loop.js 集成见未覆盖真实链路清单）

> 说明：本 attempt 无真库，E2E 以 vitest 跑冻结 sprint 测试（顺延核心 5 断言）+ repo 既有 `validation-clock.test.js` 全套（fail-closed / evaluator-origin / malformed 语义守卫，在 evaluate 时对 generator 产出真跑）。
> vitest 工作目录死规则：sprints/** 从仓库根跑；packages/brain/src/** 用子 shell 切进包根跑（包自身 vitest 配置）。
> `-t` 过滤下断言统一用 `grep -qE "[1-9][0-9]* passed"` 宽松式（禁精确 `(N)` 尾缀）；另加 `[0-9]+ failed` 负向闸，堵「N failed | M passed」时误判绿。

```bash
#!/bin/bash
set -euo pipefail

# 1. 冻结 sprint 测试（顺延核心 5 断言）从仓库根跑（sprints/** 命中根 vitest include）
OUT1=$(npx vitest run sprints/08231440-kernel-r55-validation-clock/tests/step3-validation-clock-fix-round-slide.test.js 2>&1) || true
echo "$OUT1" | grep -qE "[1-9][0-9]* passed" || { echo "FAIL: 冻结 sprint 测试未见 passed"; echo "$OUT1" | tail -20; exit 1; }
echo "$OUT1" | grep -qE "[0-9]+ failed" && { echo "FAIL: 冻结 sprint 测试存在未通过项"; echo "$OUT1" | tail -20; exit 1; } || true

# 2. repo 既有 validation-clock 单测（fail-closed / verified-existing-PR evaluator origin / malformed throw 语义不回退）用包自身 vitest 配置
OUT2=$( (cd packages/brain && npx vitest run --no-cache ./src/orchestrator/__tests__/validation-clock.test.js) 2>&1 ) || true
echo "$OUT2" | grep -qE "[1-9][0-9]* passed" || { echo "FAIL: repo validation-clock 单测未见 passed"; echo "$OUT2" | tail -20; exit 1; }
echo "$OUT2" | grep -qE "[0-9]+ failed" && { echo "FAIL: repo validation-clock 单测存在未通过项"; echo "$OUT2" | tail -20; exit 1; } || true

echo "OK: validation clock 按 fix 轮顺延（有界）E2E 验证通过"
```

---

## Test Contract

**表规则**：本表**仅登记 artifacts 冻结 sprint 测试行**（唯一行，已落盘并进 commit）。repo 既有 `validation-clock.test.js` 回归**不作为本表行**（避免 seal 对非 `sprints/` 前缀行走 readRepoFile 的脆弱路径），其覆盖由 DoD B-06 的 manual: 命令承载，evaluate 时对 generator 产出真跑。永久 F1 守卫 `tests/gp/f1/step3-validation-clock-fix-round-slide.test.js` 由 generator 绿阶段提升，属 repo 既有守卫目录（CI 照管），亦不入本表。

| 功能 | Test File | BEHAVIOR 覆盖（it() 名子串）| 预期红证据 |
|---|---|---|---|
| validation clock 按 fix 轮顺延（有界，冻结，强制） | `sprints/08231440-kernel-r55-validation-clock/tests/step3-validation-clock-fix-round-slide.test.js` | `两轮 fix 后时钟顺延至最新 generator-fix 存活` / `顺延重新起算` / `超过 6 次上限后锚定第 6 次 fix 不再前移` / `无 fix 轮时窗口语义不变` / `纯函数可重放` | 5 tests → 3 failed \| 2 passed（前 3 条对当前「永远锚定首 generator」实现 RED；后 2 条为不变量/可重放守卫 RED/GREEN 均绿。本地实跑复现 `Tests 3 failed | 2 passed (5)`） |

> Test File 列为完整真实路径（无省略号）。BEHAVIOR 覆盖名逐词取自该测试文件真实 `it()` 名（`grep -F '<覆盖名>' <test file>` 必命中；seal/CI 双向子串校验命中）。
> repo 既有 `validation-clock.test.js`（fail-closed / evaluator-origin / malformed 守卫）覆盖由 DoD B-06 承载，evaluate 时 `cd packages/brain && npx vitest run ./src/orchestrator/__tests__/validation-clock.test.js` 真跑核对，不回退。
