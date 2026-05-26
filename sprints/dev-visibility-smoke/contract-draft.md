# Sprint Contract Draft (Round 3)

## Golden Path
[harness 触发 generator 节点] → [Brain 读 sprint-prd.md 注入 prdContent] → [generator prompt 含 `## Sprint PRD` 段，内容完整] → [sprint-prd.md 存在且非空] → [冒烟脚本端到端验证通过] → [prdContent=null 时 prompt 含错误标注（harness-utils.js 代码保障）] → [Brain tasks 表有本次 task_id 记录且 status = completed 或 in_progress]

---

### Step 1: harness-utils.js `buildGeneratorPrompt` 含 prdContent → `## Sprint PRD` 注入逻辑
**来源**: `[FROM_PRD]` — PRD"背景"段明确写"WS2/3/4（#3142）实现了 Generator PRD 注入"；PRD"预期受影响文件"：`packages/engine/scripts/harness/`（generator prompt 构建逻辑验证点）

**可观测行为**: `packages/brain/src/harness-utils.js` 的 `buildGeneratorPrompt` 函数，当 `prdContent` 非 null 时，在返回的 prompt 字符串中生成 `## Sprint PRD` 段落，内容为 prdContent 全文。

**验证命令**:
```bash
node -e "
const c = require('fs').readFileSync('packages/brain/src/harness-utils.js', 'utf8');
if (!c.includes('\"## Sprint PRD\"')) { console.error('FAIL: 缺少 ## Sprint PRD 注入代码'); process.exit(1); }
if (!c.includes('prdContent')) { console.error('FAIL: 缺少 prdContent 参数'); process.exit(1); }
console.log('OK');
"
```

**硬阈值**: exit 0，stdout 含 OK

---

### Step 2: harness-initiative.graph.js 读取 sprint-prd.md 并将内容传入 buildGeneratorPrompt
**来源**: `[FROM_PRD]` — PRD"具体"第 1 步："harness 执行到 generator 节点时，Brain 构建含 PRD 的 generator prompt"；PRD"预期受影响文件"：`packages/brain/src/`（tasks 表查询端点）

**可观测行为**: `harness-initiative.graph.js` 含读取 `sprint-prd.md` 的代码分支，并将读取内容以 `prdContent` 参数传入 `buildGeneratorPrompt`。

**验证命令**:
```bash
node -e "
const c = require('fs').readFileSync('packages/brain/src/workflows/harness-initiative.graph.js', 'utf8');
if (!c.includes('sprint-prd.md')) { console.error('FAIL: 缺少 sprint-prd.md 读取'); process.exit(1); }
if (!c.includes('prdContent')) { console.error('FAIL: 缺少 prdContent 传递'); process.exit(1); }
console.log('OK');
"
```

**硬阈值**: exit 0

---

### Step 3: sprint-prd.md 存在且非空
**来源**: `[FROM_PRD]` — PRD"验收标准（DoD）"第 3 项：`[ARTIFACT] sprints/dev-visibility-smoke/sprint-prd.md 存在且非空`

**可观测行为**: 文件 `sprints/dev-visibility-smoke/sprint-prd.md` 存在，字节数 > 0。

**验证命令**:
```bash
[ -s sprints/dev-visibility-smoke/sprint-prd.md ] && echo OK || { echo "FAIL: 文件不存在或为空"; exit 1; }
```

**硬阈值**: exit 0，stdout 含 OK

---

### Step 4: buildGeneratorPrompt 实际调用时 `## Sprint PRD` 段出现在 `## DoD` 之前
**来源**: `[FROM_PRD]` — PRD"具体"第 2 步："prompt 顶部出现 ## Sprint PRD 段，内容为 sprint-prd.md 全文"

`[AI_ADDED]` — GAN Round 1 Proposer 加入，理由：仅验证关键词存在不能发现顺序倒置问题；顺序检查防止 generator 注入 PRD 但位置错误（如追加在 DoD 后面），确保 generator 优先看到完整 PRD 上下文

**可观测行为**: 以实际 sprint-prd.md 内容调用 `buildGeneratorPrompt`，输出 prompt 中 `## Sprint PRD` 的 index 严格小于 `## DoD` 的 index，且 PRD 前 100 字符完整出现。

