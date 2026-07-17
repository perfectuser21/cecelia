# Sprint PRD — 三修 canary-death-drill + canary-drill-scheduler（07170500）

**task_id**: f97f24dc-6779-43cb-b16d-229339f8c8f6
**sprint_dir**: sprints/07170500-canary-drill-repair
**base_repo**: /Users/administrator/perfect21/cecelia
**日期**: 2026-07-17
**前置**: A8-3（07161400-a8-3-canary-drill）已合并

---

## 背景与目标

A8-3 金丝雀故障注入演习（canary-death-drill）存在三类系统性缺陷，导致演习形同虚设：

1. **注入形态错误**：任务注册后停在 `queued`，relay-watchdog 在 L275 明确过滤 `queued`（只管 `in_progress`），导致 watchdog 永远不会处置注入的金丝雀任务，演习断言必然超时。

2. **断言闭环缺失**：处置未发生时脚本仍 `exit 0`，没有 `drill_report.verdict=FAIL` 记录，演习失败无感知。

3. **调度器路径静默失败**：`canary-drill-scheduler.js` 使用宿主机绝对路径 `path.resolve(__dirname, '../../../scripts/...')` 在容器内会 `ENOENT`，且 skip/fail 态无日志，静默丢弃。

---

## 现状诊断（Bug 复现路径）

### Bug-1：注入形态 queued → watchdog 不处置

- **现状**：`registerCanaryTask()` 注册任务后，任务状态为 `queued`（Brain 默认）
- **relay-watchdog 过滤**：`harness-relay-watchdog.js:275` — `if (task.status !== 'in_progress') continue;`
- **结论**：watchdog 不会处置 queued 任务，断言必然超时，演习永远 FAIL（但 exit 0 掩盖了它）

### Bug-2：断言失败 exit 0

- **现状**：`pollAssert` 超时后 `result = { pass: false, reason: '超时' }`，`archiveDrillResult` 写 `success: false`，然后走 `notifyDrillFailure`，**最终 `process.exit(1)`**
- **实际问题**：`drill_report` 记录不含结构化 `verdict` 字段，且 `notifyDrillFailure` 中 `barkFn === null`（未注入）时 warn 不发推送
- **注**：exit 1 路径存在，但 drill_report 内容不含 mode/断言明细/耗时的结构化字段

### Bug-3：调度器路径 ENOENT 静默

- **现状**：`canary-drill-scheduler.js:69` — `path.resolve(__dirname, '../../../scripts/canary-death-drill.mjs')`
- **容器内实际路径**：镜像打包后 `__dirname` 不再是宿主 `/workspace/packages/brain/src`，相对三级跳到达的路径不存在
- **静默**：`execFileAsync` 抛 `ENOENT`，被 `catch` 吞掉只 `console.error`，无 `[canary-drill] failed` 三态日志

---

## 不变量（Invariants）

继承 A8-1/A8-2/A8-3 全部 INV-01～INV-18（见 sprints/07161400-a8-3-canary-drill/sprint-prd.md），本 sprint 新增：

| ID | 描述 |
|----|------|
| **INV-19** | 注入形态三项必须同时满足：`status='in_progress'` + `initiative_runs` 行存在（`orchestrator_version='v2'`, `payload.orchestrator='skill-relay'`, `canary:true`）+ 按 mode 注入死信号；三项任一缺失即无效注入 |
| **INV-20** | 演习成功判定标准为 watchdog **真实修改了 `initiative_runs.phase`**（轮询 DB 状态），禁止以任务 `status='failed'` 作为 PASS 判据（这是 A8-3 的根本 bug）|
| **INV-21** | `drill_report` 写入 `design_docs` 后必须含 `verdict`（PASS/FAIL）、`mode`、`assertions`（数组，每条含 name/pass/detail）、`elapsed_ms` 四字段 |
| **INV-22** | 调度器脚本路径策略：优先 `process.env.CANARY_DRILL_SCRIPT`，次选 `/app/scripts/canary-death-drill.mjs`（容器内绝对路径），exec 前必须 `existsSync` 校验，失败打 `[canary-drill-scheduler] failed: script not found <path>` 并返回 `{triggered:false, failed:true}` |
| **INV-23** | 三态日志必须打印：`[canary-drill-scheduler] triggered` / `skipped reason=xxx` / `failed reason=xxx`，禁止静默失败（catch 块必须打日志并返回 `{triggered:false, failed:true}`，不得返回 `{triggered:true, error:...}`）|

---

## 必须先写 Failing Tests（TDD 铁律，Red → Green）

### FT-1：注入 queued 形态 → watchdog 判定函数不命中（复现）→ 改真形态后命中

**文件**：`packages/brain/src/__tests__/canary-drill-inject-form.test.js`（新建）

