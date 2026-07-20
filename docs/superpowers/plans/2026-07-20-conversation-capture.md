# 对话原始捕获（conversation raw capture）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 新建一个纯机械（零 LLM）的对话捕获模块，从本机 `~/.claude/projects/*/*.jsonl` 里筛出用户真实打字的文本轮次，写入现有 `captures` 收件箱表（新增 `source=conversation`），10 分钟一轮自动扫描。

**Architecture:** `packages/brain/src/conversation-capture.js` 新增两个导出——纯函数 `extractUserTurns(filePath, sinceMs)` 负责解析单个 JSONL 文件并过滤出真人文本轮次；`runConversationCapture(pool)` 负责扫目录、调用抽取、写入 `captures`（经 `pushCapture()`）、维护 `working_memory` 扫描进度哨兵。`captures.js` 的 `VALID_SOURCES` 加入 `'conversation'`。`scheduler-jobs.js` 的 `JOBS` 数组挂一条新 job，复用现成的 60s 轮询骨架。

**Tech Stack:** Node.js（ESM）、Vitest、PostgreSQL（`pg`，经 `db-config.js` SSOT）。

**参考文档：**
- 设计: `docs/superpowers/specs/2026-07-20-conversation-capture-design.md`
- 架构: `docs/architecture/2026-07-20-conversation-capture/architecture.md`
- DoD: `docs/architecture/2026-07-20-conversation-capture/initiative-dod.md`

---

## Task 1: extractUserTurns 纯函数 + 单元测试

**Files:**
- Create: `packages/brain/src/conversation-capture.js`
- Test: `packages/brain/src/__tests__/conversation-capture.test.js`

真实 Claude Code JSONL 每行一条 JSON 记录（已用本机 `~/.claude/projects/*.jsonl` 实测确认结构）：
- 顶层字段含 `type`（`user`/`assistant`/其他）、`uuid`、`timestamp`（ISO 字符串）、`message: {role, content}`
- `message.role === 'user'` 且 `message.content` 是**字符串** → 真人打字的文本
- `message.role === 'user'` 且 `message.content` 是**数组**、元素 `type==='tool_result'` → 工具执行结果被回灌成 user turn，**必须排除**
- `message.role === 'assistant'` → AI 输出（含 `tool_use` 代码编辑块），**必须排除**
- 非 JSON / 空行 → 跳过，不抛异常

- [ ] **Step 1: 写失败测试**

创建 `packages/brain/src/__tests__/conversation-capture.test.js`：

