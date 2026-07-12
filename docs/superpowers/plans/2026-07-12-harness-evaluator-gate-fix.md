# Harness Evaluator Gate Fix Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** relay-watchdog 发现 harness PR 已 MERGED 时，必须先确认 `initiative_run_events` 里
真的有 `node='evaluator' AND status='done'` 事件才能当"干净完成"处理；缺失时仍标 done（PR
客观已合并，无法撤销）但打 `failure_reason='merged_without_evaluator_gate'`、跳过
regression 提升、开 P1 Issue + 发 Bark，让"未经验收的合并"不再被系统静默吞掉。同时给
ledger-hygiene 加一项 m6 指标持续监控这个比例，防止问题再次悄悄堆积 7 天才被发现。

**Architecture:** 在 `harness-relay-watchdog.js` 里新增三个内部辅助函数
（`_hasEvaluatorGate` / `_raiseUngatedMergeAlert` / `_finalizeMergedRun`），把原本分别写在
两条 MERGED 判定分支（直接读 pr_url 分支 + GitHub 反查分支）里、彼此重复的"标 done + 标
completed + 触发 regression 提升"逻辑收口成一处，加一道门禁分支。`ledger-hygiene.js` 沿用
既有 m1-m5 的 `computeMetrics`/`evaluateRatchet`/`raiseBreachAlerts` 管线新增 m6，不新增
基础设施。

**Tech Stack:** Node.js (ESM), vitest, PostgreSQL（`pg` pool，测试用 mock pool）

## Global Constraints

- 所有新 SQL 必须走参数化查询（`$1`/`$2`），不得字符串拼接用户输入
- 现有 `harness-relay-watchdog.test.js` / `harness-relay-watchdog-pr-discovery.test.js` 里
  "MERGED → 标 done" 的用例代表"evaluator 已正常验收"的正常路径，必须继续保持绿——本次改动
  给它们的 mock 补 `evaluatorGate: true` 数据，不改它们的断言
- Issue/Bark 写入必须 best-effort（try/catch 包裹，失败只 warn，不能让 watchdog 主循环因为
  告警失败而抛错中断其他 initiative 的处理——这是文件里所有旁路写入的既定纪律，见
  `promoteRegressionOnHarnessMerged` 调用处的 try/catch 写法）
- 不改 `harness-controller` SKILL.md（根因已证实不在那里，改了也不解决问题）
- 不做 GitHub 分支保护 required check（另立 Notion Issue 跟踪，见设计文档"范围外"一节）

---

### Task 1: relay-watchdog 加 evaluator 门禁辅助函数 + 接入直接 pr_url 分支

**Files:**
- Modify: `packages/brain/src/harness-relay-watchdog.js:150-186`（直接 pr_url MERGED 分支）
- Test: `packages/brain/src/__tests__/harness-relay-watchdog.test.js`

**Interfaces:**
- Produces:
  - `export async function _hasEvaluatorGate(dbPool, initiativeId)` → `Promise<boolean>`
  - `export async function _raiseUngatedMergeAlert(dbPool, initiativeId, prUrl)` → `Promise<void>`（best-effort，不抛错）
  - `export async function _finalizeMergedRun(dbPool, initiativeId, prUrl, out, opts)` →
    `Promise<void>`，`opts = { setPrUrl?: boolean }`（`setPrUrl=true` 时 UPDATE 语句里带
    `pr_url=$2`，用于 GitHub 反查分支——run 行原本没有 pr_url，发现时要顺手回写）
  - `out` 参数是调用方（`resumeStalledRelayRuns`）里累积的统计对象，本函数会
    `out.mergedPr++`（门禁通过或未通过都算一次"发现了 MERGED"）以及门禁未通过时额外
    `out.mergedWithoutGate = (out.mergedWithoutGate || 0) + 1`

- [ ] **Step 1: 写失败测试 — makeDeps 支持 evaluatorGate 参数，先补齐现有"MERGED→done"用例的 mock**