```
describe('FT-1: 注入形态验证', () => {
  it('A: queued + 无 initiative_runs 行 → watchdog resumeStalledRelayRuns 不调用 spawnFn（复现旧行为 Red）', async () => {
    // dbPool stub：initiative_runs 无行，tasks 返回 status='queued'
    // 断言：spawnFn 未被调用
  })
  it('B: in_progress + initiative_runs 行（orchestrator_version=v2, phase=running） → watchdog 调用 spawnFn 或触发处置', async () => {
    // dbPool stub：initiative_runs 有行，tasks 返回 status='in_progress', payload.orchestrator='skill-relay'
    // 断言：spawnFn 被调用（Green after fix）
  })
})
```

**关键点**：测试 A 验证 `harness-relay-watchdog.js:275` 的 `task.status !== 'in_progress'` 过滤条件，确认 queued 不被处置。测试 B 验证正确注入形态后 watchdog 能命中处置逻辑。

### FT-2：mock 处置未发生（轮询超时）→ 脚本 exit 1，drill_report.verdict=FAIL

**文件**：`tests/regression/a8-3-canary-drill/canary-drill-exit-code.test.js`（新建）

```
describe('FT-2: 断言闭环验证', () => {
  it('pollAssert timeoutMin=0 → result.pass=false → archiveDrillResult 含 verdict=FAIL → process.exit 1 (Red: 现版本 status=failed → pass=true 导致 exit 0)', async () => {
    // fetchStub 返回 task.status='in_progress', task.payload={} (watchdog 未处置)
    // timeoutMin=0 立即超时
    // 断言：archiveDrillResult 被调用，content.verdict='FAIL'
    // 断言：result.pass === false
  })
})
```

**关键点**：现版本 `runOomDrill` 的 `assertFn` 里 `if (task.status === 'failed') return { pass: true }` 是根本 bug，修复后此判据消失，超时必须返回 `pass: false`。

### FT-3：容器路径 ENOENT → 修复后有日志三态

**文件**：`packages/brain/src/__tests__/canary-drill-scheduler-path.test.js`（新建）

```
describe('FT-3: 调度器路径容错', () => {
  it('A: 注入不存在脚本路径 → 现版本返回 {triggered:true, error:ENOENT}（Red: 这是 bug）', async () => {
    // execFn 实际调 existsSync('/nonexistent') → false，或 throw ENOENT
    // 断言：返回值 triggered !== true（现版本返回 true = bug）
  })
  it('B: existsSync 校验后，不存在路径 → 返回 {triggered:false, failed:true}，console.error 含 script not found（Green after fix）', async () => {
    // 修复后：existsSync 失败 → 返回 {triggered:false, failed:true}
    // 断言：console.error 含 '[canary-drill-scheduler] failed'
  })
  it('C: CANARY_DRILL_SCRIPT 环境变量设置 → 使用该路径', async () => {
    process.env.CANARY_DRILL_SCRIPT = '/custom/path/drill.mjs'
    // 断言：execFn 调用参数为 /custom/path/drill.mjs
  })
})
```

---

## 功能需求（FR）

**A8-1/A8-2/A8-3 已有（不重新实现）：**  
FR-01～FR-14：classifyDeath / 处置器骨架 / 演习脚本骨架 / canary 隔离过滤 / Bark / 落档 / 调度器骨架

**本 sprint 修复（FR-15～FR-21）：**

| FR-ID | 文件 | 描述 |
|-------|------|------|
| **FR-15** | `scripts/canary-death-drill.mjs` | **真实死亡形态注入**：`registerCanaryTask()` 改为三步：① POST 注册任务 → ② PATCH `status=in_progress` + `payload.orchestrator=skill-relay` → ③ POST `initiative_runs`（`orchestrator_version='v2'`、`orchestrator_host='skill-relay-canary-drill'`、`canary:true`、`phase='running'`、`deadline_at=NOW()+30min`）→ ④ 按 mode 注入死信号 |
| **FR-16** | `scripts/canary-death-drill.mjs` | **OOM 死信号修正**：不 PATCH `status='failed'`，改为 PATCH `payload.last_container_exit_code=137`（watchdog 从 `task.payload.last_container_exit_code` 读），保持 `status='in_progress'`，让 watchdog 自行判定和处置 |
| **FR-17** | `scripts/canary-death-drill.mjs` | **kill9 死信号修正**：PATCH `payload.last_container_exit_code=137` + `payload.cause='unknown'`，保持 `status='in_progress'`（无容器无退出码形态）|
| **FR-18** | `scripts/canary-death-drill.mjs` | **interactive_stuck 死信号修正**：PATCH `payload.cause='interactive_stuck'`，保持 `status='in_progress'`；tmux 会话若 staging 不可用则标注 `[canary-drill] interactive_stuck: tmux N/A, payload-only injection` |
| **FR-19** | `scripts/canary-death-drill.mjs` | **断言闭环修正**：OOM/kill9 轮询判定改为查 `initiative_runs.phase` 或 `task.payload.oom_upgraded/attempt`；禁止以 `task.status='failed'` 作为 pass 判据；超时 → `verdict=FAIL`, `exit 1` |
| **FR-20** | `scripts/canary-death-drill.mjs` | **drill_report 字段补全**：`archiveDrillResult` body 含 `verdict`（PASS/FAIL）、`mode`、`assertions`（`[{name, pass, detail}]`）、`elapsed_ms` |
| **FR-21** | `packages/brain/src/canary-drill-scheduler.js` | **调度器路径 + 三态日志修复**：路径优先 `CANARY_DRILL_SCRIPT` env → `/app/scripts/canary-death-drill.mjs`；exec 前 `existsSync` 校验；catch 改返回 `{triggered:false, failed:true, error}`；三态日志必打 |

