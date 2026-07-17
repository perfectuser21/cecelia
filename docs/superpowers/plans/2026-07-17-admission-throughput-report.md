# 日报 admission 吞吐段 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 作战日报新增「harness admission 吞吐」段（24h 派发/拒发聚合 + 容器峰值 + 当前 vitals），machine-vitals 采样顺手滚动记峰值。

**Architecture:** 两个独立小改动：machine-vitals.js 峰值 upsert（working_memory 键 `machine_vitals_daily_peak`）；battle-report.js buildBattleReportData 加三个数据源 + renderBattleReportMarkdown 加一段。

**Tech Stack:** Node.js ESM、vitest（mock 只打 pool.query / vitals 缓存注入）。

## Global Constraints

- 简体中文注释/commit，commit 尾行 `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`
- TDD：每 task commit-1 failing test → commit-2 实现
- 测试只跑目标文件（全量 vitest OOM）：`cd packages/brain && npx vitest run src/__tests__/<file> --reporter=basic`
- DB 写失败 catch 不影响主流程（与既有哨兵键同风格）；空数据渲染"暂无"（与既有段一致）
- Spec：`docs/superpowers/specs/2026-07-17-admission-throughput-report-design.md`

---

### Task 1: machine-vitals 峰值滚动

**Files:**
- Modify: `packages/brain/src/machine-vitals.js`（sampleMachineVitals 成功分支尾部）
- Test: `packages/brain/src/__tests__/machine-vitals.test.js`（追加 describe）

**Interfaces:**
- Produces: working_memory 键 `machine_vitals_daily_peak`，value_json `{date:'YYYY-MM-DD', peak:number}`（date 取 Asia/Shanghai 当日）；导出 `_getPeakStateForTest()` 可选（若实现用模块内存镜像加速同日比较，导出便于测试；纯 DB 读改写亦可，实现者选简单者）
- Consumes: sampleMachineVitals 已有的可选 pool 参数（终审 Fix 1 已加）

- [ ] **Step 1: 追加 failing test（machine-vitals.test.js 尾部新 describe）**

```js
describe('machine_vitals_daily_peak 峰值滚动', () => {
  function poolMock() { return { query: vi.fn().mockResolvedValue({ rows: [] }) }; }
  function peakUpsertCalls(pool) {
    return pool.query.mock.calls.filter(([sql]) => String(sql).includes('machine_vitals_daily_peak'));
  }
  function lastPeakValue(pool) {
    const calls = peakUpsertCalls(pool);
    const params = calls[calls.length - 1][1];
    return JSON.parse(params[1]); // [key, value_json] 参数序
  }

  it('同日两次采样 5→3：peak 保持 5', async () => {
    const pool = poolMock();
    stubDocker({ psNames: Array.from({length:5},(_,i)=>`cecelia-relay-x${i}-1`).join('\n') + '\n' });
    await sampleMachineVitals(pool);
    stubDocker({ psNames: 'cecelia-relay-a-1\ncecelia-relay-b-2\ncecelia-relay-c-3\n' });
    await sampleMachineVitals(pool);
    expect(lastPeakValue(pool).peak).toBe(5);
  });

  it('采样失败不写峰值', async () => {
    const pool = poolMock();
    stubDocker({ fail: 'docker down' });
    await sampleMachineVitals(pool);
    expect(peakUpsertCalls(pool)).toHaveLength(0);
  });

  it('无 pool 不抛错且不写', async () => {
    stubDocker({ psNames: 'cecelia-relay-a-1\n' });
    await expect(sampleMachineVitals()).resolves.toBeTruthy();
  });
});
```

> 既有测试文件已有 `stubDocker`/`_resetVitalsCacheForTest` 基建与 beforeEach，复用；`_resetVitalsCacheForTest` 需同步重置峰值内存态（若实现用内存镜像）。跨日重置逻辑通过内存态注入或日期函数参数化测试（实现者按最简方式补一条用例，断言跨日后 peak=当日值）。

