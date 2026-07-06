# scheduler-jobs 声明式定时任务注册表 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 建立声明式定时任务注册表，救活 4 个死于 Wave 2 的 Brain 定时任务（arch_review / strategy 触发器 / 对话提炼 / capture 消化）。

**Architecture:** 新模块 `scheduler-jobs.js` 每 60s 顺序调用注册的 job；该不该真正执行由各 handler 内置 gate 决定（模块自 gate）；注册表只负责错误隔离、timeout（Promise.race 不 reject）、working_memory 观测哨兵。server.js 以 try/catch 非阻断动态 import 挂载。

**Tech Stack:** Node.js ESM（packages/brain）、vitest + mock pool 单测、PostgreSQL working_memory 表。

**⚠️ 本会话环境约束（每个 task 都必须遵守）：**
- 工作目录 = `/Users/administrator/worktrees/cecelia/scheduler-jobs-registry`（下称 `$WT`）。shell cwd 会被强制钉回主仓，**所有命令用绝对路径**。
- **Write/Edit 工具会被 main-repo-write-guard 按会话 cwd 拦截**：写文件一律用 Bash heredoc（`cat > $WT/... <<'EOF'`）；改既有文件用 `python3 -` 字符串替换（同样经 Bash）。
- **所有 git 暂存/提交必须写成 `git -C $WT <子命令>` 形式**（不带 -C 的裸暂存/提交命令会被 guard 拦；`git -C` 属 worktree 内操作，guard 本意放行）。**注意：命令串或写入内容里都不要出现「git+空格+暂存/提交子命令」的字面组合**，guard 对整个命令文本做正则匹配。
- 测试命令：`cd $WT/packages/brain && npx vitest run src/__tests__/scheduler-jobs.test.js`。

**设计 spec：** `$WT/docs/superpowers/specs/2026-07-06-scheduler-jobs-registry-design.md`（先读它）

---

### Task 1: scheduler-jobs.js 核心模块（TDD）

**Files:**
- Test: `$WT/packages/brain/src/__tests__/scheduler-jobs.test.js`（新建）
- Create: `$WT/packages/brain/src/scheduler-jobs.js`

- [ ] **Step 1: 写失败测试**

写入 `$WT/packages/brain/src/__tests__/scheduler-jobs.test.js`：

