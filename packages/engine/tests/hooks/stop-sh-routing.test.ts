import { describe, it, expect } from 'vitest';
import { execSync, spawnSync } from 'child_process';
import { mkdtempSync, rmSync, existsSync, readFileSync } from 'fs';
import { join, resolve } from 'path';
import { tmpdir } from 'os';

const ENGINE_ROOT = resolve(__dirname, '../..');
const STOP_SH = resolve(ENGINE_ROOT, 'hooks/stop.sh');
const STOP_DEV_SH = resolve(ENGINE_ROOT, 'hooks/stop-dev.sh');
const DEVLOOP_CHECK = resolve(ENGINE_ROOT, 'lib/devloop-check.sh');
const SHIP_FINALIZE = resolve(ENGINE_ROOT, 'scripts/ship-finalize.sh');

describe('stop.sh routing — post goal-hook refactor', () => {
  it('stop-dev.sh has been deleted', () => {
    expect(existsSync(STOP_DEV_SH)).toBe(false);
  });

  // dev-heartbeat-guardian.sh 的"已删除"断言在 Stop Hook v23 PR-2（dd60f635c，
  // 心跳模型核心切换）里被推翻：worktree-manage.sh 的 cmd_create 从那次起就在
  // 调用这个文件做 .cecelia/lights/*.live 心跳续期（同名但语义完全不同于 v22
  // 时代给 stop hook 判断用的旧 guardian）。此前该文件本身一直缺失，导致心跳
  // 从未真正生效（每次建 worktree 都打印"guardian.sh 不存在，跳过心跳启动"），
  // 07-19 zombie-cleaner 修复里补齐了这个从设计出来就未落地的功能缺口。
  // 见 packages/brain/src/__tests__/platform-utils.test.js 里对应的功能测试。

  it('devloop-check.sh has been deleted', () => {
    expect(existsSync(DEVLOOP_CHECK)).toBe(false);
  });

  it('ship-finalize.sh has been deleted', () => {
    expect(existsSync(SHIP_FINALIZE)).toBe(false);
  });

  it('stop.sh does NOT invoke stop-dev.sh (no bash call)', () => {
    const source = readFileSync(STOP_SH, 'utf8');
    // Only check for actual invocation, not comments
    expect(source).not.toMatch(/^\s*bash\s+.*stop-dev\.sh/m);
    expect(source).not.toMatch(/^\s*\$SCRIPT_DIR\/stop-dev\.sh/m);
  });

  it('stop.sh still routes to stop-architect.sh and stop-decomp.sh', () => {
    const source = readFileSync(STOP_SH, 'utf8');
    expect(source).toContain('stop-architect.sh');
    expect(source).toContain('stop-decomp.sh');
  });

  it('stop.sh exits 0 in plain session (no lock files)', () => {
    const testDir = mkdtempSync(join(tmpdir(), 'stop-sh-plain-'));
    try {
      execSync(
        'git init -q && git config user.email "ci@test" && git config user.name "CI" && git commit --allow-empty -m "init"',
        { cwd: testDir, stdio: 'pipe' }
      );
      const result = spawnSync('bash', [STOP_SH], {
        cwd: testDir,
        env: {
          ...process.env,
          CLAUDE_HOOK_STDIN_JSON_OVERRIDE: JSON.stringify({
            session_id: 'test-plain-session',
            cwd: testDir,
            transcript_path: ''
          }),
          HOME: testDir,
        },
        timeout: 5000
      });
      expect(result.status).toBe(0);
    } finally {
      rmSync(testDir, { recursive: true, force: true });
    }
  });
});
