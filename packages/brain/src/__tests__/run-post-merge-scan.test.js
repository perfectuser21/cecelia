import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'fs';
import { resolve } from 'path';

const SCRIPT = resolve(process.cwd(), '../../scripts/run-post-merge-scan.sh');

describe('run-post-merge-scan.sh', () => {
  it('脚本文件存在', () => {
    expect(existsSync(SCRIPT)).toBe(true);
  });

  it('包含 4 个 scan 调用', () => {
    const content = readFileSync(SCRIPT, 'utf8');
    expect(content).toContain('scan-api-registry.js');
    expect(content).toContain('scan-db-schema.js');
    expect(content).toContain('scan-test-registry.js');
    expect(content).toContain('scan-skills.js');
  });
});
