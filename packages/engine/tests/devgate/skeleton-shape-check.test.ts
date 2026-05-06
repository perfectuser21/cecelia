/**
 * skeleton-shape-check.test.ts — unit tests for skeleton-shape-check.cjs
 */
import { describe, it, expect } from 'vitest';
import { execSync } from 'child_process';
import { existsSync, mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { resolve } from 'path';

const SCRIPT = resolve(__dirname, '../../scripts/devgate/skeleton-shape-check.cjs');
const REPO_ROOT = resolve(__dirname, '../../../..');

describe('skeleton-shape-check', () => {
  it('SCRIPT 文件存在', () => {
    expect(existsSync(SCRIPT)).toBe(true);
  });

  it('exits 0 when no contract-dod-ws0.md changed (BASE_REF=HEAD)', () => {
    let output: string;
    try {
      output = execSync(`BASE_REF=HEAD node "${SCRIPT}"`, {
        cwd: REPO_ROOT,
        encoding: 'utf8',
      });
    } catch (e: any) {
      throw new Error(`Should exit 0 when no skeleton dod changed. Got: ${e.message}`);
    }
    expect(output).toContain('skeleton check skipped');
  });

  it('exits 1 when skeleton dod changed but test file has wrong pattern for user_facing journey', () => {
    // Create temp git repo simulating a sprint with wrong-pattern test
    const tmpRepo = mkdtempSync(join(tmpdir(), 'ssc-repo-'));
    execSync('git init', { cwd: tmpRepo });
    execSync('git config user.email "test@test.com"', { cwd: tmpRepo });
    execSync('git config user.name "Test"', { cwd: tmpRepo });
    execSync('git commit --allow-empty -m "init"', { cwd: tmpRepo });

    const sprintDir = join(tmpRepo, 'sprints', 'sprint-001');
    mkdirSync(sprintDir, { recursive: true });
    const dodContent = `---\nskeleton: true\njourney_type: user_facing\n---\n# DoD\n`;
    writeFileSync(join(sprintDir, 'contract-dod-ws0.md'), dodContent);
    const testDir = join(sprintDir, 'tests', 'ws0');
    mkdirSync(testDir, { recursive: true });
    // Wrong: no playwright/chromium/chrome-mcp
    writeFileSync(
      join(testDir, 'skeleton.test.ts'),
      `// wrong content — no playwright/chromium\ndescribe("x", () => { it("y", () => {}); });\n`
    );
    execSync('git add .', { cwd: tmpRepo });

    let exitCode = 0;
    try {
      execSync(`BASE_REF=HEAD node "${SCRIPT}"`, {
        cwd: tmpRepo,
        encoding: 'utf8',
      });
    } catch (e: any) {
      exitCode = e.status || 1;
    }
    expect(exitCode).toBe(1);

    rmSync(tmpRepo, { recursive: true });
  });

  it('exits 0 when skeleton dod changed and test file matches user_facing pattern', () => {
    const tmpRepo = mkdtempSync(join(tmpdir(), 'ssc-repo2-'));
    execSync('git init', { cwd: tmpRepo });
    execSync('git config user.email "test@test.com"', { cwd: tmpRepo });
    execSync('git config user.name "Test"', { cwd: tmpRepo });
    execSync('git commit --allow-empty -m "init"', { cwd: tmpRepo });

    const sprintDir = join(tmpRepo, 'sprints', 'sprint-001');
    mkdirSync(sprintDir, { recursive: true });
    const dodContent = `---\nskeleton: true\njourney_type: user_facing\n---\n# DoD\n`;
    writeFileSync(join(sprintDir, 'contract-dod-ws0.md'), dodContent);
    const testDir = join(sprintDir, 'tests', 'ws0');
    mkdirSync(testDir, { recursive: true });
    // Correct: contains playwright
    writeFileSync(
      join(testDir, 'skeleton.test.ts'),
      `import { chromium } from 'playwright';\ndescribe("x", () => { it("y", async () => {}); });\n`
    );
    execSync('git add .', { cwd: tmpRepo });

    try {
      execSync(`BASE_REF=HEAD node "${SCRIPT}"`, {
        cwd: tmpRepo,
        encoding: 'utf8',
      });
    } catch (e: any) {
      throw new Error(`Should exit 0 for correct user_facing pattern. Got: ${e.message}`);
    }

    rmSync(tmpRepo, { recursive: true });
  });
});
