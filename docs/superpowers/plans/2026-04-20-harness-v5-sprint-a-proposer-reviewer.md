# Harness v5 Sprint A 实施计划 — Proposer / Reviewer 升级

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把 `harness-contract-proposer` 和 `harness-contract-reviewer` 两个 skill 从 v4.4 升级到 v5.0，使 Proposer 产出真实 `tests/ws{N}/*.test.ts` 测试文件，使 Reviewer 做 mutation testing 挑战测试代码本身（而不只是命令）。

**Architecture:** 两个 skill 都是 markdown prompt 文件，SSOT 在 `packages/workflows/skills/`，通过 `deploy-workflow-skills.sh` 软链到 `~/.claude-accountN/skills/`。改造通过修改 SKILL.md 的"职责"、"产物"、"流程"章节实现。用结构性测试（`readFileSync` + 断言）保证 SKILL.md 含必需的新章节；用一次 dogfood 运行确认真实执行效果。

**Tech Stack:**
- Markdown（SKILL.md prompt）
- TypeScript + vitest（结构测试）
- bash（deploy 脚本）
- Node.js（Brain 派发 harness_contract_propose / harness_contract_review）

**Spec 来源：** `docs/superpowers/specs/2026-04-20-harness-dod-tdd-superpowers-fusion-design.md`（Section 5.1）

**预期分支：** `cp-<MMDDHHNN>-harness-v5-sprint-a`（Sprint A 上线 PR 分支，由实施阶段创建）

---

## File Structure

### 新建

- `packages/engine/tests/skills/harness-contract-proposer.test.ts` — Proposer 结构测试
- `packages/engine/tests/skills/harness-contract-reviewer.test.ts` — Reviewer 结构测试
- `docs/learnings/cp-<MMDDHHNN>-harness-v5-sprint-a.md` — Learning 文件（PR 前补）

### 修改

- `packages/workflows/skills/harness-contract-proposer/SKILL.md` — 版本 4.4.0 → 5.0.0，重写职责/产物/流程章节
- `packages/workflows/skills/harness-contract-reviewer/SKILL.md` — 版本 4.4.0 → 5.0.0，重写 Step 2-4

### 不动

- Brain `execution.js`（payload 字段不变）
- CI workflow 文件（Sprint A 不加硬校验；Sprint C 才加）
- `harness-generator` SKILL.md（Sprint B 改）
- vitest 根配置（Proposer 自跑测试用 `npx vitest run <path>` 就能跑，Sprint C 再加 include pattern）

---

## Task 1: 写 Proposer 结构测试（RED）

**Files:**
- Create: `packages/engine/tests/skills/harness-contract-proposer.test.ts`

**背景：** Proposer v5.0 必须在 SKILL.md 里有 6 条新规则。测试就是读 SKILL.md 断言这些字符串/章节存在。这个测试先写、先红。

- [ ] **Step 1: 写失败测试**

创建 `packages/engine/tests/skills/harness-contract-proposer.test.ts`：

```typescript
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

const SKILL_PATH = join(__dirname, '../../../workflows/skills/harness-contract-proposer/SKILL.md');

describe('harness-contract-proposer v5.0 结构', () => {
  const content = readFileSync(SKILL_PATH, 'utf8');

  it('frontmatter version 为 5.0.0', () => {
    const versionLine = content.split('\n').slice(0, 20).find(l => l.trim().startsWith('version:'));
    expect(versionLine).toBeDefined();
    expect(versionLine).toContain('5.0.0');
  });

  it('职责章节包含 3 份产物描述', () => {
    expect(content).toContain('sprint-prd.md');
    expect(content).toContain('contract-dod-ws');
    expect(content).toContain('tests/ws');
    expect(content).toMatch(/\.test\.ts/);
  });

  it('contract-dod-ws 规则明确禁止 [BEHAVIOR] 条目', () => {
    // 必须有"禁止"/"不允许"/"禁用"字样 + [BEHAVIOR] 关键词
    expect(content).toMatch(/(禁止|不允许|禁用).*\[BEHAVIOR\]|\[BEHAVIOR\].*(禁止|不允许|禁用)/s);
  });

  it('测试文件规则包含 5 条硬约束', () => {
    expect(content).toContain('真实 import');
    expect(content).toContain('具体断言');
    // 测试名描述行为
    expect(content).toMatch(/测试名|test name|describe/);
    // 每个 it 只测一件事
    expect(content).toMatch(/一件事|一个行为|single behavior/);
    // Proposer 本地跑过确认红
    expect(content).toMatch(/Red evidence|红证据|本地跑过/);
  });

  it('合同末尾要求 Test Contract 索引表', () => {
    expect(content).toContain('## Test Contract');
    // 索引表至少应提到：Workstream / Test File / 预期红
    expect(content).toContain('Test File');
    expect(content).toMatch(/预期红|Red|failures/);
  });

  it('产物路径一致：tests/ws{N}/*.test.ts 放在 sprint 目录下', () => {
    expect(content).toMatch(/\$\{SPRINT_DIR\}\/tests\/ws|sprints\/.+\/tests\/ws/);
  });

  it('changelog 有 5.0.0 条目说明产出 .test.ts 文件', () => {
    // 找到 changelog 块（frontmatter 内），5.0.0 的描述要提到测试文件
    const fmEnd = content.indexOf('\n---\n', 3);
    const fm = content.slice(0, fmEnd);
    expect(fm).toMatch(/5\.0\.0.*test|5\.0\.0.*\.test\.ts/i);
  });
});
```

- [ ] **Step 2: 跑测试，确认红**

```bash
cd /Users/administrator/perfect21/cecelia
npx vitest run packages/engine/tests/skills/harness-contract-proposer.test.ts
```

**Expected:** 7 个 `it` 全部 FAIL（因为当前 SKILL.md 是 v4.4，没这些内容）。

