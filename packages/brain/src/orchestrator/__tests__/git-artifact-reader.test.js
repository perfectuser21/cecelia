import { afterEach, describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const dirs = [];

afterEach(() => {
  while (dirs.length > 0) rmSync(dirs.pop(), { recursive: true, force: true });
});

describe('readGitArtifact', () => {
  it('分支移动后仍按被批准 SHA 读取旧内容，并拒绝不安全对象路径', async () => {
    const repo = mkdtempSync(path.join(os.tmpdir(), 'contract-sha-reader-'));
    dirs.push(repo);
    const git = (...args) => execFileSync('git', args, { cwd: repo, encoding: 'utf8' }).trim();
    git('init');
    git('config', 'user.email', 'test@example.com');
    git('config', 'user.name', 'Test');
    writeFileSync(path.join(repo, 'contract.md'), 'approved\n');
    git('add', 'contract.md');
    git('commit', '-m', 'approved contract');
    const approvedSha = git('rev-parse', 'HEAD');
    writeFileSync(path.join(repo, 'contract.md'), 'moved\n');
    git('commit', '-am', 'move branch');

    const { readGitArtifact } = await import('../git-artifact-reader.js');

    expect(readGitArtifact(approvedSha, 'contract.md', { cwd: repo })).toBe('approved\n');
    expect(() => readGitArtifact('HEAD', 'contract.md', { cwd: repo })).toThrow(/commit SHA/);
    expect(() => readGitArtifact(approvedSha, '../contract.md', { cwd: repo })).toThrow(/repository-relative/);
  });
});
