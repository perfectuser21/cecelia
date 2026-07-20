# 对话原始捕获——多工具扩展 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task.

**Goal:** 把已上线的对话捕获（PR#4135）从"逐条消息 + Claude Code 专属"改造成"按 session 分组 + 15 分钟闲置判定 + Claude Code/Codex/Grok 三工具 + Haiku 生成 topic 摘要"。

**Architecture:** 三个新适配器文件各自返回归一化的 session 列表（`{sessionId, source, repo, turns, lastActivityMs, lastEntryId}`），`conversation-capture.js` 重写为编排层：过滤出已闲置 session → 原始文本+Haiku摘要各写一条 capture。详见 `docs/architecture/2026-07-20-conversation-capture-multitool/architecture.md`。

**Tech Stack:** Node.js（ESM）、Vitest、PostgreSQL。

**已知坑（上一轮 PR#4135 CI 踩过，本轮必须提前规避，不要再重新撞一次）：**
- `packages/brain` 有 src 变更必须 `cd packages/brain && npm version patch --no-git-tag-version`，同步改 `DEFINITION.md` 的"Brain 版本"行和 `.brain-versions`（**这个文件是追加式历史记录，只能 `echo "x.y.z" >> .brain-versions` 追加，绝不能用 `>` 覆盖**）
- **禁止在 worktree 内运行任何 `npm install`/`npm ci`/会触发 npm reify 的命令**（包括 `npm version` 本身也会顺带 reify 依赖树）——如果必须执行，执行后立刻检查 `ls -la node_modules` 是否还是指向 `/Users/administrator/perfect21/cecelia/node_modules` 的符号链接，如果变成了真实目录，`rm -rf node_modules && ln -s /Users/administrator/perfect21/cecelia/node_modules node_modules` 恢复
- 新增 `packages/brain/scripts/smoke/*.sh` 必须同时在 `packages/quality/smoke-allowlist.txt` 追加一行文件名（否则 CI 的 Smoke Glob Runner 会标记 UNREGISTERED 直接红）
- 不要把任何设计文档放进 `sprints/` 目录（会触发 harness 专用的 contract-exists 闸，这个功能不是 harness sprint）
- dedupeKey/哈希一律用 `crypto.createHash('sha256')`，不要用 `sha1`（CodeQL 会标记为 weak cryptographic algorithm 高危）
- **绝对不要在此 worktree（`/Users/administrator/worktrees/cecelia/session-f32ec5e7`）根目录之外的路径跑 `git worktree remove`**，这是当前交互 session 自己的持久 worktree，不是一次性任务目录，谁也不许删

---

## Task 1: 三个工具适配器 + 单元测试

**Files:**
- Create: `packages/brain/src/conversation-capture-claude.js`
- Create: `packages/brain/src/conversation-capture-codex.js`
- Create: `packages/brain/src/conversation-capture-grok.js`
- Test: `packages/brain/src/__tests__/conversation-capture-claude.test.js`
- Test: `packages/brain/src/__tests__/conversation-capture-codex.test.js`
- Test: `packages/brain/src/__tests__/conversation-capture-grok.test.js`
- Delete: `packages/brain/src/conversation-capture.js` 的旧内容会在 Task 2 整体重写，本 Task 不动它

三家日志格式已实测确认（架构文档有完整对照表），本 Task 只做"读文件 → 按 session 分组 → 返回归一化结构"，不碰数据库、不碰 LLM。

- [ ] **Step 1: 写三个适配器的失败测试**

`packages/brain/src/__tests__/conversation-capture-claude.test.js`：

```js
import { describe, it, expect } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { extractClaudeSessions } from '../conversation-capture-claude.js';

function makeProjectsDir(files) {
  // files: { 'project-slug/session1.jsonl': [entry, entry, ...] }
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'claude-projects-'));
  for (const [rel, entries] of Object.entries(files)) {
    const full = path.join(root, rel);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, entries.map((e) => JSON.stringify(e)).join('\n') + '\n');
  }
  return root;
}

describe('extractClaudeSessions', () => {
  it('一个 .jsonl 文件当一个 session，返回 sessionId/turns/lastActivityMs/lastEntryId', () => {
    const root = makeProjectsDir({
      'proj-a/019abc.jsonl': [
        { type: 'user', uuid: 'u1', timestamp: '2026-07-20T01:00:00.000Z', message: { role: 'user', content: '第一句' } },
        { type: 'assistant', uuid: 'a1', timestamp: '2026-07-20T01:00:01.000Z', message: { role: 'assistant', content: [{ type: 'text', text: '回复' }] } },
        { type: 'user', uuid: 'u2', timestamp: '2026-07-20T01:00:02.000Z', message: { role: 'user', content: '第二句' } },
      ],
    });
    const sessions = extractClaudeSessions(0, root);
    expect(sessions).toHaveLength(1);
    expect(sessions[0].sessionId).toBe('019abc');
    expect(sessions[0].source).toBe('conversation-claude');
    expect(sessions[0].repo).toBe('proj-a');
    expect(sessions[0].turns.map((t) => t.text)).toEqual(['第一句', '第二句']);
    expect(sessions[0].lastEntryId).toBe('u2');
    expect(sessions[0].lastActivityMs).toBe(new Date('2026-07-20T01:00:02.000Z').getTime());
  });

  it('排除 tool_result 数组消息与 assistant 消息（不产生 turns）', () => {
    const root = makeProjectsDir({
      'proj-b/019def.jsonl': [
        { type: 'user', uuid: 'u1', timestamp: '2026-07-20T01:00:00.000Z', message: { role: 'user', content: [{ type: 'tool_result', content: 'x' }] } },
        { type: 'assistant', uuid: 'a1', timestamp: '2026-07-20T01:00:01.000Z', message: { role: 'assistant', content: [{ type: 'tool_use', name: 'Edit' }] } },
      ],
    });
    const sessions = extractClaudeSessions(0, root);
    expect(sessions).toHaveLength(0);
  });

  it('sinceMs 之后 mtime 未变化的文件被跳过（不返回该 session）', () => {
    const root = makeProjectsDir({
      'proj-c/019ghi.jsonl': [
        { type: 'user', uuid: 'u1', timestamp: '2026-07-20T01:00:00.000Z', message: { role: 'user', content: '早期消息' } },
      ],
    });
    const farFuture = Date.now() + 3600_000;
    const sessions = extractClaudeSessions(farFuture, root);
    expect(sessions).toHaveLength(0);
  });

  it('目录不存在时返回空数组，不抛异常', () => {
    expect(() => extractClaudeSessions(0, '/tmp/definitely-not-exists-claude-projects')).not.toThrow();
    expect(extractClaudeSessions(0, '/tmp/definitely-not-exists-claude-projects')).toEqual([]);
  });
});
```

