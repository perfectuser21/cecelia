import { it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

it('固定共享JSON信封进入实际源码依赖图，修改样例可追到消费它的夹具', () => {
  const root = fileURLToPath(new URL('../../../../../', import.meta.url));
  const fixture = 'packages/brain/src/lib/__tests__/fixtures/commander-contract-v1.js';
  const json = 'packages/brain/src/lib/__tests__/fixtures/commander-contract-v1.json';
  const script = `import { cruise } from 'dependency-cruiser';
    const result = await cruise([${JSON.stringify(fixture)}], {
      baseDir: process.cwd(), doNotFollow: { path: 'node_modules' }, exclude: { path: 'node_modules' },
    });
    process.stdout.write(typeof result.output === 'string' ? result.output : JSON.stringify(result.output));`;
  const graph = JSON.parse(execFileSync(process.execPath, ['--input-type=module', '-e', script], {
    cwd: root, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024, timeout: 30000,
  }));
  const consumer = graph.modules.find(module => module.source.endsWith(fixture));
  expect(consumer).toBeDefined();
  expect(consumer.dependencies.some(dependency => dependency.resolved?.endsWith(json))).toBe(true);
});
