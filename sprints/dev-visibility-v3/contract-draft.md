# Sprint Contract Draft (Round 2)

## Sprint PRD 来源
`sprints/dev-visibility-v3/sprint-prd.md`
**journey_type**: autonomous
**target_environment**: local_api

---

## Golden Path

[DB migration 加列] → [notion-push-sync 新增两函数] → [runNotionPushSync 调用新函数] → [buildGeneratorPrompt 注入 prdContent] → [runSubTaskNode 传递 prdContent] → [dev SKILL.md 加 Route B 步骤] → [harness-generator SKILL.md Step 0.5 改串行]

---

### Step 1: DB migration — `decisions` 和 `initiative_contracts` 表加 `notion_synced_at` 列

**来源**: `[FROM_PRD]` — PRD"范围限定"段明确："DB migration：`decisions` 和 `initiative_contracts` 表加 `notion_synced_at timestamptz`"

**可观测行为**: 最新 migration 文件含 `ALTER TABLE decisions ADD COLUMN IF NOT EXISTS notion_synced_at` 和 `ALTER TABLE initiative_contracts ADD COLUMN IF NOT EXISTS notion_synced_at`；`packages/brain/migrations/` 目录里能找到此文件。

**验证命令**:
```bash
node -e "
const fs=require('fs'),p=require('path');
const dir='packages/brain/migrations';
const files=fs.readdirSync(dir).filter(f=>f.endsWith('.sql'));
const found=files.some(f=>{
  const c=fs.readFileSync(p.join(dir,f),'utf8');
  return c.includes('decisions') && c.includes('notion_synced_at') && c.includes('initiative_contracts');
});
if(!found){console.error('FAIL: migration 未同时覆盖两张表');process.exit(1);}
console.log('OK');
"
```

**硬阈值**: node 命令 exit 0，两张表均在同一 migration 文件中被覆盖

---

### Step 2: `pushDecisions()` 实现 — 未同步行推 Notion，更新 `notion_synced_at`

**来源**: `[FROM_PRD]` — PRD Golden Path WS1："新增 `pushDecisions()` + `pushInitiativeContracts()` 把两张表的未同步行推到 Notion，更新 `notion_synced_at`"

**可观测行为**: `packages/brain/src/notion-push-sync.js` 含 `async function pushDecisions(pool, token)` 函数体，SELECT WHERE `notion_synced_at IS NULL`，成功推送后 UPDATE `notion_synced_at=NOW()`。

**验证命令**:
```bash
node -e "
const c=require('fs').readFileSync('packages/brain/src/notion-push-sync.js','utf8');
if(!c.includes('async function pushDecisions'))  { console.error('FAIL: pushDecisions 未实现'); process.exit(1); }
if(!c.includes('notion_synced_at IS NULL'))      { console.error('FAIL: 未过滤 notion_synced_at IS NULL'); process.exit(1); }
if(!c.includes('notion_synced_at=NOW()') && !c.includes('notion_synced_at = NOW()')) {
  console.error('FAIL: pushDecisions 未更新 notion_synced_at'); process.exit(1);
}
console.log('OK');
"
```

**硬阈值**: exit 0，函数体含完整 SELECT + UPDATE 逻辑

---

### Step 3: `pushInitiativeContracts()` 实现 — 未同步行推 Notion，更新 `notion_synced_at`

**来源**: `[FROM_PRD]` — PRD Golden Path WS1：同 Step 2，针对 `initiative_contracts` 表

**可观测行为**: `notion-push-sync.js` 含 `async function pushInitiativeContracts(pool, token)` 函数体，结构与 `pushDecisions` 一致，静默跳过找不到 Notion 映射的情况。

**验证命令**:
```bash
node -e "
const c=require('fs').readFileSync('packages/brain/src/notion-push-sync.js','utf8');
if(!c.includes('async function pushInitiativeContracts')) { console.error('FAIL: pushInitiativeContracts 未实现'); process.exit(1); }
console.log('OK');
"
```

