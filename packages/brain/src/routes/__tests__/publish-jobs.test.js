import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(join(__dirname, '../publish-jobs.js'), 'utf8');

// 迁移 486：publish_success_daily 空表删除（写入方从未跑起来），/publish/success-rate 接口同 PR 删除。
describe('routes/publish-jobs — success-rate 已随 publish_success_daily 删除', () => {
  it('不再注册 /publish/success-rate', () => {
    expect(src).not.toMatch(/['"]\/publish\/success-rate['"]/);
  });
  it('不再查询 publish_success_daily', () => {
    expect(src).not.toMatch(/publish_success_daily/);
  });
});
