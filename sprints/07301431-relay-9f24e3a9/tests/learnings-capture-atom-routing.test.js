/**
 * 结构性回归测试（source-code inspection，零 mock）——T10 统一收件箱完整性守护
 *
 * 背景：packages/brain/src/ 下曾有 11 处 `INSERT INTO learnings` 调用点未接入
 * T10 统一收件箱（未调用 pushCaptureAtom），导致 ledger-hygiene.js 的 m7 指标
 * （"自主循环零产出"）在 2026-07-29 21:10 UTC 误报。
 *
 * 本测试遍历 packages/brain/src/ 下所有非测试 .js 文件，定位每一处
 * `INSERT INTO learnings` 调用，用「字符串/注释感知的括号匹配」找到其最近的
 * 外层函数体（支持 function 声明/表达式、箭头函数、对象方法简写），断言该函数体
 * 内必须同时含有 `pushCaptureAtom` 调用。
 *
 * 与 mock 覆盖相比，source-code inspection 直接验证"调度接线"本身
 * （对齐已有 invariant c674ab49：验证调度接线比 mock 覆盖更直接有效），且对
 * 未来任何新增的 `INSERT INTO learnings` 调用点自动生效——不需要逐个新写测试。
 *
 * 永久保留在 CI，不得删除。
 */

import { readFileSync, readdirSync, statSync } from 'fs';
import { resolve, dirname, join, relative } from 'path';
import { fileURLToPath } from 'url';
import { describe, it, expect } from 'vitest';

// 本文件最终落址 packages/brain/src/__tests__/learnings-capture-atom-routing.test.js
// （由 harness-generator 在 TDD Red 提交时原样迁入），路径解析以此为准。
const __dirname = dirname(fileURLToPath(import.meta.url));
const SRC_ROOT = resolve(__dirname, '..');

const INSERT_NEEDLE = 'INSERT INTO learnings';
const PUSH_CALL = 'pushCaptureAtom';

// ── 1. 递归收集 packages/brain/src/ 下所有非测试 .js 文件 ──────────────────

function collectSourceFiles(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry === '__tests__') continue;
    const full = join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) {
      out.push(...collectSourceFiles(full));
    } else if (
      entry.endsWith('.js') &&
      !entry.endsWith('.test.js') &&
      !entry.endsWith('.spec.js')
    ) {
      out.push(full);
    }
  }
  return out;
}

// ── 2. 字符串/注释感知的代码掩码（忽略字符串、模板字面量、注释中的花括号）────

function buildCodeMask(src) {
  const n = src.length;
  const mask = new Uint8Array(n); // 1 = 真实代码字符
  let state = 'code'; // code | sq | dq | tpl | lc | bc
  for (let i = 0; i < n; i++) {
    const c = src[i];
    const c2 = src[i + 1];
    if (state === 'code') {
      if (c === '/' && c2 === '/') { state = 'lc'; mask[i] = 0; continue; }
      if (c === '/' && c2 === '*') { state = 'bc'; mask[i] = 0; continue; }
      if (c === "'") { state = 'sq'; mask[i] = 0; continue; }
      if (c === '"') { state = 'dq'; mask[i] = 0; continue; }
      if (c === '`') { state = 'tpl'; mask[i] = 0; continue; }
      mask[i] = 1;
    } else if (state === 'lc') {
      mask[i] = 0;
      if (c === '\n') state = 'code';
    } else if (state === 'bc') {
      mask[i] = 0;
      if (c === '*' && c2 === '/') { mask[i + 1] = 0; i++; state = 'code'; }
    } else if (state === 'sq') {
      mask[i] = 0;
      if (c === '\\') { mask[i + 1] = 0; i++; continue; }
      if (c === "'") state = 'code';
    } else if (state === 'dq') {
      mask[i] = 0;
      if (c === '\\') { mask[i + 1] = 0; i++; continue; }
      if (c === '"') state = 'code';
    } else if (state === 'tpl') {
      mask[i] = 0;
      if (c === '\\') { mask[i + 1] = 0; i++; continue; }
      if (c === '`') state = 'code';
    }
  }
  return mask;
}

// ── 3. 判断某段 header 文本是否为"函数/方法起始签名" ─────────────────────

const CONTROL_KEYWORD_DENYLIST = new Set(['if', 'for', 'while', 'switch', 'catch', 'function', 'else', 'do', 'with']);

function isFunctionHeader(headerText) {
  const h = headerText.trim();
  if (!h) return false;
  // function 声明/表达式（含 export/default/async/generator）
  if (/^(export\s+)?(default\s+)?async\s+function\s*\*?\s*[\w$]*\s*\([^()]*\)\s*$/.test(h)) return true;
  if (/^(export\s+)?(default\s+)?function\s*\*?\s*[\w$]*\s*\([^()]*\)\s*$/.test(h)) return true;
  // 箭头函数：(...) => 或 x =>
  if (/=>\s*$/.test(h)) return true;
  // 对象方法简写 / class 方法：[async] [*] name(...) {
  const m = h.match(/^(async\s+)?\*?\s*([\w$]+)\s*\([^()]*\)\s*$/);
  if (m && !CONTROL_KEYWORD_DENYLIST.has(m[2])) return true;
  return false;
}

// ── 4. 从某个字符位置向外查找最近的"函数体"范围 ───────────────────────────

