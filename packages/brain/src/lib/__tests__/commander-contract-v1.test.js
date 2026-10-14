import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

describe('commander-contract-v1真实来源', () => {
it('固定共享JSON信封进入实际源码依赖图，修改样例可追到消费它的夹具', () => {
  const root = fileURLToPath(new URL('../../../../../', import.meta.url));
  const fixture = 'packages/brain/src/lib/__tests__/fixtures/commander-contract-v1.js';
  const json = 'packages/brain/src/lib/__tests__/fixtures/commander-contract-v1.json';
  const script = `import { SourceTextModule } from 'node:vm';
    import { readFileSync } from 'node:fs';
    const source = new SourceTextModule(readFileSync(${JSON.stringify(fixture)}, 'utf8'));
    process.stdout.write(JSON.stringify(source.dependencySpecifiers));`;
  const dependencies = JSON.parse(execFileSync(process.execPath, ['--experimental-vm-modules', '--input-type=module', '-e', script], {
    cwd: root, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024, timeout: 30000,
    stdio: ['ignore', 'pipe', 'pipe'],
  }));
  expect(dependencies).toContain('./' + json.split('/').at(-1));
});
});