确认 FAIL 原因是 "expected 'proposer content' to contain '5.0.0' / '.test.ts' / 'Test Contract' 等"，不是脚本本身的 import / 路径错误。

- [ ] **Step 3: 提交红测试 commit**

```bash
git add packages/engine/tests/skills/harness-contract-proposer.test.ts
git commit -m "test(harness): proposer v5.0 结构测试 (Red)"
```

---

## Task 2: 升级 Proposer SKILL.md 到 v5.0（GREEN）

**Files:**
- Modify: `packages/workflows/skills/harness-contract-proposer/SKILL.md`

**背景：** 重写 SKILL.md 让 Task 1 的 7 个测试全绿。关键变化：(1) 产物从 2 份变 3 份 (2) contract-dod-ws 只允许 [ARTIFACT] (3) 新增 tests/ws{N}/ 测试文件生产规则 (4) 末尾附 Test Contract 索引表。

- [ ] **Step 1: 读当前 SKILL.md（了解 baseline）**

```bash
cat packages/workflows/skills/harness-contract-proposer/SKILL.md
```

**记录**：当前 v4.4.0 的 Step 1-3 结构、Workstreams 区块、Step 2b 模板。新版保留 Step 1（读 PRD）和 Step 3（建分支 + push），改动集中在 Step 2（写合同草案）和新 Step 2c（写测试文件）。

- [ ] **Step 2: 改 frontmatter（版本 + changelog）**

把 frontmatter 里：

```yaml
version: 4.4.0
```

改为：

```yaml
version: 5.0.0
```

在 `changelog:` 顶部插入一行（保留旧条目）：

```yaml
changelog:
  - 5.0.0: TDD 融合 — 合同产出 3 份产物（sprint-prd.md + contract-dod-ws{N}.md 只剩 [ARTIFACT] + tests/ws{N}/*.test.ts 真实失败测试）；合同末尾加 Test Contract 索引表
  - 4.4.0: contract-dod-ws{N}.md 写入路径改为 ${SPRINT_DIR}/contract-dod-ws{N}.md（防止多次运行时根目录文件覆盖）
  # ... 保留后续 ...
```

- [ ] **Step 3: 重写"职责"章节**

把原"职责"部分替换为：

```markdown
## 职责

读取 sprint-prd.md，提出合同草案 + 写真实失败测试。产出 **3 份产物**：

1. **`${SPRINT_DIR}/sprint-prd.md`**（不变）
2. **`${SPRINT_DIR}/contract-dod-ws{N}.md`** — 每个 workstream 一份 DoD，**只装 [ARTIFACT] 条目**（静态产出物：文件存在/内容包含/配置更新等）。**严禁 [BEHAVIOR] 条目**——运行时行为必须写进 tests/ws{N}/*.test.ts
3. **`${SPRINT_DIR}/tests/ws{N}/*.test.ts`** — 每个 workstream 一个目录，真实 vitest 失败测试（TDD Red 阶段产物）

**这是 GAN 对抗的起点**：Generator 提出测试代码，Reviewer 挑战测试是否能抓出假实现，直到双方对齐。

## DoD 分家规则

| 类型 | 装什么 | 住哪 | Test 字段允许 |
|---|---|---|---|
| **[ARTIFACT]** | 静态产物（文件/内容/配置/文档） | `contract-dod-ws{N}.md` | `node -e "fs.accessSync"` / `node -e "readFileSync + 正则"` / `grep -c` / `test -f` / `bash` |
| **[BEHAVIOR]** | 运行时行为（API 响应/函数返回/错误处理/并发） | `tests/ws{N}/*.test.ts` 的 `it()` 块 | 只允许 vitest 真测试（**禁止** `node -e` 字符串） |

**决策树（写每条 DoD 时问自己）**：

```
Q: 这个条目能不能只靠"检查文件内容或结构"验证？
  ├─ 能 → [ARTIFACT] 放 contract-dod-ws{N}.md
  └─ 不能，必须跑起来看行为 → 写 it() 放 tests/ws{N}/*.test.ts
```
```

- [ ] **Step 4: 重写 Step 2（写合同草案）**

把 Step 2 替换为：

```markdown
### Step 2: 写合同草案

写入 `${SPRINT_DIR}/contract-draft.md`：

````markdown
# Sprint Contract Draft (Round {N})

## Feature 1: {功能名}

**行为描述**:
{外部可观测行为，不引用内部代码路径}

**硬阈值**:
- {量化条件 1}
- {量化条件 2}

**BEHAVIOR 覆盖**（这些会在 tests/ws{N}/ 里落成真实 it() 块）:
- `it('retries 3 times on transient failure')`
- `it('throws after max retries exceeded')`

**ARTIFACT 覆盖**（这些会写进 contract-dod-ws{N}.md）:
- MAX_RETRIES 常量定义在 packages/brain/src/retry.js

---

## Feature 2: ...

...

---

## Workstreams

workstream_count: {N}

### Workstream 1: {标题}

**范围**: {实现边界}
**大小**: S/M/L
**依赖**: 无 / Workstream X

**BEHAVIOR 覆盖测试文件**: `tests/ws1/retry.test.ts`

### Workstream 2: ...

---

## Test Contract

| Workstream | Test File | BEHAVIOR 覆盖 | 预期红证据 |
|---|---|---|---|
| WS1 | `tests/ws1/retry.test.ts` | retries 3 times / throws after max / exponential backoff | `npx vitest run sprints/{sprint}/tests/ws1/` → 3 failures |
| WS2 | `tests/ws2/api.test.ts` | 404 missing / 422 invalid | `npx vitest run sprints/{sprint}/tests/ws2/` → 2 failures |
````
```

- [ ] **Step 5: 新增 Step 2b（写 contract-dod-ws{N}.md — 只 ARTIFACT）**

把当前 Step 2b（Workstreams 区块）+ Step 3 里的 contract-dod-ws{N}.md 写入逻辑，合并重写为：

```markdown
### Step 2b: 写 contract-dod-ws{N}.md（每个 workstream 一份，只装 [ARTIFACT]）

```bash
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
```

**严格规则**：
- `## ARTIFACT 条目` 区块下所有条目必须以 `- [ ] [ARTIFACT]` 开头
- **禁止** 在此文件出现 `[BEHAVIOR]` 条目（违反 CI 会 exit 1）
- Test 字段白名单：`node -e` / `grep -c` / `test -f` / `bash`
```

- [ ] **Step 6: 新增 Step 2c（写真实失败测试文件）**

插入新的 Step 2c（在 2b 之后，3 之前）：

```markdown
### Step 2c: 写真实失败测试（每个 [BEHAVIOR] 对应 1-N 个 it）

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

**测试文件硬约束（Proposer 写测试时必须遵守）**：

1. **真实 import** 目标模块的实际路径（`import { fetchWithRetry } from '../../../../packages/brain/src/retry.js'`）。不允许 mock 被测对象本身
2. **具体断言值**：`expect(x).toBe(3)`，不允许 `expect(x).toBeTruthy()` 这种弱断言
3. **测试名必须描述行为**：`it('retries 3 times on transient failure')`，不允许 `it('retry works')`
4. **每个 it 只测一件事**：测试名含 "and" 就拆；一个 it 只一个核心 assertion
5. **Proposer 本地跑过并确认红** — 见 Step 2d

### Step 2d: 本地跑测试收集 Red evidence

```bash
# 跑测试，预期 FAIL（因为实现还不存在）
npx vitest run "${SPRINT_DIR}/tests/ws1/" --reporter=verbose 2>&1 | tee /tmp/ws1-red.log || true

# 确认 FAIL 数量 ≥ it() 数量
EXPECTED_RED=$(grep -c "^  it(" "${SPRINT_DIR}/tests/ws1/retry.test.ts" || echo 0)
ACTUAL_RED=$(grep -cE "FAIL|✗|×" /tmp/ws1-red.log || echo 0)
if [ "$ACTUAL_RED" -lt "$EXPECTED_RED" ]; then
  echo "ERROR: 预期 $EXPECTED_RED 个红，实际 $ACTUAL_RED 个。测试写错了吗？"
  exit 1
fi
```

把 `/tmp/ws1-red.log` 的 FAIL 摘要贴进 `contract-draft.md` 的 "Test Contract" 表格的"预期红证据"列（形如 `WS1 → 3 failures`）。

**失败不要继续**：如果测试写得过于严/命名冲突/import 错，本地都跑不红，Reviewer 实跑时也跑不红 → 被 REVISION。先在本地修好。
```

- [ ] **Step 7: 改 Step 3（push commit message 包含新产物）**

把原 Step 3 的 `git add` 和 `git commit` 改成：

```bash
git add "${SPRINT_DIR}/contract-draft.md" \
        "${SPRINT_DIR}/contract-dod-ws"*.md \
        "${SPRINT_DIR}/tests/ws"*/
