// run-once 每轮保留期清理：超期的 cw-* worktree（连同本地分支）与超期的回执/日志。
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { git } from '../../__tests__/helpers/git.mjs';
import { startFakeBrain, makeSandbox, runnerEnv, runOnceProcess } from './helpers/sandbox.mjs';

const DAY = 24 * 3600 * 1000;

/** 把文件 mtime 拨回 days 天前。 */
function age(file, days) {
  const t = new Date(Date.now() - days * DAY);
  fs.utimesSync(file, t, t);
}

describe('coding workflow runner 保留期清理', () => {
  let sb;
  let brain;

  beforeEach(async () => {
    sb = makeSandbox();
    brain = await startFakeBrain({ tasks: [] });
  });

  afterEach(async () => {
    await brain.close();
    sb.cleanup();
  });

  const addWorktree = (name, branch) => {
    const wt = path.join(sb.worktreeBase, name);
    fs.mkdirSync(sb.worktreeBase, { recursive: true });
    git(sb.clone, 'worktree', 'add', '-q', '-b', branch, wt, 'origin/main');
    return wt;
  };
  const branches = () => git(sb.clone, 'branch', '--format=%(refname:short)').trim().split('\n');

  it('失败现场默认保留 7 天：超期的 cw-* worktree 与本地分支被删，未超期与非 cw-* 目录不动', async () => {
    const old = addWorktree('cw-0000000a', 'cp-10010000-cw-0000000a');
    const fresh = addWorktree('cw-0000000b', 'cp-10070000-cw-0000000b');
    const other = path.join(sb.worktreeBase, 'keep-me');
    fs.mkdirSync(other);
    age(path.join(old, '.git'), 8);
    age(path.join(fresh, '.git'), 6);
    age(other, 30);

    const r = await runOnceProcess(runnerEnv(sb, brain.url));
    expect(r.exitCode, r.stderr).toBe(0);
    expect(fs.existsSync(old)).toBe(false);
    expect(fs.existsSync(fresh)).toBe(true);
    expect(fs.existsSync(other)).toBe(true);
    expect(branches()).not.toContain('cp-10010000-cw-0000000a');
    expect(branches()).toContain('cp-10070000-cw-0000000b');
    expect(git(sb.clone, 'worktree', 'list')).not.toContain('cw-0000000a');
  }, 30000);

  it('CODING_WF_FAILED_RETENTION_DAYS 可配置', async () => {
    const wt = addWorktree('cw-0000000c', 'cp-10070000-cw-0000000c');
    age(path.join(wt, '.git'), 3);
    const r = await runOnceProcess(runnerEnv(sb, brain.url, { CODING_WF_FAILED_RETENTION_DAYS: '2' }));
    expect(r.exitCode, r.stderr).toBe(0);
    expect(fs.existsSync(wt)).toBe(false);
  }, 30000);

  it('回执与日志（每任务 .json/.log）保留 30 天，其余文件不动', async () => {
    fs.mkdirSync(sb.logDir, { recursive: true });
    const file = (name, days) => {
      const p = path.join(sb.logDir, name);
      fs.writeFileSync(p, 'x');
      age(p, days);
      return p;
    };
    const oldJson = file('t-old.json', 31);
    const oldLog = file('t-old.log', 31);
    const newJson = file('t-new.json', 29);
    const otherOld = file('notes.txt', 90);
    const r = await runOnceProcess(runnerEnv(sb, brain.url));
    expect(r.exitCode, r.stderr).toBe(0);
    expect(fs.existsSync(oldJson)).toBe(false);
    expect(fs.existsSync(oldLog)).toBe(false);
    expect(fs.existsSync(newJson)).toBe(true);
    expect(fs.existsSync(otherOld)).toBe(true);
  }, 30000);
});
