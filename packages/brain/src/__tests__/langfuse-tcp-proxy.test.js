/**
 * langfuse-tcp-proxy.test.js
 * 静态检查 frontend-proxy.js 含 TCP tunnel 逻辑
 * 静态检查 TracesPage.tsx 含 window.location.hostname 替换逻辑
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join, resolve } from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const repoRoot = resolve(__dirname, '../../../..');

const proxySrc = readFileSync(join(repoRoot, 'frontend-proxy.js'), 'utf8');
const tracesSrc = readFileSync(
  join(repoRoot, 'apps/api/features/system/pages/TracesPage.tsx'),
  'utf8'
);

describe('frontend-proxy.js: Langfuse TCP tunnel', () => {
  it('包含 net.createServer（TCP tunnel）', () => {
    expect(proxySrc).toContain('net.createServer');
  });

  it('监听 3001 端口', () => {
    expect(proxySrc).toContain('3001');
  });

  it('透传到 100.86.118.99', () => {
    expect(proxySrc).toContain('100.86.118.99');
  });
});

describe('TracesPage.tsx: langfuseUrl 替换为本机代理', () => {
  it('使用 window.location.hostname 构造链接', () => {
    expect(tracesSrc).toContain('window.location.hostname');
  });

  it('链接端口改为 3001', () => {
    expect(tracesSrc).toContain(':3001');
  });
});