**验证命令**:
```bash
node --input-type=module << 'EOJS'
import { buildGeneratorPrompt } from './packages/brain/src/harness-utils.js';
import { readFileSync } from 'fs';
const prd = readFileSync('sprints/dev-visibility-smoke/sprint-prd.md', 'utf8');
const task = { id: 'smoke-s4', title: 'smoke', description: 'smoke',
  payload: { dod: [], files: [], parent_task_id: 'p', logical_task_id: 'ws1' } };
const prompt = buildGeneratorPrompt(task, { prdContent: prd });
if (!prompt.includes('## Sprint PRD')) { console.error('FAIL: ## Sprint PRD 不存在'); process.exit(1); }
if (!prompt.includes(prd.slice(0, 100))) { console.error('FAIL: PRD 内容截断'); process.exit(1); }
const prdIdx = prompt.indexOf('## Sprint PRD');
const dodIdx = prompt.indexOf('## DoD');
if (prdIdx >= dodIdx) { console.error('FAIL: ## Sprint PRD 在 ## DoD 之后，prdIdx=' + prdIdx); process.exit(1); }
console.log('OK prdIdx=' + prdIdx + ' dodIdx=' + dodIdx);
EOJS
```

**硬阈值**: exit 0，stdout 含 OK

---

### Step 5: 冒烟脚本端到端验证退出 0
**来源**: `[AI_ADDED]` — GAN Round 1 Proposer 加入，理由：无统一冒烟脚本时 evaluator 需逐条跑 4 个命令，脚本封装后可重复运行、一步失败即 exit 1，确保结果确定性并防止环境不一致造假

**可观测行为**: `sprints/dev-visibility-smoke/smoke-verify.sh` 存在且可执行；`bash smoke-verify.sh` 退出码为 0，stdout 含成功标志。

**验证命令**:
```bash
[ -f sprints/dev-visibility-smoke/smoke-verify.sh ] || { echo "FAIL: smoke-verify.sh 不存在"; exit 1; }
bash sprints/dev-visibility-smoke/smoke-verify.sh && echo "全程通过" || { echo "FAIL: smoke-verify.sh 非零退出"; exit 1; }
```

**硬阈值**: exit 0，stdout 含 "全程通过" 或 "✅"

---

### Step 6: prdContent=null 时 harness-utils.js 插入错误标注段（非静默跳过）
**来源**: `[FROM_PRD]` — PRD"边界情况"段："sprint-prd.md 不存在时：generator prompt 应含错误标注，不得静默跳过"

`[AI_ADDED]` — GAN Round 3 Block 1 修复：上轮 WS1/WS2 scope 均未包含修改 harness-utils.js line 165 的代码变更，导致 test 6 永久红。WS3 scope 显式包含此代码修改，合同在此 Step 明确验证代码结构（false 分支非空数组）+ 运行时行为（prompt 含 ERROR 标注）

**可观测行为**: `harness-utils.js` 的 `prdSection` ternary false 分支不为空数组 `[]`，而是包含 "ERROR" 等错误标注文字；`buildGeneratorPrompt(task, { prdContent: null })` 返回含错误标注的 prompt，不抛异常，不返空字符串。

**验证命令**:
```bash
# 1. 代码结构：false 分支非空 []
node -e "
const c = require('fs').readFileSync('packages/brain/src/harness-utils.js', 'utf8');
const match = c.match(/prdSection\s*=\s*prdContent\s*\?[\s\S]{0,300}?:\s*(\[[\s\S]{0,200}?\])/);
if (!match) { console.error('FAIL: 找不到 prdSection ternary'); process.exit(1); }
const falseBranch = match[1].trim();
if (falseBranch === '[]') { console.error('FAIL: prdContent=null 分支仍为 []（无错误标注）'); process.exit(1); }
console.log('OK false 分支:', falseBranch.slice(0, 60));
"
# 2. 运行时：调用结果含错误标注
node --input-type=module << 'EOJS'
import { buildGeneratorPrompt } from './packages/brain/src/harness-utils.js';
const task = { id: 'smoke-null', title: 'smoke', description: 'smoke',
  payload: { dod: [], files: [], parent_task_id: 'p', logical_task_id: 'ws1' } };
const prompt = buildGeneratorPrompt(task, { prdContent: null });
if (typeof prompt !== 'string' || prompt.length === 0) {
  console.error('FAIL: 返回非字符串或空字符串'); process.exit(1);
}
const lower = prompt.toLowerCase();
const hasAnnotation = lower.includes('error') || prompt.includes('PRD 不存在') || prompt.includes('无法读取');
if (!hasAnnotation) {
  console.error('FAIL: prdContent=null 时 prompt 无错误标注，开头：' + prompt.slice(0, 80));
  process.exit(1);
}
console.log('OK: 含错误标注');
EOJS
```

**硬阈值**: 两步均 exit 0

---

