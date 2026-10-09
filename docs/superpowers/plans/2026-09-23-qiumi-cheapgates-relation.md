# 便宜闸 relation 漂移修复 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让主理人在 Notion 填的「执行 Agent / Workflow」真正生效，并用一份共享真身 + 三段契约测试杜绝同类漂移复发。

**Architecture:** 把 `qiumi_source` 的构造从 `notion-push-sync.js` 的内联字面量抽到中立叶子模块 `lib/qiumi-source.js`，导出扁平层与 Notion 层两个函数；所有消费方（生产代码、测试、smoke）一律从这里取形状，不再手搓。`cheap-gates.js` 改读真实键 `src.agent_workflow_ids` 并分两趟匹配两个注册表池。

**Tech Stack:** Node ESM、vitest、PostgreSQL（`ops_agents` / `ops_workflows` / `device_locks` 投影表）

**Spec:** `docs/superpowers/specs/2026-09-23-qiumi-cheapgates-relation-design.md`
**Brain task:** `a91700c2-4fd4-47fd-bbf6-b0ef81ce89ba` ｜ **decision:** `522e9c8e` ｜ **判定点:** `0aa5d290` `aae169cd`

---

## 文件结构

| 文件 | 职责 | 动作 |
|---|---|---|
| `packages/brain/src/lib/qiumi-source.js` | `qiumi_source` 形状的唯一真身；两层导出 | 新建 |
| `packages/brain/src/lib/__tests__/qiumi-source.test.js` | 基线等价 + JSON 层 + `zh:null` | 新建 |
| `packages/brain/src/routing/__tests__/qiumi-source-cheapgates-contract.test.js` | 三段串联契约守卫 | 新建 |
| `packages/brain/src/routing/cheap-gates.js` | 改读 `agent_workflow_ids`，分两趟、用户顺序 tie-break | 改 42-56 |
| `packages/brain/src/notion-push-sync.js` | 改调 `qiumiSourceFromNotion` | 改 411-416 |
| `packages/brain/src/routing/__tests__/cheap-gates.test.js` | 删死形状 + 新用例 | 改 11/32/37/45 |
| `packages/brain/src/routing/__tests__/qiumi-router.test.js` | 改形状保断言 | 改 62/226/238/252 |
| `packages/brain/scripts/smoke/qiumi-phone-agent-smoke.mjs` | 手搓形状改用 builder | 改 67-72 |
| `packages/brain/scripts/smoke/qiumi-routing-smoke.mjs` | 同上 | 改 169 |
| `packages/brain/src/__tests__/dispatcher-qiumi-routing.test.js` | 同上 | 改 103 |
| `packages/brain/src/__tests__/openclaw-agent-executor.test.js` | 同上 | 改 54 / 275 |
| `docs/superpowers/plans/2026-09-23-qiumi-task-router-pr3.md` | 改错误消费合同 | 改 21/397/416/559 |
| `docs/superpowers/plans/2026-09-23-qiumi-task-router-pr2.md` | 同上 | 改 19 |

---

## Task 0: 准备执行环境

**Files:** 无改动

- [ ] **Step 1: 装依赖**

本 worktree 是新 checkout，没有 `node_modules`，不装就连测试都跑不起来。

```bash
cd /Users/administrator/worktrees/cecelia/qiumi-cheapgates-relation
npm ci
```

Expected: 安装完成，`ls packages/brain/node_modules/.bin/vitest` 或根 `node_modules/.bin/vitest` 存在。

- [ ] **Step 2: 确认基线测试全绿**

```bash
cd packages/brain && npx vitest run src/routing/__tests__/cheap-gates.test.js src/routing/__tests__/qiumi-router.test.js
```

Expected: PASS。这是改动前的基线，**必须先绿**，否则后面分不清是自己改红的还是本来就红。

---

## Task 1: 写失败测试（commit-1，Red）

> `lint-tdd-commit-order` 要求：动 `packages/brain/src/**.js`（非 test）的 commit 之前，必须已有一个含 `*.test.js` 且 diff `+` 行里有非 `.skip` 的 `it(` 的 commit。本 Task 就是那个 commit，**只加测试、不碰 src**。

**Files:**
- Create: `packages/brain/src/lib/__tests__/qiumi-source.test.js`
- Create: `packages/brain/src/routing/__tests__/qiumi-source-cheapgates-contract.test.js`

- [ ] **Step 1: 写 builder 基线测试**

基线取自 `packages/brain/src/__tests__/notion-push-sync-marked-ingest.test.js:63-67` 现有的期望字面量（抽取前生产真实产出）。

创建 `packages/brain/src/lib/__tests__/qiumi-source.test.js`：

