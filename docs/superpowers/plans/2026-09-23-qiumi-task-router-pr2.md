# 秋米任务路由 PR2 入口刀 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 中文 GTD 任务表（人写）↔ 英文 Tasks 库 双向同步，标记行经共享入账函数落为 Brain `qiumi_task`（queued、带 Jev 将来要用的全部原始信息），状态回写两张 Notion 表，两条人工急停生效；全部逻辑可用 fetch stub 单测 + cecelia_test 真库 smoke 验证。

**Architecture:** 新模块 `src/notion-gtd-sync.js`（纯函数 + 注入 `notionReq`/`now`）负责 zh→en 建行、en→zh 反向回填、状态回写、急停；入账复用 `notion-push-sync.js` 里从 `pullNotionTasks` 抽出的 `ingestDelegatedPage`（标记行 → `qiumi_task`，非标记行行为不变）；调度挂 `scheduler-jobs` 新 job `notion-gtd-sync`，handler 只负责"确保一个 30s 自循环已启动"（不阻塞 60s 串行轮）；迁移 459 把两张 Notion 库登记进 `notion_projection_map`。PR2 **默认关闭**（`QIUMI_SYNC_ENABLED` 缺省 false），打开动作属 PR3 切换脚本。

**Tech Stack:** Node ESM（packages/brain）、vitest、Notion API 2022-06-28（`recurring-notion-sync.js` 的 `notionReq`）、Postgres（cecelia_test smoke）。

## Global Constraints

- 工作目录 `/Users/administrator/worktrees/cecelia-scan-main/qiumi-pr2-entry`（分支 `cp-0923041130-qiumi-pr2-entry`，叠在 PR1 头 `4d095c474`）。vitest 在 `packages/brain` 内跑：`cd packages/brain && npx vitest run <path> 2>&1 | tail -30`。禁止本机全量 `npm test`（低内存被杀，CI 把关）。
- TDD 两段 commit：每个 Task commit-1 只含失败测试（跑出 FAIL 并把片段写进 commit body），commit-2 实现转绿。commit 中文，末尾单独一行 `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`。`git add` 只加具体文件（禁 `-A`/`.`；`.superpowers/` 不提交）。
- 状态边界（铁律，测试钉住）：只有中文「委派/进行中/推迟/已完成」参与同步与建单；「收集/下一个行动/阻塞/淘汰」AI **永不写**、除急停两条外**永不读**；归属只看「OpenClaw任务号」非空；系统等待态回写中文侧保持「进行中」+「OpenClaw结果」写 `[等待中: <reason>]`，不占「阻塞」位。
- 三方映射表是显式对象（`src/lib/qiumi-status-map.js`），断言 `TASK_STATUSES` 15 态每个都在表里；未列出即不同步（缺项 = 测试红，不是静默）。
- 页 id 只放 payload：`payload.notion_page_id`（英文页 id，**仅信息字段**）、`payload.notion_zh_page_id`（中文页 id）。**去重豁免键是专用的 `payload.dedup_by_notion_page='true'`**（字符串 `'true'`，INSERT 时即带；458 谓词 `AND COALESCE(payload->>'dedup_by_notion_page','false') <> 'true'`）——不能拿 `notion_page_id` 当豁免键：基线 `pullNotionTasks` 的 metadata 被 spread 进 payload，生产存量排单任务早已带该键（PR1 终审 C1）。**禁止写 `tasks.notion_id`**——生产现役 canonical 投影（`projection/notion.js` → 「Cecelia Tasks」库 `3b7c40c2-…`）会用 `UPDATE tasks SET notion_id=externalId` 覆盖它。
- ssh 参数（PR2 本身不起 ssh）若需要一律 `import { SSH_BASE_ARGS } from './lib/ssh-args.js'`（PR1 修复已抽出），禁止从 `notion-push-sync.js` import。
- 入账固定字段：`requested_task_type='qiumi_task'`、`mutation_intent='none'`、`declared_domain='operations'`、`task.trigger_source='manual'`、`task.executor_kind='openclaw-agent'`、`task.status='queued'`（直落 queued，不落 blocked）、`payload.headed_manual=true`（PR3 前防 tick）、`payload.tenant_id` 由 env `NOTION_TENANT_MAP`（JSON，中文库 id → `yueshengyun`）、`payload.qiumi_source` 完整保留原始信息（标题/备注/正文全文/优先级原值/预期完成日期/执行通道/`agent_workflow_ids`+`skill_ids`+`business_task_ids`+`owner_ids` 四个 relation 的 id 列表/中文页 id/英文页 id/origin zh|en）。

  > **2026-09-23 补**：此合同为准（pr3.md 原写的 `relations{...}` 是错的，已勘误）。
  > 唯一真身：`packages/brain/src/lib/qiumi-source.js`。
- `qiumi_task` 此刀开启 `V`（router_valid）标签；`task-type-registry.test.js` 的 VALID 严格相等改为 `[...FIX, 'qiumi_task']`。
- Notion 请求经 `withBackoff`（429/5xx 指数退避 100ms×2^n，最多 4 次；其它错误不重试）。
- 中文→英文/英文→中文标记：英文 Description 前缀 `[zh:<中文页id32>]`；反向生成的中文行「备注」前缀 `[en:<英文页id32>]`，英文原生行 Description 追加 ` [en-native]`；已入账两侧都带 `brain:<task_id>`。中文「OpenClaw任务号」占位顺序：`en:<id32>` → `brain:<task_id>`。
- 并存期（旧 us-vps 脚本 `notion-qiumi-delegate.py` 仍在跑）：本刀 **默认关闭**；且只处理 `创建时间 >= QIUMI_SYNC_SINCE`（ISO，缺省 = 打开时刻）的中文行；认领即写占位，谁先写谁赢。打开 = PR3 切换脚本的一步。
- 状态回写 zh 通道每轮 ≤50 行；急停两条：中文「淘汰」→ `recordProjectionCommand(cancel_requested)`（走 `applyProjectionCommands` 状态机校验）；「阻塞」→ `blockTask(reason='owner_hold')`；从阻塞拖回「委派」→ `unblockTask`（仅当 `blocked_reason='owner_hold'`）。**偏离 spec 记录**：spec 写「阻塞→paused」，但 `paused` 只有 escalation 直写、无 API，且 `queued→paused` 不在转移表；改用 blocked+`owner_hold` 语义等价、可逆、有留痕。
- 优先级映射：中文「优先级」select 实值 `极度/高/中/低` → `P0/P1/P2/P2`（Brain 只认 P0/P1/P2）；缺省 P2。
- 库 id：中文 `c69c40c2-ba63-8271-badf-01c5410d8929`（env `NOTION_GTD_DB_ID` 覆盖）、英文 `d5bc40c2-ba63-82ef-965a-8153b7ad81a0`（复用 `notion-push-sync.js` 的 `NOTION_TASKS_DB`）。
- 守卫变异测试：映射表删一行必红；边界断言（写「收集」）必红；并存守卫（任务号非空行被认领）必红。
- 测试命令与预期输出写在每步；新增 smoke 登记 `packages/quality/smoke-allowlist.txt`（按字母序）。

---

## 前置核对（开工前逐项 ✅）

| 项 | 检查 | 状态 |
|---|---|---|
| PR1 头 | `git log --oneline -1` = `4d095c474`；`packages/brain/src/lib/task-type-registry.js` 存在且 `getTaskType('qiumi_task').surface==='openclaw-agent'` | 待勾 |
| 迁移 458 已在 cecelia_test 应用 | `psql -h localhost -p 5432 -U cecelia -d cecelia_test -Atc "select 1 from pg_constraint where conname='tasks_task_type_check' and pg_get_constraintdef(oid) like '%qiumi_task%'"` = 1；否则 `cd packages/brain && DATABASE_URL=postgresql://cecelia@localhost:5432/cecelia_test node src/migrate.js` | 待勾 |
| Notion 凭据 | `source ~/.credentials/1password.env && export OP_SERVICE_ACCOUNT_TOKEN && op item get "Notion" --vault CS --fields credential --reveal` 非空（只用于 smoke 的可选真库 dry-run，默认 stub） | 待勾 |
| 生产 legacy 门 | 记录事实：`server.js:969` 无条件调 `scheduleLegacyNotionPush`，其内部 `NOTION_LEGACY_PUSH_ENABLED!=='true'` 即 disabled；compose 未设该变量 → 视为生产未开。本刀不依赖它。 | 已核 |

---

## 文件结构

| 文件 | 职责 |
|---|---|
| `packages/brain/src/lib/qiumi-status-map.js`（新） | 三方映射表 + 中文人工态常量 + 优先级映射；纯数据 |
| `packages/brain/src/lib/notion-backoff.js`（新） | `withBackoff(fn, opts)`；纯函数 |
| `packages/brain/src/notion-gtd-sync.js`（新） | 解析中文/英文页、建行、反向回填、状态回写、急停、`runGtdSyncOnce`、`ensureGtdSyncLoop` |
| `packages/brain/src/notion-push-sync.js`（改） | 从 `pullNotionTasks` 抽出 `ingestDelegatedPage`，加标记分支；导出 `pullMarkedNotionTasks`、`NOTION_TASKS_DB` |
| `packages/brain/src/lib/task-type-registry.js`（改） | `qiumi_task` 加 `V` |
| `packages/brain/src/scheduler-jobs.js`（改） | 注册 `notion-gtd-sync` |
| `packages/brain/migrations/459_notion_gtd_inlet_registry.sql`（新） | 两库登记 `notion_projection_map` |
| `packages/brain/scripts/smoke/qiumi-entry-smoke.sh` + `scripts/smoke/qiumi-entry-smoke.mjs`（新） | cecelia_test 真库 + Notion stub 的端到端 |
| 测试 | `src/lib/__tests__/qiumi-status-map.test.js`、`src/lib/__tests__/notion-backoff.test.js`、`src/__tests__/notion-gtd-sync.test.js`、`src/__tests__/notion-push-sync-marked-ingest.test.js`、`src/__tests__/notion-gtd-sync-push-and-stops.test.js`、`src/__tests__/scheduler-jobs-gtd-sync.test.js` |

---

### Task 1: 三方状态映射表 + 边界常量（含变异）

**Files:**
- Create: `packages/brain/src/lib/qiumi-status-map.js`
- Test: `packages/brain/src/lib/__tests__/qiumi-status-map.test.js`

**Interfaces:**
- Produces:
  - `ZH_HUMAN_ONLY_STATUSES = ['收集','下一个行动','阻塞','淘汰']`（AI 永不写）
  - `ZH_SYNCABLE_STATUSES = ['委派','进行中','推迟','已完成']`
  - `ZH_PRIORITY_TO_BRAIN = { 极度:'P0', 高:'P1', 中:'P2', 低:'P2' }`、`zhPriorityToBrain(name) → 'P0'|'P1'|'P2'`
  - `QIUMI_STATUS_MAP`：`{ [brainStatus]: { zh: '进行中'|'推迟'|'已完成'|null, zhWaiting: boolean, en: 'Delegated'|'In Progress'|'Planned'|'Done'|'Cancelled'|null, clearTaskNo: boolean, complete: boolean } }`，15 个 Brain 状态全部显式列出；`zh:null` 表示不同步（`pending`/`archived`）
  - `zhWriteFor(brainStatus, { reason, resultText, today }) → { properties } | null`：把一条 Brain 状态翻成中文页 PATCH 的 properties（`null` = 不写）

- [ ] **Step 1: 写失败测试**

```js
// packages/brain/src/lib/__tests__/qiumi-status-map.test.js
import { describe, it, expect } from 'vitest';
import { TASK_STATUSES, WAITING_STATUSES, TERMINAL_STATUSES } from '../task-status-transitions.js';
import {
  QIUMI_STATUS_MAP, ZH_HUMAN_ONLY_STATUSES, ZH_SYNCABLE_STATUSES,
  zhPriorityToBrain, zhWriteFor,
} from '../qiumi-status-map.js';

describe('qiumi-status-map 三方映射表', () => {
  it('Brain 15 态每个都有显式表项（未列出即红）', () => {
    for (const s of TASK_STATUSES) {
      expect(QIUMI_STATUS_MAP, `缺 ${s}`).toHaveProperty(s);
      const row = QIUMI_STATUS_MAP[s];
      expect(['进行中', '推迟', '已完成', null]).toContain(row.zh);
      expect(['Delegated', 'In Progress', 'Planned', 'Done', 'Cancelled', null]).toContain(row.en);
    }
    expect(Object.keys(QIUMI_STATUS_MAP).sort()).toEqual([...TASK_STATUSES].sort());
  });

  it('等待态中文侧保持「进行中」且标 zhWaiting，不占人工「阻塞」位', () => {
    for (const s of ['blocked', 'paused', 'quota_exhausted', 'pending_postdeploy']) {
      expect(QIUMI_STATUS_MAP[s]).toMatchObject({ zh: '进行中', zhWaiting: true, en: 'Planned' });
    }
  });

  it('失败/取消类 → 推迟 + 清任务号；终态 → 已完成 + 勾选', () => {
    for (const s of ['cancelled', 'canceled', 'quarantined', 'dep_failed', 'failed']) {
      expect(QIUMI_STATUS_MAP[s]).toMatchObject({ zh: '推迟', clearTaskNo: true, en: 'Cancelled' });
    }
    for (const s of ['completed', 'completed_no_pr']) {
      expect(QIUMI_STATUS_MAP[s]).toMatchObject({ zh: '已完成', complete: true, en: 'Done' });
    }
    expect(QIUMI_STATUS_MAP.queued).toMatchObject({ zh: '委派', en: 'Delegated' });
    expect(QIUMI_STATUS_MAP.in_progress).toMatchObject({ zh: '进行中', en: 'In Progress' });
    expect(QIUMI_STATUS_MAP.pending.zh).toBeNull();
    expect(QIUMI_STATUS_MAP.archived.zh).toBeNull();
  });

  it('映射表绝不产出人工专属状态', () => {
    for (const row of Object.values(QIUMI_STATUS_MAP)) {
      expect(ZH_HUMAN_ONLY_STATUSES).not.toContain(row.zh);
    }
    expect(ZH_SYNCABLE_STATUSES).toEqual(['委派', '进行中', '推迟', '已完成']);
    expect(ZH_HUMAN_ONLY_STATUSES).toEqual(['收集', '下一个行动', '阻塞', '淘汰']);
  });

  it('优先级映射 极度/高/中/低 → P0/P1/P2/P2，未知→P2', () => {
    expect(zhPriorityToBrain('极度')).toBe('P0');
    expect(zhPriorityToBrain('高')).toBe('P1');
    expect(zhPriorityToBrain('中')).toBe('P2');
    expect(zhPriorityToBrain('低')).toBe('P2');
    expect(zhPriorityToBrain(undefined)).toBe('P2');
  });

  it('zhWriteFor：等待态写 [等待中:reason]；失败态清任务号；完成写勾选+日期；pending 不写', () => {
    const w = zhWriteFor('blocked', { reason: 'quota', resultText: '', today: '2026-09-23' });
    expect(w.properties['状态'].status.name).toBe('进行中');
    expect(w.properties['OpenClaw结果'].rich_text[0].text.content).toBe('[等待中: quota]');
    const f = zhWriteFor('failed', { reason: 'ssh_down', resultText: 'x', today: '2026-09-23' });
    expect(f.properties['状态'].status.name).toBe('推迟');
    expect(f.properties['OpenClaw任务号'].rich_text).toEqual([]);
    const c = zhWriteFor('completed_no_pr', { resultText: 'ok', today: '2026-09-23' });
    expect(c.properties['状态'].status.name).toBe('已完成');
    expect(c.properties['已完成'].checkbox).toBe(true);
    expect(c.properties['完成日期'].date.start).toBe('2026-09-23');
    expect(zhWriteFor('pending', { today: '2026-09-23' })).toBeNull();
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd packages/brain && npx vitest run src/lib/__tests__/qiumi-status-map.test.js 2>&1 | tail -20`
Expected: FAIL，`Failed to resolve import "../qiumi-status-map.js"`。

