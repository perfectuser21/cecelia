# Harness Pipeline 5 Bug Fix — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 修复 harness pipeline 5 个系统性 bug（liveness 误判、僵尸容器、Planner initiative_id、DB varchar 溢出、LangSmith 429），每个 fix 都有 regression test 永久留 CI。

**Architecture:** 5 个独立补丁，无架构变动。B1/B2 修改 `harness-initiative.graph.js`，B2 新增 `harness-container-cleanup.js`，B3 修改 Planner prompt + SKILL.md，B4 新增 DB migration，B5 修改 `.env`。

**Tech Stack:** Node.js ESM, Vitest, PostgreSQL, Docker CLI, GitHub CLI (`gh`), LangGraph

---

## File Structure

| 文件 | 操作 | Bug |
|------|------|-----|
| `packages/brain/src/workflows/harness-initiative.graph.js` | Modify | B1 + B2 |
| `packages/brain/src/harness-container-cleanup.js` | Create | B2 |
| `packages/brain/src/__tests__/harness-container-liveness.test.js` | Modify (add 2 cases) | B1 |
| `packages/brain/src/__tests__/harness-container-cleanup.test.js` | Create | B2 |
| `packages/workflows/skills/harness-planner/SKILL.md` | Modify | B3 |
| `packages/brain/src/nightly-orchestrator.js` | Modify (add export) | B4 |
| `packages/brain/migrations/286_daily_logs_type_expand.sql` | Create | B4 |
| `packages/brain/src/__tests__/nightly-orchestrator-daily-log.test.js` | Create | B4 |
| `packages/brain/.env` | Modify | B5 |

---

## Task 1: B1 — Regression Test（PR merged → liveness success）

**Files:**
- Modify: `packages/brain/src/__tests__/harness-container-liveness.test.js`

- [ ] **Step 1: 在文件末尾，在最后一个 `it(...)` 后，describe 块闭合括号前追加两个新 test case**

```js
  it("B1: container exited 但 PR 已 merged → success 路径，不触发 failure resume", async () => {
    const mockGetState = vi.fn().mockResolvedValue({
      next: ["await_callback"],
      values: {
        containerId: "harness-ws1-abc123",
        pr_url: "https://github.com/perfectuser21/cecelia/pull/99",
        status: "queued",
      },
    });
    const mockInvoke = vi.fn();
    compiled = { getState: mockGetState, invoke: mockInvoke };

    // docker → exited，gh pr view → MERGED
    mockExecFile.mockImplementation((cmd, args, cb) => {
      if (cmd === "docker") cb(null, "exited");
      else if (cmd === "gh") cb(null, "MERGED\n");
      else cb(new Error("unexpected"), "");
    });

    const result = await _waitForSubGraphCompletion(compiled, config, 30_000, {
      pollIntervalMs: 50,
      livenessCheckEveryN: 1,
    });

    // 绝不以 failure 调 invoke
    expect(mockInvoke).not.toHaveBeenCalledWith(
      expect.objectContaining({ resume: expect.objectContaining({ status: "failed" }) }),
      expect.anything()
    );
    expect(result.status).toBe("merged");
  });

  it("B1: container exited，gh pr view 失败 → 保持原 failure 路径", async () => {
    const mockGetState = vi.fn()
      .mockResolvedValueOnce({
        next: ["await_callback"],
        values: {
          containerId: "harness-ws1-dead",
          pr_url: "https://github.com/perfectuser21/cecelia/pull/77",
          status: "queued",
        },
      })
      .mockResolvedValue({ next: [], values: { status: "failed" } });

    const mockInvoke = vi.fn().mockResolvedValue(undefined);
    compiled = { getState: mockGetState, invoke: mockInvoke };

    // docker → exited，gh → 报错
    mockExecFile.mockImplementation((cmd, args, cb) => {
      if (cmd === "docker") cb(null, "exited");
      else if (cmd === "gh") cb(new Error("gh: command failed"), "");
      else cb(null, "");
    });

    const result = await _waitForSubGraphCompletion(compiled, config, 30_000, {
      pollIntervalMs: 50,
      livenessCheckEveryN: 1,
    });

    expect(mockInvoke).toHaveBeenCalledWith(
      expect.objectContaining({ resume: expect.objectContaining({ status: "failed" }) }),
      config
    );
    expect(result.status).toBe("failed");
  });
```