```js
/**
 * qiumi-source.test.js
 *
 * qiumi_source 原为 notion-push-sync.js:411-416 的内联字面量，抽到中立叶子模块
 * lib/qiumi-source.js 供生产代码与全部消费方（测试/smoke）共同 import。
 * 基线字面量取自抽出前 notion-push-sync-marked-ingest.test.js:63-67 的期望值，
 * 抽模块不改值。
 *
 * 终点是 jsonb：JS 层 toEqual 会忽略"值为 undefined 的多余键"，与落库形状不是
 * 一回事，故基线断言做两层（JS 层 + JSON round-trip 层）。
 */
import { describe, it, expect } from 'vitest';
import { buildQiumiSource, qiumiSourceFromNotion } from '../qiumi-source.js';

// 抽出前 notion-push-sync.js:411-416 对这组输入的真实产出（marked-ingest.test.js:63-67）
const BASELINE = {
  title: '用 Claude Code 把首页按钮改蓝',
  remark: 'opc_department=dev',
  body: '中文正文',
  priority_raw: '高',
  due_at: '2026-09-24T09:00:00.000+08:00',
  channel: null,
  agent_workflow_ids: ['wf-1'],
  skill_ids: [],
  business_task_ids: [],
  owner_ids: ['u-1'],
};

const ZH = {
  remark: 'opc_department=dev',
  priorityRaw: '高',
  channel: null,
  agentWorkflowIds: ['wf-1'],
  skillIds: [],
  businessTaskIds: [],
  ownerIds: ['u-1'],
};

describe('qiumiSourceFromNotion: 抽模块零行为变化', () => {
  it('与抽出前的基线字面量逐键相等（JS 层）', () => {
    const built = qiumiSourceFromNotion({
      title: '用 Claude Code 把首页按钮改蓝',
      zh: ZH,
      en: { description: 'EN 描述' },
      zhBody: '中文正文',
      enBody: 'EN 正文',
      dueAt: '2026-09-24T09:00:00.000+08:00',
    });
    expect(built).toEqual(BASELINE);
  });

  it('JSON round-trip 后仍与基线相等（终点是 jsonb，undefined 键会被丢掉）', () => {
    const built = qiumiSourceFromNotion({
      title: '用 Claude Code 把首页按钮改蓝',
      zh: ZH,
      en: { description: 'EN 描述' },
      zhBody: '中文正文',
      enBody: 'EN 正文',
      dueAt: '2026-09-24T09:00:00.000+08:00',
    });
    expect(JSON.parse(JSON.stringify(built))).toEqual(BASELINE);
  });

  it('remark 用 ??：中文备注为空串时不回落 en.description（plain() 恒返回字符串）', () => {
    const built = qiumiSourceFromNotion({
      title: 'T', zh: { ...ZH, remark: '' }, en: { description: 'EN 描述' },
      zhBody: '中文正文', enBody: 'EN 正文', dueAt: null,
    });
    expect(built.remark).toBe('');
  });

  it('body 用 ||：中文正文为空串时必须回落英文正文', () => {
    const built = qiumiSourceFromNotion({
      title: 'T', zh: ZH, en: { description: 'EN 描述' },
      zhBody: '', enBody: 'EN 正文', dueAt: null,
    });
    expect(built.body).toBe('EN 正文');
  });

  it('zh 为 null（反查不到中文行）不崩，四个 id 数组取 []、remark 回落 en.description', () => {
    const built = qiumiSourceFromNotion({
      title: 'T', zh: null, en: { description: 'EN 描述' },
      zhBody: '', enBody: 'EN 正文', dueAt: null,
    });
    expect(built).toEqual({
      title: 'T', remark: 'EN 描述', body: 'EN 正文',
      priority_raw: null, due_at: null, channel: null,
      agent_workflow_ids: [], skill_ids: [], business_task_ids: [], owner_ids: [],
    });
  });
});

describe('buildQiumiSource: 扁平层', () => {
  it('十个键齐全，未传的 id 数组取 []、可空标量取 null', () => {
    expect(buildQiumiSource({ title: 'T' })).toEqual({
      title: 'T', remark: undefined, body: undefined,
      priority_raw: null, due_at: null, channel: null,
      agent_workflow_ids: [], skill_ids: [], business_task_ids: [], owner_ids: [],
    });
  });

  it('不传任何参数也不崩（消费方只关心部分键的场景）', () => {
    expect(buildQiumiSource()).toMatchObject({ agent_workflow_ids: [], skill_ids: [] });
  });
});
```

- [ ] **Step 2: 写三段串联契约测试**

骨架照 `packages/brain/src/__tests__/notion-push-sync-marked-ingest.test.js:214-220` 的同值守卫（同一个 it 里真 import 两端）。
Notion 页 fixture 照 `marked-ingest.test.js:20-33`。

创建 `packages/brain/src/routing/__tests__/qiumi-source-cheapgates-contract.test.js`：