- [ ] **Step 3: commit-1**

```bash
git add packages/brain/src/lib/__tests__/qiumi-status-map.test.js
git commit -m "test(brain): 秋米三方状态映射表断言（15 态显式、人工态永不产出）——先红

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

- [ ] **Step 4: 写实现**

```js
// packages/brain/src/lib/qiumi-status-map.js
/**
 * 秋米中文 GTD 表 ↔ Brain ↔ 英文 Tasks 库 三方状态映射（决策 b8abd28c）。
 * 唯一真身：改状态语义只改这里。缺项 = qiumi-status-map.test.js 报红，不允许静默不同步。
 *
 * 铁律：
 *  - 中文「收集/下一个行动/阻塞/淘汰」是人工专属态，AI 永不写（本表 zh 列绝不出现它们）；
 *  - 系统等待态（blocked/paused/quota_exhausted/pending_postdeploy）中文侧保持「进行中」，
 *    原因写进「OpenClaw结果」，不占人工「阻塞」位；
 *  - 失败/取消 → 「推迟」+ 清「OpenClaw任务号」（人把状态拖回「委派」= 重试，沿用旧脚本约定）。
 */
import { TASK_STATUSES } from './task-status-transitions.js';

export const ZH_HUMAN_ONLY_STATUSES = Object.freeze(['收集', '下一个行动', '阻塞', '淘汰']);
export const ZH_SYNCABLE_STATUSES = Object.freeze(['委派', '进行中', '推迟', '已完成']);

export const ZH_PRIORITY_TO_BRAIN = Object.freeze({ '极度': 'P0', '高': 'P1', '中': 'P2', '低': 'P2' });
export function zhPriorityToBrain(name) {
  return ZH_PRIORITY_TO_BRAIN[name] ?? 'P2';
}

const row = (zh, en, extra = {}) => Object.freeze({
  zh, en, zhWaiting: false, clearTaskNo: false, complete: false, ...extra,
});
const WAIT = row('进行中', 'Planned', { zhWaiting: true });
const FAIL = row('推迟', 'Cancelled', { clearTaskNo: true });
const DONE = row('已完成', 'Done', { complete: true });

export const QIUMI_STATUS_MAP = Object.freeze({
  pending: row(null, null),
  queued: row('委派', 'Delegated'),
  in_progress: row('进行中', 'In Progress'),
  blocked: WAIT,
  quota_exhausted: WAIT,
  paused: WAIT,
  pending_postdeploy: WAIT,
  quarantined: FAIL,
  dep_failed: FAIL,
  canceled: FAIL,
  cancelled: FAIL,
  failed: FAIL,
  completed: DONE,
  completed_no_pr: DONE,
  archived: row(null, null),
});

// 装载即自检：TASK_STATUSES 与表项一一对应（守卫测试之外的第二道保险）
for (const s of TASK_STATUSES) {
  if (!(s in QIUMI_STATUS_MAP)) throw new Error(`qiumi-status-map 缺 Brain 状态 ${s}`);
}

const text = (content) => [{ type: 'text', text: { content: String(content ?? '').slice(0, 1900) } }];

/**
 * 一条 Brain 状态 → 中文页 PATCH properties；zh 为 null 返回 null（不写）。
 * @param {string} brainStatus
 * @param {{reason?:string, resultText?:string, today:string}} ctx today = YYYY-MM-DD（业务日）
 */
export function zhWriteFor(brainStatus, { reason = '', resultText = '', today } = {}) {
  const m = QIUMI_STATUS_MAP[brainStatus];
  if (!m || !m.zh) return null;
  const properties = { '状态': { status: { name: m.zh } } };
  if (m.zhWaiting) {
    properties['OpenClaw结果'] = { rich_text: text(`[等待中: ${reason || brainStatus}]`) };
  } else if (m.clearTaskNo) {
    properties['OpenClaw结果'] = { rich_text: text(`[执行失败: ${reason || brainStatus}] ${resultText}`.trim()) };
    properties['OpenClaw任务号'] = { rich_text: [] };
    properties['已完成'] = { checkbox: false };
  } else if (m.complete) {
    properties['OpenClaw结果'] = { rich_text: text(resultText || '已完成') };
    properties['已完成'] = { checkbox: true };
    properties['完成日期'] = { date: { start: today } };
  }
  return { properties };
}
```

- [ ] **Step 5: 跑测试转绿**

Run: `cd packages/brain && npx vitest run src/lib/__tests__/qiumi-status-map.test.js 2>&1 | tail -20`
Expected: `6 passed`。

- [ ] **Step 6: 变异验证**（临时删除 `QIUMI_STATUS_MAP.quarantined` 一行 → 跑测试必红 `缺 quarantined`（装载即抛）；还原后绿。把红/绿输出片段写进 commit body）

- [ ] **Step 7: commit-2**

```bash
git add packages/brain/src/lib/qiumi-status-map.js
git commit -m "feat(brain): 秋米三方状态映射表——15 态显式、等待态不占人工阻塞位、失败清任务号

变异：删 quarantined 行 → 装载抛 '缺 quarantined'，测试红；还原绿。

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 2: `withBackoff`（429/5xx 指数退避）

**Files:**
- Create: `packages/brain/src/lib/notion-backoff.js`
- Test: `packages/brain/src/lib/__tests__/notion-backoff.test.js`

**Interfaces:**
- Produces: `withBackoff(fn, { attempts = 4, baseMs = 100, sleep = (ms)=>new Promise(r=>setTimeout(r,ms)), isRetryable = defaultIsRetryable }) → Promise<T>`；`defaultIsRetryable(err)`：`err.status === 429 || (err.status >= 500 && err.status < 600)`。`notionReq` 抛的错带 `err.status`（见 `recurring-notion-sync.js:40`）。

- [ ] **Step 1: 写失败测试**

```js
// packages/brain/src/lib/__tests__/notion-backoff.test.js
import { describe, it, expect, vi } from 'vitest';
import { withBackoff, defaultIsRetryable } from '../notion-backoff.js';

const httpErr = (status) => Object.assign(new Error(`Notion → ${status}`), { status });

describe('withBackoff', () => {
  it('429 → 指数退避 100/200/400 后第 4 次成功', async () => {
    const sleeps = [];
    const fn = vi.fn()
      .mockRejectedValueOnce(httpErr(429)).mockRejectedValueOnce(httpErr(503))
      .mockRejectedValueOnce(httpErr(500)).mockResolvedValueOnce({ ok: 1 });
    const out = await withBackoff(fn, { sleep: async (ms) => { sleeps.push(ms); } });
    expect(out).toEqual({ ok: 1 });
    expect(fn).toHaveBeenCalledTimes(4);
    expect(sleeps).toEqual([100, 200, 400]);
  });
  it('4 次仍 429 → 抛最后一次错误', async () => {
    const fn = vi.fn().mockRejectedValue(httpErr(429));
    await expect(withBackoff(fn, { sleep: async () => {} })).rejects.toMatchObject({ status: 429 });
    expect(fn).toHaveBeenCalledTimes(4);
  });
  it('400/404 不重试', async () => {
    const fn = vi.fn().mockRejectedValue(httpErr(404));
    await expect(withBackoff(fn, { sleep: async () => {} })).rejects.toMatchObject({ status: 404 });
    expect(fn).toHaveBeenCalledTimes(1);
  });
  it('网络错误（无 status）不重试', async () => {
    const fn = vi.fn().mockRejectedValue(new Error('ECONNRESET'));
    await expect(withBackoff(fn, { sleep: async () => {} })).rejects.toThrow('ECONNRESET');
    expect(fn).toHaveBeenCalledTimes(1);
    expect(defaultIsRetryable(new Error('x'))).toBe(false);
  });
});
```

- [ ] **Step 2: 跑测试确认失败** — Run: `cd packages/brain && npx vitest run src/lib/__tests__/notion-backoff.test.js 2>&1 | tail -15`；Expected: FAIL（模块不存在）。
- [ ] **Step 3: commit-1** — `git add packages/brain/src/lib/__tests__/notion-backoff.test.js && git commit -m "test(brain): withBackoff 429/5xx 指数退避断言——先红

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"`

- [ ] **Step 4: 写实现**

```js
// packages/brain/src/lib/notion-backoff.js
/** Notion API 退避：只对 429 与 5xx 重试（幂等 GET/PATCH/POST 建页由调用方保证幂等键）。 */
export function defaultIsRetryable(err) {
  const s = Number(err?.status);
  return s === 429 || (s >= 500 && s < 600);
}

export async function withBackoff(fn, {
  attempts = 4,
  baseMs = 100,
  sleep = (ms) => new Promise((r) => setTimeout(r, ms)),
  isRetryable = defaultIsRetryable,
} = {}) {
  let lastErr;
  for (let i = 0; i < attempts; i += 1) {
    try {
      return await fn(i);
    } catch (err) {
      lastErr = err;
      if (!isRetryable(err) || i === attempts - 1) throw err;
      await sleep(baseMs * 2 ** i);
    }
  }
  throw lastErr;
}
```

- [ ] **Step 5: 跑测试转绿** — Expected: `4 passed`。
- [ ] **Step 6: commit-2** — `git add packages/brain/src/lib/notion-backoff.js && git commit -m "feat(brain): withBackoff——429/5xx 指数退避 4 次，其它错误不重试

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"`

---

### Task 3: `notion-gtd-sync.js` 解析与建行（zh→en、en→zh）

**Files:**
- Create: `packages/brain/src/notion-gtd-sync.js`
- Test: `packages/brain/src/__tests__/notion-gtd-sync.test.js`

**Interfaces:**
- Consumes: `notionReq(token, path, method, body)`（注入）、`withBackoff`、`zhPriorityToBrain`、`NOTION_TASKS_DB`（Task 4 从 `notion-push-sync.js` 导出；本 Task 内先用常量 `EN_TASKS_DB` 同值，Task 4 改为 import）
- Produces:
  - `GTD_DB_ID`（env `NOTION_GTD_DB_ID` 缺省 `c69c40c2-ba63-8271-badf-01c5410d8929`）、`EN_TASKS_DB = 'd5bc40c2-ba63-82ef-965a-8153b7ad81a0'`
  - `id32(id)`、`ZH_MARK_RE = /\[zh:([0-9a-f]{32})\]/`、`EN_MARK_RE = /\[en:([0-9a-f]{32})\]/`、`EN_NATIVE_MARK = '[en-native]'`、`BRAIN_MARK_RE = /brain:([0-9a-f-]{36})/`
  - `parseZhPage(page) → { id, id32, title, remark, status, taskNo, priorityRaw, priority, dueAt, channel, agentWorkflowIds, skillIds, businessTaskIds, ownerIds, archived, createdAt }`
  - `parseEnPage(page) → { id, id32, name, description, status, planDate, zhId32|null, enNative, brainTaskId|null }`
  - `buildEnPageFromZh(zh, pageContent) → { parent, properties }`
  - `buildZhPageFromEn(en, pageContent) → { parent, properties }`
  - `syncZhToEn(pool, token, deps) → { created: n, skipped: n }`；`syncEnToZh(pool, token, deps) → { created, skipped }`；`deps = { notionReq, fetchPageContent, now, sinceIso }`

- [ ] **Step 1: 写失败测试**