git commit -m "feat(contract): round-${PROPOSE_ROUND} draft + DoD (ARTIFACT only) + failing tests (Red)"
git push origin "${PROPOSE_BRANCH}"
```

最后一条 JSON 消息加一个字段：

```
{"verdict": "PROPOSED", "contract_draft_path": "...", "propose_branch": "...", "workstream_count": N, "test_files_count": M}
```

其中 `M` 是产出的 `.test.ts` 文件总数（跨所有 workstream）。

- [ ] **Step 8: 跑 Proposer 结构测试，确认全绿**

```bash
cd /Users/administrator/perfect21/cecelia
npx vitest run packages/engine/tests/skills/harness-contract-proposer.test.ts
```

**Expected:** 7 个 `it` 全部 PASS。如果某条失败，回到对应 Step 补齐 SKILL.md。

- [ ] **Step 9: 提交 SKILL.md 改动**

```bash
git add packages/workflows/skills/harness-contract-proposer/SKILL.md
git commit -m "feat(harness): proposer v5.0.0 — 3 份产物含真实失败测试"
```

---

## Task 3: 写 Reviewer 结构测试（RED）

**Files:**
- Create: `packages/engine/tests/skills/harness-contract-reviewer.test.ts`

**背景：** Reviewer v5.0 的职责从"挑战验证命令"扩展为三件事：(1) 审 DoD 结构纯度 (2) Mutation 挑战测试代码 (3) 实跑 Red 证据。测试读 SKILL.md 断言这三个章节存在。

- [ ] **Step 1: 写失败测试**

创建 `packages/engine/tests/skills/harness-contract-reviewer.test.ts`：

```typescript
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

const SKILL_PATH = join(__dirname, '../../../workflows/skills/harness-contract-reviewer/SKILL.md');

