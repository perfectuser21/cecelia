/**
 * self-drive getTaskStats24h 成功率计算测试
 *
 * 验证：
 * 1. total 使用终态统计（completed+failed+quarantined），不含 canceled
 * 2. failed 包含 quarantined（不只是 failed 状态）
 * 3. completed 使用 completed_at 过滤（时间精度更准）
 * 4. canceled 任务不计入 total（不拖低成功率）
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const src = readFileSync(join(__dirname, '../self-drive.js'), 'utf8');

describe('getTaskStats24h 成功率计算', () => {
  it('total 使用终态统计（completed+failed+quarantined），排除 canceled', () => {
    expect(src).toMatch(/status IN \('completed', 'failed', 'quarantined'\)/);
  });

  it('failed 计数包含 quarantined 状态', () => {
    expect(src).toMatch(/status IN \('failed', 'quarantined'\)/);
  });

  it('total 不再是 count\(\*\) 全量统计', () => {
    // 不应有 "count(*) as total" 这种全量统计（那会把 canceled 算进去）
    expect(src).not.toMatch(/count\(\*\)\s+as\s+total/);
  });

  it('completed 使用 completed_at 时间过滤（更精准的 24h 窗口）', () => {
    expect(src).toContain('completed_at > NOW() - INTERVAL');
  });
});
