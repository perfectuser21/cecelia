/**
 * stop-dev.sh — report_step_to_brain 函数测试
 *
 * 验证 PR #964 新增的 Brain 步骤状态回写功能：
 * - report_step_to_brain() 从 .dev-mode 读取 brain_task_id（优先）或 task_id（fallback）
 * - 正确解析当前步骤编号和步骤名称
 * - 没有 task ID 时静默返回，不调用 curl
 */

import { describe, it, expect } from "vitest";
import { execSync } from "child_process";
import { existsSync, readFileSync } from "fs";
import { resolve } from "path";

const STOP_DEV_PATH = resolve(__dirname, "../../hooks/stop-dev.sh");

// v16.0.0: report_step_to_brain 已从 stop-dev.sh 删除（Engine 重构），相关测试 skip
describe.skip("stop-dev.sh — report_step_to_brain (PR #964)", () => {
  it("stop-dev.sh 存在且可执行", () => {
    expect(existsSync(STOP_DEV_PATH)).toBe(true);
    expect(() => execSync(`test -x "${STOP_DEV_PATH}"`, { encoding: "utf-8" })).not.toThrow();
  });

  it("包含 report_step_to_brain 函数定义", () => {
    const content = readFileSync(STOP_DEV_PATH, "utf-8");
    expect(content).toContain("report_step_to_brain()");
  });

  it("优先读取 brain_task_id 而不是 task_id", () => {
    const content = readFileSync(STOP_DEV_PATH, "utf-8");
    // brain_task_id 应该在 task_id 之前被尝试读取
    const brainTaskIdIdx = content.indexOf("brain_task_id:");
    const taskIdIdx = content.indexOf('"^task_id:"');
    expect(brainTaskIdIdx).toBeGreaterThan(-1);
    // brain_task_id grep 应该出现在 task_id fallback 之前
    const reportFuncStart = content.indexOf("report_step_to_brain()");
    const brainIdInFunc = content.indexOf("brain_task_id", reportFuncStart);
    const taskIdInFunc = content.indexOf("task_id:", reportFuncStart);
    expect(brainIdInFunc).toBeGreaterThan(-1);
    expect(brainIdInFunc).toBeLessThan(taskIdInFunc);
  });

  it("无 task ID 时不调用 curl（早期返回）", () => {
    const content = readFileSync(STOP_DEV_PATH, "utf-8");
    // 函数应该有在 task_id 为空时的 return 逻辑
    const reportFuncMatch = content.match(
      /report_step_to_brain\(\)\s*\{([\s\S]*?)\n\}/
    );
    expect(reportFuncMatch).not.toBeNull();
    if (reportFuncMatch) {
      const funcBody = reportFuncMatch[1];
      // 应该有 -z "$task_id" 检查然后 return
      expect(funcBody).toMatch(/-z.*task_id.*return/s);
    }
  });

  it("调用 Brain PATCH API 端点（/api/brain/tasks/）", () => {
    const content = readFileSync(STOP_DEV_PATH, "utf-8");
    expect(content).toContain("/api/brain/tasks/");
    expect(content).toContain("custom_props");
  });

  it("包含步骤编号和步骤名称的 JSON payload", () => {
    const content = readFileSync(STOP_DEV_PATH, "utf-8");
    // payload 应该包含 dev_step 和 dev_step_name 字段
    expect(content).toContain("dev_step");
    expect(content).toContain("dev_step_name");
  });

  it("回写调用容错（--max-time 或 || true）", () => {
    const content = readFileSync(STOP_DEV_PATH, "utf-8");
    // curl 调用应该有超时设置
    const hasCurlTimeout = content.includes("--max-time") || content.includes("-m 3");
    expect(hasCurlTimeout).toBe(true);
  });
});
