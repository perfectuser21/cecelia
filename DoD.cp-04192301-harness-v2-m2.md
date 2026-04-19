# DoD: Harness v2 M2 — Initiative Planner 重写 + DAG 调度

contract_branch: cp-04192301-harness-v2-m2
sprint_dir: (N/A — M2 本身不跑 harness pipeline)

---

## ARTIFACT 条目

- [x] [ARTIFACT] packages/brain/src/harness-dag.js 存在且导出 5 个函数
  - Test: `manual:node -e "const m=require('fs').readFileSync('packages/brain/src/harness-dag.js','utf8');if(!m.includes('export function parseTaskPlan')||!m.includes('export function detectCycle')||!m.includes('export function topologicalOrder')||!m.includes('export async function upsertTaskPlan')||!m.includes('export async function nextRunnableTask'))process.exit(1)"`

- [x] [ARTIFACT] packages/brain/src/harness-initiative-runner.js 存在且导出 runInitiative
  - Test: `manual:node -e "const m=require('fs').readFileSync('packages/brain/src/harness-initiative-runner.js','utf8');if(!m.includes('export async function runInitiative'))process.exit(1)"`

- [x] [ARTIFACT] packages/brain/src/executor.js 含 harness_initiative 分支
  - Test: `manual:node -e "const m=require('fs').readFileSync('packages/brain/src/executor.js','utf8');if(!m.includes(\"task.task_type === 'harness_initiative'\"))process.exit(1)"`

- [x] [ARTIFACT] 旧 harness_planner 路径保留（向后兼容）
  - Test: `manual:node -e "const m=require('fs').readFileSync('packages/brain/src/executor.js','utf8');if(!m.includes(\"task.task_type === 'harness_planner'\"))process.exit(1)"`

- [x] [ARTIFACT] harness-planner SKILL.md v6.0.0 含 task-plan.json 模板
  - Test: `manual:node -e "const m=require('fs').readFileSync('packages/workflows/skills/harness-planner/SKILL.md','utf8');if(!m.includes('task-plan.json')||!m.includes('6.0.0')||!m.includes('estimated_minutes'))process.exit(1)"`

- [x] [ARTIFACT] harness-dag 单元测试存在
  - Test: `manual:node -e "require('fs').accessSync('packages/brain/src/__tests__/harness-dag.test.js')"`

- [x] [ARTIFACT] initiative-runner 集成测试存在
  - Test: `manual:node -e "require('fs').accessSync('packages/brain/src/__tests__/integration/harness-initiative-runner.integration.test.js')"`

- [x] [ARTIFACT] brain 版本 bump 到 1.219.0
  - Test: `manual:node -e "const p=require('./packages/brain/package.json');if(p.version!=='1.219.0')process.exit(1)"`

## BEHAVIOR 条目

- [x] [BEHAVIOR] parseTaskPlan 接受合法 DAG 并返回对象
  - Test: `tests/harness-dag.test.js::接受合法线性 DAG`

- [x] [BEHAVIOR] parseTaskPlan 拒环依赖
  - Test: `tests/harness-dag.test.js::拒环依赖`

- [x] [BEHAVIOR] parseTaskPlan 拒自环
  - Test: `tests/harness-dag.test.js::拒自环`

- [x] [BEHAVIOR] parseTaskPlan 拒 >8 Task 硬上限
  - Test: `tests/harness-dag.test.js::拒 >8 tasks 硬上限`

- [x] [BEHAVIOR] parseTaskPlan 拒 >5 Task 但无 justification
  - Test: `tests/harness-dag.test.js::拒 >5 tasks 但无 justification`

- [x] [BEHAVIOR] parseTaskPlan 接受 Markdown code fence 包裹的 JSON
  - Test: `tests/harness-dag.test.js::接受 Markdown code fence 包裹的 JSON`

- [x] [BEHAVIOR] detectCycle 正确识别直接/间接环
  - Test: `tests/harness-dag.test.js::检测直接环 A→B→A`

- [x] [BEHAVIOR] topologicalOrder 按依赖顺序返回
  - Test: `tests/harness-dag.test.js::线性 DAG a→b→c 顺序执行 a,b,c`

- [x] [BEHAVIOR] runInitiative happy path 建 3 subtask + 1 contract + 1 run
  - Test: `tests/integration/harness-initiative-runner.integration.test.js::产出 3 subtask + 1 contract + 1 run，返回 success`

- [x] [BEHAVIOR] runInitiative Docker 失败时返回 error 且不写 DB
  - Test: `tests/integration/harness-initiative-runner.integration.test.js::Docker 失败时返回 error 且不写 DB`

- [x] [BEHAVIOR] runInitiative parseTaskPlan 失败时返回 error 且不写 DB
  - Test: `tests/integration/harness-initiative-runner.integration.test.js::task-plan.json 非法时返回 error 且不写 DB`

- [x] [BEHAVIOR] nextRunnableTask 按依赖顺序返回下一个可运行 Task
  - Test: `tests/integration/harness-initiative-runner.integration.test.js::nextRunnableTask 按依赖顺序返回`

## 实施清单（push 前全部 [x]）

- [x] 新建 `packages/brain/src/harness-dag.js`（5 个导出函数）
- [x] 新建 `packages/brain/src/harness-initiative-runner.js`
- [x] 改 `packages/brain/src/executor.js` 加 harness_initiative 分支
- [x] 改 `packages/workflows/skills/harness-planner/SKILL.md` → v6.0.0
- [x] 同步 `~/.claude-account{1,2}/skills/harness-planner/SKILL.md` + `~/.claude/skills/harness-planner/SKILL.md`
- [x] 新增 `packages/brain/src/__tests__/harness-dag.test.js`（27 单测 PASS）
- [x] 新增 `packages/brain/src/__tests__/integration/harness-initiative-runner.integration.test.js`（4 集成 PASS）
- [x] bump brain 1.218.0 → 1.219.0（package.json + lock + .brain-versions）
- [x] 本地 `npm --workspace packages/brain run test -- harness-dag` 27/27 通过
- [x] 本地 integration test 4/4 通过（真 PG）
