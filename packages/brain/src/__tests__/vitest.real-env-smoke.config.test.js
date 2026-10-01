import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import unit from '../../vitest.config.js';
import integration from '../../vitest.integration.config.js';

const configUrl = new URL('../../vitest.real-env-smoke.config.js', import.meta.url);
const positivePath = 'src/__tests__/real-env/map-manifest-smoke.real-env.test.js';
describe('真实 Map Manifest smoke 的 CI 执行归属', () => {
  it('完整真实PG正例有独立配置且只有一个明确owner', async () => {
    expect(existsSync(configUrl), '真实PG正例不能仅排除或条件skip').toBe(true);
    const { default: config } = await import(fileURLToPath(configUrl));
    expect(config.test.include).toEqual([positivePath]);
    expect(config.test.exclude).not.toContain('src/__tests__/real-env/**');
    const positive = readFileSync(new URL('real-env/map-manifest-smoke.real-env.test.js', import.meta.url), 'utf8');
    expect(positive).toContain("expect.stringContaining('ALL PASS')");
    expect(positive).toContain('timeout: 30_000');
    expect(positive).not.toMatch(/skipIf|describe\.skip|it\.skip/);
  });
  it('普通unit/PG集成不执行已授权正例，但PG集成仍保留默认安全拒写验收', () => {
    expect(unit.test.exclude).toContain('src/__tests__/real-env/**');
    expect(integration.test.exclude).toContain('src/__tests__/real-env/**');
    expect(integration.test.exclude).not.toContain('src/__tests__/integration/**');
    const negative = readFileSync(new URL('integration/map-manifest-smoke.integration.test.js', import.meta.url), 'utf8');
    expect(negative).toContain('SMOKE_ALLOW_WRITE');
    expect(negative).toContain('existsSync(marker)');
  });
  it('专属容器job明确接线真实PG正例及严格授权/身份，不给普通PG job授权', () => {
    const workflow = readFileSync(new URL('../../../../.github/workflows/ci.yml', import.meta.url), 'utf8');
    const real = workflow.slice(workflow.indexOf('\n  real-env-smoke:'));
    expect(real).toMatch(/Map Manifest real PG positive[\s\S]*SMOKE_ALLOW_WRITE: '1'[\s\S]*BRAIN_CONTAINER: cecelia-brain-smoke[\s\S]*--config vitest\.real-env-smoke\.config\.js/);
    expect(real).toContain('POSTGRES_DB: cecelia_test');
    expect(real).toContain('-e DB_NAME=cecelia_test');
    const pg = workflow.slice(workflow.indexOf('\n  brain-integration:'), workflow.indexOf('\n  brain-e2e:'));
    expect(pg).not.toContain('SMOKE_ALLOW_WRITE');
    expect(workflow.match(/--config vitest\.real-env-smoke\.config\.js/g)).toHaveLength(1);
  });
});
