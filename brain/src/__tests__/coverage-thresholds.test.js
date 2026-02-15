import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

describe('Coverage Thresholds', () => {
  it('should have 95% thresholds configured in vitest.config.js', async () => {
    const configPath = resolve(__dirname, '../../vitest.config.js');
    const configContent = readFileSync(configPath, 'utf-8');

    // Check that thresholds are set to 95
    expect(configContent).toContain('statements: 95');
    expect(configContent).toContain('branches: 95');
    expect(configContent).toContain('functions: 95');
    expect(configContent).toContain('lines: 95');
  });

  it('should have perFile threshold enforcement enabled', () => {
    const configPath = resolve(__dirname, '../../vitest.config.js');
    const configContent = readFileSync(configPath, 'utf-8');

    // Check that per-file thresholds are enabled
    expect(configContent).toContain('perFile: true');
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