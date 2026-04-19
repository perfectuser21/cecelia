# Harness v2 M4 — Task 级循环 + Generator Fix 模式 + CI Gate + Evaluator 去 E2E

Status: APPROVED (autonomous Tier 1)
Date: 2026-04-20
Relates to: docs/design/harness-v2-prd.md §5.4/5.5/5.6/7.2 · PR #2439 (M1) · PR #2442 (M2) · PR #2445 (M3)

## 背景

Harness v2 已经完成：
- M1 #2439 — 数据模型（initiative_contracts / task_dependencies / initiative_runs，schema 236–239）
- M2 #2442 — Initiative Planner + task-plan.json + harness-dag.js / harness-initiative-runner.js
- M3 #2445 — GAN 合同 v2（Tasks 模板 + skeptical Reviewer + parseTasks）

M4 负责 PRD §3.1 的**阶段 B（Task 级循环）**：
* Generator 两种模式（新建 PR / Fix 同分支 commit）
* CI Gate 非 LLM 节点（轮询 GitHub Actions status）
* Evaluator 去 E2E，改为 Task 级对抗 QA
* 撤销 PR #2420 方向的 Workstream 循环

## 核心设计

### 1. Generator 两模式

`createDockerNodes.generator` 内部根据 `state.eval_round` 判断模式：

```js
const isFixMode = (state.eval_round || 0) > 0;
const prompt = isFixMode ? buildFixPrompt(state) : buildNewPrPrompt(state);
```

* **新建 PR 模式**（eval_round == 0）：checkout 新分支 `cp-<ts>-<task-slug>` → commit → push → `gh pr create` → 提取 `pr_url` + `pr_branch`
* **Fix 模式**（eval_round > 0）：checkout **同一个** `state.pr_branch` → 改代码 → commit → push → 输出 `commit_sha`（PR 号不变）
* **硬约束**：Fix 模式 Generator prompt 明确"永远不要在 Fix 模式开新 PR；同分支累积 commit"

撤销 #2420 方向的 `for (const wsIndex of targetIndexes)` 循环：Generator 单次执行一条 Task。

### 2. CI Gate 节点

新建 `packages/brain/src/harness-ci-gate.js`：

```js
export async function pollPRChecks(prUrl, opts = {}) {
  // 每 intervalMs (默认 30s) 跑 gh pr checks <prUrl> --json
  // 所有必需 check 为 SUCCESS → { status: 'PASS', checks }
  // 任一 check 为 FAILURE → { status: 'FAIL', failedCheck, logSnippet }
  //   logSnippet 通过 gh run view <runId> --log-failed 取
  // 超过 timeoutMs (默认 30min) → { status: 'TIMEOUT' }
}
```

在 `harness-graph.js` 中新增 `ci_gate` 节点，位于 `generator` 和 `evaluator` 之间：
* PASS → 推进到 `evaluator`
* FAIL → 回 `generator`，把 `logSnippet` 写入 `state.ci_feedback`
* TIMEOUT → 标 `verdict=FAIL`，进 report

`ci_gate` 不跑 Docker，是 Brain tick 层的普通 async 函数节点。

### 3. Evaluator 去 E2E

改 `~/.claude-account1/skills/harness-evaluator/SKILL.md`：
* 删除所有 "起 Brain 5222 / 前端 / 真实 PG" 指令（阶段 C 的事，M5 做）
* 改为 Task 级深度对抗 QA：
  - 跑 unit test（`npm test -- <path>`）
  - 跑 integration test（mock deps）
  - 深度对抗：空输入 / null / undefined / 超长字符串 / emoji / 不存在 ID / 已删除 ID / 权限不符 ID / 并发 Promise.all / 错误路径 / race condition
* **停止条件**：无上限、无软上限、不因"连续 N 轮无新 FAIL"终止。PASS 的唯一条件是所有验收标准全部通过 + 每条对抗 case 明确测过
* 产出写 `sprints/eval-task-<id>-round-<n>.md`

同步 SKILL.md 到 4 个位置：`~/.claude-account1`、`~/.claude-account2`、`~/.claude-account3`、`~/.claude`。

### 4. 图结构（不上 subgraph）

