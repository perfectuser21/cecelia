import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const mig = resolve(__dirname, '../../migrations/305_staging_e2e_pr_url_unique.sql');

// 修正4：migration 305 在已合的 304 表上 ALTER 加 pr_url UNIQUE（DB 级幂等闸）。
// 不动已合 304（spec 决策 C：migration 只一份，新约束用新编号）。
describe('migration 305：staging_e2e_results.pr_url UNIQUE', () => {
  it('305 文件存在', () => {
    expect(existsSync(mig)).toBe(true);
  });
  it('对已有表做 ALTER + 加 pr_url UNIQUE 约束（不 CREATE TABLE）', () => {
    const c = readFileSync(mig, 'utf8');
    expect(c).not.toMatch(/CREATE TABLE/i);
    expect(c).toMatch(/staging_e2e_results/);
    expect(c).toMatch(/UNIQUE/i);
    expect(c).toMatch(/pr_url/);
  });
});