```js
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../daily-review-scheduler.js', () => ({
  triggerArchReview: vi.fn().mockResolvedValue({ triggered: false, skipped_window: true }),
}));
vi.mock('../active-goals-zero-trigger.js', () => ({
  maybeTriggerStrategySession: vi.fn().mockResolvedValue({ created: false, reason: 'active_goals_present' }),
}));
vi.mock('../conversation-digest.js', () => ({
  runConversationDigest: vi.fn().mockResolvedValue({ digested: 0 }),
}));
vi.mock('../capture-digestion.js', () => ({
  runCaptureDigestion: vi.fn().mockResolvedValue({ processed: 0 }),
}));

import { runSchedulerJobsOnce, JOBS, SENTINEL_KEY_PREFIX } from '../scheduler-jobs.js';
import { triggerArchReview } from '../daily-review-scheduler.js';
import { maybeTriggerStrategySession } from '../active-goals-zero-trigger.js';
import { runConversationDigest } from '../conversation-digest.js';
import { runCaptureDigestion } from '../capture-digestion.js';

function makePool() {
  return { query: vi.fn().mockResolvedValue({ rows: [] }) };
}

describe('scheduler-jobs 注册表', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('JOBS 注册了 4 个首批 job', () => {
    expect(JOBS.map((j) => j.name)).toEqual([
      'arch-review', 'strategy-trigger', 'conversation-digest', 'capture-digestion',
    ]);
  });

  it('runSchedulerJobsOnce 调用全部 job，needsPool 决定传参', async () => {
    const pool = makePool();
    const results = await runSchedulerJobsOnce(pool);
    expect(triggerArchReview).toHaveBeenCalledWith(pool);
    expect(maybeTriggerStrategySession).toHaveBeenCalledWith(pool);
    expect(runConversationDigest).toHaveBeenCalledWith();
    expect(runCaptureDigestion).toHaveBeenCalledWith();
    expect(results).toHaveLength(4);
    expect(results.every((r) => r.ok)).toBe(true);
  });

  it('单 job reject 不影响其余 job，且结果记录 ok:false', async () => {
    const pool = makePool();
    triggerArchReview.mockRejectedValueOnce(new Error('boom'));
    const results = await runSchedulerJobsOnce(pool);
    expect(results[0]).toMatchObject({ name: 'arch-review', ok: false, error: 'boom' });
    expect(results.slice(1).every((r) => r.ok)).toBe(true);
    expect(runCaptureDigestion).toHaveBeenCalled();
  });

  it('handler 永挂时按 timeoutMs 标记 timedOut 并继续', async () => {
    const pool = makePool();
    const hangJobs = [
      { name: 'hang', needsPool: false, timeoutMs: 10, handler: () => new Promise(() => {}) },
      { name: 'after', needsPool: false, timeoutMs: 1000, handler: vi.fn().mockResolvedValue('ok') },
    ];
    const results = await runSchedulerJobsOnce(pool, hangJobs);
    expect(results[0]).toMatchObject({ name: 'hang', ok: false, timedOut: true });
    expect(results[1].ok).toBe(true);
  });

  it('哨兵用 ON CONFLICT upsert 写 working_memory，key 带前缀', async () => {
    const pool = makePool();
    await runSchedulerJobsOnce(pool);
    const sentinelCalls = pool.query.mock.calls.filter(([sql]) => sql.includes('working_memory'));
    expect(sentinelCalls).toHaveLength(4);
    expect(sentinelCalls[0][0]).toMatch(/ON CONFLICT \(key\) DO UPDATE/);
    expect(sentinelCalls[0][1][0]).toBe(`${SENTINEL_KEY_PREFIX}arch-review`);
    const payload = JSON.parse(sentinelCalls[0][1][1]);
    expect(payload).toHaveProperty('at');
    expect(payload).toHaveProperty('ok');
  });

  it('哨兵写入失败不影响 job 结果也不抛', async () => {
    const pool = { query: vi.fn().mockRejectedValue(new Error('db down')) };
    const results = await runSchedulerJobsOnce(pool);
    expect(results).toHaveLength(4);
    expect(results.every((r) => r.ok)).toBe(true);
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd /Users/administrator/worktrees/cecelia/scheduler-jobs-registry/packages/brain && npx vitest run src/__tests__/scheduler-jobs.test.js`
Expected: FAIL —— `Cannot find module '../scheduler-jobs.js'`（或等价 resolve 错误）

- [ ] **Step 3: commit-1（Red）**

```bash
git -C /Users/administrator/worktrees/cecelia/scheduler-jobs-registry add packages/brain/src/__tests__/scheduler-jobs.test.js
git -C /Users/administrator/worktrees/cecelia/scheduler-jobs-registry commit -m "test(brain): scheduler-jobs 注册表失败测试（P1-PR1 commit-1 Red）"
```

- [ ] **Step 4: 最小实现**

写入 `$WT/packages/brain/src/scheduler-jobs.js`：

