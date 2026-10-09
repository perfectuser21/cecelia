/**
 * task-type-registry.guard.test.js 的纯函数实现（第三轮修复时按团队要求拆出，
 * 测试文件只留 describe/it + 豁免清单）。
 *
 * ── 检测范围（第三轮：不再要求声明绑定）───────────────────────────────────
 * 前两轮规则 A/C 都要求 `(?:const|let|var) NAME = [ ... ]` / `{ ... }` 的
 * **声明形态**，对任意其他位置出现的字面量完全失明——真实漏网：
 *   - `recurring.js:221` `[...8个task_type...].includes(taskType)`：内联数组，
 *     直接当表达式用，从没被赋给任何常量。
 *   - `executor.js:2346` `['sprint_generate','sprint_fix'].includes(taskType)`：
 *     同上，在 `return` 语句里。
 *   - `routes/execution.js:3006/3025` `task_types: ['dev','review','qa','audit']`：
 *     数组作为对象字面量的属性值，而不是被赋给一个独立声明。
 * 这三类都是"手抄的字符串数组"，只是没有被绑定到一个具名常量——旧版扫描器
 * 只找 `NAME = [`，天生看不到它们。
 *
 * 本版改成**不锚定声明**，直接在整份源码里找任意位置的数组/对象字面量
 * **起始位置**，用"前一个非空白字符/关键字"判断这是不是字面量的开头（而不是
 * 数组下标 `arr[0]` 或代码块 `if (x) { ... }`），逻辑见 `isArrayLiteralStart` /
 * `isObjectLiteralStart`：
 *   - 数组 `[`：前一个非空白字符是 `= ( , : [ ! & | ? ;` 之一，或紧跟在 `{`
 *     后面（block 的第一条语句就是数组表达式，比如 `[1,2].forEach(...)`），
 *     或前一个词是 `return/typeof/in/of/yield/await/delete/void/throw/
 *     instanceof` 之一，或本身就是文件开头，才算字面量开头；否则视为下标
 *     访问（`arr[i]`），跳过不看。
 *   - 对象 `{`：同上但不含 `;`/`{`（那两个在对象场景下几乎总是代码块的开头，
 *     比如紧跟在另一个 block 后面的新语句块、或 `if/for/while/function` 的
 *     函数体），且不含裸标识符关键字如 `else/try/finally/do`（那些引出的也是
 *     代码块，不是对象字面量）。这个启发式不是真正的 AST 解析，无法覆盖所有
 *     JS 语法（见文件底部"已知盲区"）。
 * 命中后：取该字面量的**顶层**元素/键（复用原来的括号深度计数 + 顶层逗号
 * 切分，规则不变——数组元素必须是整体的纯字符串字面量，对象取顶层 key），
 * 命中数/占比阈值也不变（数组 `MAJORITY_THRESHOLD=0.5`，对象
 * `OBJECT_MAJORITY_THRESHOLD=0.7`，理由见下方②③）。
 *
 * 命中后报 `行:标识符`，标识符按下列优先级取（`contextNameFor`）：
 *   1. 紧邻的声明名（`const/let/var NAME =` 或 `obj.NAME =`）——和前两轮行为
 *      完全兼容，所有第一/二轮已识别站点的标识符不变。
 *   2. 紧邻的对象属性名（`NAME: [...]`）。
 *   3. 紧邻的函数调用参数上下文（`someFn([...]`，report 为 `someFn(...)`）。
 *   4. 字面量结束后紧跟的方法调用（`[...].includes(`，report 为 `.includes`）。
 *   5. 以上都没有 → `<inline>`。
 *
 * ── 规则 A/B/C 判定阈值不变 ─────────────────────────────────────────────
 * ① 规则 A（数组/Set 字面量）：顶层纯字符串元素落在 `DB_WHITELISTED_TASK_TYPES`
 *    的记为命中，命中数≥2 且命中数/候选数≥0.5 才判手抄——0.5 用来排除
 *    `domain-detector.js:PRIORITY_ORDER` 这类巧合命中（10个候选里只有2个词
 *    撞上白名单，是业务优先级顺序不是任务类型名单）。
 * ② 规则 B（SQL `task_type (NOT )?IN (` 字面量名单）：`\s` 天然跨行。
 *    **已知局限**：这条正则假设 `IN (` 后面跟的是字符串字面量名单，当前全库
 *    没有 `task_type IN (SELECT ...)` 子查询写法（已用
 *    `grep -rniE "task_type\s+(not\s+)?in\s*\("` 核实），如果未来出现子查询，
 *    这条规则会误报——写在这里明确记录这个假设，不是"验证过所有可能写法"。
 * ③ 规则 C（对象字面量，以 task_type 为键的映射）：顶层 key 落在白名单的记为
 *    命中，命中数≥2 且占比≥0.7（比规则 A 更严）——0.5 分不开
 *    `tick-scheduler.js:EXECUTOR_ROUTING`（60%，键含非法 task_type `dev_task`/
 *    `harness`，巧合命中）和 `executor-contracts.js:EXECUTOR_KIND_FOR`（83%，
 *    真实站点），0.7 才行。代价：`impact-contract/change-kind.js:TASK_TYPE_MAP`
 *    （57%）低于阈值被漏过——**裁决（qiumi_task PR1 地基·Task 4 审查，
 *    2026-09-22）：不折入注册表，本表长期保留手抄字面量**。理由：
 *      1. 键混杂非真实 task_type（new_feature/enhancement/bugfix/hotfix/
 *         config_change），这些是历史遗留的别名/伪类型，注册表的 tagged()
 *         只能筛注册表已声明的真实 task_type key，无法表示它们；
 *      2. 要把本表折进注册表需给全部 ~80 个 task_type 逐一定义 change_kind
 *         四档归属——是一次语义分类工作，不是"搬家"，超出 PR1 零行为变化范围；
 *      3. 命中占比 57% 本就低于本条 0.7 阈值，不在 REMAINING_LEGACY_SITES
 *         强制清零范围内，故此裁决只需落在本处存档，不需要清单条目。
 *    裁决记录只落在这份守卫文档里，**不写回 change-kind.js 本体**——那是
 *    lint-gp-anchor-artifact 认定的流水线路径，写一段 long-lived 注释就会被
 *    判定为"碰了流水线路径"、逼出一条不必要的 gp/f1 anchor 测试，收益为负。
 *    本规则阈值不因这一个案例收紧。`routes/harness.js:STAGE_LABELS`（56%）
 *    同期被漏过，但已在 Task 4 的 enum 清理里顺带处理（搬进注册表
 *    HARNESS_BUILD_STAGE_LABELS），不再是阈值盲区的活跃案例。宁可漏抓不误抓，
 *    仍是本规则的设计取向。
 * ④ 规则 A 变体——绑定参数名单（Task 4 审查后新增）：`matched.length >= 2` 的
 *    门槛会漏掉"只有 1 个真实 task_type"的名单，真实反例是
 *    `credential-expiry-checker.js` 替换前的 `const SKIP_TASK_TYPES =
 *    ['pipeline_rescue'];`——单元素、100% 命中，但因命中数不满 2 而从未被规则
 *    A 的主阈值看到。这类名单虽小，被后续 `.map((_,i)=>\`$${i+1}\`)` 拼进
 *    `task_type IN (...)`/`task_type = ANY($n)` 语句当绑定参数用，一旦被误改
 *    （如漏加新类型）会直接改变查询语义，风险不比大名单低。
 *    收窄识别条件（避免全面放宽到 matched.length>=1 而对"偶然撞库的单元素
 *    数组"（如某处 `['review']` 表示别的业务含义）大面积误报）：数组必须
 *    ①100% 纯命中（`ratio === 1`，不接受掺了非法值的单元素数组）②有可解析
 *    的具名标识符（`contextNameFor` 返回值形如 `NAME`，不是 `<inline>`/
 *    `.method`/`fn(...)`）③该标识符在文件别处（非声明行）至少再出现一次
 *    ④文件内存在 `task_type ... IN ($`/`task_type ... = ANY($` 这类"绑定参数"
 *    SQL 形态（`TASK_TYPE_BIND_RE`，与规则 B 的 `SQL_IN_RE` 不同——规则 B 认
 *    字符串字面量名单，这里反过来认"确实在绑参数"）。四条同时成立才判手抄，
 *    见 `scanLiterals` 里 `matched.length >= 1` 分支及下方 `hasBindContext`。
 *
 * ── 已知盲区（第三轮修复后仍然存在，不是"空跑=全量真相"）─────────────────
 * 这套扫描器是正则+括号深度计数的启发式，不是真正的 JS/TS 解析器，以下写法
 * 仍然扫不到：
 *   - **模板字符串拼接的名单**：`` `${a},${b}` `` 或用 `.join('/')`/字符串拼接
 *     手工拼出的 task_type 列表，不是字面量数组/对象，规则 A/B/C 都不认。
 *   - **`Array.from(...)` / `Array(n).fill(...)` 构造的数组**：不是 `[...]`
 *     字面量语法，规则 A 不认。
 *   - **spread 拼接**：`[...SOME_IMPORTED, 'extra_type']` 这种数组，如果
 *     `SOME_IMPORTED` 本身是手抄名单，规则 A 只会看到顶层的 `'extra_type'`
 *     这一个纯字符串元素（spread 展开式不是纯字符串字面量，会被过滤掉），
 *     达不到 ≥2 命中的门槛，不会报警。
 *   - **拆成多行 `push`/`add` 语句拼出来的集合**：
 *     `const s = new Set(); s.add('dev'); s.add('review');` 不是字面量初始化，
 *     规则 A 不认。
 *   - **对象展开 `{...BASE, dev: 'x'}`**：同 spread 数组，规则 C 只看得到顶层
 *     的显式 key，`...BASE` 展开的 key 看不到。
 *   - 本次新加的"位置无关"扫描仍然是启发式（`isArrayLiteralStart`/
 *     `isObjectLiteralStart` 的"前一个字符/关键字"判断），极端写法（比如把
 *     字面量包在括号链、三元表达式、逗号表达式里很深）可能仍然漏判或误判，
 *     没有做穷尽的语法覆盖测试，只覆盖了本次审查给出的真实反例。
 * 因此"全库空跑 offenders 列表"只是"当前这套启发式能看到的手抄站点"，不是
 * "代码库里全部手抄站点"的证明——这一点必须写清楚，不能默认空跑结果=全量真相。
 *
 * ── 命中串是豁免清单的粒度（终审 I2）───────────────────────────────────────
 * `scanFile` 返回的 `行:标识符`（如 `2329:_TASK_ROUTES`）字符串不只是给人看的
 * 报告行，也是测试文件 `task-type-registry.guard.test.js` 里 `REMAINING_LEGACY_SITES`
 * 豁免清单的键值单位——该清单是 `{ 相对路径: [允许的命中串, ...] }` 的映射，逐条
 * 命中串核对，不是整文件级别的豁免。早期版本按文件名整体跳过扫描，导致任何人往
 * 已登记的 long-lived 文件里新加一段无关的手抄名单都不会被抓到（永久盲区，回归
 * 覆盖见该测试文件的测试⑩）。改动本文件里任何会影响 `line`/`name` 取值的逻辑
 * （`lineAt`/`contextNameFor`）都会让已登记的命中串错位失效，须同步跑测试②
 * （逐条核对白名单命中串是否仍然成立）确认没有连带破坏。
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { DB_WHITELISTED_TASK_TYPES } from '../../lib/task-type-registry.js';

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

/**
 * 剥注释（块注释 + 行注释，含行内尾随注释），保留换行数以维持行号，且不误伤
 * 字符串/模板字符串内部的 `//`（逐字符状态机，不是行首正则）。
 */
