import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SRC = resolve(__dirname, '../harness-task.graph.js');

describe('Layer 3 spawnNode credentials [BEHAVIOR]', () => {
  const code = readFileSync(SRC, 'utf8');

  it('spawnNode 调 resolveAccount 注入 CECELIA_CREDENTIALS', () => {
    expect(code).toContain('resolveAccount(acctOpts');
  });

  it('import resolveAccount from account-rotation', () => {
    expect(code).toMatch(/import.*resolveAccount.*account-rotation/);
  });

  it('spawn env spread accountEnv (含 CECELIA_CREDENTIALS)', () => {
    expect(code).toContain('...accountEnv,');
  });
});
