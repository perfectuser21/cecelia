import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

const smokeUrl = new URL(
  '../../../packages/brain/scripts/smoke/harness-control-plane-complete-repair-smoke.sh',
  import.meta.url,
);

describe('control-plane repair smoke runtime version report [BEHAVIOR]', () => {
  it('拒绝最终 PASS 中硬编码版本字面量', async () => {
    const source = await readFile(smokeUrl, 'utf8');
    const passLine = source.split('\n').find((line) => line.includes('PASS: Brain')) ?? '';

    expect(passLine).not.toMatch(/Brain\s+\d+\.\d+\.\d+\s+schema/);
  });

  it('最终 PASS 上报 API 返回的确切运行时版本', async () => {
    const source = await readFile(smokeUrl, 'utf8');

    expect(source).toMatch(/VERSION_JSON=.*\/api\/brain\/version/);
    expect(source).toMatch(/RUNTIME_VERSION=.*VERSION_JSON/);
    expect(source).toMatch(/PASS: Brain \$\{?RUNTIME_VERSION\}? schema 430/);
  });
});