**硬阈值**: exit 0

---

### Step 4: `runNotionPushSync()` 调用两个新函数

**来源**: `[FROM_PRD]` — PRD Golden Path WS1："Brain tick 调 `runNotionPushSync()` → 新增 … 把两张表的未同步行推到 Notion"

**可观测行为**: `runNotionPushSync` 函数体调用 `pushDecisions(pool, token)` 和 `pushInitiativeContracts(pool, token)`，顺序在现有 `pushIssues` 等调用之后或之中。

**验证命令**:
```bash
node -e "
const c=require('fs').readFileSync('packages/brain/src/notion-push-sync.js','utf8');
const fnStart=c.indexOf('export async function runNotionPushSync');
if(fnStart===-1){ console.error('FAIL: runNotionPushSync 不存在'); process.exit(1); }
const body=c.slice(fnStart);
if(!body.includes('pushDecisions('))       { console.error('FAIL: runNotionPushSync 未调 pushDecisions'); process.exit(1); }
if(!body.includes('pushInitiativeContracts(')) { console.error('FAIL: runNotionPushSync 未调 pushInitiativeContracts'); process.exit(1); }
console.log('OK');
"
```

**硬阈值**: exit 0，两个调用均在 `runNotionPushSync` 函数体内

---

### Step 5: `dev/SKILL.md` Route B — 无 `--task-id` 时 POST Brain 注册任务

**来源**: `[FROM_PRD]` — PRD Golden Path WS2："用户运行 `/dev`（无 `--task-id`）并确认 PrepPRD → dev SKILL **Route B** 调 `POST localhost:5221/api/brain/tasks`（`task_type=dev`）注册任务"

**可观测行为**: `packages/workflows/skills/dev/SKILL.md` 含 Route B 段落，说明当无 `--task-id` 时 POST `localhost:5221/api/brain/tasks`（`task_type=dev`），Brain 离线时打 warn 日志不阻断流程；Route A（有 `--task-id`）保持不变。

**验证命令**:
```bash
node -e "
const c=require('fs').readFileSync('packages/workflows/skills/dev/SKILL.md','utf8');
if(!c.includes('Route B'))                   { console.error('FAIL: Route B 段落不存在'); process.exit(1); }
if(!c.includes('localhost:5221/api/brain/tasks')) { console.error('FAIL: Brain POST endpoint 缺失'); process.exit(1); }
if(!c.includes('task_type'))                 { console.error('FAIL: task_type 字段缺失'); process.exit(1); }
if(!c.includes('--task-id'))                 { console.error('FAIL: Route A --task-id 引用丢失'); process.exit(1); }
console.log('OK');
"
```

**硬阈值**: exit 0，Route A/B 两条路径均存在于 SKILL.md

---

### Step 6: `buildGeneratorPrompt` 接受 `prdContent`，注入 `## Sprint PRD` 段

**来源**: `[FROM_PRD]` — PRD Golden Path WS3："`buildGeneratorPrompt(task, opts)` 从 `opts.prdContent` 取 PRD 内容，拼入 `## Sprint PRD` 段"

**可观测行为**: `packages/brain/src/harness-utils.js` 的 `buildGeneratorPrompt` 函数签名包含 `prdContent`；`prdContent` 非空时 prompt 字符串含 `## Sprint PRD` 段；`prdContent` 为 null/空时跳过该段，不注入空内容。

**验证命令**:
```bash
node -e "
const c=require('fs').readFileSync('packages/brain/src/harness-utils.js','utf8');
if(!c.includes('prdContent'))        { console.error('FAIL: buildGeneratorPrompt 缺 prdContent 参数'); process.exit(1); }
if(!c.includes('Sprint PRD') && !c.includes('sprint_prd')) { console.error('FAIL: 未拼入 Sprint PRD 段标识'); process.exit(1); }
console.log('OK');
"
```

