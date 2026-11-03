import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const vitest = join(dirname(require.resolve('vitest/package.json')), 'vitest.mjs');
const root = fileURLToPath(new URL('../', import.meta.url));

const safety = await import('./helpers/mcp-pg-fixture.js').catch(error => {
  if (error.code !== 'ERR_MODULE_NOT_FOUND' && !error.message.includes('Failed to load url')) throw error;
  return {};
});

describe('MCP PG fixture 准入发生在任何连接或DDL之前', () => {
  it('只接收显式loopback、专属mcp_ci数据库，正常化后保留实际身份', () => {
    expect(typeof safety.validateMcpPgFixtureTarget, '需要真实fixture准入函数').toBe('function');
    expect(safety.validateMcpPgFixtureTarget('postgresql://ci@127.0.0.1:5544/cecelia_mcp_ci_owned'))
      .toMatchObject({ database: 'cecelia_mcp_ci_owned', port: 5544 });
  });

  for (const target of [undefined, '', 'postgresql://ci@127.0.0.1:5544/cecelia',
    'postgresql://ci@127.0.0.1:5544/cecelia_test', 'postgresql://ci@127.0.0.1:5544/cecelia_scratch',
    'postgresql://ci@production.example:5544/cecelia_mcp_ci_owned',
    'postgresql://ci@127.0.0.1:5544/cecelia_mcp_ci_owned?host=production.example']) {
    it(`拒绝非自有目标：${target ?? '未配置'}`, () => {
      expect(typeof safety.validateMcpPgFixtureTarget).toBe('function');
      expect(() => safety.validateMcpPgFixtureTarget(target)).toThrow(/MCP_PG_FIXTURE_TARGET_REJECTED/);
    });
  }

  it('URL合法但服务器读回数据库/地址/端口不同仍拒绝', () => {
    expect(typeof safety.assertMcpPgFixtureIdentity).toBe('function');
    const expected = { database: 'cecelia_mcp_ci_owned', port: 5544 };
    const good = { database: expected.database, address: '127.0.0.1', port: 5544 };
    expect(() => safety.assertMcpPgFixtureIdentity(good, expected)).not.toThrow();
    for (const bad of [{ ...good, database: 'cecelia' }, { ...good, address: '10.0.0.1' }, { ...good, port: 5432 }])
      expect(() => safety.assertMcpPgFixtureIdentity(bad, expected)).toThrow(/MCP_PG_FIXTURE_IDENTITY_MISMATCH/);
  });

  it('容器NAT只接收显式绑定的本人service私网地址，不能放宽任意远端', () => {
    const url = 'postgresql://ci@127.0.0.1:5544/cecelia_mcp_ci_owned';
    const target = safety.validateMcpPgFixtureTarget(url, '172.18.0.2');
    expect(target.serverAddress).toBe('172.18.0.2');
    expect(() => safety.assertMcpPgFixtureIdentity({ database: target.database, address: '172.18.0.2', port: 5544 }, target)).not.toThrow();
    expect(() => safety.assertMcpPgFixtureIdentity({ database: target.database, address: '172.18.0.3', port: 5544 }, target)).toThrow();
    expect(() => safety.validateMcpPgFixtureTarget(url, '8.8.8.8')).toThrow(/MCP_PG_FIXTURE_TARGET_REJECTED/);
  });

  it('默认unit收集器不接收PG文件，PG必须由明确入口执行', () => {
    const result = spawnSync(process.execPath, [vitest, 'list', '--filesOnly', '--json'], {
      cwd: root, encoding: 'utf8', env: { PATH: process.env.PATH, HOME: process.env.HOME, NODE_ENV: 'test' },
    });
    expect(result.status, result.stderr).toBe(0);
    const files = JSON.parse(result.stdout).map(row => row.file.replaceAll('\\', '/'));
    expect(files.some(path => path.endsWith('/__tests__/tools.test.js'))).toBe(true);
    expect(files.some(path => path.endsWith('/__tests__/integration/tools.pg.test.js'))).toBe(false);
  });
});