`packages/brain/src/__tests__/conversation-capture-codex.test.js`：

```js
import { describe, it, expect } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { extractCodexSessions } from '../conversation-capture-codex.js';

function makeCodexHome(accounts) {
  // accounts: { '.codex': [entry, entry, ...], '.codex-team1': [...] }
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-home-'));
  for (const [dirName, entries] of Object.entries(accounts)) {
    const dir = path.join(root, dirName);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'history.jsonl'), entries.map((e) => JSON.stringify(e)).join('\n') + '\n');
  }
  return root;
}

describe('extractCodexSessions', () => {
  it('同一文件里多个 session_id 正确分组', () => {
    const home = makeCodexHome({
      '.codex': [
        { session_id: 's1', ts: 1784500000, text: 's1 第一句' },
        { session_id: 's2', ts: 1784500010, text: 's2 第一句' },
        { session_id: 's1', ts: 1784500020, text: 's1 第二句' },
      ],
    });
    const sessions = extractCodexSessions(0, home);
    expect(sessions).toHaveLength(2);
    const s1 = sessions.find((s) => s.sessionId === 's1');
    expect(s1.source).toBe('conversation-codex');
    expect(s1.repo).toBe('.codex');
    expect(s1.turns.map((t) => t.text)).toEqual(['s1 第一句', 's1 第二句']);
    expect(s1.lastActivityMs).toBe(1784500020 * 1000);
  });

  it('跨多个账号目录（.codex/.codex-team1）聚合', () => {
    const home = makeCodexHome({
      '.codex': [{ session_id: 'a', ts: 1784500000, text: 'account main' }],
      '.codex-team1': [{ session_id: 'b', ts: 1784500000, text: 'account team1' }],
    });
    const sessions = extractCodexSessions(0, home);
    expect(sessions.map((s) => s.repo).sort()).toEqual(['.codex', '.codex-team1']);
  });

  it('没有 history.jsonl 的账号目录跳过，不抛异常', () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-home-empty-'));
    fs.mkdirSync(path.join(home, '.codex-team3'), { recursive: true });
    expect(() => extractCodexSessions(0, home)).not.toThrow();
    expect(extractCodexSessions(0, home)).toEqual([]);
  });
});
```

`packages/brain/src/__tests__/conversation-capture-grok.test.js`：

```js
import { describe, it, expect } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { extractGrokSessions } from '../conversation-capture-grok.js';

function makeGrokHome(projects) {
  // projects: { '%2FUsers%2Fadministrator%2Fperfect21%2Fcecelia': [entry, ...] }
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'grok-home-'));
  const sessionsDir = path.join(root, '.grok', 'sessions');
  for (const [projectDir, entries] of Object.entries(projects)) {
    const dir = path.join(sessionsDir, projectDir);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'prompt_history.jsonl'), entries.map((e) => JSON.stringify(e)).join('\n') + '\n');
  }
  return root;
}

describe('extractGrokSessions', () => {
  it('按 session_id 分组，repo 用解码后的项目路径', () => {
    const home = makeGrokHome({
      '%2FUsers%2Fadministrator%2Fperfect21%2Fcecelia': [
        { session_id: 'g1', timestamp: '2026-07-20T01:00:00.000Z', prompt: '任务描述' },
      ],
    });
    const sessions = extractGrokSessions(0, home);
    expect(sessions).toHaveLength(1);
    expect(sessions[0].source).toBe('conversation-grok');
    expect(sessions[0].repo).toBe('/Users/administrator/perfect21/cecelia');
    expect(sessions[0].turns[0].text).toBe('任务描述');
  });

  it('sessions 目录不存在时返回空数组，不抛异常', () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'grok-home-empty-'));
    expect(() => extractGrokSessions(0, home)).not.toThrow();
    expect(extractGrokSessions(0, home)).toEqual([]);
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `cd packages/brain && npx vitest run src/__tests__/conversation-capture-claude.test.js src/__tests__/conversation-capture-codex.test.js src/__tests__/conversation-capture-grok.test.js`
Expected: FAIL（三个新模块尚不存在）

- [ ] **Step 3: 写三个适配器实现**

`packages/brain/src/conversation-capture-claude.js`：

```js
import fs from 'fs';
import path from 'path';
import os from 'os';

