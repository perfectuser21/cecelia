# Sprint PRD — 07170500 canary-drill-repair

**TASK_ID**: f97f24dc-6779-43cb-b16d-229339f8c8f6  
**Sprint**: sprints/07170500-canary-drill-repair  
**生成日期**: 2026-07-16  
**状态**: READY

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

## 不变量（Invariants）共 9 条

| # | ID | 描述 |
|---|-----|------|
| 1 | INV-CD-01 | 注入形态：任务注册后必须置 `status=in_progress`，`payload.orchestrator=skill-relay`，`payload.canary=true` |
| 2 | INV-CD-02 | initiative_runs 行：注入同时建 `initiative_runs`（`orchestrator_version=v2`，`payload.orchestrator=skill-relay`，`canary:true`），使 relay-watchdog 能扫到 |
| 3 | INV-CD-03 | OOM 死相：`payload.last_container_exit_code=137`（watchdog 读此字段做 OOM 判定），无容器/退出码字段时 kill9 模式标注明 N/A |
| 4 | INV-CD-04 | drill_report 结构：必须含 `verdict`（PASS/FAIL）、`mode`、`assertions`（数组，每条含 name/pass/detail）、`elapsed_ms` |
| 5 | INV-CD-05 | 断言超时：≤15min 未观察到处置 → `verdict=FAIL`，`exit 1`，Bark 推送 |
| 6 | INV-CD-06 | OOM 处置断言：watchdog 处置后 `oom_upgraded=true`（升档）或 `failure_reason=oom_wall`（撞墙），二选一视为 PASS |
| 7 | INV-CD-07 | kill9 处置断言：watchdog 重点火后 `attempt` 计数递增（`> 0`） |
| 8 | INV-CD-08 | 调度器日志三态：`[canary-drill] triggered`、`[canary-drill] skipped reason=xxx`、`[canary-drill] failed reason=xxx`，静默失败绝版 |
| 9 | INV-CD-09 | 调度器路径：使用环境变量 `CANARY_DRILL_SCRIPT` 或容器内绝对路径 `/app/scripts/canary-death-drill.mjs`，fallback 宿主路径仍保留 |

---

## Failing Tests（必须先写，红→绿）

### FT-1：queued 形态不被处置 → 改真形态后命中

**文件**：`tests/regression/a8-3-canary-drill/canary-drill.contract.test.js`（新增）

```
describe('FT-1: 注入形态验证', () => {
  it('queued 状态 → watchdog 判定函数返回 skip（复现旧行为）', ...)
  it('in_progress + initiative_runs 行 → watchdog 判定函数可处置（新形态）', ...)
})
```

**验证逻辑**：relay-watchdog `L275` 过滤条件 `task.status !== 'in_progress'` 对 queued → skip，对 in_progress → 继续处置流程。

### FT-2：处置未发生 → exit 1 且 drill_report.verdict=FAIL

**文件**：`tests/regression/a8-3-canary-drill/canary-drill.contract.test.js`（新增）

```
describe('FT-2: 断言闭环', () => {
  it('pollAssert 超时 → result.pass=false → archiveDrillResult verdict=FAIL → process.exit(1)', ...)
})
```

**验证逻辑**：mock `fetchFn` 让 pollAssert 始终返回 `pass: false`，断言 `archiveDrillResult` 被调用且 body 含 `verdict: 'FAIL'`，且主流程调用 `process.exit(1)`。

### FT-3：容器路径 ENOENT → 有日志不静默

**文件**：`packages/brain/src/__tests__/canary-drill-scheduler.test.js`（新增用例）

```
describe('FT-3: 调度器路径容错', () => {
  it('execFn 抛 ENOENT → 打印 [canary-drill] failed reason=ENOENT，不静默', ...)
  it('CANARY_DRILL_SCRIPT 环境变量存在 → 使用该路径，不走相对路径', ...)
})
```

---

## 功能需求（FR）共 12 条