打开 `packages/brain/src/__tests__/harness-relay-watchdog.test.js`，把 `makeDeps` 函数改成：

```javascript
function makeDeps({
  taskStatus = 'in_progress',
  attempts = 2,
  containerRunning = false,
  orchestrator = 'skill-relay',
  prUrl = null,
  prState = null,   // 'MERGED' | 'OPEN' | 'CLOSED' | null（execFn 返回的 gh pr view JSON）
  orchestratorHost = 'skill-relay-session',
  evaluatorGate = true, // initiative_run_events 是否存在 node='evaluator' AND status='done'
} = {}) {
  const pool = { query: vi.fn() };
  pool.query.mockImplementation(async (sql) => {
    if (/DISTINCT ON \(initiative_id\)/.test(sql)) {
      return { rows: [{ initiative_id: TASK_ID, phase: 'planning', attempts: String(attempts), deadline_at: new Date(Date.now() + 3600e3).toISOString(), pr_url: prUrl, orchestrator_host: orchestratorHost }] };
    }
    if (/FROM tasks/.test(sql)) {
      return { rows: [{ id: TASK_ID, status: taskStatus, title: 't', payload: { orchestrator } }] };
    }
    if (/FROM initiative_run_events/.test(sql)) {
      return { rows: evaluatorGate ? [{ x: 1 }] : [] };
    }
    return { rows: [] };
  });
  const execFn = vi.fn().mockImplementation((cmd) => {
    if (/docker ps/.test(cmd)) return containerRunning ? 'abc123\n' : '';
    if (/gh pr view/.test(cmd) && prState) return JSON.stringify({ state: prState });
    return '';
  });
  return {
    pool,
    execFn,
    spawnFn: vi.fn().mockResolvedValue({ ok: true, containerId: 'cecelia-relay-x' }),
  };
}
```

（唯一变化：新增 `evaluatorGate = true` 参数 + `if (/FROM initiative_run_events/.test(sql))`
分支；默认值 `true` 保证下面所有既有"MERGED→done"用例不用逐个改调用处就能继续代表"正常验收
通过"的路径。）

紧接着，在 `describe('resumeStalledRelayRuns', ...)` 块末尾（`容器消失 + pr_url 为 null →
直接走重点火` 这条 it 之后、`});` 之前）新增一条新用例：

```javascript
  it('容器消失 + pr_url 存在 + PR MERGED + evaluator 从未执行 → 标 done 但打 failure_reason，不触发 regression 提升，发告警', async () => {
    const deps = makeDeps({ prUrl: PR_URL, prState: 'MERGED', evaluatorGate: false });
    const r = await resumeStalledRelayRuns(deps);
    expect(deps.spawnFn).not.toHaveBeenCalled();
    const updates = deps.pool.query.mock.calls.map(c => c[0]);
    expect(updates.some(s => /UPDATE initiative_runs/.test(s) && /'done'/.test(s) && /failure_reason/.test(s) && /merged_without_evaluator_gate/.test(s))).toBe(true);
    expect(updates.some(s => /UPDATE tasks/.test(s) && /'completed'/.test(s))).toBe(true);
    expect(r.mergedWithoutGate).toBe(1);
  });
```

这条测试此时应该失败（`_finalizeMergedRun`/`failure_reason` 分支还不存在，SQL 里没有
`failure_reason`，`out.mergedWithoutGate` 是 `undefined`）。

- [ ] **Step 2: 运行测试确认失败**

Run: `cd packages/brain && npx vitest run src/__tests__/harness-relay-watchdog.test.js`
Expected: 新增的这条用例 FAIL（`updates.some(...)` 断言不满足，`r.mergedWithoutGate` 是
`undefined` 不是 `1`）；其余既有用例这一步应该仍然 PASS（因为默认 `evaluatorGate: true`
让原逻辑分支照旧触发，SQL 文本此时还没变）。

- [ ] **Step 3: 实现门禁辅助函数 + 接入直接 pr_url 分支**

