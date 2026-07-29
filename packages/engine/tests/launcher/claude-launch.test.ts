import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, chmodSync, rmSync, existsSync, statSync, mkdirSync, lstatSync, realpathSync, symlinkSync, readlinkSync } from 'node:fs';
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
    // dry-run 时 worktree 尚未建，脚本对 wt key 的 realpath 会 cd 失败并回退成 _WT_PATH
    // 字面量（脚本内已注明「dry-run 是意图契约，可接受」）。而 _WT_PATH 正由上面传入的
    // WORKTREE_BASE 原字符串拼成——两边同源，故不碰 realpath 也能锁完整 key。
    expect(out).toContain(toKey(join(oddBase, 'main', `session-${sid.slice(0, 8)}`)));
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

  it('干净退出 → 软链保留（共享资源，不随单个会话销毁），transcript 完好', () => {
    const sid = 'aaaa0003-1111-2222-3333-444444444444';
    const wtPathPhys = join(worktreeBasePhys, 'main', `session-${sid.slice(0, 8)}`);
    const link = join(projectsRoot, toKey(wtPathPhys));
    writeMockClaude(`#!/usr/bin/env bash
echo '{"x":1}' > "${link}/${sid}.jsonl"
exit 0
`);
    execSync(`bash "${LAUNCHER}"`, { cwd: mainRepo, env: makeEnv(sid) });
    // 软链是 per-worktree-path 共享资源：同一 key 可压多条会话，
    // 删它会让仍在用该 key 的会话重建真目录 = 新孤儿。8 字节，留着零成本。
    expect(lstatSync(link).isSymbolicLink()).toBe(true);
    expect(existsSync(join(projectsRoot, toKey(mainRepoPhys), `${sid}.jsonl`))).toBe(true);
  });

  it('同一 worktree key 多会话共用 → 前一个会话干净退出后，软链对后一个仍有效', () => {
    const sidA = 'aaaa0011-1111-2222-3333-444444444444';
    const wtPathPhys = join(worktreeBasePhys, 'main', `session-${sidA.slice(0, 8)}`);
    const link = join(projectsRoot, toKey(wtPathPhys));
    // 会话 A：干净退出（触发清理段）
    writeMockClaude('#!/usr/bin/env bash\nexit 0\n');
    execSync(`bash "${LAUNCHER}"`, { cwd: mainRepo, env: makeEnv(sidA) });
    // 会话 B：复用同一 key 写入 → 必须仍落进主仓池，而不是重建真目录
    expect(lstatSync(link).isSymbolicLink()).toBe(true);
    writeFileSync(join(link, 'second-session.jsonl'), '{"y":2}\n');
    expect(existsSync(join(projectsRoot, toKey(mainRepoPhys), 'second-session.jsonl'))).toBe(true);
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

  it('cwd 已在外部建的 worktree 内 → dry-run 仍输出 ln -s 契约行（dry-run 契约）', () => {
    const sid = 'aaaa0009-1111-2222-3333-444444444444';
    // 模拟 slot 场景：worktree 由外部（非 launcher）建好，claude 从其内部启动
    const extWt = join(base, 'external-wt');
    execSync(`git -C "${mainRepo}" worktree add -q "${extWt}" -b ext-branch`, { stdio: 'ignore' });
    const extWtPhys = realpathSync(extWt);
    const out = execSync(`bash "${LAUNCHER}" --dry-run`, { cwd: extWt, env: makeEnv(sid) }).toString();
    expect(out).toContain('ln -s');
    expect(out).toContain(toKey(extWtPhys));           // link = 该 worktree 的 key
    expect(out).toContain(toKey(mainRepoPhys));        // target = 主仓 key
    expect(out).not.toContain('worktree add');         // 已在 worktree 内，不得再建
  });

  it('headless（-p）在 worktree 内 → dry-run 不输出 ln -s（dry-run 契约）', () => {
    const sid = 'aaaa0010-1111-2222-3333-444444444444';
    const extWt2 = join(base, 'external-wt2');
    execSync(`git -C "${mainRepo}" worktree add -q "${extWt2}" -b ext-branch2`, { stdio: 'ignore' });
    const out = execSync(`bash "${LAUNCHER}" -p hi --dry-run`, { cwd: extWt2, env: makeEnv(sid) }).toString();
    expect(out).not.toContain('ln -s');
  });

  // ⚠️ 上面两条只守 dry-run 段（launcher 在那儿就 exit 0），钉的是 echo 出来的意图
  // 字符串，**到不了真实建链门禁**——真实门禁改坏它们照样绿（审查两次实证）。
  // dry-run 的 elif 分支本身是真实代码、有独立回归价值，故保留，但标题已改成
  // 「dry-run 契约」，别再被"根因回归"骗成"根因已被守住"。
  //
  // 下面几条走**真实执行路径**，才是真守卫。每条都经变异验证 proven-to-fire：
  //   删 `! _is_headless`            → headless 真实用例红
  //   删 `_in_git_repo`              → 非 git 目录用例红
  //   整个门禁改回 AUTO_WORKTREE=1   → 本条 + 既有 6 条红
  //   删 _link_projects_dir 自指短路 → lossy key 碰撞用例红
  // 加新用例时请照此自查：它到底走哪条路径？把它声称守的条件删掉，会不会红？
  it('真实执行：cwd 在外部建的 worktree 内 → claude 运行期内 <wt_key> 是指向 <main_key> 的软链（根因回归·真实路径）', () => {
    const sid = 'aaaa0016-1111-2222-3333-444444444444';
    const extWt = join(base, 'external-wt-real');
    execSync(`git -C "${mainRepo}" worktree add -q "${extWt}" -b ext-branch-real`, { stdio: 'ignore' });
    const extWtPhys = realpathSync(extWt);
    const link = join(projectsRoot, toKey(extWtPhys));
    writeMockClaude(`#!/usr/bin/env bash
if [[ -L "${link}" ]]; then echo "LINK_TARGET=$(readlink "${link}")"; else echo "LINK_TARGET=MISSING"; fi
exit 0
`);
    const out = execSync(`bash "${LAUNCHER}"`, { cwd: extWt, env: makeEnv(sid) }).toString();
    expect(out).toContain(`LINK_TARGET=${join(projectsRoot, toKey(mainRepoPhys))}`);
  });

  it('真实执行：headless（-p）在 worktree 内 → 运行期内无软链（机器人会话不灌主池）', () => {
    const sid = 'aaaa0018-1111-2222-3333-444444444444';
    const extWt = join(base, 'external-wt-headless');
    execSync(`git -C "${mainRepo}" worktree add -q "${extWt}" -b ext-branch-headless`, { stdio: 'ignore' });
    const extWtPhys = realpathSync(extWt);
    const link = join(projectsRoot, toKey(extWtPhys));
    writeMockClaude(`#!/usr/bin/env bash
if [[ -L "${link}" ]]; then echo "LINK_TARGET=$(readlink "${link}")"; else echo "LINK_TARGET=MISSING"; fi
exit 0
`);
    const out = execSync(`bash "${LAUNCHER}" -p hi`, { cwd: extWt, env: makeEnv(sid) }).toString();
    expect(out).toContain('LINK_TARGET=MISSING');
  });

  // project key 是**有损多对一映射**（/ . _ 等非字母数字全塌成 -），所以两条不同路径
  // 可以撞出同一个 key：主仓 <base>/coll-a-b 与 worktree <base>/coll-a/b 都塌成 …-coll-a-b。
  // 此时 link == target，_link_projects_dir 的自指短路是承重的：没有它，
  // mkdir -p "$target" 会让 [[ -d "$link" ]] 成真 → 走"孤儿目录"分支 → rmdir 掉池子
  // → ln -s 造出一条**指向自己**的软链，且全程 best-effort 不报错（静默损坏）。
  it('lossy key 碰撞（wt key == 主仓 key）→ 不得造出自指软链（静默损坏 /resume 池子）', () => {
    const sid = 'aaaa0019-1111-2222-3333-444444444444';
    const collMain = join(base, 'coll-a-b');
    // 从 mainRepo（有有效 HEAD）clone，而非 bareDir（HEAD 指向 master 但无提交）
    execSync(`git clone -q "${mainRepo}" "${collMain}"`);
    execSync('git config user.email test@test.com', { cwd: collMain });
    execSync('git config user.name Test', { cwd: collMain });
    const collWt = join(base, 'coll-a', 'b');
    mkdirSync(join(base, 'coll-a'), { recursive: true });
    execSync(`git -C "${collMain}" worktree add -q "${collWt}" -b coll-branch`);
    // 前置自证：两者 key 必须真撞上，否则本用例什么也没测
    const collMainPhys = realpathSync(collMain);
    const collWtPhys = realpathSync(collWt);
    expect(toKey(collWtPhys)).toBe(toKey(collMainPhys));

    const link = join(projectsRoot, toKey(collWtPhys));
    writeMockClaude(`#!/usr/bin/env bash\necho "MOCK_RAN=yes"\nexit 0\n`);
    const out = execSync(`bash "${LAUNCHER}"`, { cwd: collWt, env: makeEnv(sid) }).toString();
    expect(out).toContain('MOCK_RAN=yes');

    const st = lstatSync(link, { throwIfNoEntry: false });
    const isSelfLink = st?.isSymbolicLink() === true && readlinkSync(link) === link;
    expect(isSelfLink).toBe(false);
  });

  it('非 git 目录启动 → 不打印软链警告（无历史可共享），claude 正常执行且退出码透传', () => {
    const sid = 'aaaa0017-1111-2222-3333-444444444444';
    const nonGitDir = mkdtempSync(join(tmpdir(), 'claude-launch-nongit-'));
    writeMockClaude(`#!/usr/bin/env bash\necho "MOCK_RAN=yes"\nexit 5\n`);
    let status = -1;
    let stdout = '';
    let stderr = '';
    try {
      execSync(`bash "${LAUNCHER}"`, { cwd: nonGitDir, env: makeEnv(sid) });
    } catch (e) {
      const err = e as { status: number; stdout: Buffer; stderr: Buffer };
      status = err.status;
      stdout = err.stdout.toString();
      stderr = err.stderr.toString();
    }
    rmSync(nonGitDir, { recursive: true, force: true });
    expect(stdout).toContain('MOCK_RAN=yes');
    expect(status).toBe(5);
    expect(stderr).not.toContain('软链失败');
  });

  it('生产路径：未设 CLAUDE_PROJECTS_ROOT 时 root 由 CLAUDE_CONFIG_DIR 派生', () => {
    const sid = 'aaaa0008-1111-2222-3333-444444444444';
    const fakeHome = mkdtempSync(join(tmpdir(), 'claude-launch-home-'));
    const acctDir = join(fakeHome, '.claude-acctX');
    mkdirSync(join(acctDir, 'projects'), { recursive: true });
    mkdirSync(join(fakeHome, '.claude'), { recursive: true });
    // 不写 .active-account-dir → 账号解析段不覆盖，显式 CLAUDE_CONFIG_DIR 生效
    const env = { ...makeEnv(sid), HOME: fakeHome, CLAUDE_CONFIG_DIR: acctDir };
    delete env.CLAUDE_PROJECTS_ROOT;   // 关键：拔掉测试旋钮，逼它走生产派生
    const out = execSync(`bash "${LAUNCHER}" --dry-run`, { cwd: mainRepo, env }).toString();
    expect(out).toContain(join(acctDir, 'projects'));
  });
});