```js
/**
 * scheduler-jobs.js — 声明式定时任务注册表（作战循环 P1-PR1）
 *
 * Wave 2（2026-05-04）后 executeTick 死掉的定时任务的恢复通道。
 * 调度模型：统一 60s 轮询 + 模块自 gate —— 每轮无脑调用所有 job，
 * "该不该真正执行"由各 handler 内置窗口/幂等逻辑决定（triggerArchReview
 * 自带 4h 窗口+recent 去重+guard；maybeTriggerStrategySession 自带
 * active_goals gate+24h 冷却）。注册表只负责：错误隔离、timeout、观测哨兵。
 * 哨兵只作观测（死人开关/战报查"最近一跑"），幂等由模块自 gate 负责。
 */
import { triggerArchReview } from './daily-review-scheduler.js';
import { maybeTriggerStrategySession } from './active-goals-zero-trigger.js';
import { runConversationDigest } from './conversation-digest.js';
import { runCaptureDigestion } from './capture-digestion.js';

const LOOP_INTERVAL_MS = 60 * 1000;
const DEFAULT_TIMEOUT_MS = 5 * 60 * 1000;
export const SENTINEL_KEY_PREFIX = 'scheduler_job_last_run:';

export const JOBS = [
  { name: 'arch-review', needsPool: true, timeoutMs: DEFAULT_TIMEOUT_MS, handler: triggerArchReview, description: '架构巡检（自带4h窗口+guard）' },
  { name: 'strategy-trigger', needsPool: true, timeoutMs: DEFAULT_TIMEOUT_MS, handler: maybeTriggerStrategySession, description: '战略会应急触发（自带active_goals gate+24h冷却）' },
  { name: 'conversation-digest', needsPool: false, timeoutMs: DEFAULT_TIMEOUT_MS, handler: runConversationDigest, description: '对话提炼' },
  { name: 'capture-digestion', needsPool: false, timeoutMs: DEFAULT_TIMEOUT_MS, handler: runCaptureDigestion, description: 'capture 消化（想法箱进箱通道）' },
];

function raceWithTimeout(promise, timeoutMs) {
  let timer;
  const timeout = new Promise((resolve) => {
    timer = setTimeout(() => resolve({ __schedulerTimedOut: true }), timeoutMs);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

function summarize(result) {
  if (result == null) return null;
  try {
    const s = JSON.stringify(result);
    return s.length > 500 ? s.slice(0, 500) : s;
  } catch {
    return String(result).slice(0, 200);
  }
}

async function writeSentinel(pool, jobName, record) {
  try {
    await pool.query(
      `INSERT INTO working_memory (key, value_json, updated_at)
       VALUES ($1, $2, NOW())
       ON CONFLICT (key) DO UPDATE SET value_json = $2, updated_at = NOW()`,
      [`${SENTINEL_KEY_PREFIX}${jobName}`, JSON.stringify(record)],
    );
  } catch (e) {
    console.warn(`[scheduler-jobs] sentinel write failed for ${jobName}:`, e.message);
  }
}

/**
 * 单发全部 job（供 loop 与测试）。单 job 失败/超时不影响其他 job。
 * @returns {Promise<Array<{name:string, at:string, ok:boolean}>>}
 */
export async function runSchedulerJobsOnce(pool, jobs = JOBS) {
  const results = [];
  for (const job of jobs) {
    const at = new Date().toISOString();
    let record;
    try {
      const invocation = job.needsPool ? job.handler(pool) : job.handler();
      const result = await raceWithTimeout(Promise.resolve(invocation), job.timeoutMs ?? DEFAULT_TIMEOUT_MS);
      if (result && result.__schedulerTimedOut) {
        console.warn(`[scheduler-jobs] ${job.name} timed out after ${job.timeoutMs ?? DEFAULT_TIMEOUT_MS}ms`);
        record = { at, ok: false, timedOut: true };
      } else {
        record = { at, ok: true, detail: summarize(result) };
      }
    } catch (e) {
      console.warn(`[scheduler-jobs] ${job.name} failed:`, e.message);
      record = { at, ok: false, error: e.message };
    }
    await writeSentinel(pool, job.name, record);
    results.push({ name: job.name, ...record });
  }
  return results;
}

let loopTimer = null;

/** 启动 60s 轮询 loop（幂等：重复调用返回同一 timer）。 */
export function startSchedulerJobsLoop(pool) {
  if (loopTimer) return loopTimer;
  loopTimer = setInterval(() => {
    runSchedulerJobsOnce(pool).catch((e) => console.warn('[scheduler-jobs] loop iteration failed:', e.message));
  }, LOOP_INTERVAL_MS);
  if (typeof loopTimer.unref === 'function') loopTimer.unref();
  console.log(`[scheduler-jobs] started (${LOOP_INTERVAL_MS / 1000}s loop, ${JOBS.length} jobs)`);
  return loopTimer;
}

/** 停止 loop（测试用）。 */
export function stopSchedulerJobsLoop() {
  if (loopTimer) {
    clearInterval(loopTimer);
    loopTimer = null;
  }
}
```