M4 不引入 LangGraph subgraph（M5 再评估）。图结构是线性 + 条件边：

```
planner → proposer ↔ reviewer → generator → ci_gate → evaluator → report
                                    ↑           ↓          ↓
                                    └───FAIL────┘          ↓
                                    ↑                      │
                                    └───FAIL───────────────┘
                                    
ci_gate PASS → evaluator
ci_gate FAIL → generator (eval_round += 1, Fix 模式)
evaluator PASS → report
evaluator FAIL → generator (eval_round += 1, Fix 模式)
```

Generator 通过 `state.eval_round` 自然表达"第几次进入"→ 判 Fix 模式。

### 5. HarnessState 字段变更

**删除**（撤销 #2420 方向）：
* `workstreams`
* `pr_urls`
* `pr_branches`
* `ws_verdicts`
* `ws_feedbacks`

**保留新增**（M4）：
* `pr_url` (string) — 唯一 PR URL
* `pr_branch` (string) — 唯一 PR 分支
* `commit_shas` (string[]) — Fix 模式累积的 commit
* `eval_round` (int) — 第几次进入 Generator（0 = 首次）
* `ci_feedback` (string) — CI FAIL 时的 log 片段
* `evaluator_feedback` (string) — Evaluator FAIL 时的反馈
* `ci_status` (enum: 'pending' | 'pass' | 'fail' | 'timeout')

`parseWorkstreams` 函数保留作 legacy fallback（兼容 v1 旧合同），但主流程走 M3 的 `parseTasks`。

### 6. 测试

* `packages/brain/src/__tests__/harness-ci-gate.test.js` — mock `execSync`/`gh` CLI 返回各种状态（PASS / FAIL / 部分 pending / TIMEOUT）
* `packages/brain/src/__tests__/harness-graph-v2-flow.test.js` — Generator `isFixMode` 分支、CI gate 路由（PASS → evaluator / FAIL → generator）单测

不写需要 PG 的 integration 测试（纯逻辑 + mock 已足够验证 M4 行为）。

## 不做的事（M5 再做）

* 不启动真 Brain 5222 / 真前端（阶段 C）
* 不做 harness-final-e2e.js
* 不做失败归因 + revert 策略
* 不做 Initiative 级 E2E 编排
* 不动 Docker executor

## DoD

- `[ARTIFACT] packages/brain/src/harness-ci-gate.js` 存在 + export pollPRChecks
- `[ARTIFACT] packages/brain/src/__tests__/harness-ci-gate.test.js` 存在
- `[ARTIFACT] packages/brain/src/__tests__/harness-graph-v2-flow.test.js` 存在
- `[BEHAVIOR] Generator 两模式分流` Test: `tests/harness-graph-v2-flow.test.js`
- `[BEHAVIOR] CI gate PASS/FAIL/TIMEOUT 三分支` Test: `tests/harness-ci-gate.test.js`
- `[BEHAVIOR] SKILL.md 同步 4 处 harness-generator/evaluator` Test: `manual:node -e "const fs=require('fs');['.claude-account1','.claude-account2','.claude-account3','.claude'].forEach(d=>{const p=require('os').homedir()+'/'+d+'/skills/harness-generator/SKILL.md';const c=fs.readFileSync(p,'utf8');if(!c.includes('Fix 模式'))process.exit(1);});"`
- `[BEHAVIOR] HarnessState 已删 workstreams 字段` Test: `manual:node -e "const c=require('fs').readFileSync('packages/brain/src/harness-graph.js','utf8');if(c.match(/workstreams:\s*Annotation/))process.exit(1);"`

## 风险

1. **SKILL.md 4 处同步一致性** — 人为差异风险。解决：commit 前 diff 四处全一致。
2. **ci_gate 在 Brain tick 中长时间阻塞（30min）** — 当前 Brain 调度是异步，轮询时 yield 控制权。pollPRChecks 内部用 setTimeout，不 block event loop。
3. **gh CLI 在 Docker 容器内可能不可用** — ci_gate 跑在 Brain 主进程（非 Docker 节点），Brain 宿主机已有 gh。

## 完成标志

CI 全绿 + PR auto-merge；随后可开 M5（Initiative 级 E2E）。
