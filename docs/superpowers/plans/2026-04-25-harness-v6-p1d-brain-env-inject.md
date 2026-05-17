# Harness v6 P1-D Brain↔Generator Env 注入 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Brain dispatch harness_task 容器时注入 CONTRACT_BRANCH/SPRINT_DIR/BRAIN_URL/WORKSTREAM_INDEX 等 env，entrypoint 自动重写宿主 git remote 为 https，Generator SKILL 自检列表对齐。

**Architecture:** 三处改动：(1) `harness-task-dispatch.js` env 字段扩展 + WORKSTREAM_INDEX 提取函数；(2) `entrypoint.sh` 检测宿主 git remote 并 set-url；(3) SKILL.md Step 0 校验列表加项。

**Tech Stack:** Node.js (vitest), Bash, Markdown.

---

## File Structure

| 文件 | 责任 |
|---|---|
| `packages/brain/src/harness-task-dispatch.js` | 构造 docker env，注入 6 个新字段 |
| `packages/brain/src/__tests__/harness-task-dispatch.test.js` | 5 个新断言覆盖 env 协议 |
| `docker/cecelia-runner/entrypoint.sh` | git remote 宿主路径自动重写 |
| `packages/workflows/skills/harness-generator/SKILL.md` | Step 0 自检列表加 BRAIN_URL/WORKSTREAM_INDEX，新增 Step 0.4 git remote 验证 |
| `docs/learnings/cp-0425185121-harness-v6-p1d-brain-env-inject.md` | 根本原因 + 下次预防 |

---

### Task 1: 在 dispatch 增加 WORKSTREAM_INDEX 提取与 env 注入

**Files:**
- Modify: `packages/brain/src/harness-task-dispatch.js`
- Test: `packages/brain/src/__tests__/harness-task-dispatch.test.js`

- [ ] **Step 1: 写失败测试 — 注入 CONTRACT_BRANCH/SPRINT_DIR/BRAIN_URL**

在 `packages/brain/src/__tests__/harness-task-dispatch.test.js` 末尾、最外层 describe 关闭花括号 `})` 之前，添加新 describe block：

