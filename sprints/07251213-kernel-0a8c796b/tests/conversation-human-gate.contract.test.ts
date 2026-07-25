import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../../..');
const migration = path.join(
  repoRoot,
  'packages/brain/migrations/360_session_provenance.sql'
);
const testPrefix = `contract-human-gate-${process.pid}-`;
let pool: any;
let fixtureRoot: string | null = null;
let originalHomedir: typeof os.homedir;

function writeClaudeSession(sessionId: string, repo: string, text: string) {
  fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), testPrefix));
  const projects = path.join(fixtureRoot, '.claude', 'projects');
  const dir = path.join(projects, repo);
  fs.mkdirSync(dir, { recursive: true });
  const timestamp = new Date(Date.now() - 20 * 60 * 1000).toISOString();
  const transcript = {
    type: 'user',
    uuid: randomUUID(),
    timestamp,
    message: { role: 'user', content: text },
  };
  const file = path.join(dir, `${sessionId}.jsonl`);
  fs.writeFileSync(file, `${JSON.stringify(transcript)}\n`);
  const idleTime = new Date(Date.now() - 20 * 60 * 1000);
  fs.utimesSync(file, idleTime, idleTime);
  vi.stubEnv('CLAUDE_PROJECTS_DIR', projects);
  os.homedir = () => fixtureRoot as string;
}

async function registerHuman(sessionId: string) {
  await pool.query(
    `INSERT INTO session_provenance(session_id, kind, launched_by)
     VALUES ($1, 'human', 'contract-test')
     ON CONFLICT (session_id) DO NOTHING`,
    [sessionId]
  );
}

beforeAll(async () => {
  expect(
    fs.existsSync(migration),
    'RED: session_provenance migration 尚未实现，human allowlist 无法运行'
  ).toBe(true);
  pool = (await import('../../../packages/brain/src/db.js')).default;
  await pool.query(fs.readFileSync(migration, 'utf8'));
  originalHomedir = os.homedir;
});

afterEach(async () => {
  await pool.query(`DELETE FROM captures WHERE repo LIKE $1`, [`${testPrefix}%`]);
  await pool.query(`DELETE FROM session_provenance WHERE launched_by = 'contract-test'`);
  await pool.query(`DELETE FROM working_memory WHERE key = 'conversation_capture_last_scan'`);
  if (fixtureRoot) fs.rmSync(fixtureRoot, { recursive: true, force: true });
  fixtureRoot = null;
  os.homedir = originalHomedir;
  vi.unstubAllEnvs();
  vi.resetModules();
});

afterAll(async () => {
  if (!pool) return;
  await pool.query(`DELETE FROM captures WHERE repo LIKE $1`, [`${testPrefix}%`]);
  await pool.query(`DELETE FROM session_provenance WHERE launched_by = 'contract-test'`);
  await pool.query(`DELETE FROM working_memory WHERE key = 'conversation_capture_last_scan'`);
  await pool.end();
});

describe('conversation capture human allowlist（真相邻模块 + 真 PostgreSQL）', () => {
  it('runConversationCapture 只让 registered human 产生原始与摘要两条 capture', async () => {
    const sid = randomUUID();
    const repo = `${testPrefix}logic`;
    writeClaudeSession(sid, repo, '这是 Alex 的真实测试输入');
    await registerHuman(sid);

    const llm = vi.fn(async () => ({
      text: JSON.stringify({ topics: ['真实人声主题'] }),
    }));
    const mod = await import('../../../packages/brain/src/conversation-capture.js');
    const result = await mod.runConversationCapture(pool, { llm });
    expect(result.ok).toBe(true);
    expect(result.pushed).toBe(1);
    expect(llm).toHaveBeenCalledOnce();

    const { rows } = await pool.query(
      `SELECT nature, content
       FROM captures
       WHERE repo = $1 AND created_at > NOW() - INTERVAL '5 minutes'
       ORDER BY nature NULLS FIRST`,
      [repo]
    );
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ nature: null, content: '这是 Alex 的真实测试输入' });
    expect(rows[1].nature).toBe('session_summary');
    expect(rows[1].content).toContain('真实人声主题');
  });

  it('registered human 经真 Haiku 请求后 summary capture 在五分钟窗内落库', async () => {
    const sid = randomUUID();
    const repo = `${testPrefix}live-haiku`;
    writeClaudeSession(sid, repo, '我决定 conversation capture 只允许登记为 human 的会话。');
    await registerHuman(sid);

    const { callLLM } = await import('../../../packages/brain/src/llm-caller.js');
    const liveAnthropic = async (agent: string, prompt: string, options: object) => {
      const response = await callLLM(agent, prompt, {
        ...options,
        provider: 'anthropic-api',
        model: 'claude-haiku-4-5-20251001',
        timeout: 60000,
      });
      expect(response.provider).toBe('anthropic-api');
      expect(response.model).toBe('claude-haiku-4-5-20251001');
      expect(response.text.length).toBeGreaterThan(0);
      return response;
    };

    const mod = await import('../../../packages/brain/src/conversation-capture.js');
    const result = await mod.runConversationCapture(pool, { llm: liveAnthropic });
    expect(result.ok).toBe(true);
    expect(result.errors).toBe(0);

    const { rows } = await pool.query(
      `SELECT nature, content
       FROM captures
       WHERE repo = $1
         AND nature = 'session_summary'
         AND created_at > NOW() - INTERVAL '5 minutes'`,
      [repo]
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].content).toMatch(/^1\.\s+\S+/m);
  });
});