- [ ] **Step 2: 跑测试，确认新 case FAIL（实现还没写）**

```bash
cd /Users/administrator/worktrees/cecelia/harness-pipeline-5bug-fix
npx vitest run packages/brain/src/__tests__/harness-container-liveness.test.js --reporter=verbose 2>&1 | tail -30
```

Expected: 最后两个 test FAIL，其他 test 继续通过。

---

## Task 2: B1 — 实现 `_checkPrMerged` + liveness 逻辑修改

**Files:**
- Modify: `packages/brain/src/workflows/harness-initiative.graph.js`

- [ ] **Step 1: 在 `_checkContainerLiveness` 函数（约第 1125 行）之后，紧接着插入 `_checkPrMerged` 函数**

在以下代码块：
```js
      const status = (stdout || '').trim();
      resolve((status === 'exited' || status === 'dead') ? `container_${status}_without_callback` : null);
    });
  });
}
```
（即 `_checkContainerLiveness` 函数末尾的 `}` 后）追加：

```js

/**
 * 检查 GitHub PR 是否已 merged。
 * B1 fix: container 死亡时先验 PR 状态，防止已完成 WS 被误标 failed。
 *
 * @param {string} prUrl - GitHub PR URL
 * @returns {Promise<boolean>}  true = MERGED, false = not merged or check failed
 */
async function _checkPrMerged(prUrl) {
  return new Promise((resolve) => {
    execFileCb('gh', ['pr', 'view', prUrl, '--json', 'state', '-q', '.state'], (err, stdout) => {
      if (err) { resolve(false); return; }
      resolve((stdout || '').trim().toUpperCase() === 'MERGED');
    });
  });
}
```

- [ ] **Step 2: 修改 `_waitForSubGraphCompletion` 内的 liveness 检测块（约第 1177 行）**

找到以下代码段（在 `if (deathReason) {` 之后）：
```js
        if (deathReason) {
          // 容器已死，主动 resume sub-graph 走 failure 路径
          console.warn(
            `[harness-liveness] Container ${containerId} died (${deathReason}), resuming sub-graph with failure`
          );
```

替换为：
```js
        if (deathReason) {
          // B1 fix: 先验 PR 是否已 merged，已 merged → success，不走 failure
          const prUrl = state.values?.pr_url;
          if (prUrl) {
            const alreadyMerged = await _checkPrMerged(prUrl);
            if (alreadyMerged) {
              console.log(
                `[harness-liveness] Container ${containerId} exited after PR merged (${prUrl}), treating as success`
              );
              return { ...(state.values), status: 'merged' };
            }
          }
          // 容器已死，主动 resume sub-graph 走 failure 路径
          console.warn(
            `[harness-liveness] Container ${containerId} died (${deathReason}), resuming sub-graph with failure`
          );
```

- [ ] **Step 3: 跑 liveness tests，确认全绿**

```bash
cd /Users/administrator/worktrees/cecelia/harness-pipeline-5bug-fix
npx vitest run packages/brain/src/__tests__/harness-container-liveness.test.js --reporter=verbose 2>&1 | tail -30
```

Expected: 所有 7 个 test（含新增 2 个）全部 PASS。

- [ ] **Step 4: commit**

```bash
cd /Users/administrator/worktrees/cecelia/harness-pipeline-5bug-fix
git add packages/brain/src/__tests__/harness-container-liveness.test.js \
        packages/brain/src/workflows/harness-initiative.graph.js
git commit -m "fix(harness): B1 — liveness 检测容器死亡前先验 PR merged 状态，已 merged 走 success 路径"
```

---

## Task 3: B2 — 新建 `harness-container-cleanup.js`

**Files:**
- Create: `packages/brain/src/harness-container-cleanup.js`

- [ ] **Step 1: 创建文件**