打开 `packages/brain/src/harness-relay-watchdog.js`。在文件顶部 import 区（第 13-17 行）
后面新增三个导出函数（放在 `_discoverPrFromGithub` 定义之后、`resumeStalledRelayRuns`
定义之前，即原第 53 行空行处）：

```javascript
/**
 * 查 initiative_run_events 是否存在 evaluator 已完成的心跳记录——
 * "PR 已 MERGED" 不等于"harness 验收流程走完了"，这是唯一能区分两者的机器信号。
 */
export async function _hasEvaluatorGate(dbPool, initiativeId) {
  const { rows } = await dbPool.query(
    `SELECT 1 FROM initiative_run_events WHERE initiative_id=$1 AND node='evaluator' AND status='done' LIMIT 1`,
    [initiativeId]
  );
  return rows.length > 0;
}

/**
 * PR 在 evaluator 从未执行时被合并（大概率人工看 CI 绿手动 merge）——开 P1 Issue + Bark。
 * best-effort：写入失败只 warn，绝不让告警失败拖垮 watchdog 主循环。
 */
export async function _raiseUngatedMergeAlert(dbPool, initiativeId, prUrl) {
  try {
    await dbPool.query(
      `INSERT INTO issues (title, priority, status, sub_area, body, journey_id)
       VALUES ($1, 'P1', 'In progress', 'brain', $2, NULL)`,
      [
        `[harness] initiative ${initiativeId} 的 PR 在 evaluator 未执行时被合并`,
        `PR ${prUrl} 已 MERGED，但 initiative_run_events 里从未出现 node='evaluator' AND status='done' 的记录——` +
          `这次合并绕过了 harness 的 evaluator+judge 验收流程（很可能是人工看 CI 绿之后手动合并）。` +
          `relay-watchdog 已把该 run 标 done 但打上 failure_reason='merged_without_evaluator_gate'，` +
          `不会触发 promoteRegressionOnHarnessMerged。请人工复核这份改动是否需要补验收。`,
      ]
    );
  } catch (err) {
    console.warn(`[relay-watchdog] 未验收合并 issue 写入失败 (non-fatal): ${err.message}`);
  }
  try {
    const { sendBark } = await import('./notifier.js');
    await sendBark(
      '⚠️ Harness PR 未经 evaluator 验收被合并',
      `initiative=${initiativeId}\nPR=${prUrl}\n请立即核查这份改动是否符合合同验收标准。`
    );
  } catch (err) {
    console.warn(`[relay-watchdog] 未验收合并 Bark 发送失败 (non-fatal): ${err.message}`);
  }
}

/**
 * PR 已确认 MERGED 时的统一收口：门禁通过 → 原行为（标 done/completed + 触发 regression 提升）；
 * 门禁未通过 → 仍标 done/completed（PR 客观已合并无法撤销）但打 failure_reason，跳过 regression
 * 提升，并发未验收合并告警。opts.setPrUrl=true 用于 GitHub 反查分支（run 行本无 pr_url，顺手回写）。
 */
export async function _finalizeMergedRun(dbPool, initiativeId, prUrl, out, opts = {}) {
  const { setPrUrl = false } = opts;
  const gated = await _hasEvaluatorGate(dbPool, initiativeId);

  const runSql = gated
    ? `UPDATE initiative_runs SET phase='done', completed_at=NOW()${setPrUrl ? ', pr_url=$2' : ''}
        WHERE initiative_id=$1 AND orchestrator_version='v2' AND phase NOT IN ('done','failed')`
    : `UPDATE initiative_runs SET phase='done', completed_at=NOW(), failure_reason='merged_without_evaluator_gate'${setPrUrl ? ', pr_url=$2' : ''}
        WHERE initiative_id=$1 AND orchestrator_version='v2' AND phase NOT IN ('done','failed')`;
  await dbPool.query(runSql, setPrUrl ? [initiativeId, prUrl] : [initiativeId]);

  const taskSql = setPrUrl
    ? `UPDATE tasks SET status='completed', completed_at=NOW(), pr_url=$2 WHERE id=$1 AND status='in_progress'`
    : `UPDATE tasks SET status='completed', completed_at=NOW() WHERE id=$1 AND status='in_progress'`;
  await dbPool.query(taskSql, setPrUrl ? [initiativeId, prUrl] : [initiativeId]);

  out.mergedPr++;

  if (gated) {
    try {
      const { promoteRegressionOnHarnessMerged } = await import('./lib/callback-postprocess.js');
      await promoteRegressionOnHarnessMerged(initiativeId, null, prUrl, dbPool);
    } catch (promoteErr) {
      console.warn(`[relay-watchdog] promoteRegressionOnHarnessMerged 失败 (non-fatal): ${promoteErr.message}`);
    }
    console.log(`[relay-watchdog] PR 已 MERGED（evaluator 已验收）→ 标 completed initiative=${initiativeId} pr=${prUrl}`);
  } else {
    out.mergedWithoutGate = (out.mergedWithoutGate || 0) + 1;
    await _raiseUngatedMergeAlert(dbPool, initiativeId, prUrl);
    console.warn(`[relay-watchdog] PR 已 MERGED 但 evaluator 未执行 → 标 done+未验收告警 initiative=${initiativeId} pr=${prUrl}`);
  }
}
```