### Step 7: Brain tasks 表有本次 task_id 记录且 status = completed 或 in_progress
**来源**: `[FROM_PRD]` — PRD"验收标准（DoD）"第 2 项："Brain tasks 表在 /dev 完成后有对应 task_id 的记录，status = completed 或 in_progress"

`[AI_ADDED]` — GAN Round 3 Block 2 修复：上轮查询用 `task_type=harness_contract_propose&limit=5` 不过滤本次 task_id（可命中旧任务），且 status oracle `!= pending` 太宽（涵盖 failed/error）。改为 `GET /api/brain/tasks/$TASK_ID`（具体任务单条）+ `jq -e '.status == "completed" or .status == "in_progress"'`

**可观测行为**: `GET /api/brain/tasks/$TASK_ID` 返回单条任务对象，`.status` 字段值精确为 `"completed"` 或 `"in_progress"`（rejected：`"pending"` / `"failed"` / `"error"`）。

**验证命令**:
```bash
if curl -sf localhost:5221/api/brain/health > /dev/null 2>&1; then
  RESP=$(curl -sf "localhost:5221/api/brain/tasks/${TASK_ID}") \
    || { echo "FAIL: GET /api/brain/tasks/$TASK_ID 不可达"; exit 1; }
  echo "$RESP" | jq -e '.status == "completed" or .status == "in_progress"' > /dev/null \
    || { echo "FAIL: status=$(echo $RESP | jq -r .status)，期望 completed 或 in_progress"; exit 1; }
  echo "OK: task_id=$TASK_ID status=$(echo $RESP | jq -r .status)"
else
  echo "SKIP: Brain 未运行，跳过 tasks 表验证"
fi
```

**硬阈值**: Brain 在线时 exit 0，jq-e 通过；Brain 离线时 SKIP 可接受

---

## E2E 验收（最终 final-e2e 跑）

**journey_type**: dev_pipeline
**target_environment**: mac_web（本地 Mac 机，Brain localhost:5221，非 Playwright 浏览器）

```bash
#!/bin/bash
# final-e2e — Dev-Visibility 冒烟验证 (dev_pipeline/mac_web)
set -e

SPRINT_DIR="sprints/dev-visibility-smoke"

echo "=== final-e2e: Dev-Visibility 冒烟验证 ==="

# 1. ARTIFACT: sprint-prd.md 存在且非空
[ -s "${SPRINT_DIR}/sprint-prd.md" ] || { echo "FAIL: sprint-prd.md 不存在或为空"; exit 1; }
echo "✓ sprint-prd.md 存在"

# 2. CODE STRUCTURE: buildGeneratorPrompt 含 prdContent → ## Sprint PRD 注入
node -e "
const c = require('fs').readFileSync('packages/brain/src/harness-utils.js', 'utf8');
if (!c.includes('\"## Sprint PRD\"')) { process.exit(1); }
if (!c.includes('prdContent')) { process.exit(1); }
console.log('✓ harness-utils.js prdContent 注入代码存在');
"

# 3. CODE STRUCTURE: harness-initiative.graph.js 读 sprint-prd.md + 传 prdContent
node -e "
const c = require('fs').readFileSync('packages/brain/src/workflows/harness-initiative.graph.js', 'utf8');
if (!c.includes('sprint-prd.md')) { process.exit(1); }
if (!c.includes('prdContent')) { process.exit(1); }
console.log('✓ harness-initiative.graph.js 含 sprint-prd.md 读取 + prdContent 传递');
"

# 4. BEHAVIOR: buildGeneratorPrompt 实际注入（带时间戳防历史造假）
RUN_TS=$(date +%s)
node --input-type=module << EOJS
import { buildGeneratorPrompt } from './packages/brain/src/harness-utils.js';
import { readFileSync } from 'fs';
const prd = readFileSync('${SPRINT_DIR}/sprint-prd.md', 'utf8');
const task = { id: 'e2e-${RUN_TS}', title: 'e2e smoke', description: 'smoke e2e',
  payload: { dod: [], files: [], parent_task_id: 'p', logical_task_id: 'ws1' } };
const prompt = buildGeneratorPrompt(task, { prdContent: prd });
if (!prompt.includes('## Sprint PRD')) { console.error('FAIL: prompt 不含 ## Sprint PRD'); process.exit(1); }
if (!prompt.includes(prd.slice(0, 100))) { console.error('FAIL: PRD 内容截断'); process.exit(1); }
const prdIdx = prompt.indexOf('## Sprint PRD');
const dodIdx = prompt.indexOf('## DoD');
if (prdIdx >= dodIdx) { console.error('FAIL: ## Sprint PRD 在 ## DoD 之后'); process.exit(1); }
console.log('✓ buildGeneratorPrompt 注入行为验证通过 ts=${RUN_TS}');
EOJS

# 5. BEHAVIOR: prdContent=null 时含错误标注（WS3 修复后验证点）
node --input-type=module << 'EOJS'
import { buildGeneratorPrompt } from './packages/brain/src/harness-utils.js';
const task = { id: 'null-test', title: 'smoke', description: 'smoke',
  payload: { dod: [], files: [], parent_task_id: 'p', logical_task_id: 'ws1' } };
const prompt = buildGeneratorPrompt(task, { prdContent: null });
if (typeof prompt !== 'string' || prompt.length === 0) {
  console.error('FAIL: 返回非字符串或空字符串'); process.exit(1);
}
const lower = prompt.toLowerCase();
const hasAnnotation = lower.includes('error') || prompt.includes('PRD 不存在') || prompt.includes('无法读取');
if (!hasAnnotation) {
  console.error('FAIL: prdContent=null 时 prompt 无错误标注'); process.exit(1);
}
console.log('✓ prdContent=null 时含错误标注');
EOJS

# 6. SMOKE SCRIPT: smoke-verify.sh 端到端
bash "${SPRINT_DIR}/smoke-verify.sh"
echo "✓ smoke-verify.sh 通过"

# 7. BRAIN TASKS TABLE: 具体 task_id + status == completed or in_progress
if curl -sf localhost:5221/api/brain/health > /dev/null 2>&1; then
  RESP=$(curl -sf "localhost:5221/api/brain/tasks/${TASK_ID}" 2>/dev/null) \
    || { echo "FAIL: GET /api/brain/tasks/$TASK_ID 不可达"; exit 1; }
  echo "$RESP" | jq -e '.status == "completed" or .status == "in_progress"' > /dev/null \
    || { echo "FAIL: status=$(echo $RESP | jq -r .status)，期望 completed 或 in_progress"; exit 1; }
  echo "✓ Brain tasks 表验证通过 task_id=${TASK_ID} status=$(echo $RESP | jq -r .status)"
else
  echo "⚠ Brain 未运行，跳过 tasks 表验证"
fi

echo "=== ✅ 所有 final-e2e 检查通过 ==="
```

