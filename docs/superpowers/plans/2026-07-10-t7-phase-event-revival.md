# T7 phase-event 复活 + zombie-reaper 心跳判活 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让 harness relay 会话重新写入 `initiative_run_events`（skill 侧自报），并让 zombie-reaper 把该表最后心跳作为第二判活信号（任一信号活即不杀）。

**Architecture:** 两个独立改动、两个 repo、两个 PR。① cecelia repo：`zombie-reaper.js` 在 `assessTaskLiveness` 判 dead 后、onStale 处置前插入心跳查询，心跳新鲜则跳过；② zenithjoy-skills repo：`harness-controller/SKILL.md` 每阶段派 subagent 前后 POST/PATCH `/api/brain/harness/phase-event`。互不阻塞，skill PR 可先合。

**Tech Stack:** Node.js ESM + vitest（pool.query 顺序 mock）；skill 侧为 markdown 指令 + curl。

**设计文档：** `docs/superpowers/specs/2026-07-10-t7-phase-event-revival-design.md`

---

### Task 1: zombie-reaper 心跳判活 — failing tests（commit 1, Red）

**Files:**
- Modify: `packages/brain/src/__tests__/zombie-reaper.test.js`

- [ ] **Step 1: 适配既有 (a)(e)(f) 用例 + 新增 4 个心跳用例**

改动原则：实现后每个 dead 任务在 UPDATE 前会多一次心跳 SELECT，既有用例的 mock 序列与 `toHaveBeenCalledTimes` 相应调整；心跳无行时返回 `{ rows: [{ last_hb: 0 }] }`（GREATEST/COALESCE 保证无行也返回 0，实际 MAX 聚合永远返回一行）。

对 `zombie-reaper.test.js` 做以下修改：

(a) 用例：mock 序列在 SELECT 与 UPDATE 之间插入心跳查询，断言从 2 次调用改为 3 次，UPDATE 断言改用 `mock.calls[2]`：

```js
  it('(a) brain-local probe=dead → 标 failed', async () => {
    const zombieRow = { id: 'task-uuid-1', title: 'stuck task', executor_kind: 'brain-local', updated_at: new Date(Date.now() - 31 * 60 * 1000).toISOString(), last_attempt_at: null, claimed_by: null };
    pool.query
      .mockResolvedValueOnce({ rows: [zombieRow], rowCount: 1 })          // SELECT zombies
      .mockResolvedValueOnce({ rows: [{ last_hb: 0 }], rowCount: 1 })     // T7 心跳查询（无心跳）
      .mockResolvedValueOnce({ rows: [], rowCount: 1 });                  // UPDATE

    const result = await reapZombies({ pool, idleMinutes: 30 });

    expect(pool.query).toHaveBeenCalledTimes(3);

    const selectCall = pool.query.mock.calls[0][0];
    expect(selectCall).toMatch(/status\s*=\s*'in_progress'/);
    expect(selectCall).toMatch(/updated_at/);

    const updateCall = pool.query.mock.calls[2][0];
    expect(updateCall).toMatch(/status\s*=\s*'failed'/);
    const updateParams = pool.query.mock.calls[2][1];
    expect(updateParams[0]).toMatch(/zombie/i);

    expect(result.reaped).toBe(1);
    expect(result.errors).toHaveLength(0);
  });
```

(e) 用例：2 个 zombie → SELECT + 2×(心跳+UPDATE) = 5 次调用：

```js
    pool.query
      .mockResolvedValueOnce({ rows: zombies, rowCount: 2 })              // SELECT
      .mockResolvedValueOnce({ rows: [{ last_hb: 0 }], rowCount: 1 })     // 心跳 task-1
      .mockResolvedValueOnce({ rows: [], rowCount: 1 })                   // UPDATE task-1
      .mockResolvedValueOnce({ rows: [{ last_hb: 0 }], rowCount: 1 })     // 心跳 task-2
      .mockResolvedValueOnce({ rows: [], rowCount: 1 });                  // UPDATE task-2
    // ...
    expect(pool.query).toHaveBeenCalledTimes(5);
```

(f) 用例：SELECT + 心跳1 + UPDATE1(reject) + 心跳2 + UPDATE2：

```js
    pool.query
      .mockResolvedValueOnce({ rows: zombies, rowCount: 2 })              // SELECT
      .mockResolvedValueOnce({ rows: [{ last_hb: 0 }], rowCount: 1 })     // 心跳 task-1
      .mockRejectedValueOnce(new Error('DB write error'))                 // UPDATE task-1 fails
      .mockResolvedValueOnce({ rows: [{ last_hb: 0 }], rowCount: 1 })     // 心跳 task-2
      .mockResolvedValueOnce({ rows: [], rowCount: 1 });                  // UPDATE task-2
```

