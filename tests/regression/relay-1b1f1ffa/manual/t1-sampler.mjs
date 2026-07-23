// t1-sampler.mjs — 模块1 宿主磁盘采样器：原子写 JSON + 字段完整 + cron 等价环境（显式 PATH）
// 用法: node t1-sampler.mjs atomic-write | node t1-sampler.mjs cron-path
import { execSync } from 'child_process';
import { readFileSync, existsSync, mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { REPO_ROOT, GIB, fail, ok } from './_lib.mjs';

const mode = process.argv[2];
const SAMPLER = join(REPO_ROOT, 'scripts/host-disk-sampler.sh');

if (!existsSync(SAMPLER)) fail(`${SAMPLER} 不存在`);

const workDir = mkdtempSync(join(tmpdir(), 'host-disk-sampler-'));
const jsonPath = join(workDir, '.runtime', 'host-disk.json');

try {
  if (mode === 'atomic-write') {
    // 正常 PATH 下运行，验证原子写 + 字段完整 + 字节级(非字符串)数值
    execSync(`bash "${SAMPLER}"`, {
      env: { ...process.env, CECELIA_DEPLOY_ROOT: workDir },
      stdio: 'pipe',
    });
    if (!existsSync(jsonPath)) fail(`${jsonPath} 未生成`);
    // 原子写验证：不应残留 .tmp 中间文件
    const tmpLeftover = execSync(`ls "${join(workDir, '.runtime')}" | grep -c '\\.tmp' || true`).toString().trim();
    if (tmpLeftover !== '0') fail(`残留 .tmp 中间文件，原子写(写临时文件+mv)未正确清理: ${tmpLeftover} 个`);

    const data = JSON.parse(readFileSync(jsonPath, 'utf8'));
    const requiredFields = ['sampled_at_epoch', 'data_avail_bytes', 'apfs_unallocated_bytes', 'effective_free_bytes', 'usage_pct'];
    for (const f of requiredFields) {
      if (!(f in data)) fail(`JSON 缺字段 ${f}`);
    }
    if (!Number.isInteger(data.sampled_at_epoch)) fail('sampled_at_epoch 不是整数');
    if (!Number.isInteger(data.data_avail_bytes)) fail('data_avail_bytes 不是整数（禁止 GB/GiB 字符串）');
    if (!Number.isInteger(data.apfs_unallocated_bytes)) fail('apfs_unallocated_bytes 不是整数（禁止 GB/GiB 字符串）');
    if (!Number.isInteger(data.effective_free_bytes)) fail('effective_free_bytes 不是整数');
    if (typeof data.usage_pct !== 'number') fail('usage_pct 不是数字');
    if (data.effective_free_bytes !== Math.min(data.data_avail_bytes, data.apfs_unallocated_bytes)) {
      fail('effective_free_bytes != min(data_avail_bytes, apfs_unallocated_bytes)');
    }
    const nowEpoch = Math.floor(Date.now() / 1000);
    if (Math.abs(nowEpoch - data.sampled_at_epoch) > 30) fail('sampled_at_epoch 与当前时间偏差 > 30s，采样时间戳可疑');
    ok('sampler-atomic-write');
  } else if (mode === 'cron-path') {
    // cron 等价环境：仅 /usr/bin:/bin，验证脚本显式 PATH 覆盖后仍能找到 df/diskutil/mv
    execSync(`env -i PATH=/usr/bin:/bin HOME="${process.env.HOME}" CECELIA_DEPLOY_ROOT="${workDir}" bash "${SAMPLER}"`, {
      stdio: 'pipe',
    });
    if (!existsSync(jsonPath)) fail(`cron 等价环境(PATH=/usr/bin:/bin)下未生成 ${jsonPath} — 显式 PATH 未生效`);
    ok('sampler-cron-path');
  } else {
    fail(`未知 mode: ${mode}`);
  }
} catch (err) {
  fail(`执行异常: ${err.message}\n${err.stderr?.toString() || ''}`);
} finally {
  rmSync(workDir, { recursive: true, force: true });
}
