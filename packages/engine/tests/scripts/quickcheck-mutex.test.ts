import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { execSync, spawn } from 'child_process';
import { mkdtempSync, rmSync, writeFileSync, existsSync, readFileSync, readdirSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

// quickcheck.sh 真实路径（相对工作目录）
const REAL_SCRIPT = join(process.cwd(), '..', '..', 'scripts', 'quickcheck.sh');

describe('quickcheck.sh — 并发互斥锁', () => {
  let fakeRepo: string;
  let fakeScript: string;

  beforeEach(() => {
    fakeRepo = mkdtempSync(join(tmpdir(), 'qcmutex-'));
    execSync(`git init -q "${fakeRepo}"`, { stdio: 'pipe' });
    execSync(`git -C "${fakeRepo}" config user.email test@test.com`, { stdio: 'pipe' });
    execSync(`git -C "${fakeRepo}" config user.name test`, { stdio: 'pipe' });
    execSync(`git -C "${fakeRepo}" commit --allow-empty -qm init`, { stdio: 'pipe' });

    // 构造测试用 quickcheck —— 只包含锁逻辑 + sleep + marker，绕过真 vitest
    fakeScript = join(fakeRepo, 'quickcheck.sh');
    const realContent = readFileSync(REAL_SCRIPT, 'utf8');
    // 截取到第一个 "echo" 之前（锁逻辑之后）+ sleep + touch marker
    // 简化：直接取锁逻辑块，后面自定义工作负载
    const lockBlockMatch = realContent.match(/^([\s\S]*?trap '.*?EXIT INT TERM[\s\S]*?fi)/m);
    if (!lockBlockMatch) {
      // fallback: 找 flock 相关
      const flockMatch = realContent.match(/^([\s\S]*?exec 200[\s\S]*?(?:exit 0|fi))/m);
      writeFileSync(fakeScript, (flockMatch ? flockMatch[1] : realContent.slice(0, 2000)) +
        '\necho "[test] working..." >&2\nsleep 3\ntouch "${REPO_ROOT:-$(pwd)}/ran.$$"\nexit 0\n');
    } else {
      writeFileSync(fakeScript, lockBlockMatch[1] +
        '\necho "[test] working..." >&2\nsleep 3\ntouch "${REPO_ROOT:-$(pwd)}/ran.$$"\nexit 0\n');
    }
    execSync(`chmod +x "${fakeScript}"`);
  });

  afterEach(() => rmSync(fakeRepo, { recursive: true, force: true }));

  it('两次并发调用，只有一个真正跑完，另一个跳过', async () => {
    const run1 = spawn('bash', [fakeScript], { cwd: fakeRepo, stdio: 'pipe' });
    let run1Stderr = '';
    run1.stderr.on('data', (d: Buffer) => { run1Stderr += d.toString(); });

    // 200ms 后启动第二个，确保第一个已拿到锁
    await new Promise(r => setTimeout(r, 200));

    let run2Output = '';
    let run2ExitCode = 0;
    try {
      run2Output = execSync(`bash "${fakeScript}" 2>&1`, {
        cwd: fakeRepo,
        encoding: 'utf8',
        timeout: 5000,
      });
    } catch (e: any) {
      run2Output = (e.stdout || '') + (e.stderr || '');
      run2ExitCode = e.status || 0;
    }

    // 第二个应跳过 (exit 0)
    expect(run2ExitCode).toBe(0);
    expect(run2Output).toMatch(/跳过|已在运行|另一个 quickcheck/);

    // 等第一个跑完
    await new Promise<void>(resolve => run1.on('close', () => resolve()));

    // 只有一个 marker（第一个产生的）
    const markers = readdirSync(fakeRepo).filter(f => f.startsWith('ran.'));
    expect(markers.length).toBe(1);
  }, 15000);

  it('锁在脚本结束后自动释放（下一次能正常跑）', async () => {
    // 第一次跑完
    execSync(`bash "${fakeScript}"`, { cwd: fakeRepo, encoding: 'utf8' });
    // 锁文件/目录应被释放（flock 的 lock file 可能保留但不持锁；mkdir 的 lockdir 应删）
    const lockDirExists = existsSync(join(fakeRepo, '.git', 'quickcheck.lockdir'));
    expect(lockDirExists).toBe(false);

    // 第二次应正常跑（不跳过，不报"另一个"）
    const out = execSync(`bash "${fakeScript}" 2>&1`, { cwd: fakeRepo, encoding: 'utf8' });
    expect(out).not.toMatch(/跳过|另一个 quickcheck/);
  }, 10000);
});