describe('启动时 sweep — 孤儿 worktree project key 并回主仓池', () => {
  let base: string;
  let bareDir: string;
  let mainRepo: string;
  let mainRepoPhys: string;
  let mockDir: string;
  let worktreeBase: string;
  let worktreeBasePhys: string;
  let projectsRoot: string;

  const toKey = (p: string): string => p.replace(/[^a-zA-Z0-9]/g, '-');

  beforeAll(() => {
    base = mkdtempSync(join(tmpdir(), 'claude-launch-sweep-'));
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
    mkdirSync(worktreeBase, { recursive: true });
    worktreeBasePhys = realpathSync(worktreeBase);
    mainRepoPhys = realpathSync(mainRepo);
    mockDir = mkdtempSync(join(tmpdir(), 'claude-launch-sweep-mock-'));
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

  it('启动时 sweep：多个历史孤儿真实目录 → 内容并入主仓池、原位替换为软链', () => {
    // 模拟两个旧会话（launcher 早期版本无软链逻辑时直接建的真实目录）
    const orphanSids = ['bb000001', 'cc000002'];
    const mainTarget = join(projectsRoot, toKey(mainRepoPhys));
    mkdirSync(mainTarget, { recursive: true });

    const orphanDirs = orphanSids.map(shortId => {
      const wtPath = join(worktreeBasePhys, 'main', `session-${shortId}`);
      const key = join(projectsRoot, toKey(wtPath));
      mkdirSync(key, { recursive: true });
      writeFileSync(join(key, `${shortId}.jsonl`), `{"session":"${shortId}"}\n`);
      return { key, shortId };
    });

    // 新 session 启动 → sweep 应在启动时自动触发
    const newSid = 'dd000003-1111-2222-3333-444444444444';
    writeMockClaude(`#!/usr/bin/env bash\nexit 0\n`);
    execSync(`bash "${LAUNCHER}"`, { cwd: mainRepo, env: makeEnv(newSid) });

    for (const { key, shortId } of orphanDirs) {
      // 孤儿目录已变成软链
      expect(lstatSync(key).isSymbolicLink()).toBe(true);
      // 两边都 realpath：macOS 上 tmpdir 的 /var 是 /private/var 软链，
      // realpathSync(key)（物理）与逻辑路径拼出的 mainTarget 恒差 /private 前缀
      expect(realpathSync(key)).toBe(realpathSync(mainTarget));
      // 内容已迁入主仓池
      expect(existsSync(join(mainTarget, `${shortId}.jsonl`))).toBe(true);
    }
  });

  it('启动时 sweep：目标已有同名文件 → 跳过不覆盖（ignore-existing）', () => {
    const shortId = 'ee000004';
    const wtPath = join(worktreeBasePhys, 'main', `session-${shortId}`);
    const orphanKey = join(projectsRoot, toKey(wtPath));
    const mainTarget = join(projectsRoot, toKey(mainRepoPhys));
    mkdirSync(orphanKey, { recursive: true });
    mkdirSync(mainTarget, { recursive: true });
    // 孤儿里的会话文件
    writeFileSync(join(orphanKey, 'shared.jsonl'), 'orphan-content\n');
    // 主仓已存在同名文件（内容不同）
    writeFileSync(join(mainTarget, 'shared.jsonl'), 'main-content\n');

    const newSid = 'ff000005-1111-2222-3333-444444444444';
    writeMockClaude(`#!/usr/bin/env bash\nexit 0\n`);
    execSync(`bash "${LAUNCHER}"`, { cwd: mainRepo, env: makeEnv(newSid) });

    // 主仓文件未被孤儿内容覆盖
    const { readFileSync } = require('node:fs');
    expect(readFileSync(join(mainTarget, 'shared.jsonl'), 'utf8')).toBe('main-content\n');
    // 孤儿目录因有残留（shared.jsonl 冲突，未能 mv）仍是真实目录
    expect(lstatSync(orphanKey).isSymbolicLink()).toBe(false);
  });

  it('启动时 sweep：不影响主仓 key 本身（不自我删除）', () => {
    const mainTarget = join(projectsRoot, toKey(mainRepoPhys));
    mkdirSync(mainTarget, { recursive: true });
    writeFileSync(join(mainTarget, 'sentinel.jsonl'), 'keep-me\n');

    const newSid = '11000006-1111-2222-3333-444444444444';
    writeMockClaude(`#!/usr/bin/env bash\nexit 0\n`);
    execSync(`bash "${LAUNCHER}"`, { cwd: mainRepo, env: makeEnv(newSid) });

    // 主仓 key 仍是真实目录，内容完好
    expect(lstatSync(mainTarget).isSymbolicLink()).toBe(false);
    expect(existsSync(join(mainTarget, 'sentinel.jsonl'))).toBe(true);
  });
});
