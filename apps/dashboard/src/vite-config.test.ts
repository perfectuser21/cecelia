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

describe('Dashboard 客户端缓存版本', () => {
  it('每次构建都把 Git SHA 注入启动代码，禁止继续使用固定日期版本', () => {
    const config = readFileSync(resolve(__dirname, '../vite.config.ts'), 'utf-8');
    const main = readFileSync(resolve(__dirname, './main.tsx'), 'utf-8');
    const viteEnv = readFileSync(resolve(__dirname, './vite-env.d.ts'), 'utf-8');

    expect(config).toContain('__APP_VERSION__');
    expect(config).toContain('JSON.stringify(buildSha)');
    expect(main).toContain('const APP_VERSION = __APP_VERSION__');
    expect(main).not.toContain("const APP_VERSION = '2026-05-21-v2'");
    expect(viteEnv).toContain('declare const __APP_VERSION__: string');
  });

  it('每次启动都主动检查 Service Worker 更新，不受浏览器默认检查周期限制', () => {
    const main = readFileSync(resolve(__dirname, './main.tsx'), 'utf-8');
    const lifecycle = readFileSync(resolve(__dirname, './cache-lifecycle.ts'), 'utf-8');

    expect(lifecycle).toContain('registration.update()');
    expect(main).toContain('await refreshServiceWorkers(serviceWorkers)');
  });
});
