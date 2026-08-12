import { describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';

describe('capture atoms routing', () => {
  it('uses the real decisions schema and unified routing boundary', async () => {
    const source = await readFile(new URL('../capture-atoms.js', import.meta.url), 'utf8');
    expect(source).not.toMatch(/INSERT INTO decisions\s*\([^)]*title/i);
    expect(source).toContain('createRoutedTask');
  });
});
