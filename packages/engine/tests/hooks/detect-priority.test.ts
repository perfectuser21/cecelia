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
import * as fs from "fs";

const DETECT_SCRIPT = path.join(__dirname, "../../scripts/devgate/detect-priority.cjs");
const QA_DECISION = path.join(__dirname, "../../docs/QA-DECISION.md");
const QA_DECISION_BACKUP = QA_DECISION + ".test-backup";

function runDetect(env: Record<string, string> = {}): { priority: string; source: string } {
  const result = execSync(`node "${DETECT_SCRIPT}" --json`, {
    encoding: "utf-8",
    env: { ...process.env, ...env },
  }).trim();
  return JSON.parse(result);
}

describe("detect-priority.cjs", () => {
  // 临时移除 QA-DECISION.md 避免影响测试
  beforeEach(() => {
    if (fs.existsSync(QA_DECISION)) {
      fs.renameSync(QA_DECISION, QA_DECISION_BACKUP);
    }
  });

  afterEach(() => {
    if (fs.existsSync(QA_DECISION_BACKUP)) {
      fs.renameSync(QA_DECISION_BACKUP, QA_DECISION);
    }
  });
  // NOTE: PR_TITLE 检测功能已在 detect-priority.cjs 中移除（L265-266）
  // 原因："移除：从 PR title 和 commit messages 检测（容易误识别）"
  // 相关测试已删除，保留以下使用其他检测方式的测试

  describe("CRITICAL/HIGH 标签映射", () => {
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

    it("PR label 包含 HIGH 应返回 P1", () => {
      const result = runDetect({ PR_LABELS: "bug,HIGH" });
      expect(result.priority).toBe("P1");
      expect(result.source).toBe("label");
    });
  });

  describe("P0/P1/P2/P3 直接映射", () => {
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
        PR_LABELS: "P2",
      });
      expect(result.priority).toBe("P0");
      expect(result.source).toBe("env");
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
