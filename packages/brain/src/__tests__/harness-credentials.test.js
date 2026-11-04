import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { resolveGitHubToken } from '../harness-credentials.js';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readFixedGitFile } from '../workflow-authoring/fixed-git-source.js';

describe('resolveGitHubToken', () => {
  const origEnv = process.env.GITHUB_TOKEN;

  beforeEach(() => {
    delete process.env.GITHUB_TOKEN;
    vi.resetModules();
  });

  afterEach(() => {
    if (origEnv !== undefined) process.env.GITHUB_TOKEN = origEnv;
    else delete process.env.GITHUB_TOKEN;
    vi.restoreAllMocks();
  });

  it('prefers process.env.GITHUB_TOKEN when non-empty', async () => {
    process.env.GITHUB_TOKEN = 'ghs_fromEnv';
    const token = await resolveGitHubToken({ execFn: async () => 'ghs_fromGh', readFileFn: async () => 'GITHUB_TOKEN=ghs_fromFile\n' });
    expect(token).toBe('ghs_fromEnv');
  });

  it('falls back to gh auth token when env missing', async () => {
    const token = await resolveGitHubToken({ execFn: async () => 'ghs_fromGh\n', readFileFn: async () => 'GITHUB_TOKEN=ghs_fromFile\n' });
    expect(token).toBe('ghs_fromGh');
  });

  it('falls back to credentials file when gh fails', async () => {
    const token = await resolveGitHubToken({
      execFn: async () => { throw new Error('gh not logged in'); },
      readFileFn: async () => 'GITHUB_TOKEN=ghs_fromFile\nOTHER=x\n',
    });
    expect(token).toBe('ghs_fromFile');
  });

  it('throws github_token_unavailable when all sources fail', async () => {
    await expect(resolveGitHubToken({
      execFn: async () => { throw new Error('no gh'); },
      readFileFn: async () => { throw new Error('no file'); },
    })).rejects.toThrow('github_token_unavailable');
  });

  it('treats empty env var as missing (not hit)', async () => {
    process.env.GITHUB_TOKEN = '';
    const token = await resolveGitHubToken({ execFn: async () => 'ghs_fromGh', readFileFn: async () => '' });
    expect(token).toBe('ghs_fromGh');
  });
});


// 捕获默认readFile接缝被重复解析的错误；不替换readFileFn，不读取真实凭据路径。
describe('resolveGitHubToken — owned凭据文件真实接缝', () => {
  let directory, credsPath, savedToken;
  beforeEach(() => {
    savedToken = process.env.GITHUB_TOKEN;
    delete process.env.GITHUB_TOKEN;
    directory = mkdtempSync(join(tmpdir(), 'github-token-owned-'));
    credsPath = join(directory, 'github.env');
  });
  afterEach(() => {
    if (savedToken === undefined) delete process.env.GITHUB_TOKEN;
    else process.env.GITHUB_TOKEN = savedToken;
    rmSync(directory, { recursive: true, force: true });
    vi.restoreAllMocks();
  });
  const ghUnavailable = async () => { throw new Error('owned gh unavailable'); };
  function writeOwned(content) { writeFileSync(credsPath, content, { mode: 0o600 }); }

  it.each([
    ['gh失败', 'GITHUB_TOKEN=owned_file_token\nOTHER=fixture\n', ghUnavailable],
    ['gh空结果', 'GITHUB_TOKEN=owned_file_token\n', async () => ''],
    ['现有CRLF与空白语法', 'OTHER=fixture\r\n  GITHUB_TOKEN = owned_file_token  \r\n', ghUnavailable],
  ])('%s时从实际文件返回值，不再次把token当env行解析', async (_label, content, execFn) => {
    process.env.GITHUB_TOKEN = '  ';
    writeOwned(content);
    await expect(resolveGitHubToken({ credsPath, execFn })).resolves.toBe('owned_file_token');
  });

  it.each(['OTHER=fixture\n', 'GITHUB_TOKEN=\n', 'GITHUB_TOKEN=not a token\n'])('无可接受值的实际文件明确失败：%j', async content => {
    writeOwned(content);
    await expect(resolveGitHubToken({ credsPath, execFn: ghUnavailable })).rejects.toThrow('github_token_unavailable');
  });

  it('实际文件不存在时保持明确失败', async () => {
    await expect(resolveGitHubToken({ credsPath, execFn: ghUnavailable })).rejects.toThrow('github_token_unavailable');
  });

  it('env优先于gh与真实文件', async () => {
    writeOwned('GITHUB_TOKEN=owned_file_token\n');
    process.env.GITHUB_TOKEN = ' owned_env_token ';
    const execFn = vi.fn(async () => 'owned_gh_token');
    await expect(resolveGitHubToken({ credsPath, execFn })).resolves.toBe('owned_env_token');
    expect(execFn).not.toHaveBeenCalled();
  });

  it('gh优先于真实文件', async () => {
    writeOwned('GITHUB_TOKEN=owned_file_token\n');
    await expect(resolveGitHubToken({ credsPath, execFn: async () => ' owned_gh_token\n' })).resolves.toBe('owned_gh_token');
  });

  it('现役固定Git读取消费真实resolver的文件fallback，仅注入网络外边界', async () => {
    writeOwned('GITHUB_TOKEN=owned_file_token\n');
    const fetchFn = vi.fn(async (_url, options) => {
      expect(options.headers.Authorization).toBe('Bearer owned_file_token');
      throw new Error('owned fetch boundary reached');
    });
    await expect(readFixedGitFile({ repo: 'perfectuser21/cecelia', revision: 'a'.repeat(40), path: 'contract.json' }, {
      resolveToken: () => resolveGitHubToken({ credsPath, execFn: ghUnavailable }), fetchFn,
    })).rejects.toThrow('owned fetch boundary reached');
    expect(fetchFn).toHaveBeenCalledOnce();
  });
});