- [ ] **Step 2: 跑测试确认失败** — `npx vitest run src/__tests__/machine-vitals.test.js --reporter=basic`，新 describe 全红
- [ ] **Step 3: commit-1**（`test(brain): machine-vitals 峰值滚动 failing test（de6d3582 T1）`）
- [ ] **Step 4: 实现**：sampleMachineVitals 成功分支（`_lastGoodAt` 赋值附近）追加：

```js
    // 当日容器数峰值滚动（日报 admission 吞吐段数据源，de6d3582）
    if (pool) {
      try {
        const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai' }).format(new Date());
        if (!_peakState || _peakState.date !== today || next.relay_count > _peakState.peak) {
          _peakState = { date: today, peak: (_peakState && _peakState.date === today) ? Math.max(_peakState.peak, next.relay_count) : next.relay_count };
          await pool.query(
            `INSERT INTO working_memory (key, value_json, updated_at) VALUES ('machine_vitals_daily_peak', $1, NOW())
             ON CONFLICT (key) DO UPDATE SET value_json = $1, updated_at = NOW()`,
            [JSON.stringify(_peakState)]
          );
        }
      } catch (err) {
        console.warn(`[machine-vitals] 峰值写入失败(不影响采样): ${err.message}`);
      }
    }
```

模块顶部加 `let _peakState = null;`，`_resetVitalsCacheForTest` 里加 `_peakState = null;`。
> 注意 upsert SQL 参数序：$1 = value_json（key 写死在 SQL 里），测试的 `lastPeakValue` 取 `params[0]`——实现与测试对齐参数序（以实现为准微调测试取值下标，断言语义不变）。

- [ ] **Step 5: 跑测试变绿**（同文件全过，含既有用例）
- [ ] **Step 6: commit-2**（`feat(brain): machine-vitals 当日容器峰值滚动写 working_memory（de6d3582 T1）`）

---

### Task 2: battle-report 加 admission 吞吐段

**Files:**
- Modify: `packages/brain/src/battle-report.js`（buildBattleReportData 尾部加数据源；renderBattleReportMarkdown 加段）
- Test: `packages/brain/src/__tests__/battle-report.test.js`（追加）

**Interfaces:**
- Consumes: `dispatch_events(task_id, event_type, reason, created_at)`；working_memory 键 `machine_vitals_daily_peak`；`getMachineVitals()`（machine-vitals.js 既有）
- Produces: data 对象新字段 `admission = { dispatched_24h:number, denies:[{reason,count}], peak:{date,peak}|null, vitals:object }`；markdown 新段 `## Harness admission 吞吐（24h）`

- [ ] **Step 1: 追加 failing test（battle-report.test.js，先读该文件学 mock 手法后按其风格写）**

覆盖三条：
1. buildBattleReportData：mock pool.query 对 dispatch_events 返回 `[{reason:'cap_reached',count:'3'}]`、dispatched 计数 `12`、peak 键返回 `{date:'2026-07-17',peak:4}` → data.admission 各字段正确
2. render 有数据：markdown 含 `## Harness admission 吞吐（24h）`、`派发 12 次`、`cap_reached: 3`、`容器峰值 4`
3. render 全空（dispatched=0、denies=[]、peak=null）→ 段内渲染 `暂无`

admission 拒发 reason 白名单（SQL IN 清单，写常量导出便于断言）：
`cap_reached, vitals_stale, vitals_error, disk_pressure, memory_pressure, no_memory_headroom, quota_critical, quota_low_priority, inflight_query_error, task_cap_backstop`

- [ ] **Step 2: 跑测试确认失败** — `npx vitest run src/__tests__/battle-report.test.js --reporter=basic`
- [ ] **Step 3: commit-1**（`test(brain): 日报 admission 吞吐段 failing test（de6d3582 T2）`）
- [ ] **Step 4: 实现**：

buildBattleReportData 尾部（return 前）追加：