export function stripComments(src) {
  let out = '';
  let i = 0;
  const n = src.length;
  let inBlock = false;
  let inLine = false;
  let strCh = null;
  while (i < n) {
    const c = src[i];
    const c2 = src[i + 1];
    if (inBlock) {
      if (c === '*' && c2 === '/') { inBlock = false; out += '  '; i += 2; continue; }
      out += c === '\n' ? '\n' : ' ';
      i += 1;
      continue;
    }
    if (inLine) {
      if (c === '\n') { inLine = false; out += '\n'; i += 1; continue; }
      i += 1;
      continue;
    }
    if (strCh) {
      out += c;
      if (c === '\\') { out += src[i + 1] ?? ''; i += 2; continue; }
      if (c === strCh) strCh = null;
      i += 1;
      continue;
    }
    if (c === "'" || c === '"' || c === '`') { strCh = c; out += c; i += 1; continue; }
    if (c === '/' && c2 === '*') { inBlock = true; out += '  '; i += 2; continue; }
    if (c === '/' && c2 === '/') { inLine = true; i += 2; continue; }
    out += c;
    i += 1;
  }
  return out;
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
 * 已剥注释的 src。
 *
 * 注意：处理完一个字面量后，下一次扫描从 `p + 1`（字面量起点后一个字符）
 * 继续，**不**跳到 `closeIdx + 1`（字面量结束之后）。这是故意的：像
 * `routes/execution.js` 的 `usServer = { ..., task_types: ['dev','review',
 * 'qa','audit'] }` 这种大对象，外层对象本身的顶层 key（`id`/`name`/
 * `resources`/`slots`/`task_types`...）不是 task_type，规则 C 判它不命中；
 * 如果处理完外层就跳到它的结束位置，内层真正命中的 `task_types: [...]`
 * 就永远扫不到。不跳过，让扫描线性地钻进每一层嵌套结构内部，才能同时抓到
 * 外层判空、内层命中的情况。代价是同一段字符会被"路过"多次（外层评估一次、
 * 内层评估一次），但每次评估本身是 O(该层大小)，不是重复的昂贵解析，实测
 * 全仓库（含 `routes/execution.js` 这种几千行的大文件）跑一遍在 1 秒内。
 */
function scanLiterals(src) {
  const hits = [];
  const n = src.length;
  let pos = 0;
  // 规则 A 变体（见文件头④）：本文件是否存在"task_type 绑定为查询参数"的 SQL 形态。
  // 只算一次，供下面单元素/低命中数组的放宽判据复用。
  const hasTaskTypeBindContext = TASK_TYPE_BIND_RE.test(src);
  while (pos < n) {
    const nextArr = src.indexOf('[', pos);
    const nextObj = src.indexOf('{', pos);
    let p;
    let isArray;
    if (nextArr === -1 && nextObj === -1) break;
    if (nextObj === -1 || (nextArr !== -1 && nextArr < nextObj)) { p = nextArr; isArray = true; } else { p = nextObj; isArray = false; }

    if (isArray) {
      if (!isArrayLiteralStart(src, p)) { pos = p + 1; continue; }
      const closeIdx = findMatchingClose(src, p, '[', ']');
      if (closeIdx === -1) { pos = p + 1; continue; }
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
      pos = p + 1;
      continue;
    }

    if (!isObjectLiteralStart(src, p)) { pos = p + 1; continue; }
    const closeIdx = findMatchingClose(src, p, '{', '}');
    if (closeIdx === -1) { pos = p + 1; continue; }
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
    pos = p + 1;
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
  const src = stripComments(readFileSync(absPath, 'utf8'));
  const out = [];
  for (const { line, name } of scanLiterals(src)) out.push(`${line}:${name}`);
  for (const line of scanSqlHits(src)) out.push(`${line}:SQL`);
  return out.sort((a, b) => Number(a.split(':')[0]) - Number(b.split(':')[0]));
}

/**
 * 递归列出 dir 下所有 .js 生产源文件（排除 node_modules/__tests__/__fixtures__
 * 目录、registryPath 本身、以及与目录无关、散落在生产代码旁边的**同名协同测试
 * 文件**——`*.test.js`/`*.spec.js`。第三轮改成位置无关扫描后，`routing/
 * resolve-executor.test.js` 里为单元测试构造的假依赖
 * `taskRequirements: { dev: [...], codex_qa: [...] }`（mock `resolveExecutor`
 * 的注入依赖，不是生产代码的手抄名单）被规则 C 命中——这类协同测试文件在本
 * 代码库里有 60+ 个（不止在 `__tests__/` 目录下，很多和被测文件平级），排除
 * 目录已经拦不住，必须按文件名模式排除，否则以后任何一个测试用的 mock
 * fixture 只要碰巧用了 ≥2 个真实 task_type 做示例数据就会被误判。
 */
export function walk(dir, registryPath, out = []) {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name === '__tests__' || name === '__fixtures__') continue;
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) { walk(p, registryPath, out); continue; }
    if (!name.endsWith('.js') || p === registryPath) continue;
    if (/\.(test|spec)\.js$/.test(name)) continue;
    out.push(p);
  }
  return out;
}

