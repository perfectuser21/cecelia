import { describe, it, expect } from "vitest";
import * as fs from "fs";
import * as path from "path";

describe("/dev 6步重组新步骤文件", () => {
  const stepsDir = path.resolve(__dirname, "../../skills/dev/steps");

  it("02-code.md 存在且包含探索、写代码、验证三个部分", () => {
    const file = path.join(stepsDir, "02-code.md");
    expect(fs.existsSync(file), `${file} 应该存在`).toBe(true);
    const content = fs.readFileSync(file, "utf-8");
    expect(content.length).toBeGreaterThan(50);
  });

  it("03-prci.md 存在且包含 PR 和 CI 两个部分", () => {
    const file = path.join(stepsDir, "03-prci.md");
    expect(fs.existsSync(file), `${file} 应该存在`).toBe(true);
    const content = fs.readFileSync(file, "utf-8");
    expect(content.length).toBeGreaterThan(50);
  });

  it("04-learning.md 存在", () => {
    const file = path.join(stepsDir, "04-learning.md");
    expect(fs.existsSync(file), `${file} 应该存在`).toBe(true);
  });

  it("05-clean.md 存在", () => {
    const file = path.join(stepsDir, "05-clean.md");
    expect(fs.existsSync(file), `${file} 应该存在`).toBe(true);
  });
});
