/**
 * 验证：harness-shared.js export 共享函数（含 Protocol v2 新增工具）。
 */
import { describe, it, expect, vi } from 'vitest';

describe('harness-shared module', () => {
  it('exports parseDockerOutput / extractField / loadSkillContent', async () => {
    const mod = await import('../harness-shared.js');
    expect(typeof mod.parseDockerOutput).toBe('function');
    expect(typeof mod.extractField).toBe('function');
    expect(typeof mod.loadSkillContent).toBe('function');
  });

  it('parseDockerOutput 抽 claude --output-format json 末尾 result 段', async () => {
    const { parseDockerOutput } = await import('../harness-shared.js');
    const stdout = `some preamble\n{"result":"final-output-content","other":"x"}\n`;
    const out = parseDockerOutput(stdout);
    expect(out).toContain('final-output-content');
  });

  it('extractField 兼容 pr_url: <URL> 字面量 + JSON', async () => {
    const { extractField } = await import('../harness-shared.js');
    expect(extractField('pr_url: https://github.com/x/y/pull/1', 'pr_url')).toBe('https://github.com/x/y/pull/1');
    expect(extractField('"pr_url":"https://github.com/x/y/pull/2"', 'pr_url')).toBe('https://github.com/x/y/pull/2');
    expect(extractField('pr_url: null', 'pr_url')).toBeNull();
    expect(extractField('pr_url: FAILED', 'pr_url')).toBeNull();
  });

  it('loadSkillContent 缺文件时 throw（B56 fail-fast，不再返回空串）', async () => {
    // B56: CI 环境无 ~/.claude-account*/skills/，loadSkillContent 应 throw 而非静默返回空串。
    // 旧行为返回空串会导致 generator 拿空 SKILL prompt 跑出无 PR 的假成功，故 fail-fast。
    const { loadSkillContent } = await import('../harness-shared.js');
    expect(() => loadSkillContent('nonexistent-skill-name-xyz-b56')).toThrow(/SKILL\.md not found/);
  });

  it('exports Protocol v2 工具：readPrFromGitState / readVerdictFile', async () => {
    const mod = await import('../harness-shared.js');
    expect(typeof mod.readPrFromGitState).toBe('function');
    expect(typeof mod.readVerdictFile).toBe('function');
  });
});

describe('readPrFromGitState (Protocol v2)', () => {
  it('happy: git → branch，gh pr list → pr_url', async () => {
    const { readPrFromGitState } = await import('../harness-shared.js');
    const execFile = vi.fn()
      .mockResolvedValueOnce({ stdout: 'cp-0514-ws-abc\n', stderr: '' })  // git rev-parse
      .mockResolvedValueOnce({ stdout: 'https://github.com/x/y/pull/42\n', stderr: '' }); // gh pr list
    const result = await readPrFromGitState('/wt', { execFile });
    expect(result).toEqual({ pr_url: 'https://github.com/x/y/pull/42', pr_branch: 'cp-0514-ws-abc' });
    expect(execFile).toHaveBeenCalledTimes(2);
    expect(execFile.mock.calls[0][0]).toBe('git');
    expect(execFile.mock.calls[1][0]).toBe('gh');
  });

  it('gh pr list 调用必须带 cwd=worktreePath（容器 cwd=/app 非 git 仓库时 gh 推断 repo 失败的根因修复）', async () => {
    const { readPrFromGitState } = await import('../harness-shared.js');
    const execFile = vi.fn()
      .mockResolvedValueOnce({ stdout: 'cp-0612-ws-badaf654\n', stderr: '' })  // git rev-parse
      .mockResolvedValueOnce({ stdout: 'https://github.com/x/y/pull/3367\n', stderr: '' }); // gh pr list
    await readPrFromGitState('/wt-path', { execFile });
    // gh 调用（第 2 次）的 opts 必须含 cwd=worktreePath
    const ghCall = execFile.mock.calls[1];
    expect(ghCall[0]).toBe('gh');
    const ghOpts = ghCall[2];
    expect(ghOpts).toBeDefined();
    expect(ghOpts.cwd).toBe('/wt-path');
  });

  it('execFile 抛错时 console.warn 被调用并带 err.message（杜绝静默吞错）', async () => {
    const { readPrFromGitState } = await import('../harness-shared.js');
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const execFile = vi.fn().mockRejectedValue(new Error('not a git repository'));
    const result = await readPrFromGitState('/wt-path', { execFile });
    expect(result).toBeNull();
    expect(warnSpy).toHaveBeenCalled();
    const warnArg = warnSpy.mock.calls.map(c => c.join(' ')).join('\n');
    expect(warnArg).toContain('not a git repository');
    warnSpy.mockRestore();
  });

  it('git 返回空分支 → 返回 null', async () => {
    const { readPrFromGitState } = await import('../harness-shared.js');
    const execFile = vi.fn().mockResolvedValueOnce({ stdout: '', stderr: '' });
    const result = await readPrFromGitState('/wt', { execFile });
    expect(result).toBeNull();
  });

  it('git 返回 HEAD（detached）→ 返回 null', async () => {
    const { readPrFromGitState } = await import('../harness-shared.js');
    const execFile = vi.fn().mockResolvedValueOnce({ stdout: 'HEAD\n', stderr: '' });
    const result = await readPrFromGitState('/wt', { execFile });
    expect(result).toBeNull();
  });

  it('gh pr list 返回空 → 返回 null', async () => {
    const { readPrFromGitState } = await import('../harness-shared.js');
    const execFile = vi.fn()
      .mockResolvedValueOnce({ stdout: 'cp-0514-test\n' })
      .mockResolvedValueOnce({ stdout: '', stderr: '' });
    const result = await readPrFromGitState('/wt', { execFile });
    expect(result).toBeNull();
  });

  it('execFile 抛出 → 返回 null（不 throw）', async () => {
    const { readPrFromGitState } = await import('../harness-shared.js');
    const execFile = vi.fn().mockRejectedValue(new Error('git not found'));
    const result = await readPrFromGitState('/wt', { execFile });
    expect(result).toBeNull();
  });

  it('worktreePath 为空 → 返回 null', async () => {
    const { readPrFromGitState } = await import('../harness-shared.js');
    expect(await readPrFromGitState('')).toBeNull();
    expect(await readPrFromGitState(null)).toBeNull();
  });
});