---

## Workstreams

workstream_count: 3

### Workstream 1: smoke-verify.sh 冒烟脚本
**范围**: 创建 `sprints/dev-visibility-smoke/smoke-verify.sh`，端到端验证 buildGeneratorPrompt PRD 注入行为 + sprint-prd.md 存在性
**大小**: S（< 70 行）
**依赖**: 无

### Workstream 2: prd-injection-smoke 集成测试
**范围**: 创建 `sprints/dev-visibility-smoke/tests/ws2/prd-injection-smoke.test.ts`，vitest 集成测试：`buildGeneratorPrompt` 完整路径（prdContent 非 null + null 边界情况）+ Brain tasks 查询（`GET /api/brain/tasks/$TASK_ID` + `completed or in_progress`）
**大小**: S（< 80 行）
**依赖**: Workstream 1 完成后

### Workstream 3: harness-utils.js null 错误标注修复
**范围**: 修改 `packages/brain/src/harness-utils.js` line 165，将 prdContent=null 时的 false 分支从 `[]`（静默跳过）改为包含 "ERROR" 错误标注文字的数组段
**大小**: S（< 5 行净变更）
**依赖**: Workstream 2 完成后

---

## Test Contract

| Workstream | Test File | BEHAVIOR 覆盖 | 预期红色证据 |
|---|---|---|---|
| WS1 | `tests/ws1/smoke-verify-script.test.ts` | smoke-verify.sh 文件存在、退出码 | WS1 未完成 → 1 failure（smoke-verify.sh 不存在） |
| WS2 | `tests/ws2/prd-injection-smoke.test.ts` | sprint-prd.md 存在且非空、buildGeneratorPrompt 注入、PRD 内容完整、Sprint PRD 出现在、smoke-verify.sh 存在、prdContent=null、Brain tasks 表 | tests 1-4 GREEN（#3142 已合并）；test 7 需 TASK_ID 种子 |

**说明（Block 3 修正）**：WS2 tests 1-4 在创建测试文件后即为 GREEN，因 #3142 已合并，`buildGeneratorPrompt` prdContent 注入逻辑已存在。这 4 条验证存量 #3142 行为，不是 WS2 新增交付物的红色证据。真正的 Red 证据：test 5（WS1 前置）和 test 6（WS3 null 修复前永久红）。
