import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, chmodSync, rmSync, existsSync, statSync, mkdirSync, lstatSync, realpathSync, symlinkSync } from 'node:fs';
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
  let projectsRoot: string;

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
    projectsRoot = join(base, 'projects-root');
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
      CLAUDE_PROJECTS_ROOT: projectsRoot,
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
      CLAUDE_PROJECTS_ROOT: projectsRoot,
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
      CLAUDE_PROJECTS_ROOT: projectsRoot,
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
      CLAUDE_PROJECTS_ROOT: projectsRoot,
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

describe('账号切换（cs/cn）— guard 应区分 headless 与嵌套继承', () => {
  let mockDir: string;
  let homeDir: string;
  let acctDirCs: string;

  beforeAll(() => {
    mockDir = mkdtempSync(join(tmpdir(), 'claude-launch-acct-mock-'));
    const mockClaude = join(mockDir, 'claude');
    writeFileSync(mockClaude, `#!/usr/bin/env bash\necho "CLAUDE_CONFIG_DIR=$CLAUDE_CONFIG_DIR"\n`);
    chmodSync(mockClaude, 0o755);

    homeDir = mkdtempSync(join(tmpdir(), 'claude-launch-acct-home-'));
    mkdirSync(join(homeDir, '.claude'), { recursive: true });
    acctDirCs = join(homeDir, '.claude-account2');
    mkdirSync(acctDirCs, { recursive: true });
    writeFileSync(join(homeDir, '.claude', '.active-account-dir'), acctDirCs);
  });

  afterAll(() => {
    rmSync(mockDir, { recursive: true, force: true });
    rmSync(homeDir, { recursive: true, force: true });
  });

  it('交互模式 + CLAUDE_CONFIG_DIR 已从父进程继承（嵌套场景）→ 仍应读 switch 文件并覆盖', () => {
    const env: Record<string, string> = {
      ...process.env,
      PATH: `${mockDir}:${process.env.PATH}`,
      HOME: homeDir,
      CLAUDE_SESSION_ID: 'fixed-acct-test',
      CECELIA_NO_AUTO_WORKTREE: '1',
      // 模拟从正在运行的父 claude 进程继承来的 env（不是用户显式为本次调用设置的）
      CLAUDE_CONFIG_DIR: join(homeDir, '.claude-account1'),
    };
    delete env.CLAUDE_CODE_EXECPATH;
    const out = execSync(`bash "${LAUNCHER}"`, { env }).toString();
    expect(out).toContain(`CLAUDE_CONFIG_DIR=${acctDirCs}`);
  });

  it('headless（-p）+ CLAUDE_CONFIG_DIR 显式设置 → 不被 switch 文件覆盖', () => {
    const env: Record<string, string> = {
      ...process.env,
      PATH: `${mockDir}:${process.env.PATH}`,
      HOME: homeDir,
      CLAUDE_SESSION_ID: 'fixed-acct-test-headless',
      CECELIA_NO_AUTO_WORKTREE: '1',
      CLAUDE_CONFIG_DIR: join(homeDir, '.claude-account1'),
    };
    delete env.CLAUDE_CODE_EXECPATH;
    const out = execSync(`bash "${LAUNCHER}" -p "hi"`, { env }).toString();
    expect(out).toContain(`CLAUDE_CONFIG_DIR=${join(homeDir, '.claude-account1')}`);
  });
});