```js
/**
 * qiumi-source-cheapgates-contract.test.js
 *
 * 契约守卫：parseZhPage → qiumiSourceFromNotion → cheapGates 三段串联。
 *
 * 本 bug 的根因是写入方存 agent_workflow_ids、读取方读 src.relations.*，
 * 两头各自有绿测试、中间没有横跨两端的契约测试。本文件补上这一条：
 * 任何一段改了键名，这里都会断言红（不是崩溃红）。
 *
 * 必须 workflow 与 agent 两条都断言——只断 workflow 挡不住"实现忘了喂 agents 池"，
 * 而 agent 分支正是唤醒 qiumi-router.js:117-124 agentRef:serial 支路的那条。
 */
import { describe, it, expect } from 'vitest';
import { parseZhPage } from '../../notion-gtd-sync.js';
import { qiumiSourceFromNotion } from '../../lib/qiumi-source.js';
import { cheapGates } from '../cheap-gates.js';
import { qiumiEnv } from '../env.js';

const env = qiumiEnv({});

const pool = {
  agents: [{ name: 'infra', notionId: 'ag-1' }],
  phones: [{ serial: 'ANGYVB4227006983', host: 'xian-m4' }],
  workflows: [{ name: '朋友圈跟圈', notionId: 'wf-1' }, { name: '周报生成', notionId: 'wf-2' }],
};

/** Notion 中文 GTD 页（形状照 notion-push-sync-marked-ingest.test.js:20-33）。 */
const zhPage = (relationIds) => ({
  id: '11111111-2222-3333-4444-555555555555',
  created_time: '2026-09-23T00:10:00.000Z',
  properties: {
    '名称': { title: [{ plain_text: '把这件事办了' }] },
    '备注': { rich_text: [{ plain_text: '' }] },
    '状态': { status: { name: '委派' } },
    'OpenClaw任务号': { rich_text: [] },
    '优先级': { select: { name: '高' } },
    '预期完成日期': { date: null },
    '执行通道': { select: null },
    '执行 Agent / Workflow': { relation: relationIds.map((id) => ({ id })) },
    '使用 Skill': { relation: [] },
    'AI 业务任务': { relation: [] },
    '负责人': { people: [] },
    '归档': { checkbox: false },
  },
});

/** 三段串联：真 Notion 页 → parseZhPage → qiumiSourceFromNotion → cheapGates */
const runChain = (relationIds) => {
  const zh = parseZhPage(zhPage(relationIds));
  const qiumi_source = qiumiSourceFromNotion({
    title: zh.title, zh, en: { description: '' }, zhBody: '把这件事办了', enBody: '', dueAt: null,
  });
  return cheapGates({ id: 't1', task_type: 'qiumi_task', payload: { qiumi_source } }, pool, env);
};

describe('契约：Notion 填的「执行 Agent / Workflow」一路走到便宜闸', () => {
  it('填了 workflow → workflowRef 命中，matchedBy 含 relation:workflow', () => {
    const g = runChain(['wf-2']);
    expect(g.workflowRef).toBe('周报生成');
    expect(g.matchedBy).toContain('relation:workflow');
  });

  it('填了 agent → department 命中，matchedBy 含 relation:agent（挡"忘了喂 agents 池"）', () => {
    const g = runChain(['ag-1']);
    expect(g.department).toBe('infra');
    expect(g.matchedBy).toContain('relation:agent');
  });

  it('同时填 workflow 与 agent → 两个都命中，matchedBy 顺序恒为 workflow 在前', () => {
    const g = runChain(['ag-1', 'wf-2']);
    expect(g.workflowRef).toBe('周报生成');
    expect(g.department).toBe('infra');
    expect(g.matchedBy).toEqual(['relation:workflow', 'relation:agent']);
  });

  it('填的 id 不在池里（如 workflow 已停用 active=FALSE）→ 不命中，matchedBy 不得出现 relation:*（判定点 0aa5d290）', () => {
    const g = runChain(['wf-does-not-exist']);
    expect(g.workflowRef).toBeNull();
    expect(g.department).toBeNull();
    expect(g.matchedBy.some((m) => m.startsWith('relation:'))).toBe(false);
  });

  it('什么都没填 → 不命中，回落交给 Jev（不崩）', () => {
    const g = runChain([]);
    expect(g.workflowRef).toBeNull();
    expect(g.matchedBy.some((m) => m.startsWith('relation:'))).toBe(false);
  });
});
```

- [ ] **Step 3: 跑测试确认全红**

```bash
cd packages/brain && npx vitest run src/lib/__tests__/qiumi-source.test.js src/routing/__tests__/qiumi-source-cheapgates-contract.test.js
```

Expected: FAIL，报 `Cannot find module '../qiumi-source.js'` / `'../../lib/qiumi-source.js'`（模块还没建）。

- [ ] **Step 4: commit-1**

```bash
git add packages/brain/src/lib/__tests__/qiumi-source.test.js \
        packages/brain/src/routing/__tests__/qiumi-source-cheapgates-contract.test.js
git commit -m "fix(brain): 秋米 qiumi_source 契约测试先行（Red）— 三段串联 + builder 基线

parseZhPage → qiumiSourceFromNotion → cheapGates 三段串联，workflow/agent 两条都断言。
当前必红：lib/qiumi-source.js 尚未建立。

Brain task a91700c2

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 2: 建共享真身 + 改两端（commit-2，Green）

**Files:**
- Create: `packages/brain/src/lib/qiumi-source.js`
- Modify: `packages/brain/src/routing/cheap-gates.js:42-56`
- Modify: `packages/brain/src/notion-push-sync.js:411-416`

- [ ] **Step 1: 建 `lib/qiumi-source.js`**

模块头注释格式照 `packages/brain/src/lib/ssh-args.js:1-14`。

```js
/**
 * qiumi-source.js
 *
 * `tasks.payload.metadata.qiumi_source` 的唯一真身。
 *
 * 原为 `notion-push-sync.js:411-416` 的内联对象字面量，消费方（cheap-gates、
 * 两个 smoke、若干测试）各自手搓一份形状。2026-09-23 实证：写入方存
 * `agent_workflow_ids`，而 `routing/cheap-gates.js` 读 `src.relations.workflows`
 * ——生产代码零处写过后者，主理人在 Notion 填的「执行 Agent / Workflow」被整条
 * 丢弃。两头各自有绿测试，中间没有横跨两端的契约测试，故漂了也没人知道。
 *
 * 抽到这个中立叶子模块（不依赖任何业务模块）的理由同 lib/ssh-args.js：让
 * `routing/cheap-gates.js` 去 import `notion-push-sync.js` 会拖进整条 Notion
 * API / DB pool 重依赖链，造成分层倒置。同域先例：lib/qiumi-status-map.js。
 * 对应 invariant 76cb816c：语义常量只允许一份，手抄同值副本 = 隐形炸弹。
 *
 * 两层导出：
 *  - buildQiumiSource(flat)      扁平层，消费方（测试/smoke）用这个，不必伪造 Notion 页
 *  - qiumiSourceFromNotion(...)  Notion 层，封 zh?.x ?? en.y 回落，notion-push-sync 用这个
 * 单层（只有 Notion 层）会逼消费方伪造 zh/en，等于把漂移从 qiumi_source 挪到 zh。
 */

