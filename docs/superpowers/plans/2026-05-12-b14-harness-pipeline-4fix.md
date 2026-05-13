# B14 Harness Pipeline 4 Fix Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development.

**Goal:** 修 4 个 hole 让 P1 真过得去：evaluator 切 PR 分支 + proposer 切粒度 + planner 控 thin slice 字数。

**Architecture:** 1 个 brain code 改 + 3 个 skill 文档改 + 1 单测

**Spec:** `docs/superpowers/specs/2026-05-12-b14-harness-pipeline-4fix-design.md`

---

## Task 1: 单测 RED（fail test）

**Files:**
- Create: `packages/brain/src/workflows/__tests__/harness-task-evaluator-pr-branch.test.js`

- [ ] **Step 1: 创单测文件（按 design spec 内容原样）**

参考 design spec 的"改动 5：单测"段，原样创建文件。

- [ ] **Step 2: 跑测试验证 RED**

```bash
cd /Users/administrator/worktrees/cecelia/harness-pipeline-4fix
npx vitest run packages/brain/src/workflows/__tests__/harness-task-evaluator-pr-branch.test.js 2>&1 | tail -15
```

Expected: FAIL — env.PR_BRANCH undefined（源码还没传）

- [ ] **Step 3: Commit RED**

```bash
git add packages/brain/src/workflows/__tests__/harness-task-evaluator-pr-branch.test.js
git commit -m "test: B14 evaluator spawn env 含 PR_BRANCH (RED)"
```

---

## Task 2: harness-task.graph.js 加 PR_BRANCH env (GREEN commit)

**Files:**
- Modify: `packages/brain/src/workflows/harness-task.graph.js` evaluateContractNode 内（约 line 440-470）

- [ ] **Step 1: 加 prBranchEnv 解析 + env 注入**

在 spawnFn 调用前增加：

```javascript
let prBranchEnv = state.pr_branch || '';
if (!prBranchEnv && state.pr_url) {
  try {
    const { stdout } = await execFile('gh', ['pr', 'view', state.pr_url, '--json', 'headRefName', '-q', '.headRefName'], { timeout: 10_000 });
    prBranchEnv = stdout.trim();
  } catch (err) {
    console.warn(`[evaluate_contract] gh pr view fallback failed: ${err.message}`);
  }
}
```

env: 块加一行 `PR_BRANCH: prBranchEnv,`（line 463 PR_URL 下一行）。

- [ ] **Step 2: 单测 GREEN**

```bash
npx vitest run packages/brain/src/workflows/__tests__/harness-task-evaluator-pr-branch.test.js 2>&1 | tail -10
```

Expected: PASS

- [ ] **Step 3: Commit GREEN**

```bash
git add packages/brain/src/workflows/harness-task.graph.js
git commit -m "fix(brain): evaluator spawn env 加 PR_BRANCH 让 evaluator 真看 generator 改 (B14)"
```

---

## Task 3: 3 个 skill 文档改

**Files:**
- Modify: `packages/workflows/skills/harness-evaluator/SKILL.md`
- Modify: `packages/workflows/skills/harness-contract-proposer/SKILL.md`
- Modify: `packages/workflows/skills/harness-planner/SKILL.md`

- [ ] **Step 1: harness-evaluator 加 Step 0a**

在现有 Step 0 「模式判断」 之前插入 design spec 改动 2 段（含 git fetch + git checkout）。

- [ ] **Step 2: harness-contract-proposer 加 Workstreams 切分硬规则**

在现有 `## Workstreams` 段后加 design spec 改动 3 段（含 200 行硬阈值 + 反例正例）。

- [ ] **Step 3: harness-planner 加 thin slice 字数上限**

在 thin slice 相关段加 design spec 改动 4 段（PRD ≤ 50 行 + DoD ≤ 8 条）。

- [ ] **Step 4: 跑 4 项 manual:node grep 验证**

```bash
node -e "const c=require('fs').readFileSync('packages/brain/src/workflows/harness-task.graph.js','utf8');if(!c.match(/PR_BRANCH\s*:\s*prBranchEnv/))process.exit(1);console.log('1 OK')"
node -e "const c=require('fs').readFileSync('packages/workflows/skills/harness-evaluator/SKILL.md','utf8');if(!c.match(/git checkout.*PR_BRANCH/))process.exit(1);console.log('2 OK')"
node -e "const c=require('fs').readFileSync('packages/workflows/skills/harness-contract-proposer/SKILL.md','utf8');if(!c.match(/200.行/))process.exit(1);console.log('3 OK')"
node -e "const c=require('fs').readFileSync('packages/workflows/skills/harness-planner/SKILL.md','utf8');if(!c.match(/PRD.*≤.*50|thin.*50.行/))process.exit(1);console.log('4 OK')"
```

Expected: 4 行 "N OK" 输出。

- [ ] **Step 5: Commit skill 改动**

```bash
git add packages/workflows/skills/harness-evaluator/SKILL.md packages/workflows/skills/harness-contract-proposer/SKILL.md packages/workflows/skills/harness-planner/SKILL.md
git commit -m "feat(skills): harness-evaluator/proposer/planner 加 PR 分支切换 + ws 切粒度 + thin slice 字数硬规则 (B14)"
```

---

## Task 4: Learning

**Files:**
- Create: `docs/learnings/cp-0512220104-harness-pipeline-4fix.md`

- [ ] **Step 1: 写 Learning**

```markdown
# Learning — B14 harness pipeline 4 hole 真过 P1

### 根本原因

W36 跑 73 min 撞 final_evaluate FAIL，深挖发现 4 个 hole：
1. brain spawn evaluator 没传 PR_BRANCH，evaluator container 起在 initiative 主 worktree (main)，跑 server 看不见 generator 在 PR 分支写的代码
2. evaluator skill 1.3.0 写"pre-merge gate"但 Step 0 没指令 git checkout PR 分支
3. proposer 7.6.0 有 size S/M/L 阈值但没硬规则，W36 实证 proposer 把 335 行三文件塞一个 ws
4. planner 没 thin slice 字数上限，W36 实证 254 行 PRD + 32 DoD 条目

P1 一直过不去因为这 4 个 hole 任何一个都让 evaluator 必 FAIL。

### 下次预防

- [ ] 任何"读环境变量"的 skill 必须在 SKILL.md 写明 env vars 清单，graph spawn 端 env: {} 块和 SKILL.md 清单要对账
- [ ] pre-merge gate 类 skill 必须在 Step 0 显式切到目标分支，不能依赖 LLM 自己 infer
- [ ] proposer / planner 必须有量化硬阈值（行数 / 文件数 / DoD 条数），不能只写"建议"或"S/M/L 推荐"
- [ ] 任何 "fix loop 跑 N round 都 FAIL" 类 issue 第一时间 grep evaluator stdout 找 root cause，不要假设是 generator 质量问题
```

- [ ] **Step 2: Commit Learning**

```bash
git add docs/learnings/cp-0512220104-harness-pipeline-4fix.md
git commit -m "docs(learnings): B14 harness pipeline 4 hole P1 阻塞"
```
