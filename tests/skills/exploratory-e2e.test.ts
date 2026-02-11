/**
 * Exploratory Skill 端到端测试
 *
 * 模拟完整工作流：
 * 1. 多个 exploratory 会话生成 PRD/DOD
 * 2. 使用 merge 工具合并
 * 3. 验证合并后的文档可以被 /dev 使用
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { execSync } from "child_process";
import { writeFileSync, readFileSync, mkdirSync, mkdtempSync, existsSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

const MERGE_SCRIPT = join(__dirname, "../../scripts/merge-exploratory-docs.sh");
const STOP_EXPLORATORY_HOOK = join(__dirname, "../../hooks/stop-exploratory.sh");

describe("Exploratory Skill E2E workflow", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "exploratory-e2e-"));
    execSync(`cd "${tempDir}" && git init -q`);
  });

  afterEach(() => {
    try {
      execSync(`rm -rf "${tempDir}"`);
    } catch {
      // ignore
    }
  });

  describe("Small Task workflow (single exploratory)", () => {
    it("should generate PRD/DOD and pass stop hook validation", () => {
      const timestamp = "20260211120000";

      // 模拟 exploratory 生成的 PRD
      const prd = `# PRD: 添加用户登录功能

## 需求描述
用户可以通过用户名和密码登录系统

## 技术方案
- POST /api/auth/login
- 使用 JWT token
- httpOnly cookie

## 依赖
- jsonwebtoken
- bcrypt

## 踩坑经验
- cookie 设置 httpOnly: true, secure: true
- token 过期时间 7 天
`;

      // 模拟 exploratory 生成的 DOD
      const dod = `# DOD: 添加用户登录功能

## 功能验收
- [ ] 用户可以通过正确的用户名密码登录
- [ ] 登录成功返回 JWT token
- [ ] 登录失败返回错误提示

## 技术验收
- [ ] POST /api/auth/login 接口实现
- [ ] JWT token 正确生成
- [ ] httpOnly cookie 正确设置

## 测试验收
- [ ] 登录成功测试
- [ ] 登录失败测试（错误密码）
- [ ] 登录失败测试（用户不存在）
`;

      // 写入文件
      writeFileSync(join(tempDir, `exploratory-${timestamp}.prd.md`), prd);
      writeFileSync(join(tempDir, `exploratory-${timestamp}.dod.md`), dod);

      // 创建 .exploratory-mode（worktree 已清理）
      writeFileSync(
        join(tempDir, ".exploratory-mode"),
        `exploratory\ntask: 添加用户登录功能\nworktree: ${tempDir}/exp-${timestamp}\ntimestamp: ${timestamp}\nstarted: 2026-02-11T12:00:00+00:00\n`
      );

      // 验证 stop hook 返回 exit 0（完成）
      const result = execSync(
        `cd "${tempDir}" && bash "${STOP_EXPLORATORY_HOOK}" < /dev/null; echo $?`,
        { encoding: "utf-8" }
      );

      const exitCode = result.trim().split("\n").pop();
      expect(exitCode).toBe("0");

      // 验证 .exploratory-mode 被删除
      expect(existsSync(join(tempDir, ".exploratory-mode"))).toBe(false);

      // 验证 PRD/DOD 存在
      expect(existsSync(join(tempDir, `exploratory-${timestamp}.prd.md`))).toBe(true);
      expect(existsSync(join(tempDir, `exploratory-${timestamp}.dod.md`))).toBe(true);
    });
  });

  describe("Big Initiative workflow (multiple exploratory + merge)", () => {
    it("should merge multiple exploratory outputs into comprehensive docs", () => {
      // 模拟 4 个 exploratory 会话的输出
      const sessions = [
        {
          name: "login",
          prd: `# PRD: 用户登录

## 需求
- 基础登录功能
- JWT token 认证

## 技术方案
- POST /api/auth/login
- bcrypt 验证密码

## 依赖
- jsonwebtoken
- bcrypt
`,
          dod: `# DOD: 用户登录

- [ ] 登录接口工作正常
- [ ] JWT token 正确返回
- [ ] 密码验证正确
`,
        },
        {
          name: "signup",
          prd: `# PRD: 用户注册

## 需求
- 用户注册新账号
- 邮箱验证

## 技术方案
- POST /api/auth/signup
- 发送验证邮件

## 依赖
- nodemailer
`,
          dod: `# DOD: 用户注册

- [ ] 注册接口工作正常
- [ ] 邮箱验证码发送
- [ ] 用户数据存储正确
`,
        },
        {
          name: "reset-pwd",
          prd: `# PRD: 密码重置

## 需求
- 忘记密码重置
- 邮箱验证码

## 技术方案
- POST /api/auth/reset-password
- 6 位数字验证码

## 依赖
- nodemailer
- Redis（存储验证码）
`,
          dod: `# DOD: 密码重置

- [ ] 重置密码接口工作正常
- [ ] 验证码正确发送和验证
- [ ] 密码重置成功
`,
        },
        {
          name: "oauth",
          prd: `# PRD: 第三方登录

## 需求
- Google OAuth 登录
- GitHub OAuth 登录

## 技术方案
- OAuth 2.0 协议
- passport.js

## 依赖
- passport
- passport-google-oauth20
- passport-github2
`,
          dod: `# DOD: 第三方登录

- [ ] Google 登录正常
- [ ] GitHub 登录正常
- [ ] 用户信息正确同步
`,
        },
      ];

      // 写入所有 exploratory 文件
      sessions.forEach((session) => {
        writeFileSync(
          join(tempDir, `exploratory-${session.name}.prd.md`),
          session.prd
        );
        writeFileSync(
          join(tempDir, `exploratory-${session.name}.dod.md`),
          session.dod
        );
      });

      // 执行合并（explicitly list all files to avoid shell expansion issues)
      const files = sessions.map(s => `exploratory-${s.name}.prd.md exploratory-${s.name}.dod.md`).join(' ');
      execSync(
        `cd "${tempDir}" && bash "${MERGE_SCRIPT}" --output auth-system ${files}`,
        { encoding: "utf-8" }
      );

      // 验证合并后的文件存在
      expect(existsSync(join(tempDir, "auth-system.prd.md"))).toBe(true);
      expect(existsSync(join(tempDir, "auth-system.dod.md"))).toBe(true);

      // 读取合并后的 PRD
      const mergedPrd = readFileSync(join(tempDir, "auth-system.prd.md"), "utf-8");

      // 验证所有功能都被包含
      expect(mergedPrd).toContain("用户登录");
      expect(mergedPrd).toContain("用户注册");
      expect(mergedPrd).toContain("密码重置");
      expect(mergedPrd).toContain("第三方登录");

      // 验证所有依赖都被包含
      expect(mergedPrd).toContain("jsonwebtoken");
      expect(mergedPrd).toContain("bcrypt");
      expect(mergedPrd).toContain("nodemailer");
      expect(mergedPrd).toContain("passport");

      // 读取合并后的 DOD
      const mergedDod = readFileSync(join(tempDir, "auth-system.dod.md"), "utf-8");

      // 验证所有验收标准都被包含
      expect(mergedDod).toContain("登录接口工作正常");
      expect(mergedDod).toContain("注册接口工作正常");
      expect(mergedDod).toContain("重置密码接口工作正常");
      expect(mergedDod).toContain("Google 登录正常");
      expect(mergedDod).toContain("GitHub 登录正常");

      // 验证可以被 /dev 使用（检查文件格式）
      expect(mergedPrd).toMatch(/^#\s+/m); // 标题存在
      expect(mergedDod).toMatch(/^-\s+\[.\]/m); // 验收标准存在
    });

    it("should handle merge with source attribution", () => {
      // 创建简单的测试文件
      writeFileSync(
        join(tempDir, "exploratory-part1.prd.md"),
        "# Part 1\n\n## 需求\n功能 A\n"
      );
      writeFileSync(
        join(tempDir, "exploratory-part2.prd.md"),
        "# Part 2\n\n## 需求\n功能 B\n"
      );

      execSync(
        `cd "${tempDir}" && bash "${MERGE_SCRIPT}" --output combined exploratory-*.prd.md`,
        { stdio: "inherit" }
      );

      const merged = readFileSync(join(tempDir, "combined.prd.md"), "utf-8");

      // 验证包含来源标注
      expect(merged).toMatch(/来源|source/i);
      expect(merged).toContain("part1");
      expect(merged).toContain("part2");

      // 验证功能内容都在
      expect(merged).toContain("功能 A");
      expect(merged).toContain("功能 B");
    });
  });

  describe("Integration with stop hook", () => {
    it("should work end-to-end: exploratory → stop hook validates → ready for /dev", () => {
      const timestamp = "20260211150000";

      // Step 1: 模拟 exploratory 生成 PRD/DOD
      writeFileSync(
        join(tempDir, `exploratory-${timestamp}.prd.md`),
        "# Simple Feature\n\n## 需求\nSimple requirement\n"
      );
      writeFileSync(
        join(tempDir, `exploratory-${timestamp}.dod.md`),
        "# Simple DOD\n\n- [ ] Works\n"
      );

      // Step 2: 创建 .exploratory-mode
      writeFileSync(
        join(tempDir, ".exploratory-mode"),
        `exploratory\ntask: simple feature\nworktree: ${tempDir}/exp-${timestamp}\ntimestamp: ${timestamp}\nstarted: 2026-02-11T15:00:00+00:00\n`
      );

      // Step 3: 验证 stop hook（worktree 已清理）
      const result = execSync(
        `cd "${tempDir}" && bash "${STOP_EXPLORATORY_HOOK}" < /dev/null; echo $?`,
        { encoding: "utf-8" }
      );

      const exitCode = result.trim().split("\n").pop();
      expect(exitCode).toBe("0");

      // Step 4: 验证产物可以被 /dev 使用
      expect(existsSync(join(tempDir, `exploratory-${timestamp}.prd.md`))).toBe(true);
      expect(existsSync(join(tempDir, `exploratory-${timestamp}.dod.md`))).toBe(true);

      // Step 5: 重命名为标准名称（模拟 /dev 使用）
      execSync(
        `cd "${tempDir}" && mv exploratory-${timestamp}.prd.md .prd.md && mv exploratory-${timestamp}.dod.md .dod.md`
      );

      expect(existsSync(join(tempDir, ".prd.md"))).toBe(true);
      expect(existsSync(join(tempDir, ".dod.md"))).toBe(true);
    });

    it("should block session end if exploratory incomplete", () => {
      const timestamp = "20260211160000";

      // 只创建 .exploratory-mode，不创建 PRD/DOD
      writeFileSync(
        join(tempDir, ".exploratory-mode"),
        `exploratory\ntask: incomplete task\nworktree: ${tempDir}/exp-${timestamp}\ntimestamp: ${timestamp}\nstarted: 2026-02-11T16:00:00+00:00\n`
      );

      // 验证 stop hook 返回 exit 2（未完成）
      let exitCode = "unknown";
      try {
        execSync(
          `cd "${tempDir}" && bash "${STOP_EXPLORATORY_HOOK}" < /dev/null`,
          { encoding: "utf-8" }
        );
      } catch (err: any) {
        exitCode = String(err.status);
      }

      expect(exitCode).toBe("2");

      // .exploratory-mode 应该仍然存在（未删除）
      expect(existsSync(join(tempDir, ".exploratory-mode"))).toBe(true);
    });
  });

  describe("Real-world scenarios", () => {
    it("should handle complex auth system (4 exploratory + merge)", () => {
      // 创建完整的认证系统示例
      const features = [
        "login",
        "signup",
        "reset-password",
        "oauth",
      ];

      features.forEach((feature, index) => {
        writeFileSync(
          join(tempDir, `exploratory-${feature}.prd.md`),
          `# ${feature.toUpperCase()}\n\n## 需求\n功能 ${index + 1}\n\n## 依赖\n- dependency-${index + 1}\n`
        );
        writeFileSync(
          join(tempDir, `exploratory-${feature}.dod.md`),
          `# ${feature.toUpperCase()} DOD\n\n- [ ] 功能 ${index + 1} 完成\n- [ ] 测试覆盖\n`
        );
      });

      // 合并（explicitly list files)
      const allFiles = features.map(f => `exploratory-${f}.prd.md exploratory-${f}.dod.md`).join(' ');
      execSync(
        `cd "${tempDir}" && bash "${MERGE_SCRIPT}" --output auth-complete ${allFiles}`,
        { encoding: "utf-8" }
      );

      const prd = readFileSync(join(tempDir, "auth-complete.prd.md"), "utf-8");
      const dod = readFileSync(join(tempDir, "auth-complete.dod.md"), "utf-8");

      // 验证所有功能都被合并
      features.forEach((feature) => {
        expect(prd.toUpperCase()).toContain(feature.toUpperCase());
        expect(dod.toUpperCase()).toContain(feature.toUpperCase());
      });

      // 验证所有依赖都被包含
      [1, 2, 3, 4].forEach((num) => {
        expect(prd).toContain(`dependency-${num}`);
      });

      // 验证所有验收标准都被包含
      [1, 2, 3, 4].forEach((num) => {
        expect(dod).toContain(`功能 ${num} 完成`);
      });
    });
  });
});