/**
 * 扁平层：十个键齐全。
 * title/remark/body 不设默认值——原字面量对这三个键就是"有什么给什么"，
 * 设了默认会把 undefined 变成 ''，落 jsonb 时从"无此键"变成"空串"，非等价。
 */
export function buildQiumiSource({
  title,
  remark,
  body,
  priorityRaw = null,
  dueAt = null,
  channel = null,
  agentWorkflowIds = [],
  skillIds = [],
  businessTaskIds = [],
  ownerIds = [],
} = {}) {
  return {
    title,
    remark,
    body,
    priority_raw: priorityRaw,
    due_at: dueAt,
    channel,
    agent_workflow_ids: agentWorkflowIds,
    skill_ids: skillIds,
    business_task_ids: businessTaskIds,
    owner_ids: ownerIds,
  };
}

/** Notion 层：封回落逻辑，供 notion-push-sync.js 调用。 */
export function qiumiSourceFromNotion({ title, zh, en, zhBody, enBody, dueAt }) {
  return buildQiumiSource({
    title,
    // ?? 不是 ||：plain()（notion-gtd-sync.js:34）恒返回字符串，中文「备注」为空
    // 时是 ''，此时**不**回落 en.description。改成 || 就改了语义。
    remark: zh?.remark ?? en.description,
    // || 不是 ??：中文正文为空串时**必须**回落英文正文。与上一行刻意不同。
    body: zhBody || enBody,
    priorityRaw: zh?.priorityRaw ?? null,
    dueAt,
    channel: zh?.channel ?? null,
    // zh === null 是真实路径（notion-push-sync.js:384 反查不到中文行），
    // 可选链不能丢，否则 TypeError。
    agentWorkflowIds: zh?.agentWorkflowIds ?? [],
    skillIds: zh?.skillIds ?? [],
    businessTaskIds: zh?.businessTaskIds ?? [],
    ownerIds: zh?.ownerIds ?? [],
  });
}
```

- [ ] **Step 2: 改 `cheap-gates.js:42-56`**

把这 15 行：

```js
  const relWf = (src.relations?.workflows ?? []).map(norm);
  const wfHit = pool.workflows.find((w) => w.notionId && relWf.includes(norm(w.notionId)));
  if (wfHit) {
    out.workflowRef = wfHit.name;
    if (isDeviceWorkflow(wfHit.name, env)) out.isDevice = true;
    out.matchedBy.push('relation:workflow');
  }

  const relAg = (src.relations?.agents ?? []).map(norm);
  const agHit = pool.agents.find((a) => a.notionId && relAg.includes(norm(a.notionId)));
  if (agHit) {
    if (env.departments.includes(agHit.name)) { out.department = agHit.name; }
    else { out.agentRef = agHit.name; }
    out.matchedBy.push('relation:agent');
  }
```

替换为：

```js
  // Notion 列「执行 Agent / Workflow」是一个**混合**数组：同一列里既可能是 Agent 行
  // 的 page id，也可能是 Workflow 行的。写入方见 notion-push-sync.js 的
  // qiumiSourceFromNotion → lib/qiumi-source.js（唯一真身）。
  //
  // 必须**分两趟**（先 workflows 后 agents），不可合成一趟按 id 顺序遍历：
  // matchedBy 的元素顺序是承重的——vitest 的 toMatchObject 对数组是「长度相等 +
  // 严格按序」（本仓 @vitest/expect 实跑确认，子集与乱序均报错），合成一趟会让
  // 顺序随 id 顺序变，打破与本改动无关的既有用例。
  //
  // 每趟内遍历**用户在 Notion 的选择顺序**取首个命中，而不是遍历池（池是
  // ORDER BY name，用户选两个时赢的会是字母序靠前的那个，反直觉）。
  // 对照：text 分支有显式 tie-break「取最长命中」（见下方 + 用例 cheap-gates.test.js）。
  const relIds = (src.agent_workflow_ids ?? []).map(norm);

  let wfHit;
  for (const id of relIds) {
    wfHit = pool.workflows.find((w) => w.notionId && norm(w.notionId) === id);
    if (wfHit) break;
  }
  if (wfHit) {
    out.workflowRef = wfHit.name;
    if (isDeviceWorkflow(wfHit.name, env)) out.isDevice = true;
    out.matchedBy.push('relation:workflow');
  }

  let agHit;
  for (const id of relIds) {
    agHit = pool.agents.find((a) => a.notionId && norm(a.notionId) === id);
    if (agHit) break;
  }
  if (agHit) {
    if (env.departments.includes(agHit.name)) { out.department = agHit.name; }
    else { out.agentRef = agHit.name; }
    out.matchedBy.push('relation:agent');
  }
