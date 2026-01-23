import { describe, it, expect } from "vitest";

const {
  enumerateEntries,
  parseRCI,
  checkCoverage,
  generateReport,
  extractEntryName,
} = require("../../scripts/devgate/scan-rci-coverage.cjs");

describe("scan-rci-coverage.cjs", () => {
  describe("extractEntryName", () => {
    it("skill 类型提取 Skill 名称", () => {
      expect(extractEntryName("skills/dev/SKILL.md", "skill")).toBe("/dev");
      expect(extractEntryName("skills/qa/SKILL.md", "skill")).toBe("/qa");
      expect(extractEntryName("skills/audit/SKILL.md", "skill")).toBe("/audit");
    });

    it("hook 类型提取脚本名", () => {
      expect(extractEntryName("hooks/branch-protect.sh", "hook")).toBe("branch-protect");
      expect(extractEntryName("hooks/pr-gate-v2.sh", "hook")).toBe("pr-gate-v2");
    });

    it("script 类型提取脚本名", () => {
      expect(extractEntryName("scripts/install-hooks.sh", "script")).toBe("install-hooks");
      expect(extractEntryName("scripts/deploy.sh", "script")).toBe("deploy");
    });

    it("devgate 类型提取工具名", () => {
      expect(extractEntryName("scripts/devgate/metrics.cjs", "devgate")).toBe("metrics");
      expect(extractEntryName("scripts/devgate/draft-gci.cjs", "devgate")).toBe("draft-gci");
    });
  });

  describe("enumerateEntries", () => {
    it("应该返回数组", () => {
      const entries = enumerateEntries();
      expect(Array.isArray(entries)).toBe(true);
    });

    it("应该包含 skill 类型入口", () => {
      const entries = enumerateEntries();
      const skills = entries.filter((e: any) => e.type === "skill");
      expect(skills.length).toBeGreaterThan(0);
    });

    it("应该排除 hook-core 目录", () => {
      const entries = enumerateEntries();
      const hookCore = entries.filter((e: any) => e.path.startsWith("hook-core/"));
      expect(hookCore.length).toBe(0);
    });

    it("应该排除 skills/*/scripts 目录", () => {
      const entries = enumerateEntries();
      const skillScripts = entries.filter((e: any) => /skills\/[^/]+\/scripts\//.test(e.path));
      expect(skillScripts.length).toBe(0);
    });
  });

  describe("parseRCI", () => {
    it("应该返回数组", () => {
      const contracts = parseRCI();
      expect(Array.isArray(contracts)).toBe(true);
    });

    it("应该解析 RCI 条目 ID", () => {
      const contracts = parseRCI();
      expect(contracts.length).toBeGreaterThan(0);
      expect(contracts[0].id).toMatch(/^C\d-\d{3}$/);
    });

    it("应该解析 RCI 条目名称", () => {
      const contracts = parseRCI();
      const c1001 = contracts.find((c: any) => c.id === "C1-001");
      expect(c1001).toBeDefined();
      expect(c1001.name).toContain("/dev");
    });
  });

  describe("checkCoverage", () => {
    it("被覆盖的入口应该返回 covered=true", () => {
      const entry = { type: "skill", path: "skills/dev/SKILL.md", name: "/dev" };
      const contracts = [
        { id: "C1-001", name: "/dev 流程可启动", paths: ["skills/dev/SKILL.md"] },
      ];
      const result = checkCoverage(entry, contracts);
      expect(result.covered).toBe(true);
      expect(result.by).toContain("C1-001");
    });

    it("未覆盖的入口应该返回 covered=false", () => {
      const entry = { type: "skill", path: "skills/unknown/SKILL.md", name: "/unknown" };
      const contracts = [
        { id: "C1-001", name: "/dev 流程可启动", paths: ["skills/dev/SKILL.md"] },
      ];
      const result = checkCoverage(entry, contracts);
      expect(result.covered).toBe(false);
      expect(result.by).toHaveLength(0);
    });

    it("通过 name 匹配也应该覆盖", () => {
      const entry = { type: "script", path: "scripts/install-hooks.sh", name: "install-hooks" };
      const contracts = [
        { id: "C3-003", name: "install-hooks.sh 安装成功", paths: [] },
      ];
      const result = checkCoverage(entry, contracts);
      expect(result.covered).toBe(true);
    });
  });

  describe("generateReport", () => {
    it("应该生成正确的报告结构", () => {
      const entries = [
        { type: "skill", path: "skills/dev/SKILL.md", name: "/dev" },
        { type: "skill", path: "skills/qa/SKILL.md", name: "/qa" },
      ];
      const contracts = [
        { id: "C1-001", name: "/dev 流程可启动", paths: ["skills/dev/SKILL.md"] },
      ];
      const report = generateReport(entries, contracts);

      expect(report.summary).toBeDefined();
      expect(report.summary.total).toBe(2);
      expect(report.summary.covered).toBe(1);
      expect(report.summary.uncovered).toBe(1);
      expect(report.summary.percentage).toBe(50);
      expect(report.entries).toHaveLength(2);
      expect(report.generated_at).toBeDefined();
    });

    it("100% 覆盖时百分比应该是 100", () => {
      const entries = [
        { type: "skill", path: "skills/dev/SKILL.md", name: "/dev" },
      ];
      const contracts = [
        { id: "C1-001", name: "/dev 流程", paths: ["skills/dev/SKILL.md"] },
      ];
      const report = generateReport(entries, contracts);
      expect(report.summary.percentage).toBe(100);
    });

    it("空入口时百分比应该是 100", () => {
      const report = generateReport([], []);
      expect(report.summary.percentage).toBe(100);
    });
  });
});
