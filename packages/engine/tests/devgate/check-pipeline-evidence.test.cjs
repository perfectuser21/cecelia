#!/usr/bin/env node
/**
 * check-pipeline-evidence.test.cjs
 *
 * 用 Node.js 原生 `node:test` 框架。跑法：
 *   node --test scripts/check-pipeline-evidence.test.cjs
 *
 * 覆盖 5 个 case：
 *   1) 无 evidence 文件 → skip exit 0
 *   2) 契约全 opt-in，缺部分 → WARN exit 0
 *   3) 契约含 enforced skill 且缺失 → FAIL exit 1
 *   4) tdd_red + tdd_green 且 test_file correlation 匹配 → PASS
 *   5) tdd_green.test_file 与 tdd_red.test_file 不一致 → FAIL assert（correlation）
 */

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");

const SCRIPT_PATH = path.resolve(__dirname, "../../scripts/devgate/check-pipeline-evidence.cjs");

// ──────────────────────────────────────────────────────────────────────────
// Helpers — 构造临时仓库 fixture
// ──────────────────────────────────────────────────────────────────────────
function mkFixture(name) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), `l2-evidence-${name}-`));
  fs.mkdirSync(path.join(root, "packages/engine/contracts"), { recursive: true });
  fs.mkdirSync(path.join(root, "sprints"), { recursive: true });
  return root;
}

function writeContract(root, yamlBody) {
  const p = path.join(root, "packages/engine/contracts/superpowers-alignment.yaml");
  fs.writeFileSync(p, yamlBody);
  return p;
}

function writeEvidence(root, sprintName, records) {
  const dir = path.join(root, "sprints", sprintName);
  fs.mkdirSync(dir, { recursive: true });
  const p = path.join(dir, "pipeline-evidence.jsonl");
  fs.writeFileSync(p, records.map((r) => JSON.stringify(r)).join("\n") + "\n");
  return p;
}

function runScript(root, args = []) {
  const res = spawnSync(process.execPath, [SCRIPT_PATH, ...args], {
    env: { ...process.env, REPO_ROOT: root },
    encoding: "utf-8",
  });
  return {
    code: res.status,
    stdout: res.stdout || "",
    stderr: res.stderr || "",
  };
}

const CONTRACT_FULL_OPTIN = `
skills:
  - name: test-driven-development
    coverage_level: full
    runtime_evidence:
      mode: opt-in
      required_events:
        - event: tdd_red
          min_occurrences: 1
          assert_fields:
            - field: exit_code
              operator: "!="
              value: 0
        - event: tdd_green
          min_occurrences: 1
          assert_fields:
            - field: exit_code
              operator: "=="
              value: 0
`;

const CONTRACT_FULL_ENFORCED = `
skills:
  - name: test-driven-development
    coverage_level: full
    runtime_evidence:
      mode: enforced
      required_events:
        - event: tdd_red
          min_occurrences: 1
          assert_fields:
            - field: exit_code
              operator: "!="
              value: 0
`;

const CONTRACT_WITH_CORRELATION = `
skills:
  - name: test-driven-development
    coverage_level: full
    runtime_evidence:
      mode: enforced
      required_events:
        - event: tdd_red
          min_occurrences: 1
          assert_fields:
            - field: exit_code
              operator: "!="
              value: 0
          correlation:
            - field: test_file
              correlate_with_event: tdd_green
              operator: "=="
        - event: tdd_green
          min_occurrences: 1
          assert_fields:
            - field: exit_code
              operator: "=="
              value: 0
`;

// ──────────────────────────────────────────────────────────────────────────
// Case 1 — 无 evidence 文件 → skip exit 0
// ──────────────────────────────────────────────────────────────────────────
test("Case 1: no evidence file — skip, exit 0", () => {
  const root = mkFixture("case1");
  writeContract(root, CONTRACT_FULL_OPTIN);
  const out = runScript(root);
  assert.equal(out.code, 0, `expected exit 0, got ${out.code}\nstdout:${out.stdout}\nstderr:${out.stderr}`);
  assert.match(out.stdout, /No pipeline-evidence\.jsonl found/);
});

// ──────────────────────────────────────────────────────────────────────────
// Case 2 — 全 opt-in，部分事件缺失 → WARN exit 0
// ──────────────────────────────────────────────────────────────────────────
test("Case 2: opt-in with missing events — WARN, exit 0", () => {
  const root = mkFixture("case2");
  writeContract(root, CONTRACT_FULL_OPTIN);
  // 只发射 tdd_red，缺 tdd_green
  writeEvidence(root, "l2-dynamic-contract", [
    {
      version: 1,
      ts: "2026-04-18T10:00:00Z",
      task_id: "t1",
      branch: "cp-xxx",
      stage: "test",
      event: "tdd_red",
      test_file: "foo.test.ts",
      exit_code: 1,
    },
  ]);
  const out = runScript(root);
  assert.equal(out.code, 0, `expected exit 0 on opt-in miss, got ${out.code}\n${out.stdout}\n${out.stderr}`);
  assert.match(out.stdout, /opt-in/);
  assert.match(out.stdout, /WARN|not failing/);
});

