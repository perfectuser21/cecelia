import { describe, it, expect, afterEach } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { runInNewContext } from 'node:vm';
import { transpileModule, ModuleKind } from 'typescript';
import { dirname, join, resolve } from 'node:path';

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

// 只在隔离目录布置包元数据/入口，真实执行配置里的解析逻辑；不改共享 node_modules。
describe('Vitest 在真实 npm 安装布局下解析 Dashboard 依赖', () => {
  const fixtures: string[] = [];
  afterEach(() => fixtures.splice(0).forEach(directory => rmSync(directory, { recursive: true, force: true })));

  function installPackage(nodeModules: string, name: string, version: string, entry: string) {
    const directory = join(nodeModules, name);
    mkdirSync(dirname(join(directory, entry)), { recursive: true });
    writeFileSync(join(directory, 'package.json'), JSON.stringify({ name, version, main: entry }));
    writeFileSync(join(directory, entry), 'export {};');
    return directory;
  }

  function readConfig(dashboard: string) {
    const filename = join(dashboard, 'vitest.config.cjs');
    const fixtureRequire = createRequire(filename);
    const module = { exports: {} };
    const source = readFileSync(resolve(__dirname, '../vitest.config.ts'), 'utf8');
    const compiled = transpileModule(source, { compilerOptions: { module: ModuleKind.CommonJS, esModuleInterop: true } }).outputText;
    runInNewContext(compiled, {
      __dirname: dashboard, __filename: filename, module, exports: module.exports,
      require: (specifier: string) => {
        if (specifier === 'vitest/config') return { defineConfig: (config: unknown) => config };
        if (specifier === '@vitejs/plugin-react') return () => ({ name: 'react-fixture' });
        return fixtureRequire(specifier);
      },
    }, { filename });
    return (module.exports as { default: { resolve: { alias: Record<string, string>; dedupe: string[] } } }).default;
  }

  it.each(['根目录提升', 'workspace独立安装', 'Router位于DOM包内'] as const)('%s仍使用同一套Dashboard依赖', layout => {
    const root = realpathSync(mkdtempSync(join(tmpdir(), 'dashboard-vitest-layout-')));
    fixtures.push(root);
    const dashboard = join(root, 'apps/dashboard');
    const dashboardModules = join(dashboard, 'node_modules');
    const rootModules = join(root, 'node_modules');
    // 根目录其他 workspace 的 React 19 不应污染 Dashboard React 18。
    installPackage(rootModules, 'react', '19.2.4', 'index.js');
    installPackage(rootModules, 'react-dom', '19.2.4', 'index.js');
    const react = installPackage(dashboardModules, 'react', '18.3.1', 'index.js');
    const reactDom = installPackage(dashboardModules, 'react-dom', '18.3.1', 'index.js');
    const routerDom = installPackage(dashboardModules, 'react-router-dom', '6.30.6', 'dist/index.js');
    const routerModules = layout === '根目录提升' ? rootModules
      : layout === 'workspace独立安装' ? dashboardModules : join(routerDom, 'node_modules');
    if (layout !== '根目录提升') installPackage(rootModules, 'react-router', '7.13.0', 'dist/index.js');
    const router = installPackage(routerModules, 'react-router', '6.30.6', 'dist/index.js');
    // CI 的 npm ci 可只在 Dashboard 本地安装图标包，根目录没有这个文件。
    const lucide = installPackage(layout === '根目录提升' ? rootModules : dashboardModules,
      'lucide-react', '0.294.0', 'dist/esm/lucide-react.js');
    const config = readConfig(dashboard);
    const expected = {
      react, 'react-dom': reactDom,
      'react-router-dom': join(routerDom, 'dist/index.js'),
      'react-router': join(router, 'dist/index.js'),
      'lucide-react': join(lucide, 'dist/esm/lucide-react.js'),
    };
    for (const [dependency, target] of Object.entries(expected)) {
      expect.soft(config.resolve.alias[dependency], `${dependency} 必须跟随 Dashboard 的实际依赖树`).toBe(target);
      expect.soft(existsSync(config.resolve.alias[dependency]), `${dependency} 的入口必须存在`).toBe(true);
    }
    expect(config.resolve.dedupe).toEqual(expect.arrayContaining(['react', 'react-dom', 'react-router-dom']));
  });
});