**硬阈值**: exit 0，函数参数含 `prdContent` 且代码逻辑有条件注入段落

---

### Step 7: `runSubTaskNode` 传 `prdContent`；`TaskState` 和 `spawnNode` 对接

**来源**: `[FROM_PRD]` — PRD Golden Path WS3："`runSubTaskNode` 把 `state.prdContent` 传入 `opts`"；`[AI_ADDED]` — 因 `buildGeneratorPrompt` 调用点在 `harness-task.graph.js spawnNode`，需同步在 `TaskState` 加 annotation 并在 `spawnNode` 传递 `prdContent` 到 `buildGeneratorPrompt`，否则调用链断裂。

**可观测行为**: 
- `harness-initiative.graph.js runSubTaskNode` 在调用 `compiled.invoke` 时传入 `prdContent: state.prdContent`
- `harness-task.graph.js TaskState` 新增 `prdContent` Annotation
- `harness-task.graph.js spawnNode` 调用 `buildGeneratorPrompt(task, { fixMode, prdContent: state.prdContent })`

**验证命令**:
```bash
node -e "
const init=require('fs').readFileSync('packages/brain/src/workflows/harness-initiative.graph.js','utf8');
const fnIdx=init.indexOf('export async function runSubTaskNode');
if(fnIdx===-1){ console.error('FAIL: runSubTaskNode 不存在'); process.exit(1); }
if(!init.slice(fnIdx, fnIdx+3000).includes('prdContent')) { console.error('FAIL: runSubTaskNode 未传 prdContent'); process.exit(1); }
const task=require('fs').readFileSync('packages/brain/src/workflows/harness-task.graph.js','utf8');
if(!task.includes('prdContent')) { console.error('FAIL: harness-task.graph.js 未含 prdContent'); process.exit(1); }
console.log('OK');
"
```

**硬阈值**: exit 0，两个文件均含 `prdContent` 且在关键调用点附近

---

### Step 8: `harness-generator/SKILL.md` Step 0.5 注释改为串行 + 移除 `contract-draft.md` 引用

**来源**: `[FROM_PRD]` — PRD Golden Path WS4："generator SKILL Step 0.5 注释由'并行派发'改为'串行派发（每个 ws merge gate 通过后 Brain 才启动下一个）'；确认文件名统一为 sprint-contract.md，移除 contract-draft.md 旧引用"

**可观测行为**: `packages/workflows/skills/harness-generator/SKILL.md` Step 0.5 注释含"串行派发"；不含"并行派发"；`contract-draft.md` 的引用被移除（只保留 `sprint-contract.md`）。

**验证命令**:
```bash
node -e "
const c=require('fs').readFileSync('packages/workflows/skills/harness-generator/SKILL.md','utf8');
if(c.includes('并行派发'))      { console.error('FAIL: 仍含旧文字并行派发'); process.exit(1); }
if(!c.includes('串行派发'))     { console.error('FAIL: 未改为串行派发'); process.exit(1); }
if(c.includes('contract-draft.md')) { console.error('FAIL: contract-draft.md 旧引用未移除'); process.exit(1); }
if(!c.includes('sprint-contract.md')) { console.error('FAIL: sprint-contract.md 引用丢失'); process.exit(1); }
console.log('OK');
"
```

**硬阈值**: exit 0，四项检查全部通过

---

## E2E 验收（final-e2e — local_api / autonomous）

**journey_type**: autonomous
**target_environment**: local_api

