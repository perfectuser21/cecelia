import { describe, it, expect, afterEach } from 'vitest';
import { execSync, spawnSync } from 'child_process';
import { writeFileSync, mkdtempSync, rmSync, existsSync, readdirSync, readFileSync, mkdirSync } from 'fs';
import { resolve, join } from 'path';
import * as os from 'os';

// ============================================================================
// E2E: /dev 全流程关键 checkpoint 验证
//
// 目标：确认 Engine 零件装配后能正常运行，作为 Engine 重构的安全网。
// 覆盖：worktree 创建 / devloop-check Stage 检测 / stop hook 退出码
// ============================================================================

const ENGINE_ROOT = resolve(__dirname, '../..');
const WORKTREE_MANAGE = resolve(ENGINE_ROOT, 'skills/dev/scripts/worktree-manage.sh');
const DEVLOOP_CHECK = resolve(ENGINE_ROOT, 'lib/devloop-check.sh');
const STOP_DEV = resolve(ENGINE_ROOT, 'hooks/stop-dev.sh');

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

// 创建临时 git repo，写入 .dev-mode 文件
function makeTmpRepo(devModeLines: string[], branch: string): string {
  const dir = mkdtempSync(join(os.tmpdir(), 'cecelia-e2e-'));
  tmpDirs.push(dir);
  execSync('git init -q', { cwd: dir });
  execSync('git config user.email "test@example.com"', { cwd: dir });
  execSync('git config user.name "Test"', { cwd: dir });
  writeFileSync(join(dir, `.dev-mode.${branch}`), devModeLines.join('\n') + '\n');
  return dir;
}

// 运行 devloop_check 函数并返回 {status, output}
// 关键：不能用 result=$(devloop_check ...) —— bash 的 $() 赋值会吞掉 exit code
// 改为直接调用，让 set -e 自然传播返回码
function runDevloopCheck(branch: string, devModeFile: string, cwd: string): { status: number; output: string } {
  const script = `source "${DEVLOOP_CHECK}"; devloop_check "${branch}" "${devModeFile}"`;
  const result = spawnSync('bash', ['-c', script], { encoding: 'utf8', cwd, timeout: 10000 });
  return {
    status: result.status ?? -1,
    output: (result.stdout || '') + (result.stderr || ''),
  };
}

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
    });
    const combined = (result.stdout || '') + (result.stderr || '');
    expect(combined.length).toBeGreaterThan(0);
  });

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

// ============================================================================
// devloop_check Stage 状态检测
// ============================================================================

describe('devloop_check stage detection', () => {
  const BRANCH = 'cp-04020001-e2e-stage-detection';

  it('step_1_spec=pending 时 exit 2 + 输出 blocked', () => {
    const dir = makeTmpRepo(
      [
        'dev',
        `branch: ${BRANCH}`,
        'step_0_worktree: done',
        'step_1_spec: pending',
        'step_2_code: pending',
        'step_3_integrate: pending',
        'step_4_ship: pending',
        'task_track: lite',
      ],
      BRANCH
    );
    writeFileSync(join(dir, `.dev-gate-lite.${BRANCH}`), '{"verdict":"PASS"}\n');

    const { status, output } = runDevloopCheck(BRANCH, `${dir}/.dev-mode.${BRANCH}`, dir);
    expect(status).toBe(2);
    expect(output).toContain('blocked');
  });

  it('step_1_spec=done, step_2_code=pending → exit 2（Stage 2 未完成）', () => {
    const dir = makeTmpRepo(
      [
        'dev',
        `branch: ${BRANCH}`,
        'step_0_worktree: done',
        'step_1_spec: done',
        'step_2_code: pending',
        'step_3_integrate: pending',
        'step_4_ship: pending',
        'task_track: lite',
      ],
      BRANCH
    );
    writeFileSync(join(dir, `.dev-gate-lite.${BRANCH}`), '{"verdict":"PASS"}\n');
    writeFileSync(join(dir, `.dev-gate-generator.${BRANCH}`), '{"verdict":"PASS"}\n');

    const { status, output } = runDevloopCheck(BRANCH, `${dir}/.dev-mode.${BRANCH}`, dir);
    expect(status).toBe(2);
    expect(output).toContain('blocked');
  });

  it('cleanup_done=true → exit 0（工作流完成）', () => {
    const dir = makeTmpRepo(
      [
        'dev',
        `branch: ${BRANCH}`,
        'step_0_worktree: done',
        'step_1_spec: done',
        'step_2_code: done',
        'step_3_integrate: done',
        'step_4_ship: done',
        'cleanup_done: true',
      ],
      BRANCH
    );

    const { status, output } = runDevloopCheck(BRANCH, `${dir}/.dev-mode.${BRANCH}`, dir);
    expect(status).toBe(0);
    expect(output).toContain('done');
  });

  it('step_1_spec=pending（task_track=full）→ exit 2，无需 seal 文件', () => {
    // full mode 也应在 step_1_spec=pending 时立即 blocked（条件 1 在 1.5/1.6 之前）
    const dir = makeTmpRepo(
      [
        'dev',
        `branch: ${BRANCH}`,
        'step_0_worktree: done',
        'step_1_spec: pending',
        'task_track: full',
      ],
      BRANCH
    );

    const { status, output } = runDevloopCheck(BRANCH, `${dir}/.dev-mode.${BRANCH}`, dir);
    expect(status).toBe(2);
    expect(output).toContain('blocked');
  });
});

