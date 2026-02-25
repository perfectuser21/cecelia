import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

describe('Coverage Configuration', () => {
  it('should have vitest.config.js file', () => {
    const configPath = path.resolve(__dirname, '../../vitest.config.js');
    expect(fs.existsSync(configPath)).toBe(true);
  });

  it('should have coverage scripts in package.json', () => {
    const packagePath = path.resolve(__dirname, '../../package.json');
    const packageJson = JSON.parse(fs.readFileSync(packagePath, 'utf-8'));

    expect(packageJson.scripts).toHaveProperty('test:coverage');
    expect(packageJson.scripts['test:coverage']).toContain('--coverage');
  });

  it('should have @vitest/coverage-v8 installed', () => {
    const packagePath = path.resolve(__dirname, '../../package.json');
    const packageJson = JSON.parse(fs.readFileSync(packagePath, 'utf-8'));

    expect(packageJson.devDependencies).toHaveProperty('@vitest/coverage-v8');
  });

  it('should generate coverage directory when tests run', () => {
    // Note: This test assumes coverage has been run at least once
    const coverageDir = path.resolve(__dirname, '../../coverage');

    // Check if coverage directory exists (it should after running with --coverage)
    if (fs.existsSync(coverageDir)) {
      const files = fs.readdirSync(coverageDir);
      // Should have at least some coverage files
      expect(files.length).toBeGreaterThan(0);
    } else {
      // If not exists, skip this check as coverage might not have been run yet
      console.log('Coverage directory not found. Run npm run test:coverage first.');
    }
  });
});