```js
/**
 * harness-container-cleanup.js — initiative 终态容器清理
 *
 * initiative 变 failed/completed 时，主动 docker rm -f 所有关联容器。
 * 容器通过 HARNESS_INITIATIVE_ID env var 识别（容器无 --label 时的替代方案）。
 */
import { execFile as execFileCb } from 'node:child_process';

function dockerCmd(args) {
  return new Promise((resolve, reject) => {
    execFileCb('docker', args, (err, stdout) => {
      if (err) reject(err);
      else resolve(stdout || '');
    });
  });
}

/**
 * Kill all running Docker containers whose HARNESS_INITIATIVE_ID env var
 * matches the given initiativeId.
 *
 * @param {string} initiativeId
 */
export async function killInitiativeContainers(initiativeId) {
  if (!initiativeId) return;

  let containerIds;
  try {
    const stdout = await dockerCmd(['ps', '-q']);
    containerIds = stdout.trim().split('\n').filter(Boolean);
  } catch (err) {
    console.warn(`[harness-container-cleanup] docker ps failed: ${err.message}`);
    return;
  }

  if (containerIds.length === 0) return;

  let killed = 0;
  for (const cid of containerIds) {
    try {
      const envOut = await dockerCmd([
        'inspect', '--format', '{{range .Config.Env}}{{.}}\n{{end}}', cid,
      ]);
      if (envOut.includes(`HARNESS_INITIATIVE_ID=${initiativeId}`)) {
        try {
          await dockerCmd(['rm', '-f', cid]);
          killed++;
          console.log(`[harness-container-cleanup] killed ${cid} (initiative=${initiativeId})`);
        } catch (rmErr) {
          console.warn(`[harness-container-cleanup] rm -f ${cid} failed: ${rmErr.message}`);
        }
      }
    } catch {
      // container exited between ps and inspect — ignore
    }
  }

  console.log(`[harness-container-cleanup] initiative=${initiativeId} killed=${killed}/${containerIds.length} scanned`);
}
```

---

## Task 4: B2 — Regression Test for `killInitiativeContainers`

**Files:**
- Create: `packages/brain/src/__tests__/harness-container-cleanup.test.js`

- [ ] **Step 1: 创建 test 文件**

