import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { isTransientClass } from '../lib/retry-policy.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const src = (p) => readFileSync(join(__dirname, '..', p), 'utf8');

describe('transient-class-sync：下游瞬态判定同步，被测模块 lib/retry-policy.js isTransientClass（防 5xx/timeout 被误计失败误隔离）', () => {
  it('isTransientClass 覆盖 callback-processor 语义（含 auth）', () => {
    expect(isTransientClass('server_error')).toBe(true);
    expect(isTransientClass('timeout')).toBe(true);
    expect(isTransientClass('auth')).toBe(true);
  });

  it('callback-processor.js 改用 isTransientClass，不再散落类别枚举', () => {
    const code = src('callback-processor.js');
    expect(code).toMatch(/isTransientClass/);
    expect(code).not.toMatch(/\['rate_limit',\s*'network',\s*'auth'\]\.includes/);
  });

  it('routes/execution.js 改用 isTransientClass', () => {
    const code = src('routes/execution.js');
    expect(code).toMatch(/isTransientClass/);
  });

  it('routes/task-error-report.js TTL_MAP 与 FAILURE_CLASS 常量补齐新类别', () => {
    const code = src('routes/task-error-report.js');
    expect(code).toMatch(/timeout:\s*\d/);
    expect(code).toMatch(/server_error:\s*\d/);
    expect(code).toMatch(/TIMEOUT:\s*'timeout'/);
    expect(code).toMatch(/SERVER_ERROR:\s*'server_error'/);
  });

  it('thalamus.js 重复分类表已标注不一致风险 TODO', () => {
    const code = src('thalamus.js');
    expect(code).toMatch(/TODO.*(retry-policy|quarantine).*不一致|TODO.*分类.*(retry-policy|quarantine)/);
  });
});