```js
  describe('Harness v6 P1-D: env protocol', () => {
    it('injects CONTRACT_BRANCH/SPRINT_DIR/BRAIN_URL into container env', async () => {
      let captured = null;
      const deps = {
        executor: async (opts) => {
          captured = opts;
          return { exit_code: 0, stdout: '', stderr: '', timed_out: false };
        },
        ensureWorktree: async () => '/tmp/wt/harness-v2/task-xxx',
        resolveToken: async () => 'ghs_test',
        writeDockerCallback: async () => {},
        pool: { query: async () => ({ rows: [] }) },
      };
      const { triggerHarnessTaskDispatch } = await import('../harness-task-dispatch.js');
      const task = {
        id: 'task-abcdef1234567890',
        task_type: 'harness_task',
        title: 't',
        payload: {
          parent_task_id: 'i',
          contract_branch: 'harness-v2/contract-abcd',
          sprint_dir: 'sprints/abcd1234',
          workstream_index: 2,
          workstream_count: 4,
          planner_branch: 'harness-v2/planner-abcd',
        },
      };
      await triggerHarnessTaskDispatch(task, deps);
      expect(captured.env.CONTRACT_BRANCH).toBe('harness-v2/contract-abcd');
      expect(captured.env.SPRINT_DIR).toBe('sprints/abcd1234');
      expect(captured.env.BRAIN_URL).toBe('http://host.docker.internal:5221');
      expect(captured.env.WORKSTREAM_INDEX).toBe('2');
      expect(captured.env.WORKSTREAM_COUNT).toBe('4');
      expect(captured.env.PLANNER_BRANCH).toBe('harness-v2/planner-abcd');
    });

    it('extracts WORKSTREAM_INDEX from logical_task_id when workstream_index missing', async () => {
      let captured = null;
      const deps = {
        executor: async (opts) => { captured = opts; return { exit_code: 0, stdout: '', stderr: '', timed_out: false }; },
        ensureWorktree: async () => '/tmp/wt/harness-v2/task-xxx',
        resolveToken: async () => 'ghs_test',
        writeDockerCallback: async () => {},
        pool: { query: async () => ({ rows: [] }) },
      };
      const { triggerHarnessTaskDispatch } = await import('../harness-task-dispatch.js');
      await triggerHarnessTaskDispatch({
        id: 't1', task_type: 'harness_task', title: 't',
        payload: { parent_task_id: 'i', logical_task_id: 'ws3' },
      }, deps);
      expect(captured.env.WORKSTREAM_INDEX).toBe('3');
    });

    it('defaults SPRINT_DIR to "sprints" when payload omits it', async () => {
      let captured = null;
      const deps = {
        executor: async (opts) => { captured = opts; return { exit_code: 0, stdout: '', stderr: '', timed_out: false }; },
        ensureWorktree: async () => '/tmp/wt/harness-v2/task-xxx',
        resolveToken: async () => 'ghs_test',
        writeDockerCallback: async () => {},
        pool: { query: async () => ({ rows: [] }) },
      };
      const { triggerHarnessTaskDispatch } = await import('../harness-task-dispatch.js');
      await triggerHarnessTaskDispatch({
        id: 't', task_type: 'harness_task', title: 't',
        payload: { parent_task_id: 'i' },
      }, deps);
      expect(captured.env.SPRINT_DIR).toBe('sprints');
    });

    it('BRAIN_URL is fixed to host.docker.internal:5221 regardless of payload', async () => {
      let captured = null;
      const deps = {
        executor: async (opts) => { captured = opts; return { exit_code: 0, stdout: '', stderr: '', timed_out: false }; },
        ensureWorktree: async () => '/tmp/wt/harness-v2/task-xxx',
        resolveToken: async () => 'ghs_test',
        writeDockerCallback: async () => {},
        pool: { query: async () => ({ rows: [] }) },
      };
      const { triggerHarnessTaskDispatch } = await import('../harness-task-dispatch.js');
      await triggerHarnessTaskDispatch({
        id: 't', task_type: 'harness_task', title: 't',
        payload: { parent_task_id: 'i', brain_url: 'http://malicious' },
      }, deps);
      expect(captured.env.BRAIN_URL).toBe('http://host.docker.internal:5221');
    });

    it('falls back to empty strings when contract_branch/workstream missing', async () => {
      let captured = null;
      const deps = {
        executor: async (opts) => { captured = opts; return { exit_code: 0, stdout: '', stderr: '', timed_out: false }; },
        ensureWorktree: async () => '/tmp/wt/harness-v2/task-xxx',
        resolveToken: async () => 'ghs_test',
        writeDockerCallback: async () => {},
        pool: { query: async () => ({ rows: [] }) },
      };
      const { triggerHarnessTaskDispatch } = await import('../harness-task-dispatch.js');
      await triggerHarnessTaskDispatch({
        id: 't', task_type: 'harness_task', title: 't',
        payload: { parent_task_id: 'i' },
      }, deps);
      expect(captured.env.CONTRACT_BRANCH).toBe('');
      expect(captured.env.WORKSTREAM_INDEX).toBe('');
      expect(captured.env.WORKSTREAM_COUNT).toBe('');
      expect(captured.env.PLANNER_BRANCH).toBe('');
    });
  });
```

- [ ] **Step 2: 跑测试看红**

Run: `cd packages/brain && npx vitest run src/__tests__/harness-task-dispatch.test.js --reporter=verbose`
Expected: 5 个新 it 全部 FAIL（env 字段未定义）

- [ ] **Step 3: 写最小实现 — 添加 extractWorkstreamIndex helper + env 注入**

修改 `packages/brain/src/harness-task-dispatch.js`：

在文件末尾 `function buildGeneratorPrompt` 之前，添加 helper：

```js
/**
 * 从 payload 提取 workstream index，支持两种来源：
 *   1. payload.workstream_index（数字优先）
 *   2. payload.logical_task_id 形如 "ws<N>"
 * 都不匹配返回空串。
 */
function extractWorkstreamIndex(payload) {
  if (payload.workstream_index !== undefined && payload.workstream_index !== null) {
    return String(payload.workstream_index);
  }
  const lti = payload.logical_task_id;
  if (typeof lti === 'string') {
    const m = lti.match(/^ws(\d+)$/i);
    if (m) return m[1];
  }
  return '';
}
```

