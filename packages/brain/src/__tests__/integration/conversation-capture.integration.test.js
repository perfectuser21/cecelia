import { describe, it, expect, beforeAll, afterEach, afterAll, vi } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';

let pool;

function makeFixtureHome() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'conv-capture-mt-itest-'));
  return root;
}

async function writeClaudeSession(homeRoot, projectSlug, fileName, entries) {
  const dir = path.join(homeRoot, '.claude', 'projects', projectSlug);
  fs.mkdirSync(dir, { recursive: true });
  const filePath = path.join(dir, fileName);
  fs.writeFileSync(filePath, entries.map((e) => JSON.stringify(e)).join('\n') + '\n');
  await pool.query(
    `INSERT INTO session_provenance(session_id, kind, launched_by)
     VALUES ($1, 'human', 'conversation-capture-integration')
     ON CONFLICT (session_id) DO NOTHING`,
    [fileName.replace(/\.jsonl$/, '')]
  );
  return filePath;
}

const FAKE_LLM = async () => ({ text: JSON.stringify({ topics: ['话题一', '话题二'] }) });

describe('conversation-capture 多工具集成（真 DB）', () => {
  let homeRoot;
  let originalHomedir;

  beforeAll(async () => {
    pool = (await import('../../db.js')).default;
    await pool.query(fs.readFileSync(new URL('../../../migrations/360_session_provenance.sql', import.meta.url), 'utf8'));
    originalHomedir = os.homedir;
  });

  afterEach(async () => {
    await pool.query(`DELETE FROM captures WHERE repo LIKE 'itest-mt-%'`);
    await pool.query(`DELETE FROM working_memory WHERE key = 'conversation_capture_last_scan'`);
    await pool.query(`DELETE FROM session_provenance WHERE launched_by = 'conversation-capture-integration'`);
    if (homeRoot && fs.existsSync(homeRoot)) fs.rmSync(homeRoot, { recursive: true, force: true });
    homeRoot = null;
    os.homedir = originalHomedir;
    vi.unstubAllEnvs();
  });

  afterAll(async () => {
    await pool.query(`DELETE FROM captures WHERE repo LIKE 'itest-mt-%'`);
    await pool.query(`DELETE FROM working_memory WHERE key = 'conversation_capture_last_scan'`);
    await pool.query(`DELETE FROM session_provenance WHERE launched_by = 'conversation-capture-integration'`);
  });

  it('已闲置≥15分钟的 session 产生原始文本+摘要两条 capture', async () => {
    homeRoot = makeFixtureHome();
    const oldTs = new Date(Date.now() - 20 * 60 * 1000).toISOString(); // 20分钟前，超过15分钟闲置阈值
    await writeClaudeSession(homeRoot, 'itest-mt-proj', 'session1.jsonl', [
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
    await writeClaudeSession(homeRoot, 'itest-mt-active', 'session2.jsonl', [
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
    await writeClaudeSession(homeRoot, 'itest-mt-dedup', 'session3.jsonl', [
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
    await writeClaudeSession(homeRoot, 'itest-mt-llmfail', 'session4.jsonl', [
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
    await writeClaudeSession(homeRoot, projectSlug, 'session5.jsonl', [
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

  // Critical #1 回归测试（final code review 挖出）：mtime 增量过滤器 sinceMs 若取自
  // "上次扫描时间"（会随每次 10 分钟扫描滑动追上 now），会和 15 分钟闲置阈值互斥——
  // 文件写完后 mtime 固定不变，等它真正闲置满 15 分钟时，sinceMs 早已滑过 mtime，
  // 文件被过滤器永久排除，结构性地永远捕获不到任何 session。之前的用例全部走
  // afterEach 清空哨兵 = 每次都是冷启动（无 sentinel），根本走不到这条滑动路径，
  // 检测不出这个 bug class。这里手工预置一个"刚刚扫描过"的哨兵（模拟 sinceMs 貌似
  // 逼近 now 的场景）+ 用 fs.utimesSync 把文件 mtime 钉死在 20 分钟前，验证修复后
  // （固定 35 分钟回看窗口，而非跟着上次扫描时间滑动）依然能捕获到。
  it('固定回看窗口下，mtime 早于"上次扫描时间"但仍在闲置阈值内的 session 依然会被捕获（回归 Critical #1）', async () => {
    homeRoot = makeFixtureHome();
    const idleMs = 20 * 60 * 1000; // 20分钟前，越过15分钟闲置阈值
    const oldTs = new Date(Date.now() - idleMs).toISOString();
    const filePath = await writeClaudeSession(homeRoot, 'itest-mt-lookback', 'session-lookback.jsonl', [
      { type: 'user', uuid: 'u1', timestamp: oldTs, message: { role: 'user', content: '跨扫描周期闲置捕获测试' } },
    ]);
    // 模拟"文件写完后再没被碰过"：mtime 固定钉在 20 分钟前，不会随扫描推进而改变。
    const oldMtime = new Date(Date.now() - idleMs);
    fs.utimesSync(filePath, oldMtime, oldMtime);

    vi.stubEnv('CLAUDE_PROJECTS_DIR', path.join(homeRoot, '.claude', 'projects'));
    os.homedir = () => homeRoot;

    // 预置一个"1 分钟前刚扫描过"的哨兵——旧版 bug 的必要条件：如果 sinceMs 取自
    // 这个值（约等于 now），就会比文件 mtime（20 分钟前）晚，导致文件被 mtime
    // 过滤器排除。修复后 sinceMs 应改为固定的 now-35min 回看窗口，与这个哨兵值
    // 无关，因此依然能读到这个文件。
    await pool.query(
      `INSERT INTO working_memory (key, value_json, updated_at)
       VALUES ($1, $2, NOW())
       ON CONFLICT (key) DO UPDATE SET value_json = $2, updated_at = NOW()`,
      ['conversation_capture_last_scan', JSON.stringify({
        last_scan_at: new Date(Date.now() - 60 * 1000).toISOString(),
        pushed: 0,
        errors: 0,
      })]
    );

    vi.resetModules();
    const mod = await import('../../conversation-capture.js');
    const result = await mod.runConversationCapture(pool, { llm: FAKE_LLM });
    expect(result.ok).toBe(true);
    expect(result.pushed).toBeGreaterThanOrEqual(1);

    const { rows } = await pool.query(
      `SELECT nature, content FROM captures WHERE repo = 'itest-mt-lookback' ORDER BY nature NULLS FIRST`
    );
    expect(rows).toHaveLength(2);
    expect(rows[0].content).toBe('跨扫描周期闲置捕获测试');
  });

  // Critical #2 回归测试（final code review 挖出）：summarizeSession（调 Haiku）此前对
  // idleSessions 里的每个 session 无条件调用，哪怕这个 session 早在上一轮扫描就已经
  // 完整处理过（原始文本 + 摘要都已入库）。pushCapture 自己的 dedupe 只挡重复行，挡不
  // 住这次多余的 LLM 调用。随着 Critical #1 把回看窗口放宽到 35 分钟，同一个已处理
  // session 会在连续好几轮扫描里反复出现在 idleSessions 中，每次都会重新触发一次真实
  // LLM 调用——这里验证修复后（写入前先查 captures.dedupe_key 是否已存在，命中则整段
  // session 跳过）第二次扫描不会再调用 LLM。
  it('同一已闲置 session 连续两次扫描只调用一次 LLM，不重复计费（回归 Critical #2）', async () => {
    homeRoot = makeFixtureHome();
    const oldTs = new Date(Date.now() - 20 * 60 * 1000).toISOString();
    await writeClaudeSession(homeRoot, 'itest-mt-llmonce', 'session-llmonce.jsonl', [
      { type: 'user', uuid: 'u1', timestamp: oldTs, message: { role: 'user', content: 'LLM只调用一次测试' } },
    ]);
    vi.stubEnv('CLAUDE_PROJECTS_DIR', path.join(homeRoot, '.claude', 'projects'));
    os.homedir = () => homeRoot;

    const spyLlm = vi.fn(FAKE_LLM);

    vi.resetModules();
    const mod = await import('../../conversation-capture.js');
    const firstResult = await mod.runConversationCapture(pool, { llm: spyLlm });
    expect(firstResult.pushed).toBeGreaterThanOrEqual(1);
    expect(spyLlm).toHaveBeenCalledTimes(1);

    mod.__resetConversationCaptureForTest();
    await mod.runConversationCapture(pool, { llm: spyLlm });
    expect(spyLlm).toHaveBeenCalledTimes(1); // 第二轮同一 session 已捕获，LLM 不应被再次调用

    const { rows } = await pool.query(`SELECT id FROM captures WHERE repo = 'itest-mt-llmonce'`);
    expect(rows).toHaveLength(2); // 原始+摘要各一条，第二轮没有多写也没有多调 LLM
  });

  it('同一 session 复聊后再次闲置：更新已有 capture 内容而不新增行（dedupeKey 从绑 lastEntryId 改为只绑 sessionId 后的回归测试）', async () => {
    homeRoot = makeFixtureHome();
    const oldTs = new Date(Date.now() - 20 * 60 * 1000).toISOString();
    const filePath = await writeClaudeSession(homeRoot, 'itest-mt-resume', 'session-resume.jsonl', [
      { type: 'user', uuid: 'u1', timestamp: oldTs, message: { role: 'user', content: '第一轮内容' } },
    ]);
    vi.stubEnv('CLAUDE_PROJECTS_DIR', path.join(homeRoot, '.claude', 'projects'));
    os.homedir = () => homeRoot;

    vi.resetModules();
    const mod = await import('../../conversation-capture.js');
    await mod.runConversationCapture(pool, { llm: FAKE_LLM });

    // 模拟复聊：同一 sessionId（文件名不变），追加一条新消息，lastEntryId 变了
    const laterTs = new Date(Date.now() - 20 * 60 * 1000 + 1000).toISOString();
    fs.appendFileSync(filePath, JSON.stringify(
      { type: 'user', uuid: 'u2', timestamp: laterTs, message: { role: 'user', content: '复聊后的新内容' } }
    ) + '\n');
    const idleMtime = new Date(Date.now() - 20 * 60 * 1000);
    fs.utimesSync(filePath, idleMtime, idleMtime);

    mod.__resetConversationCaptureForTest();
    await mod.runConversationCapture(pool, { llm: FAKE_LLM });

    const { rows } = await pool.query(
      `SELECT nature, content FROM captures WHERE repo = 'itest-mt-resume' ORDER BY nature NULLS FIRST`
    );
    expect(rows).toHaveLength(2); // 仍然只有原始+摘要各一条，不因复聊翻倍
    expect(rows[0].content).toContain('复聊后的新内容'); // 内容已更新为最新
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
    await writeClaudeSession(homeRoot, 'itest-mt-pushfail', 'session6.jsonl', [
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