```bash
#!/bin/bash
set -e
DB="${DB_URL:-postgresql://localhost/cecelia}"

echo "=== E2E: 开发链路可见性 v3 全程验证 ==="

# Step 1: migration 覆盖两张表
node -e "
const fs=require('fs'),p=require('path');
const dir='packages/brain/migrations';
const files=fs.readdirSync(dir).filter(f=>f.endsWith('.sql'));
const found=files.some(f=>{
  const c=fs.readFileSync(p.join(dir,f),'utf8');
  return c.includes('decisions') && c.includes('notion_synced_at') && c.includes('initiative_contracts');
});
if(!found){process.exit(1);}
console.log('✓ migration 覆盖两表');
"

# Step 2: notion-push-sync.js 含两个新函数 + runNotionPushSync 调用
node -e "
const c=require('fs').readFileSync('packages/brain/src/notion-push-sync.js','utf8');
if(!c.includes('async function pushDecisions'))        process.exit(1);
if(!c.includes('async function pushInitiativeContracts')) process.exit(1);
const fn=c.slice(c.indexOf('export async function runNotionPushSync'));
if(!fn.includes('pushDecisions('))        process.exit(1);
if(!fn.includes('pushInitiativeContracts(')) process.exit(1);
console.log('✓ notion-push-sync 两函数已实现且被调用');
"

# Step 3: dev/SKILL.md Route B 含 Brain POST 步骤
node -e "
const c=require('fs').readFileSync('packages/workflows/skills/dev/SKILL.md','utf8');
if(!c.includes('Route B'))                       process.exit(1);
if(!c.includes('localhost:5221/api/brain/tasks')) process.exit(1);
if(!c.includes('task_type'))                     process.exit(1);
console.log('✓ dev SKILL.md Route B 已加 Brain POST 步骤');
"

# Step 4: buildGeneratorPrompt 支持 prdContent
node -e "
const c=require('fs').readFileSync('packages/brain/src/harness-utils.js','utf8');
if(!c.includes('prdContent'))              process.exit(1);
if(!c.includes('Sprint PRD') && !c.includes('sprint_prd')) process.exit(1);
console.log('✓ buildGeneratorPrompt 支持 prdContent 注入');
"

# Step 5: runSubTaskNode 传 prdContent + harness-task.graph.js 对接
node -e "
const init=require('fs').readFileSync('packages/brain/src/workflows/harness-initiative.graph.js','utf8');
const idx=init.indexOf('export async function runSubTaskNode');
if(idx===-1) process.exit(1);
if(!init.slice(idx,idx+3000).includes('prdContent')) process.exit(1);
const task=require('fs').readFileSync('packages/brain/src/workflows/harness-task.graph.js','utf8');
if(!task.includes('prdContent')) process.exit(1);
console.log('✓ runSubTaskNode 传 prdContent，task graph 对接');
"

# Step 6: harness-generator SKILL.md 串行化
node -e "
const c=require('fs').readFileSync('packages/workflows/skills/harness-generator/SKILL.md','utf8');
if(c.includes('并行派发'))          process.exit(1);
if(!c.includes('串行派发'))         process.exit(1);
if(c.includes('contract-draft.md')) process.exit(1);
console.log('✓ harness-generator SKILL.md Step 0.5 串行化完成');
"

echo ""
echo "✅ Golden Path 全程验证通过"
```

---

## Workstreams

**workstream_count**: 4

### Workstream 1: DB migration + notion-push-sync 两函数实现

**范围**: `packages/brain/migrations/284_notion_synced_decisions_contracts.sql`（新建）；`packages/brain/src/notion-push-sync.js`（加 `pushDecisions` + `pushInitiativeContracts` + 在 `runNotionPushSync` 内调用）
**大小**: M（migration ~25 行 + 两函数 + 调用 ~80 行 = ~105 行）
**依赖**: 无

### Workstream 2: dev/SKILL.md Route B 步骤

**范围**: `packages/workflows/skills/dev/SKILL.md`（在合适位置加 Route A/B 说明 + Route B POST Brain 步骤，~30 行）
**大小**: S
**依赖**: Workstream 1 完成后（串行规则）

### Workstream 3: buildGeneratorPrompt prdContent + runSubTaskNode 传递链

