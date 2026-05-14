# B35 — Sprint Dir 从 Planner Verdict 提取 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 修复 `parsePrdNode` 只读 `state.task?.payload?.sprint_dir` 而不读 planner verdict JSON 中 `sprint_dir` 的 bug，让 harness pipeline 能正确传递子目录路径给 GAN。

**Architecture:** 在 `parsePrdNode` 初始化 `sprintDir` 变量后，立即用 regex 从 `state.plannerOutput` 提取 `"sprint_dir"` 字段。提取成功则覆盖 payload 默认值，失败则保持原有 fallback 逻辑。B34 的 readdir subdir scan 作为 last-resort 保留。

**Tech Stack:** Node.js ESM, vitest, harness-initiative.graph.js

---

### Task 1: 写失败测试

**Files:**
- Create: `packages/brain/src/workflows/__tests__/harness-initiative-b35.test.js`

- [ ] **Step 1: 创建测试文件**

```js
// packages/brain/src/workflows/__tests__/harness-initiative-b35.test.js
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { parsePrdNode } from '../harness-initiative.graph.js';

// Mock readFile / readdir — parsePrdNode 用 node:fs/promises 的顶层导入
vi.mock('node:fs/promises', () => ({
  readFile: vi.fn(),
  readdir: vi.fn(),
}));
import * as fsPromises from 'node:fs/promises';

describe('parsePrdNode — B35: extract sprint_dir from planner verdict', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('从 planner verdict JSON 提取 sprint_dir，直接读对应子目录', async () => {
    const plannerOutput = JSON.stringify({
      verdict: 'DONE',
      branch: 'cp-w45-test',
      sprint_dir: 'sprints/w45-b35-test',
    });
    fsPromises.readFile.mockResolvedValue('# PRD content for w45');

    const result = await parsePrdNode({
      worktreePath: '/fake/worktree',
      plannerOutput,
      task: { payload: { sprint_dir: 'sprints' } },  // payload 是 'sprints'（未知子目录）
      initiativeId: 'test-initiative',
    });

    expect(result.sprintDir).toBe('sprints/w45-b35-test');
    expect(result.prdContent).toBe('# PRD content for w45');
    // 验证读取的是正确路径（含子目录）
    expect(fsPromises.readFile).toHaveBeenCalledWith(
      '/fake/worktree/sprints/w45-b35-test/sprint-prd.md',
      'utf8'
    );
    // B34 readdir 不应被调用（直接命中）
    expect(fsPromises.readdir).not.toHaveBeenCalled();
  });

  it('plannerOutput 不含 sprint_dir 时 fallback 到 payload', async () => {
    const plannerOutput = JSON.stringify({ verdict: 'DONE', branch: 'cp-test' }); // 无 sprint_dir
    fsPromises.readFile.mockResolvedValue('# PRD from payload dir');

    const result = await parsePrdNode({
      worktreePath: '/fake/worktree',
      plannerOutput,
      task: { payload: { sprint_dir: 'sprints/w99-specific' } },
      initiativeId: 'test-initiative',
    });

    expect(result.sprintDir).toBe('sprints/w99-specific');
    expect(fsPromises.readFile).toHaveBeenCalledWith(
      '/fake/worktree/sprints/w99-specific/sprint-prd.md',
      'utf8'
    );
  });

  it('plannerOutput 非 JSON 时 graceful fallback', async () => {
    const plannerOutput = 'planner failed with some error text';
    fsPromises.readFile.mockResolvedValue('# PRD content');

    const result = await parsePrdNode({
      worktreePath: '/fake/worktree',
      plannerOutput,
      task: { payload: { sprint_dir: 'sprints/w88-fallback' } },
      initiativeId: 'test-initiative',
    });

    expect(result.sprintDir).toBe('sprints/w88-fallback');
    // 不应该抛出异常
  });

  it('plannerOutput 内嵌在多行文本中时用 regex 提取', async () => {
    // planner 有时输出文本后跟 JSON
    const plannerOutput = 'Some prefix text\n{"verdict":"DONE","sprint_dir":"sprints/w77-embedded","branch":"cp-x"}';
    fsPromises.readFile.mockResolvedValue('# PRD');

    const result = await parsePrdNode({
      worktreePath: '/fake/worktree',
      plannerOutput,
      task: { payload: { sprint_dir: 'sprints' } },
      initiativeId: 'test-initiative',
    });

    expect(result.sprintDir).toBe('sprints/w77-embedded');
  });

  it('cache hit: taskPlan + prdContent 都存在时跳过重复执行', async () => {
    const result = await parsePrdNode({
      taskPlan: { tasks: [] },
      prdContent: '# cached',
      sprintDir: 'sprints/w-cached',
      worktreePath: '/fake',
      plannerOutput: '{}',
      task: { payload: {} },
      initiativeId: 'x',
    });

    expect(result.sprintDir).toBe('sprints/w-cached');
    expect(fsPromises.readFile).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: 确认测试失败**

```bash
cd /Users/administrator/worktrees/cecelia/b35-sprint-dir-from-planner-verdict
npx vitest run packages/brain/src/workflows/__tests__/harness-initiative-b35.test.js 2>&1 | tail -30
```

预期：第 1 个测试失败（`sprintDir` 仍为 `'sprints'` 而非 `'sprints/w45-b35-test'`），其余可能通过。

- [ ] **Step 3: 提交 fail test**

```bash
cd /Users/administrator/worktrees/cecelia/b35-sprint-dir-from-planner-verdict
git add packages/brain/src/workflows/__tests__/harness-initiative-b35.test.js
git commit -m "test(harness): B35 — parsePrdNode sprint_dir extraction fail tests"
```

---

### Task 2: 实现修复 + 通过测试

**Files:**
- Modify: `packages/brain/src/workflows/harness-initiative.graph.js:647`

- [ ] **Step 1: 在 `parsePrdNode` 中插入 planner verdict 提取逻辑**

找到 line 647 附近：
```js
  let sprintDir = state.task?.payload?.sprint_dir || 'sprints';
  let prdContent = state.plannerOutput || '';
