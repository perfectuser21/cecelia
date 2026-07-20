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
  let originalHomedir;

  beforeAll(async () => {
    pool = (await import('../../db.js')).default;
    originalHomedir = os.homedir;
  });

  afterEach(async () => {
    await pool.query(`DELETE FROM captures WHERE repo LIKE 'itest-mt-%'`);
    await pool.query(`DELETE FROM working_memory WHERE key = 'conversation_capture_last_scan'`);
    if (homeRoot && fs.existsSync(homeRoot)) fs.rmSync(homeRoot, { recursive: true, force: true });
    homeRoot = null;
    os.homedir = originalHomedir;
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
    os.homedir = () => homeRoot; // 隔离 codex/grok 适配器，两者用 os.homedir() 兜底，无 env 覆盖入口，避免扫到本机真实 ~/.codex*/~/.grok 历史污染断言

    vi.resetModules();
    const mod = await import('../../conversation-capture.js');
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
    os.homedir = () => homeRoot; // 隔离 codex/grok 适配器，两者用 os.homedir() 兜底，无 env 覆盖入口，避免扫到本机真实 ~/.codex*/~/.grok 历史污染断言

    vi.resetModules();
    const mod = await import('../../conversation-capture.js');
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
    os.homedir = () => homeRoot; // 隔离 codex/grok 适配器，两者用 os.homedir() 兜底，无 env 覆盖入口，避免扫到本机真实 ~/.codex*/~/.grok 历史污染断言

    vi.resetModules();
    const mod = await import('../../conversation-capture.js');
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
    os.homedir = () => homeRoot; // 隔离 codex/grok 适配器，两者用 os.homedir() 兜底，无 env 覆盖入口，避免扫到本机真实 ~/.codex*/~/.grok 历史污染断言

    const failingLlm = async () => { throw new Error('模拟LLM调用失败'); };
    vi.resetModules();
    const mod = await import('../../conversation-capture.js');
    const result = await mod.runConversationCapture(pool, { llm: failingLlm });
    expect(result.ok).toBe(true);

    const { rows } = await pool.query(`SELECT nature FROM captures WHERE repo = 'itest-mt-llmfail'`);
    expect(rows).toHaveLength(1);
    expect(rows[0].nature).toBeNull(); // 只有原始文本那条，摘要那条因LLM失败没写
  });

  // 历史坑（PR#4135 code review 挖出，旧版 conversation-capture.integration.test.js
  // 已删除但这两条覆盖有必要在新的 session 模型下保留，见 Task 3 交接说明）：

  it('repo 目录名超过 100 字符时会被截断写入，不触发 varchar(100) 约束失败（防止真实事故复现）', async () => {
    // 复现审查者在本机 ~/.claude/projects/ 发现的真实场景：嵌套 worktree 路径
    // 编码后的项目目录名可以轻松超过 captures.repo 的 varchar(100) 上限。
    // Task 1 的三个适配器各自在归一化阶段做了 `.slice(0, 100)`（例如
    // conversation-capture-claude.js 的 `repo: dir.name.slice(0, 100)`），
    // 这条测试验证的是编排层 + 适配器整条链路在超长目录名下依然产生正常写入
    // （而不是让 varchar(100) 约束错误被 pushCapture 内部吞掉、resolve(null)，
    // 导致数据静默丢失且哨兵显示全绿——这正是本次修复要根治的事故模式）。
    homeRoot = makeFixtureHome();
    const oldTs = new Date(Date.now() - 20 * 60 * 1000).toISOString();
    const longSuffix = 'x'.repeat(90);
    const projectSlug = `itest-mt-trunc-${longSuffix}`;
    expect(projectSlug.length).toBeGreaterThan(100);
    writeClaudeSession(homeRoot, projectSlug, 'session5.jsonl', [
      { type: 'user', uuid: 'u1', timestamp: oldTs, message: { role: 'user', content: '目录名超长场景下应该正常写入' } },
    ]);
    vi.stubEnv('CLAUDE_PROJECTS_DIR', path.join(homeRoot, '.claude', 'projects'));
    os.homedir = () => homeRoot; // 隔离 codex/grok 适配器，两者用 os.homedir() 兜底，无 env 覆盖入口，避免扫到本机真实 ~/.codex*/~/.grok 历史污染断言

    vi.resetModules();
    const mod = await import('../../conversation-capture.js');
    const result = await mod.runConversationCapture(pool, { llm: FAKE_LLM });
    expect(result.ok).toBe(true);
    expect(result.errors).toBe(0);
    expect(result.pushed).toBeGreaterThanOrEqual(1);

    const truncatedRepo = projectSlug.slice(0, 100);
    const { rows } = await pool.query(
      `SELECT content, repo FROM captures WHERE repo = $1 ORDER BY nature NULLS FIRST`,
      [truncatedRepo]
    );
    expect(rows).toHaveLength(2);
    expect(rows[0].repo.length).toBeLessThanOrEqual(100);
    expect(rows[0].content).toBe('目录名超长场景下应该正常写入');
  });

  it('pushCapture 真实失败契约（resolve null，不 throw）时 errors 计数非零且 sentinel 可查到', async () => {
    // pushCapture 的真实契约是永不抛出：DB 错误内部 catch 后 console.warn 并
    // resolve(null)（见 packages/brain/src/capture-inbox.js 末尾 catch 块）。用
    // mockRejectedValueOnce 模拟"抛异常"不代表生产环境的真实失败模式，会掩盖
    // result===null 分支未计入 errors 的 bug（历史事故：相似功能静默丢数据 4 个
    // 月无人发现）。这里改用 mockResolvedValueOnce(null) 还原真实契约，并验证
    // 编排层（新版 conversation-capture.js 的 `if (result?.captureId) {...} else
    // { errors++ }` 分支）真的把它计入 errors，不是静默吞掉。
    homeRoot = makeFixtureHome();
    const oldTs = new Date(Date.now() - 20 * 60 * 1000).toISOString();
    writeClaudeSession(homeRoot, 'itest-mt-pushfail', 'session6.jsonl', [
      { type: 'user', uuid: 'u1', timestamp: oldTs, message: { role: 'user', content: '这条会被模拟成 pushCapture 内部失败' } },
    ]);
    vi.stubEnv('CLAUDE_PROJECTS_DIR', path.join(homeRoot, '.claude', 'projects'));
    os.homedir = () => homeRoot; // 隔离 codex/grok 适配器，两者用 os.homedir() 兜底，无 env 覆盖入口，避免扫到本机真实 ~/.codex*/~/.grok 历史污染断言

    vi.resetModules();
    const captureInbox = await import('../../capture-inbox.js');
    const spy = vi.spyOn(captureInbox, 'pushCapture').mockResolvedValueOnce(null);

    const mod = await import('../../conversation-capture.js');
    let threw = false;
    let result;
    try {
      result = await mod.runConversationCapture(pool, { llm: FAKE_LLM });
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
  });
});
