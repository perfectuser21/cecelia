// host-disk-sampler.test.js [BEHAVIOR] — 模块1 宿主磁盘采样器
// TDD Red 证据用（vitest）。evaluator 真正验收走 contract-dod.md 的 manual:bash 命令，
// 本文件不被 evaluator 当 oracle 读取，但必须真跑真失败（禁 mock 被测边：真 bash 脚本 + 真文件系统）。
import { describe, it, expect } from 'vitest';
import { execSync } from 'child_process';
import { existsSync, readFileSync, mkdtempSync, rmSync } from 'fs';
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
});
