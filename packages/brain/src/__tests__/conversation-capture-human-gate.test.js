import { afterEach, describe, expect, it, vi } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';

const originalHomedir = os.homedir;
let fixtureRoot;

function writeClaudeSession(projectsDir, sessionId, repo = 'human-gate-test') {
  const dir = path.join(projectsDir, repo);
  fs.mkdirSync(dir, { recursive: true });
  const timestamp = new Date(Date.now() - 20 * 60 * 1000).toISOString();
  const file = path.join(dir, `${sessionId}.jsonl`);
  fs.writeFileSync(file, `${JSON.stringify({
    type: 'user',
    uuid: `${sessionId}-entry`,
    timestamp,
    message: { role: 'user', content: `text-${sessionId}` },
  })}\n`);
  const idle = new Date(Date.now() - 20 * 60 * 1000);
  fs.utimesSync(file, idle, idle);
}

function makePool(provenance, { lookupError = false } = {}) {
  const captures = [];
  let sentinel = null;
  let provenanceQueries = 0;
  let dedupeQueries = 0;
  return {
    captures,
    get sentinel() { return sentinel; },
    get provenanceQueries() { return provenanceQueries; },
    get dedupeQueries() { return dedupeQueries; },
    async query(sql, params = []) {
      if (sql.includes('SELECT value_json FROM working_memory')) return { rows: [] };
      if (sql.includes('FROM session_provenance')) {
        provenanceQueries++;
        if (lookupError) throw new Error('provenance unavailable');
        return {
          rows: params[0]
            .filter((sessionId) => provenance.has(sessionId))
            .map((sessionId) => ({ session_id: sessionId, kind: provenance.get(sessionId) })),
        };
      }
      if (sql.startsWith('SELECT content FROM captures')) {
        dedupeQueries++;
        const row = captures.find((capture) => capture.dedupeKey === params[0]);
        return { rows: row ? [{ content: row.content }] : [] };
      }
      if (sql.includes('INSERT INTO captures')) {
        const capture = {
          id: captures.length + 1,
          content: params[0],
          source: params[1],
          nature: params[2],
          repo: params[3],
          dedupeKey: params[8],
        };
        captures.push(capture);
        return { rows: [{ id: capture.id }] };
      }
      if (sql.includes('INSERT INTO working_memory')) {
        sentinel = JSON.parse(params[1]);
        return { rows: [] };
      }
      throw new Error(`unexpected SQL: ${sql}`);
    },
  };
}

async function runWithClaudeSessions(entries, pool, llm = vi.fn(async () => ({
  text: JSON.stringify({ topics: ['summary'] }),
}))) {
  fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'conversation-human-gate-'));
  const projects = path.join(fixtureRoot, '.claude', 'projects');
  for (const entry of entries) writeClaudeSession(projects, entry.sessionId, entry.repo);
  vi.stubEnv('CLAUDE_PROJECTS_DIR', projects);
  os.homedir = () => fixtureRoot;
  vi.resetModules();
  const mod = await import('../conversation-capture.js');
  return { result: await mod.runConversationCapture(pool, { llm }), llm };
}

afterEach(() => {
  if (fixtureRoot) fs.rmSync(fixtureRoot, { recursive: true, force: true });
  fixtureRoot = null;
  os.homedir = originalHomedir;
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  vi.resetModules();
});