// ──────────────────────────────────────────────────────────────────────────
// Case 3 — 契约 enforced 且缺失 → FAIL exit 1
// ──────────────────────────────────────────────────────────────────────────
test("Case 3: enforced with missing event — FAIL, exit 1", () => {
  const root = mkFixture("case3");
  writeContract(root, CONTRACT_FULL_ENFORCED);
  // 空事件（故意发一条无关事件占位）
  writeEvidence(root, "l2-dynamic-contract", [
    {
      version: 1,
      ts: "2026-04-18T10:00:00Z",
      task_id: "t1",
      branch: "cp-xxx",
      stage: "plan",
      event: "plan_created",
    },
  ]);
  const out = runScript(root);
  assert.equal(out.code, 1, `expected exit 1 on enforced fail, got ${out.code}\n${out.stdout}`);
  assert.match(out.stdout, /\[FAIL\]/);
  assert.match(out.stdout, /enforced/);
});

// ──────────────────────────────────────────────────────────────────────────
// Case 4 — tdd_red + tdd_green 且 correlation 匹配 → PASS
// ──────────────────────────────────────────────────────────────────────────
test("Case 4: tdd_red + tdd_green correlated — PASS, exit 0", () => {
  const root = mkFixture("case4");
  writeContract(root, CONTRACT_WITH_CORRELATION);
  writeEvidence(root, "l2-dynamic-contract", [
    {
      version: 1,
      ts: "2026-04-18T10:00:00Z",
      task_id: "t1",
      branch: "cp-xxx",
      stage: "test",
      event: "tdd_red",
      test_file: "foo.test.ts",
      exit_code: 1,
    },
    {
      version: 1,
      ts: "2026-04-18T10:05:00Z",
      task_id: "t1",
      branch: "cp-xxx",
      stage: "test",
      event: "tdd_green",
      test_file: "foo.test.ts",
      exit_code: 0,
    },
  ]);
  const out = runScript(root, ["--verbose"]);
  assert.equal(out.code, 0, `expected exit 0, got ${out.code}\n${out.stdout}\n${out.stderr}`);
  assert.match(out.stdout, /\[OK\]/);
  assert.match(out.stdout, /correlation/);
});

// ──────────────────────────────────────────────────────────────────────────
// Case 5 — tdd_green.test_file 不匹配 tdd_red.test_file → FAIL (enforced)
// ──────────────────────────────────────────────────────────────────────────
test("Case 5: correlation mismatch — FAIL, exit 1", () => {
  const root = mkFixture("case5");
  writeContract(root, CONTRACT_WITH_CORRELATION);
  writeEvidence(root, "l2-dynamic-contract", [
    {
      version: 1,
      ts: "2026-04-18T10:00:00Z",
      task_id: "t1",
      branch: "cp-xxx",
      stage: "test",
      event: "tdd_red",
      test_file: "foo.test.ts",
      exit_code: 1,
    },
    {
      version: 1,
      ts: "2026-04-18T10:05:00Z",
      task_id: "t1",
      branch: "cp-xxx",
      stage: "test",
      event: "tdd_green",
      test_file: "bar.test.ts", // ← 故意不一致
      exit_code: 0,
    },
  ]);
  const out = runScript(root);
  assert.equal(out.code, 1, `expected exit 1 on correlation mismatch, got ${out.code}\n${out.stdout}`);
  assert.match(out.stdout, /correlation/);
  assert.match(out.stdout, /\[FAIL\]/);
});

// ──────────────────────────────────────────────────────────────────────────
// 单元级 — minimalYamlParse 基本能力（直接 require）
// ──────────────────────────────────────────────────────────────────────────
test("Unit: minimalYamlParse handles nested mapping + sequence + assert_fields", () => {
  const { minimalYamlParse, extractFullSkills } = require(SCRIPT_PATH);
  const parsed = minimalYamlParse(CONTRACT_FULL_OPTIN);
  const skills = extractFullSkills(parsed);
  assert.equal(skills.length, 1);
  assert.equal(skills[0].name, "test-driven-development");
  assert.equal(skills[0].runtime_evidence.mode, "opt-in");
  assert.equal(skills[0].runtime_evidence.required_events.length, 2);
  const red = skills[0].runtime_evidence.required_events[0];
  assert.equal(red.event, "tdd_red");
  assert.equal(red.min_occurrences, 1);
  assert.equal(red.assert_fields[0].field, "exit_code");
  assert.equal(red.assert_fields[0].operator, "!=");
  assert.equal(red.assert_fields[0].value, 0);
});

test("Unit: compare operators", () => {
  const { compare } = require(SCRIPT_PATH);
  assert.equal(compare(0, "==", 0), true);
  assert.equal(compare(1, "!=", 0), true);
  assert.equal(compare(5, ">", 3), true);
  assert.equal(compare("foo.test.ts", "==", "foo.test.ts"), true);
  assert.equal(compare("foo.test.ts", "==", "bar.test.ts"), false);
  assert.equal(compare("tdd_red", "in", ["tdd_red", "tdd_green"]), true);
});