// ============================================================================
// stop hook 退出码
// ============================================================================

describe('stop hook exit codes', () => {
  it('stop-dev.sh 文件存在且语法正确', () => {
    expect(existsSync(STOP_DEV)).toBe(true);
    const result = spawnSync('bash', ['-n', STOP_DEV], { encoding: 'utf8' });
    expect(result.status).toBe(0);
  });

  it('stop-dev.sh source devloop-check.sh（职责分离，不直接实现判断逻辑）', () => {
    const { readFileSync } = require('fs') as typeof import('fs');
    const content = readFileSync(STOP_DEV, 'utf8');
    expect(content).toContain('devloop-check.sh');
  });

  it('无活跃 .dev-lock 时，stop-dev.sh 允许退出（exit 0）', () => {
    const dir = mkdtempSync(join(os.tmpdir(), 'cecelia-e2e-stop-'));
    tmpDirs.push(dir);
    execSync('git init -q', { cwd: dir });

    const result = spawnSync('bash', [STOP_DEV], {
      encoding: 'utf8',
      cwd: dir,
      env: { ...process.env, HOME: dir },
      timeout: 10000,
    });
    // 无 .dev-lock → 无活跃会话 → exit 0
    expect(result.status).toBe(0);
  });

  it('devloop_check 在 step_1_spec=pending 时 exit 2（模拟 stop hook 阻止退出）', () => {
    const BRANCH = 'cp-04020001-stop-hook-pending';
    const dir = makeTmpRepo(
      [
        'dev',
        `branch: ${BRANCH}`,
        'step_0_worktree: done',
        'step_1_spec: pending',
        'task_track: lite',
      ],
      BRANCH
    );
    writeFileSync(join(dir, `.dev-gate-lite.${BRANCH}`), '{"verdict":"PASS"}\n');

    const { status } = runDevloopCheck(BRANCH, `${dir}/.dev-mode.${BRANCH}`, dir);
    expect(status).toBe(2);
  });

  it('devloop_check 在 cleanup_done=true 时 exit 0（模拟 stop hook 允许退出）', () => {
    const BRANCH = 'cp-04020001-stop-hook-done';
    const dir = makeTmpRepo(['dev', `branch: ${BRANCH}`, 'cleanup_done: true'], BRANCH);

    const { status } = runDevloopCheck(BRANCH, `${dir}/.dev-mode.${BRANCH}`, dir);
    expect(status).toBe(0);
  });
});

// ============================================================================
// 条件 2.6: DoD 完整性检查（Task Card 未勾选条目）
// ============================================================================

