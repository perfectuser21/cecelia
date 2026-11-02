import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import yaml from 'js-yaml';

const referenceCatalogs = [
  'ci/routing-map.yml',
  'ci/test-taxonomy.yml',
  'docs/registry/features/decision.yml',
  'docs/registry/features/engine.yml',
  'docs/registry/features/memory.yml',
  'docs/registry/features/orchestration.yml',
  'docs/registry/features/task.yml',
  'docs/registry/test-registry.yml',
  'packages/engine/regression-contract.yaml',
  'packages/quality/contracts/cecelia-quality.regression-contract.yaml',
  'packages/quality/control-plane/repo-registry.yaml',
  'packages/quality/regression-contract.yaml',
  'test-registry.yaml',
];

for (const path of referenceCatalogs) {
  test(`本轮维护目录可真实解析且包含数据：${path}`, () => {
    const content = readFileSync(new URL(`../../../${path}`, import.meta.url), 'utf8');
    const document = yaml.load(content, { schema: yaml.JSON_SCHEMA });
    assert.ok(document !== null && typeof document === 'object' && !Array.isArray(document));
    assert.ok(Object.keys(document).length > 0, `${path} 不能是空对象`);
  });
}