(g) 用例不变（alive 不走心跳查询，仍 1 次调用）。(b)(c)(d) 不变。

- [ ] **Step 2: 文件末尾（reapZombies describe 内）追加 T7 新用例**

```js
  // ============================================================
  // T7: phase-event 心跳第二判活信号
  // ============================================================

  it('(h) T7: updated_at 过期但 phase-event 心跳新鲜 → 不杀', async () => {
    const task = { id: 'task-hb-fresh', title: 'relay task', executor_kind: 'brain-local', updated_at: new Date(Date.now() - 90 * 60 * 1000).toISOString(), last_attempt_at: null, claimed_by: null, payload_initiative_id: null };
    const freshHb = Math.floor(Date.now() / 1000) - 60; // 1 分钟前的心跳
    pool.query
      .mockResolvedValueOnce({ rows: [task], rowCount: 1 })               // SELECT zombies
      .mockResolvedValueOnce({ rows: [{ last_hb: freshHb }], rowCount: 1 }); // 心跳新鲜

    const result = await reapZombies({ pool, idleMinutes: 60 });

    expect(pool.query).toHaveBeenCalledTimes(2); // 只有 SELECT + 心跳，没有 UPDATE
    expect(result.reaped).toBe(0);
    expect(result.errors).toHaveLength(0);
    // 心跳查询打在 initiative_run_events 表、用 task.id 作 initiative_id
    const hbCall = pool.query.mock.calls[1];
    expect(hbCall[0]).toMatch(/initiative_run_events/);
    expect(hbCall[1]).toEqual(['task-hb-fresh']);
  });

  it('(i) T7: 心跳过期 → 照常 reap', async () => {
    const task = { id: 'task-hb-stale', title: 'stale hb task', executor_kind: 'brain-local', updated_at: new Date(Date.now() - 90 * 60 * 1000).toISOString(), last_attempt_at: null, claimed_by: null, payload_initiative_id: null };
    const staleHb = Math.floor(Date.now() / 1000) - 70 * 60; // 70 分钟前（> idleMinutes=60）
    pool.query
      .mockResolvedValueOnce({ rows: [task], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [{ last_hb: staleHb }], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [], rowCount: 1 });                  // UPDATE

    const result = await reapZombies({ pool, idleMinutes: 60 });

    expect(result.reaped).toBe(1);
    expect(pool.query).toHaveBeenCalledTimes(3);
  });

  it('(j) T7: 心跳查询抛错 → 视为无心跳照常 reap，不进 result.errors', async () => {
    const task = { id: 'task-hb-err', title: 'hb err task', executor_kind: 'brain-local', updated_at: new Date(Date.now() - 90 * 60 * 1000).toISOString(), last_attempt_at: null, claimed_by: null, payload_initiative_id: null };
    pool.query
      .mockResolvedValueOnce({ rows: [task], rowCount: 1 })
      .mockRejectedValueOnce(new Error('relation does not exist'))        // 心跳查询失败
      .mockResolvedValueOnce({ rows: [], rowCount: 1 });                  // UPDATE 仍执行

    const result = await reapZombies({ pool, idleMinutes: 60 });

    expect(result.reaped).toBe(1);
    expect(result.errors).toHaveLength(0); // 心跳失败只 warn，不算任务处置错误
  });

  it('(k) T7: payload.initiative_id 存在时心跳查询用它而非 task.id', async () => {
    const task = { id: 'task-hb-payload', title: 'payload initiative task', executor_kind: 'brain-local', updated_at: new Date(Date.now() - 90 * 60 * 1000).toISOString(), last_attempt_at: null, claimed_by: null, payload_initiative_id: 'initiative-uuid-x' };
    const freshHb = Math.floor(Date.now() / 1000) - 60;
    pool.query
      .mockResolvedValueOnce({ rows: [task], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [{ last_hb: freshHb }], rowCount: 1 });

    const result = await reapZombies({ pool, idleMinutes: 60 });

    expect(result.reaped).toBe(0);
    expect(pool.query.mock.calls[1][1]).toEqual(['initiative-uuid-x']);
  });

  it('(l) T7: release-claim-and-alert 分支同样被心跳守卫保护', async () => {
    assessTaskLiveness.mockResolvedValue({ verdict: 'dead', onStale: 'release-claim-and-alert', kind: 'headed-session' });
    const task = { id: 'task-hb-headed', title: 'headed task', executor_kind: 'headed-session', updated_at: new Date(Date.now() - 180 * 60 * 1000).toISOString(), last_attempt_at: null, claimed_by: 'session:gone', payload_initiative_id: null };
    const freshHb = Math.floor(Date.now() / 1000) - 120;
    pool.query
      .mockResolvedValueOnce({ rows: [task], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [{ last_hb: freshHb }], rowCount: 1 });

    const result = await reapZombies({ pool, idleMinutes: 60 });

    expect(result.reaped).toBe(0);
    expect(pool.query).toHaveBeenCalledTimes(2);
  });
```

