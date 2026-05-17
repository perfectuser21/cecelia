import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const CFG_PATH = resolve(__dirname, '../../packages/brain/vitest.config.js');

describe('packages/brain/vitest.config.js', () => {
  it('must not contain coverage thresholds (diff-cover is the sole gate)', () => {
    const content = readFileSync(CFG_PATH, 'utf8');
    expect(content).not.toMatch(/thresholds:\s*\{/);
  });

  it('still defines coverage block with v8 provider', () => {
    const content = readFileSync(CFG_PATH, 'utf8');
    expect(content).toMatch(/coverage:\s*\{/);
    expect(content).toMatch(/provider:\s*'v8'/);
  });
});