describe('harness-contract-reviewer v5.0 结构', () => {
  const content = readFileSync(SKILL_PATH, 'utf8');

  it('frontmatter version 为 5.0.0', () => {
    const versionLine = content.split('\n').slice(0, 25).find(l => l.trim().startsWith('version:'));
    expect(versionLine).toBeDefined();
    expect(versionLine).toContain('5.0.0');
  });

  it('明确 Reviewer 三件事执行顺序', () => {
    // 必须有"审 DoD 结构" / "Mutation 挑战测试" / "Red 证据实跑"三章节
    expect(content).toMatch(/审.*DoD|DoD.*纯度|DoD.*结构/);
    expect(content).toMatch(/Mutation|mutation|挑战测试/);
    expect(content).toMatch(/实跑|实际跑|npm test|npx vitest/);
  });

  it('Triple 分析升级为挑战测试代码（非仅命令）', () => {
    // Triple 结构必须提到 test_block 或 it_block 字段
    expect(content).toMatch(/test_block|it_block|it\(\)/);
    // fake_impl 字段：可运行的假实现代码
    expect(content).toMatch(/fake_impl|假实现.*代码|可运行.*假实现/);
  });

  it('DoD 结构审查规则：contract-dod-ws 不得含 [BEHAVIOR]', () => {
    expect(content).toMatch(/contract-dod-ws.*\[BEHAVIOR\]|\[BEHAVIOR\].*contract-dod-ws/s);
    expect(content).toMatch(/(禁止|不得|REVISION).*\[BEHAVIOR\]/s);
  });

  it('红证据实跑验证：Reviewer 自己 checkout 并跑 npm test', () => {
    expect(content).toMatch(/git\s+checkout.*test|checkout.*tests\/ws/);
    expect(content).toMatch(/(npx\s+)?vitest|npm\s+test/);
    expect(content).toMatch(/不红.*REVISION|红证据.*REVISION|测试不红/);
  });

  it('明确 Reviewer 心态章节（picky/无上限）', () => {
    expect(content).toMatch(/默认\s*REVISION|default.*REVISION/i);
    expect(content).toMatch(/无上限|no.*limit|没有.*轮数/i);
    expect(content).toMatch(/picky|严苛|宁可错杀/);
  });

  it('覆盖率 80% 是下限不是目标', () => {
    expect(content).toContain('80%');
    expect(content).toMatch(/下限|最少|minimum|at least/i);
  });

  it('changelog 有 5.0.0 条目说明 mutation 升级到测试代码', () => {
    const fmEnd = content.indexOf('\n---\n', 3);
    const fm = content.slice(0, fmEnd);
    expect(fm).toMatch(/5\.0\.0.*(mutation|测试代码|test.*code)/i);
  });
});
```

- [ ] **Step 2: 跑测试，确认红**

```bash
npx vitest run packages/engine/tests/skills/harness-contract-reviewer.test.ts
```

**Expected:** 8 个 `it` 全部 FAIL。

- [ ] **Step 3: 提交红测试 commit**

```bash
git add packages/engine/tests/skills/harness-contract-reviewer.test.ts
git commit -m "test(harness): reviewer v5.0 结构测试 (Red)"
```

---

## Task 4: 升级 Reviewer SKILL.md 到 v5.0（GREEN）

**Files:**
- Modify: `packages/workflows/skills/harness-contract-reviewer/SKILL.md`

- [ ] **Step 1: 读当前 SKILL.md 了解 baseline**

```bash
cat packages/workflows/skills/harness-contract-reviewer/SKILL.md
```

当前 v4.4 结构：Step 1（fetch & read）→ Step 2（Triple 分析，挑战命令）→ Step 3（APPROVED/REVISION 判断）→ Step 4a/4b（写最终合同或反馈）。

v5.0 改法：Step 1 不变。Step 2 扩为三部分（2a 审 DoD 纯度 / 2b 挑战测试代码 / 2c 实跑 Red）。Step 3 加入三部分全过才 APPROVED 的条件。Step 4a/4b 不变。另加"Reviewer 心态"章节。

- [ ] **Step 2: 改 frontmatter**

`version: 4.4.0` → `version: 5.0.0`

changelog 顶部加：

```yaml
  - 5.0.0: Mutation 对抗升级到测试代码层 — Triple 分析挑战 it() 块能否被假实现蒙过（test_block + fake_impl 字段）；新增 DoD 纯度审查（contract-dod-ws 禁 [BEHAVIOR]）；新增 Red 证据实跑验证（Reviewer 自己 checkout + npx vitest 跑）；明确 Reviewer 心态（默认 REVISION / 80% 为下限 / 无轮数上限）
```

- [ ] **Step 3: 新增"Reviewer 心态"章节（紧跟"职责"之后）**

```markdown
## Reviewer 心态（非协商）

- **默认 REVISION，除非证据充分才 APPROVED**。宁可错杀不放过
- 对每个 `it()` 块必须尝试构造 `fake_impl`——构造不出来才算"测试够严"；构造得出来就是 REVISION
- **覆盖率 80% 是下限不是目标**，能审多少审多少，越多越好
- **GAN 对抗无上限** — 没有"轮数上限"，直到 Proposer 写出真能抓假实现的测试
- 对 Proposer 的 Red 证据**必须实跑验证**（`git checkout` 后 `npx vitest`），不能只看 log 截图
- 测试实跑不红 → 立刻 REVISION，不讨论
- 不因"已经几轮了"就妥协通过。picky 到底
```

- [ ] **Step 4: 重写 Step 2 为三步（2a / 2b / 2c）**

替换原 Step 2（Triple 分析命令）为：

```markdown
### Step 2a: 审 DoD 结构纯度

```bash
# 扫所有 contract-dod-ws*.md
for dod in "${SPRINT_DIR}/contract-dod-ws"*.md; do
  # 禁止 [BEHAVIOR] 条目（BEHAVIOR 必须落进 tests/ws{N}/*.test.ts，不能留在 ARTIFACT 文件）
  if grep -qE '^\s*-\s*\[\s*[x ]?\s*\]\s*\[BEHAVIOR\]' "$dod"; then
    echo "VIOLATION: $dod 含 [BEHAVIOR] 条目，违反 DoD 分家规则"
    DOD_VIOLATION=1
  fi
  # Test 字段只允许 CI 白名单：node / grep / test -f / bash
  if grep -qE 'Test:.*(\bls\b|\bsed\b|\bawk\b|\becho\b)' "$dod"; then
    echo "VIOLATION: $dod Test 字段含非白名单命令"
    DOD_VIOLATION=1
  fi
done

[ -n "$DOD_VIOLATION" ] && echo "→ 进入 REVISION，写反馈要求 Proposer 搬 BEHAVIOR 到 tests/ws{N}/"
```

