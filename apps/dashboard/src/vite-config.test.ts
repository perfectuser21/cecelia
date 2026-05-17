import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

describe('vite.config.ts 端口约定', () => {
  it('server.port 应为 5211', () => {
    const config = readFileSync(resolve(__dirname, '../vite.config.ts'), 'utf-8');
    expect(config).toContain('port: 5211');
  });

  it('不应含旧端口 5212', () => {
    const config = readFileSync(resolve(__dirname, '../vite.config.ts'), 'utf-8');
    expect(config).not.toContain('port: 5212');
  });
});
