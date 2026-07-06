import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, chmodSync, rmSync, existsSync, statSync, mkdirSync, lstatSync } from 'node:fs';
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
});

describe('resume 历史软链 — per-session projects key 软链回主仓', () => {
  let base: string;
  let bareDir: string;
  let mainRepo: string;
  let mockDir: string;
  let worktreeBase: string;
  let projectsRoot: string;

  const toKey = (p: string): string => p.replace(/[/.]/g, '-');

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

  it('auto-worktree 启动 → claude 运行期内 <wt_key> 是指向 <main_key> 的软链', () => {
    const sid = 'aaaa0001-1111-2222-3333-444444444444';
    const wtPath = join(worktreeBase, 'main', `session-${sid.slice(0, 8)}`);
    const link = join(projectsRoot, toKey(wtPath));
    writeMockClaude(`#!/usr/bin/env bash
if [[ -L "${link}" ]]; then echo "LINK_TARGET=$(readlink "${link}")"; else echo "LINK_TARGET=MISSING"; fi
exit 0
`);
    const out = execSync(`bash "${LAUNCHER}"`, { cwd: mainRepo, env: makeEnv(sid) }).toString();
    expect(out).toContain(`LINK_TARGET=${join(projectsRoot, toKey(mainRepo))}`);
  });

  it('孤儿真实目录 → 内容迁入主仓文件夹并原位替换为软链', () => {
    const sid = 'aaaa0002-1111-2222-3333-444444444444';
    const wtPath = join(worktreeBase, 'main', `session-${sid.slice(0, 8)}`);
    const orphanDir = join(projectsRoot, toKey(wtPath));
    mkdirSync(orphanDir, { recursive: true });
    writeFileSync(join(orphanDir, 'old-session.jsonl'), '{"role":"user"}\n');
    writeMockClaude(`#!/usr/bin/env bash
if [[ -L "${orphanDir}" ]]; then echo "IS_LINK=yes"; else echo "IS_LINK=no"; fi
exit 0
`);
    const out = execSync(`bash "${LAUNCHER}"`, { cwd: mainRepo, env: makeEnv(sid) }).toString();
    expect(out).toContain('IS_LINK=yes');
    expect(existsSync(join(projectsRoot, toKey(mainRepo), 'old-session.jsonl'))).toBe(true);
  });

  it('干净退出 → 软链被删除，经软链写入主仓文件夹的 transcript 完好', () => {
    const sid = 'aaaa0003-1111-2222-3333-444444444444';
    const wtPath = join(worktreeBase, 'main', `session-${sid.slice(0, 8)}`);
    const link = join(projectsRoot, toKey(wtPath));
    writeMockClaude(`#!/usr/bin/env bash
echo '{"x":1}' > "${link}/${sid}.jsonl"
exit 0
`);
    execSync(`bash "${LAUNCHER}"`, { cwd: mainRepo, env: makeEnv(sid) });
    expect(existsSync(link)).toBe(false);
    expect(lstatSync(link, { throwIfNoEntry: false })).toBeUndefined();
    expect(existsSync(join(projectsRoot, toKey(mainRepo), `${sid}.jsonl`))).toBe(true);
  });

  it('脏 worktree 保留 → 软链同步保留', () => {
    const sid = 'aaaa0004-1111-2222-3333-444444444444';
    const wtPath = join(worktreeBase, 'main', `session-${sid.slice(0, 8)}`);
    const link = join(projectsRoot, toKey(wtPath));
    writeMockClaude(`#!/usr/bin/env bash
echo dirty > uncommitted.txt
exit 0
`);
    execSync(`bash "${LAUNCHER}"`, { cwd: mainRepo, env: makeEnv(sid) });
    expect(existsSync(join(wtPath, 'uncommitted.txt'))).toBe(true);
    expect(lstatSync(link).isSymbolicLink()).toBe(true);
  });

  it('--dry-run（auto-worktree 分支）→ 输出含 ln -s 契约行', () => {
    const sid = 'aaaa0005-1111-2222-3333-444444444444';
    const env = makeEnv(sid);
    const out = execSync(`bash "${LAUNCHER}" --dry-run`, { cwd: mainRepo, env }).toString();
    expect(out).toContain('ln -s');
    expect(out).toContain(toKey(mainRepo));
  });
});