把 `result = await executor({...})` 那段 env 块替换为：

```js
    result = await executor({
      task: { ...task, task_type: 'harness_task' },
      prompt,
      worktreePath,
      env: {
        // CECELIA_CREDENTIALS 不传 → executeInDocker middleware 走 selectBestAccount
        CECELIA_TASK_TYPE: 'harness_task',
        HARNESS_NODE: 'generator',
        HARNESS_INITIATIVE_ID: initiativeId,
        HARNESS_TASK_ID: task.id,
        HARNESS_FIX_MODE: fixMode ? 'true' : 'false',
        GITHUB_TOKEN: token,
        // v6 P1-D: Brain↔Generator prompt env 协议（详见 docs/superpowers/specs/2026-04-25-harness-v6-p1d-brain-env-inject-design.md）
        CONTRACT_BRANCH: payload.contract_branch || '',
        SPRINT_DIR: payload.sprint_dir || 'sprints',
        BRAIN_URL: 'http://host.docker.internal:5221',
        WORKSTREAM_INDEX: extractWorkstreamIndex(payload),
        WORKSTREAM_COUNT:
          payload.workstream_count !== undefined && payload.workstream_count !== null
            ? String(payload.workstream_count)
            : '',
        PLANNER_BRANCH: payload.planner_branch || '',
      },
    });
```

- [ ] **Step 4: 跑测试看绿**

Run: `cd packages/brain && npx vitest run src/__tests__/harness-task-dispatch.test.js --reporter=verbose`
Expected: 全部 PASS（含原有 12+ 测试与 5 个新测试）。

- [ ] **Step 5: Commit (Red+Green 一次性)**

```bash
git add packages/brain/src/harness-task-dispatch.js packages/brain/src/__tests__/harness-task-dispatch.test.js
git commit -m "feat(brain): harness_task 容器注入 CONTRACT_BRANCH/SPRINT_DIR/BRAIN_URL"
```

---

### Task 2: entrypoint.sh git remote 自动重写

**Files:**
- Modify: `docker/cecelia-runner/entrypoint.sh`

- [ ] **Step 1: 在 git config safe.directory 之后插入 git remote 检测**

在 `entrypoint.sh` 第 53 行（`git config --global --add safe.directory '*'`）之后、第 55 行注释 `# 4. 如果挂了 ~/.gitconfig` 之前，插入：

```bash
# 3.5 容器内 git remote 自动重写：detached worktree 复制宿主 .git/config
# 时 origin URL 是宿主绝对路径（/Users/...），容器内不可达，必须改为 https。
# v6 P1-D：dispatcher 注入 CONTRACT_BRANCH 后 generator 会 git fetch origin <branch>，
# 不重写 remote 这一步会拿到 "fatal: '/Users/...' does not appear to be a git repo"。
if [[ -d /workspace/.git || -f /workspace/.git ]]; then
  REMOTE_URL=$(cd /workspace && git remote get-url origin 2>/dev/null || echo "")
  if [[ "$REMOTE_URL" =~ ^/ ]]; then
    (cd /workspace && git remote set-url origin "https://github.com/perfectuser21/cecelia.git")
    echo "[entrypoint] git remote rewritten: $REMOTE_URL -> https://github.com/perfectuser21/cecelia.git"
  fi
fi
```

- [ ] **Step 2: 静态语法自检**

Run: `bash -n docker/cecelia-runner/entrypoint.sh`
Expected: 无输出（语法 OK）。

- [ ] **Step 3: Commit**

```bash
git add docker/cecelia-runner/entrypoint.sh
git commit -m "fix(docker): entrypoint 自动重写宿主 git remote 为 https"
```

---

### Task 3: SKILL.md 自检列表对齐

**Files:**
- Modify: `packages/workflows/skills/harness-generator/SKILL.md`

- [ ] **Step 1: 改 Step 0 自检列表**

把第 76 行 `**CONTRACT_BRANCH / SPRINT_DIR 未定义时绝对禁止继续。**` 替换为：

```
**CONTRACT_BRANCH / SPRINT_DIR / BRAIN_URL / WORKSTREAM_INDEX 任一未定义时绝对禁止继续。**

```bash
# v6 P1-D 自检
for var in CONTRACT_BRANCH SPRINT_DIR BRAIN_URL WORKSTREAM_INDEX; do
  if [ -z "${!var:-}" ]; then
    echo "ERROR: env $var 未定义 — Brain dispatch 协议失败"
    exit 1
  fi