describe('conversation capture human provenance gate', () => {
  it('registered human 与 mixed batch 只处理 human', async () => {
    const pool = makePool(new Map([
      ['human-session', 'human'],
      ['machine-session', 'machine'],
    ]));
    const { result, llm } = await runWithClaudeSessions([
      { sessionId: 'human-session', repo: 'human-repo' },
      { sessionId: 'machine-session', repo: 'machine-repo' },
      { sessionId: 'unknown-session', repo: 'unknown-repo' },
    ], pool);

    expect(result).toMatchObject({
      pushed: 1,
      sessions_seen: 3,
      sessions_processed: 1,
      skipped_machine: 1,
      skipped_unregistered: 1,
    });
    expect(pool.provenanceQueries).toBe(1);
    expect(pool.captures).toHaveLength(2);
    expect(pool.captures.every((capture) => capture.repo === 'human-repo')).toBe(true);
    expect(llm).toHaveBeenCalledOnce();
  });

  it('registered machine 零 capture 且 skipped_machine 递增', async () => {
    const pool = makePool(new Map([['machine-session', 'machine']]));
    const { result, llm } = await runWithClaudeSessions([{ sessionId: 'machine-session' }], pool);
    expect(result).toMatchObject({ pushed: 0, skipped_machine: 1, sessions_processed: 0 });
    expect(pool.captures).toHaveLength(0);
    expect(llm).not.toHaveBeenCalled();
  });

  it('unregistered session 零 capture 且 skipped_unregistered 递增', async () => {
    const pool = makePool(new Map());
    const { result, llm } = await runWithClaudeSessions([{ sessionId: 'unknown-session' }], pool);
    expect(result).toMatchObject({ pushed: 0, skipped_unregistered: 1, sessions_processed: 0 });
    expect(pool.sentinel.skipped_unregistered).toBe(1);
    expect(pool.captures).toHaveLength(0);
    expect(llm).not.toHaveBeenCalled();
  });

  it('provenance query error 时零 capture、零 LLM、零 dedupe 并记录错误', async () => {
    const pool = makePool(new Map(), { lookupError: true });
    const { result, llm } = await runWithClaudeSessions([{ sessionId: 'lookup-error-session' }], pool);
    expect(result).toMatchObject({
      pushed: 0,
      errors: 1,
      sessions_seen: 1,
      sessions_processed: 0,
      provenance_lookup_failed: true,
    });
    expect(pool.dedupeQueries).toBe(0);
    expect(pool.captures).toHaveLength(0);
    expect(llm).not.toHaveBeenCalled();
    expect(pool.sentinel).toMatchObject({
      sessions_seen: 1,
      sessions_processed: 0,
      skipped_machine: 0,
      skipped_unregistered: 0,
      provenance_lookup_failed: true,
      errors: 1,
    });
  });

  it('Codex/Grok unregistered worker 均失败关闭', async () => {
    fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'conversation-human-gate-workers-'));
    const timestamp = new Date(Date.now() - 20 * 60 * 1000);
    const codexDir = path.join(fixtureRoot, '.codex');
    const grokDir = path.join(fixtureRoot, '.grok', 'sessions', 'worker');
    fs.mkdirSync(codexDir, { recursive: true });
    fs.mkdirSync(grokDir, { recursive: true });
    const codexFile = path.join(codexDir, 'history.jsonl');
    const grokFile = path.join(grokDir, 'prompt_history.jsonl');
    fs.writeFileSync(codexFile, `${JSON.stringify({
      session_id: 'codex-worker',
      ts: Math.floor(timestamp.getTime() / 1000),
      text: 'codex worker prompt',
    })}\n`);
    fs.writeFileSync(grokFile, `${JSON.stringify({
      session_id: 'grok-worker',
      timestamp: timestamp.toISOString(),
      prompt: 'grok worker prompt',
    })}\n`);
    os.homedir = () => fixtureRoot;
    vi.stubEnv('CLAUDE_PROJECTS_DIR', path.join(fixtureRoot, '.claude', 'projects'));
    const pool = makePool(new Map());
    const llm = vi.fn();
    vi.resetModules();
    const mod = await import('../conversation-capture.js');
    const result = await mod.runConversationCapture(pool, { llm });
    expect(result).toMatchObject({ pushed: 0, skipped_unregistered: 2 });
    expect(llm).not.toHaveBeenCalled();
    expect(pool.captures).toHaveLength(0);
  });
});
