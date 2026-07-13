# Escalation 静默取消修复 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** escalation.js 的批量取消/暂停动作改成只碰系统自产任务（trigger_source 白名单）、cancel 动作改为可逆 pause 并留痕，diagnosis.js 的内存泄漏判定加最小采样时间窗防噪声误判。

**Architecture:** 纯逻辑改动，不改表结构、不改外部接口签名。`escalation.js` 两个内部函数（`pauseLowPriorityTasks`/`cancelPendingTasks`）的 SQL 语句加过滤条件和留痕字段；`diagnosis.js` 的 `MEMORY_LEAK.checks` 加一行提前返回。全部用 mock `pool.query` 的 vitest unit test 覆盖。

**Tech Stack:** Node.js ESM, vitest, PostgreSQL（node-postgres `pg`）。

## Global Constraints

- 所有改动限定在 `packages/brain/src/alertness/escalation.js`、`packages/brain/src/alertness/diagnosis.js`、`packages/brain/src/alertness/__tests__/escalation.test.js`、`packages/brain/src/alertness/__tests__/diagnosis.test.js`（新建）。
- TDD 铁律：每个改动先写 failing test 再写实现，两次独立 commit（commit-1 = test / commit-2 = impl）。
- 不改 `CANCEL_EXEMPT_TYPES`（task_type 黑名单）内容，作为叠加的第二层防御保留。
- 不改 `checkTransitionRules` 的冷却期逻辑（超出本次范围，见 spec「不改的部分」）。
- `pauseLowPriorityTasks`/`cancelPendingTasks` 对外调用签名（`executeAction` 里的 `case` 分支）不变。

---

### Task 1: `escalation.js` — 新增 `SYSTEM_AUTO_TRIGGER_SOURCES` 白名单常量

**Files:**
- Modify: `packages/brain/src/alertness/escalation.js`（在 `CANCEL_EXEMPT_TYPES` 定义之后，约第 83 行后新增）
- Test: `packages/brain/src/alertness/__tests__/escalation.test.js`

**Interfaces:**
- Produces: `export const SYSTEM_AUTO_TRIGGER_SOURCES` — `string[]`，供 Task 2/3 的 SQL 参数与测试引用。

- [ ] **Step 1: 写 failing test**

在 `packages/brain/src/alertness/__tests__/escalation.test.js` 末尾（`describe('CANCEL_EXEMPT_TYPES', ...)` 之后）追加：

```javascript
describe('SYSTEM_AUTO_TRIGGER_SOURCES', () => {
  it('只包含系统自产来源，不包含用户来源', async () => {
    const { SYSTEM_AUTO_TRIGGER_SOURCES } = await import('../escalation.js');
    expect(SYSTEM_AUTO_TRIGGER_SOURCES).toContain('brain_auto');
    expect(SYSTEM_AUTO_TRIGGER_SOURCES).toContain('content_pipeline_orchestrator');
    expect(SYSTEM_AUTO_TRIGGER_SOURCES).toContain('harness_task_dispatch');
    expect(SYSTEM_AUTO_TRIGGER_SOURCES).not.toContain('manual');
    expect(SYSTEM_AUTO_TRIGGER_SOURCES).not.toContain('user');
    expect(SYSTEM_AUTO_TRIGGER_SOURCES).not.toContain('user_headed');
    expect(SYSTEM_AUTO_TRIGGER_SOURCES).not.toContain('owner_input');
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd packages/brain && npx vitest run src/alertness/__tests__/escalation.test.js -t "SYSTEM_AUTO_TRIGGER_SOURCES"`
Expected: FAIL —— `SYSTEM_AUTO_TRIGGER_SOURCES is not exported` 或 `undefined`。

- [ ] **Step 3: 提交 failing test**

```bash
git add packages/brain/src/alertness/__tests__/escalation.test.js
git commit -m "test: SYSTEM_AUTO_TRIGGER_SOURCES 白名单覆盖用户/系统来源(failing)"
```

- [ ] **Step 4: 实现**

在 `packages/brain/src/alertness/escalation.js` 里 `CANCEL_EXEMPT_TYPES` 常量定义结束（原第 83 行 `];` 之后）新增：

