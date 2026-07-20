import { describe, it, expect, beforeAll, afterEach, afterAll, vi } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';

let pool;

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
    await pool.query(`DELETE FROM captures WHERE source = 'conversation' AND repo LIKE 'itest-%'`);
    await pool.query(`DELETE FROM working_memory WHERE key = 'conversation_capture_last_scan'`);
  });

  afterEach(async () => {
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
    const { root } = makeFixtureDir();
    originalDir = root;
    // 目录名必须以 itest- 开头，才能被 repo LIKE 'itest-%' 清理断言覆盖
    const finalProjectDir = path.join(root, `itest-${Date.now()}`);
    fs.mkdirSync(finalProjectDir);
    writeSession(finalProjectDir, 'session1.jsonl', [
      { type: 'user', uuid: 'itest-uuid-1', timestamp: new Date().toISOString(), message: { role: 'user', content: '这是集成测试真实写入的一条对话' } },
    ]);
    const repoName = path.basename(finalProjectDir);

    vi.stubEnv('CLAUDE_PROJECTS_DIR', root);
    vi.resetModules();
    const mod = await import('../../conversation-capture.js');
    const result = await mod.runConversationCapture(pool);
    expect(result.ok).toBe(true);
    expect(result.pushed).toBeGreaterThanOrEqual(1);

    const { rows } = await pool.query(
      `SELECT content, source, repo FROM captures WHERE source = 'conversation' AND repo = $1`,
      [repoName]
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].content).toBe('这是集成测试真实写入的一条对话');
    vi.unstubAllEnvs();
  });

  it('同一份 fixture 再跑一次不产生重复行（dedupe 生效）', async () => {
    const { root } = makeFixtureDir();
    originalDir = root;
    const finalProjectDir = path.join(root, `itest-${Date.now()}`);
    fs.mkdirSync(finalProjectDir);
    const sessionPath = writeSession(finalProjectDir, 'session2.jsonl', [
      { type: 'user', uuid: 'itest-uuid-dedupe', timestamp: new Date().toISOString(), message: { role: 'user', content: '去重测试内容' } },
    ]);
    const repoName = path.basename(finalProjectDir);

    vi.stubEnv('CLAUDE_PROJECTS_DIR', root);
    vi.resetModules();
    const mod = await import('../../conversation-capture.js');

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
    const { root } = makeFixtureDir();
    originalDir = root;
    const finalProjectDir = path.join(root, `itest-${Date.now()}`);
    fs.mkdirSync(finalProjectDir);
    const repoName = path.basename(finalProjectDir);
    writeSession(finalProjectDir, 'old-session.jsonl', [
      { type: 'user', uuid: 'itest-uuid-old', timestamp: new Date(Date.now() - 60_000).toISOString(), message: { role: 'user', content: '这条应该被跳过' } },
    ]);

    await pool.query(
      `INSERT INTO working_memory (key, value_json, updated_at) VALUES ($1, $2, NOW())
       ON CONFLICT (key) DO UPDATE SET value_json = $2, updated_at = NOW()`,
      ['conversation_capture_last_scan', JSON.stringify({ last_scan_at: new Date().toISOString(), pushed: 0, errors: 0 })]
    );

    vi.stubEnv('CLAUDE_PROJECTS_DIR', root);
    vi.resetModules();
    const mod = await import('../../conversation-capture.js');
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
    const { root } = makeFixtureDir();
    originalDir = root;
    const finalProjectDir = path.join(root, `itest-${Date.now()}`);
    fs.mkdirSync(finalProjectDir);
    writeSession(finalProjectDir, 'bad-session.jsonl', [
      { type: 'user', uuid: 'itest-uuid-bad', timestamp: new Date().toISOString(), message: { role: 'user', content: 'x'.repeat(3000) } },
    ]);

    vi.stubEnv('CLAUDE_PROJECTS_DIR', root);
    vi.resetModules();
    const captureInbox = await import('../../capture-inbox.js');
    const spy = vi.spyOn(captureInbox, 'pushCapture').mockRejectedValueOnce(new Error('模拟写入失败'));

    const mod = await import('../../conversation-capture.js');
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
  });
});
