#!/usr/bin/env node
/**
 * check-pipeline-evidence.cjs
 *
 * L2 动态契约 CI gate：验证 sprint 运行时产生的 pipeline-evidence.jsonl
 * 是否满足 superpowers-alignment.yaml 中 `runtime_evidence` 定义的要求。
 *
 * 与 L1 `check-superpowers-alignment.cjs` 姊妹 gate 的分工：
 *   - L1：静态引用覆盖（skill 是否被 SKILL.md / plan / code 引用）
 *   - L2：动态证据覆盖（skill 是否真的在 pipeline 里跑过，发射预期事件）
 *
 * 用法：
 *   node scripts/check-pipeline-evidence.cjs [--verbose]
 *
 * 退出码：
 *   0 — 全通过 / 仅 opt-in skill 有缺失（WARN） / 无 evidence 文件（跳过）
 *   1 — 有 enforced skill 未满足要求（FAIL）
 *
 * 环境变量：
 *   REPO_ROOT  仓库根目录（默认用 git rev-parse 推导；否则脚本所在目录上两级）
 *
 * Evidence JSONL 格式（每行一个 JSON）：
 *   { "version": 1, "ts": "...", "task_id": "...", "branch": "...",
 *     "stage": "...", "event": "tdd_red",
 *     "test_file": "...", "exit_code": 1, ... }
 *
 * runtime_evidence 契约片段（每个 full skill 可选字段）：
 *   runtime_evidence:
 *     mode: opt-in              # opt-in | enforced
 *     required_events:
 *       - event: tdd_red
 *         min_occurrences: 1
 *         assert_fields:
 *           - field: exit_code
 *             operator: "!="
 *             value: 0
 *         correlation:
 *           - field: test_file
 *             correlate_with_event: tdd_green
 *             operator: "=="
 */

"use strict";

const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

const VERBOSE = process.argv.includes("--verbose");