- [ ] **Step 3: 跑测试确认新用例 Red、说明失败原因**

Run: `cd packages/brain && npx vitest run src/__tests__/zombie-reaper.test.js 2>&1 | tail -30`
Expected: (h)(i)(j)(k)(l) FAIL（实现未加心跳查询，调用次数/参数不匹配）；(a)(e)(f) 也会 FAIL（mock 序列已按新行为改）。这是预期的 Red。

- [ ] **Step 4: Commit（Red）**

```bash
git add packages/brain/src/__tests__/zombie-reaper.test.js
git commit -m "test(brain): zombie-reaper phase-event心跳判活 failing tests (Red)" --no-verify
```

---

### Task 2: zombie-reaper 心跳判活 — 实现（commit 2, Green）

**Files:**
- Modify: `packages/brain/src/zombie-reaper.js`

- [ ] **Step 1: SELECT 增加 payload initiative_id 列**

`reapZombies` 里 SELECT 语句改为：

```js
    const selectResult = await pool.query(
      `SELECT id, title, task_type, executor_kind, last_attempt_at, claimed_by, updated_at,
              payload->>'initiative_id' AS payload_initiative_id
       FROM tasks
       WHERE status = 'in_progress'
         AND updated_at < NOW() - INTERVAL '${idleMinutes} minutes'
       ORDER BY updated_at ASC
       LIMIT 100`
    );
```

- [ ] **Step 2: 新增心跳检查函数（模块内，reapZombies 之前）**

```js
/**
 * T7 第二判活信号：initiative_run_events 最后心跳（skill-relay 阶段自报）。
 * initiative_id 镜像 harness-skill-relay 的 fallback：payload.initiative_id || task.id。
 * 查询失败或无心跳一律返回 false（回退到 updated_at 单信号，不影响原处置）。
 */
async function hasFreshPhaseEventHeartbeat(pool, task, idleMinutes) {
  const initiativeId = task.payload_initiative_id || task.id;
  try {
    const { rows } = await pool.query(
      `SELECT GREATEST(COALESCE(MAX(ts), 0), COALESCE(MAX(ts_end), 0)) AS last_hb
       FROM initiative_run_events
       WHERE initiative_id = $1::uuid`,
      [initiativeId]
    );
    const lastHb = Number(rows?.[0]?.last_hb || 0);
    if (!lastHb) return false;
    return Math.floor(Date.now() / 1000) - lastHb < idleMinutes * 60;
  } catch (err) {
    console.warn(
      `[zombie-reaper] heartbeat check failed task=${task.id}: ${err.message} — fallback to updated_at only`
    );
    return false;
  }
}
```

- [ ] **Step 3: 处置循环里 alive/unknown 跳过之后、onStale 分支之前插入**

```js
      // alive / unknown → fail-open，跳过
      if (liveness.verdict === 'alive' || liveness.verdict === 'unknown') {
        console.log(`[zombie-reaper] Skip task id=${task.id} verdict=${liveness.verdict}`);
        continue;
      }

      // T7: 第二判活信号——phase-event 心跳新鲜则不杀（任一信号活即不判死）
      if (await hasFreshPhaseEventHeartbeat(pool, task, idleMinutes)) {
        console.log(`[zombie-reaper] Skip task id=${task.id} — phase-event heartbeat fresh`);
        continue;
      }
```

- [ ] **Step 4: 跑测试确认全绿**

Run: `cd packages/brain && npx vitest run src/__tests__/zombie-reaper.test.js 2>&1 | tail -15`
Expected: 全部 PASS（含 (a)-(l)）。

- [ ] **Step 5: 跑相邻守护刀测试防误伤**

Run: `cd packages/brain && npx vitest run src/__tests__/executor-contracts.test.js src/__tests__/zombie-cleaner.test.js src/__tests__/zombie-sweep.test.js 2>&1 | tail -8`
Expected: 全部 PASS。