**范围**: `packages/brain/src/harness-utils.js`（`buildGeneratorPrompt` 加 `prdContent` 参数，~12 行）；`packages/brain/src/workflows/harness-initiative.graph.js`（`runSubTaskNode` 传 `prdContent`，~5 行）；`packages/brain/src/workflows/harness-task.graph.js`（`TaskState` 加 `prdContent` annotation + `spawnNode` 传参，~8 行）
**大小**: S（总 ~25 行）
**依赖**: Workstream 2 完成后

### Workstream 4: harness-generator SKILL.md 串行化 + 文件名统一

**范围**: `packages/workflows/skills/harness-generator/SKILL.md`（Step 0.5 注释改串行，移除 `contract-draft.md` 引用，~5 行修改）
**大小**: S
**依赖**: Workstream 3 完成后

---

## Workstreams 切分硬规则自查

| WS | 预期净增 LoC | 文件数 | 通过？ |
|---|---|---|---|
| ws1 | ~105 行 | 2 文件 | ✅ ≤200 行，≤3 文件 |
| ws2 | ~30 行 | 1 文件 | ✅ |
| ws3 | ~25 行 | 3 文件 | ✅ ≤200 行，≤3 文件 |
| ws4 | ~5 行修改 | 1 文件 | ✅ |

总净增 ~165 行 → `workstream_count=4`（各 ws 职责独立，不能合并为 1）

---

## Risks

| # | 风险 | 可能性 | 影响 | Mitigation |
|---|---|---|---|---|
| R1 | **Notion API token 不可用或触发 rate limit** → `pushDecisions` / `pushInitiativeContracts` 调用时 Notion API 报 401/429 | 中 | 低（数据未同步但不影响 Brain 运行） | `try/catch` + `console.warn`，静默跳过；`notion_synced_at` 保持 NULL，下次 tick 自动重试（与现有 `pushIssues` 行为一致）。WS1 BEHAVIOR5 验证此 error path 存在。 |
| R2 | **prdContent 传递链断裂** — `harness-initiative.graph.js → harness-task.graph.js` 调用链对接遗漏，generator 收到的 prompt 缺 `## Sprint PRD` 段 | 中 | 中（generator 无 PRD 上下文，合同可见性断层复现） | WS3 BEHAVIOR4 机检 `runSubTaskNode` 函数体含 `prdContent`；WS3 BEHAVIOR3 机检 `spawnNode` 调用点含 `prdContent`；两条 BEHAVIOR 必须同时 PASS generator 才算实现完整链路。 |
| R3 | **Cascade 场景**：WS2 改动 `dev/SKILL.md` 结构时意外影响路径引用，harness-generator 读取该文件时找不到 Stage 1 / PrepPRD 上下文 | 低 | 低（SKILL.md 为静态文档，不影响运行时） | WS2 BEHAVIOR4 验证 PrepPRD/Stage 1 上下文仍存在；WS4 串行依赖 WS3，确保文档变更在验收链末端才合并，不干扰上游 SKILL 路径。 |

---

## Test Contract

| Workstream | Test File | BEHAVIOR 覆盖 | 预期红证据 |
|---|---|---|---|
| WS1 | `tests/ws1/notion-push-sync.test.js` | pushDecisions/pushInitiativeContracts 存在 + runNotionPushSync 调用 + migration 两表 | WS1 未实现时 4 failures |
| WS2 | `tests/ws2/dev-skill-route-b.test.js` | SKILL.md Route B 含必要字段 | WS2 未实现时 4 failures |
| WS3 | `tests/ws3/build-generator-prompt.test.js` | prdContent 注入/跳过 + harness-task.graph.js 注解 | WS3 未实现时 4 failures |
| WS4 | `tests/ws4/harness-generator-skill.test.js` | 串行派发 + 无旧文字 + 文件名统一 | WS4 未实现时 4 failures |