describe('devloop_check DoD completeness (条件 2.6)', () => {
  const BRANCH = 'cp-04020001-dod-completeness';

  it('Task Card 含未勾选 [ ] 条目时 exit 2', () => {
    const dir = makeTmpRepo(
      [
        'dev',
        `branch: ${BRANCH}`,
        'step_0_worktree: done',
        'step_1_spec: done',
        'step_2_code: done',
        'step_3_integrate: pending',
        'step_4_ship: pending',
        `task_card: .task-cp-${BRANCH}.md`,
      ],
      BRANCH
    );
    // 写一个含未勾选条目的 Task Card
    writeFileSync(
      join(dir, `.task-cp-${BRANCH}.md`),
      [
        '# Task Card: Test',
        '## 验收条件（DoD）',
        '- [ ] [BEHAVIOR] 测试行为一',
        '  Test: manual:echo test',
        '- [x] [ARTIFACT] 已完成的产出',
        '  Test: manual:echo done',
      ].join('\n') + '\n'
    );

    const { status, output } = runDevloopCheck(BRANCH, `${dir}/.dev-mode.${BRANCH}`, dir);
    expect(status).toBe(2);
    expect(output).toContain('未验证');
  });

  it('Task Card 全部 [x] 勾选时不阻塞（通过条件 2.6）', () => {
    const dir = makeTmpRepo(
      [
        'dev',
        `branch: ${BRANCH}`,
        'step_0_worktree: done',
        'step_1_spec: done',
        'step_2_code: done',
        'step_3_integrate: pending',
        'step_4_ship: pending',
        `task_card: .task-cp-${BRANCH}.md`,
      ],
      BRANCH
    );
    writeFileSync(
      join(dir, `.task-cp-${BRANCH}.md`),
      [
        '# Task Card: Test',
        '## 验收条件（DoD）',
        '- [x] [BEHAVIOR] 测试行为一',
        '  Test: manual:echo test',
        '- [x] [ARTIFACT] 已完成的产出',
        '  Test: manual:echo done',
      ].join('\n') + '\n'
    );

    const { status, output } = runDevloopCheck(BRANCH, `${dir}/.dev-mode.${BRANCH}`, dir);
    // 通过条件 2.6，但会在条件 3（PR 检查）阻塞
    expect(status).toBe(2);
    // 不应该包含"未验证"，而是 PR 未创建
    expect(output).not.toContain('未验证');
  });
});

// ============================================================================
// 条件 3: PR 未创建检测
// ============================================================================

describe('devloop_check PR creation check (条件 3)', () => {
  const BRANCH = 'cp-04020001-pr-check';

  it('step_2_code=done + DoD 全部勾选 + 无 PR 时 exit 2 + 输出 PR 未创建', () => {
    const dir = makeTmpRepo(
      [
        'dev',
        `branch: ${BRANCH}`,
        'step_0_worktree: done',
        'step_1_spec: done',
        'step_2_code: done',
        'step_3_integrate: pending',
        'step_4_ship: pending',
        `task_card: .task-cp-${BRANCH}.md`,
      ],
      BRANCH
    );
    writeFileSync(
      join(dir, `.task-cp-${BRANCH}.md`),
      [
        '# Task Card: Test',
        '## 验收条件（DoD）',
        '- [x] [BEHAVIOR] done',
        '  Test: manual:echo ok',
      ].join('\n') + '\n'
    );

    // 使用一个不存在的分支名，gh CLI 查不到 PR → PR 未创建
    const { status, output } = runDevloopCheck(BRANCH, `${dir}/.dev-mode.${BRANCH}`, dir);
    expect(status).toBe(2);
    expect(output).toContain('PR');
  });
});

// ============================================================================
// 条件 0 优先级: cleanup_done 优先于其他所有条件
// ============================================================================

describe('devloop_check cleanup_done priority (条件 0)', () => {
  it('即使 step 状态全是 pending，cleanup_done=true 也 exit 0', () => {
    const BRANCH = 'cp-04020001-cleanup-priority';
    const dir = makeTmpRepo(
      [
        'dev',
        `branch: ${BRANCH}`,
        'step_0_worktree: done',
        'step_1_spec: pending',
        'step_2_code: pending',
        'step_3_integrate: pending',
        'step_4_ship: pending',
        'cleanup_done: true',
      ],
      BRANCH
    );

    const { status, output } = runDevloopCheck(BRANCH, `${dir}/.dev-mode.${BRANCH}`, dir);
    expect(status).toBe(0);
    expect(output).toContain('done');
  });
});

// ============================================================================
// 完整 Stage 推进序列：从 step_1=pending 到 cleanup_done
// ============================================================================