done
```
```

- [ ] **Step 2: Step 0.5 之前插入 Step 0.4 git remote 验证**

在 `### Step 0.5: ★ MANDATORY PRE-FLIGHT — rebase 到最新 main` 那一行之前插入：

```
### Step 0.4: ★ git remote 验证（v6 P1-D）

entrypoint.sh 已自动重写 origin URL，但保险起见自检 — 如果仍是宿主绝对路径，所有 git fetch / push 都会挂。

```bash
ORIGIN_URL=$(git remote get-url origin)
if [[ "$ORIGIN_URL" =~ ^/ ]]; then
  echo "ERROR: git remote 仍是宿主路径 $ORIGIN_URL — entrypoint 重写失败"
  exit 1
fi
```

```

- [ ] **Step 3: Commit**

```bash
git add packages/workflows/skills/harness-generator/SKILL.md
git commit -m "docs(harness-generator): Step 0 自检 + Step 0.4 git remote 验证"
```

---

### Task 4: Learning + DoD

**Files:**
- Create: `docs/learnings/cp-0425185121-harness-v6-p1d-brain-env-inject.md`
- Create: `DoD.md`

- [ ] **Step 1: 写 Learning**

```markdown
# Learning: Harness v6 P1-D Brain↔Generator Env 协议固化

日期：2026-04-25
PR：(填合并后 URL)
Brain 任务：baa16433-91d0-4628-b078-08757d22bd44

## 现象

今晚 Gen2 (3329655d) 自我 ABORTED：Generator SKILL 自检 CONTRACT_BRANCH/SPRINT_DIR/BRAIN_URL 全部缺失，git remote 也是宿主绝对路径 `/Users/.../perfect21/cecelia`，容器内不可达。

## 根本原因

Brain `harness-task-dispatch.js` 的 docker env 块只注入 6 个老字段（CECELIA_TASK_TYPE/HARNESS_NODE/HARNESS_INITIATIVE_ID/HARNESS_TASK_ID/HARNESS_FIX_MODE/GITHUB_TOKEN），而 Generator SKILL.md 在 v5.0 升级后强制依赖 `CONTRACT_BRANCH/SPRINT_DIR/BRAIN_URL/WORKSTREAM_INDEX` —— 协议两端没对齐。同时 `entrypoint.sh` 没处理"宿主 git remote 在容器内不可达"的边缘 case。

## 修复

1. dispatch env 块加 6 个字段（CONTRACT_BRANCH/SPRINT_DIR/BRAIN_URL/WORKSTREAM_INDEX/WORKSTREAM_COUNT/PLANNER_BRANCH），WORKSTREAM_INDEX 支持 `payload.workstream_index` 与 `payload.logical_task_id` 双来源解析。
2. entrypoint.sh 检测 origin URL 以 `/` 开头则 set-url 为 https。
3. SKILL.md Step 0 校验扩到 4 个 env，新增 Step 0.4 git remote 验证。
4. 单测覆盖 5 个断言（env 注入 + 提取规则 + 兜底空串）。

## 下次预防

- [ ] Brain↔SKILL 之间的 prompt env 协议必须**单测固化**：dispatch 写一次断言，SKILL 改一次校验。
- [ ] 任何容器内执行 git fetch/push 的脚本，必须先验 `git remote get-url origin` 不是宿主绝对路径。
- [ ] Generator SKILL 修改 Step 0 校验列表时，**同步 grep `harness-task-dispatch.js`** 确认 env 已注入。
```

- [ ] **Step 2: 写 DoD**

`DoD.md`:

