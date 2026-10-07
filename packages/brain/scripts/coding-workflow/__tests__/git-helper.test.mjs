import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { git, gitPlain } from './helpers/git.mjs';

const KEYS = ['GIT_DIR', 'GIT_WORK_TREE', 'GIT_INDEX_FILE'];

describe('测试用 git 辅助函数的环境隔离', () => {
  let root;
  let unrelated;
  let repo;
  let saved;

  beforeEach(() => {
    saved = Object.fromEntries(KEYS.map((k) => [k, process.env[k]]));
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'git-helper-test-'));
    unrelated = path.join(root, 'unrelated');
    repo = path.join(root, 'repo');
    // 先在干净环境里建好两个仓库，再污染 process.env
    for (const k of KEYS) delete process.env[k];
    gitPlain('init', '-q', unrelated);
    gitPlain('init', '-q', repo);
  });
  afterEach(() => {
    for (const k of KEYS) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
    fs.rmSync(root, { recursive: true, force: true });
  });

  it('继承了 GIT_DIR/GIT_WORK_TREE/GIT_INDEX_FILE 时，git() 仍只写目标仓库', () => {
    process.env.GIT_DIR = path.join(unrelated, '.git');
    process.env.GIT_WORK_TREE = unrelated;
    process.env.GIT_INDEX_FILE = path.join(unrelated, '.git/index');

    git(repo, 'config', 'core.hooksPath', 'x');

    expect(fs.readFileSync(path.join(unrelated, '.git/config'), 'utf8')).not.toContain('hooksPath');
    expect(fs.readFileSync(path.join(repo, '.git/config'), 'utf8')).toContain('hooksPath = x');
  });

  it('gitPlain（无 -C 的 init/clone 场景）同样隔离', () => {
    process.env.GIT_DIR = path.join(unrelated, '.git');
    const target = path.join(root, 'fresh');
    gitPlain('init', '-q', target);
    expect(fs.existsSync(path.join(target, '.git/config'))).toBe(true);
    expect(fs.readFileSync(path.join(unrelated, '.git/config'), 'utf8')).not.toContain('bare = true');
  });
});