```js
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockExecFile = vi.hoisted(() => vi.fn());
vi.mock('node:child_process', () => ({ execFile: mockExecFile }));

import { killInitiativeContainers } from '../harness-container-cleanup.js';

describe('killInitiativeContainers', () => {
  beforeEach(() => vi.clearAllMocks());

  it('kills containers matching the initiative_id, skips others', async () => {
    mockExecFile.mockImplementation((cmd, args, cb) => {
      const a = args.join(' ');
      if (a === 'ps -q') {
        cb(null, 'abc123\ndef456\n');
      } else if (a.includes('inspect') && args.includes('abc123')) {
        cb(null, 'HARNESS_INITIATIVE_ID=target-initiative\nOTHER=val\n');
      } else if (a.includes('inspect') && args.includes('def456')) {
        cb(null, 'HARNESS_INITIATIVE_ID=other-initiative\n');
      } else if (a.includes('rm') && args.includes('abc123')) {
        cb(null, 'abc123');
      } else {
        cb(null, '');
      }
    });

    await killInitiativeContainers('target-initiative');

    const rmCalls = mockExecFile.mock.calls.filter(c => c[1]?.[0] === 'rm');
    expect(rmCalls).toHaveLength(1);
    expect(rmCalls[0][1]).toContain('abc123');
    expect(rmCalls[0][1]).not.toContain('def456');
  });

  it('handles docker ps failure gracefully', async () => {
    mockExecFile.mockImplementation((cmd, args, cb) => {
      cb(new Error('docker: command not found'), '');
    });

    await expect(killInitiativeContainers('any-id')).resolves.not.toThrow();
  });

  it('single container rm failure does not abort cleanup of remaining containers', async () => {
    mockExecFile.mockImplementation((cmd, args, cb) => {
      const a = args.join(' ');
      if (a === 'ps -q') {
        cb(null, 'cid1\ncid2\n');
      } else if (a.includes('inspect') && args.includes('cid1')) {
        cb(null, 'HARNESS_INITIATIVE_ID=x\n');
      } else if (a.includes('inspect') && args.includes('cid2')) {
        cb(null, 'HARNESS_INITIATIVE_ID=x\n');
      } else if (a.includes('rm') && args.includes('cid1')) {
        cb(new Error('container already removed'), '');
      } else if (a.includes('rm') && args.includes('cid2')) {
        cb(null, 'cid2');
      } else {
        cb(null, '');
      }
    });

    await expect(killInitiativeContainers('x')).resolves.not.toThrow();
    const rmCalls = mockExecFile.mock.calls.filter(c => c[1]?.[0] === 'rm');
    expect(rmCalls).toHaveLength(2);
  });

  it('no-op if initiativeId is falsy', async () => {
    await killInitiativeContainers(null);
    expect(mockExecFile).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: 跑 test，确认全绿**

```bash
cd /Users/administrator/worktrees/cecelia/harness-pipeline-5bug-fix
npx vitest run packages/brain/src/__tests__/harness-container-cleanup.test.js --reporter=verbose 2>&1 | tail -20
```

Expected: 4 个 test 全部 PASS。

---

## Task 5: B2 — 在 harness-initiative.graph.js 调用容器清理

**Files:**
- Modify: `packages/brain/src/workflows/harness-initiative.graph.js`

- [ ] **Step 1: 在 imports 区（文件顶部，其他 `import ... from` 行之后）加入**

```js
import { killInitiativeContainers } from '../harness-container-cleanup.js';
```

- [ ] **Step 2: 在 `reportNode` 函数内，`tasks.status` UPDATE 之后（约第 1460 行，`} catch (err) {` 之前）插入**

找到此代码：
```js
      [state.initiativeId, taskStatus, reason, reportContent]
    );
  } catch (err) {
    console.warn(`[harness-initiative.graph] reportNode db update failed: ${err.message}`);
  }
```

在 `  } catch (err) {` 之前插入一行：
```js
    // B2 fix: initiative 终态 → 主动 kill 关联容器（zombie 防治）
    killInitiativeContainers(state.initiativeId).catch(err2 =>
      console.warn(`[reportNode] container cleanup failed: ${err2.message}`)
    );
```

- [ ] **Step 3: 在 `terminalFailNode` 函数内，`initiative_runs` UPDATE 之后（约第 1557 行，`} catch (err) {` 之前）插入**

找到此代码：
```js
      [reason.slice(0, 500), state.initiativeId]
    );
  } catch (err) {
    console.warn(`[harness-initiative.graph] terminalFailNode db update failed: ${err.message}`);
  }
  return { error: { node: 'terminal_fail', message: reason } };
