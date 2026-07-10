# T6 指挥台配套 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 晨报加军师决策节 + 新增 GET /api/brain/issues 与战斗室 Issues 面板 + 放开 claude+headed 派发接通 tmux 有头链路。

**Architecture:** 三个独立子改动共一个 PR：battle-report.js 加第五节（消费 notes 表军师决策）；journeys.js 加只读列表路由 + WarRoomPanels 克隆 DecisionStream 模式加 IssuesPanel；task-tasks.js/harness-skill-relay.js/harness-relay-watchdog.js 三处把 headed tmux 链路从 codex-only 泛化为 codex|claude。

**Tech Stack:** Node ESM + vitest（`vi.mock('../db.js')` + supertest 路由测试先例）+ React/TS（纯函数行映射 + usePolled 轮询先例）。

**规矩：**
- 每个 Task 两个 commit：commit-1 失败测试（Red），commit-2 实现（Green）。NO PRODUCTION CODE WITHOUT FAILING TEST FIRST。
- 单测跑法：`cd packages/brain && npx vitest run src/__tests__/<file> --reporter=basic`（禁全量 vitest，环境级 OOM）。Dashboard：`cd apps/dashboard && npx vitest run src/pages/warroom/__tests__/WarRoomPanels.test.ts`。
- 涉及真实 postgres 的测试放 `src/__tests__/integration/`（本计划全部用 fake pool，放 `src/__tests__/` 即可）。
- Red commit 的 message 不得以 `feat:` 开头（用 `test:`），避免误触 CI 闸。

---

### Task 1: battle-report 军师决策节

**Files:**
- Modify: `packages/brain/src/battle-report.js`（buildBattleReportData 约 134 行 return 前加第⑤路查询；renderBattleReportMarkdown 约 196 行"用户决策"节之后加渲染段）
- Test: `packages/brain/src/__tests__/battle-report.test.js`（追加 describe）

- [ ] **Step 1: 写失败测试**（追加到 battle-report.test.js 末尾；文件顶部 import 已含所需函数，无需改）

```js
describe('军师决策节（T6）', () => {
  it('buildBattleReportData 查询 notes 军师决策并返回 strategistDecisions', async () => {
    const pool = {
      query: vi.fn(async (sql) => {
        if (/FROM notes/i.test(sql)) {
          return { rows: [
            { title: '军师决策[内容线]: 停发短贴改测长文', content: 'x', created_at: '2026-07-10T01:00:00Z' },
            { title: '军师决策[发布线]: 快手渠道降频', content: 'y', created_at: '2026-07-10T02:00:00Z' },
          ] };
        }
        return { rows: [] };
      }),
    };
    const data = await buildBattleReportData(pool);
    expect(data.strategistDecisions).toHaveLength(2);
    const notesSql = pool.query.mock.calls.map(c => c[0]).find(s => /FROM notes/i.test(s));
    expect(notesSql).toMatch(/type\s*=\s*'Decision'/);
    expect(notesSql).toMatch(/军师决策\[/);
    expect(notesSql).toMatch(/24 hours/);
  });

  it('notes 查询抛错 → 降级空数组，其余节不受影响', async () => {
    const pool = {
      query: vi.fn(async (sql) => {
        if (/FROM notes/i.test(sql)) throw new Error('relation notes does not exist');
        return { rows: [] };
      }),
    };
    const data = await buildBattleReportData(pool);
    expect(data.strategistDecisions).toEqual([]);
    expect(data.journeyRuns).toEqual([]);
  });

  it('渲染：按 Line 分组 + 标题剥前缀', () => {
    const md = renderBattleReportMarkdown({
      mergedPrs: [], journeyRuns: [], userDecisions: [],
      strategistDecisions: [
        { title: '军师决策[内容线]: 停发短贴改测长文', created_at: '2026-07-10T01:00:00Z' },
        { title: '军师决策[内容线]: 长文每日一篇', created_at: '2026-07-10T00:30:00Z' },
        { title: '军师决策[发布线]: 快手渠道降频', created_at: '2026-07-10T02:00:00Z' },
      ],
      sentinel: { jobs: [], expected: null, healthy: false },
    });
    expect(md).toContain('## 军师决策（24h）');
    expect(md).toContain('### 内容线');
    expect(md).toContain('### 发布线');
    expect(md).toContain('- 停发短贴改测长文');
    expect(md).not.toContain('军师决策[内容线]');
  });

  it('渲染：无军师决策 → 暂无；strategistDecisions 缺省（旧数据形状）不炸', () => {
    const base = { mergedPrs: [], journeyRuns: [], userDecisions: [], sentinel: { jobs: [], expected: null, healthy: false } };
    const md1 = renderBattleReportMarkdown({ ...base, strategistDecisions: [] });
    expect(md1).toMatch(/## 军师决策（24h）\n暂无/);
    expect(() => renderBattleReportMarkdown(base)).not.toThrow();
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd packages/brain && npx vitest run src/__tests__/battle-report.test.js --reporter=basic`
Expected: FAIL（strategistDecisions undefined / 渲染无该节）

