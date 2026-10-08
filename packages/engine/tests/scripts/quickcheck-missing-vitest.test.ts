import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execSync, spawnSync } from 'child_process';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, cpSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

// 事故（2026-10-01 ~ 10-08）：本机 brain 依赖安装中断，vitest/zod 缺失；
// quickcheck 打印"vitest 未安装，跳过"后 exit 0，这一周 brain 改动 push 前从未真跑测试。
// 守卫：改动包找不到 vitest 时必须失败；只有显式 QUICKCHECK_ALLOW_MISSING_VITEST=1 才跳过。
const REAL_SCRIPTS = join(process.cwd(), '..', '..', 'scripts');

function git(repo: string, args: string) {
  execSync(`git -C "${repo}" ${args}`, { stdio: 'pipe' });
}

describe('quickcheck.sh — 改动包缺 vitest', () => {
  let repo: string;

  beforeAll(() => {
    repo = mkdtempSync(join(tmpdir(), 'qcvitest-'));
    git(repo, 'init -q -b main');
    git(repo, 'config user.email t@t.com');
    git(repo, 'config user.name t');
    git(repo, 'config core.hooksPath /dev/null');
    mkdirSync(join(repo, 'scripts'), { recursive: true });
    cpSync(join(REAL_SCRIPTS, 'quickcheck.sh'), join(repo, 'scripts', 'quickcheck.sh'));
    cpSync(join(REAL_SCRIPTS, 'lib'), join(repo, 'scripts', 'lib'), { recursive: true });
    git(repo, 'add -A');
    git(repo, 'commit -qm base');
    git(repo, 'update-ref refs/remotes/origin/main HEAD');
    mkdirSync(join(repo, 'packages', 'engine'), { recursive: true });
    writeFileSync(join(repo, 'packages', 'engine', 'changed.txt'), 'x\n');
    git(repo, 'add -A');
    git(repo, 'commit -qm change');
  });

  afterAll(() => rmSync(repo, { recursive: true, force: true }));

  const run = (env: Record<string, string> = {}) => spawnSync('bash', ['scripts/quickcheck.sh'], {
    cwd: repo, encoding: 'utf8',
    env: { ...process.env, QUICKCHECK_LOCK_WAIT_SEC: '5', ...env },
  });

  it('默认：找不到 vitest 判失败（exit 1），不放行', () => {
    const r = run();
    expect(r.stdout + r.stderr).toMatch(/vitest 未安装/);
    expect(r.status).toBe(1);
  }, 30000);

  it('显式 QUICKCHECK_ALLOW_MISSING_VITEST=1 才跳过，并醒目提示未测试', () => {
    const r = run({ QUICKCHECK_ALLOW_MISSING_VITEST: '1' });
    expect(r.stdout + r.stderr).toMatch(/QUICKCHECK_ALLOW_MISSING_VITEST/);
    expect(r.status).toBe(0);
  }, 30000);
});