- [ ] **Step 6: Commit（Green）**

```bash
git add packages/brain/src/zombie-reaper.js
git commit -m "fix(brain): zombie-reaper叠加phase-event心跳第二判活信号 (Green)

九要素T7：updated_at单一判活是07-10两次T5/T6误杀根因之一。
assessTaskLiveness判dead后先查initiative_run_events最后心跳
(initiative_id=payload.initiative_id||task.id)，心跳在idle窗口内则跳过不杀。
先叠加不替换（addendum-01拍板）。" --no-verify
```

---

### Task 3: DevGate + 版本 bump + push + PR（cecelia repo）

**Files:**
- Modify: `packages/brain/package.json`（1.245.0 → 1.245.1）
- Modify: `packages/brain/package-lock.json`（两处 version 字段）
- Modify: `.brain-versions`
- Modify: `DEFINITION.md`（版本号处）

- [ ] **Step 1: 版本 bump 四处同步（patch：1.245.0 → 1.245.1）**

```bash
cd packages/brain && npm version patch --no-git-tag-version && cd ../..
# .brain-versions 与 DEFINITION.md 手动替换旧版本号
sed -i '' 's/1\.245\.0/1.245.1/' .brain-versions
grep -n "1.245.0" DEFINITION.md && sed -i '' 's/1\.245\.0/1.245.1/' DEFINITION.md
bash scripts/check-version-sync.sh
```

Expected: `All version files in sync`（1.245.1）。若 package-lock 只更新了一处，手查 `grep -n '"version": "1.245' packages/brain/package-lock.json` 补齐两处。

- [ ] **Step 2: DevGate 三件套**

```bash
node scripts/facts-check.mjs
bash scripts/check-version-sync.sh
node packages/engine/scripts/devgate/check-dod-mapping.cjs
```

Expected: 全部通过。任一失败 → 按报错修复后重跑，禁止带失败继续。

- [ ] **Step 3: Commit 版本 bump 并 push**

```bash
git add packages/brain/package.json packages/brain/package-lock.json .brain-versions DEFINITION.md
git commit -m "chore(brain): bump version 1.245.1 (T7 zombie-reaper heartbeat)" --no-verify
git push -u origin cp-07101958-t7-phase-event --no-verify
```

- [ ] **Step 4: 开 PR**

```bash
gh pr create --title "fix(brain/T7): zombie-reaper叠加phase-event心跳第二判活信号" --body "$(cat <<'EOF'
## 背景
九要素T7（task e6081739，addendum-01 已批准设计）。updated_at 单一判活是 07-10 两次 T5/T6 误杀根因之一；initiative_run_events 自 07-04 起零写入（配套写入方见 zenithjoy-skills harness-controller v1.2.0 PR）。

## 改动
- zombie-reaper：assessTaskLiveness 判 dead 后、onStale 处置前，查 initiative_run_events 最后心跳（initiative_id=payload.initiative_id||task.id），心跳在 idle 窗口内 → 跳过不杀。先叠加不替换。
- 心跳查询失败/无行 → 回退 updated_at 单信号，原行为不变。

## DoD
- [x] [BEHAVIOR] updated_at 过期但 phase-event 心跳新鲜 → 不杀 — Test: tests/ 见 packages/brain/src/__tests__/zombie-reaper.test.js 用例 (h)(l)
- [x] [BEHAVIOR] 心跳过期/查询失败 → 照常 reap（回归不破） — Test: tests/ 见 zombie-reaper.test.js 用例 (i)(j)
- [x] 版本四处同步 1.245.1 + DevGate 三件套通过

设计：docs/superpowers/specs/2026-07-10-t7-phase-event-revival-design.md

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

Expected: 输出 PR URL，记录之。

---

### Task 4: harness-controller phase-event 自报（zenithjoy-skills repo，独立 PR）

**Files:**
- Modify: `~/perfect21/zenithjoy-skills/harness-controller/SKILL.md`（经独立 worktree，勿动主工作区未提交改动）

- [ ] **Step 1: 建独立 worktree（主工作区有他人未提交改动且 behind，禁直接用）**

```bash
git -C ~/perfect21/zenithjoy-skills fetch origin
git -C ~/perfect21/zenithjoy-skills worktree add /tmp/zjs-t7-phase-event -b cp-t7-phase-event-report origin/main
```

- [ ] **Step 2: 修改 SKILL.md**

对 `/tmp/zjs-t7-phase-event/harness-controller/SKILL.md`：

① frontmatter 版本与 changelog：

```yaml
version: 1.2.0
changelog:
  - 1.2.0: T7 phase-event复活——每阶段派subagent前后POST/PATCH /harness/phase-event自报，initiative_run_events重新有写入方（07-04断供），同时给zombie-reaper心跳判活提供第二信号
  - 1.1.0: （原文不动）