```javascript
// ============================================================
// 系统自产 trigger_source 白名单
// escalation 的批量 pause/cancel 动作只准碰这里列出的来源。
// manual/user*/owner_input/chat_mouth/test 等用户或人工来源天然被排除，
// 不需要单独维护黑名单——新增来源默认视为"不可动"，比默认视为"可动"更安全。
// 见 Issue 9db1da44：白名单缺失导致用户注册任务被静默取消。
// ============================================================

export const SYSTEM_AUTO_TRIGGER_SOURCES = [
  'brain_auto', 'auto',
  'content_pipeline_orchestrator', 'content_pipeline_api',
  'execution_callback_harness', 'execution_callback_harness_serial',
  'self_drive', 'cortex', 'auto_fix', 'recurring', 'api',
  'harness_task_dispatch', 'harness_watcher', 'harness_deploy_watch',
  'brain_cron_smoke_alert', 'brain_cron_daily_smoke',
  'rca', 'active_goals_zero', 'accumulation_trigger',
];
```

- [ ] **Step 5: 跑测试确认通过**

Run: `cd packages/brain && npx vitest run src/alertness/__tests__/escalation.test.js -t "SYSTEM_AUTO_TRIGGER_SOURCES"`
Expected: PASS

- [ ] **Step 6: 提交实现**

```bash
git add packages/brain/src/alertness/escalation.js
git commit -m "feat: 新增 SYSTEM_AUTO_TRIGGER_SOURCES 白名单常量"
```

---

### Task 2: `escalation.js` — `pauseLowPriorityTasks` 加 trigger_source 过滤 + 留痕

**Files:**
- Modify: `packages/brain/src/alertness/escalation.js:332-364`（`pauseLowPriorityTasks` 函数体）
- Test: `packages/brain/src/alertness/__tests__/escalation.test.js`

**Interfaces:**
- Consumes: `SYSTEM_AUTO_TRIGGER_SOURCES`（Task 1 产出）
- Produces: `pauseLowPriorityTasks(priorities: string[]): Promise<number>` —— 签名不变，SQL 与留痕行为变化。

- [ ] **Step 1: 写 failing test**

在 `escalation.test.js` 追加一个新 `describe`：

```javascript
describe('pauseLowPriorityTasks (graceful_degrade)', () => {
  it('只暂停 trigger_source 在系统白名单内的任务，并写 error_message + status_history', async () => {
    mockQuery.mockResolvedValue({ rowCount: 0, rows: [] });

    const { executeResponse, SYSTEM_AUTO_TRIGGER_SOURCES } = await import('../escalation.js');
    await executeResponse({
      actions: [{ type: 'pause_low_priority', params: { priorities: ['P2', 'P3'] } }]
    });

    const updateCall = mockQuery.mock.calls[0];
    const sql = updateCall[0];
    const params = updateCall[1];

    expect(sql).toContain("SET status = 'paused'");
    expect(sql).toContain('trigger_source = ANY');
    expect(sql).toContain('error_message');
    expect(sql).toContain('status_history');
    expect(params).toContain(SYSTEM_AUTO_TRIGGER_SOURCES);
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd packages/brain && npx vitest run src/alertness/__tests__/escalation.test.js -t "pauseLowPriorityTasks"`
Expected: FAIL —— `sql` 不包含 `trigger_source = ANY`（当前 SQL 没有这个条件）。

- [ ] **Step 3: 提交 failing test**

```bash
git add packages/brain/src/alertness/__tests__/escalation.test.js
git commit -m "test: pauseLowPriorityTasks 需按 trigger_source 白名单过滤+留痕(failing)"
```

- [ ] **Step 4: 实现**

把 `packages/brain/src/alertness/escalation.js` 第 332-364 行的 `pauseLowPriorityTasks` 整体替换为：

