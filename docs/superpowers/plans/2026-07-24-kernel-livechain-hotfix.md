# Kernel Live-Chain Hotfix Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 修复 kernel-v1 generator 分支环境断链，以及 generator-fix 无自报 SHA 时 callback verdict 缺失的问题。

**Architecture:** 保留现有 provider-neutral TaskBundle 与收敛模型。launcher 从服务端
`bundle.inputs.task_id` 同源注入两个任务 ID 环境变量；callback 在 worker 没有 claimed
SHA 时只使用 run `pr_url` 对应的 GitHub head 作为权威证据，网络错误降级 pending，
不解析自然语言。

**Tech Stack:** Node.js ESM、Express、Vitest、PostgreSQL、GitHub CLI/resolver。

---

### Task 1: Launcher 环境变量 Red

**Files:**
- Modify: `packages/brain/src/orchestrator/__tests__/dispatcher.test.js`
- Reference: `packages/brain/src/orchestrator/dispatcher.js`

- [ ] **Step 1: 在真实 detached launcher 测试中增加失败断言**

在 `createDetachedLauncher` describe 内增加：

```js
it('generator 同源注入 HARNESS_TASK_ID 与 CECELIA_TASK_ID', async () => {
  const calls = [];
  const launcher = createDetachedLauncher({
    spawnDetached: async (opts) => {
      calls.push(opts);
      return { containerId: 'generator-env' };
    },
    attemptStore: {
      markStarting: vi.fn().mockResolvedValue(true),
      fail: vi.fn(),
    },
  });
  const taskId = '617f2dad-0940-4c77-bd3e-3ef711c3d939';
  await launcher.launch({
    attempt: {
      id: '11111111-1111-4111-8111-111111111111',
      run_id: '22222222-2222-4222-8222-222222222222',
      hop: 7,
      role: 'generator',
      callbackSecret: 'callback-secret',
    },
    bundle: {
      inputs: {
        task_id: taskId,
        sprint_dir: 'sprints/kernel-livechain-hotfix',
        worktree_path: '/tmp/worktree',
      },
      constraints: { read_only: false },
    },
    spec: { provider: 'codex', env: {}, args: [], stdin: 'prompt' },
    task: { id: taskId },
  });

  expect(calls[0].env.HARNESS_TASK_ID).toBe(taskId);
  expect(calls[0].env.CECELIA_TASK_ID).toBe(taskId);
});
```

- [ ] **Step 2: 运行测试并验证真红**

Run:

```bash
cd packages/brain
npx vitest run src/orchestrator/__tests__/dispatcher.test.js --reporter=verbose
```

Expected: 新测试 FAIL，`HARNESS_TASK_ID` 实际为 `undefined`；其他 dispatcher 测试通过。

- [ ] **Step 3: 提交 Red**

```bash
git add packages/brain/src/orchestrator/__tests__/dispatcher.test.js
git commit -m "test(kernel): expose missing generator task env (Red)"
```

### Task 2: Callback 无 claimed SHA Red

**Files:**
- Modify: `packages/brain/src/routes/__tests__/harness-attempt-callback.test.js`
- Reference: `packages/brain/src/routes/harness-callback.js`

- [ ] **Step 1: 增加 Codex 字符串 artifacts + GitHub 同 SHA 场景**

沿用该文件真实 Router、fake DB 与 `kernelPrHeadResolver` 注入方式，创建 generator-fix
attempt。DB 上下文返回：

```js
{
  pr_url: 'https://github.com/perfectuser21/cecelia/pull/4293',
  trigger_sha: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
}
```

callback body 使用：

```js
{
  contract_version: '1.0',
  attempt_id: ATTEMPT_ID,
  status: 'completed_with_concerns',
  summary: 'no new commit',
  artifacts: ['docs/fire-drills/kernel-v1-mixed-20260724.md'],
  checks: [],
  decision: { outcome: 'accept_existing_worktree_state', reason: 'no change' },
  error: null,
  provider_metadata: { provider: 'codex', session_id: 'session-fix-no-sha' },
}
```

resolver 返回 `aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa`。断言 callback HTTP 200，并且
INSERT 参数中的 detail 为：

