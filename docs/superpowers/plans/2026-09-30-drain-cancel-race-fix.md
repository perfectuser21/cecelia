# Drain-Cancel 竞态修复 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 修复 Brain 部署后派单排空（draining）暂停约 15 分钟的 bug：`cancelDrain()` 在新容器 `_draining` 尚为 `false` 时短路不清库，随后 `restoreDrainState()` 把旧容器的持久化排空状态误当新排空恢复，只能等 15 分钟运行期超龄自愈。

**Architecture:** 三处最小改动：① `drain.js` 的 `cancelDrain()` 改为无条件清持久化状态（纵深防御）；② `server.js` 把 `restoreDrainState()` 挪到 `listenWithRetry()` 之前，复用已有的 `reconcileOwnerlessKernelRuns()` "listener 前收敛" 模式，从根本上消除"端口先开、状态后恢复"的时间窗口；③ `tick-recovery.js` 删除 `initTickLoop()` 里重复的 `restoreDrainState()` 调用，避免双重 restore 引入新竞态。

**Tech Stack:** Node.js（ESM），Vitest，PostgreSQL（`working_memory` 表）

设计文档：`docs/superpowers/specs/2026-09-30-drain-cancel-race-design.md`

---

### Task 1: 写失败测试复现竞态

**Files:**
- Modify: `packages/brain/src/__tests__/drain.test.js`

- [ ] **Step 1: 在文件末尾新增一个 describe 块，写失败测试**

在 `packages/brain/src/__tests__/drain.test.js` 文件末尾（第 122 行 `});` 之后）追加：

```javascript

describe('drain.js — 部署竞态（cancel-before-restore，任务 30861749）', () => {
  it('cancelDrain() 在 restoreDrainState() 之前被调用时，必须让 restoreDrainState() 之后不再恢复排空', async () => {
    vi.resetModules();
    mockQuery.mockReset();
    mockQuery.mockResolvedValue({ rows: [] });
    const mod = await import('../drain.js');

    // 模拟旧容器：正常进入排空并持久化到 working_memory
    const persisted = { draining: true, drain_started_at: new Date().toISOString() };
    await mod.drainTick();
    mockQuery.mockReset();

    // 模拟新容器：进程重启，内存态归零，但 DB 里持久化行还在（旧容器写的）
    mod._resetDrainState();
    mockQuery.mockImplementation((sql) => {
      if (sql.includes('SELECT value_json FROM working_memory')) {
        return Promise.resolve({ rows: [{ value_json: persisted }] });
      }
      return Promise.resolve({ rows: [] });
    });

    // 模拟部署脚本健康检查通过后立刻发来的 drain-cancel —— 此时 restoreDrainState() 还没跑，
    // 新容器内存里 _draining 仍是 false。
    expect(mod._getDrainState().draining, '新容器启动瞬间 _draining 应为 false').toBe(false);
    await mod.cancelDrain();

    // 随后启动链才跑到 restoreDrainState()（tick-recovery.js initTickLoop 尾部）
    await mod.restoreDrainState();

    expect(
      mod.isDraining(),
      'cancelDrain 在 restore 之前发生时，之后的 restore 不应该把已经取消的排空重新恢复——' +
        '否则复现任务 30861749：部署健康检查通过后派单仍卡 15 分钟'
    ).toBe(false);
  });
});
```

- [ ] **Step 2: 运行测试确认它失败**

Run: `cd packages/brain && npx vitest run src/__tests__/drain.test.js -t "cancelDrain\(\) 在 restoreDrainState"`
Expected: FAIL — `expect(mod.isDraining()).toBe(false)` 收到 `true`（因为 `cancelDrain()` 在 `_draining=false` 时短路不清库，`restoreDrainState()` 读到未被清掉的持久化行又恢复了排空）

- [ ] **Step 3: Commit（先红）**

```bash
git add packages/brain/src/__tests__/drain.test.js
git commit -m "test(brain): 复现部署后 drain-cancel 竞态导致派单停摆（任务 30861749）

cancelDrain() 在新容器 _draining=false 时短路不清库，随后 restoreDrainState()
把旧容器的持久化排空状态误当新排空恢复。

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 2: 修复 `cancelDrain()` 无条件清库

**Files:**
- Modify: `packages/brain/src/drain.js:202-212`

- [ ] **Step 1: 把 `cancelDrain()` 改为无条件重置内存 + 无条件清库**

把 `packages/brain/src/drain.js` 第 199-212 行：

```javascript
/**
 * Cancel drain mode — resume normal dispatching.
 */
