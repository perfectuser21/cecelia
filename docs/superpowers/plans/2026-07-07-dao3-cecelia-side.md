# 刀3 cecelia 侧实施计划（staging unknown 线策略 + relay env 宿主路径）

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 第三方 repo 的 staging_e2e 任务不再把 cecelia brain 误部署到 :5222；relay 容器 env 提供宿主 worktree 绝对路径供 controller curl judge API。

**Architecture:** 两处独立小改动，均为 TDD 单测驱动：① `runStagingE2E` 在 line 判定后对「base_repo 非空且 resolveLine=unknown」早退（不抢锁不 deploy，SKIP + pending_promote + 飞书）；`finalize` 加第 4 参支持 promoteStatus override。② `spawnSkillRelaySession` env 块加 `HARNESS_WORKTREE_HOST`。

**Tech Stack:** Node.js ESM + vitest（mock pool/deploy/notify，repo 既有模式）

**Worktree:** `/Users/administrator/worktrees/cecelia/dao3-cecelia-side`（分支 cp-0707225955-dao3-cecelia-side）

**环境注意（来自 handoff 铁则）：**
- 所有 git 操作用 `git -C /Users/administrator/worktrees/cecelia/dao3-cecelia-side <子命令>` 形式
- 文件写入若被 main-repo-write-guard 拦 → 用 Bash heredoc
- 测试命令用子 shell：`(cd <worktree>/packages/brain && npx vitest run <file>)`

---

### Task 1: staging unknown 线不跑 deploy

**Files:**
- Modify: `packages/brain/src/staging-e2e-runner.js`（`finalize` ~L684-702、`const line = resolveLine(baseRepo)` ~L713 之后）
- Test: `packages/brain/src/__tests__/staging-e2e-runner.test.js`（`describe('runStagingE2E')` 块末尾追加）

- [ ] **Step 1: 写 failing test**

在 `staging-e2e-runner.test.js` 的 `describe('runStagingE2E', ...)` 块内追加：

```js
  it('base_repo=第三方 repo → 不 deploy，SKIP unknown_line + pending_promote + 飞书通知', async () => {
    const pool = makeMockPool();
    const deploy = vi.fn();
    const notifyMsgs = [];
    const notify = async (m) => notifyMsgs.push(m);
    const task3p = {
      id: 'task-3p',
      payload: { initiative_id: 'init-1', pr_url: 'https://pr/3p', base_repo: 'https://github.com/acme/other-product.git' },
    };
    const r = await runStagingE2E(task3p, { pool, deploy, loadAcceptance: async () => ACCEPTANCE, notify });
    // 不跑任何 deploy（cecelia 没有第三方 repo 的 staging 部署目标）
    expect(deploy).not.toHaveBeenCalled();
    expect(r.verdict).toBe('SKIP');
    expect(r.reason).toBe('unknown_line');
    expect(r.promoteStatus).toBe('pending_promote');
    // verdict 落 staging_e2e_results
    expect(insertedResult(pool).params[3]).toBe('SKIP');
    // promote_status=pending_promote 落库
    const upd = pool.calls.find((c) => /UPDATE staging_e2e_results/.test(c.sql) && /promote_status/.test(c.sql));
    expect(upd).toBeTruthy();
    expect(upd.params).toContain('pending_promote');
    // 飞书通知一次，文案含 pending 语义
    expect(notifyMsgs.length).toBe(1);
    expect(notifyMsgs[0]).toMatch(/pending/i);
    expect(updateTaskStatus).toHaveBeenCalledWith('task-3p', 'completed');
  });

  it('base_repo 为空（legacy）→ 保持旧行为，照常 deploy', async () => {
    const pool = makeMockPool();
    const deploy = vi.fn(() => ({ status: 'skipped', reason: 'no_docker', output: '' }));
    // 复用文件顶部 task fixture（payload 无 base_repo）
    const r = await runStagingE2E(task, { pool, deploy, loadAcceptance: async () => ACCEPTANCE });
    expect(deploy).toHaveBeenCalledOnce();
    expect(r.reason).toBe('no_docker');
  });
```

- [ ] **Step 2: 跑测试确认第一条红**

Run: `(cd /Users/administrator/worktrees/cecelia/dao3-cecelia-side/packages/brain && npx vitest run src/__tests__/staging-e2e-runner.test.js)`
Expected: 新测试 1 FAIL（deploy 被调用 / reason 不是 unknown_line），新测试 2 PASS（旧行为），其余全 PASS

- [ ] **Step 3: commit failing test（commit-1 Red）**