export const CLAUDE_PROJECTS_DIR = process.env.CLAUDE_PROJECTS_DIR
  || path.join(os.homedir(), '.claude', 'projects');

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
 * 扫描 ~/.claude/projects/*/*.jsonl，每个文件当一个 session。
 * 返回 [{sessionId, source, repo, turns:[{text,timestamp}], lastActivityMs, lastEntryId}]
 */
export function extractClaudeSessions(sinceMs, projectsDir = CLAUDE_PROJECTS_DIR) {
  const sessions = [];
  if (!fs.existsSync(projectsDir)) return sessions;

  let projectDirs = [];
  try {
    projectDirs = fs.readdirSync(projectsDir, { withFileTypes: true }).filter((d) => d.isDirectory());
  } catch {
    return sessions;
  }

  for (const dir of projectDirs) {
    const dirPath = path.join(projectsDir, dir.name);
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
      if (stat.mtimeMs < sinceMs) continue;

      let content;
      try {
        content = fs.readFileSync(filePath, 'utf8');
      } catch {
        continue;
      }
      const lines = content.split('\n').filter((l) => l.trim());
      const turns = [];
      let lastActivityMs = 0;
      let lastEntryId = null;

      lines.forEach((line, lineIndex) => {
        let entry;
        try {
          entry = JSON.parse(line);
        } catch {
          return;
        }
        if (!isRealUserText(entry)) return;
        const ts = entry.timestamp ? new Date(entry.timestamp).getTime() : null;
        if (ts && ts > lastActivityMs) {
          lastActivityMs = ts;
          lastEntryId = entry.uuid || `line${lineIndex}`;
        }
        turns.push({ text: extractText(entry), timestamp: entry.timestamp || null });
      });

      if (turns.length === 0) continue;
      sessions.push({
        sessionId: file.replace(/\.jsonl$/, ''),
        source: 'conversation-claude',
        repo: dir.name.slice(0, 100),
        turns,
        lastActivityMs,
        lastEntryId,
      });
    }
  }
  return sessions;
}
```

`packages/brain/src/conversation-capture-codex.js`：

```js
import fs from 'fs';
import path from 'path';
import os from 'os';

function findCodexHistoryFiles(homeDir) {
  let entries;
  try {
    entries = fs.readdirSync(homeDir, { withFileTypes: true });
  } catch {
    return [];
  }
  return entries
    .filter((e) => e.isDirectory() && /^\.codex($|-)/.test(e.name))
    .map((e) => ({ accountDir: e.name, filePath: path.join(homeDir, e.name, 'history.jsonl') }))
    .filter((x) => fs.existsSync(x.filePath));
}

/**
 * 扫描 ~/.codex*/history.jsonl（全局单文件，多 session 共用），按 session_id 分组。
 * 返回 [{sessionId, source, repo:<账号目录名>, turns, lastActivityMs, lastEntryId}]
 */
export function extractCodexSessions(sinceMs, homeDir = os.homedir()) {
  const sessions = new Map();

  for (const { accountDir, filePath } of findCodexHistoryFiles(homeDir)) {
    let stat;
    try {
      stat = fs.statSync(filePath);
    } catch {
      continue;
    }
    if (stat.mtimeMs < sinceMs) continue;

    let content;
    try {
      content = fs.readFileSync(filePath, 'utf8');
    } catch {
      continue;
    }
    const lines = content.split('\n').filter((l) => l.trim());

    lines.forEach((line, lineIndex) => {
      let entry;
      try {
        entry = JSON.parse(line);
      } catch {
        return;
      }
      const text = typeof entry.text === 'string' ? entry.text.trim() : '';
      if (!text || !entry.session_id) return;
      const tsMs = typeof entry.ts === 'number' ? entry.ts * 1000 : null;

      const key = `${accountDir}:${entry.session_id}`;
      let session = sessions.get(key);
      if (!session) {
        session = {
          sessionId: entry.session_id,
          source: 'conversation-codex',
          repo: accountDir.slice(0, 100),
          turns: [],
          lastActivityMs: 0,
          lastEntryId: null,
        };
        sessions.set(key, session);
      }
      session.turns.push({ text, timestamp: tsMs ? new Date(tsMs).toISOString() : null });
      if (tsMs && tsMs > session.lastActivityMs) {
        session.lastActivityMs = tsMs;
        session.lastEntryId = `${accountDir}:line${lineIndex}`;
      }
    });
  }

  return Array.from(sessions.values());
}
```

`packages/brain/src/conversation-capture-grok.js`：

```js
import fs from 'fs';
import path from 'path';
import os from 'os';

function findGrokPromptHistoryFiles(homeDir) {
  const sessionsDir = path.join(homeDir, '.grok', 'sessions');
  let entries;
  try {
    entries = fs.readdirSync(sessionsDir, { withFileTypes: true });
  } catch {
    return [];
  }
  return entries
    .filter((e) => e.isDirectory())
    .map((e) => ({ projectDir: e.name, filePath: path.join(sessionsDir, e.name, 'prompt_history.jsonl') }))
    .filter((x) => fs.existsSync(x.filePath));
}

/**
 * 扫描 ~/.grok/sessions/<项目>/prompt_history.jsonl，按 session_id 分组。
 * 返回 [{sessionId, source, repo:<解码后的项目路径>, turns, lastActivityMs, lastEntryId}]
 */