/** 供测试用：把绝对路径转成相对 SRC 的展示路径（跨平台统一用 / 分隔）。 */
export function relPath(srcDir, absPath) {
  return relative(srcDir, absPath).split('\\').join('/');
}

// ═══════════════════════════════════════════════════════════════════════════
// 补充六（Task 6 审计入口）：接受源码字符串、按声明名/上下文精确提取字面量
// **值**（不是"有没有手抄"的布尔命中，是"原文写的到底是什么"），供
// `scripts/audit/registry-vs-base.mjs` 拿基线源码（`git show <base>:<file>`，
// 字符串，不落盘）与当前注册表派生值逐一 deep-equal。与上面①-⑨的守卫规则
// 复用同一套 stripComments/findMatchingClose/splitTopLevel/PURE_STR_RE/
// OBJ_KEY_RE 基础设施，只是"提取值"而不是"报告命中位置"。
// ═══════════════════════════════════════════════════════════════════════════

/** 把数组字面量的 body（`[...]` 内部文本）解析成顶层纯字符串元素数组，保留顺序与重复。 */
export function parseArrayLiteral(body) {
  return splitTopLevel(body)
    .map((s) => s.trim())
    .filter(Boolean)
    .map((el) => {
      const sm = PURE_STR_RE.exec(el);
      return sm ? (sm[1] !== undefined ? sm[1] : sm[2]) : el;
    });
}

