// host-disk-sampler.test.js [BEHAVIOR] — 模块1 宿主磁盘采样器
// TDD Red 证据用（vitest）。evaluator 真正验收走 contract-dod.md 的 manual:bash 命令，
// 本文件不被 evaluator 当 oracle 读取，但必须真跑真失败（禁 mock 被测边：真 bash 脚本 + 真文件系统）。
import { describe, it, expect } from 'vitest';
import { execSync, spawnSync } from 'child_process';
import { existsSync, readFileSync, mkdtempSync, mkdirSync, rmSync, writeFileSync, utimesSync } from 'fs';
import { tmpdir } from 'os';
import { join, resolve } from 'path';
import { fileURLToPath } from 'url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const REPO_ROOT = resolve(__dirname, '../../../');
const SAMPLER = join(REPO_ROOT, 'scripts/host-disk-sampler.sh');

describe('host-disk-sampler.sh [BEHAVIOR]', () => {
  it('原子写入 host-disk.json 且字段完整（sampled_at_epoch/data_avail_bytes/apfs_unallocated_bytes/effective_free_bytes/usage_pct）', async () => {
    expect(existsSync(SAMPLER)).toBe(true);
    const workDir = mkdtempSync(join(tmpdir(), 'sampler-red-'));
    try {
      execSync(`bash "${SAMPLER}"`, { env: { ...process.env, CECELIA_DEPLOY_ROOT: workDir }, stdio: 'pipe' });
      const jsonPath = join(workDir, '.runtime', 'host-disk.json');
      expect(existsSync(jsonPath)).toBe(true);
      const data = JSON.parse(readFileSync(jsonPath, 'utf8'));
      for (const f of ['sampled_at_epoch', 'data_avail_bytes', 'apfs_unallocated_bytes', 'effective_free_bytes', 'usage_pct']) {
        expect(data).toHaveProperty(f);
      }
      expect(Number.isInteger(data.data_avail_bytes)).toBe(true);
    } finally {
      rmSync(workDir, { recursive: true, force: true });
    }
  });

  it('cron 等价环境（显式 PATH，仅 /usr/bin:/bin）下仍能成功采样', async () => {
    const workDir = mkdtempSync(join(tmpdir(), 'sampler-cron-red-'));
    try {
      execSync(`env -i PATH=/usr/bin:/bin HOME="${process.env.HOME}" CECELIA_DEPLOY_ROOT="${workDir}" bash "${SAMPLER}"`, { stdio: 'pipe' });
      expect(existsSync(join(workDir, '.runtime', 'host-disk.json'))).toBe(true);
    } finally {
      rmSync(workDir, { recursive: true, force: true });
    }
  });

  it('脚本头部声明 set -euo pipefail', () => {
    const content = readFileSync(SAMPLER, 'utf8');
    expect(content).toMatch(/set -euo pipefail/);
  });

  // 这两条验的是 macOS 专用采样器的超时与锁语义：脚本依赖 diskutil / /System/Volumes/Data / APFS，
  // 且 BSD 与 GNU 的 stat 行为不同。在 ubuntu runner 上语义不成立，只在 darwin 跑。
  describe.runIf(process.platform === 'darwin')('macOS 采样器韧性', () => {
    // 2026-08-18：diskutil 挂死 5 小时，脚本外层的 flock -n 让后续每分钟的 cron 静默跳过，
    // 样本永久陈旧 → 容量闸 sample_stale → 所有 PR 的 Deploy Preview 必挂。
    // 采样命令必须有超时，卡住的探测要降级而不是把整台机器的容量判断拖死。
    it('diskutil 卡死时在超时内退出并仍写出样本（降级而非挂死）', () => {
      const workDir = mkdtempSync(join(tmpdir(), 'sampler-hang-'));
      const binDir = join(workDir, 'fakebin');
      mkdirSync(binDir, { recursive: true });
      // 真的挂住的 diskutil：不 mock 被测脚本，只让它依赖的外部命令卡住
      writeFileSync(join(binDir, 'diskutil'), '#!/bin/sh\nsleep 300\n', { mode: 0o755 });
      try {
        const startedAt = Date.now();
        const run = spawnSync('bash', [SAMPLER], {
          env: {
            ...process.env,
            CECELIA_DEPLOY_ROOT: workDir,
            // 脚本显式前置系统 PATH（防 cron PATH 事故），所以注入靠显式钩子而非 PATH 覆盖
            CECELIA_DISKUTIL_BIN: join(binDir, 'diskutil'),
            HOST_DISK_SAMPLE_TIMEOUT_SECONDS: '5',
          },
          encoding: 'utf8',
          timeout: 90_000,
        });
        const elapsedMs = Date.now() - startedAt;

        expect(run.status).toBe(0);
        expect(elapsedMs).toBeLessThan(60_000);
        // 卡住必须出声，否则又是一次"安静地不干活"
        expect(run.stderr).toMatch(/超时|timed out/i);

        const jsonPath = join(workDir, '.runtime', 'host-disk.json');
        expect(existsSync(jsonPath)).toBe(true);
        const data = JSON.parse(readFileSync(jsonPath, 'utf8'));
        // diskutil 拿不到 → 退化为 data_avail_bytes，采样整体仍然成立
        expect(Number.isInteger(data.effective_free_bytes)).toBe(true);
        expect(data.effective_free_bytes).toBeGreaterThan(0);
        expect(data.apfs_unallocated_bytes).toBe(data.data_avail_bytes);
      } finally {
        rmSync(workDir, { recursive: true, force: true });
      }
    });

    it('单飞在脚本内实现：并发时跳过要出声，且陈旧锁能自愈抢占', () => {
      const workDir = mkdtempSync(join(tmpdir(), 'sampler-lock-'));
      const lockDir = join(workDir, '.runtime', 'host-disk-sampler.lock');
      try {
        // ① 新鲜锁在场 → 跳过，但必须在 stderr 出声（静默跳过 = 故障隐身）
        mkdirSync(lockDir, { recursive: true });
        const skipped = spawnSync('bash', [SAMPLER], {
          env: { ...process.env, CECELIA_DEPLOY_ROOT: workDir },
          encoding: 'utf8',
        });
        expect(skipped.status).toBe(0);
        expect(skipped.stderr).toMatch(/仍在运行|still running/i);
        expect(existsSync(join(workDir, '.runtime', 'host-disk.json'))).toBe(false);

        // ② 陈旧锁（上一轮已被超时杀死却没来得及清锁）→ 必须抢占并完成采样，
        //    否则一次挂死就等于永久停摆。
        const stale = new Date(Date.now() - 3600_000);
        utimesSync(lockDir, stale, stale);
        const recovered = spawnSync('bash', [SAMPLER], {
          env: { ...process.env, CECELIA_DEPLOY_ROOT: workDir, HOST_DISK_LOCK_STALE_SECONDS: '120' },
          encoding: 'utf8',
        });
        expect(recovered.status).toBe(0);
        expect(recovered.stderr).toMatch(/陈旧|stale/i);
        expect(existsSync(join(workDir, '.runtime', 'host-disk.json'))).toBe(true);

        // 正常收尾必须把锁还回去，否则下一轮又被自己挡住
        expect(existsSync(lockDir)).toBe(false);
      } finally {
        rmSync(workDir, { recursive: true, force: true });
      }
    });
  });
});
