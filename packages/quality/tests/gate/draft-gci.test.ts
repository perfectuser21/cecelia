import { describe, it, expect } from "vitest";

// 直接导入模块函数进行单元测试
const { isGateFile, getCategory, generateDraft } = require("../../scripts/devgate/draft-gci.cjs");

describe("draft-gci.cjs", () => {
  describe("isGateFile", () => {
    it("应该识别 hooks/ 下的文件", () => {
      expect(isGateFile("hooks/branch-protect.sh")).toBe(true);
      expect(isGateFile("hooks/pr-gate-v2.sh")).toBe(true);
    });

    it("应该识别 scripts/devgate/ 下的文件", () => {
      expect(isGateFile("scripts/devgate/detect-priority.cjs")).toBe(true);
      expect(isGateFile("scripts/devgate/metrics.cjs")).toBe(true);
    });

    it("应该识别 tests/gate/ 下的文件", () => {
      expect(isGateFile("tests/gate/gate.test.ts")).toBe(true);
    });

    it("应该识别 run-gate-tests.sh", () => {
      expect(isGateFile("scripts/run-gate-tests.sh")).toBe(true);
    });

    it("应该识别 ci.yml", () => {
      expect(isGateFile(".github/workflows/ci.yml")).toBe(true);
    });

    it("应该识别 gate-contract.yaml", () => {
      expect(isGateFile("contracts/gate-contract.yaml")).toBe(true);
    });

    it("不应该识别业务文件", () => {
      expect(isGateFile("src/index.ts")).toBe(false);
      expect(isGateFile("pages/home.tsx")).toBe(false);
      expect(isGateFile("contracts/regression-contract.yaml")).toBe(false);
    });

    it("不应该识别 skills 文件", () => {
      expect(isGateFile("skills/dev/SKILL.md")).toBe(false);
      expect(isGateFile("skills/assurance/SKILL.md")).toBe(false);
    });
  });

  describe("getCategory", () => {
    it("pr-gate 应该映射到 G1", () => {
      const result = getCategory("hooks/pr-gate-v2.sh");
      expect(result.category).toBe("G1");
    });

    it("branch-protect 应该映射到 G6", () => {
      const result = getCategory("hooks/branch-protect.sh");
      expect(result.category).toBe("G6");
    });

    it("detect-priority 应该映射到 G3", () => {
      const result = getCategory("scripts/devgate/detect-priority.cjs");
      expect(result.category).toBe("G3");
    });

    it("ci.yml 应该映射到 G4", () => {
      const result = getCategory(".github/workflows/ci.yml");
      expect(result.category).toBe("G4");
    });

    it("其他 devgate 脚本应该映射到 G5", () => {
      const result = getCategory("scripts/devgate/metrics.cjs");
      expect(result.category).toBe("G5");
    });
  });

  describe("generateDraft", () => {
    it("应该生成新增类型的草稿", () => {
      const diff = { added: ["const x = 1"], removed: [], functions: ["test"] };
      const draft = generateDraft("hooks/test.sh", diff);

      expect(draft.id).toMatch(/^G\d-NEW$/);
      expect(draft.name).toContain("新增");
      expect(draft.priority).toBe("P1");
      expect(draft.trigger).toContain("PR");
      expect(draft.scenario).toBeDefined();
      expect(draft.reason).toContain("hooks/test.sh");
    });

    it("应该生成修改类型的草稿", () => {
      const diff = { added: ["const x = 1"], removed: ["const y = 2"], functions: [] };
      const draft = generateDraft("scripts/devgate/test.cjs", diff);

      expect(draft.name).toContain("修改");
    });

    it("应该生成删除类型的草稿", () => {
      const diff = { added: [], removed: ["const y = 2"], functions: [] };
      const draft = generateDraft("tests/gate/test.ts", diff);

      expect(draft.name).toContain("删除");
    });

    it("应该包含元信息", () => {
      const diff = { added: ["a", "b"], removed: ["c"], functions: ["fn1"] };
      const draft = generateDraft("hooks/test.sh", diff);

      expect(draft._meta).toBeDefined();
      expect(draft._meta.addedLines).toBe(2);
      expect(draft._meta.removedLines).toBe(1);
      expect(draft._meta.functions).toContain("fn1");
    });

    it("应该识别错误处理相关改动", () => {
      const diff = { added: ["throw new Error('fail')"], removed: [], functions: [] };
      const draft = generateDraft("hooks/test.sh", diff);

      expect(draft.scenario.then).toContain("错误");
    });

    it("应该识别验证逻辑相关改动", () => {
      const diff = { added: ["if (isValid(x))"], removed: [], functions: ["isValid"] };
      const draft = generateDraft("hooks/test.sh", diff);

      expect(draft.scenario.then).toContain("验证");
    });
  });
});
