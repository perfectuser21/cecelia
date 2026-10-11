/**
 * 回归：2026-09-10 Brain 迁 us-vps 容器后，容器里没有 ~/.claude/projects，
 * extractClaudeSessions 静默返回 []，job 每 10 分钟报 pushed=0/errors=0 全绿，
 * captures(source=conversation-*) 自 09-09 起归零一个月无人知。
 *
 * 修法：容器内走 ssh mmv 只读跑适配器（openclaw-run-ingest 同款）；本地模式目录缺失
 * 计 adapter 失败；未登记出处时 transcript entrypoint=cli 判为有头真人会话。
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { spawnSync } from 'child_process';
import {
  buildRemoteExtractorScript,
  buildRemoteCaptureCmd,
  parseRemoteCaptureOutput,
  fetchRemoteSessions,
} from '../conversation-capture-remote.js';

let fixtureRoot = null;

function writeClaude(home, repo, sessionId, entries, idleMin = 20) {
  const dir = path.join(home, '.claude', 'projects', repo);
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${sessionId}.jsonl`);
  fs.writeFileSync(file, entries.map((e) => JSON.stringify(e)).join('\n') + '\n');
  const t = new Date(Date.now() - idleMin * 60 * 1000);
  fs.utimesSync(file, t, t);
}

function userEntry(text, { entrypoint = 'cli', minutesAgo = 20 } = {}) {
  return {
    type: 'user',
    uuid: `u-${Math.random()}`,
    entrypoint,
    timestamp: new Date(Date.now() - minutesAgo * 60 * 1000).toISOString(),
    message: { role: 'user', content: text },
  };
}

function runScriptAsRemote(script, home) {
  const env = { ...process.env, HOME: home };
  delete env.CLAUDE_PROJECTS_DIR;
  return spawnSync(process.execPath, ['--input-type=module'], { input: script, env, encoding: 'utf8' });
}

afterEach(() => {
  if (fixtureRoot) fs.rmSync(fixtureRoot, { recursive: true, force: true });
  fixtureRoot = null;
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  vi.resetModules();
});

describe('远端提取脚本（在 mmv 上跑的就是生产适配器代码）', () => {
  it('真跑脚本：读 HOME 下 claude 会话，带 entrypoint/linkedTaskIds，turns 截尾控制体积', () => {
    fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'conv-remote-'));
    const long = 'x'.repeat(5000);
    writeClaude(fixtureRoot, '-Users-administrator-perfect21-cecelia', 'sess-cli', [
      userEntry(long, { minutesAgo: 30 }),
      userEntry('最后一句 --task-id c8b27bc5-dd78-4139-aaf8-4060ff11c6bf'),
    ]);
    const out = runScriptAsRemote(buildRemoteExtractorScript(0), fixtureRoot);
    expect(out.status).toBe(0);
    const parsed = parseRemoteCaptureOutput(out.stdout);
    expect(parsed.failures).toEqual(expect.not.arrayContaining(['claude']));
    const s = parsed.sessions.find((x) => x.sessionId === 'sess-cli');
    expect(s).toBeTruthy();
    expect(s.source).toBe('conversation-claude');
    expect(s.entrypoint).toBe('cli');
    expect(s.linkedTaskIds).toEqual(['c8b27bc5-dd78-4139-aaf8-4060ff11c6bf']);
    expect(s.turns.at(-1).text).toContain('最后一句');
    const total = s.turns.reduce((n, t) => n + t.text.length, 0);
    expect(total).toBeLessThanOrEqual(4000);
  });

  it('远端 ~/.claude/projects 不存在 → claude 记失败（不许静默 0）', () => {
    fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'conv-remote-empty-'));
    const out = runScriptAsRemote(buildRemoteExtractorScript(0), fixtureRoot);
    expect(out.status).toBe(0);
    const parsed = parseRemoteCaptureOutput(out.stdout);
    expect(parsed.failures).toContain('claude');
  });

  it('ssh 命令：base64 传脚本给 mmv 上的 node，容器内再包一层宿主逃逸', () => {
    const cmd = buildRemoteCaptureCmd(123, { inContainer: false });
    expect(cmd).toMatch(/^ssh .*mmv '/);
    expect(cmd).toContain('base64 -d | node --input-type=module');
    const wrapped = buildRemoteCaptureCmd(123, { inContainer: true });
    expect(wrapped).toMatch(/^ssh -i /);
    expect(wrapped).toContain('mmv');
  });

  it('输出不是合法 JSON → 抛 parse_error', () => {
    expect(() => parseRemoteCaptureOutput('garbage')).toThrow(/parse_error/);
  });

  it('fetchRemoteSessions：exec 抛错原样上抛（由编排层计入 adapter 失败）', async () => {
    await expect(fetchRemoteSessions(0, { exec: async () => { throw new Error('ssh: connect timeout'); }, inContainer: true }))
      .rejects.toThrow(/ssh/);
  });
});

function makePool({ provenance = new Map() } = {}) {
  const captures = [];
  let sentinel = null;
  return {
    captures,
    get sentinel() { return sentinel; },
    async query(sql, params = []) {
      if (sql.includes('SELECT value_json FROM working_memory')) return { rows: [{ value_json: { last_scan_at: 'x' } }] };
      if (sql.includes('FROM session_provenance')) {
        return { rows: params[0].filter((id) => provenance.has(id)).map((id) => ({ session_id: id, ...provenance.get(id) })) };
      }
      if (sql.startsWith('SELECT content FROM captures')) return { rows: [] };
      if (sql.includes('INSERT INTO captures')) {
        captures.push({ content: params[0], source: params[1], nature: params[2] });
        return { rows: [{ id: captures.length }] };
      }
      if (sql.includes('INSERT INTO working_memory')) { sentinel = JSON.parse(params[1]); return { rows: [] }; }
      throw new Error(`unexpected SQL: ${sql}`);
    },
  };
}

function remoteSession(over = {}) {
  return {
    sessionId: 'sess-1',
    source: 'conversation-claude',
    repo: '-Users-administrator-perfect21-cecelia',
    turns: [{ text: '修一下对话捕获', timestamp: null }],
    lastActivityMs: Date.now() - 20 * 60 * 1000,
    lastEntryId: 'u1',
    entrypoint: 'cli',
    linkedTaskIds: [],
    ...over,
  };
}

describe('runConversationCapture 远端模式 + 有头判定', () => {
  const llm = vi.fn(async () => ({ text: JSON.stringify({ topics: ['修对话捕获'] }) }));

  it('容器内默认走远端；未登记出处但 entrypoint=cli → 当有头真人会话捕获并摘要，再交有头收尾', async () => {
    const { runConversationCapture } = await import('../conversation-capture.js');
    const pool = makePool();
    const exec = vi.fn(async () => JSON.stringify({ sessions: [
      remoteSession(),
      remoteSession({ sessionId: 'sess-headless', entrypoint: 'sdk-cli' }),
    ], failures: [], errors: {} }));
    const attachHeaded = vi.fn(async () => ({ linked: [], created: 'new-task' }));
    const r = await runConversationCapture(pool, { llm, exec, inContainer: true, attachHeaded });
    expect(exec).toHaveBeenCalledOnce();
    expect(r).toMatchObject({ pushed: 1, errors: 0, sessions_seen: 2, sessions_processed: 1, skipped_unregistered: 1, inferred_human: 1 });
    expect(pool.captures.map((c) => c.nature)).toEqual([null, 'session_summary']);
    expect(attachHeaded).toHaveBeenCalledOnce();
    expect(attachHeaded.mock.calls[0][1]).toMatchObject({ summary: '1. 修对话捕获', provenanceTaskId: null });
    expect(attachHeaded.mock.calls[0][1].session.sessionId).toBe('sess-1');
  });

  it('登记过的 human 带 task_id → 作为关联任务交给有头收尾', async () => {
    const { runConversationCapture } = await import('../conversation-capture.js');
    const pool = makePool({ provenance: new Map([['sess-1', { kind: 'human', task_id: 'tid-1' }]]) });
    const exec = vi.fn(async () => JSON.stringify({ sessions: [remoteSession({ entrypoint: null })], failures: [], errors: {} }));
    const attachHeaded = vi.fn(async () => ({ linked: ['tid-1'], created: null }));
    await runConversationCapture(pool, { llm, exec, inContainer: true, attachHeaded });
    expect(attachHeaded.mock.calls[0][1].provenanceTaskId).toBe('tid-1');
  });

  it('ssh 失败 → adapter_failures 含 remote，errors>0（job 必须变红，不许静默 0）', async () => {
    const { runConversationCapture } = await import('../conversation-capture.js');
    const pool = makePool();
    const exec = vi.fn(async () => { throw new Error('ssh: Could not resolve hostname mmv'); });
    const r = await runConversationCapture(pool, { llm, exec, inContainer: true, attachHeaded: vi.fn() });
    expect(r.errors).toBeGreaterThan(0);
    expect(pool.sentinel.adapter_failures).toContain('remote');
  });

  it('本地模式且 ~/.claude/projects 不存在 → claude 计失败（容器内静默 0 的原病灶）', async () => {
    fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'conv-local-missing-'));
    vi.stubEnv('CLAUDE_PROJECTS_DIR', path.join(fixtureRoot, 'nope'));
    vi.resetModules();
    const { runConversationCapture } = await import('../conversation-capture.js');
    const pool = makePool();
    const r = await runConversationCapture(pool, { llm, mode: 'local', attachHeaded: vi.fn() });
    expect(r.errors).toBeGreaterThan(0);
    expect(pool.sentinel.adapter_failures).toContain('claude');
  });

  it('有头收尾抛错 → 计入 errors（不吞），但原文与摘要照常入库', async () => {
    const { runConversationCapture } = await import('../conversation-capture.js');
    const pool = makePool();
    const exec = vi.fn(async () => JSON.stringify({ sessions: [remoteSession()], failures: [], errors: {} }));
    const attachHeaded = vi.fn(async () => { throw new Error('saveHandoff boom'); });
    const r = await runConversationCapture(pool, { llm, exec, inContainer: true, attachHeaded });
    expect(pool.captures).toHaveLength(2);
    expect(r.errors).toBe(1);
    expect(r.headed_errors).toBe(1);
  });
});