```javascript
async function pauseLowPriorityTasks(priorities) {
  const client = await pool.connect();
  try {
    // 白名单：active Initiative 的子工作流 + 内容 pipeline 关键步骤。
    // 这些任务属于"当前关键路径"，不是背景 P2/P3，必须豁免 pause。
    // harness_* 系列：harness v2 DAG 的 Initiative / Planner / Contract /
    // Generator / Evaluator 等阶段任务（upsertTaskPlan 默认创建为 P0，
    // 但此处做 task_type 层双保险，避免未来误改回 P2 再次踩坑）。
    //
    // trigger_source = ANY($3)：只准碰系统自产任务（见 SYSTEM_AUTO_TRIGGER_SOURCES 注释），
    // 用户/人工注册的任务（manual/user*/owner_input 等）天然不在白名单内，不会被 pause。
    const result = await client.query(`
      UPDATE tasks
      SET status = 'paused',
          error_message = $3,
          status_history = status_history || jsonb_build_array(
            jsonb_build_object('from', status, 'to', 'paused', 'changed_at', NOW(), 'source', $3)
          ),
          updated_at = NOW()
      WHERE status IN ('queued', 'pending')
        AND priority = ANY($1)
        AND trigger_source = ANY($2)
        AND task_type NOT IN (
          'sprint_planner', 'sprint_contract_propose', 'sprint_contract_review',
          'sprint_generate', 'sprint_evaluate', 'sprint_fix', 'arch_review',
          'content-pipeline', 'content-research', 'content-copywriting',
          'content-copy-review', 'content-generate', 'content-image-review', 'content-export',
          'harness_initiative', 'harness_task', 'harness_planner',
          'harness_contract_propose', 'harness_contract_review',
          'harness_generate', 'harness_evaluate', 'harness_fix',
          'harness_ci_watch', 'harness_deploy_watch', 'harness_report'
        )
      RETURNING id
    `, [priorities, SYSTEM_AUTO_TRIGGER_SOURCES, 'escalation_graceful_degrade']);

    console.log(`[Escalation] Paused ${result.rowCount} low priority tasks`);
    return result.rowCount;
  } finally {
    client.release();
  }
}
```

- [ ] **Step 5: 跑测试确认通过**

Run: `cd packages/brain && npx vitest run src/alertness/__tests__/escalation.test.js`
Expected: PASS（全部用例，含 Task 1 的测试）

- [ ] **Step 6: 提交实现**

```bash
git add packages/brain/src/alertness/escalation.js
git commit -m "fix: pauseLowPriorityTasks 加 trigger_source 白名单过滤 + error_message/status_history 留痕"
```

---

### Task 3: `escalation.js` — `cancelPendingTasks` 改为可逆 pause + trigger_source 过滤 + 留痕

**Files:**
- Modify: `packages/brain/src/alertness/escalation.js:372-395`（`cancelPendingTasks` 函数体）
- Modify: `packages/brain/src/alertness/__tests__/escalation.test.js`（更新已有的 `cancel_pending` 用例断言，因为行为从 cancel 变成 pause）
- Test: `packages/brain/src/alertness/__tests__/escalation.test.js`

**Interfaces:**
- Consumes: `SYSTEM_AUTO_TRIGGER_SOURCES`（Task 1）、`CANCEL_EXEMPT_TYPES`（既有）
- Produces: `cancelPendingTasks(keepCritical: boolean): Promise<number>` —— 签名不变，内部改为 `status = 'paused'`。

**注意：** 已有测试 `escalation.test.js` 第 20-32 行 `'content_publish 任务在 cancel_pending 动作执行时传入豁免参数'` 断言 `updateCall[1][0]` 等于 `CANCEL_EXEMPT_TYPES`——本任务的 SQL 参数顺序设计为 `[CANCEL_EXEMPT_TYPES, SYSTEM_AUTO_TRIGGER_SOURCES, errorMessage]`，`params[0]` 仍是 `CANCEL_EXEMPT_TYPES`，这条已有测试不需要改动、应继续通过。

- [ ] **Step 1: 写 failing test**

在 `escalation.test.js` 的 `describe('CANCEL_EXEMPT_TYPES', ...)` 块内追加一条新 `it`（放在现有两个 `it` 之后，`});` 之前）：

```javascript
  it('cancel_pending 动作现在是可逆 pause，不是终态 canceled，且写 trigger_source 过滤 + 留痕', async () => {
    mockQuery.mockResolvedValue({ rowCount: 0, rows: [] });

    const { executeResponse, SYSTEM_AUTO_TRIGGER_SOURCES } = await import('../escalation.js');
    await executeResponse({ actions: [{ type: 'cancel_pending', params: { keepCritical: true } }] });

    const updateCall = mockQuery.mock.calls[0];
    const sql = updateCall[0];
    const params = updateCall[1];

    expect(sql).toContain("SET status = 'paused'");
    expect(sql).not.toContain("'canceled'");
    expect(sql).toContain('trigger_source = ANY');
    expect(sql).toContain('error_message');
    expect(sql).toContain('status_history');
    expect(params).toContain(SYSTEM_AUTO_TRIGGER_SOURCES);
  });
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd packages/brain && npx vitest run src/alertness/__tests__/escalation.test.js -t "cancel_pending 动作现在是可逆 pause"`
Expected: FAIL —— 当前 SQL 是 `SET status = 'canceled'`，不含 `trigger_source = ANY`/`error_message`/`status_history`。

