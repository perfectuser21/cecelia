import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

describe('Coverage Reporters', () => {
  it('should have multiple reporters configured', () => {
    const configPath = resolve(__dirname, '../../vitest.config.js');
    const configContent = readFileSync(configPath, 'utf-8');

    // Check that all required reporters are configured
    expect(configContent).toContain("'text'");
    expect(configContent).toContain("'lcov'");
    expect(configContent).toContain("'html'");
    expect(configContent).toContain("'json'");
  });

  it('should output to ./coverage directory', () => {
    const configPath = resolve(__dirname, '../../vitest.config.js');
    const configContent = readFileSync(configPath, 'utf-8');

    // Check coverage output directory
    expect(configContent).toContain("reportsDirectory: './coverage'");
  });

  it('should have v8 as coverage provider', () => {
    const configPath = resolve(__dirname, '../../vitest.config.js');
    const configContent = readFileSync(configPath, 'utf-8');

    // Check coverage provider
    expect(configContent).toContain("provider: 'v8'");
  });

  it('should have clean coverage enabled', () => {
    const configPath = resolve(__dirname, '../../vitest.config.js');
    const configContent = readFileSync(configPath, 'utf-8');

    // Check that clean: true is set
    expect(configContent).toContain('clean: true');
  });

  it('should have reportOnFailure enabled', () => {
    const configPath = resolve(__dirname, '../../vitest.config.js');
    const configContent = readFileSync(configPath, 'utf-8');

    // Check that reportOnFailure is enabled
    expect(configContent).toContain('reportOnFailure: true');
  });
});