describe('resume 历史软链 — per-session projects key 软链回主仓', () => {
  let base: string;
  let bareDir: string;
  let mainRepo: string;
  let mainRepoPhys: string;
  let mockDir: string;
  let worktreeBase: string;
  let worktreeBasePhys: string;
  let projectsRoot: string;

  // 与 Claude Code 实测规则一致：非字母数字字符逐字符换 -，大小写与数字原样保留。
  const toKey = (p: string): string => p.replace(/[^a-zA-Z0-9]/g, '-');

  beforeAll(() => {
    base = mkdtempSync(join(tmpdir(), 'claude-launch-symlink-'));
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
    projectsRoot = join(base, 'projects-root');
    // 合同修正：真实 Claude Code 的 projects key 按物理路径派生（Node process.cwd() 返回
    // 物理路径，~/.claude/projects/ 里实存 -private-tmp-* 条目为证）。macOS 下 mkdtemp
    // 落在 /var→/private/var 软链下，期望 key 一律用 realpath 后的物理路径计算。
    mkdirSync(worktreeBase, { recursive: true });
    worktreeBasePhys = realpathSync(worktreeBase);
    mainRepoPhys = realpathSync(mainRepo);
    mockDir = mkdtempSync(join(tmpdir(), 'claude-launch-symlink-mock-'));
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

  function makeEnv(sid: string): Record<string, string> {
    const env: Record<string, string> = {
      ...process.env,
      PATH: `${mockDir}:${process.env.PATH}`,
      CLAUDE_SESSION_ID: sid,
      WORKTREE_BASE: worktreeBase,
      CLAUDE_PROJECTS_ROOT: projectsRoot,
    };
    delete env.CLAUDE_CODE_EXECPATH;
    delete env.CECELIA_NO_AUTO_WORKTREE;
    return env;
  }

  it('key 算法：非字母数字字符（_ / 空格 / .）逐字符换 -，大小写保留', () => {
    const sid = 'aaaa0007-1111-2222-3333-444444444444';
    const oddBase = join(base, 'odd_Base Dir');
    mkdirSync(oddBase, { recursive: true });
    const env = { ...makeEnv(sid), WORKTREE_BASE: oddBase };
    const out = execSync(`bash "${LAUNCHER}" --dry-run`, { cwd: mainRepo, env }).toString();
    // dry-run 时 worktree 尚未建，脚本对 wt key 的 realpath 会 cd 失败并回退成未物理化的
    // 原字符串（脚本内已注明「dry-run 是意图契约，可接受」）。故这里只断言 key 算法负责的
    // 尾段，与 realpath 归一化解耦——本用例守的是"非字母数字逐字符换 -"，不是物理路径派生。
    const tailKey = toKey(join('odd_Base Dir', 'main', `session-${sid.slice(0, 8)}`));
    expect(out).toContain(tailKey);
    expect(tailKey).not.toContain('_');
    expect(tailKey).not.toContain(' ');
    expect(tailKey).toContain('Base');   // 大写保留
  });

  it('auto-worktree 启动 → claude 运行期内 <wt_key> 是指向 <main_key> 的软链', () => {
    const sid = 'aaaa0001-1111-2222-3333-444444444444';
    const wtPathPhys = join(worktreeBasePhys, 'main', `session-${sid.slice(0, 8)}`);
    const link = join(projectsRoot, toKey(wtPathPhys));
    writeMockClaude(`#!/usr/bin/env bash
if [[ -L "${link}" ]]; then echo "LINK_TARGET=$(readlink "${link}")"; else echo "LINK_TARGET=MISSING"; fi
exit 0
`);
    const out = execSync(`bash "${LAUNCHER}"`, { cwd: mainRepo, env: makeEnv(sid) }).toString();
    expect(out).toContain(`LINK_TARGET=${join(projectsRoot, toKey(mainRepoPhys))}`);
  });

  it('孤儿真实目录 → 内容迁入主仓文件夹并原位替换为软链', () => {
    const sid = 'aaaa0002-1111-2222-3333-444444444444';
    const wtPathPhys = join(worktreeBasePhys, 'main', `session-${sid.slice(0, 8)}`);
    const orphanDir = join(projectsRoot, toKey(wtPathPhys));
    mkdirSync(orphanDir, { recursive: true });
    writeFileSync(join(orphanDir, 'old-session.jsonl'), '{"role":"user"}\n');
    writeMockClaude(`#!/usr/bin/env bash
if [[ -L "${orphanDir}" ]]; then echo "IS_LINK=yes"; else echo "IS_LINK=no"; fi
exit 0
`);
    const out = execSync(`bash "${LAUNCHER}"`, { cwd: mainRepo, env: makeEnv(sid) }).toString();
    expect(out).toContain('IS_LINK=yes');
    expect(existsSync(join(projectsRoot, toKey(mainRepoPhys), 'old-session.jsonl'))).toBe(true);
  });

  it('干净退出 → 软链被删除，经软链写入主仓文件夹的 transcript 完好', () => {
    const sid = 'aaaa0003-1111-2222-3333-444444444444';
    const wtPathPhys = join(worktreeBasePhys, 'main', `session-${sid.slice(0, 8)}`);
    const link = join(projectsRoot, toKey(wtPathPhys));
    writeMockClaude(`#!/usr/bin/env bash
echo '{"x":1}' > "${link}/${sid}.jsonl"
exit 0
`);
    execSync(`bash "${LAUNCHER}"`, { cwd: mainRepo, env: makeEnv(sid) });
    expect(existsSync(link)).toBe(false);
    expect(lstatSync(link, { throwIfNoEntry: false })).toBeUndefined();
    expect(existsSync(join(projectsRoot, toKey(mainRepoPhys), `${sid}.jsonl`))).toBe(true);
  });

  it('脏 worktree 保留 → 软链同步保留', () => {
    const sid = 'aaaa0004-1111-2222-3333-444444444444';
    const wtPathPhys = join(worktreeBasePhys, 'main', `session-${sid.slice(0, 8)}`);
    const link = join(projectsRoot, toKey(wtPathPhys));
    writeMockClaude(`#!/usr/bin/env bash
echo dirty > uncommitted.txt
exit 0
`);
    execSync(`bash "${LAUNCHER}"`, { cwd: mainRepo, env: makeEnv(sid) });
    expect(existsSync(join(wtPathPhys, 'uncommitted.txt'))).toBe(true);
    expect(lstatSync(link).isSymbolicLink()).toBe(true);
  });

  it('--dry-run（auto-worktree 分支）→ 输出含 ln -s 契约行', () => {
    const sid = 'aaaa0005-1111-2222-3333-444444444444';
    const env = makeEnv(sid);
    const out = execSync(`bash "${LAUNCHER}" --dry-run`, { cwd: mainRepo, env }).toString();
    expect(out).toContain('ln -s');
    expect(out).toContain(toKey(mainRepoPhys));
  });

  it('best-effort 铁律：projects root 只读 → 软链失败不阻断启动，退出码透传，stderr 警告', () => {
    const sid = 'aaaa0006-1111-2222-3333-444444444444';
    const roRoot = join(base, 'readonly-projects-root');
    mkdirSync(roRoot, { recursive: true });
    chmodSync(roRoot, 0o555);
    writeMockClaude(`#!/usr/bin/env bash
echo "MOCK_RAN=yes"
exit 7
`);
    const env = { ...makeEnv(sid), CLAUDE_PROJECTS_ROOT: roRoot };
    let status = -1;
    let stdout = '';
    let stderr = '';
    try {
      execSync(`bash "${LAUNCHER}"`, { cwd: mainRepo, env });
    } catch (e) {
      const err = e as { status: number; stdout: Buffer; stderr: Buffer };
      status = err.status;
      stdout = err.stdout.toString();
      stderr = err.stderr.toString();
    }
    chmodSync(roRoot, 0o755);
    expect(stdout).toContain('MOCK_RAN=yes');
    expect(status).toBe(7);
    expect(stderr).toContain('软链失败');
  });

  it('已存在指向正确目标的软链 → 幂等 no-op，运行期内仍是正确软链', () => {
    const sid = 'aaaa0007-1111-2222-3333-444444444444';
    const wtPathPhys = join(worktreeBasePhys, 'main', `session-${sid.slice(0, 8)}`);
    const link = join(projectsRoot, toKey(wtPathPhys));
    const target = join(projectsRoot, toKey(mainRepoPhys));
    mkdirSync(target, { recursive: true });
    symlinkSync(target, link);
    writeMockClaude(`#!/usr/bin/env bash
if [[ -L "${link}" ]]; then echo "LINK_TARGET=$(readlink "${link}")"; else echo "LINK_TARGET=MISSING"; fi
exit 0
`);
    const out = execSync(`bash "${LAUNCHER}"`, { cwd: mainRepo, env: makeEnv(sid) }).toString();
    expect(out).toContain(`LINK_TARGET=${target}`);
  });

  it('已存在指向错误目标的软链 → 启动后被替换为指向主仓 key', () => {
    const sid = 'aaaa0008-1111-2222-3333-444444444444';
    const wtPathPhys = join(worktreeBasePhys, 'main', `session-${sid.slice(0, 8)}`);
    const link = join(projectsRoot, toKey(wtPathPhys));
    const target = join(projectsRoot, toKey(mainRepoPhys));
    const wrongTarget = join(projectsRoot, 'wrong-target');
    mkdirSync(wrongTarget, { recursive: true });
    symlinkSync(wrongTarget, link);
    writeMockClaude(`#!/usr/bin/env bash
if [[ -L "${link}" ]]; then echo "LINK_TARGET=$(readlink "${link}")"; else echo "LINK_TARGET=MISSING"; fi
exit 0
`);
    const out = execSync(`bash "${LAUNCHER}"`, { cwd: mainRepo, env: makeEnv(sid) }).toString();
    expect(out).toContain(`LINK_TARGET=${target}`);
  });
});