- [ ] **Step 3: 提交 failing test**

```bash
git add packages/brain/src/alertness/__tests__/escalation.test.js
git commit -m "test: cancel_pending 应改为可逆 pause + trigger_source 过滤 + 留痕(failing)"
```

- [ ] **Step 4: 实现**

把 `packages/brain/src/alertness/escalation.js` 第 372-395 行的 `cancelPendingTasks` 整体替换为：

```javascript
async function cancelPendingTasks(keepCritical) {
  const client = await pool.connect();
  try {
    // 2026-07-09 修复(Issue 9db1da44)：不再 SET status = 'canceled'（终态，
    // 一旦误伤无法恢复），改为可逆的 'paused'，并加 trigger_source 白名单
    // 过滤（只碰系统自产任务）+ error_message/status_history 留痕。
    // jsonb_build_object 里的 'status' 引用的是 UPDATE 前的旧值（Postgres
    // SET 子句求值语义），天然拿到正确的 from。
    let query = `
      UPDATE tasks
      SET status = 'paused',
          error_message = $3,
          status_history = status_history || jsonb_build_array(
            jsonb_build_object('from', status, 'to', 'paused', 'changed_at', NOW(), 'source', $3)
          ),
          updated_at = NOW()
      WHERE status IN ('queued', 'pending')
        AND NOT (task_type = ANY($1))
        AND trigger_source = ANY($2)
    `;

    if (keepCritical) {
      query += ` AND priority != 'P0'`;
    }

    query += ` RETURNING id`;

    const result = await client.query(query, [CANCEL_EXEMPT_TYPES, SYSTEM_AUTO_TRIGGER_SOURCES, 'escalation_emergency_brake']);
    console.log(`[Escalation] Paused (was: canceled) ${result.rowCount} pending tasks`);
    return result.rowCount;
  } finally {
    client.release();
  }
}
```

- [ ] **Step 5: 跑测试确认通过**

Run: `cd packages/brain && npx vitest run src/alertness/__tests__/escalation.test.js`
Expected: PASS（全部用例，含既有的 `content_publish` 测试与 Task 1/2 的新测试）

- [ ] **Step 6: 提交实现**

```bash
git add packages/brain/src/alertness/escalation.js
git commit -m "fix: cancelPendingTasks 改为可逆 pause + trigger_source 白名单过滤 + 留痕"
```

---

### Task 4: `diagnosis.js` — `MEMORY_LEAK` 加最小采样时间窗

**Files:**
- Modify: `packages/brain/src/alertness/diagnosis.js:28-54`（`MEMORY_LEAK.checks`）
- Test: `packages/brain/src/alertness/__tests__/diagnosis.test.js`（新建）

**Interfaces:**
- Consumes: 无新依赖，`diagnosis.js` 默认导出的 `ANOMALY_PATTERNS.MEMORY_LEAK.checks(metrics, history)` 已存在。
- Produces: `ANOMALY_PATTERNS.MEMORY_LEAK.checks` 行为变化——短时间窗内的噪声不再误判为泄漏。

- [ ] **Step 1: 写 failing test**

新建 `packages/brain/src/alertness/__tests__/diagnosis.test.js`：