```

- [ ] **Step 3: 改 `notion-push-sync.js:411-416`**

在文件 import 区（第 15 行 `import { SSH_BASE_ARGS } from './lib/ssh-args.js';` 附近）加一行：

```js
import { qiumiSourceFromNotion } from './lib/qiumi-source.js';
```

把 `411-416` 这段：

```js
      qiumi_source: {
        title, remark: zh?.remark ?? en.description, body: zhBody || enBody,
        priority_raw: zh?.priorityRaw ?? null, due_at: dueAt, channel: zh?.channel ?? null,
        agent_workflow_ids: zh?.agentWorkflowIds ?? [], skill_ids: zh?.skillIds ?? [],
        business_task_ids: zh?.businessTaskIds ?? [], owner_ids: zh?.ownerIds ?? [],
      },
```

替换为：

```js
      qiumi_source: qiumiSourceFromNotion({ title, zh, en, zhBody, enBody, dueAt }),
```

- [ ] **Step 4: 跑测试确认转绿**

```bash
cd packages/brain && npx vitest run \
  src/lib/__tests__/qiumi-source.test.js \
  src/routing/__tests__/qiumi-source-cheapgates-contract.test.js \
  src/__tests__/notion-push-sync-marked-ingest.test.js
```

Expected: 三个文件全 PASS。特别是 `notion-push-sync-marked-ingest.test.js:63-67` 的 `qiumi_source` 断言必须**原样通过**——它是抽取零行为变化的证明。

- [ ] **Step 5: commit-2**

```bash
git add packages/brain/src/lib/qiumi-source.js \
        packages/brain/src/routing/cheap-gates.js \
        packages/brain/src/notion-push-sync.js
git commit -m "fix(brain): 便宜闸改读 agent_workflow_ids，qiumi_source 抽成共享真身

cheap-gates.js 原读 src.relations.workflows/agents，生产代码零处写过该键，
主理人在 Notion 填的「执行 Agent / Workflow」被整条丢弃，每条非设备秋米任务
被迫打 Jev。线上 7 条任务 agent_workflow_ids 7/7 有、relations 0/7。

- 改读 src.agent_workflow_ids（混合数组），分两趟匹配 ops_workflows / ops_agents
- 分两趟不可合并：matchedBy 顺序承重（toMatchObject 对数组长度相等+严格按序）
- tie-break 由池字母序改为用户在 Notion 的选择顺序
- qiumi_source 抽到 lib/qiumi-source.js，两层导出，消费方不再有能力自造形状

Brain task a91700c2 / decision 522e9c8e

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 3: 收编甲类死形状（commit-3）

**Files:**
- Modify: `packages/brain/src/routing/__tests__/cheap-gates.test.js:11/32/37/45`
- Modify: `packages/brain/src/routing/__tests__/qiumi-router.test.js:62/226/238/252`

- [ ] **Step 1: 改 `cheap-gates.test.js` 第 11 行的 `mk()`**

原：

```js
const mk = (src) => ({ id: 't1', task_type: 'qiumi_task', payload: { qiumi_source: { title: '', remark: '', body: '', channel: null, relations: { agents: [], workflows: [], skills: [] }, ...src } } });
```

改为（import 加在文件第 3 行 `import { qiumiEnv } from '../env.js';` 之后）：

```js
import { buildQiumiSource } from '../../lib/qiumi-source.js';

const mk = (src) => ({
  id: 't1',
  task_type: 'qiumi_task',
  payload: { qiumi_source: buildQiumiSource({ title: '', remark: '', body: '', channel: null, ...src }) },
});
```

- [ ] **Step 2: 改 `cheap-gates.test.js` 三个用例的入参**

第 32 行：

```js
    const g = cheapGates(mk({ relations: { agents: [], workflows: ['w1'], skills: [] } }), pool, env);
```
→
```js
    const g = cheapGates(mk({ agentWorkflowIds: ['w1'] }), pool, env);
```

第 37 行：

```js
    const g = cheapGates(mk({ relations: { agents: ['a1'], workflows: [], skills: [] } }), poolWithNonDeptAgent, env);
```
→
```js
    const g = cheapGates(mk({ agentWorkflowIds: ['a1'] }), poolWithNonDeptAgent, env);
```

第 45 行：

```js
    const g = cheapGates(mk({ channel: '发布', relations: { agents: [], workflows: ['w2'], skills: [] } }), pool, env);
```
→
```js
    const g = cheapGates(mk({ channel: '发布', agentWorkflowIds: ['w2'] }), pool, env);
```

- [ ] **Step 3: 在 `cheap-gates.test.js` 末尾（第 96 行 `});` 之前）加三条新用例**