```js
expect.objectContaining({
  pr_head_sha: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
  verification_status: 'verified',
})
```

同时断言 action 为 `verdict:generator-fix-callback`，同一 attempt 只写一行。

- [ ] **Step 2: 增加 resolver 网络失败 pending 场景**

同样不提供 claimed SHA，resolver 抛 `new Error('github timeout')`。断言仍写 callback：

```js
expect.objectContaining({
  pr_head_sha: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
  verification_status: 'verification_pending',
})
```

并断言没有 `no_progress_reason: 'callback_sha_unverified'`。

- [ ] **Step 3: 运行测试并验证真红**

Run:

```bash
cd packages/brain
npx vitest run src/routes/__tests__/harness-attempt-callback.test.js --reporter=verbose
```

Expected: 两个新测试因 callback 早退、没有 INSERT 而 FAIL；既有测试通过。

- [ ] **Step 4: 提交 Red**

```bash
git add packages/brain/src/routes/__tests__/harness-attempt-callback.test.js
git commit -m "test(kernel): expose missing authoritative fix callback (Red)"
```

### Task 3: Launcher Green

**Files:**
- Modify: `packages/brain/src/orchestrator/dispatcher.js`
- Test: `packages/brain/src/orchestrator/__tests__/dispatcher.test.js`

- [ ] **Step 1: 写最小实现**

在 detached launcher 的 `spawnDetached({ env: { ... } })` 中，让两个变量同源：

```js
CECELIA_TASK_ID: bundle.inputs.task_id,
HARNESS_TASK_ID: bundle.inputs.task_id,
```

- [ ] **Step 2: 运行定向测试**

Run:

```bash
cd packages/brain
npx vitest run src/orchestrator/__tests__/dispatcher.test.js --reporter=verbose
```

Expected: 全绿。

- [ ] **Step 3: 提交 Green**

```bash
git add packages/brain/src/orchestrator/dispatcher.js
git commit -m "fix(kernel): inject generator harness task id (Green)"
```

### Task 4: Callback Green

**Files:**
- Modify: `packages/brain/src/routes/harness-callback.js`
- Test: `packages/brain/src/routes/__tests__/harness-attempt-callback.test.js`

- [ ] **Step 1: 把 context 查询移到 claimed SHA 早退之前**

删除：

```js
if (!claimedSha) return;
```

必须先取得 `context.pr_url` 与 `trigger_sha`，才能决定无 claimed SHA 的服务端回退。

- [ ] **Step 2: 实现无 claimed SHA 的权威 resolver 路径**

在现有 claimed SHA 分支外增加：

```js
if (!claimedSha) {
  let resolvedSha = null;
  let resolutionPending = !context.pr_url;
  try {
    resolvedSha = context.pr_url
      ? normalizeGitSha(await resolvePrHead(context.pr_url))
      : null;
  } catch {
    resolutionPending = true;
  }
  if (resolvedSha) {
    prHeadSha = resolvedSha;
    verificationStatus = 'verified';
  } else {
    verificationStatus = 'verification_pending';
  }
} else {
  // 保留现有 normalize + verified/pending/unverified 逻辑
}
```

不得读取 `summary`、`checks` 或字符串 artifacts。pending 时不伪造
`claimed_pr_head_sha` 字段。

- [ ] **Step 3: 运行 callback 定向测试**

Run:

```bash
cd packages/brain
npx vitest run src/routes/__tests__/harness-attempt-callback.test.js --reporter=verbose
```

Expected: 全绿。

- [ ] **Step 4: 运行 callback/收敛联合回归**

Run:

```bash
cd packages/brain
npx vitest run \
  src/routes/__tests__/harness-attempt-callback.test.js \
  src/orchestrator/__tests__/counters.test.js \
  src/orchestrator/__tests__/kernel-callback-flow.integration.test.js \
  --reporter=verbose
```

Expected: 全绿。

- [ ] **Step 5: 提交 Green**

```bash
git add packages/brain/src/routes/harness-callback.js
git commit -m "fix(kernel): resolve missing fix SHA from GitHub (Green)"
```