扫 BEHAVIOR 索引区：每个在 `## BEHAVIOR 索引` 下列出的 `it()` 名必须在 `tests/ws{N}/` 下的 `.test.ts` 里存在。找不到 → REVISION。

### Step 2b: Mutation 挑战测试代码（核心）

对每个 workstream 的 `tests/ws{N}/*.test.ts`，逐个 `it()` 块构造 Triple：

```json
{
  "workstream": 1,
  "test_block": "it('retries 3 times on transient failure')",
  "can_bypass": "Y/N",
  "fake_impl": "<可运行的假实现代码片段，不是纯文字描述>",
  "fix": "<若 can_bypass=Y，建议如何加强测试>"
}
```

**`can_bypass: Y` 的判断标准**（能想出任一种假实现让测试通过但行为错）：

- 测试只断言返回值类型不断言值 → Y
- 测试只检查"没有抛异常"不检查实际结果 → Y
- 测试断言值是空对象 `{}` 或空数组 `[]` 这类弱值 → Y
- 测试里 mock 了被测对象本身 → Y
- 测试名含 "works" / "correct" 等泛词但没具体断言 → Y
- 测试覆盖 happy path 但没覆盖异常/边界 → Y（覆盖度问题）

**`fake_impl` 字段硬要求**（proof-of-falsification）：

必须是可直接执行的代码片段。示例：

```javascript
// Test: it('retries 3 times on transient failure')
// fake_impl: 返回固定值，不重试；测试里 attempts 的断言必须抓到这个
async function fetchWithRetry(op) {
  return 'ok';  // 永远成功第一次，attempts 永远是 1
}
// 如果测试断言 expect(attempts).toBe(3)，这个假实现抓得到 → can_bypass: N
// 如果测试只断言 expect(result).toBe('ok')，这个假实现通过 → can_bypass: Y
```

**禁止纯文字描述**（如"可以写一个只返回 'ok' 的函数"），必须贴可运行代码。

**覆盖率要求**：对至少 80% 的 `it()` 块做 Triple 分析。**80% 是下限不是目标。**

### Step 2c: 红证据实跑验证

**不信 Proposer 贴的 Red log，自己跑。**

```bash
# 拉 propose 分支
git fetch origin "${PROPOSE_BRANCH}"

# checkout 测试文件到本地 review worktree
git checkout "origin/${PROPOSE_BRANCH}" -- "${SPRINT_DIR}/tests/"

# 逐 workstream 跑测试
for ws_dir in "${SPRINT_DIR}/tests/ws"*/; do
  WS_NUM=$(basename "$ws_dir" | sed 's/ws//')
  EXPECTED_RED=$(grep -c "^\s*it(" "$ws_dir"/*.test.ts | awk -F: '{s+=$2} END {print s}')

  npx vitest run "$ws_dir" --reporter=verbose 2>&1 | tee "/tmp/reviewer-ws${WS_NUM}.log" || true
  ACTUAL_RED=$(grep -cE "FAIL|✗|×" "/tmp/reviewer-ws${WS_NUM}.log" || echo 0)

  if [ "$ACTUAL_RED" -lt "$EXPECTED_RED" ]; then
    echo "VIOLATION: WS${WS_NUM} 预期 $EXPECTED_RED 个红，实际 $ACTUAL_RED — 测试可能本身就能过（假红）"
    RED_VIOLATION=1
  fi
done

[ -n "$RED_VIOLATION" ] && echo "→ REVISION：测试写得能过，不是真失败"
```

任何一条不红 → 立刻 REVISION，不进入 APPROVED 判断。
```

- [ ] **Step 5: 改 Step 3（APPROVED 条件加强）**

替换 APPROVED 条件块为：

```markdown
**APPROVED 条件**（必须全部满足）：

1. **Step 2a 通过**：所有 `contract-dod-ws*.md` 只含 [ARTIFACT] 条目；BEHAVIOR 索引项都在 `tests/ws{N}/` 有对应 `it()`
2. **Step 2b 通过**：≥ 80% 的 `it()` 块被 Triple 分析；所有 Triple 的 `can_bypass` 都是 `N`（`fake_impl` 都构造失败）
3. **Step 2c 通过**：Reviewer 实跑测试，每个 workstream 的红数 ≥ 预期红数
4. **合同包含 `## Test Contract` 索引表**，每行 `Test File` 实际存在
5. PRD 里的功能点全部有对应 `it()` 块

**REVISION 条件**（任一满足即打回）：

- contract-dod-ws*.md 含 [BEHAVIOR] 条目
- 任一 Triple 的 `can_bypass: Y`（测试能被假实现蒙过）
- 覆盖率 < 80%
- Reviewer 实跑测试不红（测试能在没有实现的情况下通过 = 假红）
- 测试名是 "works" / "correct" 这类泛词
- BEHAVIOR 索引里列的 `it()` 名在测试文件里找不到
```

- [ ] **Step 6: 改 Step 4b（REVISION 反馈格式）**

反馈文件内容升级为包含 3 类问题：

```markdown
# Contract Review Feedback (Round N)

**判决**: REVISION

## 必须修改项

### [DoD 纯度] Workstream X — contract-dod-wsX.md 含 [BEHAVIOR]
原始条目:
```
- [ ] [BEHAVIOR] 重试三次
  Test: node -e "..."
```
修复建议: 把这条搬到 `tests/wsX/retry.test.ts`，写成 `it('retries 3 times ...')`

### [测试弱] Workstream X — it('retry works') 可被假实现蒙过
原始测试代码:
```typescript
it('retry works', async () => {
  const result = await fetchWithRetry(fn);
  expect(result).toBeTruthy();  // 弱断言
});
```
假实现（proof-of-falsification）:
```javascript
function fetchWithRetry() { return 'anything-truthy'; }  // 永远通过
```
修复建议: 断言具体值 + 断言重试次数
```typescript
expect(result).toBe('ok');
expect(attempts).toBe(3);  // 证明真的重试了
```