| # | FR-ID | 文件 | 描述 |
|---|-------|------|------|
| 1 | FR-01 | `scripts/canary-death-drill.mjs` | `registerCanaryTask()` 注册后立即 PATCH `status=in_progress` |
| 2 | FR-02 | `scripts/canary-death-drill.mjs` | 注入时建 `initiative_runs` 行（POST `/api/brain/initiative-runs`），含 `orchestrator_version=v2`、`payload.orchestrator=skill-relay`、`canary:true` |
| 3 | FR-03 | `scripts/canary-death-drill.mjs` | OOM 模式：PATCH `payload.last_container_exit_code=137`（非 `result.exit_code`） |
| 4 | FR-04 | `scripts/canary-death-drill.mjs` | kill9 模式：PATCH `status=failed`，无 `exit_code` 无 `cause`（纯 unknown）；无容器/退出码时 payload 标注 `kill9_simulated: true` |
| 5 | FR-05 | `scripts/canary-death-drill.mjs` | interactive_stuck 模式：PATCH `payload.stdout_tail="Press enter to continue"`，tmux 会话可 mock 或标注 `N/A` |
| 6 | FR-06 | `scripts/canary-death-drill.mjs` | `archiveDrillResult` body 新增 `verdict`、`assertions`（数组）、`elapsed_ms` 字段 |
| 7 | FR-07 | `scripts/canary-death-drill.mjs` | OOM 断言：轮询到 `payload.oom_upgraded=true` OR `initiative_runs.failure_reason=oom_wall` → PASS |
| 8 | FR-08 | `scripts/canary-death-drill.mjs` | kill9 断言：轮询到 `payload.attempt > 0`（watchdog 重点火写回） → PASS |
| 9 | FR-09 | `scripts/canary-death-drill.mjs` | 超时 FAIL：`elapsed_ms` > `TIMEOUT_MIN * 60000` → `verdict=FAIL`，`exit 1`，Bark |
| 10 | FR-10 | `packages/brain/src/canary-drill-scheduler.js` | 路径优先级：`process.env.CANARY_DRILL_SCRIPT` > `/app/scripts/canary-death-drill.mjs` > 相对路径（fallback） |
| 11 | FR-11 | `packages/brain/src/canary-drill-scheduler.js` | 三态日志：triggered/skipped/failed 必须打印，error 时 `[canary-drill] failed reason=<msg>` |
| 12 | FR-12 | `packages/brain/src/canary-drill-scheduler.js` | failed 态：catch 后 return `{ triggered: true, failed: true, error: e.message }`，不静默吞掉 |

---

## 验收标准（DoD）

### 单元测试（必须全绿）

- [ ] FT-1、FT-2、FT-3 三条 failing tests 由红转绿
- [ ] `canary-drill-scheduler.test.js` 原有 4 条全绿
- [ ] `canary-drill.contract.test.js` BEHAVIOR-4/5/6/7/8 全绿（含真实 import，不再用占位 mock）

### Staging 全链实弹（弱 oracle 禁入）

- [ ] 运行 `STAGING_BRAIN_URL=http://localhost:5222 node scripts/canary-death-drill.mjs oom`
- [ ] 轮询期间可观察到 watchdog 日志：`[relay-watchdog] resume_oom_upgraded initiative=<id>`
- [ ] 演习完成后 `drill_report` 原文（`curl localhost:5222/api/brain/design-docs?type=drill_report&limit=1`）贴入 PR 描述
- [ ] watchdog 处置日志原文贴入 PR 描述（不许只 `curl` 一个 OK 断言通过）
- [ ] 演习结果 `verdict=PASS`，`exit 0`

### CI

- [ ] `packages/brain/src/__tests__/canary-drill-scheduler.test.js` 进入 `brain-ci.yml`
- [ ] `tests/regression/a8-3-canary-drill/canary-drill.contract.test.js` 进入 regression CI

---

## 实现顺序

```
Step 1: 写 FT-1/FT-2/FT-3 failing tests（红）
Step 2: 修 canary-death-drill.mjs（FR-01~09）
Step 3: 修 canary-drill-scheduler.js（FR-10~12）
Step 4: 跑单测确认全绿
Step 5: staging 实弹演习 oom mode
Step 6: 贴 drill_report 原文 + watchdog 日志原文进 PR
```

---

## 关键文件路径

| 文件 | 角色 |
|------|------|
| `/workspace/scripts/canary-death-drill.mjs` | 演习主脚本（注入 + 断言 + 落档） |
| `/workspace/packages/brain/src/canary-drill-scheduler.js` | Tick 调度器（路径 + 日志） |
| `/workspace/packages/brain/src/harness-relay-watchdog.js` | 被测 watchdog（L275 queued 过滤，L526 last_container_exit_code，L527 oom_upgraded） |
| `/workspace/packages/brain/src/harness-death-classifier.js` | 死因分类器（`exitCode===137 → cause=oom`） |
| `/workspace/tests/regression/a8-3-canary-drill/canary-drill.contract.test.js` | 合同测试（需升级为真实 import） |
| `/workspace/packages/brain/src/__tests__/canary-drill-scheduler.test.js` | 调度器单测（需新增 FT-3） |

---

## 风险与约束

- `initiative_runs` 建行需要 staging Brain 的 `/api/brain/initiative-runs` 端点存在；若不存在，需通过直接 PATCH task.payload 模拟 watchdog 扫描条件
- `last_container_exit_code` 必须写入 `payload`（非 `result`），因为 relay-watchdog L526 从 `task.payload?.last_container_exit_code` 读取
- Staging 实弹前须确认 staging Brain（:5222）已启动且 relay-watchdog 循环在跑

---

## NFR

- **N1**: staging 实弹演习 ≤15min 内完成（含注入+轮询+断言）
- **N2**: drill_report 必须包含 mode/verdict/assertions/elapsed_ms 四字段
- **N3**: 所有异常路径必须输出 `[canary-drill]` 前缀日志，禁止静默失败

---

<!-- 元数据字段（下游阶段依赖） -->
journey_type: bugfix
target_environment: local_api