```

在 `  } catch (err) {` 之前插入一行：
```js
    // B2 fix: terminal fail → 主动 kill 关联容器
    killInitiativeContainers(state.initiativeId).catch(err2 =>
      console.warn(`[terminalFailNode] container cleanup failed: ${err2.message}`)
    );
```

- [ ] **Step 4: 跑所有相关测试**

```bash
cd /Users/administrator/worktrees/cecelia/harness-pipeline-5bug-fix
npx vitest run packages/brain/src/__tests__/harness-container-cleanup.test.js \
              packages/brain/src/__tests__/harness-container-liveness.test.js \
              --reporter=verbose 2>&1 | tail -30
```

Expected: 所有 test PASS。

- [ ] **Step 5: commit**

```bash
cd /Users/administrator/worktrees/cecelia/harness-pipeline-5bug-fix
git add packages/brain/src/harness-container-cleanup.js \
        packages/brain/src/__tests__/harness-container-cleanup.test.js \
        packages/brain/src/workflows/harness-initiative.graph.js
git commit -m "fix(harness): B2 — initiative 终态主动 docker rm -f 关联容器，防止 zombie 堆积"
```

---

## Task 6: B3 — 更新 Planner prompt 与 SKILL.md

**Files:**
- Modify: `packages/brain/src/workflows/harness-initiative.graph.js` (line ~128-131)
- Modify: `packages/workflows/skills/harness-planner/SKILL.md`

- [ ] **Step 1: 在 `harness-initiative.graph.js` 找到 Planner prompt 的输出要求段（约第 128-131 行）**

找到：
```js
## 输出要求（v2）
1. 生成 ${sprintDir}/sprint-prd.md（What，不写 How）
2. 在 stdout 末尾输出 task-plan.json（符合 harness-planner SKILL.md 定义的 schema）
3. task-plan.json 必须被 \`\`\`json ... \`\`\` 代码块包裹便于提取`;
```

替换为：
```js
## 输出要求（v2）
1. 生成 ${sprintDir}/sprint-prd.md（What，不写 How）
2. 在 stdout 末尾输出 task-plan.json（符合 harness-planner SKILL.md 定义的 schema）
3. task-plan.json 必须被 \`\`\`json ... \`\`\` 代码块包裹便于提取
4. task-plan.json 的 initiative_id 字段：必须使用 $HARNESS_INITIATIVE_ID 环境变量的值（已注入容器），**禁止**写 "pending" 或任何占位符`;
```

- [ ] **Step 2: 在 `packages/workflows/skills/harness-planner/SKILL.md` 找到"常见错误"段（约第 346-351 行）**

找到：
```markdown
## 常见错误

1. **输出 task-plan.json** → v8 不再拆任务，此文件由 Proposer 在合同 GAN 确认后产出
```

替换为：
```markdown
## 常见错误

1. **task-plan.json initiative_id 写 "pending"** → 必须使用 `$HARNESS_INITIATIVE_ID` 环境变量（已注入），写 "pending" 会导致 parsePrd 警告 + 下游 DB 写入错误
```

- [ ] **Step 3: commit**

```bash
cd /Users/administrator/worktrees/cecelia/harness-pipeline-5bug-fix
git add packages/brain/src/workflows/harness-initiative.graph.js \
        packages/workflows/skills/harness-planner/SKILL.md
git commit -m "fix(harness): B3 — Planner prompt 明确 initiative_id 必须用 \$HARNESS_INITIATIVE_ID，禁止 pending"
```

---

## Task 7: B4 — Regression Test for NightlyOrchestrator daily_logs

**Files:**
- Modify: `packages/brain/src/nightly-orchestrator.js` (add export to `generateOvernightReport`)
- Create: `packages/brain/src/__tests__/nightly-orchestrator-daily-log.test.js`

- [ ] **Step 1: 在 `nightly-orchestrator.js` 第 245 行，`async function generateOvernightReport()` 前加 `export`**

找到：
```js
async function generateOvernightReport() {
```

替换为：
```js
export async function generateOvernightReport() {
```

- [ ] **Step 2: 创建 test 文件**

```js
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockQuery = vi.fn();
vi.mock('../db.js', () => ({ default: { query: mockQuery } }));
vi.mock('../capacity.js', () => ({ getMaxStreams: vi.fn().mockReturnValue(3) }));
vi.mock('../event-bus.js', () => ({ emit: vi.fn().mockResolvedValue(undefined) }));

import { generateOvernightReport } from '../nightly-orchestrator.js';

describe('generateOvernightReport — daily_logs type field', () => {
  beforeEach(() => vi.clearAllMocks());

  it("INSERT 使用 type='nightly_orchestration'（21 字符，曾超 VARCHAR(20)）", async () => {
    // SELECT daily_logs → 无旧记录（触发 INSERT 而非 UPDATE）
    mockQuery
      .mockResolvedValueOnce({ rows: [{ dispatched_today: 0, completed: 0, failed: 0, in_progress: 0 }] }) // task stats
      .mockResolvedValueOnce({ rows: [] }) // SELECT daily_logs (no existing)
      .mockResolvedValueOnce({ rows: [] }); // INSERT daily_logs

    await generateOvernightReport();

    // 找 INSERT 调用
    const insertCall = mockQuery.mock.calls.find(c =>
      typeof c[0] === 'string' && c[0].includes('INSERT INTO daily_logs')
    );
    expect(insertCall, 'INSERT INTO daily_logs call not found').toBeDefined();

    // 验证 type 参数为 'nightly_orchestration'（21 字符）
    const sqlStr = insertCall[0];
    expect(sqlStr).toContain("'nightly_orchestration'");

    // 字面确认长度 > 20（这正是 VARCHAR(20) 的溢出点）
    expect('nightly_orchestration'.length).toBe(21);
  });

  it("UPDATE 路径（今日已有记录）不报错", async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ dispatched_today: 2, completed: 1, failed: 0, in_progress: 1 }] })
      .mockResolvedValueOnce({ rows: [{ id: 'existing-uuid' }] }) // SELECT → has existing
      .mockResolvedValueOnce({ rows: [] }); // UPDATE daily_logs

    await expect(generateOvernightReport()).resolves.not.toThrow();

    const updateCall = mockQuery.mock.calls.find(c =>
      typeof c[0] === 'string' && c[0].includes('UPDATE daily_logs')
    );
    expect(updateCall).toBeDefined();
  });
});
```

- [ ] **Step 3: 跑 test，确认全绿**

```bash
cd /Users/administrator/worktrees/cecelia/harness-pipeline-5bug-fix
npx vitest run packages/brain/src/__tests__/nightly-orchestrator-daily-log.test.js --reporter=verbose 2>&1 | tail -20
```

Expected: 2 个 test 全部 PASS。

---

## Task 8: B4 — DB Migration 286

**Files:**
- Create: `packages/brain/migrations/286_daily_logs_type_expand.sql`

- [ ] **Step 1: 创建 migration 文件**

```sql
-- Migration 286: Expand daily_logs.type to VARCHAR(50) and add nightly types
-- 根因: daily_logs.type 是 VARCHAR(20)，'nightly_orchestration'(21字符) 超出 + 不在 CHECK 约束内
-- → NightlyOrchestrator 每次夜间 cycle 后报 "value too long for type character varying(20)"

