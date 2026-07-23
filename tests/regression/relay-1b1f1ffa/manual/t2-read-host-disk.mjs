// t2-read-host-disk.mjs — 模块2 readHostDisk() 4 种拒绝分支 + 1 种有效样本
// 用法: node t2-read-host-disk.mjs missing|corrupt|stale|incomplete|valid
import { writeFileSync, mkdtempSync, rmSync, mkdirSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { REPO_ROOT, GIB, fail, ok } from './_lib.mjs';

const mode = process.argv[2];
const workDir = mkdtempSync(join(tmpdir(), 'read-host-disk-'));
const runtimeDir = join(workDir, '.runtime');
mkdirSync(runtimeDir, { recursive: true });
const jsonPath = join(runtimeDir, 'host-disk.json');

function validSample(overrides = {}) {
  return {
    sampled_at_epoch: Math.floor(Date.now() / 1000),
    data_avail_bytes: 40 * GIB,
    apfs_unallocated_bytes: 42 * GIB,
    effective_free_bytes: 40 * GIB,
    usage_pct: 70,
    ...overrides,
  };
}

try {
  const { readHostDisk } = await import(`${REPO_ROOT}/packages/brain/src/capacity-gate.js`);

  if (mode === 'missing') {
    // 文件不存在（不写入 jsonPath）
    const r = await readHostDisk(jsonPath);
    if (r.ok !== false) fail(`missing 场景应 ok:false，实际 ${JSON.stringify(r)}`);
    if (r.reason !== 'sample_missing') fail(`missing 场景 reason 应为 sample_missing，实际 ${r.reason}`);
    ok('read-host-disk-missing');
  } else if (mode === 'corrupt') {
    writeFileSync(jsonPath, '{not valid json,,,');
    const r = await readHostDisk(jsonPath);
    if (r.ok !== false) fail(`corrupt 场景应 ok:false，实际 ${JSON.stringify(r)}`);
    if (r.reason !== 'sample_corrupt') fail(`corrupt 场景 reason 应为 sample_corrupt，实际 ${r.reason}`);
    ok('read-host-disk-corrupt');
  } else if (mode === 'stale') {
    const staleEpoch = Math.floor(Date.now() / 1000) - 300; // 300s > 180s 阈值
    writeFileSync(jsonPath, JSON.stringify(validSample({ sampled_at_epoch: staleEpoch })));
    const r = await readHostDisk(jsonPath);
    if (r.ok !== false) fail(`stale 场景应 ok:false，实际 ${JSON.stringify(r)}`);
    if (r.reason !== 'sample_stale') fail(`stale 场景 reason 应为 sample_stale，实际 ${r.reason}`);
    ok('read-host-disk-stale');
  } else if (mode === 'incomplete') {
    const s = validSample();
    delete s.effective_free_bytes;
    writeFileSync(jsonPath, JSON.stringify(s));
    const r = await readHostDisk(jsonPath);
    if (r.ok !== false) fail(`incomplete 场景应 ok:false，实际 ${JSON.stringify(r)}`);
    if (r.reason !== 'sample_incomplete') fail(`incomplete 场景 reason 应为 sample_incomplete，实际 ${r.reason}`);
    ok('read-host-disk-incomplete');
  } else if (mode === 'valid') {
    writeFileSync(jsonPath, JSON.stringify(validSample()));
    const r = await readHostDisk(jsonPath);
    if (r.ok !== true) fail(`valid 场景应 ok:true，实际 ${JSON.stringify(r)}`);
    if (typeof r.data?.effective_free_bytes !== 'number') fail('valid 场景 data.effective_free_bytes 缺失');
    ok('read-host-disk-valid');
  } else {
    fail(`未知 mode: ${mode}`);
  }
} catch (err) {
  fail(`执行异常: ${err.message}`);
} finally {
  rmSync(workDir, { recursive: true, force: true });
}