```js
// packages/brain/src/__tests__/notion-gtd-sync.test.js
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockNotionReq = vi.fn();
vi.mock('../recurring-notion-sync.js', () => ({ notionReq: mockNotionReq, getToken: () => 'tok' }));

const zhPage = (over = {}) => ({
  id: '11111111-2222-3333-4444-555555555555',
  created_time: '2026-09-23T00:10:00.000Z',
  last_edited_time: '2026-09-23T00:11:00.000Z',
  properties: {
    '名称': { title: [{ plain_text: '用 Claude Code 把首页按钮改蓝' }] },
    '备注': { rich_text: [{ plain_text: 'opc_department=dev' }] },
    '状态': { status: { name: '委派' } },
    'OpenClaw任务号': { rich_text: [] },
    '优先级': { select: { name: '高' } },
    '预期完成日期': { date: { start: '2026-09-24T09:00:00.000+08:00' } },
    '执行通道': { select: null },
    '执行 Agent / Workflow': { relation: [{ id: 'wf-1' }] },
    '使用 Skill': { relation: [] },
    'AI 业务任务': { relation: [] },
    '负责人': { people: [{ id: 'u-1' }] },
    '归档': { checkbox: false },
    '创建时间': { created_time: '2026-09-23T00:10:00.000Z' },
    ...over,
  },
});
const enPage = (over = {}) => ({
  id: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
  last_edited_time: '2026-09-23T00:12:00.000Z',
  properties: {
    Name: { title: [{ plain_text: '[P1] 英文原生任务' }] },
    Description: { rich_text: [{ plain_text: '' }] },
    Status: { status: { name: 'Delegated' } },
    'Plan Date': { date: null },
    ...over,
  },
});

describe('notion-gtd-sync 解析', () => {
  it('parseZhPage 提取全部原始信息（优先级映射、relation id、归属）', async () => {
    const { parseZhPage } = await import('../notion-gtd-sync.js');
    const z = parseZhPage(zhPage());
    expect(z).toMatchObject({
      id32: '11111111222233334444555555555555', title: '用 Claude Code 把首页按钮改蓝',
      remark: 'opc_department=dev', status: '委派', taskNo: '', priorityRaw: '高', priority: 'P1',
      dueAt: '2026-09-24T09:00:00.000+08:00', channel: null, agentWorkflowIds: ['wf-1'],
      skillIds: [], businessTaskIds: [], ownerIds: ['u-1'], archived: false,
    });
  });
  it('parseEnPage 识别 [zh:]/[en-native]/brain: 标记', async () => {
    const { parseEnPage } = await import('../notion-gtd-sync.js');
    const e = parseEnPage(enPage({ Description: { rich_text: [{ plain_text: '[zh:11111111222233334444555555555555] opc_department=dev · brain:15f42776-8d1b-430d-b27a-38a480b93151' }] } }));
    expect(e.zhId32).toBe('11111111222233334444555555555555');
    expect(e.brainTaskId).toBe('15f42776-8d1b-430d-b27a-38a480b93151');
    expect(e.enNative).toBe(false);
    expect(parseEnPage(enPage({ Description: { rich_text: [{ plain_text: 'x [en-native]' }] } })).enNative).toBe(true);
  });
  it('buildEnPageFromZh：Name 带 [Pn]、Description 以 [zh:<id32>] 开头、Plan Date 带日期', async () => {
    const { parseZhPage, buildEnPageFromZh, EN_TASKS_DB } = await import('../notion-gtd-sync.js');
    const body = buildEnPageFromZh(parseZhPage(zhPage()), '正文第一行\n正文第二行');
    expect(body.parent).toEqual({ database_id: EN_TASKS_DB });
    expect(body.properties.Name.title[0].text.content).toBe('[P1] 用 Claude Code 把首页按钮改蓝');
    expect(body.properties.Description.rich_text[0].text.content.startsWith('[zh:11111111222233334444555555555555] ')).toBe(true);
    expect(body.properties.Status.status.name).toBe('Delegated');
    expect(body.properties['Plan Date'].date.start).toBe('2026-09-24T09:00:00.000+08:00');
  });
});

describe('syncZhToEn', () => {
  beforeEach(() => mockNotionReq.mockReset());
  it('委派+任务号空 → 建英文行并写回 en:<id32> 占位；任务号非空/归档/早于 since 的行跳过', async () => {
    const { syncZhToEn } = await import('../notion-gtd-sync.js');
    mockNotionReq
      .mockResolvedValueOnce({ results: [
        zhPage(),
        zhPage({ 'OpenClaw任务号': { rich_text: [{ plain_text: 'dept-x' }] } }),
        zhPage({ '归档': { checkbox: true } }),
      ] })                                            // query zh
      .mockResolvedValueOnce({ id: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee' }) // POST en page
      .mockResolvedValueOnce({});                     // PATCH zh 占位
    const r = await syncZhToEn({ query: vi.fn() }, 'tok', {
      notionReq: mockNotionReq, fetchPageContent: async () => '正文', now: () => new Date('2026-09-23T00:20:00Z'),
      sinceIso: '2026-09-23T00:00:00.000Z',
    });
    expect(r).toEqual({ created: 1, skipped: 2 });
    const queryBody = mockNotionReq.mock.calls[0][3];
    expect(queryBody.filter.and).toEqual(expect.arrayContaining([
      { property: '状态', status: { equals: '委派' } },
      { property: 'OpenClaw任务号', rich_text: { is_empty: true } },
      { property: '归档', checkbox: { equals: false } },
      { timestamp: 'created_time', created_time: { on_or_after: '2026-09-23T00:00:00.000Z' } },
    ]));
    const post = mockNotionReq.mock.calls[1];
    expect(post[1]).toBe('/pages'); expect(post[2]).toBe('POST');
    const patch = mockNotionReq.mock.calls[2];
    expect(patch[1]).toBe('/pages/11111111-2222-3333-4444-555555555555');
    expect(patch[3].properties['OpenClaw任务号'].rich_text[0].text.content).toBe('en:aaaaaaaabbbbccccddddeeeeeeeeeeee');
    expect(patch[3].properties['状态']).toBeUndefined(); // 状态只能由入账/回写改，建行不改
  });
  it('绝不查询/写入人工专属状态（变异守卫）', async () => {
    const { ZH_QUERY_FILTER } = await import('../notion-gtd-sync.js');
    expect(JSON.stringify(ZH_QUERY_FILTER)).not.toMatch(/收集|下一个行动|阻塞|淘汰/);
  });
});

describe('syncEnToZh（反向回填）', () => {
  beforeEach(() => mockNotionReq.mockReset());
  it('英文原生 Delegated 行 → 建中文行（备注 [en:<id32>]、状态委派、任务号 en:占位）+ 英文行追加 [en-native]', async () => {
    const { syncEnToZh } = await import('../notion-gtd-sync.js');
    mockNotionReq
      .mockResolvedValueOnce({ results: [
        enPage(),
        enPage({ Description: { rich_text: [{ plain_text: '[zh:11111111222233334444555555555555]' }] } }),
        enPage({ Description: { rich_text: [{ plain_text: 'y [en-native]' }] } }),
      ] })
      .mockResolvedValueOnce({ id: '99999999-8888-7777-6666-555555555555' }) // POST zh
      .mockResolvedValueOnce({});                                              // PATCH en
    const r = await syncEnToZh({ query: vi.fn() }, 'tok', { notionReq: mockNotionReq, fetchPageContent: async () => '', now: () => new Date() });
    expect(r).toEqual({ created: 1, skipped: 2 });
    const post = mockNotionReq.mock.calls[1][3];
    expect(post.properties['名称'].title[0].text.content).toBe('英文原生任务');
    expect(post.properties['备注'].rich_text[0].text.content.startsWith('[en:aaaaaaaabbbbccccddddeeeeeeeeeeee]')).toBe(true);
    expect(post.properties['状态'].status.name).toBe('委派');
    expect(post.properties['OpenClaw任务号'].rich_text[0].text.content).toBe('en:aaaaaaaabbbbccccddddeeeeeeeeeeee');
    const patch = mockNotionReq.mock.calls[2][3];
    expect(patch.properties.Description.rich_text[0].text.content).toMatch(/\[en-native\]$/);
  });
});
```

- [ ] **Step 2: 跑测试确认失败** — Run: `cd packages/brain && npx vitest run src/__tests__/notion-gtd-sync.test.js 2>&1 | tail -15`；Expected: FAIL（模块不存在）。
- [ ] **Step 3: commit-1** — `git add packages/brain/src/__tests__/notion-gtd-sync.test.js && git commit -m "test(brain): notion-gtd-sync 解析/建行/反向回填断言——先红

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"`

- [ ] **Step 4: 写实现**

```js
// packages/brain/src/notion-gtd-sync.js
/**
 * notion-gtd-sync.js — 秋米中文 GTD 表 ↔ 英文 Tasks 库 双向同步（决策 b8abd28c，PR2 入口刀）
 *
 * 人从 Notion 进、机器从 Brain 进、Notion 永远是投影。
 *  - zh→en：中文「委派 ∧ 任务号空 ∧ 未归档 ∧ 创建时间≥since」→ 英文库建行（Description 前缀 [zh:<id32>]）
 *           → 中文任务号写 en:<id32> 占位（谁先写谁赢，与旧 us-vps 脚本并存期互斥）
 *  - en→zh：英文原生 Delegated（无 [zh:]、无 brain:、无 [en-native]）→ 中文表建行（备注 [en:<id32>]，任务号 en:占位）
 *  - 入账（Task 4）：notion-push-sync.ingestDelegatedPage 认标记 → Brain qiumi_task
 *  - 回写/急停（Task 5）：pushQiumiStatus / applyOwnerStops
 * 铁律：中文「收集/下一个行动/阻塞/淘汰」永不写、除急停外永不读（ZH_QUERY_FILTER 只含 委派）。
 * 页 id 只放 payload，不碰 tasks.notion_id（canonical 投影 projection/notion.js 会覆盖它）。
 */
import { notionReq as defaultNotionReq } from './recurring-notion-sync.js';
import { withBackoff } from './lib/notion-backoff.js';
import { zhPriorityToBrain } from './lib/qiumi-status-map.js';

export const GTD_DB_ID = process.env.NOTION_GTD_DB_ID || 'c69c40c2-ba63-8271-badf-01c5410d8929';
export const EN_TASKS_DB = 'd5bc40c2-ba63-82ef-965a-8153b7ad81a0';

export const ZH_MARK_RE = /\[zh:([0-9a-f]{32})\]/;
export const EN_MARK_RE = /\[en:([0-9a-f]{32})\]/;
export const EN_NATIVE_MARK = '[en-native]';
export const BRAIN_MARK_RE = /brain:([0-9a-f-]{36})/;

export const id32 = (id) => String(id || '').replace(/-/g, '').toLowerCase();
const text = (content) => [{ type: 'text', text: { content: String(content ?? '').slice(0, 1900) } }];
const plain = (arr) => (arr ?? []).map((t) => t.plain_text ?? t.text?.content ?? '').join('').trim();
const rel = (p) => (p?.relation ?? []).map((r) => r.id);

/** 只查「委派」——四个人工态从不进这个 filter（变异守卫钉住） */
export const ZH_QUERY_FILTER = Object.freeze({
  and: [
    { property: '状态', status: { equals: '委派' } },
    { property: 'OpenClaw任务号', rich_text: { is_empty: true } },
    { property: '归档', checkbox: { equals: false } },
  ],
});

export function parseZhPage(page) {
  const p = page?.properties ?? {};
  return {
    id: page.id,
    id32: id32(page.id),
    title: plain(p['名称']?.title),
    remark: plain(p['备注']?.rich_text),
    status: p['状态']?.status?.name ?? null,
    taskNo: plain(p['OpenClaw任务号']?.rich_text),
    priorityRaw: p['优先级']?.select?.name ?? null,
    priority: zhPriorityToBrain(p['优先级']?.select?.name),
    dueAt: p['预期完成日期']?.date?.start ?? null,
    channel: p['执行通道']?.select?.name ?? null,
    agentWorkflowIds: rel(p['执行 Agent / Workflow']),
    skillIds: rel(p['使用 Skill']),
    businessTaskIds: rel(p['AI 业务任务']),
    ownerIds: (p['负责人']?.people ?? []).map((u) => u.id),
    archived: p['归档']?.checkbox === true,
    createdAt: p['创建时间']?.created_time ?? page.created_time ?? null,
    lastEditedTime: page.last_edited_time ?? null,
  };
}

export function parseEnPage(page) {
  const p = page?.properties ?? {};
  const description = plain(p.Description?.rich_text);
  return {
    id: page.id,
    id32: id32(page.id),
    name: plain(p.Name?.title),
    description,
    status: p.Status?.status?.name ?? null,
    planDate: p['Plan Date']?.date?.start ?? null,
    zhId32: description.match(ZH_MARK_RE)?.[1] ?? null,
    enNative: description.includes(EN_NATIVE_MARK),
    brainTaskId: description.match(BRAIN_MARK_RE)?.[1] ?? null,
    lastEditedTime: page.last_edited_time ?? null,
  };
}

export function buildEnPageFromZh(zh, pageContent = '') {
  const desc = [`[zh:${zh.id32}]`, zh.remark, pageContent].filter(Boolean).join(' ');
  const properties = {
    Name: { title: text(`[${zh.priority}] ${zh.title}`) },
    Description: { rich_text: text(desc) },
    Status: { status: { name: 'Delegated' } },
  };
  if (zh.dueAt) properties['Plan Date'] = { date: { start: zh.dueAt } };
  return { parent: { database_id: EN_TASKS_DB }, properties };
}

export function buildZhPageFromEn(en, pageContent = '') {
  const title = en.name.replace(/^\[P[0-3]\]\s*/, '');
  const remark = [`[en:${en.id32}]`, en.description, pageContent].filter(Boolean).join(' ');
  const properties = {
    '名称': { title: text(title) },
    '备注': { rich_text: text(remark) },
    '状态': { status: { name: '委派' } },
    'OpenClaw任务号': { rich_text: text(`en:${en.id32}`) },
  };
  if (en.planDate) properties['预期完成日期'] = { date: { start: en.planDate } };
  return { parent: { database_id: GTD_DB_ID }, properties };
}

async function queryAll(notionReq, token, dbId, filter, sorts) {
  const results = [];
  let cursor = null;
  do {
    const body = { filter, page_size: 50 };
    if (sorts) body.sorts = sorts;
    if (cursor) body.start_cursor = cursor;
    const resp = await withBackoff(() => notionReq(token, `/databases/${dbId}/query`, 'POST', body));
    results.push(...(resp?.results ?? []));
    cursor = resp?.has_more ? resp.next_cursor : null;
  } while (cursor);
  return results;
}

export async function syncZhToEn(pool, token, {
  notionReq = defaultNotionReq, fetchPageContent, now = () => new Date(), sinceIso = null,
} = {}) {
  const filter = { and: [...ZH_QUERY_FILTER.and] };
  if (sinceIso) filter.and.push({ timestamp: 'created_time', created_time: { on_or_after: sinceIso } });
  const pages = await queryAll(notionReq, token, GTD_DB_ID, filter);
  let created = 0; let skipped = 0;
  for (const page of pages) {
    const zh = parseZhPage(page);
    // 二次校验：filter 与真值不一致时以真值为准（并存期旧脚本可能刚写了任务号）
    if (zh.status !== '委派' || zh.taskNo || zh.archived || !zh.title
      || (sinceIso && zh.createdAt && zh.createdAt < sinceIso)) { skipped += 1; continue; }
    const content = fetchPageContent ? await fetchPageContent(token, zh.id) : '';
    const enPage = await withBackoff(() => notionReq(token, '/pages', 'POST', buildEnPageFromZh(zh, content)));
    await withBackoff(() => notionReq(token, `/pages/${zh.id}`, 'PATCH', {
      properties: { 'OpenClaw任务号': { rich_text: text(`en:${id32(enPage.id)}`) } },
    }));
    created += 1;
    void now;
  }
  return { created, skipped };
}

export async function syncEnToZh(pool, token, {
  notionReq = defaultNotionReq, fetchPageContent, now = () => new Date(),
} = {}) {
  const pages = await queryAll(notionReq, token, EN_TASKS_DB, {
    property: 'Status', status: { equals: 'Delegated' },
  });
  let created = 0; let skipped = 0;
  for (const page of pages) {
    const en = parseEnPage(page);
    if (en.zhId32 || en.enNative || en.brainTaskId || !en.name) { skipped += 1; continue; }
    const content = fetchPageContent ? await fetchPageContent(token, en.id) : '';
    await withBackoff(() => notionReq(token, '/pages', 'POST', buildZhPageFromEn(en, content)));
    await withBackoff(() => notionReq(token, `/pages/${en.id}`, 'PATCH', {
      properties: { Description: { rich_text: text(`${en.description} ${EN_NATIVE_MARK}`.trim()) } },
    }));
    created += 1;
    void now;
  }
  return { created, skipped };
}
```

