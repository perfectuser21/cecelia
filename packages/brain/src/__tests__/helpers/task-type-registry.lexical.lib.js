import { readFileSync } from 'node:fs';
import { tokenizer } from 'acorn';
import { stripComments } from './task-type-registry.guard.lib.js';
import { DB_WHITELISTED_TASK_TYPES } from '../../lib/task-type-registry.js';

// 与词法回归共用扫描器；本模块不注册测试或钩子。
const WHITELIST = new Set(DB_WHITELISTED_TASK_TYPES);

// 判定手抄的"过半"阈值——命中数/候选字符串数 ≥ 此比例，见文件头①的排除案例。
const MAJORITY_THRESHOLD = 0.5;
// 规则 C 专用阈值，比规则 A 更严——见文件头③。
const OBJECT_MAJORITY_THRESHOLD = 0.7;

const PURE_STR_RE = /^\s*'((?:[^'\\]|\\.)*)'\s*$|^\s*"((?:[^"\\]|\\.)*)"\s*$/;
// 对象字面量顶层 key：带引号字符串 key，或不带引号的裸标识符 key（JS 语法本身就
// 不允许裸标识符带连字符，所以这里不需要像 PURE_STR_RE 那样兼容连字符）。
const OBJ_KEY_RE = /^\s*(?:'((?:[^'\\]|\\.)*)'|"((?:[^"\\]|\\.)*)"|([A-Za-z_$][A-Za-z0-9_$]*))\s*:/;
const SQL_IN_RE = /task_type\s+(NOT\s+)?IN\s*\(/gi;
// 规则 A 变体专用：task_type 绑定为查询参数的形态——`= ANY($1)` 这类位置占位符，
// 或 `IN (${placeholders})` 这类模板插值拼出的占位符列表（credential-expiry-checker.js
// 替换前的真实写法：`task_type NOT IN (${skipTypesPlaceholders})`）。两种开头都是
// 字面 `$`，`\$` 一并匹配。与 SQL_IN_RE（认字符串字面量名单）互斥判据，见文件头④。
const TASK_TYPE_BIND_RE = /task_type\s*(?:NOT\s+)?(?:=\s*ANY\s*\(\s*\$|IN\s*\(\s*\$)/i;

// 数组字面量允许的"前一个非空白字符"：赋值/参数/属性值/逻辑运算/三元/语句边界。
const ARRAY_PRECURSOR_CHARS = new Set(['=', '(', ',', ':', '[', '!', '&', '|', '?', ';', '{']);
// 对象字面量更保守：不含 `;`/`{`（那两个在对象语境下几乎总是代码块开头）。
const OBJECT_PRECURSOR_CHARS = new Set(['=', '(', ',', ':', '[', '!', '&', '|', '?']);
// 两种字面量都认的"前一个词"：这些关键字后面接的一定是表达式，不可能是代码块。
const LITERAL_START_KEYWORDS = new Set([
  'return', 'typeof', 'in', 'of', 'yield', 'await', 'delete', 'void', 'throw', 'instanceof',
]);

// 仅确定 A/C 真实代码起点；原字符串成员及 SQL 输入不变。
// 同次词法扫描去注释且保留位置，避免旧去注释器把 regexp 中的 // 当成注释。
// 模板 quasi/regexp 不产生内部括号 token，${...} 内仍遍历；词法错误直接抛出。
function literalSource(source) {
  const comments = [], starts = [];
  for (const token of tokenizer(source, { ecmaVersion: 'latest', sourceType: 'module',
    onComment: (_block, _text, start, end) => comments.push([start, end]),
  })) {
    if (token.type.label === '[' || token.type.label === '{') {
      starts.push({ index: token.start, isArray: token.type.label === '[' });
    }
  }
  const chars = source.split('');
  for (const [start, end] of comments) for (let i = start; i < end; i++) {
    if (chars[i] !== '\n' && chars[i] !== '\r') chars[i] = ' ';
  }
  return { source: chars.join(''), starts };
}

function lineAt(src, idx) {
  return src.slice(0, idx).split('\n').length;
}

/** 找到与 openIdx 处 openCh 配对的 closeCh（深度计数，正确跳过嵌套数组/对象）。 */
function findMatchingClose(src, openIdx, openCh, closeCh) {
  let depth = 0;
  for (let i = openIdx; i < src.length; i += 1) {
    if (src[i] === openCh) depth += 1;
    else if (src[i] === closeCh) {
      depth -= 1;
      if (depth === 0) return i;
    }
  }
  return -1;
}

/** 按顶层逗号切分数组/对象体（深度计数跳过嵌套括号，字符串内的逗号不算分隔符）。 */
function splitTopLevel(body) {
  const parts = [];
  let depth = 0;
  let cur = '';
  let inStr = null;
  for (let i = 0; i < body.length; i += 1) {
    const c = body[i];
    if (inStr) {
      cur += c;
      if (c === '\\') { cur += body[i + 1] ?? ''; i += 1; continue; }
      if (c === inStr) inStr = null;
      continue;
    }
    if (c === "'" || c === '"' || c === '`') { inStr = c; cur += c; continue; }
    if (c === '[' || c === '{' || c === '(') { depth += 1; cur += c; continue; }
    if (c === ']' || c === '}' || c === ')') { depth -= 1; cur += c; continue; }
    if (c === ',' && depth === 0) { parts.push(cur); cur = ''; continue; }
    cur += c;
  }
  if (cur.trim()) parts.push(cur);
  return parts;
}

/** 取 idx 前一个非空白"字符"（非字母数字时）或"词"（标识符/关键字时）。 */
function precedingContext(src, idx) {
  let j = idx - 1;
  while (j >= 0 && /\s/.test(src[j])) j -= 1;
  if (j < 0) return { char: null, word: null };
  const c = src[j];
  if (/[A-Za-z_$]/.test(c)) {
    let k = j;
    while (k >= 0 && /[A-Za-z0-9_$]/.test(src[k])) k -= 1;
    return { char: null, word: src.slice(k + 1, j + 1) };
  }
  return { char: c, word: null };
}

function isArrayLiteralStart(src, idx) {
  const { char, word } = precedingContext(src, idx);
  if (char === null && word === null) return true; // 文件开头
  if (char !== null) return ARRAY_PRECURSOR_CHARS.has(char);
  return LITERAL_START_KEYWORDS.has(word);
}

function isObjectLiteralStart(src, idx) {
  const { char, word } = precedingContext(src, idx);
  if (char === null && word === null) return true;
  if (char !== null) return OBJECT_PRECURSOR_CHARS.has(char);
  return LITERAL_START_KEYWORDS.has(word);
}

/**
 * 给一个字面量（[openIdx, closeIdx]）找"最近的具名标识符"用于报告：
 * 声明名 → 属性名 → 外层函数调用参数 → 紧跟的方法调用 → `<inline>`。
 */
function contextNameFor(src, openIdx, closeIdx) {
  const before = src.slice(Math.max(0, openIdx - 200), openIdx);
  const declMatch = /(?:export\s+)?(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:Object\.freeze\(\s*)?(?:new Set\(\s*)?$/.exec(before);
  if (declMatch) return declMatch[1];
  const propMatch = /(?:'([^'\\]*)'|"([^"\\]*)"|([A-Za-z_$][\w$]*))\s*:\s*(?:Object\.freeze\(\s*)?(?:new Set\(\s*)?$/.exec(before);
  if (propMatch) return propMatch[1] ?? propMatch[2] ?? propMatch[3];
  const assignMatch = /([A-Za-z_$][\w$.]*)\s*=\s*(?:Object\.freeze\(\s*)?(?:new Set\(\s*)?$/.exec(before);
  if (assignMatch) return assignMatch[1];
  const callArgMatch = /([A-Za-z_$][\w$.]*)\s*\(\s*(?:Object\.freeze\(\s*)?(?:new Set\(\s*)?$/.exec(before);
  if (callArgMatch) return `${callArgMatch[1]}(...)`;

  let after = closeIdx + 1;
  while (src[after] === ')') after += 1; // 跳过 new Set(...)/Object.freeze(...) 的收尾括号
  const afterStr = src.slice(after, after + 50);
  const callMatch = /^\s*\.([A-Za-z_$][\w$]*)\s*\(/.exec(afterStr);
  if (callMatch) return `.${callMatch[1]}`;

  return '<inline>';
}

/**
 * 单趟左到右扫描全部数组/对象字面量（不要求声明绑定），返回
 * [{line, name, kind}]（kind: 'array' 对应规则 A，'object' 对应规则 C）。
 * 输入为未剥注释的原始源码。
 * 候选起点由原始源码的词法 token 提供，字符串/模板文本/正则内容不作代码。
 * 每个真实括号 token 都会独立检查，外层对象未命中也不会遮住内层数组。
 * 词法去注释保留字符位置和换行；SQL 使用原有独立文本扫描。
 */
function scanLiterals(rawSource) {
  const { source: src, starts } = literalSource(rawSource);
  const hits = [];
  // 规则 A 变体（见文件头④）：本文件是否存在"task_type 绑定为查询参数"的 SQL 形态。
  // 只算一次，供下面单元素/低命中数组的放宽判据复用。
  const hasTaskTypeBindContext = TASK_TYPE_BIND_RE.test(src);
  for (const { index: p, isArray } of starts) {
    if (isArray) {
      if (!isArrayLiteralStart(src, p)) { continue; }
      const closeIdx = findMatchingClose(src, p, '[', ']');
      if (closeIdx === -1) { continue; }
      const body = src.slice(p + 1, closeIdx);
      const tokens = [];
      for (const el of splitTopLevel(body)) {
        const sm = PURE_STR_RE.exec(el);
        if (sm) tokens.push(sm[1] !== undefined ? sm[1] : sm[2]);
      }
      const matched = [...new Set(tokens.filter((t) => WHITELIST.has(t)))];
      const ratio = tokens.length ? matched.length / tokens.length : 0;
      if (matched.length >= 2 && ratio >= MAJORITY_THRESHOLD) {
        hits.push({ line: lineAt(src, p), name: contextNameFor(src, p, closeIdx), kind: 'array' });
      } else if (matched.length >= 1 && ratio === 1 && hasTaskTypeBindContext) {
        // 主阈值放不过（命中数<2）的"绑定参数小名单"分支——见文件头④。
        const name = contextNameFor(src, p, closeIdx);
        const isNamedIdentifier = /^[A-Za-z_$][\w$]*$/.test(name);
        if (isNamedIdentifier) {
          const usageCount = (src.match(new RegExp(`\\b${name}\\b`, 'g')) || []).length;
          if (usageCount >= 2) {
            hits.push({ line: lineAt(src, p), name, kind: 'array' });
          }
        }
      }
      continue;
    }

    if (!isObjectLiteralStart(src, p)) { continue; }
    const closeIdx = findMatchingClose(src, p, '{', '}');
    if (closeIdx === -1) { continue; }
    const body = src.slice(p + 1, closeIdx);
    const tokens = [];
    for (const el of splitTopLevel(body)) {
      const km = OBJ_KEY_RE.exec(el);
      if (km) tokens.push(km[1] !== undefined ? km[1] : (km[2] !== undefined ? km[2] : km[3]));
    }
    const matched = [...new Set(tokens.filter((t) => WHITELIST.has(t)))];
    const ratio = tokens.length ? matched.length / tokens.length : 0;
    if (matched.length >= 2 && ratio >= OBJECT_MAJORITY_THRESHOLD) {
      hits.push({ line: lineAt(src, p), name: contextNameFor(src, p, closeIdx), kind: 'object' });
    }
  }
  return hits;
}

/**
 * 规则 B：扫 SQL `task_type (NOT )?IN (` 字面量名单，返回行号数组（已剥注释的 src）。
 *
 * Task 4 修复（credential-expiry-checker.js:250 假阳性）：原版只认字面量文本 `IN (`，
 * 不区分括号里是字符串字面量（`IN ('a','b')`，真手抄）还是参数占位符
 * （`IN ($1, $2)`，值来自运行时绑定，credential-expiry-checker.js 已 import 注册表派生
 * SKIP_TASK_TYPES 生成占位符）。补一步：取 `IN (` 到匹配右括号之间的内容，若里面不含
 * 任何单引号（没有一个字符串字面量），判定为纯参数占位符查询，不是手抄名单，跳过。
 */
function scanSqlHits(src) {
  const hits = [];
  let m;
  SQL_IN_RE.lastIndex = 0;
  // eslint-disable-next-line no-cond-assign
  while ((m = SQL_IN_RE.exec(src))) {
    const openIdx = m.index + m[0].length - 1; // 落在 '(' 上
    let depth = 1;
    let i = openIdx + 1;
    while (i < src.length && depth > 0) {
      if (src[i] === '(') depth++;
      else if (src[i] === ')') depth--;
      i++;
    }
    const inner = src.slice(openIdx + 1, i - 1);
    if (!inner.includes("'")) continue; // 纯占位符（$1,$2…），不是手抄字面量名单
    hits.push(lineAt(src, m.index));
  }
  return hits;
}

/**
 * 对外接口：返回 `行:标识符`（规则 A/C，标识符见 contextNameFor）或
 * `行:SQL`（规则 B）的行内描述数组，按行号排序。
 */
export function scanFile(absPath) {
  const rawSource = readFileSync(absPath, 'utf8');
  const src = stripComments(rawSource);
  const out = [];
  for (const { line, name } of scanLiterals(rawSource)) out.push(`${line}:${name}`);
  for (const line of scanSqlHits(src)) out.push(`${line}:SQL`);
  return out.sort((a, b) => Number(a.split(':')[0]) - Number(b.split(':')[0]));
}
