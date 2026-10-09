import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, chmodSync, rmSync, existsSync, statSync, mkdirSync, realpathSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';

const LAUNCHER = resolve(__dirname, '../../../../scripts/claude-launch.sh');

describe('Phase 7.1 claude-launch.sh', () => {
  let mockDir: string;

  beforeAll(() => {
    mockDir = mkdtempSync(join(tmpdir(), 'claude-launch-test-'));
    const mockClaude = join(mockDir, 'claude');
    writeFileSync(mockClaude, `#!/usr/bin/env bash
echo "CLAUDE_SESSION_ID=$CLAUDE_SESSION_ID"
echo "ARGS=$*"
`);
    chmodSync(mockClaude, 0o755);
  });

  afterAll(() => {
    rmSync(mockDir, { recursive: true, force: true });
  });

  it('launcher 脚本存在且可执行', () => {
    expect(existsSync(LAUNCHER)).toBe(true);
    const mode = statSync(LAUNCHER).mode;
    expect(mode & 0o111).toBeGreaterThan(0);
  });

  it('有 env 时继承 CLAUDE_SESSION_ID 并传 --session-id', () => {
    // launcher 优先用 CLAUDE_CODE_EXECPATH，必须 unset 才能让 PATH 里 mock claude 生效
    const env: Record<string, string> = {
      ...process.env,
      PATH: `${mockDir}:${process.env.PATH}`,
      CLAUDE_SESSION_ID: 'inherited-test-uuid',
      CECELIA_NO_AUTO_WORKTREE: '1',
    };
    delete env.CLAUDE_CODE_EXECPATH;
    const out = execSync(`bash "${LAUNCHER}" --help`, { shell: '/bin/bash', env }).toString();
    expect(out).toContain('CLAUDE_SESSION_ID=inherited-test-uuid');
    expect(out).toContain('--session-id inherited-test-uuid');
    expect(out).toContain('--help');
  });

  it('无 env 时生成符合 UUID 格式的 session_id', () => {
    const env = { ...process.env, PATH: `${mockDir}:${process.env.PATH}`, CECELIA_NO_AUTO_WORKTREE: '1' };
    delete env.CLAUDE_SESSION_ID;
    delete env.CLAUDE_CODE_EXECPATH;
    const out = execSync(`bash "${LAUNCHER}" --help`, { shell: '/bin/bash', env }).toString();
    const m = out.match(/CLAUDE_SESSION_ID=([a-f0-9-]+)/);
    expect(m).toBeTruthy();
    expect(m![1]).toMatch(/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/);
    expect(out).toContain(`--session-id ${m![1]}`);
  });

  it('透传额外参数给 claude', () => {
    const env: Record<string, string> = {
      ...process.env,
      PATH: `${mockDir}:${process.env.PATH}`,
      CLAUDE_SESSION_ID: 'fixed',
      CECELIA_NO_AUTO_WORKTREE: '1',
    };
    delete env.CLAUDE_CODE_EXECPATH;
    const out = execSync(`bash "${LAUNCHER}" -p test-prompt --dangerously-skip-permissions`, { shell: '/bin/bash', env }).toString();
    expect(out).toContain('-p test-prompt');
    expect(out).toContain('--dangerously-skip-permissions');
    expect(out).toContain('--session-id fixed');
  });
});