### [假红] Workstream X — 测试本地能过（不是真的红）
证据:
```
npx vitest run sprints/xxx/tests/wsX/ → PASS (0 failures)
```
原因: 被测模块已经存在且正好满足测试；或测试里全部 mock；或 import 路径错了导致 describe 被跳过
修复建议: 检查 import 路径 / 移除对被测对象本身的 mock

## 可选改进
- ...
```

- [ ] **Step 7: 跑 Reviewer 结构测试确认全绿**

```bash
npx vitest run packages/engine/tests/skills/harness-contract-reviewer.test.ts
```

**Expected:** 8 个 `it` 全部 PASS。

- [ ] **Step 8: 提交 Reviewer SKILL.md**

```bash
git add packages/workflows/skills/harness-contract-reviewer/SKILL.md
git commit -m "feat(harness): reviewer v5.0.0 — mutation 升级到测试代码 + DoD 纯度审查 + Red 实跑"
```

---

## Task 5: 部署 skills 到 account3 符号链接

**Files:**
- Run: `packages/workflows/scripts/deploy-workflow-skills.sh`

**背景：** SSOT 在 `packages/workflows/skills/`，但实际跑的是 `~/.claude-account3/skills/` 里的软链。deploy 脚本创建或更新软链。

- [ ] **Step 1: dry-run 看会做什么**

```bash
bash packages/workflows/scripts/deploy-workflow-skills.sh --account 3 --dry-run
```

**Expected:** 输出 harness-contract-proposer / harness-contract-reviewer 两条（如果是软链则 "已存在"，否则创建）。

- [ ] **Step 2: 实跑 deploy**

```bash
bash packages/workflows/scripts/deploy-workflow-skills.sh --account 3
```

- [ ] **Step 3: 验证软链正确指向**

```bash
ls -la ~/.claude-account3/skills/harness-contract-proposer ~/.claude-account3/skills/harness-contract-reviewer
```

**Expected:** 两个都是软链，目标路径含 `packages/workflows/skills/harness-contract-*`。

如果旧版是真实文件（非软链），需要先删再跑 deploy：

```bash
rm -rf ~/.claude-account3/skills/harness-contract-proposer
rm -rf ~/.claude-account3/skills/harness-contract-reviewer
bash packages/workflows/scripts/deploy-workflow-skills.sh --account 3
ls -la ~/.claude-account3/skills/harness-contract-proposer  # 应是软链
```

- [ ] **Step 4: 读软链目标确认是 v5.0.0**

```bash
head -20 ~/.claude-account3/skills/harness-contract-proposer/SKILL.md
head -20 ~/.claude-account3/skills/harness-contract-reviewer/SKILL.md
```

**Expected:** frontmatter 都是 `version: 5.0.0`。

（这一步无代码改动，不需要 commit。）

---

## Task 6: 写 Sprint A DoD.md 和 Learning

**Files:**
- Create: `DoD.md`（PR 根目录）
- Create: `docs/learnings/cp-<MMDDHHNN>-harness-v5-sprint-a.md`

- [ ] **Step 1: 写 DoD.md**

```markdown
# DoD — Harness v5 Sprint A: Proposer / Reviewer 升级

## ARTIFACT 条目

- [x] [ARTIFACT] Proposer SKILL.md 版本为 5.0.0
  Test: node -e "const c=require('fs').readFileSync('packages/workflows/skills/harness-contract-proposer/SKILL.md','utf8');if(!/version:\s*5\.0\.0/.test(c))process.exit(1)"

- [x] [ARTIFACT] Reviewer SKILL.md 版本为 5.0.0
  Test: node -e "const c=require('fs').readFileSync('packages/workflows/skills/harness-contract-reviewer/SKILL.md','utf8');if(!/version:\s*5\.0\.0/.test(c))process.exit(1)"

- [x] [ARTIFACT] Proposer SKILL.md 含 3 份产物描述
  Test: node -e "const c=require('fs').readFileSync('packages/workflows/skills/harness-contract-proposer/SKILL.md','utf8');if(!c.includes('tests/ws'))process.exit(1);if(!/\.test\.ts/.test(c))process.exit(2);if(!c.includes('Test Contract'))process.exit(3)"

- [x] [ARTIFACT] Reviewer SKILL.md 含"Reviewer 心态"章节
  Test: node -e "const c=require('fs').readFileSync('packages/workflows/skills/harness-contract-reviewer/SKILL.md','utf8');if(!c.includes('Reviewer 心态'))process.exit(1);if(!c.includes('无上限'))process.exit(2)"

- [x] [ARTIFACT] Reviewer SKILL.md 的 Step 2b 含 fake_impl 规则
  Test: node -e "const c=require('fs').readFileSync('packages/workflows/skills/harness-contract-reviewer/SKILL.md','utf8');if(!c.includes('fake_impl'))process.exit(1);if(!c.includes('proof-of-falsification'))process.exit(2)"

- [x] [ARTIFACT] 结构测试文件存在
  Test: node -e "require('fs').accessSync('packages/engine/tests/skills/harness-contract-proposer.test.ts');require('fs').accessSync('packages/engine/tests/skills/harness-contract-reviewer.test.ts')"

- [x] [ARTIFACT] Learning 文件含根本原因
  Test: node -e "const fs=require('fs');const files=fs.readdirSync('docs/learnings').filter(f=>f.includes('harness-v5-sprint-a'));if(files.length===0)process.exit(1);const c=fs.readFileSync('docs/learnings/'+files[0],'utf8');if(!c.includes('### 根本原因'))process.exit(2)"

## BEHAVIOR 索引