然后把直接 pr_url 分支（原 L154-173）里的 `if (prState === 'MERGED') { ... }` 整段方法体
换成调用新函数：

```javascript
          if (prState === 'MERGED') {
            await _finalizeMergedRun(dbPool, run.initiative_id, effectivePrUrl, out);
            continue;
          }
```

（删掉原来手写的两条 UPDATE + try/catch promote 块，只留这三行。）

- [ ] **Step 4: 运行测试确认全部通过**

Run: `cd packages/brain && npx vitest run src/__tests__/harness-relay-watchdog.test.js`
Expected: 全部用例 PASS（含 Step 1 新增的未验收场景，也含所有原有用例——它们默认走
`evaluatorGate: true`，SQL 文本仍含 `'done'`/`'completed'`，正则断言不受
`_finalizeMergedRun` 内部实现变化影响）

- [ ] **Step 5: Commit**

```bash
git add packages/brain/src/harness-relay-watchdog.js packages/brain/src/__tests__/harness-relay-watchdog.test.js
git commit -m "fix(harness): relay-watchdog PR MERGED 前校验 evaluator 门禁，未验收合并不再静默标 done"
```

---

### Task 2: GitHub 反查分支接入同一门禁

**Files:**
- Modify: `packages/brain/src/harness-relay-watchdog.js:199-218`（GitHub 反查 MERGED 分支）
- Test: `packages/brain/src/__tests__/harness-relay-watchdog-pr-discovery.test.js`

**Interfaces:**
- Consumes: Task 1 produ的 `_finalizeMergedRun(dbPool, initiativeId, prUrl, out, { setPrUrl })`

- [ ] **Step 1: 写失败测试 — makeDeps 补 evaluatorGate 参数 + 新增未验收场景用例**

打开 `packages/brain/src/__tests__/harness-relay-watchdog-pr-discovery.test.js`，把
`makeDeps` 改成：

