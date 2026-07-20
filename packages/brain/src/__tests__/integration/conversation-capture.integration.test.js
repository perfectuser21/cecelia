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

  it('pushCapture 真实失败契约（resolve null，不 throw）时 errors 计数非零且 sentinel 可查到', async () => {
    // pushCapture 的真实契约是永不抛出：DB 错误内部 catch 后 console.warn 并
    // resolve(null)（见 capture-inbox.test.js:29）。用 mockRejectedValueOnce
    // 模拟"抛异常"不代表生产环境的真实失败模式，会掩盖 result===null 分支未
    // 计入 errors 的 bug（历史事故：相似功能静默丢数据 4 个月无人发现）。
    // 这里改用 mockResolvedValueOnce(null) 还原真实契约。
    const { root } = makeFixtureDir();
    originalDir = root;
    const finalProjectDir = path.join(root, `itest-${Date.now()}`);
    fs.mkdirSync(finalProjectDir);
    writeSession(finalProjectDir, 'bad-session.jsonl', [
      { type: 'user', uuid: 'itest-uuid-bad', timestamp: new Date().toISOString(), message: { role: 'user', content: '这条会被模拟成 pushCapture 内部失败' } },
    ]);

    vi.stubEnv('CLAUDE_PROJECTS_DIR', root);
    vi.resetModules();
    const captureInbox = await import('../../capture-inbox.js');
    const spy = vi.spyOn(captureInbox, 'pushCapture').mockResolvedValueOnce(null);

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

  it('repo 目录名超过 100 字符时会被截断写入，不触发 varchar(100) 约束失败（防止真实事故复现）', async () => {
    // 复现审查者在本机 ~/.claude/projects/ 发现的真实场景：嵌套 worktree 路径
    // 编码后的项目目录名可以轻松超过 captures.repo 的 varchar(100) 上限。
    // 若不截断，pushCapture 会内部吞掉约束错误并 resolve(null)，导致数据静默丢失
    // 且哨兵显示全绿——这正是本次修复要根治的事故模式。
    const { root } = makeFixtureDir();
    originalDir = root;
    const longSuffix = 'x'.repeat(90);
    const finalProjectDir = path.join(root, `itest-${Date.now()}-${longSuffix}`);
    fs.mkdirSync(finalProjectDir);
    const repoName = path.basename(finalProjectDir);
    expect(repoName.length).toBeGreaterThan(100);
    writeSession(finalProjectDir, 'long-dirname-session.jsonl', [
      { type: 'user', uuid: 'itest-uuid-longdir', timestamp: new Date().toISOString(), message: { role: 'user', content: '目录名超长场景下应该正常写入' } },
    ]);

    vi.stubEnv('CLAUDE_PROJECTS_DIR', root);
    vi.resetModules();
    const mod = await import('../../conversation-capture.js');
    const result = await mod.runConversationCapture(pool);
    expect(result.ok).toBe(true);
    expect(result.errors).toBe(0);
    expect(result.pushed).toBeGreaterThanOrEqual(1);

    const { rows } = await pool.query(
      `SELECT content, repo FROM captures WHERE source = 'conversation' AND repo = $1`,
      [repoName.slice(0, 100)]
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].content).toBe('目录名超长场景下应该正常写入');
    vi.unstubAllEnvs();
  });
});