```js
import { describe, it, expect } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { extractUserTurns } from '../conversation-capture.js';

function writeFixture(lines) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'conv-capture-'));
  const filePath = path.join(dir, 'session.jsonl');
  fs.writeFileSync(filePath, lines.map((l) => JSON.stringify(l)).join('\n') + '\n');
  return filePath;
}

describe('extractUserTurns', () => {
  it('保留 role=user 且 content 为字符串的真人文本', () => {
    const filePath = writeFixture([
      { type: 'user', uuid: 'u1', timestamp: '2026-07-20T01:00:00.000Z', message: { role: 'user', content: '帮我看看这个 bug' } },
    ]);
    const turns = extractUserTurns(filePath, 0);
    expect(turns).toHaveLength(1);
    expect(turns[0].text).toBe('帮我看看这个 bug');
    expect(turns[0].timestamp).toBe('2026-07-20T01:00:00.000Z');
  });

  it('排除 role=user 但 content 是 tool_result 数组的注入消息', () => {
    const filePath = writeFixture([
      { type: 'user', uuid: 'u2', timestamp: '2026-07-20T01:00:01.000Z', message: { role: 'user', content: [{ type: 'tool_result', content: '命令输出...' }] } },
    ]);
    const turns = extractUserTurns(filePath, 0);
    expect(turns).toHaveLength(0);
  });

  it('排除 role=assistant 消息（含 tool_use 代码编辑块）', () => {
    const filePath = writeFixture([
      { type: 'assistant', uuid: 'u3', timestamp: '2026-07-20T01:00:02.000Z', message: { role: 'assistant', content: [{ type: 'text', text: '我来改一下代码' }, { type: 'tool_use', name: 'Edit', input: {} }] } },
    ]);
    const turns = extractUserTurns(filePath, 0);
    expect(turns).toHaveLength(0);
  });

  it('格式损坏的行跳过，不抛异常', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'conv-capture-'));
    const filePath = path.join(dir, 'session.jsonl');
    fs.writeFileSync(filePath, '{not valid json\n' + JSON.stringify({ type: 'user', uuid: 'u4', timestamp: '2026-07-20T01:00:03.000Z', message: { role: 'user', content: '正常这条' } }) + '\n');
    expect(() => extractUserTurns(filePath, 0)).not.toThrow();
    const turns = extractUserTurns(filePath, 0);
    expect(turns).toHaveLength(1);
    expect(turns[0].text).toBe('正常这条');
  });

  it('sinceMs 之前的轮次被跳过', () => {
    const filePath = writeFixture([
      { type: 'user', uuid: 'u5', timestamp: '2026-07-20T01:00:00.000Z', message: { role: 'user', content: '早的一条' } },
      { type: 'user', uuid: 'u6', timestamp: '2026-07-20T02:00:00.000Z', message: { role: 'user', content: '晚的一条' } },
    ]);
    const sinceMs = new Date('2026-07-20T01:30:00.000Z').getTime();
    const turns = extractUserTurns(filePath, sinceMs);
    expect(turns).toHaveLength(1);
    expect(turns[0].text).toBe('晚的一条');
  });

  it('dedupeKey 由文件名 + uuid 生成，同一文件同一 uuid 结果稳定', () => {
    const filePath = writeFixture([
      { type: 'user', uuid: 'stable-uuid', timestamp: '2026-07-20T01:00:00.000Z', message: { role: 'user', content: 'x' } },
    ]);
    const first = extractUserTurns(filePath, 0);
    const second = extractUserTurns(filePath, 0);
    expect(first[0].dedupeKey).toBe(second[0].dedupeKey);
    expect(first[0].dedupeKey).toMatch(/^[a-f0-9]{40}$/);
  });

  it('文件不存在时返回空数组，不抛异常', () => {
    expect(() => extractUserTurns('/tmp/definitely-not-exists-conv-capture.jsonl', 0)).not.toThrow();
    expect(extractUserTurns('/tmp/definitely-not-exists-conv-capture.jsonl', 0)).toEqual([]);
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `cd packages/brain && npx vitest run src/__tests__/conversation-capture.test.js`
Expected: FAIL，报 `Failed to resolve import "../conversation-capture.js"` 或找不到 `extractUserTurns` 导出

- [ ] **Step 3: 写最小实现**

创建 `packages/brain/src/conversation-capture.js`：

```js
/**
 * conversation-capture.js — 对话原始捕获（decision f64adaaf/0c9e1652）
 *
 * 纯机械过滤 ~/.claude/projects/*.jsonl 里 role=user 的真人文本轮次（排除
 * tool_result 注入消息、排除 assistant 消息），零 LLM 成本，写入现有 captures
 * 表（source=conversation）。10 分钟自 gate，接 scheduler-jobs.js。
 *
 * 与已退役的"轨道C conversation-digest"（decision a823206d）的区别：不进
 * LLM、不复用旧表、失败必须可观测（详见 architecture.md 前情提要）。
 */
import fs from 'fs';
import path from 'path';
import os from 'os';
import crypto from 'crypto';
import { pushCapture } from './capture-inbox.js';

export const CLAUDE_PROJECTS_DIR = process.env.CLAUDE_PROJECTS_DIR
  || path.join(os.homedir(), '.claude', 'projects');

const SCAN_INTERVAL_MS = parseInt(process.env.CECELIA_CONVERSATION_CAPTURE_INTERVAL_MS || String(10 * 60 * 1000), 10);
const FIRST_RUN_LOOKBACK_MS = 24 * 60 * 60 * 1000;
const SENTINEL_KEY = 'conversation_capture_last_scan';

let lastRunAt = 0;
export function __resetConversationCaptureForTest() { lastRunAt = 0; }