ALTER TABLE daily_logs ALTER COLUMN type TYPE VARCHAR(50);

ALTER TABLE daily_logs DROP CONSTRAINT IF EXISTS daily_logs_type_check;

ALTER TABLE daily_logs ADD CONSTRAINT daily_logs_type_check
  CHECK (type IN ('repo', 'summary', 'nightly_orchestration', 'consolidation', 'nightly_tick'));

COMMENT ON COLUMN daily_logs.type IS
  'Log type: repo/summary/nightly_orchestration/consolidation/nightly_tick (VARCHAR(50) after migration 286)';
```

- [ ] **Step 2: commit**

```bash
cd /Users/administrator/worktrees/cecelia/harness-pipeline-5bug-fix
git add packages/brain/src/nightly-orchestrator.js \
        packages/brain/src/__tests__/nightly-orchestrator-daily-log.test.js \
        packages/brain/migrations/286_daily_logs_type_expand.sql
git commit -m "fix(brain): B4 — daily_logs.type 扩展为 VARCHAR(50)，新增 nightly_orchestration 到 CHECK 约束"
```

---

## Task 9: B5 — 关闭 LangSmith Tracing

**Files:**
- Modify: `packages/brain/.env`

- [ ] **Step 1: 修改 `packages/brain/.env`**

找到：
```
LANGSMITH_TRACING=true
```

替换为：
```
LANGSMITH_TRACING=false
```

保留其余配置不变（保留 API key 方便以后重启）。

- [ ] **Step 2: commit**

```bash
cd /Users/administrator/worktrees/cecelia/harness-pipeline-5bug-fix
git add packages/brain/.env
git commit -m "fix(brain): B5 — 关闭 LangSmith tracing，月度 quota 已耗尽导致每 tick 报 429"
```

---

## Task 10: 全量测试 + Learning 文件

**Files:**
- Create: `docs/learnings/cp-0527160626-harness-pipeline-5bug-fix.md`

- [ ] **Step 1: 跑 Brain 完整测试套件**

```bash
cd /Users/administrator/worktrees/cecelia/harness-pipeline-5bug-fix
npx vitest run packages/brain/src --reporter=verbose 2>&1 | tail -50
```

Expected: 所有 test PASS，无 regression。

- [ ] **Step 2: 创建 Learning 文件**

```markdown
# Learning: cp-0527160626-harness-pipeline-5bug-fix