```js
  it('多选 workflow → 取用户在 Notion 的选择顺序首个命中，不是池的字母序', () => {
    // 池按 name 排序时「周报生成」在「朋友圈跟圈」之后；用户先选 w2 就该 w2 赢。
    const g = cheapGates(mk({ agentWorkflowIds: ['w2', 'w1'] }), pool, env);
    expect(g.workflowRef).toBe('周报生成');
  });

  it('同一 id 同时命中 workflow 池与 agent 池 → 两个都设，matchedBy 顺序 workflow 在前', () => {
    // ops_agents.notion_id 与 ops_workflows.notion_id 都是 TEXT 且无 UNIQUE（migrations/433:12、436:16），
    // 投影重建/人工补录可能让同一 page id 在两表都有行。不假装不会发生。
    const both = { ...pool, agents: [{ name: 'infra', notionId: 'w2' }] };
    const g = cheapGates(mk({ agentWorkflowIds: ['w2'] }), both, env);
    expect(g).toMatchObject({ workflowRef: '周报生成', department: 'infra', matchedBy: ['relation:workflow', 'relation:agent'] });
  });

  it('指定的 id 不在池里（workflow 已停用 active=FALSE）→ 回落，matchedBy 不出现 relation:*（判定点 0aa5d290）', () => {
    const g = cheapGates(mk({ agentWorkflowIds: ['w-disabled'] }), pool, env);
    expect(g.workflowRef).toBeNull();
    expect(g.matchedBy.some((m) => m.startsWith('relation:'))).toBe(false);
  });
```

- [ ] **Step 4: 改 `qiumi-router.test.js` 第 62 行的 `task()`**

原：

```js
    qiumi_source: { title: 'T', remark: '', body, channel: null, relations: { agents: [], workflows: [], skills: [] }, ...source },
```
→（import 加到文件已有 import 区）
```js
    qiumi_source: buildQiumiSource({ title: 'T', remark: '', body, channel: null, ...source }),
```

加 import：

```js
import { buildQiumiSource } from '../../lib/qiumi-source.js';
```

- [ ] **Step 5: 改 `qiumi-router.test.js` 三处调用点（改形状、保断言）**

第 226 行：

```js
    const d = await routeQiumiTask(task('随便写点什么', { relations: { agents: ['ag-xiaobai'], workflows: [], skills: [] } }), {
```
→
```js
    const d = await routeQiumiTask(task('随便写点什么', { agentWorkflowIds: ['ag-xiaobai'] }), {
```

第 238 行（**这条是 `agentRef:serial` 支路的唯一覆盖，断言一字不动**）：

```js
    const d = await routeQiumiTask(task('把这条内容整理好交给同事', { relations: { agents: ['ag-phone1'], workflows: [], skills: [] } }), {
```
→
```js
    const d = await routeQiumiTask(task('把这条内容整理好交给同事', { agentWorkflowIds: ['ag-phone1'] }), {
```

第 252 行：

```js
    const d = await routeQiumiTask(task('去朋友圈点个赞', { relations: { agents: ['ag-xiaobai'], workflows: [], skills: [] } }), {
```
→
```js
    const d = await routeQiumiTask(task('去朋友圈点个赞', { agentWorkflowIds: ['ag-xiaobai'] }), {
```

- [ ] **Step 6: 跑测试**

```bash
cd packages/brain && npx vitest run src/routing/__tests__/
```

Expected: 全 PASS。`qiumi-router.test.js:236-248`（`agentRef:serial` 直接定案设备、`fetchFn` 未被调用）此刻**第一次测的是真实可达路径**。

- [ ] **Step 7: commit-3**

```bash
git add packages/brain/src/routing/__tests__/cheap-gates.test.js \
        packages/brain/src/routing/__tests__/qiumi-router.test.js
git commit -m "fix(brain): 删掉 8 处 relations 死形状，测试改从共享 builder 取

routing 两个测试文件自造 { relations: { agents, workflows, skills } }——生产从不
产生该形状，8 处用例测的是虚构路径，这正是漂移没被发现的原因。

qiumi-router.test.js:236-248（agentRef:serial 支路唯一覆盖）改形状保断言，
此刻第一次测真实可达路径。另补三条：用户顺序 tie-break / 一 id 命中两池 /
停用 workflow 回落且 matchedBy 无 relation:*（判定点 0aa5d290）。

Brain task a91700c2

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 4: 收编乙类手搓形状（commit-4）

> 乙类键名没错，但仍是各自一份。改后这些调用点会多出 `priority_raw` / `due_at` /
> 四个 id 数组等键（原本没有）——这是**有意的**：形状齐全才是目的。
> 这些调用点的断言都针对路由结果，不依赖键的缺失。

**Files:**
- Modify: `packages/brain/scripts/smoke/qiumi-phone-agent-smoke.mjs:67-72`
- Modify: `packages/brain/scripts/smoke/qiumi-routing-smoke.mjs:169`
- Modify: `packages/brain/src/__tests__/dispatcher-qiumi-routing.test.js:103`
- Modify: `packages/brain/src/__tests__/openclaw-agent-executor.test.js:54/275`

- [ ] **Step 1: 改 `qiumi-phone-agent-smoke.mjs`**

在文件已有 src import 区（约 36-38 行）加：

```js
import { buildQiumiSource } from '../../src/lib/qiumi-source.js';
```

第 67-72 行：

```js
const phoneSource = () => ({
  title: '去手机上跑一轮日常',
  remark: '',
  channel: null,
  body: `在 ${SERIAL} 这台手机上点赞十条，跑完回报。`,
});
```
→
```js
const phoneSource = () => buildQiumiSource({
  title: '去手机上跑一轮日常',
  remark: '',
  channel: null,
  body: `在 ${SERIAL} 这台手机上点赞十条，跑完回报。`,
});
```

- [ ] **Step 2: 改 `qiumi-routing-smoke.mjs`**

在文件已有 src import 区（约 31-34 行）加：

```js
import { buildQiumiSource } from '../../src/lib/qiumi-source.js';
```

第 169 行：

```js
        qiumi_source: { title: '给账号跑一轮', remark: '', body, channel: null },