export function extractGrokSessions(sinceMs, homeDir = os.homedir()) {
  const sessions = new Map();

  for (const { projectDir, filePath } of findGrokPromptHistoryFiles(homeDir)) {
    let stat;
    try {
      stat = fs.statSync(filePath);
    } catch {
      continue;
    }
    if (stat.mtimeMs < sinceMs) continue;

    let content;
    try {
      content = fs.readFileSync(filePath, 'utf8');
    } catch {
      continue;
    }
    const lines = content.split('\n').filter((l) => l.trim());

    lines.forEach((line, lineIndex) => {
      let entry;
      try {
        entry = JSON.parse(line);
      } catch {
        return;
      }
      const text = typeof entry.prompt === 'string' ? entry.prompt.trim() : '';
      if (!text || !entry.session_id) return;
      const ts = entry.timestamp ? new Date(entry.timestamp).getTime() : null;

      const key = `${projectDir}:${entry.session_id}`;
      let session = sessions.get(key);
      if (!session) {
        let decodedRepo;
        try { decodedRepo = decodeURIComponent(projectDir); } catch { decodedRepo = projectDir; }
        session = {
          sessionId: entry.session_id,
          source: 'conversation-grok',
          repo: decodedRepo.slice(0, 100),
          turns: [],
          lastActivityMs: 0,
          lastEntryId: null,
        };
        sessions.set(key, session);
      }
      session.turns.push({ text, timestamp: entry.timestamp || null });
      if (ts && ts > session.lastActivityMs) {
        session.lastActivityMs = ts;
        session.lastEntryId = `${projectDir}:line${lineIndex}`;
      }
    });
  }

  return Array.from(sessions.values());
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `cd packages/brain && npx vitest run src/__tests__/conversation-capture-claude.test.js src/__tests__/conversation-capture-codex.test.js src/__tests__/conversation-capture-grok.test.js`
Expected: PASS，全部测试绿（4+3+2=9 个测试）

- [ ] **Step 5: Commit**

```bash
git add packages/brain/src/conversation-capture-claude.js packages/brain/src/conversation-capture-codex.js packages/brain/src/conversation-capture-grok.js packages/brain/src/__tests__/conversation-capture-claude.test.js packages/brain/src/__tests__/conversation-capture-codex.test.js packages/brain/src/__tests__/conversation-capture-grok.test.js
git commit -m "feat(brain): 对话捕获三工具适配器(claude/codex/grok)——按session分组"
```

---

## Task 2: 编排层重写 + VALID_SOURCES/VALID_NATURES + migration 356 + smoke 更新

**Files:**
- Modify: `packages/brain/src/conversation-capture.js`（整体重写为编排层，删除旧的 `extractUserTurns` 等——这些逻辑已经在 Task 1 的 `conversation-capture-claude.js` 里，不要重复定义）
- Modify: `packages/brain/src/routes/captures.js`
- Create: `packages/brain/migrations/356_rename_conversation_source.sql`
- Modify: `packages/brain/scripts/smoke/conversation-capture-smoke.sh`
- Modify: `packages/brain/src/__tests__/conversation-capture.test.js`（旧的按"单条消息"测试的用例要删掉或改写，因为编排层行为变了；具体测试在 Task 3 的集成测试里覆盖，本文件如果不再适用可以直接删除清空重写成极简的"模块能正常 import"级别测试，或彻底删除该文件——**删除前确认 Task 3 的集成测试已经覆盖了原来这里测的行为**）
- Modify: `DEFINITION.md`、`.brain-versions`、`packages/brain/package.json`、`packages/brain/package-lock.json`（版本 bump，见本文档开头"已知坑"）

- [ ] **Step 1: 写 VALID_SOURCES/VALID_NATURES 契约测试**

编辑（或如果不存在则新建）`packages/brain/src/routes/__tests__/captures-conversation-source.test.js`（PR#4135 已有这个文件，在现有基础上加断言，不要整个重写）：

```js
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../db.js', () => ({
  default: { query: vi.fn() },
}));

describe('captures route — 三工具 source 值 + session_summary nature', () => {
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

  it.each(['conversation-claude', 'conversation-codex', 'conversation-grok'])('source=%s 被接受', async (source) => {
    pool.query.mockResolvedValueOnce({ rows: [{ id: 'x', status: 'captured', dedupe_key: null, created_at: new Date() }] });
    const handler = findPostHandler();
    const req = { body: { content: '测试内容', source } };
    const res = mockRes();
    await handler(req, res);
    expect(res.statusCode).not.toBe(400);
  });

  it('旧的 source=conversation（未分工具）不再被接受', async () => {
    const handler = findPostHandler();
    const req = { body: { content: '测试内容', source: 'conversation' } };
    const res = mockRes();
    await handler(req, res);
    expect(res.statusCode).toBe(400);
  });

  it('nature=session_summary 被接受', async () => {
    pool.query.mockResolvedValueOnce({ rows: [{ id: 'x', status: 'clarified', dedupe_key: null, created_at: new Date() }] });
    const handler = findPostHandler();
    const req = { body: { content: '摘要内容', source: 'conversation-claude', nature: 'session_summary' } };
    const res = mockRes();
    await handler(req, res);
    expect(res.statusCode).not.toBe(400);
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `cd packages/brain && npx vitest run src/routes/__tests__/captures-conversation-source.test.js`
Expected: FAIL（`conversation-claude` 等新值还没加进白名单）

- [ ] **Step 3: 修改 captures.js**

编辑 `packages/brain/src/routes/captures.js` 第 11-12 行：

```js
const VALID_SOURCES = ['harness', 'dashboard', 'feishu', 'api', 'conversation-claude', 'conversation-codex', 'conversation-grok'];
const VALID_NATURES = ['learning', 'issue', 'handoff', 'session_summary'];
```

- [ ] **Step 4: 运行测试确认通过**

Run: `cd packages/brain && npx vitest run src/routes/__tests__/captures-conversation-source.test.js`
Expected: PASS

- [ ] **Step 5: 新建 migration 356**

创建 `packages/brain/migrations/356_rename_conversation_source.sql`：

```sql
-- Migration 356: 历史 captures.source='conversation' 行改名为 'conversation-claude'
-- decision 39fa77ac-4915-4dae-90df-7f24745f102d：conversation 拆分为按工具区分的三个 source 值
-- (PR#4135 上线期间写入的行全部来自 Claude Code，改名不丢语义)
UPDATE captures SET source = 'conversation-claude' WHERE source = 'conversation';
```

- [ ] **Step 6: 重写 conversation-capture.js 为编排层**

用以下内容**完全替换** `packages/brain/src/conversation-capture.js`：

```js
/**
 * conversation-capture.js — 对话原始捕获编排层（decision 39fa77ac，前身 f64adaaf/0c9e1652）
 *
 * 调用三个工具适配器（conversation-capture-claude/codex/grok.js）拿到全部 session，
 * 过滤出"最后一条消息距今 ≥15 分钟"（判定为已结束）的 session，逐个：
 *   ① 原始文本写一条 capture（nature=null）
 *   ② 调 Haiku 生成 2-4 条 topic 摘要，写另一条 capture（nature='session_summary'）
 * 10 分钟自 gate（接 scheduler-jobs.js），零静默失败——失败必计入 errors。
 *
 * 与 PR#4135 版本的区别：从"逐条消息 + 只支持 Claude Code"改为"按 session 分组 +
 * 15 分钟闲置判定 + 三工具"。dedupeKey 绑定 sessionId+lastEntryId（而非只绑
 * sessionId），确保同一 session 复聊后再次闲置时能产生新 capture，不会漏内容。
 */
import crypto from 'crypto';
import { pushCapture } from './capture-inbox.js';
import { callLLM } from './llm-caller.js';
import { extractJsonObject } from './json-utils.js';
import { extractClaudeSessions } from './conversation-capture-claude.js';
import { extractCodexSessions } from './conversation-capture-codex.js';
import { extractGrokSessions } from './conversation-capture-grok.js';

const SCAN_INTERVAL_MS = parseInt(process.env.CECELIA_CONVERSATION_CAPTURE_INTERVAL_MS || String(10 * 60 * 1000), 10);
const FIRST_RUN_LOOKBACK_MS = 24 * 60 * 60 * 1000;
const IDLE_THRESHOLD_MS = 15 * 60 * 1000;
const SENTINEL_KEY = 'conversation_capture_last_scan';
const MAX_CONTENT_LEN = 2000;

let lastRunAt = 0;
export function __resetConversationCaptureForTest() { lastRunAt = 0; }

export function sessionDedupeKey(session, suffix = '') {
  const raw = `${session.source}:${session.sessionId}:${session.lastEntryId}${suffix}`;
  return crypto.createHash('sha256').update(raw).digest('hex');
}

function joinTurns(turns) {
  return turns.map((t) => t.text).join('\n\n').slice(0, MAX_CONTENT_LEN);
}

const SUMMARY_PROMPT = (rawText) => `你是 Cecelia 的对话摘要助手。以下是 Alex 在一段 AI 编程会话里说过的原始内容（只有他自己打的字，不含 AI 回复）。
提炼出 2-4 条这段会话的核心话题，每条一句话。只输出 JSON，不要其他文字：
{"topics": ["话题1", "话题2", ...]}

原始内容：
---
${rawText}
---`;

export async function summarizeSession(rawText, llm) {
  try {
    const { text } = await llm('thalamus', SUMMARY_PROMPT(rawText), { maxTokens: 256 });
    const parsed = extractJsonObject(text);
    const topics = Array.isArray(parsed?.topics)
      ? parsed.topics.filter((t) => typeof t === 'string' && t.trim())
      : [];
    if (topics.length === 0) return null;
    return topics.map((t, i) => `${i + 1}. ${t}`).join('\n');
  } catch (e) {
    console.warn(`[conversation-capture] summarize failed: ${e.message}`);
    return null;
  }
}

/**
 * 主入口：扫三工具 + 过滤已闲置 session + 写 captures（原始+摘要）+ 维护扫描哨兵。
 */
export async function runConversationCapture(pool, { llm = callLLM } = {}) {
  const now = Date.now();
  if (now - lastRunAt < SCAN_INTERVAL_MS) return { skipped: true };
  lastRunAt = now;

  let lastScanMs;
  try {
    const { rows } = await pool.query(`SELECT value_json FROM working_memory WHERE key = $1`, [SENTINEL_KEY]);
    const lastScanIso = rows[0]?.value_json?.last_scan_at;
    lastScanMs = lastScanIso ? new Date(lastScanIso).getTime() : now - FIRST_RUN_LOOKBACK_MS;
  } catch {
    lastScanMs = now - FIRST_RUN_LOOKBACK_MS;
  }

  let allSessions = [];
  const adapters = [
    ['claude', extractClaudeSessions],
    ['codex', extractCodexSessions],
    ['grok', extractGrokSessions],
  ];
  for (const [name, fn] of adapters) {
    try {
      allSessions = allSessions.concat(fn(lastScanMs));
    } catch (e) {
      console.warn(`[conversation-capture] ${name} adapter failed: ${e.message}`);
    }
  }

  const idleSessions = allSessions.filter(
    (s) => s.turns.length > 0 && (now - s.lastActivityMs) >= IDLE_THRESHOLD_MS
  );

  let pushed = 0;
  let errors = 0;

  for (const session of idleSessions) {
    const rawText = joinTurns(session.turns);

    try {
      const result = await pushCapture(pool, {
        content: rawText,
        source: session.source,
        repo: session.repo,
        dedupeKey: sessionDedupeKey(session),
      });
      if (result?.captureId) {
        pushed++;
      } else {
        errors++;
        console.warn(`[conversation-capture] raw push returned null for session=${session.sessionId}`);
      }
    } catch (e) {
      errors++;
      console.warn(`[conversation-capture] raw push failed for session=${session.sessionId}: ${e.message}`);
    }

    const summary = await summarizeSession(rawText, llm);
    if (summary) {
      try {
        const result = await pushCapture(pool, {
          content: summary,
          source: session.source,
          nature: 'session_summary',
          repo: session.repo,
          dedupeKey: sessionDedupeKey(session, ':summary'),
        });
        if (!result?.captureId) {
          errors++;
          console.warn(`[conversation-capture] summary push returned null for session=${session.sessionId}`);
        }
      } catch (e) {
        errors++;
        console.warn(`[conversation-capture] summary push failed for session=${session.sessionId}: ${e.message}`);
      }
    }
  }

  const record = { last_scan_at: new Date(now).toISOString(), pushed, errors, sessions_processed: idleSessions.length };
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

- [ ] **Step 7: 处理旧的 conversation-capture.test.js**

`packages/brain/src/__tests__/conversation-capture.test.js`（PR#4135 遗留）测的是旧版 `extractUserTurns`（已不存在，逻辑挪到 Task 1 的 `conversation-capture-claude.js` 并已有对应测试）。删除这个文件：

```bash
git rm packages/brain/src/__tests__/conversation-capture.test.js
```

- [ ] **Step 8: scheduler-jobs.js 无需改动**——确认一下

`packages/brain/src/scheduler-jobs.js` 里的 `conversation-capture` job 条目调用 `runConversationCapture(pool)`，签名兼容（新的 `{llm}` 参数是可选的），不需要改这个文件。跑一下确认：

Run: `cd packages/brain && npx vitest run src/__tests__/scheduler-jobs.test.js`
Expected: PASS（不应该因为本次改动出现新的失败）

- [ ] **Step 9: 更新 smoke 脚本**

编辑 `packages/brain/scripts/smoke/conversation-capture-smoke.sh`，在 L1 静态检查部分追加对三个新文件和新 source/nature 值的校验（在文件末尾"L3 真库"那段**之前**插入，替换掉原来只检查单一 `conversation-capture.js` 的部分）：

```bash
echo "── L1 三个适配器文件存在且导出正确 ──"
node -e "
const fs = require('fs');
const checks = [
  ['$ROOT/src/conversation-capture-claude.js', 'export function extractClaudeSessions'],
  ['$ROOT/src/conversation-capture-codex.js', 'export function extractCodexSessions'],
  ['$ROOT/src/conversation-capture-grok.js', 'export function extractGrokSessions'],
];
const missing = checks.filter(([f, p]) => !fs.existsSync(f) || !fs.readFileSync(f, 'utf8').includes(p));
if (missing.length > 0) {
  console.error('FAIL: 适配器缺失:');
  missing.forEach(([f]) => console.error('  - ' + f));
  process.exit(1);
}
console.log('三个适配器文件存在且导出正确');
" && ok "三个工具适配器存在" || fail "适配器文件缺失"

echo "── L1 captures.js VALID_SOURCES 含三个 conversation-* 值 ──"
node -e "
const fs = require('fs');
const src = fs.readFileSync('$ROOT/src/routes/captures.js', 'utf8');
const need = ['conversation-claude', 'conversation-codex', 'conversation-grok'];
const missing = need.filter((v) => !src.includes(\"'\" + v + \"'\"));
if (missing.length > 0) { console.error('FAIL: 缺少 source 值: ' + missing.join(',')); process.exit(1); }
if (!src.includes(\"'session_summary'\")) { console.error('FAIL: VALID_NATURES 缺 session_summary'); process.exit(1); }
console.log('VALID_SOURCES/VALID_NATURES 正确');
" && ok "captures.js 三工具 source + session_summary nature 齐全" || fail "captures.js 值域不全"
```

同时删掉旧脚本里针对"单一 conversation-capture.js 导出 extractUserTurns/runConversationCapture"的那段检查（`extractUserTurns` 已不存在），改成检查 `conversation-capture.js` 只需含 `runConversationCapture`/`summarizeSession`/`sessionDedupeKey` 导出即可。

跑一下确认：

Run: `cd /Users/administrator/worktrees/cecelia/session-f32ec5e7 && bash packages/brain/scripts/smoke/conversation-capture-smoke.sh`
Expected: L1 全过；L3 真库部分如果本地能连 DB 应该也过（不强制，取决于本地 psql 是否配置）

- [ ] **Step 10: Brain 版本 bump（必做，见本文档开头"已知坑"）**

```bash
cd packages/brain && npm version patch --no-git-tag-version
# 检查 node_modules 有没有被 npm 重新 reify 成真实目录，如果是，恢复符号链接：
cd /Users/administrator/worktrees/cecelia/session-f32ec5e7
if [ ! -L node_modules ]; then rm -rf node_modules && ln -s /Users/administrator/perfect21/cecelia/node_modules node_modules; fi
NEW_VERSION=$(node -e "console.log(require('./packages/brain/package.json').version)")
echo "新版本: $NEW_VERSION"
# 手动编辑 DEFINITION.md 的 "Brain 版本" 行改成 $NEW_VERSION（sed 或 Edit 工具）
echo "$NEW_VERSION" >> .brain-versions   # 追加，不要用 > 覆盖
bash scripts/check-version-sync.sh   # 确认三处一致
node scripts/facts-check.mjs         # 确认 DevGate 通过
```

- [ ] **Step 11: 运行相关测试全套确认无回归**

Run: `cd packages/brain && npx vitest run src/__tests__/conversation-capture-claude.test.js src/__tests__/conversation-capture-codex.test.js src/__tests__/conversation-capture-grok.test.js src/__tests__/scheduler-jobs.test.js src/routes/__tests__/captures-conversation-source.test.js`
Expected: PASS 全绿

- [ ] **Step 12: Commit**

```bash
git add packages/brain/src/conversation-capture.js packages/brain/src/routes/captures.js packages/brain/migrations/356_rename_conversation_source.sql packages/brain/scripts/smoke/conversation-capture-smoke.sh packages/brain/src/routes/__tests__/captures-conversation-source.test.js DEFINITION.md .brain-versions packages/brain/package.json packages/brain/package-lock.json
git rm packages/brain/src/__tests__/conversation-capture.test.js 2>/dev/null || true
git commit -m "feat(brain): 对话捕获编排层重写——session闲置判定+Haiku摘要+三工具source"
```

---

## Task 3: 集成测试 + migration 验证 + smoke allowlist 登记

**Files:**
- Create: `packages/brain/src/__tests__/integration/conversation-capture.integration.test.js`（替换 PR#4135 的旧版本——旧版本测的是"逐条消息"行为，本次改成"按 session"）
- Modify: `packages/quality/smoke-allowlist.txt`（确认 `conversation-capture-smoke.sh` 还在名单里，PR#4135 已加过，本次不用重复加，只需确认）

- [ ] **Step 1: 写集成测试**

创建 `packages/brain/src/__tests__/integration/conversation-capture.integration.test.js`：

```js
import { describe, it, expect, beforeAll, afterEach, afterAll, vi } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';

let pool;

function makeFixtureHome() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'conv-capture-mt-itest-'));
  return root;
}

function writeClaudeSession(homeRoot, projectSlug, fileName, entries) {
  const dir = path.join(homeRoot, '.claude', 'projects', projectSlug);
  fs.mkdirSync(dir, { recursive: true });
  const filePath = path.join(dir, fileName);
  fs.writeFileSync(filePath, entries.map((e) => JSON.stringify(e)).join('\n') + '\n');
  return filePath;
}

const FAKE_LLM = async () => ({ text: JSON.stringify({ topics: ['话题一', '话题二'] }) });

describe('conversation-capture 多工具集成（真 DB）', () => {
  let homeRoot;

  beforeAll(async () => {
    pool = (await import('../../db.js')).default;
  });

  afterEach(async () => {
    await pool.query(`DELETE FROM captures WHERE repo LIKE 'itest-mt-%'`);
    await pool.query(`DELETE FROM working_memory WHERE key = 'conversation_capture_last_scan'`);
    if (homeRoot && fs.existsSync(homeRoot)) fs.rmSync(homeRoot, { recursive: true, force: true });
    homeRoot = null;
    vi.unstubAllEnvs();
  });

  afterAll(async () => {
    await pool.query(`DELETE FROM captures WHERE repo LIKE 'itest-mt-%'`);
    await pool.query(`DELETE FROM working_memory WHERE key = 'conversation_capture_last_scan'`);
  });

  it('已闲置≥15分钟的 session 产生原始文本+摘要两条 capture', async () => {
    homeRoot = makeFixtureHome();
    const oldTs = new Date(Date.now() - 20 * 60 * 1000).toISOString(); // 20分钟前，超过15分钟闲置阈值
    writeClaudeSession(homeRoot, 'itest-mt-proj', 'session1.jsonl', [
      { type: 'user', uuid: 'u1', timestamp: oldTs, message: { role: 'user', content: '闲置会话测试内容' } },
    ]);
    vi.stubEnv('CLAUDE_PROJECTS_DIR', path.join(homeRoot, '.claude', 'projects'));

    const mod = await import('../../conversation-capture.js?t=' + Date.now());
    const result = await mod.runConversationCapture(pool, { llm: FAKE_LLM });
    expect(result.ok).toBe(true);
    expect(result.pushed).toBeGreaterThanOrEqual(1);

    const { rows } = await pool.query(
      `SELECT source, nature, content FROM captures WHERE repo = 'itest-mt-proj' ORDER BY nature NULLS FIRST`
    );
    expect(rows).toHaveLength(2);
    expect(rows[0].nature).toBeNull();
    expect(rows[0].content).toBe('闲置会话测试内容');
    expect(rows[0].source).toBe('conversation-claude');
    expect(rows[1].nature).toBe('session_summary');
    expect(rows[1].content).toContain('话题一');
  });

  it('未闲置（最后消息在15分钟内）的 session 不产生 capture', async () => {
    homeRoot = makeFixtureHome();
    const recentTs = new Date(Date.now() - 60 * 1000).toISOString(); // 1分钟前
    writeClaudeSession(homeRoot, 'itest-mt-active', 'session2.jsonl', [
      { type: 'user', uuid: 'u1', timestamp: recentTs, message: { role: 'user', content: '还在继续聊' } },
    ]);
    vi.stubEnv('CLAUDE_PROJECTS_DIR', path.join(homeRoot, '.claude', 'projects'));

    const mod = await import('../../conversation-capture.js?t=' + Date.now());
    const result = await mod.runConversationCapture(pool, { llm: FAKE_LLM });
    expect(result.pushed).toBe(0);

    const { rows } = await pool.query(`SELECT id FROM captures WHERE repo = 'itest-mt-active'`);
    expect(rows).toHaveLength(0);
  });

  it('同一 session 重复扫描不重复写入（dedupeKey 幂等）', async () => {
    homeRoot = makeFixtureHome();
    const oldTs = new Date(Date.now() - 20 * 60 * 1000).toISOString();
    writeClaudeSession(homeRoot, 'itest-mt-dedup', 'session3.jsonl', [
      { type: 'user', uuid: 'u1', timestamp: oldTs, message: { role: 'user', content: '去重测试' } },
    ]);
    vi.stubEnv('CLAUDE_PROJECTS_DIR', path.join(homeRoot, '.claude', 'projects'));

    const mod = await import('../../conversation-capture.js?t=' + Date.now());
    await mod.runConversationCapture(pool, { llm: FAKE_LLM });
    mod.__resetConversationCaptureForTest();
    await mod.runConversationCapture(pool, { llm: FAKE_LLM });

    const { rows } = await pool.query(`SELECT id FROM captures WHERE repo = 'itest-mt-dedup'`);
    expect(rows).toHaveLength(2); // 原始+摘要各一条，不因重复扫描翻倍
  });

  it('LLM 摘要失败不影响原始文本正常写入', async () => {
    homeRoot = makeFixtureHome();
    const oldTs = new Date(Date.now() - 20 * 60 * 1000).toISOString();
    writeClaudeSession(homeRoot, 'itest-mt-llmfail', 'session4.jsonl', [
      { type: 'user', uuid: 'u1', timestamp: oldTs, message: { role: 'user', content: 'LLM失败测试' } },
    ]);
    vi.stubEnv('CLAUDE_PROJECTS_DIR', path.join(homeRoot, '.claude', 'projects'));

    const failingLlm = async () => { throw new Error('模拟LLM调用失败'); };
    const mod = await import('../../conversation-capture.js?t=' + Date.now());
    const result = await mod.runConversationCapture(pool, { llm: failingLlm });
    expect(result.ok).toBe(true);

    const { rows } = await pool.query(`SELECT nature FROM captures WHERE repo = 'itest-mt-llmfail'`);
    expect(rows).toHaveLength(1);
    expect(rows[0].nature).toBeNull(); // 只有原始文本那条，摘要那条因LLM失败没写
  });
});
```

- [ ] **Step 2: 运行测试确认失败/通过**

Run: `cd packages/brain && npx vitest run src/__tests__/integration/conversation-capture.integration.test.js`
Expected: 若 Task 1/2 已正确完成，应直接大部分通过；失败则回 Task 1/2 检查实现（本 Task 不新增生产代码，只验证）

- [ ] **Step 3: 运行 migration 356 并验证**

```bash
cd packages/brain
# 找到本地/测试库连接方式（参照 db-config.js），跑一下 migration 确认语法正确：
psql -h localhost -U postgres -d cecelia_test -f migrations/356_rename_conversation_source.sql 2>&1 || echo "若无本地测试库连接可跳过实跑，CI migration-verify 会跑"
```

- [ ] **Step 4: 确认 smoke-allowlist.txt 已含 conversation-capture-smoke.sh**

```bash
grep -q "^conversation-capture-smoke.sh$" packages/quality/smoke-allowlist.txt && echo "已登记" || echo "conversation-capture-smoke.sh" >> packages/quality/smoke-allowlist.txt
```

- [ ] **Step 5: 运行 brain 全量测试套件，确认无回归**

Run: `cd packages/brain && npm test`
Expected: 本次改动涉及的测试文件全绿；其余失败若与本次改动无关（参照 PR#4135 教训，先 `git diff --stat` 确认自己没碰那些文件）可以放行，但必须在报告里逐条说明为什么无关

- [ ] **Step 6: Commit**

```bash
git add packages/brain/src/__tests__/integration/conversation-capture.integration.test.js packages/quality/smoke-allowlist.txt
git commit -m "test(brain): 对话捕获多工具集成测试——真实DB闲置判定/去重/LLM失败降级"
```

---

## Self-Review Checklist

- Spec coverage：architecture.md 的 6 条关键决策 + initiative-dod.md F1-F9/I1-I2 均有对应 Task/测试覆盖。
- 无占位符：所有 Step 均含完整代码。
- 类型一致性：`session.sessionId`/`session.source`/`session.repo`/`session.turns`/`session.lastActivityMs`/`session.lastEntryId` 字段名在三个适配器 + 编排层间保持一致。
- 已知坑清单（本文档开头）在 Task 2 Step 10 里已经显式提醒，避免重蹈 PR#4135 CI 五连红的覆辙。