```js
  // ⑦ harness admission 吞吐（beeba317 观察哨，de6d3582）
  let admission = { dispatched_24h: 0, denies: [], peak: null, vitals: null };
  try {
    const { rows: dispRows } = await pool.query(
      `SELECT count(*)::int AS n FROM dispatch_events
        WHERE event_type = 'dispatched' AND created_at >= NOW() - interval '24 hours'`
    );
    const { rows: denyRows } = await pool.query(
      `SELECT reason, count(*)::int AS count FROM dispatch_events
        WHERE event_type = 'failed_dispatch'
          AND reason = ANY($1::text[])
          AND created_at >= NOW() - interval '24 hours'
        GROUP BY reason ORDER BY count DESC`,
      [ADMISSION_DENY_REASONS]
    );
    const { rows: peakRows } = await pool.query(
      `SELECT value_json FROM working_memory WHERE key = 'machine_vitals_daily_peak'`
    );
    admission = {
      dispatched_24h: dispRows[0]?.n ?? 0,
      denies: denyRows,
      peak: peakRows[0]?.value_json ?? null,
      vitals: getMachineVitals(),
    };
  } catch (err) {
    console.warn(`[battle-report] admission 段取数失败(渲染暂无): ${err.message}`);
  }
```

顶部：`import { getMachineVitals } from './machine-vitals.js';` + 导出常量：

```js
// admission 拒发 reason 白名单（slot-allocator.harnessSlotCheck + dispatcher 兜底全集）
export const ADMISSION_DENY_REASONS = [
  'cap_reached', 'vitals_stale', 'vitals_error', 'disk_pressure', 'memory_pressure',
  'no_memory_headroom', 'quota_critical', 'quota_low_priority', 'inflight_query_error', 'task_cap_backstop',
];
```

return 对象加 `admission`。renderBattleReportMarkdown 在「各线战况」段之后插：

```js
  lines.push('');
  lines.push('## Harness admission 吞吐（24h）');
  const adm = data.admission || { dispatched_24h: 0, denies: [], peak: null, vitals: null };
  const denyTotal = adm.denies.reduce((s, d) => s + (d.count || 0), 0);
  if (adm.dispatched_24h === 0 && denyTotal === 0 && !adm.peak) {
    lines.push('暂无');
  } else {
    const peakStr = adm.peak ? `容器峰值 ${adm.peak.peak}` : '容器峰值 暂无';
    const vitalsStr = adm.vitals && !adm.vitals.stale
      ? `当前 ${adm.vitals.relay_count} 容器 / VM 余 ${Math.max(0, (adm.vitals.vm_total_mb ?? 0) - (adm.vitals.vm_used_mb ?? 0))}MB / 盘 ${adm.vitals.host_disk_pct}%`
      : '当前体征 stale';
    lines.push(`- 派发 ${adm.dispatched_24h} 次｜admission 拒发 ${denyTotal} 次｜${peakStr}｜${vitalsStr}`);
    for (const d of adm.denies) lines.push(`  - ${d.reason}: ${d.count}`);
  }
```

- [ ] **Step 5: 跑测试变绿 + 回归** — `npx vitest run src/__tests__/battle-report.test.js src/__tests__/machine-vitals.test.js src/__tests__/machine-vitals-wiring.test.js --reporter=basic` 全过
- [ ] **Step 6: commit-2**（`feat(brain): 日报新增 Harness admission 吞吐段（de6d3582 T2）`）

---

### Task 3: 版本 bump + DevGate

- [ ] `cd packages/brain && npm version patch --no-git-tag-version`（1.267.0→1.267.1，以实况为准）；root package-lock 的 packages/brain 版本、DEFINITION.md「Brain 版本」行、`.brain-versions` 追加一行（**append 禁覆盖**）四处同步
- [ ] `bash scripts/check-version-sync.sh` + `node scripts/facts-check.mjs` 全绿；`node --check packages/brain/server.js`
- [ ] commit（`chore(brain): bump 1.267.1——日报 admission 吞吐段（de6d3582 T3）`）
