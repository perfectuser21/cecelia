#!/usr/bin/env node
/**
 * lint-terminal-failure-class — 机械闸（决策 e8f6134f 交付物2）。
 *
 * 防回归：任何把 harness 任务（harness_initiative / golden_path_proposal）打成 terminal
 * 失败态（status = 'failed' | 'blocked' | 'cancelled'）的裸 SQL 写入点，若既不经共享 helper
 * markHarnessTaskTerminal、语句里又不含 failure_class，则视为漏写 failure_class → exit 1。
 * 纯文档约定不算数，本脚本进 CI（.github/workflows/ci.yml 的 lint-terminal-failure-class job，
 * 纳入 ci-passed required check）真正阻塞 merge。
 *
 * 判定（三条同时命中才算违规）：
 *   1. UPDATE tasks 语句里有字面 terminal 状态赋值：status = 'failed'|'blocked'|'cancelled'
 *   2. 同语句命中 harness 语境：含 harness_initiative / golden_path_proposal / LIKE 'harness%'
 *   3. 同语句不含 failure_class（未落根因）
 * 逃生口：紧邻 UPDATE 上方（3 行内）注释 `// failure-class-lint-allow: <理由>`。
 *
 * 说明：只对「字面 terminal 状态 + 同语句 harness 语境」的裸写入报警——参数化 status（$N）
 * 经受信 Brain 代码路径（如 helper / finalizeKernelRun）落库，不在扫描面内，避免误伤 113 处
 * 通用 UPDATE tasks 写入。这与合同 Step 3 的判定口径一致。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const REPO_ROOT = path.resolve(path.dirname(__filename), '../../../..');
const SCAN_ROOT = path.join(REPO_ROOT, 'packages/brain/src');

const TERMINAL_RE = /status\s*=\s*['"](failed|blocked|cancelled)['"]/;
const HARNESS_RE = /harness_initiative|golden_path_proposal|LIKE\s+['"]harness/;
const FAILURE_CLASS_RE = /failure_class/;
const ALLOW_RE = /failure-class-lint-allow/;

/** 递归收集 packages/brain/src 下所有 .js（排除测试）。 */
function collectJsFiles(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === '__tests__' || entry.name === 'node_modules') continue;
      out.push(...collectJsFiles(full));
    } else if (entry.isFile() && entry.name.endsWith('.js') && !entry.name.endsWith('.test.js')) {
      out.push(full);
    }
  }
  return out;
}

/**
 * 从 `UPDATE tasks SET` 起点截取一条语句文本：到最近的反引号（模板字面量收尾）为止，
 * 最长 600 字符封顶（防非模板写法把窗口拉飞产生误报）。
 */
function extractStatement(content, start) {
  const tick = content.indexOf('`', start);
  const cap = start + 600;
  const end = tick >= 0 ? Math.min(tick, cap) : Math.min(cap, content.length);
  return content.slice(start, end);
}

/** 判断 UPDATE 起点上方 3 行内是否有逃生口注释。 */
function hasAllowComment(content, start) {
  const before = content.slice(0, start).split('\n');
  const tail = before.slice(Math.max(0, before.length - 4)).join('\n');
  return ALLOW_RE.test(tail);
}

function scanFile(file) {
  const content = fs.readFileSync(file, 'utf8');
  const violations = [];
  const re = /UPDATE\s+tasks\s+SET/gi;
  let m;
  while ((m = re.exec(content)) !== null) {
    const stmt = extractStatement(content, m.index);
    if (!TERMINAL_RE.test(stmt)) continue;
    if (!HARNESS_RE.test(stmt)) continue;
    if (FAILURE_CLASS_RE.test(stmt)) continue;
    if (hasAllowComment(content, m.index)) continue;
    const line = content.slice(0, m.index).split('\n').length;
    violations.push({ file: path.relative(REPO_ROOT, file), line });
  }
  return violations;
}

function main() {
  const files = collectJsFiles(SCAN_ROOT);
  const all = [];
  for (const f of files) all.push(...scanFile(f));

  if (all.length > 0) {
    console.error('❌ lint-terminal-failure-class: 发现漏写 failure_class 的 harness terminal 写入点：');
    for (const v of all) {
      console.error(`   ${v.file}:${v.line} — UPDATE tasks 把 harness 任务打成 terminal 失败态但未写 failure_class`);
    }
    console.error('');
    console.error('修法：改经 markHarnessTaskTerminal（packages/brain/src/harness-failure-class.js）落库，');
    console.error('     或在同语句写入 result.failure_class（受控枚举）+ failure_detail；');
    console.error('     确有豁免理由时在 UPDATE 上方加注释 `// failure-class-lint-allow: <理由>`。');
    process.exit(1);
  }
  console.log(`✅ lint-terminal-failure-class: 扫描 ${files.length} 个文件，无裸 harness terminal 写入`);
  process.exit(0);
}

main();