```javascript
import { describe, it, expect } from 'vitest';
import diagnosis from '../diagnosis.js';

const { ANOMALY_PATTERNS } = diagnosis;

function buildHistory(entries) {
  // entries: [{ value, timestamp }]
  return entries.map(e => ({ metrics: { memory: { value: e.value } }, timestamp: e.timestamp }));
}

describe('ANOMALY_PATTERNS.MEMORY_LEAK', () => {
  it('时间窗小于 2 分钟时，即使增长率数值很高也不判定为泄漏（防噪声误判）', () => {
    const now = 1000000;
    // 10 个采样点，全部挤在 6 秒内（0.1 分钟），372MB 附近的正常小波动
    // 会被短时间窗放大成虚高的 MB/分钟速率。
    const history = buildHistory([
      { value: 370, timestamp: now },
      { value: 371, timestamp: now + 600 },
      { value: 372, timestamp: now + 1200 },
      { value: 371, timestamp: now + 1800 },
      { value: 373, timestamp: now + 2400 },
      { value: 372, timestamp: now + 3000 },
      { value: 374, timestamp: now + 3600 },
      { value: 373, timestamp: now + 4200 },
      { value: 375, timestamp: now + 4800 },
      { value: 380, timestamp: now + 6000 },
    ]);
    const metrics = { memory: { value: 380 } };

    expect(ANOMALY_PATTERNS.MEMORY_LEAK.checks(metrics, history)).toBe(false);
  });

  it('时间窗 >= 2 分钟且增长率超阈值时，仍正确判定为泄漏（不误伤真实检测）', () => {
    const now = 1000000;
    const history = buildHistory([
      { value: 200, timestamp: now },
      { value: 220, timestamp: now + 20000 },
      { value: 240, timestamp: now + 40000 },
      { value: 260, timestamp: now + 60000 },
      { value: 280, timestamp: now + 80000 },
      { value: 300, timestamp: now + 100000 },
      { value: 320, timestamp: now + 120000 },
      { value: 340, timestamp: now + 140000 },
      { value: 360, timestamp: now + 160000 },
      { value: 400, timestamp: now + 180000 }, // 3 分钟窗口，200MB 涨到 400MB
    ]);
    const metrics = { memory: { value: 400 } };

    expect(ANOMALY_PATTERNS.MEMORY_LEAK.checks(metrics, history)).toBe(true);
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd packages/brain && npx vitest run src/alertness/__tests__/diagnosis.test.js`
Expected: 第一条用例 FAIL（当前实现没有最小时间窗保护，0.1 分钟内 10MB 涨幅算出的速率远超 50MB/分钟阈值，会误判为 `true`）；第二条用例本来就应该 PASS。

- [ ] **Step 3: 提交 failing test**

```bash
git add packages/brain/src/alertness/__tests__/diagnosis.test.js
git commit -m "test: MEMORY_LEAK 短时间窗噪声不应误判为泄漏(failing)"
```

- [ ] **Step 4: 实现**

在 `packages/brain/src/alertness/diagnosis.js` 的 `MEMORY_LEAK.checks` 函数体内，把：

```javascript
      if (timeDiffMinutes === 0) return false;
```

替换为：

```javascript
      // 采样窗口小于 2 分钟时，短间隔 tick 的正常波动会被放大成虚高的
      // MB/分钟速率（如 6 秒内涨 10MB 算出来是 100MB/分钟）。真正的内存
      // 泄漏是持续性的，2 分钟窗口足够把这类噪声滤掉。
      if (timeDiffMinutes < 2) return false;
```

- [ ] **Step 5: 跑测试确认通过**

Run: `cd packages/brain && npx vitest run src/alertness/__tests__/diagnosis.test.js`
Expected: PASS（两条用例）

- [ ] **Step 6: 提交实现**

```bash
git add packages/brain/src/alertness/diagnosis.js
git commit -m "fix: MEMORY_LEAK 判定加最小采样时间窗(2分钟)防噪声误判"
```

---

### Task 5: 全量回归 + 收尾

**Files:**
- 无新改动，仅验证。

- [ ] **Step 1: 跑 alertness 模块全部测试**

Run: `cd packages/brain && npx vitest run src/alertness`
Expected: 全部 PASS，包括 `escalation.test.js`（原有 2 条 + 新增 3 条）、`diagnosis.test.js`（新增 2 条）、`healing.test.js`（原有，不应受影响）。

- [ ] **Step 2: 跑 brain 包全量测试，确认无回归**

Run: `cd packages/brain && npx vitest run`
Expected: 全部 PASS，无因本次改动导致的新增失败。

- [ ] **Step 3: 确认无遗留 TODO/console.log 调试代码**

Run: `git diff main --stat` 检查改动文件列表仅限 Global Constraints 里列出的 4 个文件；`git diff main -- packages/brain/src/alertness/escalation.js packages/brain/src/alertness/diagnosis.js` 逐行确认无临时调试代码。