/**
 * 把对象字面量的 body（`{...}` 内部文本）解析成 {key: value}。value 支持
 * 纯字符串 / 字符串数组（`['a','b']`，供 TASK_REQUIREMENTS 这类值用）/ `null`
 * ——够用当前全部审计站点，不是通用 JS 值解析器。
 */
export function parseObjectLiteral(body) {
  const out = {};
  for (const el of splitTopLevel(body)) {
    const trimmed = el.trim();
    if (!trimmed) continue;
    const km = OBJ_KEY_RE.exec(trimmed);
    if (!km) continue;
    const key = km[1] !== undefined ? km[1] : (km[2] !== undefined ? km[2] : km[3]);
    const valueRaw = trimmed.slice(km[0].length).trim();
    const sm = PURE_STR_RE.exec(valueRaw);
    if (sm) { out[key] = sm[1] !== undefined ? sm[1] : sm[2]; continue; }
    if (valueRaw === 'null') { out[key] = null; continue; }
    if (valueRaw.startsWith('[') && valueRaw.endsWith(']')) {
      out[key] = parseArrayLiteral(valueRaw.slice(1, -1));
      continue;
    }
    out[key] = valueRaw;
  }
  return out;
}

/**
 * 按声明名精确提取字面量的值：`(?:export )?(?:const|let|var) NAME =
 * [Object.freeze(] [new Set(] [...]|{...}`——取第一处匹配（审计站点每文件
 * 每名只出现一次），数组返回 string[]（parseArrayLiteral），对象返回
 * {key:value}（parseObjectLiteral）。找不到声明返回 null。
 * `rawSrc` 是未剥注释的原始源码字符串（内部会 stripComments）。
 */