```markdown
# DoD — Harness v6 P1-D Brain↔Generator Env 注入

## [ARTIFACT] dispatch env 含新字段
- [x] `manual:node -e "const c=require('fs').readFileSync('packages/brain/src/harness-task-dispatch.js','utf8'); for (const k of ['CONTRACT_BRANCH','SPRINT_DIR','BRAIN_URL','WORKSTREAM_INDEX','WORKSTREAM_COUNT','PLANNER_BRANCH']) { if (!c.includes(k)) { console.error('missing '+k); process.exit(1); } }"`

## [ARTIFACT] entrypoint git remote 重写
- [x] `manual:node -e "const c=require('fs').readFileSync('docker/cecelia-runner/entrypoint.sh','utf8'); if (!c.includes('git remote set-url origin')) process.exit(1); if (!c.includes('https://github.com/perfectuser21/cecelia.git')) process.exit(1);"`

## [ARTIFACT] SKILL.md 自检对齐
- [x] `manual:node -e "const c=require('fs').readFileSync('packages/workflows/skills/harness-generator/SKILL.md','utf8'); for (const k of ['CONTRACT_BRANCH','SPRINT_DIR','BRAIN_URL','WORKSTREAM_INDEX']) { if (!c.includes(k)) { console.error('skill missing '+k); process.exit(1); } }"`

## [BEHAVIOR] 单测覆盖 env 协议（5 个新断言）
- [x] Test: `tests:packages/brain/src/__tests__/harness-task-dispatch.test.js`
- [x] `manual:node -e "const c=require('fs').readFileSync('packages/brain/src/__tests__/harness-task-dispatch.test.js','utf8'); if (!c.includes('Harness v6 P1-D: env protocol')) process.exit(1);"`

## [BEHAVIOR] WORKSTREAM_INDEX 双来源解析
- [x] `manual:node -e "const c=require('fs').readFileSync('packages/brain/src/harness-task-dispatch.js','utf8'); if (!c.includes('extractWorkstreamIndex')) process.exit(1);"`
```

- [ ] **Step 3: Commit**

```bash
git add docs/learnings/cp-0425185121-harness-v6-p1d-brain-env-inject.md DoD.md
git commit -m "docs(learning+dod): harness v6 P1-D env 协议固化"
```

---

### Task 5: 本地全跑 + Push + PR + 等 CI

- [ ] **Step 1: brain 子包跑全测试**

Run: `cd packages/brain && npx vitest run src/__tests__/harness-task-dispatch.test.js --reporter=verbose`
Expected: 全 PASS。

- [ ] **Step 2: facts-check（不阻塞，记录）**

Run: `node scripts/facts-check.mjs || true`
Expected: 不报跟本任务相关的字段不一致。

- [ ] **Step 3: Push 分支**

```bash
git push -u origin cp-0425185121-harness-v6-p1d-brain-env-inject
```

- [ ] **Step 4: 创建 PR**

```bash
gh pr create --title "feat(brain): harness_task 容器注入 CONTRACT_BRANCH/SPRINT_DIR/BRAIN_URL" \
  --body "$(cat <<'EOF'
## Summary
- harness-task-dispatch 注入 CONTRACT_BRANCH/SPRINT_DIR/BRAIN_URL/WORKSTREAM_INDEX/WORKSTREAM_COUNT/PLANNER_BRANCH
- entrypoint.sh 自动重写宿主 git remote 为 https
- harness-generator SKILL Step 0 校验扩到 4 个 env，新增 Step 0.4 git remote 验证

## Test plan
- [x] 单测 5 个新断言全绿（env 注入 + WORKSTREAM_INDEX 双来源 + 兜底）

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

- [ ] **Step 5: 前台阻塞等 CI**

```bash
PR_NUM=$(gh pr view --json number -q .number)
until [[ $(gh pr checks "$PR_NUM" --json state -q '[.[]|select(.state=="PENDING" or .state=="QUEUED" or .state=="IN_PROGRESS")]|length') -eq 0 ]]; do
  sleep 30
done
gh pr checks "$PR_NUM"
```
Expected: 全部 PASS / 或仅有非阻塞的可选 check。

- [ ] **Step 6: engine-ship 接力**

调 `Skill({"skill":"engine-ship"})` 走 Stop Hook 合并链。

---

## 自检（写完计划后回看）

- 计划覆盖 spec 的 6 个文件改动 ✓
- 测试代码完整无占位 ✓
- 函数命名一致：`extractWorkstreamIndex` 在 Task 1 helper 与 DoD `manual:` 命令均一致 ✓
- env 名跟 SKILL.md 校验列表一致：CONTRACT_BRANCH/SPRINT_DIR/BRAIN_URL/WORKSTREAM_INDEX ✓
