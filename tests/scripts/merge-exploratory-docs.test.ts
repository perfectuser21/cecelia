/**
 * Merge Exploratory Docs 工具测试
 *
 * 验证 scripts/merge-exploratory-docs.sh 能够正确合并多个 exploratory PRD/DOD 文件
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { execSync } from "child_process";
import { writeFileSync, readFileSync, mkdtempSync, existsSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

const MERGE_SCRIPT = join(__dirname, "../../scripts/merge-exploratory-docs.sh");

describe("scripts/merge-exploratory-docs.sh", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "merge-test-"));
  });

  afterEach(() => {
    try {
      execSync(`rm -rf "${tempDir}"`);
    } catch {
      // ignore
    }
  });

  describe("merge 2 files", () => {
    it("should merge 2 PRD files correctly", () => {
      // 创建 2 个 PRD 文件
      writeFileSync(
        join(tempDir, "exploratory-login.prd.md"),
        `# PRD: 用户登录

## 需求
- 用户可以登录系统

## 技术方案
- 使用 JWT token

## 依赖
- jsonwebtoken 库

## 踩坑经验
- 记得设置 httpOnly cookie
`
      );

      writeFileSync(
        join(tempDir, "exploratory-signup.prd.md"),
        `# PRD: 用户注册

## 需求
- 用户可以注册新账号

## 技术方案
- bcrypt 加密密码

## 依赖
- bcrypt 库

## 踩坑经验
- salt rounds 设置为 10
`
      );

      // 执行合并
      execSync(
        `cd "${tempDir}" && bash "${MERGE_SCRIPT}" --output auth exploratory-*.prd.md`,
        { stdio: "inherit" }
      );

      // 验证输出文件存在
      expect(existsSync(join(tempDir, "auth.prd.md"))).toBe(true);

      // 验证合并内容
      const merged = readFileSync(join(tempDir, "auth.prd.md"), "utf-8");
      expect(merged).toContain("用户登录");
      expect(merged).toContain("用户注册");
      expect(merged).toContain("JWT token");
      expect(merged).toContain("bcrypt");
      expect(merged).toContain("jsonwebtoken 库");
      expect(merged).toContain("bcrypt 库");
    });

    it("should merge 2 DOD files correctly", () => {
      // 创建 2 个 DOD 文件
      writeFileSync(
        join(tempDir, "exploratory-login.dod.md"),
        `# DOD: 用户登录

## 功能验收
- [ ] 登录接口工作正常
- [ ] 返回 JWT token

## 测试验收
- [ ] 单元测试覆盖率 > 80%
`
      );

      writeFileSync(
        join(tempDir, "exploratory-signup.dod.md"),
        `# DOD: 用户注册

## 功能验收
- [ ] 注册接口工作正常
- [ ] 密码正确加密

## 测试验收
- [ ] 单元测试覆盖率 > 80%
`
      );

      // 执行合并
      execSync(
        `cd "${tempDir}" && bash "${MERGE_SCRIPT}" --output auth exploratory-*.dod.md`,
        { stdio: "inherit" }
      );

      // 验证输出文件存在
      expect(existsSync(join(tempDir, "auth.dod.md"))).toBe(true);

      // 验证合并内容
      const merged = readFileSync(join(tempDir, "auth.dod.md"), "utf-8");
      expect(merged).toContain("登录接口工作正常");
      expect(merged).toContain("注册接口工作正常");
      expect(merged).toContain("JWT token");
      expect(merged).toContain("密码正确加密");
    });
  });

  describe("merge 3-4 files", () => {
    it("should merge 4 PRD files correctly", () => {
      // 创建 4 个 PRD 文件
      const files = [
        {
          name: "exploratory-login.prd.md",
          content: "# Login\n\n## 需求\n- 用户登录\n",
        },
        {
          name: "exploratory-signup.prd.md",
          content: "# Signup\n\n## 需求\n- 用户注册\n",
        },
        {
          name: "exploratory-reset-pwd.prd.md",
          content: "# Reset Password\n\n## 需求\n- 重置密码\n",
        },
        {
          name: "exploratory-oauth.prd.md",
          content: "# OAuth\n\n## 需求\n- 第三方登录\n",
        },
      ];

      files.forEach((file) => {
        writeFileSync(join(tempDir, file.name), file.content);
      });

      // 执行合并
      execSync(
        `cd "${tempDir}" && bash "${MERGE_SCRIPT}" --output auth-system exploratory-*.prd.md`,
        { stdio: "inherit" }
      );

      // 验证输出文件存在
      expect(existsSync(join(tempDir, "auth-system.prd.md"))).toBe(true);

      // 验证合并内容包含所有源文件信息
      const merged = readFileSync(join(tempDir, "auth-system.prd.md"), "utf-8");
      expect(merged).toContain("用户登录");
      expect(merged).toContain("用户注册");
      expect(merged).toContain("重置密码");
      expect(merged).toContain("第三方登录");
    });

    it("should merge 3 DOD files correctly", () => {
      // 创建 3 个 DOD 文件
      const files = [
        {
          name: "exploratory-api.dod.md",
          content: "# API\n\n- [ ] API 接口完整\n",
        },
        {
          name: "exploratory-ui.dod.md",
          content: "# UI\n\n- [ ] UI 界面美观\n",
        },
        {
          name: "exploratory-test.dod.md",
          content: "# Test\n\n- [ ] 测试覆盖率 > 80%\n",
        },
      ];

      files.forEach((file) => {
        writeFileSync(join(tempDir, file.name), file.content);
      });

      // 执行合并
      execSync(
        `cd "${tempDir}" && bash "${MERGE_SCRIPT}" --output feature exploratory-*.dod.md`,
        { stdio: "inherit" }
      );

      // 验证输出文件存在
      expect(existsSync(join(tempDir, "feature.dod.md"))).toBe(true);

      // 验证合并内容包含所有验收标准
      const merged = readFileSync(join(tempDir, "feature.dod.md"), "utf-8");
      expect(merged).toContain("API 接口完整");
      expect(merged).toContain("UI 界面美观");
      expect(merged).toContain("测试覆盖率");
    });
  });

  describe("merge both PRD and DOD", () => {
    it("should merge PRD and DOD files separately in one command", () => {
      // 创建 2 个 PRD + 2 个 DOD
      writeFileSync(
        join(tempDir, "exploratory-feature1.prd.md"),
        "# Feature 1 PRD\n\nRequirements\n"
      );
      writeFileSync(
        join(tempDir, "exploratory-feature1.dod.md"),
        "# Feature 1 DOD\n\n- [ ] Done\n"
      );
      writeFileSync(
        join(tempDir, "exploratory-feature2.prd.md"),
        "# Feature 2 PRD\n\nRequirements\n"
      );
      writeFileSync(
        join(tempDir, "exploratory-feature2.dod.md"),
        "# Feature 2 DOD\n\n- [ ] Done\n"
      );

      // 执行合并（同时合并 PRD 和 DOD）
      // Note: Shell brace expansion requires explicit file listing
      execSync(
        `cd "${tempDir}" && bash "${MERGE_SCRIPT}" --output combined exploratory-feature1.prd.md exploratory-feature1.dod.md exploratory-feature2.prd.md exploratory-feature2.dod.md`,
        { encoding: "utf-8" }
      );

      // 验证两个输出文件都存在
      expect(existsSync(join(tempDir, "combined.prd.md"))).toBe(true);
      expect(existsSync(join(tempDir, "combined.dod.md"))).toBe(true);

      // 验证 PRD 内容
      const prd = readFileSync(join(tempDir, "combined.prd.md"), "utf-8");
      expect(prd).toContain("Feature 1 PRD");
      expect(prd).toContain("Feature 2 PRD");

      // 验证 DOD 内容
      const dod = readFileSync(join(tempDir, "combined.dod.md"), "utf-8");
      expect(dod).toContain("Feature 1 DOD");
      expect(dod).toContain("Feature 2 DOD");
    });
  });

  describe("edge cases", () => {
    it("should handle --verbose flag", () => {
      writeFileSync(
        join(tempDir, "exploratory-test.prd.md"),
        "# Test PRD\n\nContent\n"
      );

      const output = execSync(
        `cd "${tempDir}" && bash "${MERGE_SCRIPT}" --verbose --output test exploratory-*.prd.md`,
        { encoding: "utf-8" }
      );

      // verbose 模式应该输出详细信息
      expect(output).toContain("exploratory-test.prd.md");
    });

    it("should show help with --help flag", () => {
      const output = execSync(`bash "${MERGE_SCRIPT}" --help`, {
        encoding: "utf-8",
      });

      // Help text is in Chinese
      expect(output).toMatch(/Usage:|使用方式/);
      expect(output).toContain("--output");
      expect(output).toContain("--verbose");
    });

    it("should fail gracefully with no input files", () => {
      let exitCode = 0;
      try {
        execSync(`cd "${tempDir}" && bash "${MERGE_SCRIPT}"`, {
          stdio: "inherit",
        });
      } catch (err: any) {
        exitCode = err.status;
      }

      // 应该非 0 退出
      expect(exitCode).not.toBe(0);
    });
  });

  describe("file structure validation", () => {
    it("should preserve source attribution in merged files", () => {
      writeFileSync(
        join(tempDir, "exploratory-feature1.prd.md"),
        "# Feature 1\n\nContent 1\n"
      );
      writeFileSync(
        join(tempDir, "exploratory-feature2.prd.md"),
        "# Feature 2\n\nContent 2\n"
      );

      execSync(
        `cd "${tempDir}" && bash "${MERGE_SCRIPT}" --output test exploratory-*.prd.md`,
        { stdio: "inherit" }
      );

      const merged = readFileSync(join(tempDir, "test.prd.md"), "utf-8");

      // 应该包含来源标注
      expect(merged).toMatch(/来源|source|from/i);
      expect(merged).toContain("feature1");
      expect(merged).toContain("feature2");
    });

    it("should have correct file permissions", () => {
      const stat = execSync(`stat -c "%a" "${MERGE_SCRIPT}"`, {
        encoding: "utf-8",
      });
      const permissions = stat.trim();
      // Should be executable
      expect(["755", "775", "777", "655", "675"]).toContain(permissions);
    });
  });
});
