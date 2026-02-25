import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { readFileSync, writeFileSync, unlinkSync, mkdirSync } from 'fs';
import { join } from 'path';
import { execSync } from 'child_process';

describe('L2A Check - P1-1 Structure Validation', () => {
  const scriptPath = join(__dirname, '../../scripts/devgate/l2a-check.sh');
  const testDir = join(__dirname, '../../.test-tmp');

  beforeEach(() => {
    // Create test directory
    try {
      mkdirSync(testDir, { recursive: true });
    } catch {
      // Ignore if exists
    }
  });

  afterEach(() => {
    // Cleanup
    try {
      unlinkSync(join(testDir, 'test-prd.md'));
      unlinkSync(join(testDir, 'test-dod.md'));
    } catch {
      // Ignore cleanup errors
    }
  });

  describe('PRD Structure Validation', () => {
    it('C12-001: PRD 必须有至少 3 个 section', () => {
      const content = readFileSync(scriptPath, 'utf8');

      // 验证包含 section 计数逻辑
      expect(content).toContain('SECTION_COUNT');
      expect(content).toContain('grep -c "^## "');
      expect(content).toMatch(/SECTION_COUNT.*-lt 3/);
    });

    it('C12-001: PRD 每个 section 至少 2 行非空内容', () => {
      const content = readFileSync(scriptPath, 'utf8');

      // 验证包含内容行数检查
      expect(content).toContain('CONTENT_LINES');
      expect(content).toContain('grep -cv "^$"');
      expect(content).toMatch(/CONTENT_LINES.*-lt 2/);
    });

    it('C12-001: PRD 可以通过 - 有效结构', () => {
      const validPRD = `# PRD: Test

## 背景

这是背景内容第一行。
这是背景内容第二行。

## 问题

问题描述第一行。
问题描述第二行。

## 方案

解决方案第一行。
解决方案第二行。
`;

      writeFileSync(join(testDir, 'test-prd.md'), validPRD);
      writeFileSync(join(testDir, 'test-dod.md'), `- [ ] test1\n  - Test: auto:test\n- [ ] test2\n  - Test: auto:test\n- [ ] test3\n  - Test: auto:test`);

      // 应该通过（3个section，每个≥2行）
      expect(() => {
        execSync(`bash ${scriptPath} ${join(testDir, 'test-prd.md')} ${join(testDir, 'test-dod.md')}`, {
          stdio: 'pipe',
        });
      }).not.toThrow();
    });

    it('C12-001: PRD 应该拒绝 - section 不足', () => {
      const invalidPRD = `# PRD: Test

## 背景

只有一个section。
`;

      writeFileSync(join(testDir, 'test-prd.md'), invalidPRD);
      writeFileSync(join(testDir, 'test-dod.md'), `- [ ] test\n  - Test: auto:test\n- [ ] test2\n  - Test: auto:test\n- [ ] test3\n  - Test: auto:test`);

      // 应该失败（只有1个section）
      expect(() => {
        execSync(`bash ${scriptPath} ${join(testDir, 'test-prd.md')} ${join(testDir, 'test-dod.md')}`, {
          stdio: 'pipe',
        });
      }).toThrow();
    });
  });

  describe('DoD Structure Validation', () => {
    it('C12-002: DoD 必须有至少 3 个验收项', () => {
      const content = readFileSync(scriptPath, 'utf8');

      // 验证包含 checkbox 计数逻辑
      expect(content).toContain('CHECKBOX_COUNT');
      expect(content).toContain('grep -c "^- \\[[ x]\\] "');
      expect(content).toMatch(/CHECKBOX_COUNT.*-lt 3/);
    });

    it('C12-002: DoD 每个验收项必须有 Test 映射', () => {
      const content = readFileSync(scriptPath, 'utf8');

      // 验证包含 Test 映射检查
      expect(content).toContain('ITEMS_WITHOUT_TEST');
      expect(content).toContain('grep "Test:"');
    });

    it('C12-002: DoD Test 映射格式验证', () => {
      const content = readFileSync(scriptPath, 'utf8');

      // 验证 Test 格式检查（auto: 或 manual:）
      expect(content).toContain('INVALID_TEST_MAPPINGS');
      expect(content).toContain('^(auto|manual):');
    });

    it('C12-002: DoD 应该通过 - 有效结构', () => {
      const validPRD = `## 背景

test content line 1
test content line 2

## 问题

problem line 1
problem line 2

## 方案

solution line 1
solution line 2
`;
      const validDoD = `# DoD

- [ ] 功能 A 正常工作
  - Test: auto:tests/feature-a.test.ts

- [ ] 功能 B 正确实现
  - Test: manual:手动验证-功能B

- [ ] 版本号已更新
  - Test: auto:tests/version.test.ts
`;

      writeFileSync(join(testDir, 'test-prd.md'), validPRD);
      writeFileSync(join(testDir, 'test-dod.md'), validDoD);

      // 应该通过（3个验收项，都有Test映射）
      try {
        execSync(`bash ${scriptPath} ${join(testDir, 'test-prd.md')} ${join(testDir, 'test-dod.md')}`, {
          stdio: 'pipe',
          encoding: 'utf8',
        });
        // If no error thrown, test passes
        expect(true).toBe(true);
      } catch (error: any) {
        // If error thrown, fail with detailed message
        console.error('Script output:', error.stdout);
        console.error('Script error:', error.stderr);
        throw new Error(`Script failed: ${error.message}\nStdout: ${error.stdout}\nStderr: ${error.stderr}`);
      }
    });
  });
});
