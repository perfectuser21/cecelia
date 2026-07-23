#!/usr/bin/env node
/**
 * tests/light-evaluator.test.cjs
 *
 * TDD 合同 commit 1 = Red 状态
 * 验证 DoD B-01 ~ B-08 的 8 条 [BEHAVIOR] 断言
 *
 * 运行：node sprints/07161830-dev-ab-light-evaluator/tests/light-evaluator.test.cjs
 * 预期（实现前）：全部 FAIL → 全绿后合同履行完毕
 */

"use strict";

const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

const WORKSPACE = path.resolve(__dirname, "../../..");
const RED = "\x1b[31m";
const GREEN = "\x1b[32m";
const YELLOW = "\x1b[33m";
const RESET = "\x1b[0m";

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    console.log(`${GREEN}✓ PASS${RESET} ${name}`);
    passed++;
  } catch (e) {
    console.log(`${RED}✗ FAIL${RESET} ${name}`);
    console.log(`  ${YELLOW}→ ${e.message}${RESET}`);
    failed++;
  }
}

function assert(condition, msg) {
  if (!condition) throw new Error(msg || "assertion failed");
}

// ─────────────────────────────────────────────────────────────────────────────
// B-01: light-evaluator.md 步骤文件存在且含 BEHAVIOR 关键词
// ─────────────────────────────────────────────────────────────────────────────
test("B-01: light-evaluator.md 存在", () => {
  const p = path.join(WORKSPACE, "packages/engine/skills/dev/steps/light-evaluator.md");
  assert(fs.existsSync(p), `文件不存在: ${p}`);
});

test("B-01b: light-evaluator.md 包含 BEHAVIOR 关键词", () => {
  const p = path.join(WORKSPACE, "packages/engine/skills/dev/steps/light-evaluator.md");
  assert(fs.existsSync(p), `文件不存在: ${p}`);
  const content = fs.readFileSync(p, "utf-8");
  assert(content.includes("BEHAVIOR"), "文件不含 BEHAVIOR 关键词");
});

// ─────────────────────────────────────────────────────────────────────────────
// B-02: SKILL.md 引用了 light-evaluator
// ─────────────────────────────────────────────────────────────────────────────
test("B-02: SKILL.md 引用 light-evaluator", () => {
  const p = path.join(WORKSPACE, "packages/engine/skills/dev/SKILL.md");
  assert(fs.existsSync(p), `SKILL.md 不存在: ${p}`);
  const content = fs.readFileSync(p, "utf-8");
  assert(content.includes("light-evaluator"), "SKILL.md 未引用 light-evaluator");
});

// ─────────────────────────────────────────────────────────────────────────────
// B-03: engine package.json 版本为 19.5.0
// ─────────────────────────────────────────────────────────────────────────────
test("B-03: engine package.json 版本 >= 19.5.0（light-evaluator 引入版本）", () => {
  const p = path.join(WORKSPACE, "packages/engine/package.json");
  const pkg = JSON.parse(fs.readFileSync(p, "utf-8"));
  const parts = pkg.version.split(".").map(Number);
  const base = [19, 5, 0];
  const gte = parts[0] > base[0] || (parts[0] === base[0] && parts[1] > base[1]) ||
    (parts[0] === base[0] && parts[1] === base[1] && parts[2] >= base[2]);
  assert(gte, `版本不对: 期望 >= 19.5.0，实际 ${pkg.version}`);
});

// ─────────────────────────────────────────────────────────────────────────────
// B-04: CHANGELOG.md 顶部含 [19.5.0] 条目
// ─────────────────────────────────────────────────────────────────────────────
test("B-04: CHANGELOG.md 含 [19.5.0] 条目", () => {
  const p = path.join(WORKSPACE, "packages/engine/CHANGELOG.md");
  assert(fs.existsSync(p), `CHANGELOG.md 不存在: ${p}`);
  const content = fs.readFileSync(p, "utf-8");
  assert(content.includes("[19.5.0]"), "CHANGELOG.md 未含 [19.5.0] 条目");
});

