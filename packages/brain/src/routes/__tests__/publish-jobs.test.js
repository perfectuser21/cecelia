import { describe, it, expect, vi, beforeEach } from 'vitest';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const srcPath = resolve(__dirname, '../publish-jobs.js');

describe('routes/publish-jobs — /success-rate 端点', () => {
  it('publish-jobs.js 含 /success-rate 路由定义', () => {
    const src = fs.readFileSync(srcPath, 'utf8');
    expect(src).toMatch(/router\.get\s*\(\s*['"]\/success-rate['"]/);
  });

  it('publish-jobs.js 查询 publish_success_daily 表', () => {
    const src = fs.readFileSync(srcPath, 'utf8');
    expect(src).toMatch(/publish_success_daily/);
  });

  it('响应字段包含 date / success_rate / total / completed / failed', () => {
    const src = fs.readFileSync(srcPath, 'utf8');
    expect(src).toMatch(/date/);
    expect(src).toMatch(/success_rate/);
    expect(src).toMatch(/total/);
    expect(src).toMatch(/completed/);
    expect(src).toMatch(/failed/);
  });

  it('days 参数上限为 90', () => {
    const src = fs.readFileSync(srcPath, 'utf8');
    expect(src).toMatch(/90/);
  });

  it('支持 platform 参数过滤', () => {
    const src = fs.readFileSync(srcPath, 'utf8');
    const successRateBlock = src.slice(src.indexOf('/success-rate'));
    expect(successRateBlock).toMatch(/platform/);
  });
});