export async function cancelDrain() {
  if (!_draining) {
    return { success: true, was_draining: false };
  }

  log('[tick] Drain mode cancelled, resuming normal dispatch');
  _draining = false;
  _drainStartedAt = null;
  await clearPersistedDrainState();
  return { success: true, was_draining: true };
}
```

替换为：

```javascript
/**
 * Cancel drain mode — resume normal dispatching.
 *
 * 无条件清持久化状态（不只在 _draining===true 时才清）：部署脚本的健康检查可能在
 * restoreDrainState() 把旧容器持久化的排空状态读回内存之前就先发来 drain-cancel，
 * 此时若只在 _draining===true 时才清库，会让这次 cancel 变成 no-op——旧持久化行
 * 留在 DB 里，随后 restoreDrainState() 一执行就把它误当"刚发生的排空"恢复进内存，
 * 派单卡到 15 分钟运行期超龄自愈（任务 30861749；见 restoreDrainState() 迁移到
 * listenWithRetry() 之前那处改动，这里是纵深防御第二层）。
 */
export async function cancelDrain() {
  const wasDraining = _draining;
  _draining = false;
  _drainStartedAt = null;
  await clearPersistedDrainState();

  if (wasDraining) {
    log('[tick] Drain mode cancelled, resuming normal dispatch');
  }
  return { success: true, was_draining: wasDraining };
}
```

- [ ] **Step 2: 运行 Task 1 的测试，确认变绿**

Run: `cd packages/brain && npx vitest run src/__tests__/drain.test.js -t "cancelDrain\(\) 在 restoreDrainState"`
Expected: PASS

- [ ] **Step 3: 运行 drain.test.js 全部用例，确认无回归**

Run: `cd packages/brain && npx vitest run src/__tests__/drain.test.js`
Expected: 全部 PASS（含已有的 "cancelDrain() 应清除 working_memory 里的持久化记录" 用例）

- [ ] **Step 4: Commit**

```bash
git add packages/brain/src/drain.js
git commit -m "fix(brain): cancelDrain() 无条件清持久化状态，堵住部署竞态第二层（任务 30861749）

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 3: 把 `restoreDrainState()` 挪到 `listenWithRetry()` 之前，删除重复调用

**Files:**
- Modify: `packages/brain/server.js:685-706`
- Modify: `packages/brain/src/tick-recovery.js:213-220`

- [ ] **Step 1: server.js — 在 `reconcileOwnerlessKernelRuns()` 之后、`listenWithRetry()` 之前插入 restoreDrainState()**

把 `packages/brain/server.js` 第 684-695 行（从 `// migration 422 会把无法证明存活 authority...` 注释开始，到 `await listenWithRetry(...)` 结束）：

```javascript
  // migration 422 会把无法证明存活 authority 的旧 active v2 run 留为 ownerless。
  // 在 listener 接受任何请求前先 fail-closed 收敛，定时 orphan guard 只做后备。
  const { reconcileOwnerlessKernelRuns } = await import(
    './src/orchestrator/kernel-controller-lifecycle.js'
  );
  const startupRecovered = await reconcileOwnerlessKernelRuns(pool);
  if (startupRecovered.length > 0) {
    console.log(`[Server] startup ownerless Kernel runs recovered=${startupRecovered.length}`);
  }

  await listenWithRetry(server, Number(PORT), { maxAttempts: 3, retryDelayMs: 2_000 });
```

替换为：

```javascript
  // migration 422 会把无法证明存活 authority 的旧 active v2 run 留为 ownerless。
  // 在 listener 接受任何请求前先 fail-closed 收敛，定时 orphan guard 只做后备。
  const { reconcileOwnerlessKernelRuns } = await import(
    './src/orchestrator/kernel-controller-lifecycle.js'
  );
  const startupRecovered = await reconcileOwnerlessKernelRuns(pool);
  if (startupRecovered.length > 0) {
    console.log(`[Server] startup ownerless Kernel runs recovered=${startupRecovered.length}`);
  }

  // 排空状态必须在 listener 接受任何请求前恢复完毕（任务 30861749）：原先
  // restoreDrainState() 在 onBrainListening() 异步链尾部（initTickLoop 里）才跑，
  // 而 Express 路由在 listenWithRetry() 之后立即可用——部署脚本的健康检查和
  // drain-cancel 请求几乎必然抢在 restore 之前到达，新容器 _draining 还是初始
  // false，cancel 被当 no-op，随后 restore 又把旧容器的持久化排空状态误恢复。
  // 挪到这里与 reconcileOwnerlessKernelRuns 同一处 "listener 前收敛"，从根本上
  // 消除这个时间窗口。
  try {
    const { restoreDrainState } = await import('./src/drain.js');
    await restoreDrainState();
  } catch (drainErr) {
    console.error('[Server] restoreDrainState failed (non-fatal):', drainErr.message);
  }

  await listenWithRetry(server, Number(PORT), { maxAttempts: 3, retryDelayMs: 2_000 });
```

- [ ] **Step 2: tick-recovery.js — 删除 initTickLoop() 里重复的 restoreDrainState() 调用**

把 `packages/brain/src/tick-recovery.js` 第 212-220 行：

```javascript
    // Restore drain state persisted before a possible restart (07-19 bug fix —
    // draining was purely in-memory, Gate3 deploy restarts silently cleared it).
    try {
      const { restoreDrainState } = await import('./drain.js');
      await restoreDrainState();
    } catch (drainErr) {
      console.error('[tick-loop] restoreDrainState failed (non-fatal):', drainErr.message);
    }

```