// ─────────────────────────────────────────────────────────────────────────────
// B-05: feature-registry.yml 含 light-evaluator 条目
// ─────────────────────────────────────────────────────────────────────────────
test("B-05: feature-registry.yml 含 light-evaluator", () => {
  const p = path.join(WORKSPACE, "packages/engine/feature-registry.yml");
  assert(fs.existsSync(p), `feature-registry.yml 不存在: ${p}`);
  const content = fs.readFileSync(p, "utf-8");
  assert(content.includes("light-evaluator"), "feature-registry.yml 未含 light-evaluator");
});

// ─────────────────────────────────────────────────────────────────────────────
// B-06: 豁免路径 — 无 [BEHAVIOR] DoD 写 skipped 记录
// ─────────────────────────────────────────────────────────────────────────────
test("B-06: 轻量 evaluator 脚本可加载", () => {
  const p = path.join(WORKSPACE, "packages/engine/scripts/devgate/light-evaluator.cjs");
  assert(fs.existsSync(p), `light-evaluator.cjs 不存在: ${p}`);
});

test("B-06b: 豁免路径输出 skipped 标记", () => {
  const scriptPath = path.join(WORKSPACE, "packages/engine/scripts/devgate/light-evaluator.cjs");
  assert(fs.existsSync(scriptPath), `light-evaluator.cjs 不存在: ${scriptPath}`);

  // 构造一个无 [BEHAVIOR] 的临时 DoD 文件
  const os = require("os");
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "eval-test-"));
  const tmpDod = path.join(tmpDir, "contract-dod-ws1.md");
  fs.writeFileSync(tmpDod, "# DoD\n\n## [ARTIFACT] 只有工件条目\n\n不含 BEHAVIOR\n");

  try {
    const result = execSync(
      `node ${scriptPath} --sprint-dir ${tmpDir} 2>&1`,
      { encoding: "utf-8", timeout: 10000 }
    );
    assert(
      result.includes("skipped") || result.includes("豁免") || result.includes("no [BEHAVIOR]"),
      `输出未含豁免标记，实际输出: ${result.slice(0, 200)}`
    );
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// B-07: light-evaluator.cjs 存在且可被 node 加载
// ─────────────────────────────────────────────────────────────────────────────
test("B-07: light-evaluator.cjs 存在", () => {
  const p = path.join(WORKSPACE, "packages/engine/scripts/devgate/light-evaluator.cjs");
  assert(fs.existsSync(p), `light-evaluator.cjs 不存在: ${p}`);
});

// ─────────────────────────────────────────────────────────────────────────────
// B-08: 本测试文件自身存在（TDD 合同 commit 1 验证）
// ─────────────────────────────────────────────────────────────────────────────
test("B-08: 本测试文件已毕业至 regression 目录", () => {
  const p = path.join(WORKSPACE, "tests/regression/dev-ab-light-evaluator/light-evaluator.test.cjs");
  assert(fs.existsSync(p), `测试文件不存在: ${p}`);
});

// ─────────────────────────────────────────────────────────────────────────────
// 汇总
// ─────────────────────────────────────────────────────────────────────────────
console.log("");
console.log(`─────────────────────────────────────`);
console.log(`合计: ${passed + failed} 条，${GREEN}${passed} PASS${RESET}，${RED}${failed} FAIL${RESET}`);
console.log(`─────────────────────────────────────`);

// 注：本文件是 plain-node 合同脚本，已改名 .check.cjs 移出 vitest glob（CJS 无法 require vitest）
if (failed > 0) {
  console.log(`${RED}[合同 commit 1 = Red] 预期失败 — 实现后重跑应全绿${RESET}`);
  process.exit(1);
} else {
  console.log(`${GREEN}[全绿] 所有断言通过${RESET}`);
  process.exit(0);
}