describe('devloop_check full stage progression sequence', () => {
  const BRANCH = 'cp-04020001-full-sequence';

  // 辅助函数：创建带 Task Card 的 tmp repo
  function makeTmpRepoWithTaskCard(devModeLines: string[], branch: string): string {
    const dir = makeTmpRepo(devModeLines, branch);
    writeFileSync(
      join(dir, `.task-cp-${branch}.md`),
      [
        '# Task Card: Sequence Test',
        '## 验收条件（DoD）',
        '- [x] [BEHAVIOR] all done',
        '  Test: manual:echo ok',
      ].join('\n') + '\n'
    );
    return dir;
  }

  it('Stage 序列：step_1=pending → blocked(Stage 1)', () => {
    const dir = makeTmpRepoWithTaskCard(
      ['dev', `branch: ${BRANCH}`, 'step_0_worktree: done', 'step_1_spec: pending', 'task_track: lite'],
      BRANCH
    );
    writeFileSync(join(dir, `.dev-gate-lite.${BRANCH}`), '{"verdict":"PASS"}\n');
    const { status, output } = runDevloopCheck(BRANCH, `${dir}/.dev-mode.${BRANCH}`, dir);
    expect(status).toBe(2);
    expect(output).toContain('Stage 1');
  });

  it('Stage 序列：step_1=done, step_2=pending → blocked(Stage 2)', () => {
    const dir = makeTmpRepoWithTaskCard(
      ['dev', `branch: ${BRANCH}`, 'step_0_worktree: done', 'step_1_spec: done', 'step_2_code: pending', 'task_track: lite'],
      BRANCH
    );
    writeFileSync(join(dir, `.dev-gate-lite.${BRANCH}`), '{"verdict":"PASS"}\n');
    writeFileSync(join(dir, `.dev-gate-generator.${BRANCH}`), '{"verdict":"PASS"}\n');
    const { status, output } = runDevloopCheck(BRANCH, `${dir}/.dev-mode.${BRANCH}`, dir);
    expect(status).toBe(2);
    expect(output).toContain('Stage 2');
  });

  it('Stage 序列：step_1=done, step_2=done → blocked(PR 未创建)', () => {
    const dir = makeTmpRepoWithTaskCard(
      [
        'dev', `branch: ${BRANCH}`, 'step_0_worktree: done',
        'step_1_spec: done', 'step_2_code: done',
        'step_3_integrate: pending', 'step_4_ship: pending',
        `task_card: .task-cp-${BRANCH}.md`,
      ],
      BRANCH
    );
    const { status, output } = runDevloopCheck(BRANCH, `${dir}/.dev-mode.${BRANCH}`, dir);
    expect(status).toBe(2);
    expect(output).toContain('PR');
  });

  it('Stage 序列：cleanup_done=true → done(exit 0)', () => {
    const dir = makeTmpRepoWithTaskCard(
      [
        'dev', `branch: ${BRANCH}`, 'step_0_worktree: done',
        'step_1_spec: done', 'step_2_code: done',
        'step_3_integrate: done', 'step_4_ship: done',
        'cleanup_done: true',
      ],
      BRANCH
    );
    const { status, output } = runDevloopCheck(BRANCH, `${dir}/.dev-mode.${BRANCH}`, dir);
    expect(status).toBe(0);
    expect(output).toContain('done');
  });
});

// ============================================================================
// branch 参数为空时的防御性行为
// ============================================================================

describe('devloop_check edge cases', () => {
  it('branch 参数为空时 exit 2（防御性检查）', () => {
    const dir = mkdtempSync(join(os.tmpdir(), 'cecelia-e2e-edge-'));
    tmpDirs.push(dir);
    execSync('git init -q', { cwd: dir });

    const script = `source "${DEVLOOP_CHECK}"; devloop_check "" ""`;
    const result = spawnSync('bash', ['-c', script], { encoding: 'utf8', cwd: dir, timeout: 10000 });
    expect(result.status).toBe(2);
    const combined = (result.stdout || '') + (result.stderr || '');
    expect(combined).toContain('branch');
  });

  it('dev_mode_file 不存在时 step_1 条件直接跳过（进入后续逻辑）', () => {
    const BRANCH = 'cp-04020001-no-devmode';
    const dir = mkdtempSync(join(os.tmpdir(), 'cecelia-e2e-edge2-'));
    tmpDirs.push(dir);
    execSync('git init -q', { cwd: dir });

    const nonExistentFile = join(dir, '.dev-mode.nonexistent');
    const { status } = runDevloopCheck(BRANCH, nonExistentFile, dir);
    // dev_mode_file 不存在：step_1/step_2 的 if 条件不进入 → 跳到 PR 检查 → blocked
    expect(status).toBe(2);
  });
});

// ============================================================================
// Harness 模式（harness_mode=true）完整路径
// ============================================================================

