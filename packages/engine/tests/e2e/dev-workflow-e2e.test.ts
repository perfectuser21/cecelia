import { describe, it, expect, afterEach } from 'vitest';
import { execSync, spawnSync } from 'child_process';
import { rmSync, existsSync, readdirSync } from 'fs';
import { resolve, join } from 'path';
import * as os from 'os';

// ============================================================================
// E2E: /dev 全流程关键 checkpoint 验证
//
// 目标：确认 Engine 零件装配后能正常运行，作为 Engine 重构的安全网。
// 覆盖：worktree 创建
// ============================================================================

const ENGINE_ROOT = resolve(__dirname, '../..');
const WORKTREE_MANAGE = resolve(ENGINE_ROOT, 'skills/dev/scripts/worktree-manage.sh');

// 记录需要在测试后清理的临时目录
const tmpDirs: string[] = [];

afterEach(() => {
  for (const dir of tmpDirs.splice(0)) {
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      // 忽略清理失败
    }
  }
});

// ============================================================================
// worktree-manage create
// ============================================================================

describe('worktree-manage create', () => {
  it('脚本文件存在且语法正确（bash -n）', () => {
    expect(existsSync(WORKTREE_MANAGE)).toBe(true);
    const result = spawnSync('bash', ['-n', WORKTREE_MANAGE], { encoding: 'utf8' });
    expect(result.status).toBe(0);
  });

  it('不带参数时输出 usage（包含 task-name）', () => {
    const result = spawnSync('bash', [WORKTREE_MANAGE, 'create'], {
      encoding: 'utf8',
      cwd: ENGINE_ROOT,
    });
    const combined = (result.stdout || '') + (result.stderr || '');
    expect(combined).toContain('task-name');
  });

  it('list 命令能正常运行并输出当前 worktree', () => {
    const result = spawnSync('bash', [WORKTREE_MANAGE, 'list'], {
      encoding: 'utf8',
      cwd: ENGINE_ROOT,
      timeout: 30000,
    });
    const combined = (result.stdout || '') + (result.stderr || '');
    expect(combined.length).toBeGreaterThan(0);
  }, 30000);

  it.skip('create 实际创建 worktree，路径存在（含清理）[CI环境无git worktree]', () => {
    const taskName = `e2e-${Date.now()}`;
    const now = new Date();
    const mm = String(now.getMonth() + 1).padStart(2, '0');
    const dd = String(now.getDate()).padStart(2, '0');
    const worktreeBase = join(os.homedir(), 'worktrees', 'cecelia');

    const result = spawnSync('bash', [WORKTREE_MANAGE, 'create', taskName], {
      encoding: 'utf8',
      cwd: ENGINE_ROOT,
      timeout: 30000,
    });

    const combined = (result.stdout || '') + (result.stderr || '');

    if (result.status === 0) {
      // 创建成功：输出包含 cp- 分支名
      expect(combined).toContain('cp-');

      // 清理：找到今天创建的测试 worktree
      if (existsSync(worktreeBase)) {
        const dirs = readdirSync(worktreeBase).filter(d => d.startsWith(`cp-${mm}${dd}`) && d.includes(taskName.substring(0, 8)));
        for (const d of dirs) {
          const fullPath = join(worktreeBase, d);
          tmpDirs.push(fullPath);
          try {
            execSync(`git worktree remove --force "${fullPath}" 2>/dev/null || true`, { cwd: ENGINE_ROOT });
            execSync(`git branch -D "${d}" 2>/dev/null || true`, { cwd: ENGINE_ROOT });
          } catch {
            // 忽略清理错误
          }
        }
      }
    } else {
      // CI 环境无 remote 也可接受，但不应报 usage error
      expect(combined).not.toContain('用法: worktree-manage.sh create');
    }
  });
});