```

改为：
```js
  let sprintDir = state.task?.payload?.sprint_dir || 'sprints';
  // B35: 从 planner verdict JSON 提取 sprint_dir（精确，不靠文件扫描）
  const sprintDirMatch = (state.plannerOutput || '').match(/"sprint_dir"\s*:\s*"([^"]+)"/);
  if (sprintDirMatch) sprintDir = sprintDirMatch[1];
  let prdContent = state.plannerOutput || '';
```

这 2 行插入在 `let sprintDir = ...` 之后、`let prdContent = ...` 之前。regex 方式比 `JSON.parse` 更鲁棒（plannerOutput 可能是多行文本含 JSON）。

- [ ] **Step 2: 运行测试确认全部通过**

```bash
cd /Users/administrator/worktrees/cecelia/b35-sprint-dir-from-planner-verdict
npx vitest run packages/brain/src/workflows/__tests__/harness-initiative-b35.test.js 2>&1 | tail -20
```

预期：5 tests passed。

- [ ] **Step 3: 运行现有 harness-initiative 测试确认无回归**

```bash
cd /Users/administrator/worktrees/cecelia/b35-sprint-dir-from-planner-verdict
npx vitest run packages/brain/src/workflows/__tests__/ 2>&1 | tail -30
```

预期：所有测试通过（包括已有 harness-initiative 测试）。

- [ ] **Step 4: 提交实现**

```bash
cd /Users/administrator/worktrees/cecelia/b35-sprint-dir-from-planner-verdict
git add packages/brain/src/workflows/harness-initiative.graph.js
git commit -m "fix(harness): B35 — parsePrdNode 从 planner verdict 提取 sprint_dir"
```

---

### Task 3: Learning 文件 + DevGate + PRD/DoD

**Files:**
- Create: `docs/learnings/cp-0514151213-b35-sprint-dir-from-planner-verdict.md`
- Create: `.raw-prd-cp-0514151213-b35-sprint-dir-from-planner-verdict.md`

- [ ] **Step 1: 写 Learning 文件**

```bash
cat > /Users/administrator/worktrees/cecelia/b35-sprint-dir-from-planner-verdict/docs/learnings/cp-0514151213-b35-sprint-dir-from-planner-verdict.md << 'EOF'
# B35 — parsePrdNode sprint_dir 提取问题

### 根本原因

B34 添加了 subdir scan fallback，但 `sprints/` 目录在 git 历史中含有所有旧 sprint（w19-w44），readdir 按字母顺序返回，先找到 `w19-playground-sum/sprint-prd.md` 而非当前 sprint。

`parsePrdNode` 只读 `state.task?.payload?.sprint_dir`（值为 `'sprints'`），而 planner skill 的 verdict JSON 明确包含正确的子目录路径 `sprint_dir: "sprints/w45-xxx"`，但从未被提取。

### 下次预防

- [ ] planner 类 node 输出 JSON verdict 时，消费者 node 必须在第一步提取关键字段
- [ ] harness 新增状态字段后，检查所有赋值路径（payload / verdict / state）优先级
- [ ] subdir scan fallback 不适合存在历史目录的 git worktree 场景
EOF
```

- [ ] **Step 2: 写 PRD/DoD 文件**

```bash
cat > /Users/administrator/worktrees/cecelia/b35-sprint-dir-from-planner-verdict/.raw-prd-cp-0514151213-b35-sprint-dir-from-planner-verdict.md << 'EOF'
# B35 — parsePrdNode sprint_dir 从 planner verdict 提取