---

## 验收标准（DoD）

### 单元测试（必须全绿）

- [ ] FT-1（2条）、FT-2（1条）、FT-3（3条）共 6 条 failing tests 先 commit Red，修复后转 Green
- [ ] `canary-drill-scheduler.test.js` 原有 4 条全绿（不回归）
- [ ] `harness-relay-watchdog*.test.js` 全部通过（不回归）
- [ ] `canary-drill.contract.test.js` BEHAVIOR-4/5/6/7/8 全绿（含真实 import，不再用 TODO 占位）

### Staging 全链实弹（弱 oracle 禁入，必须贴原文）

- [ ] 运行 `STAGING_BRAIN_URL=http://localhost:5222 node scripts/canary-death-drill.mjs oom`
- [ ] **贴原文**：`curl localhost:5222/api/brain/design-docs?type=drill_report&limit=1` 响应（total >= 1，content 含 mode/verdict/assertions/elapsed_ms）
- [ ] **贴原文**：`grep '\[relay-watchdog\].*<canaryTaskId>' staging-brain.log`（watchdog 处置日志，含 initiative_id 和处置动作）
- [ ] 演习结果 `verdict=PASS` 且 exit 0；或 `verdict=FAIL` 且 exit 1（两种均可，关键是断言真实发生）
- [ ] **禁止**：仅凭 curl HTTP 200 判断演习成功（弱 oracle）

### CI

- [ ] FT-1/FT-2/FT-3 测试文件进入 `brain-ci.yml` 对应 job
- [ ] `tests/regression/a8-3-canary-drill/` 下新建测试进入 regression CI

---

## 实现顺序

```
Step 1: 写 FT-1/FT-2/FT-3 failing tests → commit Red（3个新文件）
Step 2: 修 scripts/canary-death-drill.mjs（FR-15～FR-20）
Step 3: 修 packages/brain/src/canary-drill-scheduler.js（FR-21）
Step 4: 更新 tests/regression/a8-3-canary-drill/canary-drill.contract.test.js（TODO 占位 → 真实 import）
Step 5: 跑单测全绿确认 → commit Green
Step 6: staging 实弹跑 oom mode
Step 7: 截取 drill_report 原文 + watchdog 处置日志原文 → 写入 PR 描述
```

---

## 关键文件路径

| 文件 | 角色 | 关键行 |
|------|------|--------|
| `/workspace/scripts/canary-death-drill.mjs` | 演习主脚本（注入 + 断言 + 落档）| L108 registerCanaryTask / L148 runOomDrill / L164-173 assertFn bug |
| `/workspace/packages/brain/src/canary-drill-scheduler.js` | Tick 调度器 | L69 相对路径 bug / L84-92 catch 块静默 bug |
| `/workspace/packages/brain/src/harness-relay-watchdog.js` | 被测 watchdog | L274-277 queued 过滤 / L240 initiative_runs SQL |
| `/workspace/packages/brain/src/harness-death-classifier.js` | 死因分类器（只读参考）| exitCode===137 → cause=oom |
| `/workspace/tests/regression/a8-3-canary-drill/canary-drill.contract.test.js` | 合同测试 | 需把 TODO 占位替换为真实 import |
| `/workspace/packages/brain/src/__tests__/canary-drill-scheduler.test.js` | 调度器单测 | 已有 4 条，本 sprint 新建独立文件 FT-3 |

---

## 风险与约束

- `initiative_runs` INSERT 需要 staging Brain 的对应端点（`POST /api/brain/initiative-runs`）可用；若端点不存在，改为直接向 staging DB 写行（通过 PSQL 或临时端点）
- `last_container_exit_code` 必须写入 `payload`（非 `result`），因为 relay-watchdog 从 `task.payload?.last_container_exit_code` 读取
- staging 实弹前须确认 staging Brain（:5222）已启动、relay-watchdog 循环在跑、DB schema 与 production 同步

---

## NFR

| 编号 | 描述 |
|------|------|
| N1 | staging 实弹演习 ≤15min 内完成（含注入+轮询+断言）|
| N2 | drill_report 必须含 mode/verdict/assertions/elapsed_ms 四字段 |
| N3 | 所有异常路径输出 `[canary-drill]` / `[canary-drill-scheduler]` 前缀日志，禁止静默失败 |
| N4 | FT-1/FT-2/FT-3 必须作为 regression 测试永久留在 CI（不可删除）|

---

<!-- 元数据 -->
journey_type: bugfix
target_environment: local_api
invariant_count: 23
fr_count: 21
