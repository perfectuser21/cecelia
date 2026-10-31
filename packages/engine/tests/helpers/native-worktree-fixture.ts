import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const ENGINE_ROOT = resolve(__dirname, '../..');
export const WORKTREE_MANAGE = join(ENGINE_ROOT, 'skills/dev/scripts/worktree-manage.sh');
export const CLEANUP = join(ENGINE_ROOT, 'skills/dev/scripts/cleanup.sh');
export const worktreePathFromOutput = (stdout: string) => stdout.trim().split('\n').at(-1) || '';

export function nativeWorktreeFixture() {
  const base = realpathSync(mkdtempSync(join(tmpdir(), 'native-worktree-')));
  const repo = join(base, 'repo'), home = join(base, 'home'), worktrees = join(base, 'worktrees'), bin = join(base, 'bin');
  for (const dir of [repo, home, bin, join(base, 'tmp')]) mkdirSync(dir);
  // 外部 PR 查询为离线边界；其余 Git/worktree/flock/jq/guardian 均运行真实工具。
  writeFileSync(join(bin, 'gh'), '#!/bin/sh\nprintf "[]\\n"\n');
  chmodSync(join(bin, 'gh'), 0o755);
  const env: Record<string, string> = {
    PATH: `${bin}:${process.env.PATH || '/usr/bin:/bin'}`, HOME: home, TMPDIR: join(base, 'tmp'),
    BRAIN_URL: 'http://127.0.0.1:1', GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_SYSTEM: '/dev/null',
    LANG: 'C.UTF-8', WORKTREE_BASE: worktrees, CLAUDE_SESSION_ID: 'native-fixture-session', HEARTBEAT_INTERVAL: '0.1',
  };
  const run = (command: string, args: string[], overrides: Record<string, string> = {}) =>
    spawnSync(command, args, { cwd: repo, env: { ...env, ...overrides }, shell: false, encoding: 'utf8', timeout: 10000 });
  let scriptNumber = 0;
  // 固定测试正文写本人脚本文件，路径/参数仅走argv；避免bash -c混合代码与数据。
  const shell = (script: string, args: string[] = [], overrides: Record<string, string> = {}) => {
    const file = join(base, 'tmp', `shell-${scriptNumber++}.sh`);
    writeFileSync(file, script, { flag: 'wx', mode: 0o600 });
    try { return run('bash', [file, ...args], overrides); }
    finally { rmSync(file, { force: true }); }
  };
  const git = (...args: string[]) => {
    const result = run('git', args);
    if (result.status !== 0) throw new Error(`fixture git ${args.join(' ')} failed: ${result.stderr}`);
    return result.stdout.trim();
  };
  git('init', '-q', '-b', 'main'); git('config', 'user.name', 'fixture'); git('config', 'user.email', 'fixture@example.invalid');
  git('config', 'core.hooksPath', '/dev/null');
  writeFileSync(join(repo, '.gitignore'), '.cecelia/\n.dev-lock.*\n.dev-mode.*\n');
  git('add', '.'); git('commit', '-qm', 'fixture base');
  const guardians = () => {
    const lights = join(repo, '.cecelia/lights');
    return existsSync(lights) ? readdirSync(lights).filter(name => name.endsWith('.live')).map(name => ({
      file: join(lights, name), ...JSON.parse(readFileSync(join(lights, name), 'utf8')),
    })) : [];
  };
  const dispose = () => {
    for (const light of guardians()) {
      const pid = Number(light.guardian_pid);
      const command = spawnSync('ps', ['-p', String(pid), '-o', 'args='], { encoding: 'utf8' }).stdout || '';
      // 只发信号给该fixture的guardian，绝不按宽泛进程名pkill。
      if (Number.isSafeInteger(pid) && pid > 1 && command.includes(join(repo, '.cecelia/hb.sh'))) {
        try { process.kill(pid, 'SIGTERM'); } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error; }
      }
    }
    rmSync(base, { recursive: true, force: true });
  };
  return { base, repo, home, worktrees, bin, env, run, shell, git, guardians, dispose };
}