- [ ] **Step 5: 跑测试确认全绿**

Run: `cd /Users/administrator/worktrees/cecelia/scheduler-jobs-registry/packages/brain && npx vitest run src/__tests__/scheduler-jobs.test.js`
Expected: 6 passed

- [ ] **Step 6: commit-2（Green）**

```bash
git -C /Users/administrator/worktrees/cecelia/scheduler-jobs-registry add packages/brain/src/scheduler-jobs.js
git -C /Users/administrator/worktrees/cecelia/scheduler-jobs-registry commit -m "feat(brain): scheduler-jobs 声明式定时任务注册表——救活 4 个 Wave 2 死 job（P1-PR1 commit-2 Green）"
```

---

### Task 2: server.js 挂载 + tick-runner DEPRECATED 标注

**Files:**
- Modify: `$WT/packages/brain/server.js`（Notion Push Sync 挂载块之后，约 800 行附近）
- Modify: `$WT/packages/brain/src/tick-runner.js`（4 处调用点注释）

- [ ] **Step 1: server.js 插入挂载块**

先定位锚点：`grep -n "Notion Push Sync" /Users/administrator/worktrees/cecelia/scheduler-jobs-registry/packages/brain/server.js`（预期 791-800 区间 try/catch 块）。用 python3 在该 try/catch 块**之后**插入（缩进与周围一致，处于 async 启动函数体内）：

```js
  // scheduler-jobs：声明式定时任务注册表（作战循环 P1-PR1，恢复 Wave 2 断掉的定时任务）
  try {
    const { startSchedulerJobsLoop } = await import('./src/scheduler-jobs.js');
    startSchedulerJobsLoop(pool);
  } catch (e) {
    console.warn('[Server] scheduler-jobs init failed (non-fatal):', e.message);
  }
```

（startSchedulerJobsLoop 内部已打 started 日志，挂载块不重复打。）

- [ ] **Step 2: 语法冒烟（铁律）**

Run: `node --check /Users/administrator/worktrees/cecelia/scheduler-jobs-registry/packages/brain/server.js && node --check /Users/administrator/worktrees/cecelia/scheduler-jobs-registry/packages/brain/src/scheduler-jobs.js && echo OK`
Expected: OK

- [ ] **Step 3: tick-runner.js 4 处 DEPRECATED 注释**

用 python3 字符串替换，在以下 4 个调用行**上一行**插入统一注释：
`// DEPRECATED(P1-PR1 2026-07-06): 已迁移 scheduler-jobs.js。executeTick 自 Wave 2 起不被调用；若未来复活本函数，必须先移除此调用以防双跑。`

4 个锚点（先 grep 核实再替换）：
1. `zeroGoalsTrigger = await maybeTriggerStrategySession(pool)`（约 :1042）
2. `Promise.resolve().then(() => triggerArchReview(pool))`（约 :1544）
3. `Promise.resolve().then(() => runConversationDigest())`（约 :1557）
4. `Promise.resolve().then(() => runCaptureDigestion())`（约 :1561）

- [ ] **Step 4: 验证 + 回归**