- [ ] **Step 5: 跑测试转绿** — Expected: `7 passed`。
- [ ] **Step 6: 变异验证** — 临时把 `ZH_QUERY_FILTER` 的 `'委派'` 改成 `'收集'` → "绝不查询人工态" 测试必红；还原绿。写进 commit body。
- [ ] **Step 7: commit-2** — `git add packages/brain/src/notion-gtd-sync.js && git commit -m "feat(brain): notion-gtd-sync——中文GTD↔英文Tasks 解析/建行/反向回填，只查委派、页id进payload

变异：ZH_QUERY_FILTER 委派→收集，守卫红；还原绿。

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"`

---

### Task 4: `pullNotionTasks` 抽出 `ingestDelegatedPage` + 标记行入账为 `qiumi_task` + 开启 V 标签

**Files:**
- Modify: `packages/brain/src/notion-push-sync.js`（`pullNotionTasks` 340-436 行；新增导出 `ingestDelegatedPage`、`pullMarkedNotionTasks`、`NOTION_TASKS_DB`）
- Modify: `packages/brain/src/lib/task-type-registry.js`（第 169 行 `qiumi_task` 条目 tags `[]` → `[V]`，注释改为"PR2 入口刀已开启"）
- Modify: `packages/brain/src/lib/__tests__/task-type-registry.test.js`（406-421、428-435 行的 VALID 断言）
- Test: `packages/brain/src/__tests__/notion-push-sync-marked-ingest.test.js`（新）

**Interfaces:**
- Consumes: Task 3 的 `parseEnPage`、`parseZhPage`、`GTD_DB_ID`；`createRoutedTask(pool, request)`（`work-routing-store.js:154`，`request.metadata` 与 `task.payload` 合并进 `payload`，见 212-229 行）
- Produces:
  - `ingestDelegatedPage(pool, token, page, opts) → { taskId, kind: 'qiumi_task'|'dev'|'openclaw'|'skipped' }`
  - `pullMarkedNotionTasks(pool, token, opts) → { ingested, skipped }`：只查 `Status=Delegated ∧ Description contains "[zh:"` 或 `contains "[en-native]"`
  - `pullNotionTasks` 行为：标记行走 qiumi 分支（即使 legacy 链打开也一致、幂等）；非标记行**逐字不变**
  - 入账后：中文页 `OpenClaw任务号=brain:<id>`、`状态=进行中`；英文页 Description 追加 ` · brain:<id> ✓已接管`（沿用 `writeStatusReceipt` 尾巴规则）；Brain 任务 `UPDATE tasks SET due_at=$2 WHERE id=$1`（有预期完成日期时）

- [ ] **Step 1: 写失败测试**

```js
// packages/brain/src/__tests__/notion-push-sync-marked-ingest.test.js
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockQuery = vi.fn();
const mockNotionReq = vi.fn();
const mockCreateRoutedTask = vi.fn();
vi.mock('../db.js', () => ({ default: { query: mockQuery } }));
vi.mock('../recurring-notion-sync.js', () => ({ notionReq: mockNotionReq, getToken: () => 'tok' }));
vi.mock('../work-routing-store.js', () => ({ createRoutedTask: mockCreateRoutedTask }));

const ZH32 = '11111111222233334444555555555555';
const enPage = (desc) => ({
  id: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee', last_edited_time: '2026-09-23T00:12:00.000Z',
  properties: {
    Name: { title: [{ plain_text: '[P1] 用 Claude Code 把首页按钮改蓝' }] },
    Description: { rich_text: [{ plain_text: desc }] },
    Status: { status: { name: 'Delegated' } },
    'Plan Date': { date: { start: '2026-09-24T09:00:00.000+08:00' } },
  },
});
const zhPage = {
  id: '11111111-2222-3333-4444-555555555555', created_time: '2026-09-23T00:10:00.000Z',
  properties: {
    '名称': { title: [{ plain_text: '用 Claude Code 把首页按钮改蓝' }] },
    '备注': { rich_text: [{ plain_text: 'opc_department=dev' }] },
    '状态': { status: { name: '委派' } },
    'OpenClaw任务号': { rich_text: [{ plain_text: 'en:aaaaaaaabbbbccccddddeeeeeeeeeeee' }] },
    '优先级': { select: { name: '高' } },
    '预期完成日期': { date: { start: '2026-09-24T09:00:00.000+08:00' } },
    '执行通道': { select: null },
    '执行 Agent / Workflow': { relation: [{ id: 'wf-1' }] }, '使用 Skill': { relation: [] }, 'AI 业务任务': { relation: [] },
    '负责人': { people: [{ id: 'u-1' }] }, '归档': { checkbox: false },
  },
};

describe('ingestDelegatedPage：[zh:] 标记行 → qiumi_task', () => {
  beforeEach(() => { mockQuery.mockReset(); mockNotionReq.mockReset(); mockCreateRoutedTask.mockReset(); });

  it('createRoutedTask 参数：qiumi_task/none/operations/manual/openclaw-agent/queued，payload 带页id与完整原始信息，不写 notion_id', async () => {
    mockNotionReq
      .mockResolvedValueOnce({ results: [{ type: 'paragraph', paragraph: { rich_text: [{ plain_text: '正文' }] } }] }) // en 正文
      .mockResolvedValueOnce(zhPage)   // GET zh page
      .mockResolvedValueOnce({ results: [{ type: 'paragraph', paragraph: { rich_text: [{ plain_text: '中文正文' }] } }] }) // zh 正文
      .mockResolvedValue({});          // PATCH zh / PATCH en
    mockCreateRoutedTask.mockResolvedValue({ task: { id: '15f42776-8d1b-430d-b27a-38a480b93151' } });
    mockQuery.mockResolvedValue({ rows: [] });
    const { ingestDelegatedPage } = await import('../notion-push-sync.js');
    const r = await ingestDelegatedPage({ query: mockQuery }, 'tok', enPage(`[zh:${ZH32}] opc_department=dev`), {
      env: { NOTION_TENANT_MAP: JSON.stringify({ 'c69c40c2-ba63-8271-badf-01c5410d8929': 'yueshengyun' }) },
    });
    expect(r).toEqual({ taskId: '15f42776-8d1b-430d-b27a-38a480b93151', kind: 'qiumi_task' });
    const req = mockCreateRoutedTask.mock.calls[0][1];
    expect(req).toMatchObject({
      source: 'inbox', source_id: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
      requested_task_type: 'qiumi_task', mutation_intent: 'none', declared_domain: 'operations',
      task: { priority: 'P1', status: 'queued', trigger_source: 'manual', executor_kind: 'openclaw-agent' },
    });
    expect(req.metadata).toMatchObject({
      source: 'notion_gtd', origin: 'zh',
      notion_page_id: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
      notion_zh_page_id: '11111111-2222-3333-4444-555555555555',
      dedup_by_notion_page: 'true', // 458 去重豁免键（字符串 'true'，INSERT 即带）
      tenant_id: 'yueshengyun', headed_manual: true,
      qiumi_source: {
        title: '用 Claude Code 把首页按钮改蓝', remark: 'opc_department=dev', body: '中文正文',
        priority_raw: '高', due_at: '2026-09-24T09:00:00.000+08:00', channel: null,
        agent_workflow_ids: ['wf-1'], skill_ids: [], business_task_ids: [], owner_ids: ['u-1'],
      },
    });
    expect(req).not.toHaveProperty('repo_hint');
    expect(req).not.toHaveProperty('declared_change_kind');
    // due_at 落库；绝不 UPDATE notion_id
    const sqls = mockQuery.mock.calls.map((c) => c[0]);
    expect(sqls.some((s) => /UPDATE tasks SET due_at/.test(s))).toBe(true);
    expect(sqls.some((s) => /notion_id\s*=/.test(s))).toBe(false);
    // 中文页：任务号 brain:<id> + 状态进行中；英文页：Description 追加 brain:
    const zhPatch = mockNotionReq.mock.calls.find((c) => c[1] === '/pages/11111111-2222-3333-4444-555555555555' && c[2] === 'PATCH')[3];
    expect(zhPatch.properties['OpenClaw任务号'].rich_text[0].text.content).toBe('brain:15f42776-8d1b-430d-b27a-38a480b93151');
    expect(zhPatch.properties['状态'].status.name).toBe('进行中');
    const enPatch = mockNotionReq.mock.calls.find((c) => c[1] === '/pages/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee' && c[2] === 'PATCH')[3];
    expect(enPatch.properties.Description.rich_text[0].text.content).toMatch(/brain:15f42776-8d1b-430d-b27a-38a480b93151 ✓已接管$/);
  });

  it('[en-native] 行 → origin=en，中文页 id 从中文表按 [en:<id32>] 反查', async () => {
    mockNotionReq
      .mockResolvedValueOnce({ results: [] })  // en 正文
      .mockResolvedValueOnce({ results: [zhPage] }) // 中文表 query by 备注 contains [en:]
      .mockResolvedValue({});
    mockCreateRoutedTask.mockResolvedValue({ task: { id: 'b7efdbff-0ab0-46f3-8009-64c8cb9898d6' } });
    mockQuery.mockResolvedValue({ rows: [] });
    const { ingestDelegatedPage } = await import('../notion-push-sync.js');
    const r = await ingestDelegatedPage({ query: mockQuery }, 'tok', enPage('英文原生 [en-native]'), { env: {} });
    expect(r.kind).toBe('qiumi_task');
    expect(mockCreateRoutedTask.mock.calls[0][1].metadata).toMatchObject({ origin: 'en', tenant_id: 'default' });
  });

  it('已带 brain: 的行幂等跳过；非标记行仍走原 dev 分支（零行为变化）', async () => {
    const { ingestDelegatedPage } = await import('../notion-push-sync.js');
    expect(await ingestDelegatedPage({ query: mockQuery }, 'tok', enPage(`[zh:${ZH32}] · brain:15f42776-8d1b-430d-b27a-38a480b93151 ✓已接管`), { env: {} }))
      .toEqual({ taskId: null, kind: 'skipped' });
    mockNotionReq.mockResolvedValueOnce({ results: [] }).mockResolvedValue({});
    mockCreateRoutedTask.mockResolvedValue({ task: { id: 'dddddddd-1111-2222-3333-444444444444' } });
    mockQuery.mockResolvedValue({ rows: [] });
    const r = await ingestDelegatedPage({ query: mockQuery }, 'tok', enPage('普通排单'), { env: {} });
    expect(r.kind).toBe('dev');
    expect(mockCreateRoutedTask.mock.calls[0][1]).toMatchObject({ requested_task_type: 'dev', repo_hint: 'cecelia', mutation_intent: 'write' });
    expect(mockCreateRoutedTask.mock.calls[0][1].metadata).not.toHaveProperty('dedup_by_notion_page'); // 存量路径不得进豁免
    expect(mockQuery.mock.calls.some((c) => /status='blocked'/.test(c[0]))).toBe(true); // 原分支落 blocked 不变
  });

  it('pullMarkedNotionTasks 只查带标记的 Delegated 行', async () => {
    mockNotionReq.mockResolvedValueOnce({ results: [] }).mockResolvedValueOnce({ results: [] });
    const { pullMarkedNotionTasks } = await import('../notion-push-sync.js');
    const r = await pullMarkedNotionTasks({ query: mockQuery }, 'tok', { env: {} });
    expect(r).toEqual({ ingested: 0, skipped: 0 });
    const body = mockNotionReq.mock.calls[0][3];
    expect(body.filter.and).toEqual(expect.arrayContaining([{ property: 'Status', status: { equals: 'Delegated' } }]));
    expect(JSON.stringify(body.filter)).toMatch(/\[zh:|\[en-native\]/);
  });
});

describe('注册表：qiumi_task 此刀进 VALID_TASK_TYPES', () => {
  it('VALID_TASK_TYPES 含 qiumi_task', async () => {
    const R = await import('../lib/task-type-registry.js');
    expect(R.VALID_TASK_TYPES).toContain('qiumi_task');
  });
});
```

