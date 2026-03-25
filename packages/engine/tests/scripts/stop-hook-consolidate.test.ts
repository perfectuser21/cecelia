/**
 * tests/scripts/stop-hook-consolidate.test.ts
 *
 * 验证 stop.sh v14.2.0 普通对话结束时主动触发 conversation-consolidator
 *
 * === v14.2.0 ===
 * P1: 普通对话（无 mode 文件）exit 0 前触发 consolidate API（fire-and-forget）
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";

const PROJECT_ROOT = resolve(__dirname, "../..");
const STOP_SH = resolve(PROJECT_ROOT, "hooks/stop.sh");

describe("stop.sh v14.2.0 consolidate 触发", () => {
  it("stop.sh 存在", () => {
    expect(() => readFileSync(STOP_SH, "utf8")).not.toThrow();
  });

  it("包含 consolidate API curl 调用", () => {
    const content = readFileSync(STOP_SH, "utf8");
    expect(content).toContain("/api/brain/consolidate");
  });

  it("curl 调用使用 --max-time 3 确保不阻塞", () => {
    const content = readFileSync(STOP_SH, "utf8");
    expect(content).toContain("--max-time 3");
  });

  it("curl 调用使用 || true 确保 fire-and-forget", () => {
    const content = readFileSync(STOP_SH, "utf8");
    expect(content).toContain("|| true");
  });

  it("consolidate 调用在最终 exit 0 之前（普通对话路径）", () => {
    const content = readFileSync(STOP_SH, "utf8");
    const consolidateIdx = content.indexOf("/api/brain/consolidate");
    // 用 lastIndexOf 找最后一个 exit 0（实际执行语句，非注释）
    const exitIdx = content.lastIndexOf("\nexit 0");
    expect(consolidateIdx).toBeGreaterThan(0);
    expect(exitIdx).toBeGreaterThan(consolidateIdx);
  });

  it("版本注释标记为 v14.2.0", () => {
    const content = readFileSync(STOP_SH, "utf8");
    expect(content).toContain("v14.2.0");
  });
});