describe('Phase 7.7 claude-launch.sh 自动 worktree — --dry-run 契约', () => {
  let repoDir: string;

  beforeAll(() => {
    repoDir = mkdtempSync(join(tmpdir(), 'claude-launch-mainrepo-'));
    execSync('git init -q', { cwd: repoDir });
    execSync('git config user.email test@test.com', { cwd: repoDir });
    execSync('git config user.name Test', { cwd: repoDir });
    writeFileSync(join(repoDir, 'README.md'), 'x');
    execSync('git add . && git commit -q -m init', { cwd: repoDir });
  });

  afterAll(() => {
    rmSync(repoDir, { recursive: true, force: true });
  });

  it('主仓根 + 交互模式 → dry-run 输出含 worktree 建立步骤', () => {
    const env: Record<string, string> = { ...process.env, CLAUDE_SESSION_ID: 'abc12345-0000-0000-0000-000000000000' };
    delete env.CLAUDE_CODE_EXECPATH;
    delete env.CECELIA_NO_AUTO_WORKTREE;
    const out = execSync(`bash "${LAUNCHER}" --dry-run`, { cwd: repoDir, env }).toString();
    expect(out).toContain('worktree add');
  });

  it('headless（-p）→ dry-run 输出不含 worktree 建立步骤', () => {
    const env: Record<string, string> = { ...process.env, CLAUDE_SESSION_ID: 'abc12345-0000-0000-0000-000000000000' };
    delete env.CLAUDE_CODE_EXECPATH;
    delete env.CECELIA_NO_AUTO_WORKTREE;
    const out = execSync(`bash "${LAUNCHER}" --dry-run -p "hi"`, { cwd: repoDir, env }).toString();
    expect(out).not.toContain('worktree add');
  });

  it('CECELIA_NO_AUTO_WORKTREE=1 → dry-run 输出不含 worktree 建立步骤', () => {
    const env: Record<string, string> = {
      ...process.env,
      CLAUDE_SESSION_ID: 'abc12345-0000-0000-0000-000000000000',
      CECELIA_NO_AUTO_WORKTREE: '1',
    };
    delete env.CLAUDE_CODE_EXECPATH;
    const out = execSync(`bash "${LAUNCHER}" --dry-run`, { cwd: repoDir, env }).toString();
    expect(out).not.toContain('worktree add');
  });

  it('cwd 已在 worktree 内 → dry-run 输出不含 worktree 建立步骤', () => {
    const wtDir = join(repoDir, '..', 'precreated-wt');
    execSync(`git worktree add -q -b precreated "${wtDir}"`, { cwd: repoDir });
    const env: Record<string, string> = { ...process.env, CLAUDE_SESSION_ID: 'abc12345-0000-0000-0000-000000000000' };
    delete env.CLAUDE_CODE_EXECPATH;
    delete env.CECELIA_NO_AUTO_WORKTREE;
    const out = execSync(`bash "${LAUNCHER}" --dry-run`, { cwd: wtDir, env }).toString();
    expect(out).not.toContain('worktree add');
    execSync(`git worktree remove "${wtDir}" --force`, { cwd: repoDir });
  });
});