## 背景

B34 的 subdir scan fallback 因 git 历史 sprint 目录按字母顺序先被匹配而失效，导致 W45 validation run 失败（proposer 收到 HARNESS_SPRINT_DIR=sprints 而非正确子目录）。

## 目标

`parsePrdNode` 优先从 `state.plannerOutput` 的 verdict JSON 提取 `sprint_dir` 字段，确保 GAN 收到正确的 sprintDir。

## 成功标准

- [ ] `parsePrdNode` 当 plannerOutput 含 `"sprint_dir":"sprints/xxx"` 时，state.sprintDir 正确设置为 `sprints/xxx`
- [ ] `parsePrdNode` 当 plannerOutput 不含 sprint_dir 时，正常 fallback 到 payload
- [ ] 5 个单元测试通过
- [ ] 现有 harness-initiative 测试无回归

## DoD

- [x] [ARTIFACT] `packages/brain/src/workflows/__tests__/harness-initiative-b35.test.js` 存在
  Test: `node -e "require('fs').accessSync('packages/brain/src/workflows/__tests__/harness-initiative-b35.test.js')"`
- [x] [BEHAVIOR] parsePrdNode 从 planner verdict 提取 sprint_dir
  Test: `tests/packages/brain/src/workflows/__tests__/harness-initiative-b35.test.js`
- [x] [ARTIFACT] `docs/learnings/cp-0514151213-b35-sprint-dir-from-planner-verdict.md` 存在
  Test: `node -e "require('fs').accessSync('docs/learnings/cp-0514151213-b35-sprint-dir-from-planner-verdict.md')"`
EOF
```

- [ ] **Step 3: 运行 DevGate**

```bash
cd /Users/administrator/worktrees/cecelia/b35-sprint-dir-from-planner-verdict
node scripts/facts-check.mjs && echo "facts-check OK"
bash scripts/check-version-sync.sh && echo "version-sync OK"
node packages/engine/scripts/devgate/check-dod-mapping.cjs && echo "dod-mapping OK"
```

预期：全部输出 OK。

- [ ] **Step 4: 提交 Learning + PRD**

```bash
cd /Users/administrator/worktrees/cecelia/b35-sprint-dir-from-planner-verdict
git add docs/learnings/cp-0514151213-b35-sprint-dir-from-planner-verdict.md \
        .raw-prd-cp-0514151213-b35-sprint-dir-from-planner-verdict.md
git commit -m "docs(learning): B35 sprint_dir extraction — root cause + prevention"
```

---

### Task 4: Push + PR

- [ ] **Step 1: 确认分支和 worktree 状态**

```bash
cd /Users/administrator/worktrees/cecelia/b35-sprint-dir-from-planner-verdict
git log --oneline -5
git status
```

- [ ] **Step 2: Push**

```bash
cd /Users/administrator/worktrees/cecelia/b35-sprint-dir-from-planner-verdict
git push -u origin cp-0514151213-b35-sprint-dir-from-planner-verdict
```

- [ ] **Step 3: 创建 PR**

```bash
cd /Users/administrator/worktrees/cecelia/b35-sprint-dir-from-planner-verdict
gh pr create \
  --title "fix(harness): B35 — parsePrdNode 从 planner verdict 提取 sprint_dir" \
  --body "$(cat << 'EOF'
## 问题

B34 (#2954) 添加了 subdir scan fallback，但 harness worktree 克隆自 main，`sprints/` 下存在所有历史 sprint（w19-w44）。readdir 按字母顺序找到 `w19-playground-sum/sprint-prd.md`，而非当前 sprint，导致 sprintDir 传递错误。

W45 validation run（task f85c9c3f）实证：proposer 收到 HARNESS_SPRINT_DIR=sprints，GAN 找不到 contract 文件。

## 修复

`parsePrdNode` 初始化 sprintDir 后立即 regex 扫描 `state.plannerOutput`，提取 planner verdict JSON 中的 `sprint_dir` 字段。

B34 readdir scan 保留为 last-resort fallback（当 planner 未输出 verdict 且直接读取失败时）。

## 测试

5 个单元测试覆盖：verdict 提取、payload fallback、非 JSON graceful、多行文本 regex、cache hit。

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

- [ ] **Step 4: 等待 CI，记录 PR URL**

```bash
cd /Users/administrator/worktrees/cecelia/b35-sprint-dir-from-planner-verdict
PR_URL=$(gh pr view --json url -q .url)
echo "PR: $PR_URL"
until [[ $(gh pr checks | grep -cE 'pending|in_progress') == 0 ]]; do sleep 30; done
gh pr checks
```

预期：所有 CI checks 通过。