- [ ] **Step 2: 跑测试确认失败** — Run: `cd packages/brain && npx vitest run src/__tests__/notion-push-sync-marked-ingest.test.js 2>&1 | tail -20`；Expected: FAIL（`ingestDelegatedPage is not a function`、VALID 不含 qiumi_task）。
- [ ] **Step 3: commit-1** — `git add packages/brain/src/__tests__/notion-push-sync-marked-ingest.test.js && git commit -m "test(brain): 标记行入账为 qiumi_task + V 标签开启断言——先红

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"`

- [ ] **Step 4: 改注册表与其测试**

`packages/brain/src/lib/task-type-registry.js` 第 167-169 行改为：
```js
  // PR2 入口刀已开启 V（router_valid）：qiumi_task 由 notion-gtd-sync 入账，headed_manual=true 防 tick 抢跑；
  // PR3 路由刀接管派发（Jev 判 engine/is_device/account）。
  qiumi_task:               T('openclaw-agent', false, false, 'openclaw-agent', 'openclaw-agent', true, true, 'none', true, [V]),
```
`packages/brain/src/lib/__tests__/task-type-registry.test.js`：
- 406 行注释与 419-422 行的 `it` 改为：
```js
  it('VALID_TASK_TYPES 派生集合 == 替换前字面量 + qiumi_task（PR2 入口刀开启，其余零变化）', () => {
    same(R.VALID_TASK_TYPES, [...VALID_TASK_TYPES_FIX, 'qiumi_task']);
    expect(R.VALID_TASK_TYPES).toContain('qiumi_task');
  });
```
- 428-435 行 `qiumi_task 声明符合 spec 1.1` 内的 `expect(R.VALID_TASK_TYPES).not.toContain('qiumi_task')` 改为 `.toContain('qiumi_task')`，标题改为 `'qiumi_task 声明符合 spec 1.1（PR2：V 标签已开）'`。

- [ ] **Step 5: 改 `notion-push-sync.js`**

在文件顶部 import 区追加：
```js
import { parseEnPage, parseZhPage, GTD_DB_ID, EN_NATIVE_MARK, BRAIN_MARK_RE } from './notion-gtd-sync.js';
```
把 `const NOTION_TASKS_DB = ...`（24 行）改为 `export const NOTION_TASKS_DB = 'd5bc40c2-ba63-82ef-965a-8153b7ad81a0';`。

把 `pullNotionTasks` 的 `for (const page of resp?.results ?? []) { try { ... } catch ... }` 循环体整体替换为对 `ingestDelegatedPage` 的调用，并新增两个函数（放在 `pullNotionTasks` 之前）：

```js
const richText = (arr) => (arr ?? []).map((t) => t.plain_text ?? t.text?.content ?? '').join('');

function tenantFor(env, zhDbId) {
  try {
    const map = JSON.parse(env.NOTION_TENANT_MAP || '{}');
    return map[zhDbId] ?? map[String(zhDbId).replace(/-/g, '')] ?? 'default';
  } catch { return 'default'; }
}

/** 英文页 [en:<id32>] 反查中文行（反向回填生成的中文行备注带该标记） */
async function findZhPageByEnMark(token, enId32) {
  const resp = await notionReq(token, `/databases/${GTD_DB_ID}/query`, 'POST', {
    page_size: 1, filter: { property: '备注', rich_text: { contains: `[en:${enId32}]` } },
  });
  return resp?.results?.[0] ?? null;
}

/**
 * 秋米标记行（[zh:<id32>] 或 [en-native]）→ Brain qiumi_task。
 * 页 id 只进 payload（notion_page_id=英文页，为 458 去重豁免键；notion_zh_page_id=中文页），
 * 绝不写 tasks.notion_id（canonical 投影会覆盖）。tenant 由 NOTION_TENANT_MAP 给。
 */
async function ingestQiumiPage(pool, token, page, en, { env }) {
  const enBody = await fetchNotionPageContent(token, page.id);
  let zhPage = null;
  if (en.zhId32) {
    const zhId = en.zhId32.replace(/^(.{8})(.{4})(.{4})(.{4})(.{12})$/, '$1-$2-$3-$4-$5');
    zhPage = await notionReq(token, `/pages/${zhId}`, 'GET');
  } else {
    zhPage = await findZhPageByEnMark(token, en.id32);
  }
  const zh = zhPage ? parseZhPage(zhPage) : null;
  const zhBody = zh ? await fetchNotionPageContent(token, zh.id) : '';
  const title = (zh?.title || en.name.replace(/^\[P[0-3]\]\s*/, '')).trim();
  const priority = zh?.priority ?? (en.name.match(/^\[(P[0-2])\]/)?.[1] ?? 'P2');
  const dueAt = zh?.dueAt ?? en.planDate ?? null;
  const tenantId = zh ? tenantFor(env, GTD_DB_ID) : 'default';
  const routed = await createRoutedTask(pool, {
    source: 'inbox',
    source_id: page.id,
    title,
    description: (zhBody || enBody || en.description || '').slice(0, 2000) || '来自秋米中文任务表',
    requested_task_type: 'qiumi_task',
    mutation_intent: 'none',
    declared_domain: 'operations',
    map_scope_hint: ['F2', 'execution_pool'],
    metadata: {
      source: 'notion_gtd',
      origin: en.zhId32 ? 'zh' : 'en',
      notion_page_id: page.id,            // 信息字段，不承担去重语义
      notion_zh_page_id: zh?.id ?? null,
      dedup_by_notion_page: 'true',       // 458 idx_tasks_dedup_active 豁免键（同名中文行不撞）
      tenant_id: tenantId,
      headed_manual: true,
      qiumi_source: {
        title, remark: zh?.remark ?? en.description, body: zhBody || enBody,
        priority_raw: zh?.priorityRaw ?? null, due_at: dueAt, channel: zh?.channel ?? null,
        agent_workflow_ids: zh?.agentWorkflowIds ?? [], skill_ids: zh?.skillIds ?? [],
        business_task_ids: zh?.businessTaskIds ?? [], owner_ids: zh?.ownerIds ?? [],
      },
    },
    task: { priority, status: 'queued', trigger_source: 'manual', executor_kind: 'openclaw-agent' },
  });
  const taskId = routed?.task?.id ?? routed?.task_id;
  if (!taskId) throw new Error('routed_task_id_missing');
  if (dueAt) await pool.query(`UPDATE tasks SET due_at=$2, updated_at=NOW() WHERE id=$1`, [taskId, dueAt]);
  if (zh) {
    await notionReq(token, `/pages/${zh.id}`, 'PATCH', { properties: {
      'OpenClaw任务号': { rich_text: [{ type: 'text', text: { content: `brain:${taskId}` } }] },
      '状态': { status: { name: '进行中' } },
    } });
  }
  await writeStatusReceipt(token, page, en.description, `brain:${taskId} ✓已接管`);
  console.log(`[notion-gtd] 入账 "${title}" → qiumi_task ${taskId}`);
  return { taskId, kind: 'qiumi_task' };
}

/**
 * 一页 Delegated 的完整接手逻辑（从 pullNotionTasks 抽出；非标记行逐字保持原行为）。
 * @returns {{taskId: string|null, kind: 'qiumi_task'|'dev'|'openclaw'|'skipped'}}
 */
export async function ingestDelegatedPage(pool, token, page, opts = {}) {
  const props = page.properties ?? {};
  const name = richText(props.Name?.title).trim();
  const desc = richText(props.Description?.rich_text);
  if (!name) return { taskId: null, kind: 'skipped' };
  if (/brain:/.test(desc)) return { taskId: null, kind: 'skipped' }; // 已接手，幂等跳过
  if (/run:notion-/.test(desc)) return { taskId: null, kind: 'skipped' }; // OpenClaw 已派发，幂等跳过

  const en = parseEnPage(page);
  if (en.zhId32 || en.enNative) {
    return ingestQiumiPage(pool, token, page, en, { env: opts.env ?? process.env });
  }

  // ─── 以下为原 pullNotionTasks 循环体，逐字搬入，行为不变 ───
  const wfRelation = (props.Workflow?.relation ?? [])[0]?.id ?? null;
  if (wfRelation) {
    const planStart = props['Plan Date']?.date?.start ?? null;
    if (planStart && new Date(planStart).getTime() > Date.now()) {
      await writeStatusReceipt(token, page, desc, `🕐 已排期 ${planStart}，到点自动派发`);
      return { taskId: null, kind: 'skipped' };
    }
    await dispatchOpenClawFromNotion({
      pool, token, page, desc,
      pageContent: await fetchNotionPageContent(token, page.id),
      workflowNotionId: wfRelation,
      agentNotionId: (props.Agent?.relation ?? [])[0]?.id ?? null,
      env: opts.env ?? process.env,
      readTemplateFn: opts.readTemplateFn ?? defaultReadTemplate,
      fetchFn: opts.fetchFn ?? globalThis.fetch,
      execFn: opts.execFn,
    });
    return { taskId: null, kind: 'openclaw' };
  }
  const m = name.match(/^\[(P[0-3])\]\s*(.+)$/);
  const priority = m ? m[1] : 'P2';
  const title = m ? m[2] : name;
  const pageContent = await fetchNotionPageContent(token, page.id);
  const routed = await createRoutedTask(pool, {
    source: 'inbox',
    source_id: page.id,
    title,
    description: pageContent.slice(0, 2000) || '来自 Notion Tasks 编排（主理人排单）',
    requested_task_type: 'dev',
    declared_change_kind: 'capability_change',
    mutation_intent: 'write',
    repo_hint: 'cecelia',
    metadata: { source: 'notion_tasks_db', notion_page_id: page.id },
    map_scope_hint: ['F2', 'execution_pool'],
    task: { priority, status: 'queued' },
  });
  const taskId = routed?.task?.id ?? routed?.task_id;
  if (!taskId) throw new Error('routed_task_id_missing');
  await pool.query(
    `UPDATE tasks SET status='blocked',
            blocked_at=NOW(),
            error_message='awaiting_execution_route: map 扫描器迁移后由 unblock 放行',
            notion_id=$2,
            notion_props = COALESCE(notion_props,'{}'::jsonb)
              || jsonb_build_object('pushed_status','blocked','origin','notion'),
            updated_at=NOW()
      WHERE id=$1`,
    [taskId, page.id],
  );
  const receipt = `${desc ? desc + ' · ' : ''}brain:${taskId} ✓已接管`;
  await notionReq(token, `/pages/${page.id}`, 'PATCH', {
    properties: { Description: { rich_text: [{ type: 'text', text: { content: receipt.slice(0, 1900) } }] } },
  });
  console.log(`[notion-pull] 接手排单 "${title}" → task ${taskId}`);
  return { taskId, kind: 'dev' };
}

/** 只拉带秋米标记的 Delegated 行（notion-gtd-sync 30s 轮用；与 legacy pullNotionTasks 共用入账函数，幂等） */
export async function pullMarkedNotionTasks(pool, token, opts = {}) {
  let ingested = 0; let skipped = 0;
  for (const mark of ['[zh:', EN_NATIVE_MARK]) {
    let resp;
    try {
      resp = await notionReq(token, `/databases/${NOTION_TASKS_DB}/query`, 'POST', {
        page_size: 50,
        filter: { and: [
          { property: 'Status', status: { equals: 'Delegated' } },
          { property: 'Description', rich_text: { contains: mark } },
        ] },
      });
    } catch (err) {
      console.warn(`[notion-gtd] Tasks 库查询失败(${mark}): ${err.message}`);
      continue;
    }
    for (const page of resp?.results ?? []) {
      try {
        const r = await ingestDelegatedPage(pool, token, page, opts);
        if (r.kind === 'qiumi_task') ingested += 1; else skipped += 1;
      } catch (err) {
        console.warn(`[notion-gtd] 页面 ${page?.id} 入账失败: ${err.message}`);
        await logSyncError(pool, err.message);
      }
    }
  }
  return { ingested, skipped };
}
```

`pullNotionTasks` 收敛为：
```js
async function pullNotionTasks(pool, token, opts = {}) {
  let resp;
  try {
    resp = await notionReq(token, `/databases/${NOTION_TASKS_DB}/query`, 'POST', {
      page_size: 20,
      filter: { property: 'Status', status: { equals: 'Delegated' } },
    });
  } catch (err) {
    console.warn(`[notion-pull] Tasks 库查询失败: ${err.message}`);
    return;
  }
  for (const page of resp?.results ?? []) {
    try {
      await ingestDelegatedPage(pool, token, page, opts);
    } catch (err) {
      console.warn(`[notion-pull] 页面 ${page?.id} 接手失败: ${err.message}`);
      await logSyncError(pool, err.message);
    }
  }
}
```

- [ ] **Step 6: 跑测试转绿**

Run: `cd packages/brain && npx vitest run src/__tests__/notion-push-sync-marked-ingest.test.js src/__tests__/notion-push-sync.test.js src/lib/__tests__/task-type-registry.test.js src/__tests__/task-type-registry.guard.test.js src/__tests__/integration/task-type-registry-consistency.integration.test.js 2>&1 | tail -25`
Expected: 全绿（原 `notion-push-sync.test.js` 里 pull 相关用例逐字行为不变；guard 清单未动；consistency：`qiumi_task` 已在 458 白名单）。