describe('Phase 7.7 claude-launch.sh 自动 worktree — 真实建立与清理', () => {
  let base: string;
  let bareDir: string;
  let mainRepo: string;
  let mockDir: string;
  let worktreeBase: string;

  beforeAll(() => {
    base = mkdtempSync(join(tmpdir(), 'claude-launch-real-'));
    bareDir = join(base, 'origin.git');
    execSync(`git init -q --bare "${bareDir}"`);
    mainRepo = join(base, 'main');
    execSync(`git clone -q "${bareDir}" "${mainRepo}"`);
    execSync('git config user.email test@test.com', { cwd: mainRepo });
    execSync('git config user.name Test', { cwd: mainRepo });
    writeFileSync(join(mainRepo, 'README.md'), 'x');
    execSync('git add . && git commit -q -m init', { cwd: mainRepo });
    execSync('git branch -M main', { cwd: mainRepo });
    execSync('git push -q -u origin main', { cwd: mainRepo });

    worktreeBase = join(base, 'worktrees-base');
    mockDir = mkdtempSync(join(tmpdir(), 'claude-launch-mockbin-'));
  });

  afterAll(() => {
    rmSync(base, { recursive: true, force: true });
    rmSync(mockDir, { recursive: true, force: true });
  });

  function writeMockClaude(script: string): void {
    const mockClaude = join(mockDir, 'claude');
    writeFileSync(mockClaude, script);
    chmodSync(mockClaude, 0o755);
  }

  it('主仓根 + 交互模式 → 建立 session worktree 并 cd 进去执行 claude；干净退出后自动清理', () => {
    writeMockClaude(`#!/usr/bin/env bash\npwd\nexit 0\n`);
    const sid = 'deadbeef-1111-2222-3333-444444444444';
    const env: Record<string, string> = {
      ...process.env,
      PATH: `${mockDir}:${process.env.PATH}`,
      CLAUDE_SESSION_ID: sid,
      WORKTREE_BASE: worktreeBase,
    };
    delete env.CLAUDE_CODE_EXECPATH;
    delete env.CECELIA_NO_AUTO_WORKTREE;
    const out = execSync(`bash "${LAUNCHER}"`, { cwd: mainRepo, env }).toString();
    const expectedWt = join(worktreeBase, 'main', `session-${sid.slice(0, 8)}`);
    expect(out.trim()).toBe(expectedWt);
    expect(existsSync(expectedWt)).toBe(false);
  });

  it('worktree 内有未提交改动 → 退出后保留 worktree', () => {
    writeMockClaude(`#!/usr/bin/env bash\necho dirty > uncommitted.txt\nexit 0\n`);
    const sid = 'cafebabe-1111-2222-3333-444444444444';
    const env: Record<string, string> = {
      ...process.env,
      PATH: `${mockDir}:${process.env.PATH}`,
      CLAUDE_SESSION_ID: sid,
      WORKTREE_BASE: worktreeBase,
    };
    delete env.CLAUDE_CODE_EXECPATH;
    delete env.CECELIA_NO_AUTO_WORKTREE;
    execSync(`bash "${LAUNCHER}"`, { cwd: mainRepo, env });
    const expectedWt = join(worktreeBase, 'main', `session-${sid.slice(0, 8)}`);
    expect(existsSync(join(expectedWt, 'uncommitted.txt'))).toBe(true);
  });

  it('同一 session_id 再次启动 → 幂等复用已存在的 worktree（不报错、不重建）', () => {
    writeMockClaude(`#!/usr/bin/env bash\npwd\nexit 0\n`);
    const sid = 'cafebabe-1111-2222-3333-444444444444';
    const env: Record<string, string> = {
      ...process.env,
      PATH: `${mockDir}:${process.env.PATH}`,
      CLAUDE_SESSION_ID: sid,
      WORKTREE_BASE: worktreeBase,
    };
    delete env.CLAUDE_CODE_EXECPATH;
    delete env.CECELIA_NO_AUTO_WORKTREE;
    // 上一个测试已给这个 sid 留了脏 worktree（含 uncommitted.txt），这里复用它
    const out = execSync(`bash "${LAUNCHER}"`, { cwd: mainRepo, env }).toString();
    const expectedWt = join(worktreeBase, 'main', `session-${sid.slice(0, 8)}`);
    expect(out.trim()).toBe(expectedWt);
    expect(existsSync(join(expectedWt, 'uncommitted.txt'))).toBe(true);
  });

  it('孤儿 worktree（目录残留但注册已被摘除）→ 自愈重建，旧内容备份不丢失', () => {
    // 注意：不能用纯 `pwd; exit 0`——干净退出会被脚本自身的"干净退出清理"逻辑
    // 在第一次 execSync 返回前就把 worktree 删掉（脚本第 181-199 行既有行为），
    // 导致孤儿场景根本无法搭建出来。留一个未提交文件让 worktree 保持"脏"，
    // 复用本文件里"worktree 内有未提交改动"用例的同一手法。
    writeMockClaude(`#!/usr/bin/env bash\necho dirty > seed-dirty.txt\npwd\nexit 0\n`);
    const sid = 'orphan001-1111-2222-3333-444444444444';
    const env: Record<string, string> = {
      ...process.env,
      PATH: `${mockDir}:${process.env.PATH}`,
      CLAUDE_SESSION_ID: sid,
      WORKTREE_BASE: worktreeBase,
    };
    delete env.CLAUDE_CODE_EXECPATH;
    delete env.CECELIA_NO_AUTO_WORKTREE;

    // 第一次启动：正常建立 worktree
    execSync(`bash "${LAUNCHER}"`, { cwd: mainRepo, env });
    const expectedWt = join(worktreeBase, 'main', `session-${sid.slice(0, 8)}`);
    expect(existsSync(expectedWt)).toBe(true);
    writeFileSync(join(expectedWt, 'precious.txt'), 'do-not-lose-me');

    // 模拟孤儿：手动摘除主仓侧的 worktree 元数据登记，但保留目录内容
    // （git worktree remove 会连目录一起删；这里只删 .git/worktrees/<branch>
    //  这一份元数据，模拟"注册被摘除、目录残留"这个真实故障模式）
    const branchName = `session-${sid.slice(0, 8)}`;
    const wtMetaDir = join(mainRepo, '.git', 'worktrees', branchName);
    expect(existsSync(wtMetaDir)).toBe(true);
    rmSync(wtMetaDir, { recursive: true, force: true });

    // 此时旧目录仍在但已不被主仓承认
    const wtListBefore = execSync('git worktree list --porcelain', { cwd: mainRepo }).toString();
    expect(wtListBefore).not.toContain(expectedWt);

    // 第二次启动同一 session_id：应检测孤儿并自愈重建
    const out = execSync(`bash "${LAUNCHER}"`, { cwd: mainRepo, env }).toString();
    expect(out.trim()).toBe(expectedWt);

    // 重建后的目录必须是主仓登记的合法 worktree
    const wtListAfter = execSync('git worktree list --porcelain', { cwd: mainRepo }).toString();
    const expectedWtPhys = realpathSync(expectedWt);
    expect(wtListAfter).toContain(`worktree ${expectedWtPhys}`);

    // 旧内容必须被搬进备份路径，没有丢失
    const backupDirs = require('node:fs').readdirSync(join(worktreeBase, 'main'))
      .filter((n: string) => n.startsWith(`${branchName}.orphan-`));
    expect(backupDirs.length).toBe(1);
    const backupPath = join(worktreeBase, 'main', backupDirs[0]);
    expect(existsSync(join(backupPath, 'precious.txt'))).toBe(true);
  });
});