- [ ] **Step 3: commit-1**

```bash
git add packages/brain/src/__tests__/battle-report.test.js
git commit -m "test(brain): battle-report 军师决策节失败测试（T6 88e0b448）"
```

- [ ] **Step 4: 实现**。`buildBattleReportData` 中哨兵段之后、`return` 之前插入：

```js
  // ⑤ 军师决策（notes 表，line-strategist 落痕：type='Decision' + 标题前缀"军师决策["；
  //    照 warroom.js:404 先例 try/catch 降级——notes 表缺失/查询失败不拖垮整份日报）
  let strategistDecisions = [];
  try {
    const { rows } = await pool.query(
      `SELECT title, content, created_at
       FROM notes
       WHERE type = 'Decision'
         AND title LIKE '军师决策[%'
         AND created_at >= NOW() - interval '24 hours'
       ORDER BY created_at DESC
       LIMIT 50`
    );
    strategistDecisions = rows;
  } catch (err) {
    console.warn(`[battle-report] 军师决策查询失败（降级空）: ${err.message}`);
  }
```

并把 return 改为：

```js
  return { mergedPrs, journeyRuns, userDecisions, strategistDecisions, sentinel: { jobs, expected, healthy } };
```

`renderBattleReportMarkdown` 中"用户决策"段之后（`lines.push('');` `lines.push('## 哨兵摘要');` 之前）插入：

```js
  lines.push('');
  lines.push('## 军师决策（24h）');
  const sd = data.strategistDecisions || [];
  if (sd.length === 0) {
    lines.push('暂无');
  } else {
    const byLine = new Map();
    for (const n of sd) {
      const m = /^军师决策\[([^\]]*)\]/.exec(n.title || '');
      const lineName = (m && m[1]) || '未知线';
      if (!byLine.has(lineName)) byLine.set(lineName, []);
      byLine.get(lineName).push(n);
    }
    for (const [lineName, items] of byLine) {
      lines.push(`### ${lineName}`);
      for (const n of items) {
        const summary = (n.title || '').replace(/^军师决策\[[^\]]*\]:?\s*/, '') || '(无标题)';
        lines.push(`- ${summary}（${formatShanghaiShort(n.created_at)}）`);
      }
    }
  }
```

同步更新文件头注释（第 4-9 行的节清单加一条 ⑤ 军师决策）。

- [ ] **Step 5: 跑测试确认全绿**（同 Step 2 命令，含旧用例回归）

- [ ] **Step 6: commit-2**

```bash
git add packages/brain/src/battle-report.js
git commit -m "feat(brain): battle-report 加军师决策节——按 Line 分组聚合 notes 军师落痕"
```

---

### Task 2: GET /api/brain/issues 列表 API

**Files:**
- Modify: `packages/brain/src/routes/journeys.js`（POST /issues 之后、GET /journey_steps 之前插入）
- Test: Create `packages/brain/src/__tests__/issues-list-route.test.js`

- [ ] **Step 1: 写失败测试**

```js
import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

const queryMock = vi.fn();
vi.mock('../db.js', () => ({ default: { query: (...a) => queryMock(...a) } }));

const { default: journeysRouter } = await import('../routes/journeys.js');

function makeApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/brain', journeysRouter);
  return app;
}

beforeEach(() => { queryMock.mockReset(); });

