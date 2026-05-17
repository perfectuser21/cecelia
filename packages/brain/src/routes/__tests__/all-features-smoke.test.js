import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));

describe('all-features-smoke.sh', () => {
  it('脚本文件存在且含关键逻辑', () => {
    const scriptPath = join(__dirname, '../../../scripts/smoke/all-features-smoke.sh');
    const content = readFileSync(scriptPath, 'utf8');
    expect(content).toContain('/api/brain/features');
    expect(content).toContain('smoke_cmd');
    expect(content).toContain('smoke_status');
    expect(content).toContain('set -uo pipefail');
    expect(content).toContain('exit 1');
  });
});