describe('单账号 — 无账号切换、无 resume 软链', () => {
  let base: string;
  let mainRepo: string;
  let mockDir: string;
  let worktreeBase: string;
  let homeDir: string;
  let cfgDir: string;
  let staleAcctDir: string;

  beforeAll(() => {
    base = mkdtempSync(join(tmpdir(), 'claude-launch-single-'));
    const bareDir = join(base, 'origin.git');
    execSync(`git init -q --bare "${bareDir}"`);
    mainRepo = join(base, 'main');
    execSync(`git clone -q "${bareDir}" "${mainRepo}"`);
    execSync('git config user.email test@test.com', { cwd: mainRepo });
    execSync('git config user.name Test', { cwd: mainRepo });
    writeFileSync(join(mainRepo, 'README.md'), 'x');
    execSync('git add . && git commit -q -m init', { cwd: mainRepo });
    execSync('git branch -M main', { cwd: mainRepo });
    execSync('git push -q -u origin main', { cwd: mainRepo });
    worktreeBase = join(base, 'worktrees-base');
    mkdirSync(worktreeBase, { recursive: true });

    // 旧版账号切换遗留的 .active-account-dir 即使还在，也不得再影响 CLAUDE_CONFIG_DIR
    homeDir = join(base, 'home');
    staleAcctDir = join(homeDir, '.claude-account2');
    mkdirSync(staleAcctDir, { recursive: true });
    mkdirSync(join(homeDir, '.claude'), { recursive: true });
    writeFileSync(join(homeDir, '.claude', '.active-account-dir'), staleAcctDir);
    cfgDir = join(base, 'cfg');

    mockDir = mkdtempSync(join(tmpdir(), 'claude-launch-single-mock-'));
    const mockClaude = join(mockDir, 'claude');
    writeFileSync(mockClaude, `#!/usr/bin/env bash\necho "CLAUDE_CONFIG_DIR=\${CLAUDE_CONFIG_DIR:-}"\n`);
    chmodSync(mockClaude, 0o755);
  });

  afterAll(() => {
    rmSync(base, { recursive: true, force: true });
    rmSync(mockDir, { recursive: true, force: true });
  });

  function makeEnv(sid: string): Record<string, string> {
    const env: Record<string, string> = {
      ...process.env,
      PATH: `${mockDir}:${process.env.PATH}`,
      HOME: homeDir,
      CLAUDE_SESSION_ID: sid,
      WORKTREE_BASE: worktreeBase,
    };
    delete env.CLAUDE_CODE_EXECPATH;
    delete env.CECELIA_NO_AUTO_WORKTREE;
    delete env.CLAUDE_CONFIG_DIR;
    return env;
  }

  // 旧实现可能把软链建到任一候选根（显式 CLAUDE_CONFIG_DIR / 遗留切换文件指向 / 默认 ~/.claude），全部都要查
  function allProjectEntries(): string[] {
    return [join(cfgDir, 'projects'), join(staleAcctDir, 'projects'), join(homeDir, '.claude', 'projects')]
      .flatMap((root) => (existsSync(root) ? readdirSync(root) : []));
  }

  it('交互模式：遗留 .active-account-dir 不再覆盖 CLAUDE_CONFIG_DIR（未设则保持未设）', () => {
    const env = { ...makeEnv('aaaa1001-1111-2222-3333-444444444444'), CECELIA_NO_AUTO_WORKTREE: '1' };
    const out = execSync(`bash "${LAUNCHER}"`, { cwd: mainRepo, env }).toString();
    expect(out).toContain('CLAUDE_CONFIG_DIR=\n');
    expect(out).not.toContain(staleAcctDir);
  });

  it('交互模式：显式传入的 CLAUDE_CONFIG_DIR 原样保留', () => {
    const env = { ...makeEnv('aaaa1002-1111-2222-3333-444444444444'), CECELIA_NO_AUTO_WORKTREE: '1', CLAUDE_CONFIG_DIR: cfgDir };
    const out = execSync(`bash "${LAUNCHER}"`, { cwd: mainRepo, env }).toString();
    expect(out).toContain(`CLAUDE_CONFIG_DIR=${cfgDir}`);
  });

  it('--dry-run（auto-worktree 分支）→ 不再输出 ln -s 软链契约行', () => {
    const env = makeEnv('aaaa1003-1111-2222-3333-444444444444');
    const out = execSync(`bash "${LAUNCHER}" --dry-run`, { cwd: mainRepo, env }).toString();
    expect(out).toContain('worktree add');
    expect(out).not.toContain('ln -s');
  });

  it('--dry-run（cwd 在外部建的 linked worktree 内）→ 不输出 ln -s', () => {
    const extWt = join(base, 'ext-wt-dry');
    execSync(`git -C "${mainRepo}" worktree add -q "${extWt}" -b ext-dry origin/main`);
    const env = makeEnv('aaaa1004-1111-2222-3333-444444444444');
    const out = execSync(`bash "${LAUNCHER}" --dry-run`, { cwd: extWt, env }).toString();
    expect(out).not.toContain('ln -s');
  });

  it('真实执行（auto-worktree）→ projects 目录下不建任何软链', () => {
    const env = { ...makeEnv('aaaa1005-1111-2222-3333-444444444444'), CLAUDE_CONFIG_DIR: cfgDir };
    execSync(`bash "${LAUNCHER}"`, { cwd: mainRepo, env });
    expect(allProjectEntries()).toEqual([]);
  });

  it('真实执行（cwd 在外部建的 linked worktree 内）→ projects 目录下不建任何软链', () => {
    const extWt = join(base, 'ext-wt-real');
    execSync(`git -C "${mainRepo}" worktree add -q "${extWt}" -b ext-real origin/main`);
    const env = { ...makeEnv('aaaa1006-1111-2222-3333-444444444444'), CLAUDE_CONFIG_DIR: cfgDir };
    execSync(`bash "${LAUNCHER}"`, { cwd: extWt, env });
    expect(allProjectEntries()).toEqual([]);
  });

  it('非 git 目录启动 → 无软链警告，claude 正常执行', () => {
    const plain = join(base, 'plain-dir');
    mkdirSync(plain, { recursive: true });
    const env = makeEnv('aaaa1007-1111-2222-3333-444444444444');
    const out = execSync(`bash "${LAUNCHER}" 2>&1`, { cwd: plain, env }).toString();
    expect(out).not.toContain('软链');
    expect(out).toContain('CLAUDE_CONFIG_DIR=');
  });
});