describe('GET /api/brain/issues（T6）', () => {
  it('无参：默认 limit 20，返回 {issues:[...]}', async () => {
    queryMock.mockResolvedValue({ rows: [{ id: 'i1', title: 'x', priority: 'P1', status: 'In progress' }] });
    const res = await request(makeApp()).get('/api/brain/issues');
    expect(res.status).toBe(200);
    expect(res.body.issues).toHaveLength(1);
    const [sql, params] = queryMock.mock.calls[0];
    expect(sql).toMatch(/FROM issues/);
    expect(sql).toMatch(/ORDER BY priority ASC, created_at DESC/);
    expect(params[params.length - 1]).toBe(20);
  });

  it('status + journey_id 过滤进 WHERE，limit 钳制到 100', async () => {
    queryMock.mockResolvedValue({ rows: [] });
    const res = await request(makeApp()).get('/api/brain/issues?status=open&journey_id=j-1&limit=999');
    expect(res.status).toBe(200);
    const [sql, params] = queryMock.mock.calls[0];
    expect(sql).toMatch(/status=\$1/);
    expect(sql).toMatch(/journey_id=\$2/);
    expect(params).toEqual(['open', 'j-1', 100]);
  });

  it('查询抛错 → 500 + error', async () => {
    queryMock.mockRejectedValue(new Error('boom'));
    const res = await request(makeApp()).get('/api/brain/issues');
    expect(res.status).toBe(500);
    expect(res.body.error).toBe('boom');
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd packages/brain && npx vitest run src/__tests__/issues-list-route.test.js --reporter=basic`
Expected: FAIL（GET /issues 404）

- [ ] **Step 3: commit-1**

```bash
git add packages/brain/src/__tests__/issues-list-route.test.js
git commit -m "test(brain): GET /api/brain/issues 列表路由失败测试"
```

- [ ] **Step 4: 实现**。journeys.js 中 `POST /issues` 块（229 行 `});` ）之后插入：

```js
// GET /api/brain/issues — 列表（战斗室 Issues 面板 + line-strategist skill 消费；T6 88e0b448）
router.get('/issues', async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit) || 20, 100);
    const params = [];
    const clauses = [];
    if (req.query.status) { params.push(req.query.status); clauses.push(`status=$${params.length}`); }
    if (req.query.journey_id) { params.push(req.query.journey_id); clauses.push(`journey_id=$${params.length}`); }
    const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
    params.push(limit);
    const { rows } = await pool.query(
      `SELECT id, title, priority, status, sub_area, journey_id, pr_url, created_at
       FROM issues ${where}
       ORDER BY priority ASC, created_at DESC
       LIMIT $${params.length}`,
      params
    );
    res.json({ issues: rows });
  } catch (err) {
    console.error('[journeys] GET /issues error:', err.message);
    res.status(500).json({ error: err.message });
  }
});
```

- [ ] **Step 5: 跑测试确认全绿**（同 Step 2 命令）

- [ ] **Step 6: commit-2**

```bash
git add packages/brain/src/routes/journeys.js
git commit -m "feat(brain): 新增 GET /api/brain/issues 列表 API（修复 line-strategist 404 缺口）"
```

---

### Task 3: task-tasks.js 放开 claude+headed + spawn 内部防御反转

**Files:**
- Modify: `packages/brain/src/routes/task-tasks.js:113-118`（B1 段）
- Modify: `packages/brain/src/harness-skill-relay.js:76-79`（内部防御）
- Test: Modify `packages/brain/src/__tests__/headed-dispatch.test.js`（第 169-190 行"3. claude+headed → 拒绝路由" describe 反转）

- [ ] **Step 1: 反转测试**。把 headed-dispatch.test.js 里 `describe('3. claude+headed → 拒绝路由', ...)` 整段改为（保留原有 fake 注入方式，只反转断言方向；读原用例后沿用其 deps 构造）：

```js
describe('3. claude+headed → 放行（T6 解锁）', () => {
  it('executor=claude + mode=headed → 不再被 spawnSkillRelaySession 内部防御拒绝', async () => {
    const task = {
      id: '00000000-0000-0000-0000-00000000c1de',
      title: 'claude headed unlocked',
      payload: { orchestrator: 'skill-relay', executor: 'claude', mode: 'headed' },
    };
    const calls = [];
    const fakePool = { query: vi.fn().mockResolvedValue({ rows: [] }) };
    const result = await spawnSkillRelaySession(task, {
      pool: fakePool,
      execFn: (cmd) => { calls.push(cmd); return 'TMUX_DEAD'; },
      inDockerFn: () => false,
      sshKeyFn: () => null,
      loadSkill: () => 'SKILL CONTENT',
      ensureWt: async () => '/tmp/fake-worktree',
      now: () => new Date('2026-07-10T04:00:00Z'),
    });
    // 不再返回"不支持 headed"错误；走 headed 分支（mode 为 claude headed host 值）
    expect(result.error || '').not.toMatch(/不支持 headed/);
    expect(result.mode).toBe('skill-relay-claude-headed');
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd packages/brain && npx vitest run src/__tests__/headed-dispatch.test.js --reporter=basic`
Expected: 新用例 FAIL（当前返回 `executor=claude 不支持 headed 模式`），其余 codex 用例 PASS

- [ ] **Step 3: commit-1**

```bash
git add packages/brain/src/__tests__/headed-dispatch.test.js
git commit -m "test(brain): claude+headed 放行测试反转（routing-doctrine：Claude=有头）"
```

- [ ] **Step 4: 实现两处删除**
  - task-tasks.js：删除 116-118 行整个 if 块（`if (executor === 'claude' && mode === 'headed') { return res.status(400)... }`），并把 112 行注释改为 `// mode 白名单：缺省/headless/headed 合法（claude+headed 已解锁，T6 88e0b448）`。
  - harness-skill-relay.js：删除 76-79 行内部防御 if 块及其注释。

（注意：Task 4 未完成前 claude 会错走 codex tmux 命令——本 Task 的测试断言 `mode === 'skill-relay-claude-headed'` 在 Task 4 完成前仍红是预期的；若按顺序单独交付本 Task，Step 5 只要求"不再返回不支持错误"的断言绿。推荐 Task 3/4 由同一实现者连续完成后一起跑绿。）

- [ ] **Step 5: commit-2**

```bash
git add packages/brain/src/routes/task-tasks.js packages/brain/src/harness-skill-relay.js
git commit -m "feat(brain): 放开 claude+headed 派发白名单（入口+spawn 双层）"
```

---

### Task 4: _spawnHeadedSession 泛化支持 claude（tmux 起 claude-launch.sh）

**Files:**
- Modify: `packages/brain/src/harness-skill-relay.js`（306-509 行 headed 分支）
- Test: Modify `packages/brain/src/__tests__/headed-dispatch.test.js`（追加 describe）

- [ ] **Step 1: 写失败测试**（追加）

```js
describe('4. claude headed 分支（T6）', () => {
  function makeDeps(calls, insertCapture) {
    return {
      pool: { query: vi.fn(async (sql, params) => { if (/INSERT INTO initiative_runs/i.test(sql)) insertCapture.push(params || sql); return { rows: [] }; }) },
      execFn: (cmd) => { calls.push(cmd); return 'TMUX_DEAD'; },
      inDockerFn: () => false,
      sshKeyFn: () => null,
      loadSkill: () => 'SKILL CONTENT',
      ensureWt: async () => '/tmp/fake-worktree',
      now: () => new Date('2026-07-10T04:00:00Z'),
    };
  }

  it('executor=claude → tmux 命令跑 claude-launch.sh，session 前缀 claude-relay-，不含 CODEX_HOME', async () => {
    const calls = []; const inserts = [];
    const task = { id: '00000000-0000-0000-0000-00000000c1de', title: 't', payload: { orchestrator: 'skill-relay', executor: 'claude', mode: 'headed' } };
    const result = await spawnSkillRelaySession(task, makeDeps(calls, inserts));
    expect(result.ok).toBe(true);
    expect(result.mode).toBe('skill-relay-claude-headed');
    expect(result.tmuxSession).toMatch(/^claude-relay-/);
    const tmuxCmd = calls.find((c) => c.includes('tmux new-session'));
    expect(tmuxCmd).toContain('claude-launch.sh');
    expect(tmuxCmd).toContain('--dangerously-skip-permissions');
    expect(tmuxCmd).not.toContain('CODEX_HOME');
    expect(tmuxCmd).not.toContain(' codex ');
  });

  it('executor=claude → 跳过 codex trust preseed（无 config.toml 写入命令）', async () => {
    const calls = []; const inserts = [];
    process.env.CODEX_RELAY_HOME = '/tmp/fake-codex-home';
    try {
      const task = { id: '00000000-0000-0000-0000-00000000c1df', title: 't', payload: { orchestrator: 'skill-relay', executor: 'claude', mode: 'headed' } };
      await spawnSkillRelaySession(task, makeDeps(calls, inserts));
      expect(calls.some((c) => c.includes('config.toml'))).toBe(false);
    } finally { delete process.env.CODEX_RELAY_HOME; }
  });

  it('executor=claude → initiative_runs 落 orchestrator_host=skill-relay-claude-headed', async () => {
    const calls = []; const inserts = [];
    const task = { id: '00000000-0000-0000-0000-00000000c1e0', title: 't', payload: { orchestrator: 'skill-relay', executor: 'claude', mode: 'headed' } };
    await spawnSkillRelaySession(task, makeDeps(calls, inserts));
    expect(JSON.stringify(inserts[0])).toContain('skill-relay-claude-headed');
  });

  it('codex headed 路径不回归：仍 codex-relay- 前缀 + CODEX_HOME 注入', async () => {
    const calls = []; const inserts = [];
    process.env.CODEX_RELAY_HOME = '/tmp/fake-codex-home';
    try {
      const task = { id: '00000000-0000-0000-0000-00000000c1e1', title: 't', payload: { orchestrator: 'skill-relay', executor: 'codex', mode: 'headed' } };
      const result = await spawnSkillRelaySession(task, makeDeps(calls, inserts));
      expect(result.ok).toBe(true);
      expect(result.mode).toBe('skill-relay-codex-headed');
      expect(result.tmuxSession).toMatch(/^codex-relay-/);
      const tmuxCmd = calls.find((c) => c.includes('tmux new-session'));
      expect(tmuxCmd).toContain('CODEX_HOME');
    } finally { delete process.env.CODEX_RELAY_HOME; }
  });
});
```

（若 headed-dispatch.test.js 现有 codex 用例对 INSERT initiative_runs 的 mock 形状不同，以现有文件形状为准微调，断言目标不变。）

- [ ] **Step 2: 跑测试确认失败**（同 Task 3 Step 2 命令）

- [ ] **Step 3: commit-1**

```bash
git add packages/brain/src/__tests__/headed-dispatch.test.js
git commit -m "test(brain): _spawnHeadedSession claude 分支失败测试"
```

- [ ] **Step 4: 实现泛化**。harness-skill-relay.js 改动清单：

304-307 行常量区改为：

```js
// ─── headed 分支实现 ──────────────────────────────────────────────────────────

// T6（88e0b448）：headed tmux 链路从 codex-only 泛化为 codex|claude。
// host 值与 tmux session 前缀按 executor 映射；watchdog（harness-relay-watchdog.js）
// 用同一映射做存活检测/收窗，两边改动必须同步。
const HEADED_HOSTS = {
  codex: 'skill-relay-codex-headed',
  claude: 'skill-relay-claude-headed',
};
const HEADED_TMUX_PREFIXES = { codex: 'codex-relay-', claude: 'claude-relay-' };
const HEADED_RELAY_DEADLINE_HOURS = 8;
```

`_spawnHeadedSession` 函数体改动：

1. 函数开头加：

```js
  const headedExecutor = task.payload?.executor === 'claude' ? 'claude' : 'codex';
  const headedHost = HEADED_HOSTS[headedExecutor];
  const isClaudeHeaded = headedExecutor === 'claude';
```

2. B6 CODEX_RELAY_HOME 门禁（317-329 行）整块包进 `if (!isClaudeHeaded) { ... }`（claude 不依赖 codex 凭据目录），并把原注释"headed 恒为 codex executor"改为"codex headed 需凭据目录；claude headed 不适用"。注意 `codexRelayHome` 变量声明保留在 if 外（后面 trust preseed 段引用）。

3. `const tmuxSession = \`codex-relay-${short}\`;`（349 行）改为：

```js
  const tmuxSession = `${HEADED_TMUX_PREFIXES[headedExecutor]}${short}`;
```

4. 所有 `mode: HEADED_ORCHESTRATOR_HOST` 返回值（328/373/441/461/480/508 行）替换为 `mode: headedHost`；`HEADED_ORCHESTRATOR_HOST` 常量删除。

5. prompt 组装（394-405 行）第一行 `headed 模式` 描述不变，`BRAIN_URL` 一行改为 `BRAIN_URL=http://localhost:5221`——仅 claude 分支；codex 分支保持 `http://host.docker.internal:5221` 原值。实现方式：

```js
  const brainUrl = isClaudeHeaded ? 'http://localhost:5221' : 'http://host.docker.internal:5221';
```

（claude-launch.sh 在宿主直跑，host.docker.internal 对宿主进程不可达是已知形态；codex 原值不动防回归。）prompt 数组里 `BRAIN_URL=${brainUrl}`。

6. trust preseed 雷9 段（413-424 行）：外层条件 `if (codexRelayHome)` 改为 `if (!isClaudeHeaded && codexRelayHome)`；else 分支 warn 同样只在 codex 时打（`else if (!isClaudeHeaded)`）。

7. tmux new-session 命令（451-454 行）改为按 executor 分叉：

```js
    // claude headed：宿主 claude-launch.sh（自动补 --session-id，位置参数=交互初始 prompt，
    // tmux 提供 TTY——youtou-dispatch-pattern 首航实证）。宿主 repo 根可被 CECELIA_HOST_REPO
    // 覆盖（对齐 spawn/host-executor.js 先例）；HEADED_CLAUDE_CONFIG_DIR 可显式指定账号目录，
    // 未配置时由 launcher 按 .active-account-dir 路由（会烧当前交互账号，主理人知情接受）。
    const hostRepo = process.env.CECELIA_HOST_REPO || '/Users/administrator/perfect21/cecelia';
    const claudeCfgPrefix = process.env.HEADED_CLAUDE_CONFIG_DIR
      ? `CLAUDE_CONFIG_DIR=${process.env.HEADED_CLAUDE_CONFIG_DIR} ` : '';
    const innerCmd = isClaudeHeaded
      ? `cd ${worktreePath} && ${claudeCfgPrefix}bash ${hostRepo}/scripts/claude-launch.sh --dangerously-skip-permissions \\"\\$(cat ${promptFile})\\"`
      : `cd ${worktreePath} && CODEX_HOME=${codexRelayHome || ''} codex --dangerously-bypass-approvals-and-sandbox \\"\\$(cat ${promptFile})\\"`;
    try {
      execFn(
        `ssh ${SSH_OPTS} ${sshHost} "tmux new-session -d -s ${tmuxSession} '${innerCmd}'"`
      );
```

8. initiative_runs INSERT（486-491 行）：`orchestrator_host` 从内联字符串改为参数：

```js
  await dbPool.query(
    `INSERT INTO initiative_runs
       (initiative_id, phase, journey_id, orchestrator_version, orchestrator_host, deadline_at, ability_id)
     VALUES ($1, 'A_planning', $2, 'v2', $3, NOW() + INTERVAL '${HEADED_RELAY_DEADLINE_HOURS} hours', $4)`,
    [initiativeId, task.payload?.journey_id || null, headedHost, headedAbilityId]
  );
```

9. 文件顶部导出（供 watchdog 复用映射）：`export { HEADED_HOSTS, HEADED_TMUX_PREFIXES };`（放常量定义后）。

> **实现偏差说明（Step 8）**：实现保持 orchestrator_host 内联进 SQL（`'${headedHost}'`），未参数化——既有 codex 用例对 INSERT SQL 文本断言 `sql.toContain('skill-relay-codex-headed')`，参数化会破坏回归；headedHost 来自 HEADED_HOSTS 固定映射，无注入面。

- [ ] **Step 5: 跑测试确认全绿**（headed-dispatch.test.js 全文件 + harness-skill-relay.test.js 回归）

Run: `cd packages/brain && npx vitest run src/__tests__/headed-dispatch.test.js src/__tests__/harness-skill-relay.test.js --reporter=basic`
Expected: 全 PASS

- [ ] **Step 6: commit-2**

```bash
git add packages/brain/src/harness-skill-relay.js
git commit -m "feat(brain): _spawnHeadedSession 泛化 claude——tmux 起 claude-launch.sh 接通有头链路"
```

---

### Task 5: watchdog 识别 claude headed（两值 + 前缀映射）

**Files:**
- Modify: `packages/brain/src/harness-relay-watchdog.js`（67 行 SQL、115 行等值、263/280 行前缀）
- Test: Modify `packages/brain/src/__tests__/headed-watchdog.test.js`（追加 describe）

- [ ] **Step 1: 写失败测试**（追加到 headed-watchdog.test.js；沿用该文件现有 fake pool/execFn 构造模式——先读该文件，用与现有 codex headed 用例完全同构的 deps，仅把 orchestrator_host 换成 `skill-relay-claude-headed`）：

```js
describe('claude headed run（T6）', () => {
  it('orchestrator_host=skill-relay-claude-headed 的 run 被扫描，tmux 检查用 claude-relay- 前缀', async () => {
    // 照本文件现有"codex headed A_planning session 存活"用例复制，改两点：
    // ① runsQ 返回行 orchestrator_host: 'skill-relay-claude-headed'
    // ② 断言 execFn 收到的 tmux has-session 命令含 'claude-relay-'
  });
  it('claude headed run phase=done 超 30min → kill-session 用 claude-relay- 前缀收窗', async () => {
    // 照现有"codex headed 收窗"用例复制，改 host 值，断言 kill-session 命令含 'claude-relay-'
  });
});
```

（此处两个用例体照抄同文件 codex 用例结构填实——subagent 执行时必须先 Read headed-watchdog.test.js 再写，禁止凭空造 deps 形状。断言目标如注释。）

- [ ] **Step 2: 跑测试确认失败**

Run: `cd packages/brain && npx vitest run src/__tests__/headed-watchdog.test.js --reporter=basic`
Expected: 新用例 FAIL（claude host 不进 headed 分支 / 前缀错）

- [ ] **Step 3: commit-1**

```bash
git add packages/brain/src/__tests__/headed-watchdog.test.js
git commit -m "test(brain): watchdog claude headed 识别失败测试"
```

- [ ] **Step 4: 实现**。harness-relay-watchdog.js：

1. 文件顶部 import 区加：

```js
import { HEADED_HOSTS, HEADED_TMUX_PREFIXES } from './harness-skill-relay.js';

const HEADED_HOST_VALUES = Object.values(HEADED_HOSTS); // ['skill-relay-codex-headed','skill-relay-claude-headed']
```

2. 67 行 SQL 里 `(orchestrator_host = 'skill-relay-codex-headed' AND phase = 'done' AND tmux_killed_at IS NULL)` 改为 `(orchestrator_host IN ('skill-relay-codex-headed','skill-relay-claude-headed') AND phase = 'done' AND tmux_killed_at IS NULL)`（SQL 内联两值，与 JS 常量的同步靠 Task 4 注释声明）。

3. 115 行 `if (run.orchestrator_host === 'skill-relay-codex-headed')` 改为 `if (HEADED_HOST_VALUES.includes(run.orchestrator_host))`。

4. 263 行 `const HEADED_TMUX_SESSION_PREFIX = 'codex-relay-';` 删除；280 行改为：

```js
  const prefix = run.orchestrator_host === HEADED_HOSTS.claude
    ? HEADED_TMUX_PREFIXES.claude : HEADED_TMUX_PREFIXES.codex;
  const tmuxSession = `${prefix}${short}`;
```

- [ ] **Step 5: 跑测试确认全绿**（headed-watchdog.test.js + harness-relay-watchdog.test.js 回归）

Run: `cd packages/brain && npx vitest run src/__tests__/headed-watchdog.test.js src/__tests__/harness-relay-watchdog.test.js --reporter=basic`
Expected: 全 PASS

- [ ] **Step 6: commit-2**

```bash
git add packages/brain/src/harness-relay-watchdog.js
git commit -m "feat(brain): relay-watchdog 识别 claude headed run（host 两值+tmux 前缀映射）"
```

---

### Task 6: Dashboard 战斗室 Issues 面板

**Files:**
- Modify: `apps/dashboard/src/pages/warroom/WarRoomPanels.tsx`（加 issueRows 纯函数 + IssuesPanel 组件）
- Modify: `apps/dashboard/src/pages/warroom/WarRoomPage.tsx:1607-1610`（grid 加第三面板）
- Test: Modify `apps/dashboard/src/pages/warroom/__tests__/WarRoomPanels.test.ts`（追加 issueRows 用例）

- [ ] **Step 1: 写失败测试**（追加到 WarRoomPanels.test.ts，import 区加 `issueRows`）

```ts
describe('issueRows（T6 Issues 面板）', () => {
  it('{issues:[...]} 包装 → 行映射', () => {
    const rows = issueRows({ issues: [
      { id: 'i1', title: '收割器误删', priority: 'P0', status: 'In progress', sub_area: 'brain', created_at: '2026-07-10T01:00:00Z' },
    ] });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ id: 'i1', title: '收割器误删', priority: 'P0', status: 'In progress', sub_area: 'brain' });
  });
  it('非法输入（null/缺 issues/非数组）→ 空数组', () => {
    expect(issueRows(null)).toEqual([]);
    expect(issueRows({})).toEqual([]);
    expect(issueRows({ issues: 'x' })).toEqual([]);
  });
  it('字段缺省容错', () => {
    const rows = issueRows({ issues: [{}] });
    expect(rows[0]).toMatchObject({ id: '', title: '', priority: '', status: '', sub_area: '', created_at: null });
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd apps/dashboard && npx vitest run src/pages/warroom/__tests__/WarRoomPanels.test.ts`
Expected: FAIL（issueRows 未导出）

- [ ] **Step 3: commit-1**

```bash
git add apps/dashboard/src/pages/warroom/__tests__/WarRoomPanels.test.ts
git commit -m "test(dashboard): issueRows 行映射失败测试"
```

- [ ] **Step 4: 实现**。WarRoomPanels.tsx：

① 纯函数区（decisionRows 之后）加：

```ts
export interface IssueRow {
  id: string; title: string; priority: string; status: string; sub_area: string; created_at: string | null;
}

/** /api/brain/issues 响应（{issues} 包装）→ 面板行 */
export function issueRows(resp: unknown): IssueRow[] {
  const list = (resp as { issues?: unknown })?.issues;
  if (!Array.isArray(list)) return [];
  return list.map((i) => ({
    id: String(i?.id ?? ''),
    title: String(i?.title ?? ''),
    priority: typeof i?.priority === 'string' ? i.priority : '',
    status: typeof i?.status === 'string' ? i.status : '',
    sub_area: typeof i?.sub_area === 'string' ? i.sub_area : '',
    created_at: i?.created_at ?? null,
  }));
}

/** priority → 徽标样式（P0 红 / P1 琥珀 / 其余灰） */
export function issuePriorityPill(priority: string): string {
  if (priority === 'P0') return 'bg-red-500/15 text-red-400';
  if (priority === 'P1') return 'bg-amber-500/15 text-amber-400';
  return 'bg-slate-700/40 text-slate-400';
}
```

② import 区 lucide 加 `Bug`（`import { Gavel, ArrowRightLeft, Bug } from 'lucide-react';`）。

③ 组件区（DecisionStream 之后）加：

```tsx
/** Issues 面板：全局最近 issues（战斗室指挥台，T6） */
export function IssuesPanel() {
  const resp = usePolled<unknown>('/api/brain/issues?limit=8');
  const rows = issueRows(resp);
  return (
    <div className="rounded-lg border border-slate-800/60 bg-slate-900/20 p-3">
      <div className="flex items-center gap-2 mb-2">
        <Bug className="w-3.5 h-3.5 text-red-400" />
        <span className="text-[12px] tracking-[0.1em] uppercase text-slate-400 font-bold">Issues</span>
        <span className="text-[11px] text-slate-700 font-mono">{rows.length} 条</span>
      </div>
      {rows.length === 0 ? (
        <div className="text-[12px] text-slate-700">暂无 issue</div>
      ) : (
        <div className="space-y-1.5 max-h-44 overflow-y-auto pr-1">
          {rows.map((i) => (
            <div key={i.id} className="flex items-center gap-1.5 text-[12px]">
              <span className={`text-[10px] tracking-wide px-1 py-px rounded font-bold flex-shrink-0 ${issuePriorityPill(i.priority)}`}>{i.priority || '—'}</span>
              <span className="text-slate-300 truncate" title={i.title}>{i.title}</span>
              {i.sub_area && <span className="text-slate-600 flex-shrink-0">{i.sub_area}</span>}
              <span className="ml-auto text-slate-700 flex-shrink-0" title={i.created_at ? absoluteShanghai(i.created_at) : ''}>{i.created_at ? relativeTime(i.created_at) : ''}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
```

④ 文件头注释的板块清单加一行 `IssuesPanel   Issues 面板（/api/brain/issues）`。

WarRoomPage.tsx：1607-1610 行改为（import 区把 `IssuesPanel` 加进 WarRoomPanels 的既有 import）：

```tsx
              <div className="grid grid-cols-1 xl:grid-cols-3 gap-3 px-4 pt-3">
                <HandoffStream />
                <DecisionStream />
                <IssuesPanel />
              </div>
```

- [ ] **Step 5: 跑测试确认全绿 + 构建**

Run: `cd apps/dashboard && npx vitest run src/pages/warroom/__tests__/WarRoomPanels.test.ts && npx tsc --noEmit -p tsconfig.json 2>&1 | head -20`
Expected: 测试 PASS，tsc 无新增错误

- [ ] **Step 6: commit-2**

```bash
git add apps/dashboard/src/pages/warroom/WarRoomPanels.tsx apps/dashboard/src/pages/warroom/WarRoomPage.tsx
git commit -m "feat(dashboard): 战斗室加 Issues 面板（总览三栏）"
```

---

### Task 7: 版本 bump + DevGate + 收尾

**Files:**
- Modify: `packages/brain/package.json`（minor bump，本次含新 API + 新派发能力）
- Modify: 版本同步四处（按 `bash scripts/check-version-sync.sh` 输出补齐；.brain-versions 用**追加式**写入，禁覆盖）

- [ ] **Step 1: bump 版本**（当前 1.244.x → 1.245.0，以 package.json 实际值为准 minor +1）
- [ ] **Step 2: 跑 DevGate 三件套**

```bash
node scripts/facts-check.mjs
bash scripts/check-version-sync.sh
node packages/engine/scripts/devgate/check-dod-mapping.cjs
```

Expected: 全过；version-sync 报缺处则按输出补齐后重跑。

- [ ] **Step 3: 全量相关测试回归**（只跑本 PR 触碰的测试文件，禁全量 vitest）

```bash
cd packages/brain && npx vitest run src/__tests__/battle-report.test.js src/__tests__/issues-list-route.test.js src/__tests__/headed-dispatch.test.js src/__tests__/harness-skill-relay.test.js src/__tests__/headed-watchdog.test.js src/__tests__/harness-relay-watchdog.test.js --reporter=basic
node --check packages/brain/src/server.js && node --check packages/brain/src/harness-skill-relay.js && node --check packages/brain/src/harness-relay-watchdog.js
```

- [ ] **Step 4: commit**

```bash
git add -A
git commit -m "chore(brain): version bump + DevGate（T6 指挥台配套）"
```

---

## Self-Review 结论

- Spec 覆盖：A→Task1；B→Task2+6；C→Task3+4+5。版本纪律→Task7。无缺口。
- 类型一致性：`HEADED_HOSTS`/`HEADED_TMUX_PREFIXES` 在 Task 4 定义并 export，Task 5 import 同名——一致。`issueRows`/`IssuesPanel`/`issuePriorityPill` 命名 Task 6 内闭环。
- 占位符：Task 5 Step 1 的用例体刻意要求实现者照抄同文件 codex 用例结构（deps 形状必须与现文件一致，凭空写必错），断言目标已写死——非 TBD。