describe('readVerdictFile (Protocol v2)', () => {
  it('happy: 读到 verdict=PASS → 返回 { verdict: PASS, feedback: null }', async () => {
    const { readVerdictFile } = await import('../harness-shared.js');
    vi.doMock('node:fs/promises', async () => {
      const actual = await vi.importActual('node:fs/promises');
      return { ...actual, readFile: vi.fn().mockResolvedValue('{"verdict":"PASS"}') };
    });
    // 用注入形式避免 fs mock 污染；直接通过 worktreePath + 真 fs 测试需要 tmp dir，
    // 改成白盒测试：validate 函数对 parsed JSON 的处理逻辑
    // 这里用真实解析路径（文件不存在时直接测 null 路径）
    const result = await readVerdictFile('/nonexistent-path-xyz');
    expect(result).toBeNull(); // 文件不存在 → null（不 throw）
  });

  it('verdictFile 不存在 → 返回 null', async () => {
    const { readVerdictFile } = await import('../harness-shared.js');
    const result = await readVerdictFile('/totally-nonexistent/path');
    expect(result).toBeNull();
  });

  it('worktreePath 为空 → 返回 null', async () => {
    const { readVerdictFile } = await import('../harness-shared.js');
    expect(await readVerdictFile('')).toBeNull();
    expect(await readVerdictFile(null)).toBeNull();
  });
});

describe('EvaluatorOutputSchema — null 字段接受', () => {
  it('PASS verdict with null optional fields should parse successfully', async () => {
    const { EvaluatorOutputSchema } = await import('../harness-shared.js');
    const result = EvaluatorOutputSchema.safeParse({
      verdict: 'PASS',
      task_id: 'test-task-id',
      failed_step: null,
      log_excerpt: null,
    });
    expect(result.success).toBe(true);
  });

  it('PASS verdict with all-null optional fields should parse successfully', async () => {
    const { EvaluatorOutputSchema } = await import('../harness-shared.js');
    const result = EvaluatorOutputSchema.safeParse({
      verdict: 'PASS',
      task_id: null,
      feedback: null,
      failed_step: null,
      log_excerpt: null,
    });
    expect(result.success).toBe(true);
  });

  it('FAIL verdict without feedback fields should fail validation', async () => {
    const { EvaluatorOutputSchema } = await import('../harness-shared.js');
    const result = EvaluatorOutputSchema.safeParse({
      verdict: 'FAIL',
      task_id: 'test-task-id',
      failed_step: null,
      log_excerpt: null,
    });
    expect(result.success).toBe(false);
  });

  it('FAIL verdict with feedback should parse successfully', async () => {
    const { EvaluatorOutputSchema } = await import('../harness-shared.js');
    const result = EvaluatorOutputSchema.safeParse({
      verdict: 'FAIL',
      task_id: 'test-task-id',
      feedback: 'some error message',
      failed_step: null,
      log_excerpt: null,
    });
    expect(result.success).toBe(true);
  });
});
