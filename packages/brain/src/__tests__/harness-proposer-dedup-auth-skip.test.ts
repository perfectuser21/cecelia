/**
 * harness-proposer-dedup-auth-skip.test.ts
 * 验证两个行为：
 * auth/network/rate_limit 失败时传 skipCount=true，不累计 quarantine 计数
 */

import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const execSrc = fs.readFileSync(
  path.join(__dirname, '../routes/execution.js'),
  'utf8'
);
const quarantineSrc = fs.readFileSync(
  path.join(__dirname, '../quarantine.js'),
  'utf8'
);

describe('auth/network/rate_limit 失败不计 quarantine（Fix 2）', () => {
  it('quarantine.js handleTaskFailure 接受 skipCount 选项', () => {
    expect(quarantineSrc).toContain('skipCount');
    expect(quarantineSrc).toMatch(/handleTaskFailure\s*\(\s*taskId\s*,\s*(options|\{)/);
  });

  it('quarantine.js skipCount=true 时只 requeue，不累计失败次数', () => {
    expect(quarantineSrc).toContain('skipped_count: true');
  });

  it('execution.js 对 isTransientApiError 传 skipCount', () => {
    expect(execSrc).toContain('skipCount');
    expect(execSrc).toContain('isTransientApiError');
    expect(execSrc).toContain('skipCount = isTransientApiError');
  });

  it('execution.js 调 handleTaskFailure 时传入 skipCount', () => {
    expect(execSrc).toContain('handleTaskFailure(task_id, { skipCount })');
  });
});
