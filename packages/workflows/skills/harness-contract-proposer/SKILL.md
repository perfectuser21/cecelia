---
id: harness-contract-proposer-skill
description: |
  Harness Contract Proposer — Harness v5.0 GAN Layer 2a：
  Generator 角色，读取 PRD，产出 3 份合同产物（sprint-prd.md + contract-dod-ws{N}.md 只装 [ARTIFACT] + tests/ws{N}/*.test.ts 真实失败测试）。
  合同测试代码进入 GAN 对抗，Reviewer 做 Mutation testing 挑战测试强度。
version: 6.0.0
created: 2026-04-08
updated: 2026-05-06
changelog:
  - 6.0.0: Working Skeleton — 识别 is_skeleton task；按 journey_type 切换 E2E test 模板（4 种）；contract-dod-ws0.md 加 YAML header
  - 5.0.0: TDD 融合 — 合同产出 3 份产物（sprint-prd.md + contract-dod-ws{N}.md 只剩 [ARTIFACT] + tests/ws{N}/*.test.ts 真实失败测试 Red 证据）；合同末尾加 Test Contract 索引表；严禁 contract-dod-ws 出现 [BEHAVIOR] 条目
  - 4.4.0: contract-dod-ws{N}.md 写入路径改为 ${SPRINT_DIR}/contract-dod-ws{N}.md（防止多次运行时根目录文件覆盖）
  - 4.3.0: 每个 workstream 输出独立 contract-dod-ws{N}.md 文件并 push 到 propose branch，供 Generator 原样复制 + CI 完整性校验
  - 4.2.0: 合同新增 ## Workstreams 区块 — 定义拆分数量+DoD条目(- [ ] [BEHAVIOR/ARTIFACT])，供 Generator 直接复制使用
  - 4.1.0: 修正 v4.0 错误 — 合同格式恢复验证命令代码块（广谱：curl/npm/psql/playwright），GAN 对抗核心是命令严格性
  - 4.0.0: 错误版本 — 合同只有行为描述+硬阈值，移除了验证命令（破坏 GAN 对抗）
  - 3.0.0: Harness v4.0 Contract Proposer（GAN Layer 2a，独立 skill）
---

> **语言规则: 所有输出必须使用简体中文。严禁日语、韩语或其他语言。**
> **执行规则: 严格按照下面列出的步骤执行。不要搜索/查找其他 skill 文件，不要 find/glob 查找任何 SKILL.md，直接按本文档流程操作。**

# /harness-contract-proposer — Harness v5.0 Contract Proposer

**角色**: Generator（合同起草者）
**对应 task_type**: `harness_contract_propose`

---

## 职责

读取 `sprint-prd.md`，提出合同草案 + 写真实失败测试。产出 **3 份产物**：

1. **`${SPRINT_DIR}/sprint-prd.md`**（不变，读入 PRD 不回写）
2. **`${SPRINT_DIR}/contract-dod-ws{N}.md`** — 每个 workstream 一份 DoD，**只装 [ARTIFACT] 条目**（静态产出物：文件存在/内容包含/配置更新等）。**严禁 [BEHAVIOR] 条目**——运行时行为必须写进 `tests/ws{N}/*.test.ts`
3. **`${SPRINT_DIR}/tests/ws{N}/*.test.ts`** — 每个 workstream 一个目录，真实 vitest 失败测试（TDD Red 阶段产物）

**这是 GAN 对抗的起点**：Generator 提出测试代码，Reviewer 挑战测试是否能抓出假实现（Mutation testing），直到双方对齐。**GAN 对抗轮次无上限**。

---

## DoD 分家规则（Proposer 写合同时的决策)

| 类型 | 装什么 | 住哪 | Test 字段允许 |
|---|---|---|---|
| **[ARTIFACT]** | 静态产物（文件/内容/配置/文档） | `contract-dod-ws{N}.md` | `node -e "fs.accessSync"` / `node -e "readFileSync + 正则"` / `grep -c` / `test -f` / `bash` |
| **[BEHAVIOR]** | 运行时行为（API 响应/函数返回/错误处理/并发） | `tests/ws{N}/*.test.ts` 的 `it()` 块 | 只允许 vitest 真测试（**严禁** `node -e` 字符串） |

**决策树**（每条 DoD 都要问自己）：

```
Q: 这个条目能不能只靠"检查文件内容或结构"验证？
  ├─ 能 → [ARTIFACT] 放 contract-dod-ws{N}.md
  └─ 不能，必须跑起来看行为 → 写 it() 放 tests/ws{N}/*.test.ts
```

---

## 执行流程

### Step 1: 读取 PRD

**⚠️ Skeleton Task 检测（优先执行）**

从任务 payload 读取 `is_skeleton`：
- `is_skeleton === true` → 本任务是 Skeleton Task，进入 Step 1.5（E2E 模板流程），跳过普通 Step 2
- 否则 → 正常流程，继续当前 Step 1

```bash
# TASK_ID、SPRINT_DIR、PLANNER_BRANCH、PROPOSE_ROUND 由 cecelia-run 通过 prompt 注入，直接使用：
# TASK_ID={TASK_ID}
# SPRINT_DIR={sprint_dir}
# PLANNER_BRANCH={planner_branch}
# PROPOSE_ROUND={propose_round}
# INITIATIVE_ID={initiative_id} — Brain 通过 cecelia-run 注入；fallback: 从 PRD 文件名或 task payload.initiative_id 提取

# PRD 在 planner 的分支上，fetch 后用 git show 读取（不依赖本地文件是否存在）
git fetch origin "${PLANNER_BRANCH}" 2>/dev/null || true
git show "origin/${PLANNER_BRANCH}:${SPRINT_DIR}/sprint-prd.md" 2>/dev/null || \
  cat "${SPRINT_DIR}/sprint-prd.md"   # fallback：已合并到本分支的场景
```

**如果是修订轮（propose_round > 1）**，读取上轮 Reviewer 的反馈：

```bash
# REVIEW_BRANCH 由 prompt 注入（review_feedback_task_id 对应的任务 result.review_branch）
if [ -n "$REVIEW_BRANCH" ]; then
  git fetch origin "${REVIEW_BRANCH}" 2>/dev/null || true
  git show "origin/${REVIEW_BRANCH}:${SPRINT_DIR}/contract-review-feedback.md" 2>/dev/null || true
fi
```

---

### Step 1.5: Skeleton Task 专用 E2E 模板（仅 is_skeleton=true 时执行）

**从 Brain API 读 journey_type：**
```bash
curl localhost:5221/api/brain/initiatives/${INITIATIVE_ID} | jq -r '.journey_type // "autonomous"'
```
若 API 不可达，用以下命令从 sprint-prd.md 读取 fallback：
```bash
JOURNEY_TYPE=$(grep -m1 "^journey_type:" "${SPRINT_DIR}/sprint-prd.md" | cut -d: -f2 | tr -d ' ') || JOURNEY_TYPE="autonomous"
```

**根据 journey_type 写入 `${SPRINT_DIR}/tests/ws0/skeleton.test.ts`（选一种）：**

**user_facing 模板：**
```typescript
import { test, expect, chromium } from '@playwright/test';
// SKELETON E2E — user_facing
test('skeleton: [入口操作] → [预期结果]', async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  await page.goto('http://localhost:5211');
  // 替换 [入口操作]：具体的用户交互（page.goto + page.click/page.fill 等）
  // 替换 [预期结果]（data-testid="skeleton-result"）：预期出现的 UI 元素 testid
  await expect(page.locator('[data-testid="skeleton-result"]')).toBeVisible();
  await browser.close();
});
```

**autonomous 模板：**
```typescript
import { describe, it, expect } from 'vitest';
import pool from '../../../packages/brain/src/db.js';
// SKELETON E2E — autonomous
describe('skeleton: [触发事件] → DB 终态', () => {
  it('injects event and verifies DB terminal state', async () => {
    await pool.query(`INSERT INTO tasks (task_type, status, payload) VALUES ($1, $2, $3)`,
    // 替换 'test_event' 为实际的业务 task_type，如 'content_pipeline'、'report_generate' 等
      ['test_event', 'queued', JSON.stringify({ skeleton: true })]);
    const result = await pollDB(5000, async () => {
      const r = await pool.query(
        `SELECT * FROM tasks WHERE task_type = $1 AND status = $2 LIMIT 1`,
        ['test_event', 'completed']
      );
      return r.rows[0] || null;
    });
    expect(result).toBeTruthy();
  });
});
async function pollDB(timeoutMs: number, fn: () => Promise<any>) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const r = await fn();
    if (r) return r;
    await new Promise(res => setTimeout(res, 200));
  }
  return null;
}
```

**dev_pipeline 模板：**
```typescript
import { describe, it, expect } from 'vitest';
// SKELETON E2E — dev_pipeline
// 此测试 import 目标模块（尚未实现），Red 阶段因 "Cannot find module" 或断言失败
// 替换下方 import 路径为本次 skeleton 实际要实现的模块
import { dispatchSkeletonTask } from '../../../packages/brain/src/[target-module].js';

describe('skeleton: [任务类型] dispatch → [预期结果]', () => {
  it('dispatches task and receives pr_url in result', async () => {
    // 替换为真实的 dispatch 调用参数
    const result = await dispatchSkeletonTask({ type: '[任务类型]', payload: {} });
    // 断言预期的回调字段（skeleton 阶段只需主路径通过）
    expect(result).toHaveProperty('pr_url');
    expect(result.pr_url).toMatch(/github\.com/);
  });
});
// [任务类型]、[target-module]、[预期结果] 均为占位符，必须替换为本次 Initiative 的具体内容
```

**agent_remote 模板：**
```typescript
import { describe, it, expect } from 'vitest';
// SKELETON E2E — agent_remote
// 此测试 import 目标模块（尚未实现），Red 阶段因 "Cannot find module" 或断言失败
// 替换下方 import 路径为本次 skeleton 实际要实现的 bridge client
import { sendAgentCommand } from '../../../packages/brain/src/[bridge-module].js';

describe('skeleton: Brain dispatch → [远端 agent] 执行回报', () => {
  it('sends command and verifies executed=true in result', async () => {
    // 替换 [命令内容] 和 [目标 agent]
    const result = await sendAgentCommand({
      command: '[命令内容]',
      target: '[目标 agent]', // 如 'us-mac', 'hk-vps'
    });
    expect(result).toHaveProperty('executed', true);
    expect(result).toHaveProperty('output');
  });
});
// [bridge-module]、[命令内容]、[目标 agent] 均为占位符，必须替换为本次 Initiative 的具体内容
```

**在 `contract-dod-ws0.md` 开头写入 YAML header：**
```markdown
---
skeleton: true
journey_type: <推断到的 journey_type 值>
---
```

**跑测试确认红（记录 Red evidence）：**
```bash
cd /path/to/worktree
npx vitest run "${SPRINT_DIR}/tests/ws0/skeleton.test.ts" 2>&1 | tee /tmp/skeleton-red.log | tail -20
grep -E "FAIL|failed|✗" /tmp/skeleton-red.log || { echo "ERROR: skeleton 测试未产生 Red，检查模板是否正确 import 了待实现模块"; exit 1; }
```
确认有 FAIL 输出，将摘要记入 contract-draft.md 的 Test Contract 表格。

---

### Step 2: 写合同草案

写入 `${SPRINT_DIR}/contract-draft.md`。每个 Feature 给出**行为描述 + 硬阈值 + BEHAVIOR 覆盖列表 + ARTIFACT 覆盖列表**，末尾统一附 `## Workstreams` 区块和 `## Test Contract` 索引表：

````markdown
# Sprint Contract Draft (Round {N})

## Feature 1: {功能名}

**行为描述**:
{外部可观测的行为描述，不引用内部代码路径}

**硬阈值**:
- `{字段名}` 不为 null
- {量化条件}

**BEHAVIOR 覆盖**（这些会在 tests/ws{N}/ 里落成真实 it() 块）:
- `it('retries 3 times on transient failure')`
- `it('throws after max retries exceeded')`

**ARTIFACT 覆盖**（这些会写进 contract-dod-ws{N}.md）:
- MAX_RETRIES 常量定义在 packages/brain/src/retry.js

---

## Feature 2: {功能名}

...

---

## Workstreams

workstream_count: {N}

### Workstream 1: {标题}

**范围**: {清晰的实现边界，与其他 workstream 无交集}
**大小**: S（<100行）/ M（100-300行）/ L（>300行）
**依赖**: 无 / Workstream X 完成后

**BEHAVIOR 覆盖测试文件**: `tests/ws1/retry.test.ts`

### Workstream 2: {标题}

**范围**: {清晰的实现边界}
**大小**: M
**依赖**: 无

**BEHAVIOR 覆盖测试文件**: `tests/ws2/api.test.ts`

---

## Test Contract

| Workstream | Test File | BEHAVIOR 覆盖 | 预期红证据 |
|---|---|---|---|
| WS1 | `tests/ws1/retry.test.ts` | retries 3 times / throws after max / exponential backoff | `npx vitest run sprints/{sprint}/tests/ws1/` → 3 failures |
| WS2 | `tests/ws2/api.test.ts` | 404 missing / 422 invalid | `npx vitest run sprints/{sprint}/tests/ws2/` → 2 failures |
````

**Workstream 拆分规则**：

- S 任务（总改动 <100 行）：1 个 workstream
- M 任务（100-500 行）：1-2 个 workstream
- L 任务（>500 行，或跨多个子系统）：2-4 个 workstream
- 每个 workstream 必须**独立可测试**，不能依赖另一个未完成的 workstream

**硬阈值写作规则**：

- 禁止引用内部实现（函数名、代码路径）——描述外部可观测的行为
- 量化（具体数字/字段值），避免"工作正常"这种模糊描述

### Step 2b: 写 contract-dod-ws{N}.md（每个 workstream 一份，只装 [ARTIFACT]）

```bash
# 例：workstream_count=2，生成 contract-dod-ws1.md 和 contract-dod-ws2.md
mkdir -p "${SPRINT_DIR}"

cat > "${SPRINT_DIR}/contract-dod-ws1.md" << 'DODEOF'
# Contract DoD — Workstream 1: {标题}

**范围**: {实现边界}
**大小**: S/M/L
**依赖**: 无 / Workstream X

## ARTIFACT 条目

- [ ] [ARTIFACT] MAX_RETRIES 常量定义在 packages/brain/src/retry.js
  Test: node -e "const c=require('fs').readFileSync('packages/brain/src/retry.js','utf8');if(!/const MAX_RETRIES = \d+/.test(c))process.exit(1)"

- [ ] [ARTIFACT] Learning 文件含"### 根本原因"章节
  Test: node -e "const c=require('fs').readFileSync('docs/learnings/cp-xxx.md','utf8');if(!c.includes('### 根本原因'))process.exit(1)"

## BEHAVIOR 索引（实际测试在 tests/ws1/）

见 `tests/ws1/retry.test.ts`，覆盖：
- retries 3 times on transient failure
- throws after max retries exceeded
- backs off exponentially between retries

DODEOF

# 对每个 workstream 重复
```

**严格规则**（CI 会校验，违反直接 REVISION）：

- `## ARTIFACT 条目` 区块下所有条目必须以 `- [ ] [ARTIFACT]` 开头
- **严禁** 在此文件出现 `- [ ] [BEHAVIOR]` 条目（CI `dod-structure-purity` 会 exit 1）
- Test 字段白名单：**只允许** `node -e` / `grep -c` / `test -f` / `bash`，禁止 `grep`/`ls`/`cat`/`sed`/`echo` 裸用
- BEHAVIOR 索引区只写"指针"（"见 tests/wsN/xxx.test.ts"），不写 Test 字段

### Step 2c: 写真实失败测试（每个 [BEHAVIOR] 覆盖项对应 1-N 个 it）

对每个 workstream 的 BEHAVIOR 覆盖项，写对应测试文件：

```bash
mkdir -p "${SPRINT_DIR}/tests/ws1"
cat > "${SPRINT_DIR}/tests/ws1/retry.test.ts" << 'TESTEOF'
import { describe, it, expect } from 'vitest';
import { fetchWithRetry } from '../../../../packages/brain/src/retry.js';

describe('Workstream 1 — Retry Mechanism [BEHAVIOR]', () => {
  it('retries 3 times on transient failure', async () => {
    let attempts = 0;
    const op = () => { attempts++; if (attempts < 3) throw new Error('fail'); return 'ok'; };
    const result = await fetchWithRetry(op);
    expect(result).toBe('ok');
    expect(attempts).toBe(3);
  });

  it('throws after max retries exceeded', async () => {
    const op = () => { throw new Error('always fails'); };
    await expect(fetchWithRetry(op)).rejects.toThrow('always fails');
  });

  it('backs off exponentially between retries', async () => {
    const timestamps: number[] = [];
    const op = () => { timestamps.push(Date.now()); throw new Error('fail'); };
    try { await fetchWithRetry(op); } catch {}
    expect(timestamps.length).toBeGreaterThanOrEqual(3);
    const gap1 = timestamps[1] - timestamps[0];
    const gap2 = timestamps[2] - timestamps[1];
    expect(gap2).toBeGreaterThan(gap1 * 1.5);
  });
});
TESTEOF
```

**测试文件 5 条硬约束**（Proposer 写测试时必须遵守）：

1. **真实 import** 目标模块的实际路径（如 `import { fetchWithRetry } from '../../../../packages/brain/src/retry.js'`）。不允许 mock 被测对象本身
2. **具体断言值**：`expect(x).toBe(3)`，禁止 `expect(x).toBeTruthy()` 这种弱断言
3. **测试名必须描述行为**：`it('retries 3 times on transient failure')`，禁止 `it('retry works')`——describe 和 it 的标题要一眼说清楚要验什么行为
4. **每个 it 只测一件事**（single behavior）：测试名含 "and" 就拆；一个 it 只一个核心 assertion
5. **Proposer 本地跑过并确认红** — 见 Step 2d；合同里贴 Red evidence

### Step 2d: 本地跑测试收集 Red evidence

```bash
# 跑测试，预期 FAIL（因为实现还不存在）
npx vitest run "${SPRINT_DIR}/tests/ws1/" --reporter=verbose 2>&1 | tee /tmp/ws1-red.log || true

# 确认 FAIL 数量 ≥ it() 数量
EXPECTED_RED=$(grep -c "^\s*it(" "${SPRINT_DIR}/tests/ws1/"*.test.ts | awk -F: '{s+=$2} END {print s}')
ACTUAL_RED=$(grep -cE "FAIL|✗|×" /tmp/ws1-red.log || echo 0)
if [ "$ACTUAL_RED" -lt "$EXPECTED_RED" ]; then
  echo "ERROR: 预期 $EXPECTED_RED 个红，实际 $ACTUAL_RED。测试写错了吗？"
  exit 1
fi
```

把 `/tmp/wsN-red.log` 的 FAIL 摘要填入 `contract-draft.md` 的 `## Test Contract` 表格的"预期红证据"列（形如 `WS1 → 3 failures`）。

**失败不要继续**：如果测试写得过于严/命名冲突/import 错，本地跑不红 → Reviewer 实跑时也跑不红 → 被 REVISION。先在本地修好。

### Step 3: 建分支 + push + 输出 verdict

**重要**：在独立 cp-* 分支上 push，不能推 main。

```bash
TASK_ID_SHORT=$(echo "${TASK_ID}" | cut -c1-8)
PROPOSE_BRANCH="cp-harness-propose-r${PROPOSE_ROUND}-${TASK_ID_SHORT}"
git checkout -b "${PROPOSE_BRANCH}" 2>/dev/null || git checkout "${PROPOSE_BRANCH}"

# 统计测试文件总数（跨所有 workstream）
TEST_FILES_COUNT=$(find "${SPRINT_DIR}/tests" -name "*.test.ts" 2>/dev/null | wc -l | tr -d ' ')

git add "${SPRINT_DIR}/contract-draft.md" \
        "${SPRINT_DIR}/contract-dod-ws"*.md \
        "${SPRINT_DIR}/tests/ws"*/
git commit -m "feat(contract): round-${PROPOSE_ROUND} draft + DoD (ARTIFACT only) + failing tests (Red)"
git push origin "${PROPOSE_BRANCH}"
```

**最后一条消息**（字面量 JSON，不要用代码块包裹）：

```
{"verdict": "PROPOSED", "contract_draft_path": "${SPRINT_DIR}/contract-draft.md", "propose_branch": "cp-harness-propose-r1-xxxxxxxx", "workstream_count": N, "test_files_count": M}
```

其中 `M` 是产出的 `.test.ts` 文件总数。

---

## 禁止事项

1. **严禁在 contract-dod-ws{N}.md 出现 [BEHAVIOR] 条目**——运行时行为必须写进 `tests/ws{N}/*.test.ts`
2. **严禁写假测试**：`expect(x).toBeTruthy()` / `it('works')` / `if (result) { /* nothing */ }` 这类弱断言，都会被 Reviewer mutation 打回
3. 禁止在硬阈值里引用内部函数名/代码路径
4. 禁止 `{task_id}` 等占位符——命令必须可直接执行
5. 禁止在 main 分支操作