```bash
git -C /Users/administrator/worktrees/cecelia/dao3-cecelia-side add packages/brain/src/__tests__/staging-e2e-runner.test.js
git -C /Users/administrator/worktrees/cecelia/dao3-cecelia-side commit -m "test(brain): staging unknown 线不 deploy 的 failing test (Red)"
```

- [ ] **Step 4: 最小实现**

`packages/brain/src/staging-e2e-runner.js` 两处：

(a) `finalize` 加第 4 参（原样替换现有 finalize 定义，正文只加 override 分支）：

```js
  // 终局：落库 + 写回 tasks.result + 标 completed
  // o.promoteStatus（刀3b）：跳过 handlePromote 分流，直接落指定 promote_status + best-effort 通知
  //（unknown 线用：verdict 恒非 PASS，decidePromote 会误落 n_a，且需要带说明的专属通知文案）。
  const finalize = async (verdict, reason, extra = {}, o = {}) => {
    await recordResult(dbPool, { ...base, ...extra, verdict, reason });
    let promoteStatus;
    if (o.promoteStatus) {
      promoteStatus = o.promoteStatus;
      await updatePromoteStatus(dbPool, prUrl, o.promoteStatus);
      if (o.notifyMessage) {
        try {
          await (opts.notify || sendFeishu)(o.notifyMessage);
        } catch (e) {
          console.warn(`[staging-e2e] unknown 线通知失败（忽略）: ${e.message}`);
        }
      }
    } else {
      // Slice2：PASS 后放行分流（内部线 auto-promote / 客户线 pending+通知 / base_repo 缺失保守 pending）。
      // best-effort，不影响 verdict 已落库。
      promoteStatus = await handlePromote(
        dbPool, { verdict, baseRepo, prUrl, initiativeId, deployOutput: base.deployOutput, zjSha: base.zjSha || null },
        { promoteExec: opts.promoteExec, notify: opts.notify },
      );
    }
    await writeTaskResult(dbPool, task.id, {
      verdict, reason,
      scenarios_total: extra.scenariosTotal ?? base.scenariosTotal,
      scenarios_passed: extra.scenariosPassed ?? base.scenariosPassed,
      pr_url: prUrl, initiative_id: initiativeId,
      promote_status: promoteStatus,
      ...(extra.regressionSmokeResult ? { regression_smoke_result: extra.regressionSmokeResult } : {}),
    });
    await updateTaskStatus(task.id, 'completed');
    return { success: true, taskId: task.id, verdict, reason, promoteStatus };
  };
```

(b) `const line = resolveLine(baseRepo);` 之后、`const lockPort = ...` 之前插入：

```js
    // 刀3b（harness 跨 repo 化）：base_repo 非空但既非 cecelia 也非 zenithjoy = 第三方 repo。
    // cecelia 没有它的 staging 部署目标——旧行为落进 deployStaging 的 else 分支跑
    // staging-deploy.sh，把 cecelia brain 部署到 :5222（错误目标）。显式策略：不抢锁、
    // 不跑任何 deploy，SKIP(unknown_line) + promote_status=pending_promote + 飞书通知主理人。
    // base_repo 为空（legacy cecelia 流）保持旧行为——promote 侧决策2 的保守 pending 已兜底。
    if (line === 'unknown' && baseRepo) {
      return await finalize('SKIP', 'unknown_line', {}, {
        promoteStatus: PROMOTE_STATUS.PENDING_PROMOTE,
        notifyMessage:
          `⏳ [Unknown 线] staging_e2e 收到第三方 repo，无 staging 部署目标，已挂 pending 等人工决策\n`
          + `initiative: ${initiativeId || '?'}\nPR: ${prUrl || '?'}\nbase_repo: ${baseRepo}\n`
          + `confirm: POST /api/brain/harness/promote/<resultId>`,
      });
    }
```

- [ ] **Step 5: 跑测试确认全绿**

Run: `(cd /Users/administrator/worktrees/cecelia/dao3-cecelia-side/packages/brain && npx vitest run src/__tests__/staging-e2e-runner.test.js)`
Expected: 全 PASS（含既有用例，零回归）

- [ ] **Step 6: 跑相邻测试防波及**

Run: `(cd /Users/administrator/worktrees/cecelia/dao3-cecelia-side/packages/brain && npx vitest run src/__tests__/staging-e2e-runner-promote.test.js src/__tests__/staging-e2e-runner-deploy-path.test.js src/__tests__/staging-e2e-runner-dashboard-seam.test.js src/__tests__/staging-promote.test.js)`
Expected: 全 PASS