- [ ] **Step 7: 变异验证** — ① 临时把 `ingestQiumiPage` 的 `mutation_intent: 'none'` 改 `'write'` → 测试红（参数断言）；② 临时删 `dedup_by_notion_page: 'true'` 一行 → 测试红（metadata 断言；smoke 闸3 同名第二行也会撞唯一索引）；各自还原绿。写进 commit body。
- [ ] **Step 8: commit-2** — `git add packages/brain/src/notion-push-sync.js packages/brain/src/lib/task-type-registry.js packages/brain/src/lib/__tests__/task-type-registry.test.js && git commit -m "feat(brain): pullNotionTasks 抽出 ingestDelegatedPage；秋米标记行入账 qiumi_task（页id进payload、不写notion_id）；qiumi_task 开启 V

变异：mutation_intent none→write 参数断言红；还原绿。非标记行分支逐字搬入，notion-push-sync.test.js 全绿。

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"`

---

### Task 5: 状态回写（zh 通道 + en 状态）与两条人工急停

**Files:**
- Modify: `packages/brain/src/notion-gtd-sync.js`（追加 `pushQiumiStatus`、`applyOwnerStops`、`PUSH_QIUMI_QUERY`）
- Test: `packages/brain/src/__tests__/notion-gtd-sync-push-and-stops.test.js`

**Interfaces:**
- Consumes: `zhWriteFor`、`QIUMI_STATUS_MAP`、`blockTask`/`unblockTask`（`task-updater.js:197/250`）、`recordProjectionCommand`（`projection/commands.js:7`）
- Produces:
  - `PUSH_QIUMI_QUERY`（SQL）：`SELECT id, status, error_message, result, payload->>'notion_zh_page_id' AS zh_page_id, payload->>'notion_page_id' AS en_page_id FROM tasks WHERE payload->>'notion_zh_page_id' IS NOT NULL AND (notion_props->>'qiumi_pushed_status') IS DISTINCT FROM status ORDER BY updated_at DESC LIMIT 50`
  - `pushQiumiStatus(pool, token, deps) → { pushed, skippedHuman, skippedNoMap }`：逐行 GET 中文页 → 中文当前状态 ∈ 人工态 → 只更新 `qiumi_pushed_status` 指纹不写页（`skippedHuman`）；否则 PATCH 中文页（`zhWriteFor`）+ PATCH 英文页 Status（`QIUMI_STATUS_MAP[status].en`）+ `UPDATE tasks SET notion_props = notion_props || {'qiumi_pushed_status': status}`
  - `applyOwnerStops(pool, token, deps) → { cancelled, held, resumed }`：查中文表 `OpenClaw任务号 starts_with 'brain:'` 且 `状态 ∈ {淘汰, 阻塞, 委派}`（三次独立 filter，绝不用 contains 人工态以外的东西读）：淘汰→`recordProjectionCommand({target:'notion', externalId:`${page.id}:${last_edited_time}`, entityId, commandType:'cancel_requested'})`；阻塞→`blockTask(id,{reason:'owner_hold', detail:'主理人在中文表拖到阻塞'})`（返回不成功即忽略——已 blocked/终态）；委派→若任务 `status='blocked' AND blocked_reason='owner_hold'` → `unblockTask(id)`

- [ ] **Step 1: 写失败测试**

```js
// packages/brain/src/__tests__/notion-gtd-sync-push-and-stops.test.js
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockNotionReq = vi.fn();
vi.mock('../recurring-notion-sync.js', () => ({ notionReq: mockNotionReq, getToken: () => 'tok' }));
const mockBlock = vi.fn(); const mockUnblock = vi.fn();
vi.mock('../task-updater.js', () => ({ blockTask: mockBlock, unblockTask: mockUnblock }));
const mockRecord = vi.fn();
vi.mock('../projection/commands.js', () => ({ recordProjectionCommand: mockRecord }));

const ZH = '11111111-2222-3333-4444-555555555555';
const EN = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
const TID = '15f42776-8d1b-430d-b27a-38a480b93151';
const zhPageWith = (status, taskNo = `brain:${TID}`) => ({
  id: ZH, last_edited_time: '2026-09-23T01:00:00.000Z',
  properties: { '状态': { status: { name: status } }, 'OpenClaw任务号': { rich_text: [{ plain_text: taskNo }] } },
});

describe('pushQiumiStatus', () => {
  beforeEach(() => { mockNotionReq.mockReset(); });
  it('completed_no_pr → 中文已完成+勾选+日期，英文 Done，指纹更新', async () => {
    const { pushQiumiStatus, PUSH_QIUMI_QUERY } = await import('../notion-gtd-sync.js');
    const query = vi.fn()
      .mockResolvedValueOnce({ rows: [{ id: TID, status: 'completed_no_pr', error_message: null, result: { receipt: { finalAssistantVisibleText: '做完了' } }, zh_page_id: ZH, en_page_id: EN }] })
      .mockResolvedValue({ rows: [] });
    mockNotionReq.mockResolvedValueOnce(zhPageWith('进行中')).mockResolvedValue({});
    const r = await pushQiumiStatus({ query }, 'tok', { notionReq: mockNotionReq, today: () => '2026-09-23' });
    expect(r).toEqual({ pushed: 1, skippedHuman: 0, skippedNoMap: 0 });
    expect(query.mock.calls[0][0]).toBe(PUSH_QIUMI_QUERY);
    expect(PUSH_QIUMI_QUERY).toMatch(/LIMIT 50/);
    const zhPatch = mockNotionReq.mock.calls.find((c) => c[1] === `/pages/${ZH}` && c[2] === 'PATCH')[3];
    expect(zhPatch.properties['状态'].status.name).toBe('已完成');
    expect(zhPatch.properties['已完成'].checkbox).toBe(true);
    expect(zhPatch.properties['OpenClaw结果'].rich_text[0].text.content).toBe('做完了');
    const enPatch = mockNotionReq.mock.calls.find((c) => c[1] === `/pages/${EN}` && c[2] === 'PATCH')[3];
    expect(enPatch.properties.Status.status.name).toBe('Done');
    expect(query.mock.calls.at(-1)[0]).toMatch(/qiumi_pushed_status/);
    expect(query.mock.calls.at(-1)[1]).toEqual([TID, 'completed_no_pr']);
  });
  it('中文当前状态是人工态（阻塞/淘汰/收集/下一个行动）→ 不写中文页，只更新指纹', async () => {
    const { pushQiumiStatus } = await import('../notion-gtd-sync.js');
    for (const human of ['阻塞', '淘汰', '收集', '下一个行动']) {
      mockNotionReq.mockReset();
      const query = vi.fn()
        .mockResolvedValueOnce({ rows: [{ id: TID, status: 'blocked', error_message: 'owner_hold', result: null, zh_page_id: ZH, en_page_id: EN }] })
        .mockResolvedValue({ rows: [] });
      mockNotionReq.mockResolvedValueOnce(zhPageWith(human)).mockResolvedValue({});
      const r = await pushQiumiStatus({ query }, 'tok', { notionReq: mockNotionReq, today: () => '2026-09-23' });
      expect(r.skippedHuman).toBe(1);
      expect(mockNotionReq.mock.calls.some((c) => c[1] === `/pages/${ZH}` && c[2] === 'PATCH')).toBe(false);
    }
  });
  it('blocked（系统等待态）→ 中文保持进行中 + [等待中: reason]；pending → 不写（skippedNoMap）', async () => {
    const { pushQiumiStatus } = await import('../notion-gtd-sync.js');
    const query = vi.fn()
      .mockResolvedValueOnce({ rows: [
        { id: TID, status: 'blocked', error_message: 'quota_exhausted', result: null, zh_page_id: ZH, en_page_id: EN },
        { id: 'p-1', status: 'pending', error_message: null, result: null, zh_page_id: ZH, en_page_id: EN },
      ] }).mockResolvedValue({ rows: [] });
    mockNotionReq.mockResolvedValueOnce(zhPageWith('进行中')).mockResolvedValue({});
    const r = await pushQiumiStatus({ query }, 'tok', { notionReq: mockNotionReq, today: () => '2026-09-23' });
    expect(r).toEqual({ pushed: 1, skippedHuman: 0, skippedNoMap: 1 });
    const zhPatch = mockNotionReq.mock.calls.find((c) => c[1] === `/pages/${ZH}` && c[2] === 'PATCH')[3];
    expect(zhPatch.properties['状态'].status.name).toBe('进行中');
    expect(zhPatch.properties['OpenClaw结果'].rich_text[0].text.content).toBe('[等待中: quota_exhausted]');
  });
});

describe('applyOwnerStops（急停只对任务号 brain: 的行生效）', () => {
  beforeEach(() => { mockNotionReq.mockReset(); mockBlock.mockReset(); mockUnblock.mockReset(); mockRecord.mockReset(); });
  it('淘汰→cancel_requested；阻塞→blockTask(owner_hold)；委派(从阻塞拖回)→unblockTask；任务号为空的行永不读', async () => {
    const { applyOwnerStops, OWNER_STOP_FILTERS } = await import('../notion-gtd-sync.js');
    mockNotionReq
      .mockResolvedValueOnce({ results: [zhPageWith('淘汰'), zhPageWith('淘汰', '')] })  // 淘汰 查询
      .mockResolvedValueOnce({ results: [zhPageWith('阻塞')] })                            // 阻塞
      .mockResolvedValueOnce({ results: [zhPageWith('委派')] });                           // 委派
    const query = vi.fn().mockResolvedValue({ rows: [{ id: TID, status: 'blocked', blocked_reason: 'owner_hold' }] });
    mockBlock.mockResolvedValue({ success: true }); mockUnblock.mockResolvedValue({ success: true });
    const r = await applyOwnerStops({ query }, 'tok', { notionReq: mockNotionReq });
    expect(r).toEqual({ cancelled: 1, held: 1, resumed: 1 });
    expect(mockRecord).toHaveBeenCalledWith({ query }, expect.objectContaining({ target: 'notion', entityId: TID, commandType: 'cancel_requested', externalId: `${ZH}:2026-09-23T01:00:00.000Z` }));
    expect(mockBlock).toHaveBeenCalledWith(TID, expect.objectContaining({ reason: 'owner_hold' }));
    expect(mockUnblock).toHaveBeenCalledWith(TID);
    for (const f of OWNER_STOP_FILTERS) {
      expect(JSON.stringify(f)).toMatch(/"starts_with":"brain:"/);
    }
  });
  it('委派但任务不是 owner_hold 的 blocked → 不 unblock（系统阻塞不受人工影响）', async () => {
    const { applyOwnerStops } = await import('../notion-gtd-sync.js');
    mockNotionReq.mockResolvedValueOnce({ results: [] }).mockResolvedValueOnce({ results: [] }).mockResolvedValueOnce({ results: [zhPageWith('委派')] });
    const query = vi.fn().mockResolvedValue({ rows: [{ id: TID, status: 'blocked', blocked_reason: 'dispatch_fail_autoblock' }] });
    const r = await applyOwnerStops({ query }, 'tok', { notionReq: mockNotionReq });
    expect(r.resumed).toBe(0);
    expect(mockUnblock).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: 跑测试确认失败** — Expected: FAIL（`pushQiumiStatus is not a function`）。
- [ ] **Step 3: commit-1** — `git add packages/brain/src/__tests__/notion-gtd-sync-push-and-stops.test.js && git commit -m "test(brain): 秋米状态回写与两条人工急停断言——先红

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"`

- [ ] **Step 4: 追加实现到 `notion-gtd-sync.js`**

```js
import { blockTask, unblockTask } from './task-updater.js';
import { recordProjectionCommand } from './projection/commands.js';
import { QIUMI_STATUS_MAP, ZH_HUMAN_ONLY_STATUSES, zhWriteFor } from './lib/qiumi-status-map.js';

export const PUSH_QIUMI_QUERY = `
    SELECT id, status, error_message, result,
           payload->>'notion_zh_page_id' AS zh_page_id,
           payload->>'notion_page_id'    AS en_page_id
      FROM tasks
     WHERE payload->>'notion_zh_page_id' IS NOT NULL
       AND (notion_props->>'qiumi_pushed_status') IS DISTINCT FROM status
     ORDER BY updated_at DESC
     LIMIT 50`;

const resultTextOf = (result) => {
  const r = result?.receipt ?? result ?? {};
  return String(r.finalAssistantVisibleText ?? r.text ?? r.summary ?? '').slice(0, 1900);
};
const bizToday = () => new Date(Date.now() - 4 * 3600 * 1000).toISOString().slice(0, 10); // 业务日早 4 点切

/** Brain → 中文页（zh 通道 ≤50/轮）+ 英文页 Status。人工态行只更指纹不写页。 */
export async function pushQiumiStatus(pool, token, { notionReq = defaultNotionReq, today = bizToday } = {}) {
  const { rows } = await pool.query(PUSH_QIUMI_QUERY);
  let pushed = 0; let skippedHuman = 0; let skippedNoMap = 0;
  for (const t of rows) {
    const map = QIUMI_STATUS_MAP[t.status];
    if (!map || !map.zh) { skippedNoMap += 1; continue; }
    const zhPage = await withBackoff(() => notionReq(token, `/pages/${t.zh_page_id}`, 'GET'));
    const zhStatus = zhPage?.properties?.['状态']?.status?.name ?? null;
    const stamp = () => pool.query(
      `UPDATE tasks SET notion_props = COALESCE(notion_props,'{}'::jsonb) || jsonb_build_object('qiumi_pushed_status', $2::text) WHERE id=$1`,
      [t.id, t.status],
    );
    if (ZH_HUMAN_ONLY_STATUSES.includes(zhStatus)) { await stamp(); skippedHuman += 1; continue; }
    const write = zhWriteFor(t.status, { reason: t.error_message || '', resultText: resultTextOf(t.result), today: today() });
    await withBackoff(() => notionReq(token, `/pages/${t.zh_page_id}`, 'PATCH', write));
    if (t.en_page_id && map.en) {
      await withBackoff(() => notionReq(token, `/pages/${t.en_page_id}`, 'PATCH', { properties: { Status: { status: { name: map.en } } } }));
    }
    await stamp();
    pushed += 1;
  }
  return { pushed, skippedHuman, skippedNoMap };
}

/** 急停三个查询：只读三个人工动作态，且必须 OpenClaw任务号 以 brain: 开头（归属铁律） */
export const OWNER_STOP_FILTERS = Object.freeze(['淘汰', '阻塞', '委派'].map((s) => Object.freeze({
  and: [
    { property: '状态', status: { equals: s } },
    { property: 'OpenClaw任务号', rich_text: { starts_with: 'brain:' } },
  ],
})));

export async function applyOwnerStops(pool, token, { notionReq = defaultNotionReq } = {}) {
  let cancelled = 0; let held = 0; let resumed = 0;
  const [discarded, holds, redelegated] = await Promise.all(
    OWNER_STOP_FILTERS.map((filter) => queryAll(notionReq, token, GTD_DB_ID, filter)),
  );
  const taskIdOf = (page) => parseZhPage(page).taskNo.match(BRAIN_MARK_RE)?.[1] ?? null;
  for (const page of discarded) {
    const id = taskIdOf(page); if (!id) continue;
    await recordProjectionCommand(pool, {
      target: 'notion', externalId: `${page.id}:${page.last_edited_time}`, entityType: 'tasks',
      entityId: id, commandType: 'cancel_requested', payload: { source: 'qiumi_owner_stop' },
    });
    cancelled += 1;
  }
  for (const page of holds) {
    const id = taskIdOf(page); if (!id) continue;
    const r = await blockTask(id, { reason: 'owner_hold', detail: '主理人在中文表拖到阻塞' });
    if (r?.success) held += 1;
  }
  for (const page of redelegated) {
    const id = taskIdOf(page); if (!id) continue;
    const { rows } = await pool.query(`SELECT id, status, blocked_reason FROM tasks WHERE id=$1`, [id]);
    const t = rows[0];
    if (t?.status === 'blocked' && t.blocked_reason === 'owner_hold') {
      const r = await unblockTask(id);
      if (r?.success) resumed += 1;
    }
  }
  return { cancelled, held, resumed };
}
```