替换为：

```javascript
    // 07-19 bug fix 的 restoreDrainState() 调用已迁移到 server.js 的
    // listenWithRetry() 之前（任务 30861749）：必须在 listener 接受任何请求前
    // 完成恢复，留在这里（onBrainListening 异步链尾部）会与部署脚本的健康检查/
    // drain-cancel 请求形成竞态。此处不再重复调用，避免出现"启动链里 restore
    // 两次"的新时序假设。

```

- [ ] **Step 3: 确认没有遗漏其他调用点**

Run: `cd packages/brain && grep -rn "restoreDrainState" src/ server.js`
Expected: 只剩两处——`src/drain.js`（函数定义 + export）和 `server.js`（新调用点）；`tick-recovery.js` 里不应再出现 `restoreDrainState(`

- [ ] **Step 4: 跑 DevGate（改 Brain 代码前置门禁，CLAUDE.md 强制）**

Run: `node scripts/facts-check.mjs && bash scripts/check-version-sync.sh && node packages/quality/scripts/devgate/check-dod-mapping.cjs`
Expected: 三条全部通过（不涉及 SSOT 事实/版本号，预期无输出或 PASS 提示）

- [ ] **Step 5: 跑 drain 相关全部测试（unit + integration）确认无回归**

Run: `cd packages/brain && npx vitest run src/__tests__/drain.test.js src/__tests__/integration/tick-drain-persist.integration.test.js`
Expected: 全部 PASS

- [ ] **Step 6: Commit**

```bash
git add packages/brain/server.js packages/brain/src/tick-recovery.js
git commit -m "fix(brain): restoreDrainState() 挪到 listenWithRetry() 之前，消除部署竞态根因（任务 30861749）

比照已有的 reconcileOwnerlessKernelRuns() 'listener 前收敛' 模式：端口开放前
先把排空状态从 DB 恢复完毕，部署脚本的健康检查/drain-cancel 到达时新容器
_draining 已是历史真实值，不再有状态未恢复的窗口。删除 tick-recovery.js 里
重复的调用点，避免双重 restore 引入新竞态。

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 4: 全量测试 + smoke.sh 检查 + push + PR

**Files:**
- 无新文件（本 task 为验证/收尾）

- [ ] **Step 1: 跑 Brain 包全量测试**

Run: `cd packages/brain && npx vitest run`
Expected: 全部 PASS（无新增失败）

- [ ] **Step 2: 检查是否需要 smoke.sh（本次是 fix: 类 PR，非 feat:，按 CLAUDE.md 规则 smoke.sh 强制仅对 feat: 类要求）**

Run: `git log --oneline main..HEAD | head -1`
确认最终会 squash 成 `fix(brain): ...` 前缀（非 `feat:`），本次改动不需要新增 `smoke/<feature>-smoke.sh`。

- [ ] **Step 3: 清理调试痕迹**

Run: `git diff main..HEAD -- packages/brain/src/drain.js packages/brain/server.js packages/brain/src/tick-recovery.js`
确认无 `console.log` 调试残留、无注释掉的死代码（CLAUDE.md 第 18 条）。

- [ ] **Step 4: push 分支**

```bash
git push -u origin cp-0930132011-drain-cancel-race-fix
```

- [ ] **Step 5: 开 PR**

```bash
gh pr create --title "fix(brain): 部署后 drain-cancel 竞态导致派单停摆约15分钟（任务 30861749）" --body "$(cat <<'EOF'
## Summary
- 根因：新容器端口先开放（listenWithRetry），restoreDrainState() 在 onBrainListening() 异步链尾部才跑；部署脚本健康检查通过后立刻发来的 drain-cancel 命中 cancelDrain() 的 `_draining===false` 短路变成 no-op，随后 restoreDrainState() 把旧容器持久化的排空状态误当新排空恢复，只能等 15 分钟运行期超龄自愈（PR #5668 的兜底）。
- 修法：① cancelDrain() 无条件清持久化状态；② restoreDrainState() 挪到 listenWithRetry() 之前，比照仓库已有的 reconcileOwnerlessKernelRuns() "listener 前收敛" 模式；③ 删除 tick-recovery.js 里重复的调用点。
- 设计文档：docs/superpowers/specs/2026-09-30-drain-cancel-race-design.md

## Test plan
- [x] drain.test.js 新增失败测试先 commit，复现竞态（cancel-before-restore 时序）
- [x] 修复后该测试变绿，drain.test.js 全量 + tick-drain-persist.integration.test.js 无回归
- [x] DevGate 三项校验通过
- [ ] CI 全绿
- [ ] 生产部署一次，切换完成后 ≤2 分钟内出现派单（合并后复测，回写 Brain 任务 30861749）

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

- [ ] **Step 6: 记录 PR URL，等待 CI**

Run: `gh pr view --json url,number -q '.url + " #" + (.number|tostring)'`
把输出的 PR URL 记下来，交给下一步的 CI 监控。
