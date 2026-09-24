// F1「工厂 · 开发闭环」步骤 3「造完真验」—— 边：跑场机节点准入探针（worktree + 容器）
//
// 2026-09-24 实证：MMV fleet-worker 的 disposable 探针用 `git worktree add --detach` 对 8465 文件
// 全量检出，实测 4–5.5s，撞探针 DEFAULT_COMMAND_TIMEOUT_MS=5s 被杀 → worktree.root_ready /
// container.probe_succeeded 恒 false → node-admission 拒绝 MMV，kernel run 卡 node_not_base_admitted。
// 容器探针只检查 /workspace/.git 存在，所以 worktree add 必须 --no-checkout。
// 真 import node-probe.cjs、真跑 git（守卫在边上），只把 docker/系统命令换成桩，不 mock 被改模块。
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFile, execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { promisify } from 'node:util';
import { afterEach, describe, expect, it, vi } from 'vitest';

const require = createRequire(import.meta.url);
const { probeFleetWorkerHealth } = require('../../../packages/brain/scripts/fleet-worker/node-probe.cjs');
const execFileAsync = promisify(execFile);

const DIGEST = `sha256:${'a'.repeat(64)}`;
const roots = [];
afterEach(() => { for (const r of roots.splice(0)) fs.rmSync(r, { recursive: true, force: true }); });

function repoWithManyFiles(fileCount) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'gp-f1-node-probe-repo-'));
  roots.push(root);
  const git = (...args) => execFileSync('git', args, { cwd: root, stdio: 'pipe' });
  git('init', '-q');
  git('config', 'user.email', 'gp@cecelia.test');
  git('config', 'user.name', 'gp');
  for (let i = 0; i < fileCount; i += 1) {
    fs.writeFileSync(path.join(root, `file-${i}.txt`), `payload ${i}\n`);
  }
  git('add', '.');
  git('commit', '-q', '-m', 'seed');
  return root;
}

describe('F1 step3 · 跑场机节点准入探针不做全量检出', () => {
  it('worktree add 带 --no-checkout：探针目录里只有 .git，且 worktree/container 探针判 ready', async () => {
    const repoRoot = repoWithManyFiles(300);
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'gp-f1-node-probe-tmp-'));
    roots.push(tempRoot);

    const worktreeAddCalls = [];
    const listingsAfterAdd = [];
    const execFileFn = vi.fn(async (file, args, options) => {
      if (file === 'git') {
        const result = await execFileAsync(file, args, options);
        if (args[0] === 'worktree' && args[1] === 'add') {
          worktreeAddCalls.push(args);
          listingsAfterAdd.push(fs.readdirSync(args.at(-2)));
        }
        return result;
      }
      if (file === 'docker' && args[0] === 'info') return { stdout: '{}' };
      if (file === 'docker' && args[0] === 'image') return { stdout: '[]' };
      return { stdout: '' };
    });

    const report = await probeFleetWorkerHealth({
      machineId: 'us-mac-m4',
      runnerImageDigest: DIGEST,
      repoRoot,
      execFileFn,
      fetchFn: vi.fn(async () => new Response('{}', { status: 200 })),
      makeTempDirFn: vi.fn(async () => tempRoot),
      chmodTempDirFn: vi.fn(async () => undefined),
      removeTempDirFn: vi.fn(async () => undefined),
      statFn: vi.fn(async () => undefined),
    });

    expect(worktreeAddCalls).toHaveLength(1);
    expect(worktreeAddCalls[0]).toEqual([
      'worktree', 'add', '--detach', '--no-checkout', path.join(tempRoot, 'worktree'), 'HEAD',
    ]);
    // 300 个已提交文件一个都不落地——探针只需要 .git，不为它付 O(仓库) 的检出账
    expect(listingsAfterAdd[0]).toEqual(['.git']);
    expect(report.worktree).toEqual({ root_ready: true });
    expect(report.container).toEqual({ probe_succeeded: true });
    // 探针用完即弃：worktree 已被 remove，bare 登记里不留 prunable 残留
    expect(fs.existsSync(path.join(tempRoot, 'worktree'))).toBe(false);
  });
});