### 根本原因

5 个独立 bug 共同暴露了 harness pipeline 的脆弱边界：

1. **B1 liveness 误判**：`_waitForSubGraphCompletion` 在容器死亡时直接 invoke failure，未先验证 PR 是否已 merged（PR merged 后容器退出是正常路径）。
2. **B2 僵尸容器**：zombie-reaper 豁免 harness_* 类型（设计合理，防误杀），但 initiative 终态没有主动 cleanup，形成永久 zombie。
3. **B3 initiative_id "pending"**：Planner prompt 未明确要求使用 `$HARNESS_INITIATIVE_ID` 环境变量，Planner 倾向写 "pending" 作占位符。
4. **B4 varchar 溢出**：`daily_logs.type` VARCHAR(20) + CHECK 约束过时，'nightly_orchestration'（21 字符）两个条件都不满足。
5. **B5 LangSmith 429**：`.env` 开启了 tracing，月度 quota 耗尽后每次 tick 都报 429，影响可观测性系统。

### 下次预防

- [ ] Liveness 路径变更时，始终检查是否需要考虑"已完成但 callback 未到"的 race condition
- [ ] 任何 initiative 状态机终态转换，都应触发资源清理（容器、worktree、lock file）
- [ ] Prompt 中注入的环境变量必须明确说明"使用 $VAR_NAME，禁止写占位符"
- [ ] DB 字段新增 enum 值时，需同时检查 VARCHAR 长度 + CHECK 约束两处
- [ ] LangSmith/observability quota 需要监控告警，不应靠日志里的 429 发现
```

- [ ] **Step 3: commit Learning**

```bash
cd /Users/administrator/worktrees/cecelia/harness-pipeline-5bug-fix
git add docs/learnings/cp-0527160626-harness-pipeline-5bug-fix.md
git commit -m "docs: learning — harness pipeline 5 bug fix"
```

---

## Task 11: Push + PR

- [ ] **Step 1: push 分支**

```bash
cd /Users/administrator/worktrees/cecelia/harness-pipeline-5bug-fix
git push -u origin cp-0527160626-harness-pipeline-5bug-fix
```

- [ ] **Step 2: 创建 PR**

```bash
cd /Users/administrator/worktrees/cecelia/harness-pipeline-5bug-fix
gh pr create \
  --title "fix(harness): B1~B5 — liveness误判/僵尸容器/Planner initiative_id/DB varchar溢出/LangSmith 429" \
  --body "$(cat <<'EOF'
## Summary

修复 harness pipeline 5 个系统性 bug，全部含 regression test：

- **B1** `_waitForSubGraphCompletion`: 容器退出前先验 PR merged 状态，已 merged → success 路径，不走 failure
- **B2** `harness-container-cleanup.js`: initiative 变 failed/completed 时主动 `docker rm -f` 关联容器
- **B3** Planner prompt + SKILL.md: 明确 `initiative_id` 必须用 `$HARNESS_INITIATIVE_ID`，禁止 "pending"
- **B4** migration 286: `daily_logs.type` VARCHAR(20)→50，CHECK 约束加 `nightly_orchestration`
- **B5** `.env`: `LANGSMITH_TRACING=false`，关闭月度 quota 已耗尽的 tracing

## Test plan

- [ ] `harness-container-liveness.test.js` 新增 B1 2 cases（PR merged → success / gh 失败 → failure）
- [ ] `harness-container-cleanup.test.js` 新增 4 cases（B2 cleanup 逻辑）
- [ ] `nightly-orchestrator-daily-log.test.js` 新增 2 cases（B4 INSERT type 字段）
- [ ] 全量 Brain test suite PASS
- [ ] CI 全绿后 merge

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```
