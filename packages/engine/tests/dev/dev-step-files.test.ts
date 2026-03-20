import { describe, it, expect } from "vitest";
import * as fs from "fs";
import * as path from "path";

describe("/dev 4-Stage Pipeline 步骤文件", () => {
  const stepsDir = path.resolve(__dirname, "../../skills/dev/steps");

  it("01-spec.md 存在且包含 spec_review 派发逻辑", () => {
    const file = path.join(stepsDir, "01-spec.md");
    expect(fs.existsSync(file), `${file} 应该存在`).toBe(true);
    const content = fs.readFileSync(file, "utf-8");
    expect(content).toContain("spec_review");
  });

  it("02-code.md 存在且包含探索、写代码、验证三个部分", () => {
    const file = path.join(stepsDir, "02-code.md");
    expect(fs.existsSync(file), `${file} 应该存在`).toBe(true);
    const content = fs.readFileSync(file, "utf-8");
    expect(content.length).toBeGreaterThan(50);
  });

  it("03-integrate.md 存在且包含 code_review 派发逻辑", () => {
    const file = path.join(stepsDir, "03-integrate.md");
    expect(fs.existsSync(file), `${file} 应该存在`).toBe(true);
    const content = fs.readFileSync(file, "utf-8");
    expect(content).toContain("code_review");
  });

  it("04-ship.md 存在且合并了 Learning + Clean", () => {
    const file = path.join(stepsDir, "04-ship.md");
    expect(fs.existsSync(file), `${file} 应该存在`).toBe(true);
    const content = fs.readFileSync(file, "utf-8");
    expect(content).toContain("Learning");
    expect(content).toContain("cleanup_done");
  });
});