function dedupeKeyFor(filePath, entry, lineIndex) {
  const idPart = entry.uuid || `line${lineIndex}`;
  const raw = `${path.basename(filePath)}:${idPart}`;
  return crypto.createHash('sha1').update(raw).digest('hex');
}

function isRealUserText(entry) {
  if (entry?.message?.role !== 'user') return false;
  const content = entry.message.content;
  if (typeof content === 'string') return content.trim().length > 0;
  if (Array.isArray(content)) {
    const hasToolResult = content.some((b) => b?.type === 'tool_result');
    if (hasToolResult) return false;
    const textBlocks = content.filter((b) => b?.type === 'text' && b.text?.trim());
    return textBlocks.length > 0;
  }
  return false;
}

function extractText(entry) {
  const content = entry.message.content;
  if (typeof content === 'string') return content.trim();
  return content.filter((b) => b?.type === 'text').map((b) => b.text).join('\n').trim();
}

/**
 * 解析单个 JSONL 会话文件，返回 sinceMs 之后的真人文本轮次。
 * 纯函数：不读写数据库，不产生副作用；格式损坏的行/不存在的文件返回空数组。
 */
export function extractUserTurns(filePath, sinceMs) {
  let content;
  try {
    content = fs.readFileSync(filePath, 'utf8');
  } catch {
    return [];
  }

  const lines = content.split('\n').filter((l) => l.trim());
  const turns = [];

  lines.forEach((line, lineIndex) => {
    let entry;
    try {
      entry = JSON.parse(line);
    } catch {
      return;
    }
    if (!isRealUserText(entry)) return;

    const timestamp = entry.timestamp || null;
    if (timestamp) {
      const ts = new Date(timestamp).getTime();
      if (!Number.isNaN(ts) && ts < sinceMs) return;
    }

    turns.push({
      text: extractText(entry).slice(0, 2000),
      dedupeKey: dedupeKeyFor(filePath, entry, lineIndex),
      timestamp,
    });
  });

  return turns;
}

/**
 * 扫描目录 + 写入 captures + 维护扫描进度哨兵。
 * 10 分钟自 gate（复用 capture-triage.js 的模块自 gate 模型）。
 */
