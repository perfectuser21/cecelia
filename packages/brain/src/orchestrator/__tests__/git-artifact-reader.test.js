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

  it('批准 SHA 只存在于 origin 时，按精确 SHA fetch 后读取不可变内容', async () => {
    const remote = mkdtempSync(path.join(os.tmpdir(), 'contract-sha-remote-'));
    const producer = mkdtempSync(path.join(os.tmpdir(), 'contract-sha-producer-'));
    const consumer = mkdtempSync(path.join(os.tmpdir(), 'contract-sha-consumer-'));
    dirs.push(remote, producer, consumer);

    execFileSync('git', ['init', '--bare', remote], { encoding: 'utf8' });
    const git = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();

    git(producer, 'init');
    git(producer, 'config', 'user.email', 'test@example.com');
    git(producer, 'config', 'user.name', 'Test');
    git(producer, 'remote', 'add', 'origin', remote);
    writeFileSync(path.join(producer, 'contract.md'), 'approved remote content\n');
    git(producer, 'add', 'contract.md');
    git(producer, 'commit', '-m', 'approved remote contract');
    const approvedSha = git(producer, 'rev-parse', 'HEAD');
    git(producer, 'push', 'origin', 'HEAD:refs/heads/approved-contract');

    git(consumer, 'init');
    git(consumer, 'remote', 'add', 'origin', remote);
    expect(() => git(consumer, 'cat-file', '-e', `${approvedSha}^{commit}`)).toThrow();

    const { readGitArtifact } = await import('../git-artifact-reader.js');

    expect(readGitArtifact(approvedSha, 'contract.md', { cwd: consumer }))
      .toBe('approved remote content\n');
    expect(git(consumer, 'cat-file', '-e', `${approvedSha}^{commit}`)).toBe('');
  });

  it('批准 SHA 属于跨仓库 base_repo 时，从该权威仓库读取而不是本仓 origin', async () => {
    // 生产实弹 run 4925488b：批准分支/SHA 在 perfectuser21/zenithjoy-workspace，
    // Brain 本仓 origin 是 cecelia —— 只从 origin 读必然 approved_but_contract_artifacts_missing。
    const ceceliaRemote = mkdtempSync(path.join(os.tmpdir(), 'contract-sha-cecelia-'));
    const zenithjoyRemote = mkdtempSync(path.join(os.tmpdir(), 'contract-sha-zenithjoy-'));
    const producer = mkdtempSync(path.join(os.tmpdir(), 'contract-sha-zj-producer-'));
    const consumer = mkdtempSync(path.join(os.tmpdir(), 'contract-sha-brain-'));
    dirs.push(ceceliaRemote, zenithjoyRemote, producer, consumer);

    execFileSync('git', ['init', '--bare', ceceliaRemote], { encoding: 'utf8' });
    execFileSync('git', ['init', '--bare', zenithjoyRemote], { encoding: 'utf8' });
    const git = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();

    git(producer, 'init');
    git(producer, 'config', 'user.email', 'test@example.com');
    git(producer, 'config', 'user.name', 'Test');
    git(producer, 'remote', 'add', 'origin', zenithjoyRemote);
    writeFileSync(path.join(producer, 'contract-draft.md'), 'zenithjoy approved contract\n');
    git(producer, 'add', 'contract-draft.md');
    git(producer, 'commit', '-m', 'approved zenithjoy contract');
    const approvedSha = git(producer, 'rev-parse', 'HEAD');
    git(producer, 'push', 'origin', 'HEAD:refs/heads/cp-harness-propose-r8-7194e308-a137');

    // 本仓（Brain 所在 cecelia）origin 里根本没有这个 SHA
    git(consumer, 'init');
    git(consumer, 'remote', 'add', 'origin', ceceliaRemote);

    const { readGitArtifact } = await import('../git-artifact-reader.js');

    const seenRepos = [];
    expect(readGitArtifact(approvedSha, 'contract-draft.md', {
      cwd: consumer,
      repo: 'perfectuser21/zenithjoy-workspace',
      remoteUrlForRepo: (repo) => {
        seenRepos.push(repo);
        return zenithjoyRemote;
      },
    })).toBe('zenithjoy approved contract\n');
    expect(seenRepos).toEqual(['perfectuser21/zenithjoy-workspace']);
  });

  it('权威仓库限定在 WORKSPACE_REPOSITORIES allow-list 内，其余 fail closed', async () => {
    const repo = mkdtempSync(path.join(os.tmpdir(), 'contract-sha-badrepo-'));
    dirs.push(repo);
    execFileSync('git', ['init', repo], { encoding: 'utf8' });
    const { readGitArtifact } = await import('../git-artifact-reader.js');
    const { WORKSPACE_REPOSITORIES } = await import('../workspace-spec.js');

    const rejected = [
      'perfectuser21/zenithjoy-workspace; rm -rf /', // shell 注入形态
      'https://evil.example.com/x.git', // 任意 URL
      'nope', // 非 owner/repo
      'perfectuser21/zenithjoy-skills', // 形状合法但不在 workspace allow-list 内
      'attacker/zenithjoy-workspace', // owner 冒名
    ];
    for (const bad of rejected) {
      expect(WORKSPACE_REPOSITORIES).not.toContain(bad);
      expect(() => readGitArtifact('b'.repeat(40), 'contract.md', { cwd: repo, repo: bad }))
        .toThrow(/authoritative repository/);
    }
    // allow-list 内的仓库必须仍被接受（走到 fetch 才失败，而不是被 repo 校验拦下）
    for (const allowed of WORKSPACE_REPOSITORIES) {
      expect(() => readGitArtifact('b'.repeat(40), 'contract.md', {
        cwd: repo,
        repo: allowed,
        remoteUrlForRepo: () => '/nonexistent-remote-for-allowlist-probe',
      })).toThrow(/nonexistent-remote-for-allowlist-probe|Command failed/);
    }
  });
});
