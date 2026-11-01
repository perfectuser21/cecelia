// runner.sh 启动器：clone 缺失则 clone；工作区干净才自更新到 origin/main；不干净不破坏现场；最后 exec run-once.mjs。
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { cleanTestEnv } from './helpers/sandbox.mjs';
import { git, gitPlain } from '../../__tests__/helpers/git.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const RUNNER_SH = path.join(HERE, '../runner.sh');
const STUB_REL = 'packages/brain/scripts/coding-workflow/runner/run-once.mjs';
// 桩 run-once：打印标记、cwd 与当前 HEAD 提交说明，证明 exec 的是 clone 里的那份
const STUB = `import { execFileSync } from 'node:child_process';
const head = execFileSync('git', ['log', '-1', '--format=%s'], { encoding: 'utf8' }).trim();
console.log(JSON.stringify({ marker: 'RUN_ONCE_STUB', cwd: process.cwd(), head, token: process.env.DEPLOY_TOKEN ?? null, internal: process.env.CECELIA_INTERNAL_TOKEN ?? null }));
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
    // 不读本机真实凭据文件：默认指向不存在的路径，且不继承外部 DEPLOY_TOKEN
    env = { ...cleanTestEnv(), CODING_WF_LOCK_DIR: path.join(root, 'locks'), CODING_WF_PROVIDER: 'claude', CODING_WF_REPO: clone, CODING_WF_ORIGIN_URL: origin, CODING_WF_DEPLOY_TOKEN_FILE: path.join(root, 'no-token.env'), CODING_WF_INTERNAL_TOKEN_FILE: path.join(root, 'no-internal.env') };
    delete env.DEPLOY_TOKEN;
    delete env.CECELIA_INTERNAL_TOKEN;
  });

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  const stubOut = (r) => JSON.parse(r.stdout.trim().split('\n').pop());

  it('clone 不存在：git clone 后 exec clone 里的 run-once.mjs（cwd=clone）', () => {
    const r = runRunner(env);
    expect(r.status, r.stderr).toBe(0);
    expect(fs.existsSync(path.join(clone, '.git'))).toBe(true);
    expect(stubOut(r)).toEqual({ marker: 'RUN_ONCE_STUB', cwd: clone, head: 'v1', token: null, internal: null });
  });

  it('DEPLOY_TOKEN：环境里没有时从凭据文件读（QA 门请求预览环境用）；环境已有则不覆盖', () => {
    const tokenFile = path.join(root, 'deploy-token.env');
    fs.writeFileSync(tokenFile, 'DEPLOY_TOKEN=from-file\n');
    let r = runRunner({ ...env, CODING_WF_DEPLOY_TOKEN_FILE: tokenFile });
    expect(r.status, r.stderr).toBe(0);
    expect(stubOut(r).token).toBe('from-file');
    r = runRunner({ ...env, CODING_WF_DEPLOY_TOKEN_FILE: tokenFile, DEPLOY_TOKEN: 'from-env' });
    expect(stubOut(r).token).toBe('from-env');
  });

  // 金丝雀 3：上报 spans 被生产 Brain 401（POST /spans 要内部令牌）→ 启动时从凭据文件读，只取这一个变量，不把整份文件导进环境
  it('CECELIA_INTERNAL_TOKEN：环境里没有时从凭据文件只取这一项；环境已有则不覆盖', () => {
    const tokenFile = path.join(root, 'internal.env');
    fs.writeFileSync(tokenFile, 'OTHER_SECRET=nope\nCECELIA_INTERNAL_TOKEN="from-file"\n');
    let r = runRunner({ ...env, CODING_WF_INTERNAL_TOKEN_FILE: tokenFile });
    expect(r.status, r.stderr).toBe(0);
    expect(stubOut(r).internal).toBe('from-file');
    r = runRunner({ ...env, CODING_WF_INTERNAL_TOKEN_FILE: tokenFile, CECELIA_INTERNAL_TOKEN: 'from-env' });
    expect(stubOut(r).internal).toBe('from-env');
  });

  it('工作区干净：fetch + fast-forward origin/main 自更新到最新', () => {
    gitPlain('clone', '-q', origin, clone);
    commitSeed('v2');
    const r = runRunner(env);
    expect(r.status, r.stderr).toBe(0);
    expect(stubOut(r).head).toBe('v2');
    expect(git(clone, 'rev-parse', 'HEAD')).toBe(git(origin, 'rev-parse', 'main'));
  });

  // C1 runner-log-noise：每 5 分钟一行「已自更新到 origin/main <同一个 sha>」曾占主日志 43% 行数
  it('自更新日志只在 HEAD 变了时打一行；没变不打', () => {
    gitPlain('clone', '-q', origin, clone);
    commitSeed('v2');
    let r = runRunner(env);
    expect(r.status, r.stderr).toBe(0);
    expect(r.stderr.match(/已自更新到 origin\/main/g)).toHaveLength(1);
    expect(r.stderr).toContain(git(origin, 'rev-parse', '--short', 'main').trim());
    r = runRunner(env);
    expect(r.status, r.stderr).toBe(0);
    expect(r.stderr).not.toContain('已自更新');
    expect(stubOut(r).head).toBe('v2');
    commitSeed('v3');
    r = runRunner(env);
    expect(r.stderr.match(/已自更新到 origin\/main/g)).toHaveLength(1);
    expect(stubOut(r).head).toBe('v3');
  });

  it('工作区不干净：记日志、不更新、不动现场，也不执行源码', () => {
    gitPlain('clone', '-q', origin, clone);
    commitSeed('v2');
    fs.writeFileSync(path.join(clone, 'local-note.txt'), 'keep me\n');
    const r = runRunner(env);
    expect(r.status).not.toBe(0);
    expect(r.stderr).toContain('工作区不干净');
    expect(r.status).not.toBe(0);
    expect(r.stdout).not.toContain('RUN_ONCE_STUB');
    expect(git(clone, 'log', '-1', '--format=%s').trim()).toBe('v1');
    expect(fs.readFileSync(path.join(clone, 'local-note.txt'), 'utf8')).toBe('keep me\n');
  });

  function runtimeFiles() {
    fs.mkdirSync(path.join(clone, '.cecelia/lights'), { recursive: true });
    fs.symlinkSync('../guardian.sh', path.join(clone, '.cecelia/hb.sh'));
    fs.writeFileSync(path.join(clone, '.cecelia/lights/nosid000-cp-test.live'), 'live');
  }

  it('未跟踪心跳文件不阻挡自更新，symlink与灯原样保留', () => {
    gitPlain('clone', '-q', origin, clone);
    runtimeFiles();
    const light = path.join(clone, '.cecelia/lights/nosid000-cp-test.live');
    const before = fs.statSync(light).mtimeMs;
    commitSeed('v2');
    const r = runRunner(env);
    expect(r.status, r.stderr).toBe(0);
    expect(stubOut(r).head).toBe('v2');
    expect(fs.readlinkSync(path.join(clone, '.cecelia/hb.sh'))).toBe('../guardian.sh');
    expect(fs.readFileSync(light, 'utf8')).toBe('live');
    expect(fs.statSync(light).mtimeMs).toBe(before);
  });

  it.each(['tracked', 'staged', 'unknown', 'special', 'nested', 'tracked-heartbeat'])('心跳噪音不能掩盖 %s 改动', (kind) => {
    if (kind === 'tracked-heartbeat') {
      fs.mkdirSync(path.join(seed, '.cecelia'), { recursive: true });
      fs.writeFileSync(path.join(seed, '.cecelia/hb.sh'), 'tracked');
      commitSeed('v1');
    }
    gitPlain('clone', '-q', origin, clone);
    if (kind !== 'tracked-heartbeat') runtimeFiles();
    const file = kind === 'tracked-heartbeat' ? '.cecelia/hb.sh' : ['tracked', 'staged'].includes(kind) ? 'version.txt' : kind === 'special' ? '.cecelia/lights/a\nb.live' : kind === 'nested' ? '.cecelia/lights/nested/x.live' : '.cecelia/unknown';
    fs.mkdirSync(path.dirname(path.join(clone, file)), { recursive: true });
    fs.writeFileSync(path.join(clone, file), 'keep');
    if (kind === 'staged') git(clone, 'add', 'version.txt');
    commitSeed('v2');
    const r = runRunner(env);
    expect(r.status).not.toBe(0);
    expect(r.stdout).not.toContain('RUN_ONCE_STUB');
    expect(git(clone, 'log', '-1', '--format=%s').trim()).toBe('v1');
    expect(fs.readFileSync(path.join(clone, file), 'utf8')).toBe('keep');
  });

  it.each(['local-commit', 'diverged', 'branch', 'detached', 'merge', 'rebase'])('拒更新 %s，保留原HEAD', (kind) => {
    gitPlain('clone', '-q', origin, clone);
    git(clone, 'config', 'user.name', 'test');
    git(clone, 'config', 'user.email', 'test@example.com');
    git(clone, 'config', 'core.hooksPath', path.join(root, 'no-hooks'));
    if (['local-commit', 'diverged'].includes(kind)) git(clone, 'commit', '--allow-empty', '-m', 'local');
    if (kind === 'branch') git(clone, 'checkout', '-b', 'cp-user');
    if (kind === 'detached') git(clone, 'checkout', '--detach');
    if (kind === 'merge') fs.writeFileSync(path.join(clone, '.git/MERGE_HEAD'), git(clone, 'rev-parse', 'HEAD'));
    if (kind === 'rebase') fs.mkdirSync(path.join(clone, '.git/rebase-merge'));
    const before = git(clone, 'rev-parse', 'HEAD');
    if (kind !== 'local-commit') commitSeed('v2');
    const r = runRunner(env);
    expect(r.status).not.toBe(0); expect(r.stdout).not.toContain('RUN_ONCE_STUB');
    expect(git(clone, 'rev-parse', 'HEAD')).toBe(before);
  });

  it('远端新增同名运行态文件时拒绝更新，不覆盖灯', () => {
    gitPlain('clone', '-q', origin, clone);
    runtimeFiles();
    fs.mkdirSync(path.join(seed, '.cecelia/lights'), { recursive: true });
    fs.writeFileSync(path.join(seed, '.cecelia/lights/nosid000-cp-test.live'), 'remote');
    commitSeed('v2');
    const r = runRunner(env);
    expect(r.status).not.toBe(0);
    expect(r.stdout).not.toContain('RUN_ONCE_STUB');
    expect(git(clone, 'log', '-1', '--format=%s').trim()).toBe('v1');
    expect(fs.readFileSync(path.join(clone, '.cecelia/lights/nosid000-cp-test.live'), 'utf8')).toBe('live');
  });

  it('Git status失败即拒绝更新，不把空输出当干净', () => {
    gitPlain('clone', '-q', origin, clone);
    commitSeed('v2');
    const bin = path.join(root, 'bin'); fs.mkdirSync(bin);
    const realGit = spawnSync('which', ['git'], { encoding: 'utf8' }).stdout.trim();
    fs.writeFileSync(path.join(bin, 'git'), `#!/bin/bash\nfor a in "$@"; do if [ "$a" = status ]; then exit 77; fi; done\nexec "${realGit}" "$@"\n`, { mode: 0o755 });
    runRunner({ ...env, PATH: `${bin}:${env.PATH}` });
    expect(git(clone, 'log', '-1', '--format=%s').trim()).toBe('v1');
  });

  it('已有run-once持锁时不更新也不启动新一轮', () => {
    gitPlain('clone', '-q', origin, clone); commitSeed('v2');
    const lock = path.join(env.CODING_WF_LOCK_DIR, 'coding-workflow-runner.lock');
    fs.mkdirSync(lock, { recursive: true });
    fs.writeFileSync(path.join(lock, 'pid'), String(process.pid));
    fs.writeFileSync(path.join(lock, 'started_at'), String(Date.now()));
    const r = runRunner(env);
    expect(git(clone, 'log', '-1', '--format=%s').trim()).toBe('v1');
    expect(r.stdout).not.toContain('RUN_ONCE_STUB');
    expect(fs.readFileSync(path.join(lock, 'pid'), 'utf8')).toBe(String(process.pid));
  });

  it('外层锁贯穿子进程执行，SIGTERM等待子进程收尾再释放', async () => {
    fs.writeFileSync(path.join(seed, STUB_REL), `import fs from 'node:fs';
fs.writeFileSync(process.env.READY, 'ready');
process.on('SIGTERM', () => setTimeout(() => { fs.writeFileSync(process.env.FINISHED, 'done'); process.exit(0); }, 200));
setInterval(() => {}, 1000);`);
    commitSeed('v1-wait');
    const ready = path.join(root, 'ready'); const finished = path.join(root, 'finished');
    const child = spawn('bash', [RUNNER_SH], { env: { ...env, READY: ready, FINISHED: finished }, stdio: 'ignore' });
    try {
      for (let i = 0; i < 100 && !fs.existsSync(ready); i++) await new Promise(r => setTimeout(r, 50));
      expect(fs.existsSync(ready)).toBe(true);
      commitSeed('v2');
      const second = runRunner(env);
      expect(second.stdout).not.toContain('RUN_ONCE_STUB');
      expect(git(clone, 'log', '-1', '--format=%s').trim()).toBe('v1-wait');
      child.kill('SIGTERM');
      await new Promise(r => child.once('exit', r));
      expect(fs.readFileSync(finished, 'utf8')).toBe('done');
      expect(fs.existsSync(path.join(env.CODING_WF_LOCK_DIR, 'launcher/coding-workflow-runner.lock'))).toBe(false);
    } finally { child.kill('SIGKILL'); }
  }, 20000);

  it('账户预检失败时不更新、不启动run-once，不回退Claude', () => {
    gitPlain('clone', '-q', origin, clone); commitSeed('v2');
    const r = runRunner({ ...env, CODING_WF_PROVIDER: 'codex', CODING_WF_CODEX_HOME: path.join(root, 'missing-account') });
    expect(r.status).not.toBe(0);
    expect(r.stdout).not.toContain('RUN_ONCE_STUB');
    expect(git(clone, 'log', '-1', '--format=%s').trim()).toBe('v1');
    expect(fs.existsSync(path.join(env.CODING_WF_LOCK_DIR, 'coding-workflow-runner.lock'))).toBe(false);
    expect(fs.existsSync(path.join(env.CODING_WF_LOCK_DIR, 'launcher/coding-workflow-runner.lock'))).toBe(false);
  });

  it('更新后内锁交还run-once，外锁持续持有至正常退出', () => {
    fs.writeFileSync(path.join(seed, STUB_REL), `import fs from 'node:fs';
const dir = process.env.CODING_WF_LOCK_DIR;
console.log(JSON.stringify({ inner: fs.existsSync(dir + '/coding-workflow-runner.lock'), outer: fs.existsSync(dir + '/launcher/coding-workflow-runner.lock') }));`);
    commitSeed('v2-lock-handoff');
    const r = runRunner(env);
    expect(r.status, r.stderr).toBe(0);
    expect(stubOut(r)).toEqual({ inner: false, outer: true });
    expect(fs.existsSync(path.join(env.CODING_WF_LOCK_DIR, 'launcher/coding-workflow-runner.lock'))).toBe(false);
  });

  it('fetch期间源码变脏则重新检查，不快进', () => {
    gitPlain('clone', '-q', origin, clone); commitSeed('v2');
    const bin = path.join(root, 'bin'); fs.mkdirSync(bin);
    const realGit = spawnSync('which', ['git'], { encoding: 'utf8' }).stdout.trim();
    fs.writeFileSync(path.join(bin, 'git'), `#!/bin/bash\nfor a in "$@"; do if [ "$a" = fetch ]; then printf keep > "${clone}/during-fetch.txt"; fi; done\nexec "${realGit}" "$@"\n`, { mode: 0o755 });
    const r = runRunner({ ...env, PATH: `${bin}:${env.PATH}` });
    expect(r.status).not.toBe(0);
    expect(r.stdout).not.toContain('RUN_ONCE_STUB');
    expect(git(clone, 'log', '-1', '--format=%s').trim()).toBe('v1');
    expect(fs.readFileSync(path.join(clone, 'during-fetch.txt'), 'utf8')).toBe('keep');
  });

  it('快进不覆盖被ignore的本地文件', () => {
    fs.writeFileSync(path.join(seed, '.gitignore'), 'ignored.txt\n'); commitSeed('v1');
    gitPlain('clone', '-q', origin, clone);
    fs.writeFileSync(path.join(clone, 'ignored.txt'), 'keep');
    fs.writeFileSync(path.join(seed, 'ignored.txt'), 'remote'); git(seed, 'add', '-f', 'ignored.txt'); commitSeed('v2');
    const r = runRunner(env);
    expect(r.status).not.toBe(0);
    expect(r.stdout).not.toContain('RUN_ONCE_STUB');
    expect(git(clone, 'log', '-1', '--format=%s').trim()).toBe('v1'); expect(fs.readFileSync(path.join(clone, 'ignored.txt'), 'utf8')).toBe('keep');
  });

  it.each(['execution', 'fetch'])('终止%s阶段会有界回收忽略SIGTERM的独立组子孙，再释放锁', async (phase) => {
    const marker = path.join(root, 'tree.json');
    const treeCode = `import fs from 'node:fs'; import { spawn } from 'node:child_process';
process.on('SIGTERM',()=>{});
const child = spawn(process.execPath, ['-e', "process.on('SIGTERM',()=>{}); setInterval(()=>{},1000)"], { detached: true, stdio: 'ignore' });
fs.writeFileSync(${JSON.stringify(marker)}, JSON.stringify([process.pid,child.pid])); setInterval(()=>{},1000);`;
    let runEnv = { ...env, CODING_WF_LAUNCHER_KILL_GRACE_MS: '150' };
    if (phase === 'execution') { fs.writeFileSync(path.join(seed, STUB_REL), treeCode); commitSeed('v1-tree'); }
    else {
      gitPlain('clone', '-q', origin, clone); commitSeed('v2');
      const bin = path.join(root, 'bin'); fs.mkdirSync(bin); fs.writeFileSync(path.join(root, 'tree.mjs'), treeCode);
      const realGit = spawnSync('which', ['git'], { encoding: 'utf8' }).stdout.trim();
      fs.writeFileSync(path.join(bin, 'git'), `#!/bin/bash\nfor a in "$@"; do if [ "$a" = fetch ]; then exec "${process.execPath}" "${root}/tree.mjs"; fi; done\nexec "${realGit}" "$@"\n`, { mode: 0o755 });
      runEnv.PATH = `${bin}:${env.PATH}`;
    }
    const child = spawn('bash', [RUNNER_SH], { env: runEnv, stdio: 'ignore' });
    const exited = new Promise(r => child.once('exit', r));
    let pids = [];
    try {
      for (let i = 0; i < 100 && !fs.existsSync(marker); i++) await new Promise(r => setTimeout(r, 50));
      expect(fs.existsSync(marker)).toBe(true); pids = JSON.parse(fs.readFileSync(marker, 'utf8'));
      child.kill('SIGTERM');
      await Promise.race([exited, new Promise((_, reject) => setTimeout(() => reject(new Error('launcher termination timed out')), 3000).unref())]);
      for (const pid of pids) {
        for (let i = 0; i < 20; i++) { try { process.kill(pid, 0); await new Promise(r => setTimeout(r, 50)); } catch { break; } }
        expect(() => process.kill(pid, 0)).toThrow();
      }
      expect(fs.existsSync(path.join(env.CODING_WF_LOCK_DIR, 'launcher/coding-workflow-runner.lock'))).toBe(false);
      expect(fs.existsSync(path.join(env.CODING_WF_LOCK_DIR, 'coding-workflow-runner.lock'))).toBe(false);
    } finally { child.kill('SIGKILL'); for (const pid of pids) { try { process.kill(pid, 'SIGKILL'); } catch {} } }
  }, 12000);

  it('fetch网络失败时拒绝本轮执行，不靠猜测认定旧代码安全', () => {
    gitPlain('clone', '-q', origin, clone);
    git(clone, 'remote', 'set-url', 'origin', path.join(root, 'missing-origin'));
    const r = runRunner(env);
    expect(r.status).not.toBe(0); expect(r.stdout).not.toContain('RUN_ONCE_STUB');
    expect(r.stderr).toContain('runtime_update_not_verified');
    expect(git(clone, 'log', '-1', '--format=%s').trim()).toBe('v1');
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

  // C5：已启用的其他仓库（repos.json + CODING_WF_REPOS）clone 不存在时 clone；已存在的不 fetch / 不 reset（不动现场）
  describe('多仓库 clone', () => {
    let zjOrigin;
    let zjSeed;
    let zjClone;
    let reposFile;

    const commitZj = (msg) => {
      fs.writeFileSync(path.join(zjSeed, 'zj.txt'), `${msg}\n`);
      git(zjSeed, 'add', '.');
      git(zjSeed, 'commit', '-q', '-m', msg);
      git(zjSeed, 'push', '-q', 'origin', 'main');
    };

    beforeEach(() => {
      // seed 带上真实的 repos.mjs 与 list-clones.mjs（runner.sh 用 clone 里的这两份列出要补的 clone）
      for (const rel of ['lib/repos.mjs', 'list-clones.mjs']) {
        const dest = path.join(seed, path.dirname(STUB_REL), rel);
        fs.mkdirSync(path.dirname(dest), { recursive: true });
        fs.copyFileSync(path.join(HERE, '..', rel), dest);
      }
      commitSeed('v1-repos');
      zjOrigin = path.join(root, 'zj.git');
      zjSeed = path.join(root, 'zj-seed');
      zjClone = path.join(root, 'zj-clone');
      gitPlain('init', '--bare', '-q', '-b', 'main', zjOrigin);
      gitPlain('init', '-q', '-b', 'main', zjSeed);
      git(zjSeed, 'config', 'user.name', 'seed');
      git(zjSeed, 'config', 'user.email', 'seed@example.com');
      git(zjSeed, 'config', 'core.hooksPath', path.join(root, 'no-hooks'));
      git(zjSeed, 'remote', 'add', 'origin', zjOrigin);
      commitZj('z1');
      const real = JSON.parse(fs.readFileSync(path.join(HERE, '../../repos.json'), 'utf8')).repos;
      const z = real.find((r) => r.key === 'zenithjoy-workspace');
      reposFile = path.join(root, 'repos.json');
      fs.writeFileSync(reposFile, JSON.stringify({ repos: [...real.filter((r) => r.key !== z.key),
        { ...z, key: 'zj', aliases: ['zj'], slug: 'acme/zj', origin: zjOrigin, clone: zjClone, worktree_base: path.join(root, 'wt-zj'), state_ns: 'zj', enabled: true }] }));
    });

    it('所有启用仓库的 origin 和 clone 均限定在测试沙箱内', () => {
      const repos = JSON.parse(fs.readFileSync(reposFile, 'utf8')).repos;
      const inside = (candidate) => path.isAbsolute(candidate)
        && !path.relative(root, candidate).startsWith('..')
        && path.relative(root, candidate) !== '..';
      for (const repo of repos.filter((entry) => entry.enabled)) {
        expect(inside(repo.origin), `${repo.key} origin`).toBe(true);
        expect(inside(repo.clone), `${repo.key} clone`).toBe(true);
      }
    });

    it('zj 已启用且 clone 不存在 → clone 到 repos.json 的路径，照常 exec', () => {
      const r = runRunner({ ...env, CODING_WF_REPOS_FILE: reposFile });
      expect(r.status, r.stderr).toBe(0);
      expect(git(zjClone, 'rev-parse', 'HEAD')).toBe(git(zjOrigin, 'rev-parse', 'main'));
      expect(stubOut(r).marker).toBe('RUN_ONCE_STUB');
    });

    it('CODING_WF_REPOS 只开 cecelia → 不 clone zj', () => {
      const r = runRunner({ ...env, CODING_WF_REPOS_FILE: reposFile, CODING_WF_REPOS: 'cecelia' });
      expect(r.status, r.stderr).toBe(0);
      expect(fs.existsSync(zjClone)).toBe(false);
    });

    it('zj clone 已存在：不 fetch、不 reset --hard（本地改动和落后的 HEAD 原样保留）', () => {
      gitPlain('clone', '-q', zjOrigin, zjClone);
      const before = git(zjClone, 'rev-parse', 'HEAD');
      commitZj('z2');
      fs.writeFileSync(path.join(zjClone, 'zj.txt'), 'local edit\n');
      const r = runRunner({ ...env, CODING_WF_REPOS_FILE: reposFile });
      expect(r.status, r.stderr).toBe(0);
      expect(git(zjClone, 'rev-parse', 'HEAD')).toBe(before);
      expect(fs.readFileSync(path.join(zjClone, 'zj.txt'), 'utf8')).toBe('local edit\n');
    });

    it('zj clone 失败：记日志，不影响默认仓照常 exec', () => {
      fs.writeFileSync(reposFile, fs.readFileSync(reposFile, 'utf8').replace(JSON.stringify(zjOrigin), JSON.stringify(path.join(root, 'missing-zj.git'))));
      const r = runRunner({ ...env, CODING_WF_REPOS_FILE: reposFile });
      expect(r.status, r.stderr).toBe(0);
      expect(r.stderr).toContain('clone');
      expect(stubOut(r).marker).toBe('RUN_ONCE_STUB');
    });
  });

  it('clone 失败：非零退出且不 exec', () => {
    const r = runRunner({ ...env, CODING_WF_ORIGIN_URL: path.join(root, 'missing.git') });
    expect(r.status).not.toBe(0);
    expect(r.stdout).not.toContain('RUN_ONCE_STUB');
  });
});