```
→
```js
        qiumi_source: buildQiumiSource({ title: '给账号跑一轮', remark: '', body, channel: null }),
```

- [ ] **Step 3: 改 `dispatcher-qiumi-routing.test.js:103`**

加 import（文件已有 import 区）：

```js
import { buildQiumiSource } from '../lib/qiumi-source.js';
```

第 103 行：

```js
const fullRow = { ...candidate, payload: { qiumi_source: { title: '给张三发个私信确认收货地址' } } };
```
→
```js
const fullRow = { ...candidate, payload: { qiumi_source: buildQiumiSource({ title: '给张三发个私信确认收货地址' }) } };
```

- [ ] **Step 4: 改 `openclaw-agent-executor.test.js:54/275`**

加 import：

```js
import { buildQiumiSource } from '../lib/qiumi-source.js';
```

第 54 行：

```js
    qiumi_source: { title: '标题', remark: '备', body: 'token: SECRET 正文' },
```
→
```js
    qiumi_source: buildQiumiSource({ title: '标题', remark: '备', body: 'token: SECRET 正文' }),
```

第 275 行：

```js
    const r = await triggerOpenclawAgent({ ...task, payload: { qiumi_source: {} } }, { spawnFn, pool: { query: vi.fn() } });
```
→
```js
    const r = await triggerOpenclawAgent({ ...task, payload: { qiumi_source: buildQiumiSource() } }, { spawnFn, pool: { query: vi.fn() } });
```

- [ ] **Step 5: 跑受影响的测试**

```bash
cd packages/brain && npx vitest run \
  src/__tests__/dispatcher-qiumi-routing.test.js \
  src/__tests__/openclaw-agent-executor.test.js
```

Expected: 全 PASS。

- [ ] **Step 6: 语法检查两个 smoke（CI 不跑它们，改坏了不会当场红）**

```bash
cd packages/brain && node --check scripts/smoke/qiumi-phone-agent-smoke.mjs && node --check scripts/smoke/qiumi-routing-smoke.mjs && echo "语法 OK"
```

Expected: `语法 OK`

- [ ] **Step 7: commit-4**

```bash
git add packages/brain/scripts/smoke/qiumi-phone-agent-smoke.mjs \
        packages/brain/scripts/smoke/qiumi-routing-smoke.mjs \
        packages/brain/src/__tests__/dispatcher-qiumi-routing.test.js \
        packages/brain/src/__tests__/openclaw-agent-executor.test.js
git commit -m "fix(brain): 收编 4 处手搓 qiumi_source，全部改从共享 builder 取

两个 smoke 与两个测试各自手搓 3-4 个键的子集——键名没错，但仍是各自一份，
下次漂移它们照样发现不了（这次就没发现）。改后调用点更短且形状齐全。

Brain task a91700c2

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 5: 改文档里的错误合同（commit-5）

> 这是本 bug 的出生地。不改，下一个照文档干活的 agent 会把 `relations` 原样写回来。

**Files:**
- Modify: `docs/superpowers/plans/2026-09-23-qiumi-task-router-pr3.md:21/397/416/559`
- Modify: `docs/superpowers/plans/2026-09-23-qiumi-task-router-pr2.md:19`

- [ ] **Step 1: 定位五处**

```bash
grep -n "relations" docs/superpowers/plans/2026-09-23-qiumi-task-router-pr3.md \
                    docs/superpowers/plans/2026-09-23-qiumi-task-router-pr2.md
```

Expected: 命中 pr3 的 21/397/416/559 与 pr2 的 19（行号可能因文档演进微移，以 grep 实际输出为准）。

- [ ] **Step 2: 逐处把 `relations:{agents:[],workflows:[],skills:[]}` 改成真实合同**

替换为：

```
agent_workflow_ids: []（Agent 与 Workflow 混合的 Notion page id 数组，来自中文表「执行 Agent / Workflow」列）,
skill_ids: [], business_task_ids: [], owner_ids: []
```

- [ ] **Step 3: 在 pr3 文档第 21 行那段合同旁加一行勘误**

```markdown
> **勘误（2026-09-23）**：本节原写 `relations:{agents,workflows,skills}`，与 PR2 的实际实现
> （`agent_workflow_ids` / `skill_ids` / `business_task_ids` / `owner_ids`，见 pr2.md）不符。
> 照本节抄的 8 处测试因此测的是虚构形状，两头各自绿、中间断了三个月没人发现。
> 唯一真身现在是 `packages/brain/src/lib/qiumi-source.js`，一切消费方从那里 import，勿再手抄。
```

- [ ] **Step 4: 确认没有残留**