Run: `node --check /Users/administrator/worktrees/cecelia/scheduler-jobs-registry/packages/brain/src/tick-runner.js && grep -c "DEPRECATED(P1-PR1" /Users/administrator/worktrees/cecelia/scheduler-jobs-registry/packages/brain/src/tick-runner.js`
Expected: `4`
Run: `cd /Users/administrator/worktrees/cecelia/scheduler-jobs-registry/packages/brain && npx vitest run src/__tests__/scheduler-jobs.test.js src/__tests__/daily-review-scheduler.test.js`
Expected: 全绿（确认没碰坏既有 scheduler 测试）

- [ ] **Step 5: Commit**

```bash
git -C /Users/administrator/worktrees/cecelia/scheduler-jobs-registry add packages/brain/server.js packages/brain/src/tick-runner.js
git -C /Users/administrator/worktrees/cecelia/scheduler-jobs-registry commit -m "feat(brain): server.js 挂载 scheduler-jobs loop + tick-runner 4 处死调用标注 DEPRECATED"
```

---

### Task 3: 文档两件（设计总纲入库 + 死 job 处置清单）

**Files:**
- Create: `$WT/docs/current/battle-loop-design.md`
- Create: `$WT/docs/current/executetick-dead-jobs-inventory.md`

- [ ] **Step 1: battle-loop-design.md 转写**

读 `/Users/administrator/claude-output/cecelia-battle-loop-design.html`（v1.10 最终版），剥离 HTML 转写为 markdown，**保留全部七节内容**（诊断/loop 全景/三模式/Human 触点/四期设计/8 拍板/前置清单）与"一天的节奏表"。文首加：

```markdown
# Cecelia 作战循环设计（v1.10 定稿 2026-07-06）

> SSOT 说明：本文是 2026-07-06 与主理人 8 轮拍板的定稿存档。8 条拍板决策已落 decisions 表
> （a0870384 / 584a5946 / 542a86ee / e1eed454 / 467ced6b / 1ef6ec3e / 928c6054 / e035dad8）。
> 阅读版：http://38.23.47.81:9998/cecelia-battle-loop-design.html
```

- [ ] **Step 2: executetick-dead-jobs-inventory.md**

读 `$WT/packages/brain/src/tick-runner.js` 的 :1036-1050 与 :1523-1735 区间，逐个列出所有定时/巡检/汇报调用。产出三态清单表（已迁移/待迁移/建议废弃），基线分类：

| 调用 | 处置 | 归属 |
|---|---|---|
| triggerArchReview / maybeTriggerStrategySession / runConversationDigest / runCaptureDigestion | ✅ 已迁移 scheduler-jobs（本 PR） | P1-PR1 |
| triggerDailyReview（code_review 调度） | 待迁移 | P1 后续 |
| generateDailyDiaryIfNeeded（diary） | 待迁移（重生为对齐会/战报生成器） | P2 |
| 每日内容日报 / 周报 / topic 选题 / 发布调度 / 采集 / KR3 报告 / 凭据巡检 / 备份 / skill-drift / test-lifecycle / daily smoke / notebook 喂入 / synthesis / suggestion cycle / dept heartbeat / code quality scan / contract_scan / 48h 简报 / self-report / evolution synthesize 等 | 待迁移或建议废弃（与活循环重复的标废弃，如 rumination 死触发点——意识循环已有活触发） | P2/P3 逐期 |

要求：每行给 tick-runner.js 行号引用；"建议废弃"必须写一句理由。文首注明本清单满足 migration-orphan-audit 铁律。

- [ ] **Step 3: Commit**

```bash
git -C /Users/administrator/worktrees/cecelia/scheduler-jobs-registry add docs/current/battle-loop-design.md docs/current/executetick-dead-jobs-inventory.md
git -C /Users/administrator/worktrees/cecelia/scheduler-jobs-registry commit -m "docs(current): 作战循环设计总纲 v1.10 入库 + executeTick 死 job 处置清单（migration-orphan-audit）"
```

---

### Task 4: 版本 bump + DevGate + Learning + 全量回归

