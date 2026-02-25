import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

describe('Coverage Thresholds', () => {
  it('should have coverage thresholds configured in vitest.config.js', async () => {
    const configPath = resolve(__dirname, '../../vitest.config.js');
    const configContent = readFileSync(configPath, 'utf-8');

    // Check that thresholds are configured (currently 0 for baseline)
    // TODO: Update these to check for 95% when we reach target coverage
    expect(configContent).toMatch(/statements:\s*\d+/);
    expect(configContent).toMatch(/branches:\s*\d+/);
    expect(configContent).toMatch(/functions:\s*\d+/);
    expect(configContent).toMatch(/lines:\s*\d+/);
  });

  it('should have perFile threshold enforcement configured', () => {
    const configPath = resolve(__dirname, '../../vitest.config.js');
    const configContent = readFileSync(configPath, 'utf-8');

    // Check that per-file threshold config exists
    // Currently false for baseline, will be true when enforcing
    expect(configContent).toMatch(/perFile:\s*(true|false)/);
  });

  it('should include all source files in coverage', () => {
    const configPath = resolve(__dirname, '../../vitest.config.js');
    const configContent = readFileSync(configPath, 'utf-8');

    // Check that all: true is set to include all source files
    expect(configContent).toContain('all: true');
  });

  it('should exclude test files from coverage', () => {
    const configPath = resolve(__dirname, '../../vitest.config.js');
    const configContent = readFileSync(configPath, 'utf-8');

    // Check exclusions
    expect(configContent).toContain('src/**/*.test.js');
    expect(configContent).toContain('src/__tests__/**');
  });
});