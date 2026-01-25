/**
 * detect-priority.cjs 单元测试
 *
 * 测试优先级检测逻辑：
 *   - CRITICAL → P0
 *   - HIGH → P1
 *   - security 前缀 → P0
 *   - P0/P1/P2/P3 直接映射
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { execSync } from "child_process";
import * as path from "path";

const DETECT_SCRIPT = path.join(__dirname, "../../scripts/devgate/detect-priority.cjs");

function runDetect(env: Record<string, string> = {}): { priority: string; source: string } {
  const result = execSync(`node "${DETECT_SCRIPT}" --json`, {
    encoding: "utf-8",
    env: { ...process.env, ...env },
  }).trim();
  return JSON.parse(result);
}

describe("detect-priority.cjs", () => {
  describe("CRITICAL → P0 映射", () => {
    it("PR title 包含 CRITICAL 应返回 P0", () => {
      const result = runDetect({ PR_TITLE: "fix: CRITICAL 级安全修复" });
      expect(result.priority).toBe("P0");
      expect(result.source).toBe("title");
    });

    it("PR title 包含小写 critical 应返回 P0", () => {
      const result = runDetect({ PR_TITLE: "fix: critical security issue" });
      expect(result.priority).toBe("P0");
      expect(result.source).toBe("title");
    });

    it("PR label 包含 CRITICAL 应返回 P0", () => {
      const result = runDetect({ PR_LABELS: "bug,CRITICAL,security" });
      expect(result.priority).toBe("P0");
      expect(result.source).toBe("label");
    });

    it("环境变量 PR_PRIORITY 包含 CRITICAL 应返回 P0", () => {
      const result = runDetect({ PR_PRIORITY: "CRITICAL" });
      expect(result.priority).toBe("P0");
      expect(result.source).toBe("env");
    });
  });

  describe("HIGH → P1 映射", () => {
    it("PR title 包含 HIGH 应返回 P1", () => {
      const result = runDetect({ PR_TITLE: "fix: HIGH 级问题修复" });
      expect(result.priority).toBe("P1");
      expect(result.source).toBe("title");
    });

    it("PR title 包含小写 high 应返回 P1", () => {
      const result = runDetect({ PR_TITLE: "fix: high priority bug" });
      expect(result.priority).toBe("P1");
      expect(result.source).toBe("title");
    });

    it("PR label 包含 HIGH 应返回 P1", () => {
      const result = runDetect({ PR_LABELS: "bug,HIGH" });
      expect(result.priority).toBe("P1");
      expect(result.source).toBe("label");
    });
  });

  describe("security 前缀 → P0 映射", () => {
    it("PR title 以 security: 开头应返回 P0", () => {
      const result = runDetect({ PR_TITLE: "security: fix XSS vulnerability" });
      expect(result.priority).toBe("P0");
      expect(result.source).toBe("title");
    });

    it("PR title 以 security(scope): 开头应返回 P0", () => {
      const result = runDetect({ PR_TITLE: "security(hooks): fix injection" });
      expect(result.priority).toBe("P0");
      expect(result.source).toBe("title");
    });

    it("PR title 以 Security: 开头（大写）应返回 P0", () => {
      const result = runDetect({ PR_TITLE: "Security: patch CVE-2024-1234" });
      expect(result.priority).toBe("P0");
      expect(result.source).toBe("title");
    });

    it("PR title 中间包含 security 不应触发（只匹配前缀）", () => {
      // BASE_REF=HEAD 阻止检测 git commit 历史
      const result = runDetect({ PR_TITLE: "fix: improve security checks", BASE_REF: "HEAD" });
      // 不是 security 前缀，应返回 unknown
      expect(result.priority).toBe("unknown");
    });
  });

  describe("P0/P1/P2/P3 直接映射", () => {
    it("PR title 包含 P0 应返回 P0", () => {
      const result = runDetect({ PR_TITLE: "P0: critical bug fix" });
      expect(result.priority).toBe("P0");
      expect(result.source).toBe("title");
    });

    it("PR title 包含 P1 应返回 P1", () => {
      const result = runDetect({ PR_TITLE: "fix(P1): important feature" });
      expect(result.priority).toBe("P1");
      expect(result.source).toBe("title");
    });

    it("PR title 包含 P2 应返回 P2", () => {
      const result = runDetect({ PR_TITLE: "feat: new feature (P2)" });
      expect(result.priority).toBe("P2");
      expect(result.source).toBe("title");
    });

    it("PR title 包含 P3 应返回 P3", () => {
      const result = runDetect({ PR_TITLE: "chore: cleanup (P3)" });
      expect(result.priority).toBe("P3");
      expect(result.source).toBe("title");
    });

    it("PR label 包含 priority:P0 应返回 P0", () => {
      const result = runDetect({ PR_LABELS: "bug,priority:P0" });
      expect(result.priority).toBe("P0");
      expect(result.source).toBe("label");
    });
  });

  describe("优先级检测顺序", () => {
    it("环境变量优先级最高", () => {
      const result = runDetect({
        PR_PRIORITY: "P0",
        PR_TITLE: "P3: low priority",
        PR_LABELS: "P2",
      });
      expect(result.priority).toBe("P0");
      expect(result.source).toBe("env");
    });

    it("PR title 优先于 labels", () => {
      const result = runDetect({
        PR_TITLE: "P1: medium priority",
        PR_LABELS: "P3",
      });
      expect(result.priority).toBe("P1");
      expect(result.source).toBe("title");
    });

    it("CRITICAL 优先于 P1 在同一文本中", () => {
      // CRITICAL 在检测逻辑中先于 P1 检查
      const result = runDetect({ PR_TITLE: "fix(P1): CRITICAL security issue" });
      expect(result.priority).toBe("P0"); // CRITICAL 映射到 P0
      expect(result.source).toBe("title");
    });
  });

  describe("无优先级时返回 unknown", () => {
    it("无任何优先级标识应返回 unknown", () => {
      // BASE_REF=HEAD 阻止检测 git commit 历史（否则会检测到当前 commit 的 P0）
      const result = runDetect({ PR_TITLE: "fix: some bug", BASE_REF: "HEAD" });
      expect(result.priority).toBe("unknown");
      expect(result.source).toBe("default");
    });

    it("空输入应返回 unknown", () => {
      // BASE_REF=HEAD 阻止检测 git commit 历史
      const result = runDetect({ BASE_REF: "HEAD" });
      expect(result.priority).toBe("unknown");
      expect(result.source).toBe("default");
    });
  });
});