```javascript
function makeDeps({
  baseRepo = BASE_REPO,
  ghList = null,
  ghListThrows = false,
  runPrUrl = null,     // 第二轮回归：模拟 DB 里 run.pr_url 已非空（第一轮已发现并回写）
  prViewState = null,  // 配合 runPrUrl：execFn 对 `gh pr view` 的返回 state
  evaluatorGate = true, // initiative_run_events 是否存在 node='evaluator' AND status='done'
} = {}) {
  const pool = { query: vi.fn() };
  pool.query.mockImplementation(async (sql) => {
    if (/DISTINCT ON \(initiative_id\)/.test(sql)) {
      return { rows: [{ initiative_id: TASK_ID, phase: 'planning', attempts: '2', deadline_at: new Date(Date.now() + 3600e3).toISOString(), pr_url: runPrUrl, orchestrator_host: 'skill-relay-session' }] };
    }
    if (/FROM tasks/.test(sql)) {
      return { rows: [{ id: TASK_ID, status: 'in_progress', title: 't', pr_url: null, payload: { orchestrator: 'skill-relay', base_repo: baseRepo } }] };
    }
    if (/FROM initiative_run_events/.test(sql)) {
      return { rows: evaluatorGate ? [{ x: 1 }] : [] };
    }
    return { rows: [] };
  });
  const execFn = vi.fn().mockImplementation((cmd) => {
    if (/docker ps/.test(cmd)) return ''; // 容器已消失
    if (/gh pr view/.test(cmd) && prViewState) return JSON.stringify({ state: prViewState });
    if (/gh pr list/.test(cmd)) {
      if (ghListThrows) throw new Error('gh boom');
      return JSON.stringify(ghList ?? []);
    }
    return '';
  });
  return { pool, execFn, spawnFn: vi.fn().mockResolvedValue({ ok: true, containerId: 'x' }) };
}
```

在 `describe('watchdog PR 发现护栏', ...)` 块内、`gh 发现含 short 的 MERGED PR → 收敛` 这条
it 之后新增：

```javascript
  it('gh 发现含 short 的 MERGED PR 但 evaluator 从未执行 → 标 done 打 failure_reason，不重点火', async () => {
    const deps = makeDeps({ ghList: [MERGED_PR], evaluatorGate: false });
    const r = await resumeStalledRelayRuns(deps);
    expect(deps.spawnFn).not.toHaveBeenCalled();
    const updates = deps.pool.query.mock.calls.filter((c) => /UPDATE/.test(c[0]));
    expect(updates.some((c) => /initiative_runs/.test(c[0]) && /'done'/.test(c[0]) && /merged_without_evaluator_gate/.test(c[0]))).toBe(true);
    expect(updates.some((c) => /UPDATE tasks/.test(c[0]) && /'completed'/.test(c[0]))).toBe(true);
    expect(r.mergedWithoutGate).toBe(1);
  });
```

- [ ] **Step 2: 运行测试确认新增用例失败，其余仍过**

Run: `cd packages/brain && npx vitest run src/__tests__/harness-relay-watchdog-pr-discovery.test.js`
Expected: 新增用例 FAIL；其余（默认 `evaluatorGate: true`）PASS

- [ ] **Step 3: 接入 `_finalizeMergedRun`**

在 `harness-relay-watchdog.js` 里，把 GitHub 反查分支（原 L199-218）里
`if (discovered && discovered.state === 'MERGED') { ... }` 的方法体换成：

```javascript
        if (discovered && discovered.state === 'MERGED') {
          await _finalizeMergedRun(dbPool, run.initiative_id, discovered.url, out, { setPrUrl: true });
          continue;
        }
```

- [ ] **Step 4: 运行两个测试文件确认全部通过**

Run: `cd packages/brain && npx vitest run src/__tests__/harness-relay-watchdog.test.js src/__tests__/harness-relay-watchdog-pr-discovery.test.js`
Expected: 全部 PASS

- [ ] **Step 5: Commit**

```bash
git add packages/brain/src/harness-relay-watchdog.js packages/brain/src/__tests__/harness-relay-watchdog-pr-discovery.test.js
git commit -m "fix(harness): GitHub 反查 MERGED 分支同接 evaluator 门禁"
```

---

### Task 3: ledger-hygiene 新增 m6 指标（done run vs evaluator 事件覆盖率）

**Files:**
- Modify: `packages/brain/src/ledger-hygiene.js`
- Test: `packages/brain/src/__tests__/ledger-hygiene.test.js`

**Interfaces:**
- Consumes: 无新依赖，复用文件内既有 `safeMetric`/`toInt`
- Produces: `computeMetrics()` 返回对象新增 `m6` 字段，结构同 m1-m5：
  `{ key: 'm6', name: string, value: number|null, debt: number, enabled: boolean }`

- [ ] **Step 1: 写失败测试**