export function extractNamedLiteral(rawSrc, name) {
  const src = stripComments(rawSrc);
  const declRe = new RegExp(
    `(?:export\\s+)?(?:const|let|var)\\s+${name}\\s*=\\s*(?:Object\\.freeze\\(\\s*)?(?:new Set\\(\\s*)?([[{])`,
  );
  const m = declRe.exec(src);
  if (!m) return null;
  const openCh = m[1];
  const openIdx = m.index + m[0].length - 1;
  const closeCh = openCh === '[' ? ']' : '}';
  const closeIdx = findMatchingClose(src, openIdx, openCh, closeCh);
  if (closeIdx === -1) return null;
  const body = src.slice(openIdx + 1, closeIdx);
  return openCh === '[' ? parseArrayLiteral(body) : parseObjectLiteral(body);
}

/**
 * 按任意正则锚点提取"无声明绑定"的内联数组字面量（`isFixMode = [...]`、
 * `[...].includes(taskType)`、SQL `task_type (NOT )?IN (...)` 这类形状）——
 * `anchorRegex` 必须恰好一个捕获组，捕获数组/IN列表的**内部文本**（不含外层
 * 括号），且内部不能有更深层嵌套括号（审计站点全部是扁平字符串列表，用不到
 * 深度计数）。`rawSrc` 未剥注释。找不到匹配返回 null。
 */
export function extractInlineArray(rawSrc, anchorRegex) {
  const src = stripComments(rawSrc);
  const m = anchorRegex.exec(src);
  if (!m || m[1] === undefined) return null;
  return parseArrayLiteral(m[1]);
}