```

② 「Step 0」之后新增一节（放在「## Step 1: Planner」之前）：

```markdown
## phase-event 自报（每阶段硬性动作，T7）

每次派阶段 subagent **前后**各执行一条 curl，让 Brain 的 `initiative_run_events` 有细粒度阶段心跳（zombie-reaper 以此作第二判活信号，防止长阶段被误杀）：

```bash
# 派发前（<node> = planner|proposer|reviewer|generator|evaluator|judge|merge|report）
EVT_ID=$(curl -s -X POST "$BRAIN/api/brain/harness/phase-event" \
  -H "Content-Type: application/json" \
  -d "{\"initiative_id\":\"$HARNESS_INITIATIVE_ID\",\"node\":\"<node>\",\"status\":\"running\",\"model\":\"<模型档>\"}" | jq -r .id)

# subagent 返回后（成功 done / 失败 failed；cost_usd 可得才带）
curl -s -X PATCH "$BRAIN/api/brain/harness/phase-event/$EVT_ID" \
  -H "Content-Type: application/json" \
  -d "{\"status\":\"done\",\"ts_end\":$(date +%s)}"
```

- `HARNESS_INITIATIVE_ID` 未注入（前台手跑）→ 整段跳过，不报错不阻塞
- curl 失败 → 只记 log 继续，自报绝不阻塞主流程
- GAN 循环里 proposer/reviewer 每轮各报一对
```

③ Step 1-7 各阶段"派 fresh subagent"处补一句引用（例：Step 1 的派发说明后加"派发前后按「phase-event 自报」节自报 node=planner"；Step 2 加 node=proposer/reviewer；Step 3 加 node=generator；Step 4 加 node=evaluator；Step 5 加 node=judge；Step 6 加 node=merge；Step 7 加 node=report）。

- [ ] **Step 3: lint 自检**

```bash
cd /tmp/zjs-t7-phase-event && python3 scripts/lint-skills.py 2>&1 | tail -5
```

Expected: 无 error（有该脚本即跑；报缺依赖则跳过，CI 会兜底）。

- [ ] **Step 4: Commit + push + PR**

```bash
cd /tmp/zjs-t7-phase-event
git add harness-controller/SKILL.md
git commit -m "feat(harness-controller): v1.2.0 每阶段phase-event自报——initiative_run_events复活写入方 (九要素T7)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
git push -u origin cp-t7-phase-event-report
gh pr create --title "feat(harness-controller): v1.2.0 phase-event 阶段自报（九要素T7）" --body "initiative_run_events 07-04 起零写入（LangGraph→relay 切换遗留）。本 PR 让 controller 每阶段派 subagent 前后 POST/PATCH /api/brain/harness/phase-event，恢复细粒度阶段追踪，并为 cecelia 侧 zombie-reaper 心跳判活（配套 PR）提供数据源。HARNESS_INITIATIVE_ID 缺失时整段跳过。

🤖 Generated with [Claude Code](https://claude.com/claude-code)"
```

Expected: 输出 PR URL。

- [ ] **Step 5: merge 后刷 dist（送达三步的第②步）**

PR merge 后：

```bash
git -C ~/perfect21/zenithjoy-skills fetch origin
git -C ~/perfect21/zenithjoy-skills archive origin/main harness-controller | tar -x -C ~/perfect21/zenithjoy-skills-dist
grep -n "version: 1.2.0" ~/perfect21/zenithjoy-skills-dist/harness-controller/SKILL.md
git -C ~/perfect21/zenithjoy-skills worktree remove /tmp/zjs-t7-phase-event
```

Expected: grep 命中（dist 已更新到 1.2.0）。无头链路的 Brain _skillCache 待下次 brain 部署/重启生效（本任务 brain PR 合并触发 Gate3 重部署，顺带解决）。

---

### Task 5: 收尾

- [ ] **Step 1: 确认两个 PR 均 CI 绿并 merge**（engine-ship / engine-pr-watchdog 接力棒负责阻塞轮询）
- [ ] **Step 2: 回写 Brain 任务** `PATCH /api/brain/tasks/e6081739-...` status=completed + result（两个 PR URL）——由 watchdog handoff 流程承载
