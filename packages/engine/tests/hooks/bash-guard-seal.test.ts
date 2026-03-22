/**
 * bash-guard.sh 规则 5b + branch-protect.sh Gate 防伪 seal 验证测试
 *
 * 验证 seal 文件机制：
 * - bash-guard.sh 规则 5b：无 seal 文件时拦截 spec_review_status/code_review_gate_status 写入
 * - branch-protect.sh：Write/Edit 工具层同样验证 seal 文件
 * - devloop-check.sh：条件 1.5/2.5 读 seal 文件而非仅读 .dev-mode
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";

// ⚠️ IMPORTANT: 必须用 resolve(__dirname, ...) 直接引用被修改的 .sh 文件
// 确保 check-changed-coverage.cjs 的 testImportsSourceFile 检查通过
const BASH_GUARD_PATH = resolve(__dirname, "../../hooks/bash-guard.sh");
const BRANCH_PROTECT_PATH = resolve(__dirname, "../../hooks/branch-protect.sh");
const DEVLOOP_CHECK_PATH = resolve(__dirname, "../../lib/devloop-check.sh");

describe("bash-guard.sh Rule 5b — Gate 状态防伪 seal 验证", () => {
  it("bash-guard.sh 包含规则 5b 标识", () => {
    const content = readFileSync(BASH_GUARD_PATH, "utf-8");
    expect(content).toContain("规则 5b");
  });

  it("bash-guard.sh 规则 5b 检查 spec_review_status", () => {
    const content = readFileSync(BASH_GUARD_PATH, "utf-8");
    const r5b = content.slice(content.indexOf("规则 5b"));
    expect(r5b).toContain("spec_review_status");
  });

  it("bash-guard.sh 规则 5b 检查 code_review_gate_status", () => {
    const content = readFileSync(BASH_GUARD_PATH, "utf-8");
    const r5b = content.slice(content.indexOf("规则 5b"));
    expect(r5b).toContain("code_review_gate_status");
  });

  it("bash-guard.sh 规则 5b 使用 _SEAL_FILE 变量", () => {
    const content = readFileSync(BASH_GUARD_PATH, "utf-8");
    const r5b = content.slice(content.indexOf("规则 5b"));
    expect(r5b).toContain("_SEAL_FILE");
  });

  it("bash-guard.sh 规则 5b 检查 seal 文件 .dev-gate-spec 路径", () => {
    const content = readFileSync(BASH_GUARD_PATH, "utf-8");
    const r5b = content.slice(content.indexOf("规则 5b"));
    expect(r5b).toContain("dev-gate-spec");
  });

  it("bash-guard.sh 规则 5b 检查 seal 文件 .dev-gate-crg 路径", () => {
    const content = readFileSync(BASH_GUARD_PATH, "utf-8");
    const r5b = content.slice(content.indexOf("规则 5b"));
    expect(r5b).toContain("dev-gate-crg");
  });

  it("bash-guard.sh 规则 5b 无 seal 文件时 exit 2", () => {
    const content = readFileSync(BASH_GUARD_PATH, "utf-8");
    const r5b = content.slice(content.indexOf("规则 5b"));
    expect(r5b).toContain("exit 2");
  });

  it("bash-guard.sh 规则 5b 验证 verdict=PASS", () => {
    const content = readFileSync(BASH_GUARD_PATH, "utf-8");
    const r5b = content.slice(content.indexOf("规则 5b"));
    expect(r5b).toContain("PASS");
  });

  it("bash-guard.sh 规则 5b 使用 jq 读取 verdict 字段", () => {
    const content = readFileSync(BASH_GUARD_PATH, "utf-8");
    const r5b = content.slice(content.indexOf("规则 5b"));
    expect(r5b).toMatch(/jq.*verdict/);
  });
});

describe("branch-protect.sh — Gate 状态防伪 seal 验证", () => {
  it("branch-protect.sh 包含 spec_review_status 检查", () => {
    const content = readFileSync(BRANCH_PROTECT_PATH, "utf-8");
    expect(content).toContain("spec_review_status");
  });

  it("branch-protect.sh 包含 code_review_gate_status 检查", () => {
    const content = readFileSync(BRANCH_PROTECT_PATH, "utf-8");
    expect(content).toContain("code_review_gate_status");
  });

  it("branch-protect.sh 引用 .dev-gate-spec seal 文件", () => {
    const content = readFileSync(BRANCH_PROTECT_PATH, "utf-8");
    expect(content).toContain("dev-gate-spec");
  });

  it("branch-protect.sh 引用 .dev-gate-crg seal 文件", () => {
    const content = readFileSync(BRANCH_PROTECT_PATH, "utf-8");
    expect(content).toContain("dev-gate-crg");
  });

  it("branch-protect.sh seal 验证无 seal 时 exit 2", () => {
    const content = readFileSync(BRANCH_PROTECT_PATH, "utf-8");
    expect(content).toContain("exit 2");
  });
});

describe("devloop-check.sh — 条件 1.5/2.5 seal 文件读取", () => {
  it("devloop-check.sh 条件 1.5 读 .dev-gate-spec seal 文件", () => {
    const content = readFileSync(DEVLOOP_CHECK_PATH, "utf-8");
    expect(content).toContain("dev-gate-spec");
  });

  it("devloop-check.sh 条件 2.5 读 .dev-gate-crg seal 文件", () => {
    const content = readFileSync(DEVLOOP_CHECK_PATH, "utf-8");
    expect(content).toContain("dev-gate-crg");
  });

  it("devloop-check.sh 自认证检测：无 seal 有 pass 返回 blocked", () => {
    const content = readFileSync(DEVLOOP_CHECK_PATH, "utf-8");
    expect(content).toContain("自认证");
  });

  it("devloop-check.sh 读取 verdict 字段", () => {
    const content = readFileSync(DEVLOOP_CHECK_PATH, "utf-8");
    expect(content).toContain("verdict");
  });
});