打开 `packages/brain/src/__tests__/ledger-hygiene.test.js`，在
`describe('computeMetrics — 5 项指标', ...)` 块末尾（m5 用例之后、`});` 之前）新增：

```javascript
  it('m6 evaluator 门禁覆盖率：4 个 done run，1 个无 evaluator 事件 → value=3/4, debt=1', async () => {
    const pool = makePool([
      { match: 'FROM initiative_runs r', rows: [{ total: '4', debt: '1' }] },
    ]);
    const m = await computeMetrics(pool);
    expect(m.m6.debt).toBe(1);
    expect(m.m6.value).toBeCloseTo(3 / 4);
    expect(m.m6.enabled).toBe(true);
  });

  it('m6 近7天无 done run → value=1, debt=0（真空真值）', async () => {
    const pool = makePool([
      { match: 'FROM initiative_runs r', rows: [{ total: '0', debt: '0' }] },
    ]);
    const m = await computeMetrics(pool);
    expect(m.m6.value).toBe(1);
    expect(m.m6.debt).toBe(0);
  });
```

这两条测试此时应该报错——`describe('computeMetrics — 5 项指标', ...)` 的标题也需要在本
Step 顺手改成 `'computeMetrics — 6 项指标'`（下一 Step 实现后 5→6 项才是事实）。

- [ ] **Step 2: 运行测试确认失败**

Run: `cd packages/brain && npx vitest run src/__tests__/ledger-hygiene.test.js -t "m6"`
Expected: 两条新用例 FAIL（`m.m6` 是 `undefined`，访问 `.debt` 抛 TypeError）

- [ ] **Step 3: 实现 m6 指标**

打开 `packages/brain/src/ledger-hygiene.js`。在 `computeMetrics` 函数内、`m5` 定义（第
120-138 行）之后、`return { m1, m2, m3, m4, m5 };`（第 140 行）之前插入：

```javascript
  const m6 = await safeMetric(async () => {
    // evaluator 门禁覆盖率：近 7 天 v2 relay run 里 phase='done' 的行，
    // 有多少缺失 initiative_run_events(node='evaluator', status='done')——
    // 缺失即"PR 合并但从未经 evaluator 验收"（c36326c8 machine gate 配套指标）。
    const { rows } = await pool.query(
      `SELECT count(*) AS total,
              count(*) FILTER (
                WHERE NOT EXISTS (
                  SELECT 1 FROM initiative_run_events e
                  WHERE e.initiative_id = r.initiative_id AND e.node = 'evaluator' AND e.status = 'done'
                )
              ) AS debt
       FROM initiative_runs r
       WHERE r.orchestrator_version = 'v2'
         AND r.phase = 'done'
         AND r.completed_at >= NOW() - INTERVAL '7 days'`
    );
    const total = toInt(rows[0]?.total);
    const debt = toInt(rows[0]?.debt);
    return { key: 'm6', name: 'evaluator门禁覆盖率', value: total === 0 ? 1 : (total - debt) / total, debt, enabled: true };
  }, { key: 'm6', name: 'evaluator门禁覆盖率', value: null, debt: 0 });

  return { m1, m2, m3, m4, m5, m6 };
```

（删掉原来的 `return { m1, m2, m3, m4, m5 };` 那一行，改成上面带 m6 的版本。）

- [ ] **Step 4: 运行测试确认全部通过**

Run: `cd packages/brain && npx vitest run src/__tests__/ledger-hygiene.test.js`
Expected: 全部 PASS（含新增 m6 用例；`renderHygieneMarkdown`/`evaluateRatchet` 都是纯函数
按 `Object.values(metrics)` 遍历，无需改动就能自动纳入 m6）

- [ ] **Step 5: Commit**

```bash
git add packages/brain/src/ledger-hygiene.js packages/brain/src/__tests__/ledger-hygiene.test.js
git commit -m "feat(ledger-hygiene): 新增 m6 evaluator 门禁覆盖率指标，脱钩持续监控"
```

---

### Task 4: 全量回归 + smoke 脚本