```bash
grep -rn "relations.*workflows.*skills" docs/ packages/ --include='*.md' --include='*.js' --include='*.mjs' || echo "✅ 全仓已无该死形状"
```

Expected: `✅ 全仓已无该死形状`

- [ ] **Step 5: commit-5**

```bash
git add docs/superpowers/plans/2026-09-23-qiumi-task-router-pr2.md \
        docs/superpowers/plans/2026-09-23-qiumi-task-router-pr3.md
git commit -m "fix(docs): 改掉 pr2/pr3 两份 plan 的分叉合同 — 本 bug 的出生地

pr2.md 写实现 agent_workflow_ids，pr3.md 写消费合同 relations{agents,workflows,skills}，
从一开始就是两份不同合同，8 处测试照 pr3 抄。不改文档，下一个照文档干活的 agent
会把 relations 原样写回来。

Brain task a91700c2

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 6: 变异测试（手工纪律，不 commit 变异）

> CI 里**没有**变异测试的机械闸（`.github/workflows/` grep `变异` 零命中），
> 这是写在 smoke 注释里的人工纪律（先例：`scripts/smoke/qiumi-dispatch-smoke.mjs:15`）。
> 没见过它报红的守卫不算守卫。

- [ ] **Step 1: 变异点 A —— 改 builder 的键名**

把 `packages/brain/src/lib/qiumi-source.js` 里 `agent_workflow_ids: agentWorkflowIds,`
临时改成 `agent_workflow_ids_MUTANT: agentWorkflowIds,`，然后：

```bash
cd packages/brain && npx vitest run src/routing/__tests__/qiumi-source-cheapgates-contract.test.js
```

Expected: **断言红**，形如 `expected null to be '周报生成'`（不是 `TypeError` / `Cannot read`）。
若是崩溃红，说明 `cheap-gates.js` 的 `?? []` 兜底被删了，必须补回。

改回原样，重跑确认转绿。

- [ ] **Step 2: 变异点 B —— 让实现只喂 workflows 池**

把 `cheap-gates.js` 里 agents 那一趟整段注释掉，然后：

```bash
cd packages/brain && npx vitest run src/routing/__tests__/qiumi-source-cheapgates-contract.test.js
```

Expected: **断言红**，"填了 agent → department 命中" 那条报 `expected null to be 'infra'`。
这证明契约测试挡得住"忘了喂 agents 池"。

改回原样，重跑确认转绿。

- [ ] **Step 3: 变异点 C —— 合成一趟遍历**

把两个 for 循环合成一趟（遍历 `relIds`，每个 id 两池都试），然后：

```bash
cd packages/brain && npx vitest run src/routing/__tests__/qiumi-source-cheapgates-contract.test.js
```

Expected: **断言红**，"同时填 workflow 与 agent → matchedBy 顺序恒为 workflow 在前" 那条报
`matchedBy` 顺序不符。这证明"必须分两趟"这条约束被机械钉住了，不是只写在注释里。

改回原样，重跑确认转绿。

- [ ] **Step 4: 确认工作区干净**

```bash
git status --short
```

Expected: 空输出（三次变异全部改回，没有残留）。

---

## Task 7: 全量回归 + 推送

- [ ] **Step 1: 跑 brain 全量测试**

```bash
cd packages/brain && npx vitest run
```

Expected: 全 PASS，无新增失败。

- [ ] **Step 2: 本地跑相关 lint**

```bash
cd /Users/administrator/worktrees/cecelia/qiumi-cheapgates-relation
bash .github/workflows/scripts/lint-test-pairing.sh
bash .github/workflows/scripts/lint-tdd-commit-order.sh
```

Expected: 两个都 exit 0。`lint-test-pairing` 需 `src/lib/qiumi-source.js` 有
`src/lib/__tests__/qiumi-source.test.js`（Task 1 已建）；`lint-tdd-commit-order`
需 commit-1（纯测试）排在 commit-2（动 src）之前。

- [ ] **Step 3: 推送并开 PR**

```bash
git push -u origin cp-0923184138-qiumi-cheapgates-relation
```

PR 标题（**前缀必须 `fix:`，不打 feature label**，否则触发 `lint-feature-has-smoke` 要求新增 smoke）：

```
fix(brain): 便宜闸读不到 Notion 指定的 Agent/Workflow — 规格分叉修复 + 共享真身
```

---

## Self-Review 结果

**Spec 覆盖**：spec 的 §3.1→Task 2 Step 2；§3.2→Task 2 Step 3；§3.3→Task 5；§3.4 甲类→Task 3、乙类→Task 4；
§3.5 行为声明→Task 3 Step 5（保断言）+ Task 6 Step 2；§4 错误路径→Task 1 Step 2 的五条契约用例 + Task 3 Step 3；
§5 测试策略→Task 1 + Task 6；§6 CI 约束→Task 7 Step 2。无遗漏。

**占位符**：无 TBD/TODO；每个改代码的 Step 都给了完整前后代码。

**命名一致性**：`buildQiumiSource` / `qiumiSourceFromNotion` 两个名字在 Task 1（测试）、Task 2（实现）、
Task 3/4（消费方）全文一致；参数名 `agentWorkflowIds`（驼峰，入参）与 `agent_workflow_ids`（蛇形，出参键）
的区分在 Task 2 Step 1 的代码里明确。
