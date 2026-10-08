// runner.sh 启动器：clone 缺失则 clone；工作区干净才自更新到 origin/main；不干净不破坏现场；最后 exec run-once.mjs。
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { childEnv } from '../../lib/protocol.mjs';
import { git, gitPlain } from '../../__tests__/helpers/git.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const RUNNER_SH = path.join(HERE, '../runner.sh');
const STUB_REL = 'packages/brain/scripts/coding-workflow/runner/run-once.mjs';
// 桩 run-once：打印标记、cwd 与当前 HEAD 提交说明，证明 exec 的是 clone 里的那份
const STUB = `import { execFileSync } from 'node:child_process';
const head = execFileSync('git', ['log', '-1', '--format=%s'], { encoding: 'utf8' }).trim();
console.log(JSON.stringify({ marker: 'RUN_ONCE_STUB', cwd: process.cwd(), head }));
`;

function runRunner(env) {
  return spawnSync('bash', [RUNNER_SH], { env, encoding: 'utf8', timeout: 30000 });
}

describe('runner.sh 启动器', () => {
  let root;
  let origin;
  let seed;
  let clone;
  let env;

  const commitSeed = (msg) => {
    fs.writeFileSync(path.join(seed, 'version.txt'), `${msg}\n`);
    git(seed, 'add', '.');
    git(seed, 'commit', '-q', '-m', msg);
    git(seed, 'push', '-q', 'origin', 'main');
  };

  beforeEach(() => {
    root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'cw-runner-sh-')));
    origin = path.join(root, 'origin.git');
    seed = path.join(root, 'seed');
    clone = path.join(root, 'clone');
    gitPlain('init', '--bare', '-q', '-b', 'main', origin);
    gitPlain('init', '-q', '-b', 'main', seed);
    git(seed, 'config', 'user.name', 'seed');
    git(seed, 'config', 'user.email', 'seed@example.com');
    git(seed, 'config', 'core.hooksPath', path.join(root, 'no-hooks'));
    git(seed, 'remote', 'add', 'origin', origin);
    fs.mkdirSync(path.join(seed, path.dirname(STUB_REL)), { recursive: true });
    fs.writeFileSync(path.join(seed, STUB_REL), STUB);
    commitSeed('v1');
    env = { ...childEnv(), CODING_WF_REPO: clone, CODING_WF_ORIGIN_URL: origin };
  });

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  const stubOut = (r) => JSON.parse(r.stdout.trim().split('\n').pop());

  it('clone 不存在：git clone 后 exec clone 里的 run-once.mjs（cwd=clone）', () => {
    const r = runRunner(env);
    expect(r.status, r.stderr).toBe(0);
    expect(fs.existsSync(path.join(clone, '.git'))).toBe(true);
    expect(stubOut(r)).toEqual({ marker: 'RUN_ONCE_STUB', cwd: clone, head: 'v1' });
  });

  it('工作区干净：fetch + reset --hard origin/main 自更新到最新', () => {
    gitPlain('clone', '-q', origin, clone);
    commitSeed('v2');
    const r = runRunner(env);
    expect(r.status, r.stderr).toBe(0);
    expect(stubOut(r).head).toBe('v2');
    expect(git(clone, 'rev-parse', 'HEAD')).toBe(git(origin, 'rev-parse', 'main'));
  });

  it('工作区不干净：记日志、不更新、不动现场，照常 exec', () => {
    gitPlain('clone', '-q', origin, clone);
    commitSeed('v2');
    fs.writeFileSync(path.join(clone, 'local-note.txt'), 'keep me\n');
    const r = runRunner(env);
    expect(r.status, r.stderr).toBe(0);
    expect(r.stderr).toContain('工作区不干净');
    expect(stubOut(r).head).toBe('v1');
    expect(fs.readFileSync(path.join(clone, 'local-note.txt'), 'utf8')).toBe('keep me\n');
  });

  it('主日志超过 10MB 时滚动（copy+truncate），保留 3 份', () => {
    gitPlain('clone', '-q', origin, clone);
    const main = path.join(root, 'runner.log');
    fs.writeFileSync(main, Buffer.alloc(10 * 1024 * 1024 + 1, 'a'));
    fs.writeFileSync(`${main}.1`, 'one');
    fs.writeFileSync(`${main}.2`, 'two');
    fs.writeFileSync(`${main}.3`, 'three');
    const r = runRunner({ ...env, CODING_WF_MAIN_LOG: main });
    expect(r.status, r.stderr).toBe(0);
    expect(fs.statSync(`${main}.1`).size).toBe(10 * 1024 * 1024 + 1);
    expect(fs.readFileSync(`${main}.2`, 'utf8')).toBe('one');
    expect(fs.readFileSync(`${main}.3`, 'utf8')).toBe('two');
    expect(fs.existsSync(`${main}.4`)).toBe(false);
    expect(fs.statSync(main).size).toBe(0);
  });

  it('主日志未超限：不滚动', () => {
    gitPlain('clone', '-q', origin, clone);
    const main = path.join(root, 'runner.log');
    fs.writeFileSync(main, 'small');
    const r = runRunner({ ...env, CODING_WF_MAIN_LOG: main });
    expect(r.status, r.stderr).toBe(0);
    expect(fs.readFileSync(main, 'utf8')).toBe('small');
    expect(fs.existsSync(`${main}.1`)).toBe(false);
  });

  it('clone 失败：非零退出且不 exec', () => {
    const r = runRunner({ ...env, CODING_WF_ORIGIN_URL: path.join(root, 'missing.git') });
    expect(r.status).not.toBe(0);
    expect(r.stdout).not.toContain('RUN_ONCE_STUB');
  });
});