**Files:**
- Test: 全量 `packages/brain` vitest 套件
- Create: `packages/brain/scripts/smoke/harness-evaluator-gate-smoke.sh`
- Modify: `packages/quality/smoke-allowlist.txt`（登记新 smoke 脚本，engine CI lint 要求）

**Interfaces:**
- 无新接口，纯回归 + smoke 验证

- [ ] **Step 1: 跑 harness-relay-watchdog + ledger-hygiene 相关全量测试**

Run: `cd packages/brain && npx vitest run src/__tests__/harness-relay-watchdog.test.js src/__tests__/harness-relay-watchdog-pr-discovery.test.js src/__tests__/ledger-hygiene.test.js`
Expected: 全部 PASS，无 skip

- [ ] **Step 2: 跑 harness-watchdog-loop 相关测试确认接线未破**

Run: `cd packages/brain && npx vitest run src/__tests__/harness-relay-watchdog.test.js -t "watchdog loop 接线"`
Expected: PASS（`runHarnessWatchdogOnce` 调用 `resumeStalledRelayRuns` 的接线测试，
本次改动没碰 `harness-watchdog-loop.js`，理应保持绿）

- [ ] **Step 3: 写 smoke 脚本**

创建 `packages/brain/scripts/smoke/harness-evaluator-gate-smoke.sh`：

```bash
#!/usr/bin/env bash
# Smoke: harness-relay-watchdog 导出的门禁函数存在且签名符合预期（静态检查，不连库不连网）。
set -euo pipefail
FILE="packages/brain/src/harness-relay-watchdog.js"

grep -q "export async function _hasEvaluatorGate" "$FILE" || { echo "FAIL: _hasEvaluatorGate 缺失"; exit 1; }
grep -q "export async function _raiseUngatedMergeAlert" "$FILE" || { echo "FAIL: _raiseUngatedMergeAlert 缺失"; exit 1; }
grep -q "export async function _finalizeMergedRun" "$FILE" || { echo "FAIL: _finalizeMergedRun 缺失"; exit 1; }
grep -q "merged_without_evaluator_gate" "$FILE" || { echo "FAIL: failure_reason 标记缺失"; exit 1; }

LEDGER="packages/brain/src/ledger-hygiene.js"
grep -q "key: 'm6'" "$LEDGER" || { echo "FAIL: m6 指标缺失"; exit 1; }

echo "PASS: harness evaluator gate 机器闸 + m6 指标均已就位"
```

```bash
chmod +x packages/brain/scripts/smoke/harness-evaluator-gate-smoke.sh
./packages/brain/scripts/smoke/harness-evaluator-gate-smoke.sh
```

Expected: 脚本本地直接跑输出 `PASS: ...`

- [ ] **Step 4: 登记进 smoke allowlist**

打开 `packages/quality/smoke-allowlist.txt`，在文件末尾追加一行：

```
packages/brain/scripts/smoke/harness-evaluator-gate-smoke.sh
```

- [ ] **Step 5: Commit**

```bash
git add packages/brain/scripts/smoke/harness-evaluator-gate-smoke.sh packages/quality/smoke-allowlist.txt
git commit -m "test(harness): 加 evaluator 门禁 smoke 脚本并登记 allowlist"
```

---

## Self-Review Notes（写完后自查，无需重跑，直接照此结论收尾）

- **spec 覆盖**：设计文档"方案·范围内"两条（relay-watchdog 机器闸 / ledger-hygiene m6）
  分别对应 Task 1+2 / Task 3；"范围外"（GitHub 分支保护）明确不在本计划任务列表里，
  已在 Global Constraints 里重申不做
- **占位符扫描**：全部 Step 都是可直接执行的命令/完整代码块，无 TBD
- **类型一致性**：`_finalizeMergedRun(dbPool, initiativeId, prUrl, out, opts)` 在 Task 1
  定义、Task 2 两处调用点参数顺序/命名一致；`out.mergedWithoutGate` 命名在 Task 1/2
  测试断言里一致