export async function runConversationCapture(pool) {
  const now = Date.now();
  if (now - lastRunAt < SCAN_INTERVAL_MS) return { skipped: true };
  lastRunAt = now;

  if (!fs.existsSync(CLAUDE_PROJECTS_DIR)) {
    return { ok: false, error: 'CLAUDE_PROJECTS_DIR not found', pushed: 0, errors: 0 };
  }

  let lastScanMs;
  try {
    const { rows } = await pool.query(
      `SELECT value_json FROM working_memory WHERE key = $1`,
      [SENTINEL_KEY]
    );
    const lastScanIso = rows[0]?.value_json?.last_scan_at;
    lastScanMs = lastScanIso ? new Date(lastScanIso).getTime() : now - FIRST_RUN_LOOKBACK_MS;
  } catch {
    lastScanMs = now - FIRST_RUN_LOOKBACK_MS;
  }

  let pushed = 0;
  let errors = 0;

  let projectDirs = [];
  try {
    projectDirs = fs.readdirSync(CLAUDE_PROJECTS_DIR, { withFileTypes: true }).filter((d) => d.isDirectory());
  } catch (e) {
    return { ok: false, error: e.message, pushed: 0, errors: 0 };
  }

  for (const dir of projectDirs) {
    const dirPath = path.join(CLAUDE_PROJECTS_DIR, dir.name);
    let files;
    try {
      files = fs.readdirSync(dirPath).filter((f) => f.endsWith('.jsonl'));
    } catch {
      continue;
    }

    for (const file of files) {
      const filePath = path.join(dirPath, file);
      let stat;
      try {
        stat = fs.statSync(filePath);
      } catch {
        continue;
      }
      if (stat.mtimeMs < lastScanMs) continue;

      const turns = extractUserTurns(filePath, lastScanMs);
      for (const turn of turns) {
        try {
          const result = await pushCapture(pool, {
            content: turn.text,
            source: 'conversation',
            repo: dir.name,
            dedupeKey: turn.dedupeKey,
          });
          if (result?.captureId) pushed++;
        } catch (e) {
          errors++;
          console.warn(`[conversation-capture] push failed for ${filePath}: ${e.message}`);
        }
      }
    }
  }

  const record = { last_scan_at: new Date(now).toISOString(), pushed, errors };
  try {
    await pool.query(
      `INSERT INTO working_memory (key, value_json, updated_at)
       VALUES ($1, $2, NOW())
       ON CONFLICT (key) DO UPDATE SET value_json = $2, updated_at = NOW()`,
      [SENTINEL_KEY, JSON.stringify(record)]
    );
  } catch (e) {
    console.warn(`[conversation-capture] sentinel write failed: ${e.message}`);
  }

  return { ok: true, pushed, errors };
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `cd packages/brain && npx vitest run src/__tests__/conversation-capture.test.js`
Expected: PASS，7 个测试全绿

- [ ] **Step 5: Commit**

```bash
git add packages/brain/src/conversation-capture.js packages/brain/src/__tests__/conversation-capture.test.js
git commit -m "feat(brain): conversation-capture 抽取器——机械过滤JSONL真人文本(零LLM)"
```

---

## Task 2: VALID_SOURCES 扩容 + scheduler-jobs 接线

**Files:**
- Modify: `packages/brain/src/routes/captures.js:11`
- Modify: `packages/brain/src/scheduler-jobs.js`
- Modify: `packages/brain/src/__tests__/scheduler-jobs.test.js:102-106`
- Test（新增）: `packages/brain/src/routes/__tests__/captures-conversation-source.test.js`

- [ ] **Step 1: 写失败测试（VALID_SOURCES 契约）**

创建 `packages/brain/src/routes/__tests__/captures-conversation-source.test.js`：

```js
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../db.js', () => ({
  default: { query: vi.fn() },
}));

describe('captures route — VALID_SOURCES 含 conversation', () => {
  let router, pool;

  beforeEach(async () => {
    vi.clearAllMocks();
    pool = (await import('../../db.js')).default;
    router = (await import('../captures.js')).default;
  });

  function findPostHandler() {
    const layer = router.stack.find((l) => l.route?.path === '/' && l.route.methods.post);
    return layer.route.stack[0].handle;
  }

  function mockRes() {
    const res = { statusCode: null, body: null };
    res.status = (c) => { res.statusCode = c; return res; };
    res.json = (b) => { res.body = b; return res; };
    return res;
  }

  it('source=conversation 被接受（不落 400）', async () => {
    pool.query.mockResolvedValueOnce({ rows: [{ id: 'x', status: 'captured', dedupe_key: null, created_at: new Date() }] });
    const handler = findPostHandler();
    const req = { body: { content: '测试内容', source: 'conversation' } };
    const res = mockRes();
    await handler(req, res);
    expect(res.statusCode).not.toBe(400);
  });

  it('非法 source 仍被 400 拒绝', async () => {
    const handler = findPostHandler();
    const req = { body: { content: '测试内容', source: 'not-a-real-source' } };
    const res = mockRes();
    await handler(req, res);
    expect(res.statusCode).toBe(400);
    expect(res.body.error).toMatch(/source must be one of/);
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `cd packages/brain && npx vitest run src/routes/__tests__/captures-conversation-source.test.js`
Expected: FAIL，第一个测试报 400（`conversation` 尚未在白名单里）

- [ ] **Step 3: 最小实现——VALID_SOURCES 加值**

编辑 `packages/brain/src/routes/captures.js` 第 11 行：

```js
const VALID_SOURCES = ['harness', 'dashboard', 'feishu', 'api', 'conversation'];
```

- [ ] **Step 4: 运行测试确认通过**

Run: `cd packages/brain && npx vitest run src/routes/__tests__/captures-conversation-source.test.js`
Expected: PASS，2 个测试全绿

- [ ] **Step 5: scheduler-jobs.js 接线**

编辑 `packages/brain/src/scheduler-jobs.js`，在 import 区（第 31 行 `import { runCaptureAging } from './capture-aging.js';` 之后）新增一行：

```js
import { runConversationCapture } from './conversation-capture.js';
```

在 `JOBS` 数组最后一项（`capture-aging`，当前是数组末尾第 61 行）之后新增一项：

```js
  { name: 'conversation-capture', needsPool: true, timeoutMs: DEFAULT_TIMEOUT_MS, handler: (pool) => runConversationCapture(pool), description: '对话原始捕获：机械过滤~/.claude/projects/*.jsonl真人文本写入captures(source=conversation)，自带10min间隔gate（decision f64adaaf/0c9e1652）' },
```

- [ ] **Step 6: 更新既有 scheduler-jobs 计数测试**

编辑 `packages/brain/src/__tests__/scheduler-jobs.test.js` 第 102-106 行，把断言从 22 个 job 改为 23 个，标题和数组末尾追加 `conversation-capture`：

```js
  it('JOBS 注册了 23 个 job（含 disk-guard + promise-map-nightly + machine-vitals + codex-test-gen + capture-aging + conversation-capture）', () => {
    expect(JOBS.map((j) => j.name)).toEqual([
      'machine-vitals', 'arch-review', 'ci-patrol', 'strategy-trigger', 'daily-backup', 'line-dreaming', 'ledger-hygiene', 'battle-report', 'capture-triage', 'receipt-collector', 'gp-shelf-life', 'launchd-patrol', 'direction-proposer', 'postdeploy-verifier', 'seven-ring-audit', 'guard-drill', 'morning-cockpit-bark', 'drift-sentinel', 'disk-guard', 'promise-map-nightly', 'codex-test-gen', 'capture-aging', 'conversation-capture',
    ]);
  });
```

- [ ] **Step 7: 运行完整 scheduler-jobs 测试套件确认通过**

Run: `cd packages/brain && npx vitest run src/__tests__/scheduler-jobs.test.js`
Expected: PASS，全部测试绿（含改后的计数测试）

- [ ] **Step 8: 运行 scheduler-jobs smoke 脚本确认符号导出未破坏**

Run: `cd packages/brain && bash scripts/smoke/scheduler-jobs-smoke.sh`
Expected: PASS（该脚本只断言 `JOBS`/`runSchedulerJobsOnce`/`startSchedulerJobsLoop`/`SENTINEL_KEY_PREFIX` 四个符号仍导出，不断言具体 job 数量，新增 job 不影响其通过）

- [ ] **Step 9: Commit**

```bash
git add packages/brain/src/routes/captures.js packages/brain/src/scheduler-jobs.js packages/brain/src/__tests__/scheduler-jobs.test.js packages/brain/src/routes/__tests__/captures-conversation-source.test.js
git commit -m "feat(brain): captures加conversation来源+scheduler-jobs接入对话捕获job"
```

---

## Task 3: 集成测试（真实/scratch DB 实锤写入）

**Files:**
- Test: `packages/brain/src/__tests__/integration/conversation-capture.integration.test.js`

这是本 Initiative DoD 里最关键的一步：直接对着"轨道C 静默吞异常 4 个月没人发现、目标表 0 行"这个历史失败模式做实锤验证——不是相信代码写对了，是连真库查一遍证明真的写进去了。

- [ ] **Step 1: 写失败测试**

创建 `packages/brain/src/__tests__/integration/conversation-capture.integration.test.js`：

```js
import { describe, it, expect, beforeAll, afterEach, afterAll, vi } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';

let pool, runConversationCapture, extractUserTurns, __resetConversationCaptureForTest, CLAUDE_PROJECTS_DIR;

function makeFixtureDir() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'conv-capture-itest-'));
  const projectDir = path.join(root, 'itest-project');
  fs.mkdirSync(projectDir);
  return { root, projectDir };
}