describe('devloop_check harness mode', () => {
  const BRANCH = 'cp-04090001-harness-e2e';

  // 创建 mock gh 脚本的辅助函数
  function makeMockGh(dir: string, output: string): void {
    const mockGh = join(dir, 'gh');
    writeFileSync(mockGh, `#!/bin/bash\necho "${output}"\n`);
    execSync(`chmod +x "${mockGh}"`);
  }

  it('Harness 模式：step_2_code=done + PR 存在 → exit 2（等待 CI+merge，单一 exit 0 原则，不再快速通道退出）', () => {
    const tmpBin = mkdtempSync(join(os.tmpdir(), 'cecelia-e2e-ghbin-'));
    tmpDirs.push(tmpBin);
    makeMockGh(tmpBin, '9999');

    const dir = makeTmpRepo(
      [
        'dev',
        `branch: ${BRANCH}`,
        'harness_mode: true',
        'sprint_dir: sprints',
        'step_1_spec: done',
        'step_2_code: done',
      ],
      BRANCH
    );

    const script = `source "${DEVLOOP_CHECK}"; export PATH="${tmpBin}:$PATH"; devloop_check "${BRANCH}" "${dir}/.dev-mode.${BRANCH}"`;
    const result = spawnSync('bash', ['-c', script], { encoding: 'utf8', cwd: dir, timeout: 10000 });
    // v4.6.0 单一 exit 0：PR 创建后不再立即退出，harness 继续走条件 4（CI 等待）→ exit 2（blocked）
    expect(result.status).toBe(2);
    const combined = (result.stdout || '') + (result.stderr || '');
    expect(combined).toContain('blocked');
  });

  it('Harness 模式：step_2_code=pending → exit 2（Stage 2 未完成）', () => {
    const dir = makeTmpRepo(
      [
        'dev',
        `branch: ${BRANCH}`,
        'harness_mode: true',
        'sprint_dir: sprints',
        'step_1_spec: done',
        'step_2_code: pending',
      ],
      BRANCH
    );

    const { status, output } = runDevloopCheck(BRANCH, `${dir}/.dev-mode.${BRANCH}`, dir);
    expect(status).toBe(2);
    expect(output).toContain('Harness');
  });

  it('Harness 模式：cleanup_done 残留 + step_2_code=pending → exit 2（不走通用 cleanup_done 早退）', () => {
    const dir = makeTmpRepo(
      [
        'dev',
        `branch: ${BRANCH}`,
        'harness_mode: true',
        'sprint_dir: sprints',
        'step_1_spec: pending',
        'step_2_code: pending',
        'cleanup_done: true',
      ],
      BRANCH
    );

    const { status, output } = runDevloopCheck(BRANCH, `${dir}/.dev-mode.${BRANCH}`, dir);
    // Harness 模式下 cleanup_done 不触发通用早退，被 0.5 通道处理 → stage 2 未完成 → exit 2
    expect(status).toBe(2);
    expect(output).toContain('blocked');
  });

  it('Harness 模式：step_2_code=done + mock gh 返回空（无 PR）→ exit 2', () => {
    const tmpBin = mkdtempSync(join(os.tmpdir(), 'cecelia-e2e-ghbin2-'));
    tmpDirs.push(tmpBin);
    makeMockGh(tmpBin, '');

    const dir = makeTmpRepo(
      [
        'dev',
        `branch: ${BRANCH}`,
        'harness_mode: true',
        'sprint_dir: sprints',
        'step_1_spec: done',
        'step_2_code: done',
      ],
      BRANCH
    );

    const script = `source "${DEVLOOP_CHECK}"; export PATH="${tmpBin}:$PATH"; devloop_check "${BRANCH}" "${dir}/.dev-mode.${BRANCH}"`;
    const result = spawnSync('bash', ['-c', script], { encoding: 'utf8', cwd: dir, timeout: 10000 });
    expect(result.status).toBe(2);
    const combined = (result.stdout || '') + (result.stderr || '');
    expect(combined).toContain('PR');
  });

  it('标准模式：cleanup_done=true（无 harness_mode）→ exit 0（正常早退不受 Harness 修复影响）', () => {
    const STANDARD_BRANCH = 'cp-04090001-standard-cleanup';
    const dir = makeTmpRepo(
      [
        'dev',
        `branch: ${STANDARD_BRANCH}`,
        'harness_mode: false',
        'step_1_spec: done',
        'step_2_code: done',
        'cleanup_done: true',
      ],
      STANDARD_BRANCH
    );

    const { status, output } = runDevloopCheck(STANDARD_BRANCH, `${dir}/.dev-mode.${STANDARD_BRANCH}`, dir);
    expect(status).toBe(0);
    expect(output).toContain('done');
  });

  it('stop-dev.sh 在无 .dev-lock 匹配当前 worktree 时 exit 0', () => {
    const dir = mkdtempSync(join(os.tmpdir(), 'cecelia-e2e-stophook-'));
    tmpDirs.push(dir);
    execSync('git init -q', { cwd: dir });
    execSync('git config user.email "test@example.com"', { cwd: dir });
    execSync('git config user.name "Test"', { cwd: dir });

    // 无任何 .dev-lock 文件
    const result = spawnSync('bash', [STOP_DEV], {
      encoding: 'utf8',
      cwd: dir,
      env: { ...process.env, HOME: dir },
      timeout: 10000,
    });
    expect(result.status).toBe(0);
  });
});