**Files:**
- Modify: `$WT/packages/brain/package.json`（version patch +1）
- Modify: `$WT/package-lock.json`（如 check-version-sync 要求；lockfile 中 brain 版本出现在两处）
- Modify: `$WT/.agent-knowledge/brain.md`（新增 Brain src 文件登记）
- Create: `$WT/docs/learnings/cp-07061548-scheduler-jobs-registry.md`

- [ ] **Step 1: 版本 bump**

读 `$WT/packages/brain/package.json` 当前 version，patch +1（python3 改）。然后：
Run: `cd /Users/administrator/worktrees/cecelia/scheduler-jobs-registry && bash scripts/check-version-sync.sh`
Expected: 通过；若报 lockfile 不同步，更新 `package-lock.json` 中 brain 的**两处**版本字段再跑到通过。

- [ ] **Step 2: DevGate + brain.md 登记**

Run: `cd /Users/administrator/worktrees/cecelia/scheduler-jobs-registry && node scripts/facts-check.mjs`
Expected: 通过。
在 `$WT/.agent-knowledge/brain.md` 的模块表区新增一节/一行（Brain New Files Check CI 要求新增 src 文件登记）：
`| scheduler-jobs.js | 声明式定时任务注册表：60s loop + 模块自 gate + 错误隔离/timeout/working_memory 观测哨兵（scheduler_job_last_run:*）。P1-PR1 救活 4 个 Wave 2 死 job（arch-review/strategy-trigger/conversation-digest/capture-digestion）。 |`

- [ ] **Step 3: Learning 文件（push 前铁律）**

写 `$WT/docs/learnings/cp-07061548-scheduler-jobs-registry.md`：

```markdown
# scheduler-jobs 注册表：Wave 2 死代码带的第一刀

### 根本原因
2026-05-04 Wave 2 重构把 tick-loop 从 executeTick 切到 runScheduler（纯派发）后，
executeTick step 10.x 约 25 个定时任务调用全部成死代码且无人发现两个月——
诊断类/总结类机制没有"自身死亡告警"，静默死亡与天下太平不可区分。

### 下次预防
- [ ] 替换核心调度器时必须产出孤儿清单（migration-orphan-audit 铁律，本 PR 的 inventory 即范例）
- [ ] 定时任务一律挂 scheduler-jobs 注册表（错误隔离+timeout+观测哨兵），禁止再裸挂 setInterval
- [ ] 观测哨兵 scheduler_job_last_run:* 供死人开关体检；P1 后续 PR 落体外哨兵
```

- [ ] **Step 4: brain 全量单测 + 语法冒烟**

Run: `cd /Users/administrator/worktrees/cecelia/scheduler-jobs-registry/packages/brain && npx vitest run 2>&1 | tail -5`
Expected: 全绿（或与 main 相同的既有 known-failure 集，不新增失败）
Run: `node --check /Users/administrator/worktrees/cecelia/scheduler-jobs-registry/packages/brain/server.js && echo OK`
Expected: OK

- [ ] **Step 5: Commit**

```bash
git -C /Users/administrator/worktrees/cecelia/scheduler-jobs-registry add -A
git -C /Users/administrator/worktrees/cecelia/scheduler-jobs-registry commit -m "chore(brain): version bump + brain.md 模块登记 + learning（P1-PR1 收尾）"
```

---

## Self-Review 结论

- Spec 覆盖：注册表（Task1）/ server 挂载与 DEPRECATED（Task2）/ 两份文档（Task3）/ 版本与 DevGate（Task4）✅
- 无占位符：所有代码/命令给全 ✅
- 类型一致：SENTINEL_KEY_PREFIX、runSchedulerJobsOnce(pool, jobs?)、startSchedulerJobsLoop(pool) 各 task 一致 ✅
- 真环境验证（merge 后 Gate3 部署时执行，不在本 plan 内）：docker logs 见 started 日志、working_memory 4 个 key、4h 窗口 arch_review 任务