见 `packages/engine/tests/skills/harness-contract-proposer.test.ts`（7 个 it）+ `harness-contract-reviewer.test.ts`（8 个 it），共 15 个结构性 behavior 断言。
```

- [ ] **Step 2: 写 Learning 文件**

```bash
BRANCH_NAME=$(git branch --show-current)
LEARNING_FILE="docs/learnings/${BRANCH_NAME}.md"
cat > "$LEARNING_FILE" << 'EOF'
# Learning — Harness v5 Sprint A: Proposer / Reviewer 升级

### 根本原因

Harness v4.x 的 DoD 用 `node -e "readFileSync + 正则"` 这类字符串检查充当 BEHAVIOR 测试，Generator 可以"写实现 + 让 grep 过"。Reviewer 的 Triple 挑战只打到"命令"层，打不到"测试代码本身"。

Sprint A 的修法：让 Proposer 产出**真实 vitest 测试文件**（作为合同一部分），让 Reviewer 挑战**测试代码**（Mutation testing：能否写假实现让测试过但行为错）。DoD 分家——静态 ARTIFACT 留 DoD.md，运行时 BEHAVIOR 搬进 .test.ts。

### 下次预防

- [ ] 未来写新 skill 流程时，区分 [ARTIFACT]（文件级检查）和 [BEHAVIOR]（运行时测试），不要让 BEHAVIOR 降级成 grep
- [ ] GAN 对抗无上限 + Reviewer picky 心态写进 SKILL.md，不靠 AI 自觉
- [ ] 合同产物必须可独立验证（Proposer 写的测试，Reviewer 必须能 checkout 跑一遍）
- [ ] 结构性测试（读 SKILL.md 检查章节）是 prompt engineering 的唯一自动化防护，必须补全
EOF
```

- [ ] **Step 3: 提交 DoD + Learning**

```bash
git add DoD.md "$LEARNING_FILE"
git commit -m "docs(harness): Sprint A DoD + Learning"
```

---

## Task 7: Dogfood 端到端验证（手动）

**Files:** 不改代码，只运行验证。

**背景：** 结构测试只能保证 SKILL.md 含必需章节，不能保证 LLM 实际按这些章节执行。需要一次端到端运行（派一个小型 harness task 给新 Proposer + Reviewer）确认实际效果。

- [ ] **Step 1: 挑选一个已完成的历史 PRD 作 fixture**

选择 `sprints/archive/harness-self-check-v2/` 里的 sprint-prd.md（已归档的简单 PRD），或临时写一个最小 PRD。

准备一个最小 PRD（如果 archive 还没归档可以临时起一个新 sprint dir）：

```bash
mkdir -p sprints/dogfood-v5-sprint-a
cat > sprints/dogfood-v5-sprint-a/sprint-prd.md << 'EOF'
# Sprint PRD — Retry 工具

## 功能

为 `packages/brain/src/retry.js` 添加 `fetchWithRetry(op)` 函数：
- 调用 op，失败最多重试 3 次
- 指数退避：每次间隔至少是上次 1.5 倍
- 超过 3 次后抛出原异常

## 成功标准

- 函数从未导出的模块导出
- 3 次重试能成功
- 指数退避能观测到
- 超限抛异常
EOF
```

- [ ] **Step 2: 通过 Brain 派发 Proposer 任务**

```bash
# 假设 Brain 跑在 localhost:5221
curl -X POST localhost:5221/api/brain/tasks \
  -H "Content-Type: application/json" \
  -d '{
    "task_type": "harness_contract_propose",
    "payload": {
      "sprint_dir": "sprints/dogfood-v5-sprint-a",
      "planner_branch": "'"$(git branch --show-current)"'",
      "propose_round": 1
    },
    "priority": 10
  }'
```

等待任务完成（5-10 分钟，取决于 LLM 速度）。

- [ ] **Step 3: 检查 Proposer 输出符合 v5.0**

```bash
# 拉 propose 分支
PROPOSE_BRANCH=$(curl -s "localhost:5221/api/brain/tasks?task_type=harness_contract_propose&limit=1" | jq -r '.tasks[0].result.propose_branch')
git fetch origin "$PROPOSE_BRANCH"

# 检查 3 份产物都在
git show "origin/$PROPOSE_BRANCH" --stat | grep -E "contract-draft|contract-dod-ws|tests/ws"

# 抽查：contract-dod-ws 不含 [BEHAVIOR]
git show "origin/$PROPOSE_BRANCH:sprints/dogfood-v5-sprint-a/contract-dod-ws1.md" | grep -c '\[BEHAVIOR\]'
# Expected: 0（只能在"BEHAVIOR 索引"区出现，但那是 header 不是条目）

# 抽查：tests/ws1/*.test.ts 有真实 it 块
git show "origin/$PROPOSE_BRANCH:sprints/dogfood-v5-sprint-a/tests/ws1/retry.test.ts" | grep -c "^\s*it("
# Expected: ≥ 3

# 抽查：contract-draft.md 有 Test Contract 表
git show "origin/$PROPOSE_BRANCH:sprints/dogfood-v5-sprint-a/contract-draft.md" | grep -c "## Test Contract"
# Expected: 1
```

**失败排查：** 任一检查失败 → Proposer SKILL.md 的提示词没 work，回 Task 2 补齐。

- [ ] **Step 4: 通过 Brain 派发 Reviewer 任务**

```bash
curl -X POST localhost:5221/api/brain/tasks \
  -H "Content-Type: application/json" \
  -d '{
    "task_type": "harness_contract_review",
    "payload": {
      "sprint_dir": "sprints/dogfood-v5-sprint-a",
      "planner_branch": "'"$(git branch --show-current)"'",
      "propose_branch": "'"$PROPOSE_BRANCH"'"
    },
    "priority": 10
  }'
```

等待完成。

- [ ] **Step 5: 检查 Reviewer 做了 mutation 挑战**

```bash
REVIEW_BRANCH=$(curl -s "localhost:5221/api/brain/tasks?task_type=harness_contract_review&limit=1" | jq -r '.tasks[0].result.review_branch')
git fetch origin "$REVIEW_BRANCH"