function writeSession(projectDir, name, entries) {
  const filePath = path.join(projectDir, name);
  fs.writeFileSync(filePath, entries.map((e) => JSON.stringify(e)).join('\n') + '\n');
  return filePath;
}

describe('conversation-capture integration（真 DB）', () => {
  let originalDir;

  beforeAll(async () => {
    pool = (await import('../../db.js')).default;
    ({ runConversationCapture, extractUserTurns, __resetConversationCaptureForTest } = await import('../../conversation-capture.js'));
    await pool.query(`DELETE FROM captures WHERE source = 'conversation' AND repo LIKE 'itest-%'`);
    await pool.query(`DELETE FROM working_memory WHERE key = 'conversation_capture_last_scan'`);
  });

  afterEach(async () => {
    __resetConversationCaptureForTest();
    await pool.query(`DELETE FROM captures WHERE source = 'conversation' AND repo LIKE 'itest-%'`);
    await pool.query(`DELETE FROM working_memory WHERE key = 'conversation_capture_last_scan'`);
    if (originalDir && fs.existsSync(originalDir)) fs.rmSync(originalDir, { recursive: true, force: true });
    originalDir = null;
  });

  afterAll(async () => {
    await pool.query(`DELETE FROM captures WHERE source = 'conversation' AND repo LIKE 'itest-%'`);
    await pool.query(`DELETE FROM working_memory WHERE key = 'conversation_capture_last_scan'`);
  });

  it('跑一次后 captures 表真实新增 source=conversation 行，内容正确', async () => {
    const { root, projectDir } = makeFixtureDir();
    originalDir = root;
    writeSession(projectDir, 'session1.jsonl', [
      { type: 'user', uuid: 'itest-uuid-1', timestamp: new Date().toISOString(), message: { role: 'user', content: '这是集成测试真实写入的一条对话' } },
    ]);
    fs.renameSync(projectDir, path.join(root, `itest-${Date.now()}`));
    const renamedDir = fs.readdirSync(root)[0];
    const finalProjectDir = path.join(root, renamedDir);

    vi.stubEnv('CLAUDE_PROJECTS_DIR', root);
    const mod = await import('../../conversation-capture.js?t=' + Date.now());
    const result = await mod.runConversationCapture(pool);
    expect(result.ok).toBe(true);
    expect(result.pushed).toBeGreaterThanOrEqual(1);

    const { rows } = await pool.query(
      `SELECT content, source, repo FROM captures WHERE source = 'conversation' AND repo = $1`,
      [renamedDir]
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].content).toBe('这是集成测试真实写入的一条对话');
    vi.unstubAllEnvs();
  });

  it('同一份 fixture 再跑一次不产生重复行（dedupe 生效）', async () => {
    const { root, projectDir } = makeFixtureDir();
    originalDir = root;
    const sessionPath = writeSession(projectDir, 'session2.jsonl', [
      { type: 'user', uuid: 'itest-uuid-dedupe', timestamp: new Date().toISOString(), message: { role: 'user', content: '去重测试内容' } },
    ]);
    const repoName = path.basename(projectDir);

    vi.stubEnv('CLAUDE_PROJECTS_DIR', root);
    const mod = await import('../../conversation-capture.js?t=' + Date.now());

    await mod.runConversationCapture(pool);
    mod.__resetConversationCaptureForTest();
    fs.utimesSync(sessionPath, new Date(), new Date());
    await mod.runConversationCapture(pool);

    const { rows } = await pool.query(
      `SELECT id FROM captures WHERE source = 'conversation' AND repo = $1`,
      [repoName]
    );
    expect(rows).toHaveLength(1);
    vi.unstubAllEnvs();
  });

  it('mtime 早于上次成功扫描时间的文件不会被重新解析', async () => {
    const { root, projectDir } = makeFixtureDir();
    originalDir = root;
    const repoName = path.basename(projectDir);
    writeSession(projectDir, 'old-session.jsonl', [
      { type: 'user', uuid: 'itest-uuid-old', timestamp: new Date(Date.now() - 60_000).toISOString(), message: { role: 'user', content: '这条应该被跳过' } },
    ]);

    await pool.query(
      `INSERT INTO working_memory (key, value_json, updated_at) VALUES ($1, $2, NOW())
       ON CONFLICT (key) DO UPDATE SET value_json = $2, updated_at = NOW()`,
      ['conversation_capture_last_scan', JSON.stringify({ last_scan_at: new Date().toISOString(), pushed: 0, errors: 0 })]
    );

    vi.stubEnv('CLAUDE_PROJECTS_DIR', root);
    const mod = await import('../../conversation-capture.js?t=' + Date.now());
    const result = await mod.runConversationCapture(pool);
    expect(result.pushed).toBe(0);

    const { rows } = await pool.query(
      `SELECT id FROM captures WHERE source = 'conversation' AND repo = $1`,
      [repoName]
    );
    expect(rows).toHaveLength(0);
    vi.unstubAllEnvs();
  });

  it('写入异常不抛出，errors 计数非零且 sentinel 可查到', async () => {
    const { root, projectDir } = makeFixtureDir();
    originalDir = root;
    const repoName = path.basename(projectDir);
    writeSession(projectDir, 'bad-session.jsonl', [
      { type: 'user', uuid: 'itest-uuid-bad', timestamp: new Date().toISOString(), message: { role: 'user', content: 'x'.repeat(3000) } },
    ]);

    vi.stubEnv('CLAUDE_PROJECTS_DIR', root);
    const captureInbox = await import('../../capture-inbox.js');
    const spy = vi.spyOn(captureInbox, 'pushCapture').mockRejectedValueOnce(new Error('模拟写入失败'));

    const mod = await import('../../conversation-capture.js?t=' + Date.now());
    let threw = false;
    let result;
    try {
      result = await mod.runConversationCapture(pool);
    } catch {
      threw = true;
    }
    expect(threw).toBe(false);
    expect(result.errors).toBeGreaterThanOrEqual(1);

    const { rows } = await pool.query(
      `SELECT value_json FROM working_memory WHERE key = 'conversation_capture_last_scan'`
    );
    expect(rows[0].value_json.errors).toBeGreaterThanOrEqual(1);

    spy.mockRestore();
    vi.unstubAllEnvs();
    void repoName;
  });
});
```

> 注：`vi.stubEnv('CLAUDE_PROJECTS_DIR', ...)` 配合动态 `import('../../conversation-capture.js?t=' + Date.now())` 是因为 `CLAUDE_PROJECTS_DIR` 在模块顶层求值一次（`export const CLAUDE_PROJECTS_DIR = process.env.CLAUDE_PROJECTS_DIR || ...`），必须让每个测试拿到按当前 env 重新计算过的模块实例，避免测试间相互污染真实 `~/.claude/projects` 目录。

- [ ] **Step 2: 运行测试确认失败**

Run: `cd packages/brain && npx vitest run src/__tests__/integration/conversation-capture.integration.test.js`
Expected: 若 Task 1/2 已完成，此步应直接大部分通过；如失败，检查报错是否为 env/DB 连接问题（需要本地 Postgres 且 `NODE_ENV=test` 指向 `cecelia_test`，与 `dedupe.integration.test.js` 用同一套连接约定，见 `packages/brain/src/db-config.js`）

- [ ] **Step 3: 无需额外实现**——本 Task 只验证 Task 1/2 的行为，若测试失败需回到 Task 1/2 修正实现（不在本 Task 内新增生产代码）

- [ ] **Step 4: 运行测试确认通过**

Run: `cd packages/brain && npx vitest run src/__tests__/integration/conversation-capture.integration.test.js`
Expected: PASS，4 个测试全绿

- [ ] **Step 5: 运行 brain 全量测试套件，确认无回归**

Run: `cd packages/brain && npm test`
Expected: 全部测试通过（PASS），无新增失败

- [ ] **Step 6: Commit**

```bash
git add packages/brain/src/__tests__/integration/conversation-capture.integration.test.js
git commit -m "test(brain): conversation-capture集成测试——真实DB实锤写入/去重/mtime过滤/异常可观测"
```

---

## Self-Review Checklist（写完后逐条确认）

- Spec coverage：design.md 的 4 条成功标准 → Task 1（提取正确性）/ Task 3 测试1（10 分钟内可见）/ Task 3 测试2（不重复）/ Task 3 测试4（错误可观测）均有对应测试覆盖。
- initiative-dod.md F1-F7 + I1/I2：F1→Task1, F2→Task2, F3/F4/F5/F6→Task3, F7→Task2 Step5, I1→Task3 Step5, I2→Task2 Step8。
- 无占位符：所有 Step 均含完整代码，无 TBD/TODO。
- 类型一致性：`extractUserTurns(filePath, sinceMs)` 签名、`runConversationCapture(pool)` 签名、`dedupeKey`/`captureId` 字段名在三个 Task 间保持一致。