- [ ] **Step 7: commit 实现（commit-2 Green）**

```bash
git -C /Users/administrator/worktrees/cecelia/dao3-cecelia-side add packages/brain/src/staging-e2e-runner.js
git -C /Users/administrator/worktrees/cecelia/dao3-cecelia-side commit -m "fix(brain): staging unknown 线（第三方 repo）不跑 deploy，置 pending_promote + 飞书通知 (Green)"
```

---

### Task 2: relay spawn env 注入 HARNESS_WORKTREE_HOST

**Files:**
- Modify: `packages/brain/src/harness-skill-relay.js`（spawn env 块，`HARNESS_SPRINT_DIR` 行附近）
- Test: `packages/brain/src/__tests__/harness-skill-relay.test.js`（`describe('spawnSkillRelaySession')` 块内追加）

- [ ] **Step 1: 写 failing test**

在 `harness-skill-relay.test.js` 的 `describe('spawnSkillRelaySession', ...)` 块内追加：

```js
  it('env 注入宿主 worktree 绝对路径 HARNESS_WORKTREE_HOST（刀3：controller 容器内 curl judge API 用）', async () => {
    const deps = makeDeps();
    await spawnSkillRelaySession(TASK, deps);
    const spawnOpts = deps.spawnFn.mock.calls[0][0];
    expect(spawnOpts.env.HARNESS_WORKTREE_HOST).toBe('/tmp/wt/task-aaaabbbb');
  });
```

- [ ] **Step 2: 跑测试确认红**

Run: `(cd /Users/administrator/worktrees/cecelia/dao3-cecelia-side/packages/brain && npx vitest run src/__tests__/harness-skill-relay.test.js)`
Expected: 新测试 FAIL（HARNESS_WORKTREE_HOST undefined），其余 PASS

- [ ] **Step 3: commit failing test（commit-1 Red）**

```bash
git -C /Users/administrator/worktrees/cecelia/dao3-cecelia-side add packages/brain/src/__tests__/harness-skill-relay.test.js
git -C /Users/administrator/worktrees/cecelia/dao3-cecelia-side commit -m "test(brain): relay env HARNESS_WORKTREE_HOST failing test (Red)"
```

- [ ] **Step 4: 最小实现**

`packages/brain/src/harness-skill-relay.js` spawn env 块，`HARNESS_SPRINT_DIR: sprintDir,` 行后加：

```js
          // 刀3（跨 repo 化）：宿主 worktree 绝对路径。controller 在容器内（cwd=/workspace），
          // Step 5 curl Brain judge API 时 worktree 参数必须传宿主路径——Brain 容器把
          // ~/perfect21/cecelia 与 .claude/worktrees 按宿主同路径挂载，judge 按此读 .brain-result.json。
          HARNESS_WORKTREE_HOST: worktreePath,
```

- [ ] **Step 5: 跑测试确认全绿**

Run: `(cd /Users/administrator/worktrees/cecelia/dao3-cecelia-side/packages/brain && npx vitest run src/__tests__/harness-skill-relay.test.js)`
Expected: 全 PASS

- [ ] **Step 6: commit 实现（commit-2 Green）**

```bash
git -C /Users/administrator/worktrees/cecelia/dao3-cecelia-side add packages/brain/src/harness-skill-relay.js
git -C /Users/administrator/worktrees/cecelia/dao3-cecelia-side commit -m "feat(brain): relay spawn env 注入 HARNESS_WORKTREE_HOST 宿主 worktree 路径 (Green)"
```

---

### Task 3: 版本 bump + 全量前置检查

- [ ] **Step 1: brain 版本 bump（semver patch）**

按 `bash scripts/check-version-sync.sh` 要求同步四处版本（packages/brain/package.json 等，脚本会指出不同步处）。

```bash
(cd /Users/administrator/worktrees/cecelia/dao3-cecelia-side && bash scripts/check-version-sync.sh)
```

- [ ] **Step 2: DevGate**

```bash
(cd /Users/administrator/worktrees/cecelia/dao3-cecelia-side && node scripts/facts-check.mjs && bash scripts/check-version-sync.sh)
```
Expected: 全过

- [ ] **Step 3: commit version bump**

```bash
git -C /Users/administrator/worktrees/cecelia/dao3-cecelia-side add -A
git -C /Users/administrator/worktrees/cecelia/dao3-cecelia-side commit -m "chore(brain): version bump"
```

> 注意：全量 brain 套件有 14 个既有环境性失败（sprints/ 历史合同测试 + okr integration），main 基线同红，遇到别修。