# 如果 REVISION：反馈文件应含 fake_impl 代码片段
git show "origin/$REVIEW_BRANCH:sprints/dogfood-v5-sprint-a/contract-review-feedback.md" | grep -cE 'fake_impl|假实现'
# Expected: ≥ 1

# 如果 APPROVED：合同文件存在
git show "origin/$REVIEW_BRANCH:sprints/dogfood-v5-sprint-a/sprint-contract.md" | head -5
```

**成功标志：** Reviewer 做出了基于测试代码的挑战（不是单纯挑战命令），并且反馈/合同里能看到 Triple 结构（test_block + can_bypass + fake_impl）。

- [ ] **Step 6: 记录 dogfood 结果到 Learning 文件**

```bash
cat >> "$LEARNING_FILE" << EOF

### Dogfood 验证结果

- Propose 分支：$PROPOSE_BRANCH
- Review 分支：$REVIEW_BRANCH
- Reviewer 裁决：<填 APPROVED/REVISION>
- GAN 轮次：<填几轮>
- 观察到的问题：<填，如果有>
EOF

git add "$LEARNING_FILE"
git commit -m "docs(harness): Sprint A dogfood 验证记录"
```

- [ ] **Step 7: 清理 dogfood sprint 目录**（如果是临时创建的）

```bash
git rm -rf sprints/dogfood-v5-sprint-a/
git commit -m "chore(harness): 删 dogfood 临时 sprint 目录"
```

---

## Task 8: push + PR + 等 CI 绿 + 合并

**Files:** 不改代码。

- [ ] **Step 1: 本地跑一次全部结构测试**

```bash
npx vitest run packages/engine/tests/skills/harness-contract-proposer.test.ts packages/engine/tests/skills/harness-contract-reviewer.test.ts
```

**Expected:** 15 个 `it` 全 PASS。

- [ ] **Step 2: 跑 DoD 映射检查**

```bash
node packages/engine/scripts/devgate/check-dod-mapping.cjs
```

**Expected:** PASS，每个 DoD 条目能映射到 test。

- [ ] **Step 3: push**

```bash
git push -u origin HEAD
```

- [ ] **Step 4: 创建 PR**

```bash
gh pr create --title "feat(harness): v5 Sprint A — Proposer/Reviewer 升级到 TDD 合同" \
  --body "$(cat <<'BODY'
## Summary
- Proposer 4.4.0 → 5.0.0：产出 3 份（sprint-prd + contract-dod-ws 只 ARTIFACT + tests/ws{N}/*.test.ts 真实失败测试）
- Reviewer 4.4.0 → 5.0.0：Mutation 挑战从命令升级到测试代码；新增 DoD 纯度审查 + Red 证据实跑验证
- 加 "Reviewer 心态"章节：默认 REVISION / 80% 下限 / 无轮数上限 / picky 到底
- 新增 15 个结构测试（packages/engine/tests/skills/）

Spec: docs/superpowers/specs/2026-04-20-harness-dod-tdd-superpowers-fusion-design.md

## Test plan
- [x] 结构测试全绿（15/15）
- [x] DoD mapping check 通过
- [x] Dogfood 端到端跑通：Proposer 产出 3 份产物 + Reviewer 做 mutation 挑战

🤖 Generated with [Claude Code](https://claude.com/claude-code)
BODY
)"
```

- [ ] **Step 5: 等 CI 绿**

```bash
# foreground 阻塞等 CI
until [[ $(gh pr checks --json bucket --jq '[.[] | select(.bucket=="pending")] | length') == 0 ]]; do
  sleep 30
done
gh pr checks
```

**Expected:** 全绿。

- [ ] **Step 6: 合并**

```bash
gh pr merge --squash
```

---

## Self-Review Checklist

**Spec 覆盖：**
- Section 5.1 Proposer 3 份产物 → Task 2 Steps 3-6 ✓
- Section 5.1 Reviewer 3 件事（DoD 纯度 / mutation 挑战 / Red 实跑）→ Task 4 Steps 4-5 ✓
- Section 5.1 Reviewer 心态章节 → Task 4 Step 3 ✓
- Section 4.1 DoD 分家规则 → Task 2 Step 3 ✓
- Section 4.4 tests/ws{N}/ 测试文件格式 → Task 2 Step 6 ✓
- Section 4.5 测试 5 条硬约束 → Task 2 Step 6 ✓
- GAN 无上限 + picky 原则 → Task 4 Step 3 ✓

**类型一致性：** frontmatter `version` 字段格式、`changelog` 条目格式在 Task 2 Step 2 和 Task 4 Step 2 一致；测试文件路径 `tests/ws{N}/*.test.ts` 在 SKILL.md / 测试 / dogfood 各处一致；`fake_impl` 字段名在 Reviewer SKILL.md / 结构测试 / 反馈模板一致。

**放在 Sprint B 的（不在本计划）：**
- harness-generator SKILL.md 升级 → Sprint B
- 4 个 superpowers 融合到 generator → Sprint B

**放在 Sprint C 的（不在本计划）：**
- CI 硬校验（dod-structure-purity / test-coverage / tdd-commit-order / tests-actually-pass）→ Sprint C
- vitest include `sprints/**/tests/**` → Sprint C
- 老 sprint 归档到 `sprints/archive/` → Sprint C（独立 PR）

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-04-20-harness-v5-sprint-a-proposer-reviewer.md`.

**两种执行方式**：

**1. Subagent-Driven（推荐）** — 每个 Task 派一个 fresh subagent 实现，Task 之间 review。快速迭代。

**2. Inline Execution** — 当前 session 顺序执行所有 Task，中途加检查点。

请告诉我选哪种方式。