- [ ] **Step 5: 跑测试转绿** — Run: `cd packages/brain && npx vitest run src/__tests__/notion-gtd-sync-push-and-stops.test.js src/__tests__/notion-gtd-sync.test.js 2>&1 | tail -20`；Expected: 全绿。
- [ ] **Step 6: 变异验证** — 临时删掉 `ZH_HUMAN_ONLY_STATUSES.includes(zhStatus)` 那道闸 → "人工态不写中文页" 测试红；还原绿。写进 commit body。
- [ ] **Step 7: commit-2** — `git add packages/brain/src/notion-gtd-sync.js && git commit -m "feat(brain): 秋米状态回写（zh 通道≤50/轮，人工态不覆盖）+ 急停：淘汰→cancel_requested、阻塞→owner_hold、拖回委派→unblock

变异：删人工态闸 → 测试红；还原绿。偏离 spec：阻塞→blocked/owner_hold 而非 paused（paused 无 API 且 queued→paused 不在转移表）。

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"`

---

### Task 6: 调度接线（30s 自循环）+ 迁移 459 + 真库 smoke + 并存守卫

**Files:**
- Modify: `packages/brain/src/notion-gtd-sync.js`（追加 `runGtdSyncOnce`、`ensureGtdSyncLoop`、`gtdSyncJobHandler`）
- Modify: `packages/brain/src/scheduler-jobs.js`（import + JOBS 追加一行）
- Create: `packages/brain/migrations/459_notion_gtd_inlet_registry.sql`
- Create: `packages/brain/scripts/smoke/qiumi-entry-smoke.sh`、`packages/brain/scripts/smoke/qiumi-entry-smoke.mjs`
- Modify: `packages/quality/smoke-allowlist.txt`（字母序插入 `qiumi-entry-smoke.sh`）
- Test: `packages/brain/src/__tests__/scheduler-jobs-gtd-sync.test.js`

**Interfaces:**
- Consumes: Task 3/4/5 函数、`pullMarkedNotionTasks`、`getToken`
- Produces:
  - `runGtdSyncOnce(pool, deps) → { zhToEn, enToZh, ingest, push, stops, at }`（顺序：zh→en → en→zh → 入账 → 急停 → 回写）
  - `ensureGtdSyncLoop(pool, { env, setIntervalFn, intervalMs=30_000 }) → { started: boolean, running: boolean }`（模块级单例；`QIUMI_SYNC_ENABLED!=='true'` 时 `{started:false, running:false}`；`unref` 定时器；每轮异常只 warn 不抛）
  - `gtdSyncJobHandler(pool) → { loop, lastRun }`（scheduler-jobs handler，立即返回，不阻塞串行轮）
  - env：`QIUMI_SYNC_ENABLED`（缺省 false）、`QIUMI_SYNC_SINCE`（ISO，缺省 = 首次启动时刻）、`QIUMI_SYNC_INTERVAL_MS`（缺省 30000）、`NOTION_TENANT_MAP`、`NOTION_GTD_DB_ID`

- [ ] **Step 1: 写失败测试**

```js
// packages/brain/src/__tests__/scheduler-jobs-gtd-sync.test.js
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockNotionReq = vi.fn();
vi.mock('../recurring-notion-sync.js', () => ({ notionReq: mockNotionReq, getToken: () => 'tok' }));
vi.mock('../task-updater.js', () => ({ blockTask: vi.fn(), unblockTask: vi.fn() }));
vi.mock('../projection/commands.js', () => ({ recordProjectionCommand: vi.fn() }));
vi.mock('../db.js', () => ({ default: { query: vi.fn() } }));

describe('notion-gtd-sync 调度', () => {
  beforeEach(() => { mockNotionReq.mockReset(); vi.resetModules(); });

  it('QIUMI_SYNC_ENABLED 未开 → 不起循环、不调 Notion', async () => {
    const { ensureGtdSyncLoop } = await import('../notion-gtd-sync.js');
    const setIntervalFn = vi.fn();
    expect(ensureGtdSyncLoop({ query: vi.fn() }, { env: {}, setIntervalFn })).toEqual({ started: false, running: false });
    expect(setIntervalFn).not.toHaveBeenCalled();
    expect(mockNotionReq).not.toHaveBeenCalled();
  });

  it('开启 → 只起一次 30s 定时器（幂等），handler 立即返回', async () => {
    const { ensureGtdSyncLoop, gtdSyncJobHandler } = await import('../notion-gtd-sync.js');
    const timer = { unref: vi.fn() };
    const setIntervalFn = vi.fn(() => timer);
    const env = { QIUMI_SYNC_ENABLED: 'true', QIUMI_SYNC_SINCE: '2026-09-23T00:00:00.000Z' };
    expect(ensureGtdSyncLoop({ query: vi.fn() }, { env, setIntervalFn })).toEqual({ started: true, running: true });
    expect(ensureGtdSyncLoop({ query: vi.fn() }, { env, setIntervalFn })).toEqual({ started: false, running: true });
    expect(setIntervalFn).toHaveBeenCalledTimes(1);
    expect(setIntervalFn.mock.calls[0][1]).toBe(30_000);
    expect(timer.unref).toHaveBeenCalled();
    const started = Date.now();
    const out = await gtdSyncJobHandler({ query: vi.fn() }, { env, setIntervalFn });
    expect(Date.now() - started).toBeLessThan(200);
    expect(out).toMatchObject({ loop: 'running' });
  });

  it('runGtdSyncOnce 顺序：zh→en, en→zh, 入账, 急停, 回写；单步失败不阻断后续', async () => {
    const mod = await import('../notion-gtd-sync.js');
    const deps = {
      syncZhToEn: vi.fn().mockRejectedValue(new Error('notion down')),
      syncEnToZh: vi.fn().mockResolvedValue({ created: 0, skipped: 0 }),
      pullMarked: vi.fn().mockResolvedValue({ ingested: 1, skipped: 0 }),
      applyOwnerStops: vi.fn().mockResolvedValue({ cancelled: 0, held: 0, resumed: 0 }),
      pushQiumiStatus: vi.fn().mockResolvedValue({ pushed: 1, skippedHuman: 0, skippedNoMap: 0 }),
    };
    const r = await mod.runGtdSyncOnce({ query: vi.fn() }, { token: 'tok', env: {}, ...deps });
    expect(r.zhToEn).toMatchObject({ error: 'notion down' });
    expect(r.ingest).toEqual({ ingested: 1, skipped: 0 });
    expect(r.push.pushed).toBe(1);
    const order = [deps.syncZhToEn, deps.syncEnToZh, deps.pullMarked, deps.applyOwnerStops, deps.pushQiumiStatus]
      .map((f) => f.mock.invocationCallOrder[0]);
    expect(order).toEqual([...order].sort((a, b) => a - b));
  });

  it('scheduler-jobs 注册了 notion-gtd-sync 且在 SERIAL_JOBS', async () => {
    const { JOBS, SERIAL_JOBS } = await import('../scheduler-jobs.js');
    const job = JOBS.find((j) => j.name === 'notion-gtd-sync');
    expect(job).toBeTruthy();
    expect(job.needsPool).toBe(true);
    expect(SERIAL_JOBS.map((j) => j.name)).toContain('notion-gtd-sync');
  });

  it('并存守卫：syncZhToEn 绝不处理任务号非空的行（变异钉住二次校验）', async () => {
    const { syncZhToEn } = await import('../notion-gtd-sync.js');
    mockNotionReq.mockResolvedValueOnce({ results: [{
      id: '11111111-2222-3333-4444-555555555555', created_time: '2026-09-23T00:10:00.000Z',
      properties: { '名称': { title: [{ plain_text: 'x' }] }, '状态': { status: { name: '委派' } },
        'OpenClaw任务号': { rich_text: [{ plain_text: 'dept-dev-abc' }] }, '归档': { checkbox: false } },
    }] });
    const r = await syncZhToEn({ query: vi.fn() }, 'tok', { notionReq: mockNotionReq });
    expect(r).toEqual({ created: 0, skipped: 1 });
    expect(mockNotionReq).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: 跑测试确认失败** — Expected: FAIL（`ensureGtdSyncLoop is not a function`；`notion-gtd-sync` 未注册）。
- [ ] **Step 3: commit-1** — `git add packages/brain/src/__tests__/scheduler-jobs-gtd-sync.test.js && git commit -m "test(brain): notion-gtd-sync 调度/开关/顺序/并存守卫断言——先红

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"`

- [ ] **Step 4: 实现调度**

追加到 `notion-gtd-sync.js`：
```js
import { getToken } from './recurring-notion-sync.js';
import { pullMarkedNotionTasks, fetchNotionPageContent } from './notion-push-sync.js';

const safe = async (label, fn) => {
  try { return await fn(); } catch (err) {
    console.warn(`[notion-gtd] ${label} 失败: ${err.message}`);
    return { error: err.message };
  }
};

export async function runGtdSyncOnce(pool, {
  token = null, env = process.env, notionReq = defaultNotionReq,
  syncZhToEn: zhToEnFn = syncZhToEn, syncEnToZh: enToZhFn = syncEnToZh,
  pullMarked = pullMarkedNotionTasks, applyOwnerStops: stopsFn = applyOwnerStops,
  pushQiumiStatus: pushFn = pushQiumiStatus,
} = {}) {
  const tok = token ?? getToken();
  const sinceIso = env.QIUMI_SYNC_SINCE || null;
  const common = { notionReq, fetchPageContent: fetchNotionPageContent };
  const zhToEn = await safe('zh→en', () => zhToEnFn(pool, tok, { ...common, sinceIso }));
  const enToZh = await safe('en→zh', () => enToZhFn(pool, tok, common));
  const ingest = await safe('入账', () => pullMarked(pool, tok, { env }));
  const stops = await safe('急停', () => stopsFn(pool, tok, { notionReq }));
  const push = await safe('回写', () => pushFn(pool, tok, { notionReq }));
  return { zhToEn, enToZh, ingest, stops, push, at: new Date().toISOString() };
}

let loopTimer = null;
let lastRun = null;
export function __resetGtdSyncLoopForTest() { loopTimer = null; lastRun = null; }

export function ensureGtdSyncLoop(pool, { env = process.env, setIntervalFn = setInterval, intervalMs } = {}) {
  if (env.QIUMI_SYNC_ENABLED !== 'true') return { started: false, running: false };
  if (loopTimer) return { started: false, running: true };
  if (!env.QIUMI_SYNC_SINCE) env.QIUMI_SYNC_SINCE = new Date().toISOString(); // 并存期：只处理打开之后建的行
  const ms = intervalMs ?? Number(env.QIUMI_SYNC_INTERVAL_MS || 30_000);
  let inFlight = false;
  loopTimer = setIntervalFn(async () => {
    if (inFlight) return;
    inFlight = true;
    try { lastRun = await runGtdSyncOnce(pool, { env }); } finally { inFlight = false; }
  }, ms);
  if (typeof loopTimer?.unref === 'function') loopTimer.unref();
  console.log(`[notion-gtd] 同步循环已启动（${ms}ms，since=${env.QIUMI_SYNC_SINCE}）`);
  return { started: true, running: true };
}

/** scheduler-jobs handler：只确保循环在跑并回报上次结果，立即返回，不阻塞 60s 串行轮 */
export async function gtdSyncJobHandler(pool, opts = {}) {
  const s = ensureGtdSyncLoop(pool, opts);
  return { loop: s.running ? 'running' : 'disabled', lastRun };
}
```
（`vi.resetModules()` 在测试里保证模块级单例每个用例重置；`__resetGtdSyncLoopForTest` 备用。）

`scheduler-jobs.js`：import 区追加 `import { gtdSyncJobHandler } from './notion-gtd-sync.js';`；在 `notion-inlet` 相关 job 附近追加：
```js
  { name: 'notion-gtd-sync', needsPool: true, timeoutMs: 30_000, handler: (pool) => gtdSyncJobHandler(pool), description: '秋米中文GTD表↔英文Tasks库双向同步+入账+急停+回写（QIUMI_SYNC_ENABLED 门，handler 只确保 30s 自循环在跑并回报上次结果；决策 b8abd28c，task b7efdbff）' },
```