function findEnclosingFunctionBody(src, mask, pos) {
  // 4a. 构建到 pos 为止的花括号嵌套栈（只看代码字符）
  const stack = [];
  for (let i = 0; i < pos; i++) {
    if (!mask[i]) continue;
    if (src[i] === '{') stack.push(i);
    else if (src[i] === '}') stack.pop();
  }

  // 4b. 由内向外逐层检查该层的"起始花括号"是否是函数签名
  for (let level = stack.length - 1; level >= 0; level--) {
    const openIdx = stack[level];

    // 向后（往前）扫描找 header 边界：遇到 groupDepth===0 时的 `;` `{` `}` `,` 停止；
    // groupDepth 追踪 `(...)`/`[...]`，防止参数默认值 `= {}` / 解构 `{ a, b }` 里的花括号
    // 被误判为语句边界。
    let hStart = openIdx;
    let groupDepth = 0;
    let steps = 0;
    for (let j = openIdx - 1; j >= 0; j--) {
      if (!mask[j]) continue;
      const c = src[j];
      if (c === ')' || c === ']') { groupDepth++; hStart = j; steps++; continue; }
      if (c === '(' || c === '[') { groupDepth = Math.max(0, groupDepth - 1); hStart = j; steps++; continue; }
      if (groupDepth === 0 && (c === ';' || c === '{' || c === '}' || c === ',')) { hStart = j + 1; break; }
      hStart = j;
      steps++;
      if (steps > 600) break; // 安全阀，超长 header 视为异常，放弃继续回溯
    }

    // 只拼接真实代码字符（跳过注释/字符串），避免注释文字混进 header 破坏正则匹配
    let headerText = '';
    for (let j = hStart; j < openIdx; j++) headerText += mask[j] ? src[j] : ' ';

    if (isFunctionHeader(headerText)) {
      // 找到该函数体的匹配右花括号
      let depth = 0;
      for (let k = openIdx; k < src.length; k++) {
        if (!mask[k]) continue;
        if (src[k] === '{') depth++;
        else if (src[k] === '}') {
          depth--;
          if (depth === 0) {
            return { start: hStart, end: k, header: headerText.trim() };
          }
        }
      }
    }
  }
  return null;
}

// ── 5. 遍历所有源文件，收集每个 `INSERT INTO learnings` 调用点的检查结果 ────

function scanAllInsertSites() {
  const files = collectSourceFiles(SRC_ROOT);
  const sites = [];
  for (const filePath of files) {
    const src = readFileSync(filePath, 'utf8');
    if (!src.includes(INSERT_NEEDLE)) continue;
    const mask = buildCodeMask(src);
    const relPath = relative(SRC_ROOT, filePath);
    let idx = 0;
    while (true) {
      idx = src.indexOf(INSERT_NEEDLE, idx);
      if (idx === -1) break;
      const lineNo = src.slice(0, idx).split('\n').length;
      const fn = findEnclosingFunctionBody(src, mask, idx);
      if (!fn) {
        sites.push({ file: relPath, line: lineNo, header: null, hasPush: false, error: 'NO_ENCLOSING_FUNCTION' });
      } else {
        const body = src.slice(fn.start, fn.end + 1);
        sites.push({ file: relPath, line: lineNo, header: fn.header, hasPush: body.includes(PUSH_CALL), error: null });
      }
      idx += INSERT_NEEDLE.length;
    }
  }
  return sites;
}

describe('T10 统一收件箱完整性守护 [BEHAVIOR]', () => {
  it('packages/brain/src/ 下必须能扫描到至少 13 处 INSERT INTO learnings 调用点（守护扫描器本身没失效）', () => {
    const sites = scanAllInsertSites();
    expect(sites.length).toBeGreaterThanOrEqual(13);
  });

  it('每一处 INSERT INTO learnings 调用点，其所在函数体内必须包含 pushCaptureAtom 调用（防止未来新增写入点再次漏接 T10 收件箱）', () => {
    const sites = scanAllInsertSites();
    const violations = sites.filter((s) => s.error || !s.hasPush);

    if (violations.length > 0) {
      const detail = violations
        .map((v) => `  - ${v.file}:${v.line} header="${v.header ?? v.error}" hasPushCaptureAtom=${v.hasPush}`)
        .join('\n');
      throw new Error(
        `以下 ${violations.length} 处 INSERT INTO learnings 调用点未接入 T10 统一收件箱（缺 pushCaptureAtom 调用）：\n${detail}`
      );
    }

    expect(violations).toHaveLength(0);
  });

  it('已接入的 2 处（learning.js::recordLearning、routes/tasks.js learnings-received 端点）保持 pushCaptureAtom 接线不变', () => {
    const sites = scanAllInsertSites();
    const learningRecord = sites.find((s) => s.file === 'learning.js' && s.header?.includes('recordLearning('));
    const tasksRoute = sites.find((s) => s.file === 'routes/tasks.js');

    expect(learningRecord, 'learning.js::recordLearning 的 INSERT INTO learnings 调用点应能被扫描器定位到').toBeDefined();
    expect(learningRecord.hasPush).toBe(true);

    expect(tasksRoute, 'routes/tasks.js learnings-received 端点的 INSERT INTO learnings 调用点应能被扫描器定位到').toBeDefined();
    expect(tasksRoute.hasPush).toBe(true);
  });
});