### Task 5: 真调用链集成回归

**Files:**
- Modify: `packages/brain/src/orchestrator/__tests__/kernel-callback-flow.integration.test.js`
- Run unchanged: `packages/brain/src/__tests__/integration/kernel-wiring.pg.integration.test.js`

- [ ] **Step 1: 增加真实 callback 到 counters 的集成断言**

用 Router callback 写入无 claimed SHA 的 generator-fix verdict，再把 append-only log 交给
`deriveCounters()`，断言：

```js
expect(counters.noProgress).toBe(true);
expect(counters.noProgressReason).toBe('no_progress_same_sha');
```

测试必须打真实 `appendGeneratorFixCallback`，不得在测试体复制路由逻辑或手工伪造
callback 行。

- [ ] **Step 2: 在 Green 代码未变的当前状态运行测试**

Run:

```bash
cd packages/brain
npx vitest run src/orchestrator/__tests__/kernel-callback-flow.integration.test.js --reporter=verbose
```

Expected: PASS，证明 Task 4 实现接通真实调用链。

- [ ] **Step 3: 提交集成测试**

```bash
git add packages/brain/src/orchestrator/__tests__/kernel-callback-flow.integration.test.js
git commit -m "test(kernel): prove authoritative no-progress callback chain"
```

### Task 6: 版本与全量验证

**Files:**
- Modify: `.brain-versions`
- Modify: `DEFINITION.md`
- Modify: `packages/brain/package.json`
- Modify: `packages/brain/package-lock.json`
- Modify: `package-lock.json`

- [ ] **Step 1: 重新同步 main 并分配下一可用版本**

```bash
git fetch origin main
git rebase origin/main
```

读取 `.brain-versions` 末行，以 main 下一可用 patch 版本同步现行四处；不得硬编码覆盖
main 已占用版本。

- [ ] **Step 2: 运行版本守卫**

```bash
node scripts/facts-check.mjs
bash scripts/check-version-sync.sh
```

Expected: PASS。

- [ ] **Step 3: 运行定向池**

```bash
cd packages/brain
npx vitest run \
  src/orchestrator/__tests__/dispatcher.test.js \
  src/routes/__tests__/harness-attempt-callback.test.js \
  src/orchestrator/__tests__/counters.test.js \
  src/orchestrator/__tests__/kernel-callback-flow.integration.test.js \
  --reporter=verbose
```

Expected: 全绿。

- [ ] **Step 4: 运行真 PostgreSQL 集成池**

使用仓库既有真 PG 命令运行
`src/__tests__/integration/kernel-wiring.pg.integration.test.js`，Expected: 全绿。

- [ ] **Step 5: 运行 DevGate 与 diff 检查**

```bash
git diff --check origin/main...HEAD
bash scripts/devgate/run.sh
```

Expected: PASS。

- [ ] **Step 6: 提交版本**

```bash
git add .brain-versions DEFINITION.md packages/brain/package.json packages/brain/package-lock.json package-lock.json
git commit -m "chore(brain): bump version for kernel live-chain hotfix"
```

### Task 7: PR、独立裁决与人工门

**Files:**
- Read: `docs/superpowers/specs/2026-07-24-kernel-livechain-hotfix-design.md`
- Read: `docs/superpowers/plans/2026-07-24-kernel-livechain-hotfix.md`

- [ ] **Step 1: 推送并创建独立 PR**

PR 正文必须包含 task ID、两组 Red→Green SHA、定向/PG/DevGate 证据、未覆盖真实链路。
禁止复用或重开 #4293。

- [ ] **Step 2: 前台轮询 CI 到终态**

CI pending 时同步轮询；失败就读取日志并回 generator 修复，禁止结束 session 等通知。

- [ ] **Step 3: evaluator 与 judge 独立复核**

两者都锚定最终 PR head SHA；任一 FAIL 回 generator 修复并重新锚定。

- [ ] **Step 4: 停在人工 review 门**

`review_required=true`。不得调用 approve/reject 路由，不得自批，不得 merge。交付内容包括
PR URL、head SHA、CI rollup、Red→Green、evaluator/judge verdict，以及复审命令所需
task ID。