// ──────────────────────────────────────────────────────────────────────────
// Repo root 解析
// ──────────────────────────────────────────────────────────────────────────
function resolveRepoRoot() {
  if (process.env.REPO_ROOT && fs.existsSync(process.env.REPO_ROOT)) {
    return path.resolve(process.env.REPO_ROOT);
  }
  try {
    const out = execSync("git rev-parse --show-toplevel", {
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    if (out) return out;
  } catch (_) {
    // ignore
  }
  return path.resolve(__dirname, "..");
}

const REPO_ROOT = resolveRepoRoot();
const CONTRACT_PATH = path.join(
  REPO_ROOT,
  "packages/engine/contracts/superpowers-alignment.yaml"
);
const SPRINTS_DIR = path.join(REPO_ROOT, "sprints");

// ──────────────────────────────────────────────────────────────────────────
// Minimal YAML parser (与 L1 check-superpowers-alignment.cjs 同款风格)
// 支持：
//   - 嵌套 mapping（缩进 2 空格）
//   - 序列（`- ` 前缀）
//   - 标量（string / number / bool / null）
//   - `|` block scalar
// 不支持：anchors/aliases/flow style/tag —— 契约文件不需要
// ──────────────────────────────────────────────────────────────────────────
function tryRequireYaml() {
  try {
    return require("js-yaml");
  } catch (_) {
    return null;
  }
}

function parseScalar(raw) {
  if (raw === undefined) return null;
  const s = String(raw).trim();
  if (s === "" || s === "~" || s === "null") return null;
  if (s === "true") return true;
  if (s === "false") return false;
  if (/^-?\d+$/.test(s)) return parseInt(s, 10);
  if (/^-?\d*\.\d+$/.test(s)) return parseFloat(s);
  // quoted string
  if (/^"(.*)"$/.test(s)) return s.slice(1, -1).replace(/\\"/g, '"');
  if (/^'(.*)'$/.test(s)) return s.slice(1, -1);
  return s;
}

function minimalYamlParse(text) {
  const rawLines = text.split(/\r?\n/);
  // 预处理：去注释行和尾部注释，保留纯字符串（引号内 #）场景简单处理
  const lines = [];
  for (const line of rawLines) {
    if (/^\s*#/.test(line)) {
      lines.push(""); // 保留行号语义为空
      continue;
    }
    lines.push(line.replace(/\s+#.*$/, ""));
  }

  let idx = 0;

  function peekIndent() {
    while (idx < lines.length && lines[idx].trim() === "") idx++;
    if (idx >= lines.length) return -1;
    const m = lines[idx].match(/^(\s*)/);
    return m ? m[1].length : 0;
  }

  function parseBlockScalar(indent) {
    // `|` 块：取所有缩进 > indent 的行，按相对缩进拼接
    const out = [];
    let baseIndent = -1;
    while (idx < lines.length) {
      const line = lines[idx];
      if (line.trim() === "") {
        out.push("");
        idx++;
        continue;
      }
      const m = line.match(/^(\s*)/);
      const curIndent = m[1].length;
      if (curIndent <= indent) break;
      if (baseIndent < 0) baseIndent = curIndent;
      out.push(line.slice(baseIndent));
      idx++;
    }
    // 去末尾空行
    while (out.length && out[out.length - 1] === "") out.pop();
    return out.join("\n");
  }

  function parseValue(indent) {
    // 期望 idx 处已经跳过空行；由调用者保证
    if (idx >= lines.length) return null;
    const line = lines[idx];
    const trimmed = line.trim();
    // Sequence 开始
    if (/^-(\s|$)/.test(trimmed)) {
      return parseSequence(indent);
    }
    // Mapping 开始
    if (/^[^\s].*:/.test(trimmed) || /^[^:]+:/.test(trimmed)) {
      return parseMapping(indent);
    }
    // 纯标量行（少见）
    idx++;
    return parseScalar(trimmed);
  }

  function parseMapping(indent) {
    const obj = {};
    while (idx < lines.length) {
      // 跳过空行
      while (idx < lines.length && lines[idx].trim() === "") idx++;
      if (idx >= lines.length) break;
      const line = lines[idx];
      const m = line.match(/^(\s*)(.*)$/);
      const curIndent = m[1].length;
      const content = m[2];
      if (curIndent < indent) break;
      if (curIndent > indent) {
        // 不应发生；防御性跳过
        idx++;
        continue;
      }
      // 当前行
      const kv = content.match(/^([A-Za-z0-9_\-.\$][\w\-./$]*)\s*:\s*(.*)$/);
      if (!kv) {
        // 不是 mapping 键——可能是 sequence 的 dash 行，让上层处理
        break;
      }
      const key = kv[1];
      const rest = kv[2];
      idx++;
      if (rest === "" || rest === null || rest === undefined) {
        // 子结构
        // 跳空行后检查子缩进
        let saveIdx = idx;
        while (idx < lines.length && lines[idx].trim() === "") idx++;
        if (idx >= lines.length) {
          obj[key] = null;
          continue;
        }
        const childLine = lines[idx];
        const cm = childLine.match(/^(\s*)/);
        const childIndent = cm[1].length;
        if (childIndent <= curIndent) {
          obj[key] = null;
          idx = saveIdx; // 不消费，留给外层
          // 但上面已经消费到非空；恢复到空行前以免无限循环
          // 简单起见继续下一轮
          continue;
        }
        obj[key] = parseValue(childIndent);
      } else if (rest === "|") {
        // Block scalar
        obj[key] = parseBlockScalar(curIndent);
      } else if (rest.startsWith("[") || rest.startsWith("{")) {
        // Flow 样式——简化：解析为字符串
        obj[key] = rest;
      } else {
        obj[key] = parseScalar(rest);
      }
    }
    return obj;
  }

  function parseSequence(indent) {
    const arr = [];
    while (idx < lines.length) {
      while (idx < lines.length && lines[idx].trim() === "") idx++;
      if (idx >= lines.length) break;
      const line = lines[idx];
      const m = line.match(/^(\s*)(.*)$/);
      const curIndent = m[1].length;
      const content = m[2];
      if (curIndent < indent) break;
      if (curIndent > indent) {
        idx++;
        continue;
      }
      if (!/^-(\s|$)/.test(content)) break;
      const after = content.replace(/^-\s?/, "");
      idx++;
      if (after === "") {
        // 子结构
        let saveIdx = idx;
        while (idx < lines.length && lines[idx].trim() === "") idx++;
        if (idx >= lines.length) {
          arr.push(null);
          continue;
        }
        const childLine = lines[idx];
        const cm = childLine.match(/^(\s*)/);
        const childIndent = cm[1].length;
        if (childIndent <= curIndent) {
          arr.push(null);
          idx = saveIdx;
          continue;
        }
        arr.push(parseValue(childIndent));
      } else if (/^([A-Za-z0-9_\-.\$][\w\-./$]*)\s*:/.test(after)) {
        // Inline mapping item:  "- key: value ..."
        // 把 `- ` 替换为同宽空格，重新走 mapping 解析
        const fakeIndent = curIndent + 2;
        const rebuilt = " ".repeat(fakeIndent) + after;
        lines[--idx] = rebuilt; // 覆盖当前行，让 parseMapping 接管
        // 在同缩进层继续吞连续的 key
        const before = idx;
        const obj = parseMapping(fakeIndent);
        arr.push(obj);
        if (idx === before) idx++; // 防御：确保推进
      } else {
        arr.push(parseScalar(after));
      }
    }
    return arr;
  }

  // 跳过文档开始标记
  while (idx < lines.length && (lines[idx].trim() === "" || lines[idx].trim() === "---")) idx++;
  if (idx >= lines.length) return {};
  const firstIndent = peekIndent();
  return parseValue(firstIndent < 0 ? 0 : firstIndent);
}

function loadYaml(filePath) {
  const text = fs.readFileSync(filePath, "utf-8");
  const yaml = tryRequireYaml();
  if (yaml) {
    return yaml.load(text);
  }
  return minimalYamlParse(text);
}

// ──────────────────────────────────────────────────────────────────────────
// 证据文件发现
// ──────────────────────────────────────────────────────────────────────────
function findEvidenceFiles() {
  if (!fs.existsSync(SPRINTS_DIR)) return [];
  const result = [];
  const sprintDirs = fs.readdirSync(SPRINTS_DIR, { withFileTypes: true });
  for (const entry of sprintDirs) {
    if (!entry.isDirectory()) continue;
    const candidate = path.join(SPRINTS_DIR, entry.name, "pipeline-evidence.jsonl");
    if (fs.existsSync(candidate)) result.push(candidate);
  }
  return result;
}

function readEvidenceFile(filePath) {
  const raw = fs.readFileSync(filePath, "utf-8");
  const records = [];
  const warnings = [];
  const lines = raw.split(/\r?\n/);
  lines.forEach((line, i) => {
    const s = line.trim();
    if (!s) return;
    try {
      records.push(JSON.parse(s));
    } catch (e) {
      warnings.push(`${filePath}:${i + 1} — JSON parse error: ${e.message}`);
    }
  });
  return { records, warnings };
}

// ──────────────────────────────────────────────────────────────────────────
// 断言与相关性校验
// ──────────────────────────────────────────────────────────────────────────
function compare(actual, operator, expected) {
  switch (operator) {
    case "==":
    case "=":
      // 类型宽松：支持数字与字符串比较
      return actual == expected; // eslint-disable-line eqeqeq
    case "!=":
      return actual != expected; // eslint-disable-line eqeqeq
    case ">":
      return Number(actual) > Number(expected);
    case "<":
      return Number(actual) < Number(expected);
    case ">=":
      return Number(actual) >= Number(expected);
    case "<=":
      return Number(actual) <= Number(expected);
    case "in":
      return Array.isArray(expected) && expected.includes(actual);
    case "regex":
      try {
        return new RegExp(expected).test(String(actual));
      } catch (_) {
        return false;
      }
    default:
      return false;
  }
}

function checkAssertFields(record, assertFields) {
  const failures = [];
  for (const af of assertFields || []) {
    const actual = record[af.field];
    if (!compare(actual, af.operator, af.value)) {
      failures.push(
        `assert failed: ${af.field}=${JSON.stringify(actual)} ${af.operator} ${JSON.stringify(
          af.value
        )}`
      );
    }
  }
  return failures;
}

/**
 * 对每个 required event，检查：
 *   1) 出现次数 >= min_occurrences
 *   2) 每个匹配实例 assert_fields 都通过
 *   3) correlation 满足（例如 tdd_green.test_file == tdd_red.test_file）
 *
 * 返回：{ status: 'pass'|'warn'|'fail', reason: string[], detail: string[] }
 */
function evaluateRequiredEvent(reqEvent, allRecords) {
  const detail = [];
  const reasons = [];
  const matches = allRecords.filter((r) => r && r.event === reqEvent.event);
  const min = reqEvent.min_occurrences == null ? 1 : Number(reqEvent.min_occurrences);

  // 1) 出现次数
  if (matches.length < min) {
    reasons.push(
      `event '${reqEvent.event}' occurred ${matches.length} time(s), need >= ${min}`
    );
    detail.push(`  found: ${reqEvent.event} × ${matches.length} (need ${min})`);
    return { status: "fail", reasons, detail, matches };
  }

  // 2) assert_fields — 每个 match 都要满足（若有定义）
  const assertFailures = [];
  for (const m of matches) {
    const f = checkAssertFields(m, reqEvent.assert_fields);
    if (f.length) assertFailures.push({ record: m, failures: f });
  }
  if (assertFailures.length > 0) {
    for (const af of assertFailures) {
      reasons.push(
        `event '${reqEvent.event}' assert failed on record (ts=${af.record.ts}): ${af.failures.join("; ")}`
      );
    }
    detail.push(
      `  found: ${reqEvent.event} × ${matches.length}, assert fail × ${assertFailures.length}`
    );
    return { status: "fail", reasons, detail, matches };
  }

  // 3) correlation
  for (const corr of reqEvent.correlation || []) {
    const peerEvent = corr.correlate_with_event;
    const op = corr.operator || "==";
    const field = corr.field;
    const peers = allRecords.filter((r) => r && r.event === peerEvent);
    // 策略：每个 match 至少要能在 peers 中找到一条满足 compare(match[field], op, peer[field])
    const unmatched = [];
    for (const m of matches) {
      const hit = peers.some((p) => compare(m[field], op, p[field]));
      if (!hit) unmatched.push(m);
    }
    if (unmatched.length > 0) {
      reasons.push(
        `correlation failed: ${reqEvent.event}.${field} ${op} ${peerEvent}.${field} — ${unmatched.length} record(s) unmatched`
      );
      detail.push(
        `  correlation: ${field} ${op} ${peerEvent}.${field} — ${unmatched.length} unmatched`
      );
      return { status: "fail", reasons, detail, matches };
    }
    detail.push(
      `  correlation: ${field} ${op} ${peerEvent}.${field} (${matches.length} matched)`
    );
  }

  detail.push(`  found: ${reqEvent.event} × ${matches.length} ✓`);
  return { status: "pass", reasons, detail, matches };
}

// ──────────────────────────────────────────────────────────────────────────
// Contract 遍历
// ──────────────────────────────────────────────────────────────────────────
function extractFullSkills(contract) {
  // 兼容两种结构：
  //   skills:
  //     - name: tdd
  //       coverage_level: full
  //       runtime_evidence: {...}
  // 或
  //   skills:
  //     tdd:
  //       coverage_level: full
  //       runtime_evidence: {...}
  const result = [];
  const skills = contract && contract.skills;
  if (!skills) return result;
  if (Array.isArray(skills)) {
    for (const s of skills) {
      if (!s) continue;
      if (s.coverage_level === "full" && s.runtime_evidence) {
        result.push({ name: s.name || s.id || "(unnamed)", ...s });
      }
    }
  } else if (typeof skills === "object") {
    for (const [name, s] of Object.entries(skills)) {
      if (s && s.coverage_level === "full" && s.runtime_evidence) {
        result.push({ name, ...s });
      }
    }
  }
  return result;
}

// ──────────────────────────────────────────────────────────────────────────
// Main
// ──────────────────────────────────────────────────────────────────────────
function run() {
  const evidenceFiles = findEvidenceFiles();
  if (evidenceFiles.length === 0) {
    console.log("[check-pipeline-evidence] No pipeline-evidence.jsonl found under sprints/** — skipping.");
    return 0;
  }

  if (!fs.existsSync(CONTRACT_PATH)) {
    console.log(
      `[check-pipeline-evidence] Contract not found: ${path.relative(REPO_ROOT, CONTRACT_PATH)} — skipping.`
    );
    return 0;
  }

  console.log(
    `[check-pipeline-evidence] Reading ${path.relative(REPO_ROOT, CONTRACT_PATH)}...`
  );
  let contract;
  try {
    contract = loadYaml(CONTRACT_PATH);
  } catch (e) {
    console.error(`[check-pipeline-evidence] Failed to parse contract: ${e.message}`);
    return 1;
  }

  const fullSkills = extractFullSkills(contract);
  if (fullSkills.length === 0) {
    console.log("[check-pipeline-evidence] No skills with coverage_level=full + runtime_evidence — nothing to check.");
    return 0;
  }

  const allRecords = [];
  const parseWarnings = [];
  for (const ef of evidenceFiles) {
    const { records, warnings } = readEvidenceFile(ef);
    console.log(
      `[check-pipeline-evidence] Reading ${path.relative(REPO_ROOT, ef)} (${records.length} records)...`
    );
    allRecords.push(...records);
    parseWarnings.push(...warnings);
  }
  if (parseWarnings.length > 0) {
    for (const w of parseWarnings) console.log(`  [warn] ${w}`);
  }

  console.log("");

  let failCount = 0;
  let warnCount = 0;
  let passCount = 0;

  for (const skill of fullSkills) {
    const mode = (skill.runtime_evidence && skill.runtime_evidence.mode) || "opt-in";
    const requiredEvents = (skill.runtime_evidence && skill.runtime_evidence.required_events) || [];

    const reqSummary = requiredEvents
      .map((e) => `${e.event} × ${e.min_occurrences || 1}`)
      .join(", ");

    const perEvent = [];
    let skillStatus = "pass";
    for (const rev of requiredEvents) {
      const res = evaluateRequiredEvent(rev, allRecords);
      perEvent.push({ rev, res });
      if (res.status === "fail") skillStatus = "fail";
    }

    if (skillStatus === "pass") {
      passCount++;
      console.log(`\u2705 ${skill.name} (${mode})`);
      if (reqSummary) console.log(`   required: ${reqSummary}`);
      if (VERBOSE) {
        for (const { res } of perEvent) {
          for (const d of res.detail) console.log(d);
        }
      } else {
        // 单行 found 摘要
        const found = perEvent
          .map(({ rev, res }) => `${rev.event} × ${res.matches.length}`)
          .join(", ");
        if (found) console.log(`   found:    ${found}`);
      }
    } else if (mode === "enforced") {
      failCount++;
      console.log(`\u274C ${skill.name} (enforced)`);
      if (reqSummary) console.log(`   required: ${reqSummary}`);
      for (const { rev, res } of perEvent) {
        if (res.status !== "pass") {
          console.log(`   FAIL: ${res.reasons.join("; ")}`);
          if (VERBOSE) for (const d of res.detail) console.log(d);
        }
      }
    } else {
      warnCount++;
      console.log(`\u26A0\uFE0F  ${skill.name} (opt-in)`);
      if (reqSummary) console.log(`   required: ${reqSummary}`);
      for (const { rev, res } of perEvent) {
        if (res.status !== "pass") {
          console.log(`   WARN: ${res.reasons.join("; ")} (mode=opt-in, not failing)`);
          if (VERBOSE) for (const d of res.detail) console.log(d);
        }
      }
    }
  }

  console.log("");
  if (failCount > 0) {
    console.log(`[FAIL] ${failCount} skill(s) failed evidence check (enforced mode)`);
    return 1;
  }
  if (warnCount > 0) {
    console.log(`[WARN] ${warnCount} skill(s) with missing evidence (opt-in mode — not failing)`);
  }
  console.log(`[OK]   Pipeline evidence check passed (${passCount} pass, ${warnCount} warn)`);
  return 0;
}

// 导出供测试使用
module.exports = {
  minimalYamlParse,
  loadYaml,
  readEvidenceFile,
  findEvidenceFiles,
  compare,
  checkAssertFields,
  evaluateRequiredEvent,
  extractFullSkills,
  run,
};

if (require.main === module) {
  process.exit(run());
}
