/**
 * l2a-check.test.ts
 *
 * L2A Check 脚本测试 (简化版)
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { execSync } from "child_process";
import { existsSync, writeFileSync, unlinkSync, mkdirSync, rmSync } from "fs";
import { resolve, join } from "path";

const PROJECT_ROOT = resolve(__dirname, "../..");
const L2A_SCRIPT = join(PROJECT_ROOT, "scripts/devgate/l2a-check.sh");
const TEST_DIR = join(PROJECT_ROOT, ".test-l2a");

// 运行脚本时清除 GITHUB_ACTIONS 环境变量，以便测试本地 PRD/DoD 检查行为
// CI 中 GITHUB_ACTIONS=true 会跳过 PRD/DoD 检查，但测试需要验证这些检查
const localEnv = { ...process.env, GITHUB_ACTIONS: "" };

describe("l2a-check.sh", () => {
  beforeAll(() => {
    if (!existsSync(TEST_DIR)) {
      mkdirSync(TEST_DIR, { recursive: true });
      mkdirSync(join(TEST_DIR, "docs"), { recursive: true });
    }
  });

  beforeEach(() => {
    // Clean test directory before each test
    const files = [".prd.md", ".dod.md", "docs/QA-DECISION.md", "docs/AUDIT-REPORT.md"];
    for (const file of files) {
      const filepath = join(TEST_DIR, file);
      if (existsSync(filepath)) {
        unlinkSync(filepath);
      }
    }
  });

  afterAll(() => {
    if (existsSync(TEST_DIR)) {
      rmSync(TEST_DIR, { recursive: true, force: true });
    }
  });

  it("should exist and be executable", () => {
    expect(existsSync(L2A_SCRIPT)).toBe(true);
    expect(() => {
      execSync(`bash -n "${L2A_SCRIPT}"`, { encoding: "utf-8" });
    }).not.toThrow();
  });

  it("should pass when all files are valid (pr mode)", () => {
    // P1-1: PRD 必须 >=3 sections，每 section >=2 lines
    const prd = `# PRD

## Background
Context line 1
Context line 2

## Problem
Problem line 1
Problem line 2

## Solution
Solution line 1
Solution line 2
`;
    // P1-1: DoD 每个验收项必须有 Test: 字段
    const dod = `# DoD

QA: docs/QA-DECISION.md

- [ ] item works correctly
  Test: tests/foo.test.ts
`;
    writeFileSync(join(TEST_DIR, ".prd.md"), prd);
    writeFileSync(join(TEST_DIR, ".dod.md"), dod);
    writeFileSync(join(TEST_DIR, "docs/QA-DECISION.md"), "Decision: NO_RCI");
    writeFileSync(join(TEST_DIR, "docs/AUDIT-REPORT.md"), "Decision: PASS");

    const output = execSync(`bash "${L2A_SCRIPT}" pr`, {
      cwd: TEST_DIR,
      encoding: "utf-8",
      env: localEnv,
    });
    expect(output).toContain("L2A_SUMMARY: passed=4 failed=0");
  });

  it("should fail when .prd.md is missing", () => {
    // P1-1: DoD 必须有 Test: 映射
    const dod = `# DoD

QA: docs/QA-DECISION.md

- [ ] item works
  Test: tests/foo.test.ts
`;
    writeFileSync(join(TEST_DIR, ".dod.md"), dod);
    writeFileSync(join(TEST_DIR, "docs/QA-DECISION.md"), "Decision: NO_RCI");
    writeFileSync(join(TEST_DIR, "docs/AUDIT-REPORT.md"), "Decision: PASS");

    try {
      execSync(`bash "${L2A_SCRIPT}" pr`, { cwd: TEST_DIR, encoding: "utf-8", env: localEnv });
      expect.fail("Should have failed");
    } catch (error: any) {
      expect(error.status).toBe(2);
      expect(error.stdout + error.stderr).toContain(".prd.md");
    }
  });

  it("should pass in release mode without PRD/DoD (skip PRD/DoD check)", () => {
    // Release 模式跳过 PRD/DoD 检查，只需要 QA 和 Audit
    writeFileSync(join(TEST_DIR, "docs/QA-DECISION.md"), "Decision: PASS");
    writeFileSync(join(TEST_DIR, "docs/AUDIT-REPORT.md"), "Decision: PASS");

    const output = execSync(`bash "${L2A_SCRIPT}" release`, {
      cwd: TEST_DIR,
      encoding: "utf-8",
    });
    expect(output).toContain("L2A_SUMMARY: passed=4 failed=0");
    expect(output).toContain("[Release 模式] 跳过 PRD/DoD 检查");
  });

  it("should fail in release mode when QA decision is not PASS", () => {
    // Release 模式仍然检查 QA 必须是 PASS
    writeFileSync(join(TEST_DIR, "docs/QA-DECISION.md"), "Decision: NO_RCI");
    writeFileSync(join(TEST_DIR, "docs/AUDIT-REPORT.md"), "Decision: PASS");

    try {
      execSync(`bash "${L2A_SCRIPT}" release`, { cwd: TEST_DIR });
      expect.fail("Should have failed");
    } catch (error: any) {
      expect(error.status).toBe(2);
      expect(error.stdout + error.stderr).toContain("not PASS");
    }
  });

  // P1-1: PRD 结构检查（>=3 sections，每 section >=2 行）
  describe("P1-1: PRD structure validation", () => {
    it("should fail when PRD has fewer than 3 sections", () => {
      // 只有 2 个 section
      const prd = `# PRD

## Section 1
Content line 1
Content line 2

## Section 2
Content line 1
Content line 2
`;
      writeFileSync(join(TEST_DIR, ".prd.md"), prd);
      writeFileSync(join(TEST_DIR, ".dod.md"), "# DoD\n\nQA: test\n\n- [ ] item\n  Test: tests/foo.test.ts");
      writeFileSync(join(TEST_DIR, "docs/QA-DECISION.md"), "Decision: NO_RCI");
      writeFileSync(join(TEST_DIR, "docs/AUDIT-REPORT.md"), "Decision: PASS");

      try {
        execSync(`bash "${L2A_SCRIPT}" pr`, { cwd: TEST_DIR, env: localEnv });
        expect.fail("Should have failed");
      } catch (error: any) {
        expect(error.status).toBe(2);
        expect(error.stdout + error.stderr).toContain("need >= 3 sections");
      }
    });

    it("should fail when PRD section has fewer than 2 lines", () => {
      // 3 个 section，但有一个只有 1 行
      const prd = `# PRD

## Section 1
Content line 1
Content line 2

## Section 2
Only one line

## Section 3
Content line 1
Content line 2
`;
      writeFileSync(join(TEST_DIR, ".prd.md"), prd);
      writeFileSync(join(TEST_DIR, ".dod.md"), "# DoD\n\nQA: test\n\n- [ ] item\n  Test: tests/foo.test.ts");
      writeFileSync(join(TEST_DIR, "docs/QA-DECISION.md"), "Decision: NO_RCI");
      writeFileSync(join(TEST_DIR, "docs/AUDIT-REPORT.md"), "Decision: PASS");

      try {
        execSync(`bash "${L2A_SCRIPT}" pr`, { cwd: TEST_DIR, env: localEnv });
        expect.fail("Should have failed");
      } catch (error: any) {
        expect(error.status).toBe(2);
        expect(error.stdout + error.stderr).toContain("sections too short");
      }
    });

    it("should pass when PRD has >=3 sections each with >=2 lines", () => {
      const prd = `# PRD

## Section 1
Content line 1
Content line 2

## Section 2
Content line 1
Content line 2

## Section 3
Content line 1
Content line 2
`;
      writeFileSync(join(TEST_DIR, ".prd.md"), prd);
      writeFileSync(join(TEST_DIR, ".dod.md"), "# DoD\n\nQA: test\n\n- [ ] item\n  Test: tests/foo.test.ts");
      writeFileSync(join(TEST_DIR, "docs/QA-DECISION.md"), "Decision: NO_RCI");
      writeFileSync(join(TEST_DIR, "docs/AUDIT-REPORT.md"), "Decision: PASS");

      const output = execSync(`bash "${L2A_SCRIPT}" pr`, { cwd: TEST_DIR, encoding: "utf-8", env: localEnv });
      expect(output).toContain("L2A_SUMMARY: passed=4 failed=0");
    });
  });

  // P1-1: DoD Test 映射检查
  describe("P1-1: DoD Test mapping validation", () => {
    it("should fail when DoD item has no Test: field", () => {
      const prd = `# PRD

## Section 1
Content 1
Content 2

## Section 2
Content 1
Content 2

## Section 3
Content 1
Content 2
`;
      // DoD 有验收项但没有 Test: 字段
      const dod = `# DoD

QA: docs/QA-DECISION.md

## 验收标准

- [ ] 功能正常
`;
      writeFileSync(join(TEST_DIR, ".prd.md"), prd);
      writeFileSync(join(TEST_DIR, ".dod.md"), dod);
      writeFileSync(join(TEST_DIR, "docs/QA-DECISION.md"), "Decision: NO_RCI");
      writeFileSync(join(TEST_DIR, "docs/AUDIT-REPORT.md"), "Decision: PASS");

      try {
        execSync(`bash "${L2A_SCRIPT}" pr`, { cwd: TEST_DIR, env: localEnv });
        expect.fail("Should have failed");
      } catch (error: any) {
        expect(error.status).toBe(2);
        expect(error.stdout + error.stderr).toContain("missing Test:");
      }
    });

    it("should pass when all DoD items have Test: field", () => {
      const prd = `# PRD

## Section 1
Content 1
Content 2

## Section 2
Content 1
Content 2

## Section 3
Content 1
Content 2
`;
      const dod = `# DoD

QA: docs/QA-DECISION.md

## 验收标准

- [ ] 功能正常
  Test: tests/foo.test.ts
- [ ] 性能达标
  Test: contract:C1-001
`;
      writeFileSync(join(TEST_DIR, ".prd.md"), prd);
      writeFileSync(join(TEST_DIR, ".dod.md"), dod);
      writeFileSync(join(TEST_DIR, "docs/QA-DECISION.md"), "Decision: NO_RCI");
      writeFileSync(join(TEST_DIR, "docs/AUDIT-REPORT.md"), "Decision: PASS");

      const output = execSync(`bash "${L2A_SCRIPT}" pr`, { cwd: TEST_DIR, encoding: "utf-8", env: localEnv });
      expect(output).toContain("L2A_SUMMARY: passed=4 failed=0");
    });
  });
});