- [ ] **Step 5: 迁移 459**

```sql
-- 459: 秋米中文 GTD 表与英文 Tasks 库登记进 notion_projection_map（三面模型，决策 297ffee5 / b8abd28c）
-- 中文表 = 入口（人写、Brain 收，Brain 只回写 状态/OpenClaw任务号/OpenClaw结果/已完成/完成日期 五列）；
-- 英文库 = 入口兼镜（legacy pullNotionTasks + notion-gtd-sync 共用入账函数）。幂等：已登记不改。
INSERT INTO notion_projection_map (notion_db_id, title, face, brain_table, direction, vessel, status, space, notes)
VALUES
('c69c40c2-ba63-8271-badf-01c5410d8929','秋米 任务（中文 GTD）','inlet','tasks','both','notion-gtd-sync.runGtdSyncOnce','active','private','列级分权：状态/OpenClaw任务号/OpenClaw结果/已完成/完成日期 由 Brain 回写；收集/下一个行动/阻塞/淘汰 人工专属'),
('d5bc40c2-ba63-82ef-965a-8153b7ad81a0','Tasks（英文，主理人排单）','inlet','tasks','both','notion-push-sync.ingestDelegatedPage + notion-gtd-sync','active','system','Delegated=交给 Brain；[zh:]/[en-native] 标记行→qiumi_task，其余→legacy dev 分支')
ON CONFLICT (notion_db_id) DO NOTHING;
```
在 cecelia_test 实跑两遍验证幂等：`cd packages/brain && DATABASE_URL=postgresql://cecelia@localhost:5432/cecelia_test node src/migrate.js 2>&1 | tail -3`（第二遍应无变化）。

- [ ] **Step 6: smoke（真库 + Notion stub）**

`packages/brain/scripts/smoke/qiumi-entry-smoke.mjs`（由 .sh 调用，`DATABASE_URL` 指向 cecelia_test）：
```js
// 端到端：假 Notion（内存对象）+ 真 Postgres。闸：
//  1 zh 委派行 → en 行建出（Description 以 [zh: 开头）+ zh 任务号 en:
//  2 标记行入账 → tasks 出现 qiumi_task(queued, executor_kind=openclaw-agent, payload.notion_page_id/notion_zh_page_id/tenant_id/headed_manual)
//  3 同名第二条 zh 行也能入账（458 去重豁免：payload.dedup_by_notion_page='true'，真库唯一索引实证）
//  4 人工把 zh 拖到「淘汰」→ projection_commands 出现 cancel_requested；applyProjectionCommands 后任务 cancelled
//  5 回写：任务 completed_no_pr → zh 已完成+勾选；zh 处于「阻塞」时不被覆盖
//  6 对照组：zh 状态「收集」的行永不建 en 行、永不入账
import pg from 'pg';
import { runGtdSyncOnce } from '../../src/notion-gtd-sync.js';
import { applyProjectionCommands } from '../../src/projection/commands.js';

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const T = `[smoke] qiumi-entry ${process.pid}`;
const pages = new Map(); // id → page（假 Notion 存储）
let seq = 0;
const mkId = () => `${(++seq).toString(16).padStart(8, '0')}-0000-4000-8000-000000000000`;
const zhRow = (title, status) => { const id = mkId(); pages.set(id, { id, db: 'zh', created_time: new Date().toISOString(), last_edited_time: new Date().toISOString(), properties: {
  '名称': { title: [{ plain_text: title }] }, '备注': { rich_text: [] }, '状态': { status: { name: status } },
  'OpenClaw任务号': { rich_text: [] }, '优先级': { select: { name: '高' } }, '预期完成日期': { date: null }, '执行通道': { select: null },
  '执行 Agent / Workflow': { relation: [] }, '使用 Skill': { relation: [] }, 'AI 业务任务': { relation: [] }, '负责人': { people: [] }, '归档': { checkbox: false },
} }); return id; };
const plain = (a) => (a ?? []).map((t) => t.plain_text ?? t.text?.content ?? '').join('');
function match(page, filter) {
  if (!filter) return true;
  if (filter.and) return filter.and.every((f) => match(page, f));
  if (filter.timestamp === 'created_time') return page.created_time >= filter.created_time.on_or_after;
  const p = page.properties[filter.property];
  if (filter.status) return p?.status?.name === filter.status.equals;
  if (filter.checkbox) return (p?.checkbox === true) === filter.checkbox.equals;
  if (filter.rich_text?.is_empty) return plain(p?.rich_text) === '';
  if (filter.rich_text?.starts_with) return plain(p?.rich_text).startsWith(filter.rich_text.starts_with);
  if (filter.rich_text?.contains) return plain(p?.rich_text).includes(filter.rich_text.contains);
  return false;
}
const notionReq = async (_t, path, method, body) => {
  const q = path.match(/^\/databases\/([^/]+)\/query$/);
  if (q) { const db = q[1].startsWith('c69c') ? 'zh' : 'en'; return { results: [...pages.values()].filter((p) => p.db === db && match(p, body.filter)) }; }
  if (path === '/pages' && method === 'POST') { const id = mkId(); const db = body.parent.database_id.startsWith('c69c') ? 'zh' : 'en'; const page = { id, db, created_time: new Date().toISOString(), last_edited_time: new Date().toISOString(), properties: {} }; for (const [k, v] of Object.entries(body.properties)) page.properties[k] = v.title ? { title: v.title.map((t) => ({ plain_text: t.text.content })) } : v.rich_text ? { rich_text: v.rich_text.map((t) => ({ plain_text: t.text.content })) } : v; pages.set(id, page); return { id }; }
  const pg1 = path.match(/^\/pages\/([^/]+)$/);
  if (pg1 && method === 'GET') return pages.get(pg1[1]);
  if (pg1 && method === 'PATCH') { const page = pages.get(pg1[1]); for (const [k, v] of Object.entries(body.properties)) page.properties[k] = v.rich_text ? { rich_text: v.rich_text.map((t) => ({ plain_text: t.text.content })) } : v; page.last_edited_time = new Date().toISOString(); return page; }
  if (/^\/blocks\//.test(path)) return { results: [] };
  throw new Error(`fake notion: ${method} ${path}`);
};
const env = { QIUMI_SYNC_ENABLED: 'true', QIUMI_SYNC_SINCE: '2000-01-01T00:00:00.000Z', NOTION_TENANT_MAP: JSON.stringify({ 'c69c40c2-ba63-8271-badf-01c5410d8929': 'yueshengyun' }) };
const pass = (m) => console.log(`PASS: ${m}`);
const fail = (m) => { console.error(`FAIL: ${m}`); process.exitCode = 1; throw new Error(m); };
const run = () => runGtdSyncOnce(pool, { token: 'fake', env, notionReq });
try {
  await pool.query(`DELETE FROM tasks WHERE title LIKE $1`, [`${T}%`]);
  const a = zhRow(`${T} 同名`, '委派'); const b = zhRow(`${T} 同名`, '委派'); const c = zhRow(`${T} 收集行`, '收集');
  await run();
  const enRows = [...pages.values()].filter((p) => p.db === 'en');
  if (enRows.length !== 2 || !enRows.every((p) => plain(p.properties.Description.rich_text).startsWith('[zh:'))) fail('闸1 zh→en 建行');
  if (!plain(pages.get(a).properties['OpenClaw任务号'].rich_text).startsWith('brain:')) fail('闸2 入账后 zh 任务号=brain:');
  pass('闸1 zh→en 建行 + 占位');
  const { rows } = await pool.query(`SELECT id, status, executor_kind, payload FROM tasks WHERE title=$1 ORDER BY created_at`, [`${T} 同名`]);
  if (rows.length !== 2) fail(`闸3 同名两行入账（458 豁免）：得到 ${rows.length}`);
  for (const r of rows) {
    if (r.status !== 'queued' || r.executor_kind !== 'openclaw-agent') fail('闸2 状态/executor_kind');
    if (!r.payload.notion_page_id || !r.payload.notion_zh_page_id || r.payload.tenant_id !== 'yueshengyun' || r.payload.headed_manual !== true) fail('闸2 payload 字段');
    if (r.payload.dedup_by_notion_page !== 'true') fail('闸2 去重豁免键 dedup_by_notion_page 必须为字符串 true');
  }
  pass('闸2/3 入账字段 + 同名不撞');
  if ([...pages.values()].some((p) => p.db === 'en' && plain(p.properties.Description.rich_text).includes('收集行'))) fail('闸6 收集行被同步');
  pass('闸6 收集/人工态不参与');
  pages.get(a).properties['状态'] = { status: { name: '淘汰' } };
  await run();
  const cmd = await pool.query(`SELECT command_type FROM projection_commands WHERE entity_id=$1 AND command_type='cancel_requested'`, [rows[0].id]);
  if (!cmd.rows.length) fail('闸4 淘汰→cancel_requested');
  await applyProjectionCommands(pool);
  const after = await pool.query(`SELECT status FROM tasks WHERE id=$1`, [rows[0].id]);
  if (after.rows[0].status !== 'cancelled') fail(`闸4 应用后应 cancelled，得到 ${after.rows[0].status}`);
  pass('闸4 急停淘汰→cancelled');
  await pool.query(`UPDATE tasks SET status='in_progress', updated_at=NOW() WHERE id=$1`, [rows[1].id]);
  await pool.query(`UPDATE tasks SET status='completed_no_pr', completed_at=NOW(), result='{"receipt":{"finalAssistantVisibleText":"done"}}'::jsonb, updated_at=NOW() WHERE id=$1`, [rows[1].id]);
  await run();
  const zhB = pages.get(b).properties;
  if (zhB['状态'].status.name !== '已完成' || zhB['已完成'].checkbox !== true) fail('闸5 回写已完成');
  pass('闸5 回写已完成+勾选');
  console.log('ALL PASS');
} finally {
  await pool.query(`DELETE FROM projection_commands WHERE payload->>'source'='qiumi_owner_stop'`).catch(() => {});
  await pool.query(`DELETE FROM tasks WHERE title LIKE $1`, [`${T}%`]).catch(() => {});
  await pool.end();
}
```
`packages/brain/scripts/smoke/qiumi-entry-smoke.sh`：复制 `qiumi-foundation-smoke.sh` 的前 30 行（`set -euo pipefail`、`DATABASE_URL` 必填、库名后缀 `_test|_scratch` 守卫、host 守卫），然后：
```bash
cd "$(dirname "$0")/../.." && node scripts/smoke/qiumi-entry-smoke.mjs
```
登记：在 `packages/quality/smoke-allowlist.txt` 中 `qiumi-foundation-smoke.sh` 之前插入 `qiumi-entry-smoke.sh`（字母序 e < f）。
真跑：`cd packages/brain && DATABASE_URL=postgresql://cecelia@localhost:5432/cecelia_test bash scripts/smoke/qiumi-entry-smoke.sh`，Expected: 6 个 PASS + `ALL PASS`。变异：临时把 `.mjs` 里 `'淘汰'` 改成 `'阻塞'` → 闸4 FAIL；还原。

- [ ] **Step 7: 跑测试转绿** — Run: `cd packages/brain && npx vitest run src/__tests__/scheduler-jobs-gtd-sync.test.js src/__tests__/notion-gtd-sync.test.js src/__tests__/notion-gtd-sync-push-and-stops.test.js src/__tests__/notion-push-sync-marked-ingest.test.js src/__tests__/scheduler-jobs.test.js 2>&1 | tail -25`；Expected: 全绿（若 `scheduler-jobs.test.js` 断言 job 数量，按新增 1 条同步修正并在 commit 说明）。`npx eslint src scripts/smoke/qiumi-entry-smoke.mjs` 干净。
- [ ] **Step 8: commit-2**

```bash
git add packages/brain/src/notion-gtd-sync.js packages/brain/src/scheduler-jobs.js packages/brain/migrations/459_notion_gtd_inlet_registry.sql packages/brain/scripts/smoke/qiumi-entry-smoke.sh packages/brain/scripts/smoke/qiumi-entry-smoke.mjs packages/quality/smoke-allowlist.txt
git commit -m "feat(brain): notion-gtd-sync 接线——scheduler 30s 自循环（QIUMI_SYNC_ENABLED 门）、迁移 459 登记两库、真库 smoke 六闸

smoke 真跑 ALL PASS；变异 淘汰→阻塞 闸4 FAIL 后还原。本刀默认关闭，打开属 PR3 切换脚本。

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

## 自审清单（写完计划后已核）
- spec 1.5 覆盖：正向 ✓(T3/T4) 反向 ✓(T3/T4) 直落 queued ✓(T4) tenant/priority/due_at ✓(T4) `notion_page_id`+`dedup_by_notion_page='true'`（PR1 终审 C1，458 谓词）✓(T4/T6 smoke 闸3) 推送 zh 通道 ≤50 ✓(T5) 急停两条 ✓(T5) 退避 ✓(T2) 映射表断言 ✓(T1) 30s ✓(T6) 与旧脚本并存 ✓(T6 默认关+since+二次校验)。
- 偏离 spec（已在 Global Constraints 与 T5 commit 说明）：阻塞→`blocked/owner_hold` 而非 `paused`；页 id 不写 `tasks.notion_id`（canonical 投影会覆盖）；不依赖 legacy 5min 链（自起 30s 循环）。
- 名称一致：`ingestDelegatedPage` / `pullMarkedNotionTasks` / `runGtdSyncOnce` / `ensureGtdSyncLoop` / `gtdSyncJobHandler` / `pushQiumiStatus` / `applyOwnerStops` / `OWNER_STOP_FILTERS` / `ZH_QUERY_FILTER` / `QIUMI_STATUS_MAP` / `zhWriteFor` 在各 Task 间一致。
- 无 TBD/TODO；每步有代码与命令。
