/**
 * Contract Gate — spawn evaluator 前的确定性合同预检（零 LLM，单一来源）。
 *
 * 把"合同质量红线"（弱 oracle / 作弊 / 环境能力 / 领域规则）从 SKILL.md 的 LLM 自觉执行，
 * 下沉为 spawn LLM evaluator **之前**的代码层硬门禁：不合格合同直接拦截，不浪费一个
 * evaluator 容器（每个 ~$5-7）。
 *
 * 设计要点：
 *  - 数据化规则表（RULES 数组）：每条含 id / description / detect / feedback，新增规则只加一行。
 *  - 环境能力清单（ENV_CAPABILITY）：可配置，引用不可用二进制 → env_missing。
 *  - 纯 regex/解析，确定性、可单测；无 LLM、无网络、无副作用。
 *  - CLI（contract-gate-check.mjs）与 graph 节点（evaluateContractNode）共享 runContractGate（单一来源）。
 *
 * 返回契约（ground truth，禁止漂移字段名）：
 *   { ok, hits[{ruleId,line,excerpt,feedback,exempted}], exemptions[{ruleId,reason,matched}],
 *     envMissing[{tool,line,excerpt}] }
 */

import fs from 'node:fs';
import path from 'node:path';

/**
 * 环境能力清单（可配置）。引用 unavailable 里的二进制 → env_missing。
 * 初值来自 PRD ASSUMPTION：evaluator 容器有 curl/jq/git/gh/node/python3/psql，
 * 没有 docker/ffprobe/playwright（后续可按 target_environment 调整）。
 */
export const ENV_CAPABILITY = {
  available: ['curl', 'jq', 'git', 'gh', 'node', 'python3', 'psql', 'bash'],
  unavailable: ['docker', 'ffprobe', 'playwright'],
};

/**
 * 数据化规则表。每条规则对单行验收脚本做确定性判定。
 * detect(line) → boolean；feedback(ctx) → string（{line}/{tool} 已替换）。
 */
export const RULES = [
  {
    id: 'weak-oracle/curl-no-jq',
    description: 'curl 取响应却无 jq -e 值校验',
    // 放行四类合法 oracle：
    //  - 同一逻辑语句含 jq -e（含反斜杠续行多行 pipeline，预处理已归一为单逻辑行）
    //  - 状态码 oracle：curl -w %{http_code} 捕获状态码 + 后续码断言（body 刻意丢弃，jq 不适用）
    //  - capture-then-assert：VAR=$(curl ...) 捕获响应，后续 K 条逻辑语句内对 $VAR 施加
    //    jq -e / grep -q / [ 比较 / case 值断言（跨语句 oracle，见 hasCaptureThenAssert）
    //  - inline `curl ... | grep -q '<字面量>'`：验 HTML/文本响应（无法 jq）的合法强 oracle，
    //    与 capture-then-assert 的 grep -q 放行一致；同义反复另由 weak-oracle/tautology 守（见 hasInlineGrepAssert）
    detect: (line, ctx) =>
      /\bcurl\b/.test(line) &&
      !/\bjq\s+-e\b/.test(line) &&
      !isStatusCodeOracle(line) &&
      !hasInlineGrepAssert(line) &&
      !hasCaptureThenAssert(line, ctx),
    feedback: ({ line }) =>
      `第 ${line} 行 curl 取响应但未 jq -e 校验字段值——加 | jq -e '.field == ...'`,
  },
  {
    id: 'cheat/mock-env',
    description: 'MOCK_* 环境变量注入假环境',
    detect: (line) => /\bMOCK_[A-Z0-9]/.test(line),
    feedback: ({ line }) => `第 ${line} 行注入 MOCK_*——删除，读真实环境`,
  },
  {
    id: 'cheat/exit-0-fallback',
    description: '无条件 exit 0 兜底',
    detect: (line) =>
      /\|\|\s*exit\s+0\b/.test(line) ||
      /\belse\s+exit\s+0\b/.test(line) ||
      /^\s*exit\s+0\s*;?\s*$/.test(line),
    feedback: ({ line }) => `第 ${line} 行无条件 exit 0 兜底——不可用即 FAIL，禁兜底`,
  },
  {
    id: 'cheat/or-true',
    description: '断言尾部 || true 吞错',
    // 两类负向测试（预期失败）惯用法不算吞错，放行；其余裸 || true 仍命中：
    //  - 单语句块：`cmd && { ...; exit N; } || true`（N≠0，见 isNegativeFailAssertion）
    //  - 捕获形态：`VAR=$( <预期失败命令> || true)` 把预期失败命令输出捕获，后续 K 条逻辑语句
    //    内对同名 $VAR 施加值断言（见 isCaptureNegativeThenAssert，复用 hasCaptureThenAssert）
    detect: (line, ctx) =>
      /\|\|\s*true\b/.test(line) &&
      !isNegativeFailAssertion(line) &&
      !isCaptureNegativeThenAssert(line, ctx),
    feedback: ({ line }) =>
      `第 ${line} 行 || true 吞掉失败 exit code——删除；若为负向测试（预期失败），` +
      `改写为 if cmd; then echo FAIL; exit 1; fi 或用 gate-allow 豁免留痕`,
  },
  {
    id: 'weak-oracle/file-existence-only',
    description: '只查文件存在/大小，无内容断言',
    detect: (line) =>
      /\btest\s+-[fes]\b/.test(line) || /\bls\s+-l\b/.test(line) || /\.size\b/.test(line),
    feedback: ({ line }) =>
      `第 ${line} 行只查文件存在/大小——加内容/业务属性断言（如 grep -q '<关键内容>' file）`,
  },
  {
    id: 'weak-oracle/tautology',
    description: '比较脚本自生成值的同义反复断言',
    detect: (line) => isTautology(line),
    feedback: ({ line }) => `第 ${line} 行断言对象是脚本自身输出——断言被测系统真实响应`,
  },
  {
    id: 'domain/db-no-time-window',
    description: '聚合/存在性探测 SELECT 无 created_at > NOW()-interval 时间窗（拿历史冒充本轮产出）',
    // 只作用于【聚合/计数】或【无主键等值的存在性探测】SELECT（见 isAggregateDbProbeWithoutWindow）。
    // 定点读（WHERE id/uuid 等值）+ INSERT/UPDATE/DELETE 写语句不命中——它们读/写确定行，无历史冒充面。
    detect: (line) => isAggregateDbProbeWithoutWindow(line),
    feedback: ({ line }) =>
      `第 ${line} 行 DB 聚合/存在性探测缺时间窗——加 AND created_at > NOW() - interval '5 minutes'` +
      `（定点读 WHERE id=... 不需要；若确为定点读被误判可 gate-allow 豁免）`,
  },
  {
    id: 'domain/tenant-no-isolation',
    description: '涉及多租户面的 DB 探测缺租户隔离约束（跨租户读/改红线）',
    detect: (line) => isTenantProbeWithoutIsolation(line),
    feedback: ({ line }) =>
      `第 ${line} 行涉及多租户面（tenant）的 DB 探测缺租户隔离约束——加 WHERE tenant_id = '<本租户>'` +
      `（跨租户读写红线；确属单租户面误报可 gate-allow: domain/tenant-no-isolation 豁免留痕）`,
  },
];

/**
 * 租户隔离红线判定（P0 铁律「租户隔离」，保守正则 + gate-allow 逃生口）。
 *
 * 本意：防"验收探测跨租户扫全表"——多租户面上的 SELECT/UPDATE/DELETE 若不带
 * tenant_id 等值/IN 约束，读到的可能是别的租户的数据（拿别人的行冒充本租户产出，
 * 或验收误改别的租户）。保守面收口三重，宁缺勿滥：
 *  1. 只管 psql DB 探测（API 层多租户断言形态太散，暂不强判，避免误伤面失控）；
 *  2. 语句必须出现 tenant 词根（tenant_id 列 / tenants 表 / tenant_users 等）才算
 *     "涉及多租户面"——不含 tenant 字样的单租户表不命中；
 *  3. 已带 `tenant_id =` / `tenant_id IN` 隔离约束 → 放行；INSERT（写新行、列值里
 *     显式给 tenant_id）不命中。
 * 误报逃生口：gate-allow: domain/tenant-no-isolation <理由>（单条豁免留痕，fail-open）。
 *
 * @param {string} line  单条逻辑语句
 * @returns {boolean}  true=命中 domain/tenant-no-isolation
 */
export function isTenantProbeWithoutIsolation(line) {
  if (typeof line !== 'string' || line.length > 2000) return false;
  if (!/\bpsql\b/.test(line)) return false; // 只管 DB 探测
  if (!/tenant/i.test(line)) return false; // 未涉及多租户面
  if (!/\b(?:SELECT|UPDATE|DELETE)\b/i.test(line)) return false; // INSERT/DDL 不命中
  if (/\btenant_id\s*(?:=|IN\b)/i.test(line)) return false; // 已有租户隔离约束
  return true;
}

/**
 * 同义反复检测（精确，避免误伤 `echo "$OUT" | grep "<真实期望>"`）：
 *  A. echo <字面量> | grep <相同字面量>（如 echo PASS | grep PASS）
 *  B. VAR=val …; [ "$VAR" = val ]（自赋值后比较同值）
 */
export function isTautology(line) {
  // 行过长（异常输入）跳过 Pattern B 的线性二次扫描，避免大输入阻塞（合同正常很短）
  if (line.length > 2000) return false;
  // A: echo LITERAL | grep [-flags] LITERAL，两个字面量相同 → 同义反复
  const a = line.match(
    /echo\s+(['"]?)([A-Za-z0-9_]+)\1\s*\|\s*grep\s+(?:-\w+\s+)*(['"]?)([A-Za-z0-9_]+)\3/
  );
  if (a && a[2] === a[4]) return true;
  // B: VAR=val ... [ "$VAR" = val ]
  const b = line.match(
    /\b([A-Za-z_]\w*)=([A-Za-z0-9_]+)\b.*\[\s*"?\$\{?([A-Za-z_]\w*)\}?"?\s*=\s*([A-Za-z0-9_]+)/
  );
  if (b && b[1] === b[3] && b[2] === b[4]) return true;
  return false;
}

/**
 * 负向测试（预期失败）惯用法识别：`cmd && { ...; exit N; } || true`（N≠0）。
 *
 * 语义：cmd【预期失败】；若反而成功（&& 成立）则进入块内主动 `exit N` 报 FAIL。
 * 末尾 `|| true` 承接的是 cmd 的【预期失败】退出码（set -e 下避免预期失败直接杀脚本），
 * 不是吞掉真实断言的失败 → 不应判 cheat/or-true。这是验证 fail-closed 行为的合同绕不开的写法。
 *
 * 仅识别【单行】结构（`&& { ... } || true` 同行）：覆盖生产实证的两种负向测试，
 * 以及 `exit "$N"` / `return N` / 多语句块等常见变体。多行 `{}`（块跨行）等复杂变体
 * 行级匹配识别不到时，保守命中 cheat/or-true（fail-closed），由作者用 gate-allow 显式豁免留痕。
 *
 * @param {string} line  单行验收脚本
 * @returns {boolean}  true=负向测试惯用法（放行），false=非负向结构（按原规则判定）
 */
export function isNegativeFailAssertion(line) {
  if (typeof line !== 'string' || line.length > 2000) return false;
  // && { ...块... } || true：块与 || true 同行
  const m = line.match(/&&\s*\{([\s\S]*?)\}\s*\|\|\s*true\b/);
  if (!m) return false;
  const block = m[1];
  // 块内含 exit/return 非零码：纯数字 1-9.. / 变量 $N、${N}、"$N"（运行期非零意图）
  return /\b(?:exit|return)\s+(?:["']?\$\{?\w+\}?["']?|[1-9]\d*)/.test(block);
}

/**
 * 注释行识别（扫描器第一课：先剥离注释，再谈规则）。
 *
 * 纯注释行（首个非空白字符为 `#`）是写给人看的说明，不是验收脚本——不应参与任何
 * cheat/weak-oracle 规则扫描（生产 run da418741：注释里写 `... || true ...` 被误判
 * cheat/or-true）。保守只做【行首 `#`】跳过：行尾注释段的剥离涉及 heredoc / 字符串内
 * `#` 的边界（如 `grep '#tag'`、URL fragment `http://x#y`），拿捏不准宁可不剥，
 * 避免把真命令的尾部误判成注释而放水。
 *
 * @param {string} line  单条逻辑语句
 * @returns {boolean}  true=纯注释行（跳过所有规则）
 */
export function isCommentLine(line) {
  return typeof line === 'string' && /^\s*#/.test(line);
}

/**
 * 提取捕获赋值 `VAR=$( ... )` / `` VAR=`...` `` 命令替换的内部内容（不含外层定界符）。
 * `$( )` 用括号深度扫描，正确处理内部嵌套 `$(...)`；反引号扫到下一个反引号。
 * 非捕获形态 → null。
 *
 * @param {string} line  单条逻辑语句
 * @returns {string|null}  命令替换内部内容
 */
function captureSubstitutionSpan(line) {
  if (typeof line !== 'string') return null;
  // VAR=$( 或 VAR="$(
  const sub = line.match(/(?:^|[\s;&|(])[A-Za-z_]\w*=(?:"?)\$\(/);
  if (sub) {
    let depth = 1;
    let i = sub.index + sub[0].length;
    const start = i;
    for (; i < line.length; i++) {
      const c = line[i];
      if (c === '(') depth++;
      else if (c === ')') {
        depth--;
        if (depth === 0) break;
      }
    }
    return line.slice(start, i);
  }
  // VAR=`...`
  const bt = line.match(/(?:^|[\s;&|(])[A-Za-z_]\w*=`/);
  if (bt) {
    const start = bt.index + bt[0].length;
    const end = line.indexOf('`', start);
    return end === -1 ? line.slice(start) : line.slice(start, end);
  }
  return null;
}

/**
 * 捕获形态负向测试识别（cheat/or-true 放行第二类）。
 *
 * 形态：`VAR=$( <预期失败命令> 2>&1 || true)` 把【预期失败】命令的输出捕获进变量，
 * 末尾 `|| true` 仅落在【命令替换 $( ) 内部】，只为让命令替换不因预期失败而中断
 * （set -e 下避免预期失败杀脚本，与 #3351 单语句负向断言同语义）；随后【K 条逻辑语句内】
 * 对同名 $VAR 施加值断言（grep -q / jq -e / [ 比较 / case，复用 hasCaptureThenAssert）。
 *
 * 三重收口防放水：
 *  1. 必须是 `VAR=$(...)` 捕获形态（captureSubstitutionSpan）；
 *  2. `|| true` 必须落在该捕获的命令替换【内部】——赋值之外的另一条 `foo || true` swallow
 *     不放行（防"捕获 + 无关 swallow"假放行）；
 *  3. 后续 K 条逻辑语句内对【同名】 $VAR 有值断言——裸捕获后无断言仍命中（防真吞错）。
 *
 * @param {string} line  当前逻辑语句内容
 * @param {object} [ctx]  归一后逻辑语句序列 + 当前下标（见 hasCaptureThenAssert）
 * @returns {boolean}  true=捕获形态负向测试（放行）
 */
export function isCaptureNegativeThenAssert(line, ctx) {
  if (typeof line !== 'string' || line.length > 2000) return false;
  const inner = captureSubstitutionSpan(line);
  if (inner == null) return false; // 非捕获形态
  if (!/\|\|\s*true\b/.test(inner)) return false; // || true 不在命令替换内部
  return hasCaptureThenAssert(line, ctx); // 后续 K 条逻辑语句内对同名 $VAR 有值断言
}

/**
 * 状态码 oracle 识别：`curl ... -w %{http_code}` 捕获 HTTP 状态码 + 后续码断言。
 *
 * 语义：body 被 `-o /dev/null` 刻意丢弃，只取状态码做 oracle（如 `[ "$HTTP_CODE" = "200" ]`），
 * jq 取字段值在此不适用 → 这是合法 oracle，curl-no-jq 不应误报。
 * 引号变体兼容：`-w "%{http_code}"` / `-w '%{http_code}'` / `-w %{http_code}` 及长选项 `--write-out` 均认。
 *
 * @param {string} line  单行（逻辑行）验收脚本
 * @returns {boolean}  true=状态码 oracle（curl-no-jq 放行）
 */
export function isStatusCodeOracle(line) {
  if (typeof line !== 'string') return false;
  return /(?:-w|--write-out)\b/.test(line) && /%\{http_code\}/.test(line);
}

// 在命令替换/反引号捕获中提取被赋值的变量名（仅认 `VAR=$(...)` / `VAR="$(...)"` / `VAR=`...``）。
// 赋值无空格（`VAR=$(`），与 `[ "$X" = v ]` 的带空格比较 `=` 天然区分，不误取。
function captureAssignVar(line) {
  if (typeof line !== 'string') return null;
  const m = line.match(/(?:^|[\s;&|(])([A-Za-z_]\w*)=(?:"?\$\(|`)/);
  return m ? m[1] : null;
}

// 某逻辑语句是否对 $VAR 施加了【值断言】：引用 $VAR/"$VAR"/${VAR} 且含
// jq -e / grep -q / [ 或 [[ 比较 / case / test 之一（变量名精确匹配，防"捕获 A 断言 B"假放行）。
function isValueAssertionOnVar(stmt, varName) {
  if (typeof stmt !== 'string') return false;
  const ref = new RegExp(`\\$\\{?${varName}\\b`);
  if (!ref.test(stmt)) return false;
  return (
    /\bjq\s+-e\b/.test(stmt) ||
    /\bgrep\s+-\w*q/.test(stmt) ||
    /\[\[?\s/.test(stmt) ||
    /\bcase\b/.test(stmt) ||
    /\btest\s+-?\w/.test(stmt)
  );
}

/**
 * capture-then-assert 跨语句 oracle 识别（curl-no-jq 放行第三类）。
 *
 * 形态：`RESP=$(curl ...)` 捕获响应（本语句可能只做失败传播 `|| { echo FAIL; exit 1; }`，
 * 无值断言），其后【K 条逻辑语句】内对【同名】 $RESP 施加 jq -e / grep -q / [ 比较 / case 值断言。
 * 这是合法的 oracle，只是值校验落在捕获语句的下一条逻辑语句 → curl-no-jq 不应误报。
 *
 * 变量名精确匹配：只认对【同一变量】的断言，杜绝"捕获 RESP 却断言无关 X"的假放行。
 * 找不到（裸 `RESP=$(curl)` 后 K 行无断言）→ 返回 false，curl-no-jq 照常命中（不放水）。
 *
 * @param {string} line  当前逻辑语句内容
 * @param {{logicalLines?:{content:string}[], index?:number, K?:number}} [ctx]  归一后的逻辑语句序列 + 当前下标
 * @returns {boolean}  true=跨语句断言成立（放行）
 */
export function hasCaptureThenAssert(line, ctx) {
  if (!ctx || !Array.isArray(ctx.logicalLines)) return false;
  const varName = captureAssignVar(line);
  if (!varName) return false; // 非 VAR=$(curl) 捕获形态 → 不适用本放行
  const K = typeof ctx.K === 'number' ? ctx.K : 5;
  const start = (typeof ctx.index === 'number' ? ctx.index : -1) + 1;
  const end = Math.min(ctx.logicalLines.length, start + K);
  for (let i = start; i < end; i++) {
    const stmt = ctx.logicalLines[i] && ctx.logicalLines[i].content;
    if (typeof stmt !== 'string') continue;
    if (/gate-allow:/.test(stmt)) continue; // 元数据行不算断言
    if (isValueAssertionOnVar(stmt, varName)) return true;
  }
  return false;
}

/**
 * inline curl|grep-q oracle 识别（curl-no-jq 放行第四类）。
 *
 * 形态：`curl ... | grep -q[E] '<字面量>'`——curl 响应体直接管道给 grep -q 断言含特定内容。
 * 这是验 HTML/纯文本响应（无法 jq）的合法强 oracle，与 capture-then-assert 的 grep -q 放行
 * （见 isValueAssertionOnVar line 263）功能等价，只是不经中间变量。
 *
 * 不放水：同义反复（如 `echo X | grep X` 自生成值比对）由 weak-oracle/tautology 单独守；
 * 此处只判"curl 响应进了 grep -q"这一结构，断言对象是被测系统真实响应。
 *
 * @param {string} line  当前逻辑语句内容（curl 与 grep 同一逻辑行 = inline 管道）
 * @returns {boolean}  true=inline curl|grep-q 断言成立（放行）
 */
export function hasInlineGrepAssert(line) {
  if (typeof line !== 'string') return false;
  return /\bcurl\b/.test(line) && /\|\s*grep\s+-\w*q\b/.test(line);
}

/**
 * DB 时间窗规则的判定（按断言意图分型，不用句法特征当意图）。
 *
 * 时间窗的本意：防"拿历史数据冒充本轮产出"。只有【会扫到历史行】的断言才需要时间窗：
 *  - 聚合/计数：count(*) / sum / avg / min / max → 必命中（即便带 WHERE，仍跨历史聚合）
 *  - 无主键等值约束的存在性探测 SELECT（如 `SELECT 1 FROM t WHERE status='sent'`）→ 命中
 * 不需要时间窗（放行）：
 *  - 定点读：`SELECT col FROM t WHERE id=... / uuid=... / *_id=...`（读确定的一行，无冒充面）
 *  - INSERT / UPDATE / DELETE 写语句（含 RETURNING）：写确定行，不查历史
 *  - 已带 interval / NOW() 时间窗
 * 边界拿不准（非聚合、无主键等值）→ 保守命中（fail-closed），作者用 gate-allow 兜底。
 *
 * @param {string} line  单条逻辑语句
 * @returns {boolean}  true=命中 domain/db-no-time-window
 */
export function isAggregateDbProbeWithoutWindow(line) {
  if (typeof line !== 'string') return false;
  if (!/\bpsql\b/.test(line)) return false;
  if (/\binterval\b/i.test(line) || /NOW\s*\(\s*\)/i.test(line)) return false; // 已有时间窗
  if (!/\bSELECT\b/i.test(line)) return false; // 仅读语句；纯写（INSERT...RETURNING）无 SELECT，放行
  // 聚合/计数：即便同句含写或带 WHERE，聚合读仍跨历史 → 必命中（优先于写语句放行）
  if (/\b(?:count|sum|avg|min|max)\s*\(/i.test(line)) return true;
  // 纯写语句（无聚合读）：写确定行，不查历史 → 放行
  if (/\b(?:INSERT|UPDATE|DELETE)\b/i.test(line)) return false;
  // 非聚合 SELECT：主键等值定点读放行；否则（无主键等值的存在性探测）保守命中
  const hasPkEquality = /\bWHERE\b[\s\S]*?\b(?:id|uuid|\w+_id)\s*=\s*\S/i.test(line);
  return !hasPkEquality;
}

/** 解析 gate-allow 行 → { ruleId, reason }（合同显式豁免单条规则的逃生口）。 */
function parseExemptions(lines) {
  const out = [];
  lines.forEach((line) => {
    const m = line.match(/gate-allow:\s*(\S+)\s*(.*)$/);
    if (m) out.push({ ruleId: m[1].trim(), reason: (m[2] || '').trim() });
  });
  return out;
}

// 验收行锚定：`Test:` 必须在行首（可带 bullet/checkbox 前缀），不接受散文句中的 "...Test: ..."。
const TEST_LINE_RE = /^\s*(?:[-*]\s*)?(?:\[[ xX]\]\s*)?Test:\s*/;
// 围栏开：```lang（整行仅此）；围栏闭：裸 ```（CommonMark 闭合栏不带 info string）。
const FENCE_OPEN_RE = /^\s*```(\w*)\s*$/;
const FENCE_CLOSE_RE = /^\s*```\s*$/;

/**
 * 标记每行是否为「验收命令行」（只对命令行跑规则，不误伤散文描述/标题）。
 * 命令行 = 行首 `Test:` 行，或 **成对闭合** 的 ```bash/sh/```（无 info）围栏块内的行。
 *
 * 健壮性（防自锁 + 防绕过）：
 *  - 闭合栏必须是裸 ```（带语言标签的行视为块内容，不当闭合）→ 防作弊者插 ```js 伪闭合藏后续命令。
 *  - 未闭合围栏（缺裸 ```）→ 整块降级为「非命令」，不无限延伸扫描散文 → 防散文里的红线说明自命中。
 * @returns {boolean[]}  与 lines 等长
 */
function markCommandLines(lines) {
  const result = new Array(lines.length).fill(false);
  let i = 0;
  while (i < lines.length) {
    const open = lines[i].match(FENCE_OPEN_RE);
    if (open) {
      const lang = (open[1] || '').toLowerCase();
      const scannable = lang === '' || /^(bash|sh|shell|console)$/.test(lang);
      // 找成对的裸闭合栏
      let j = i + 1;
      while (j < lines.length && !FENCE_CLOSE_RE.test(lines[j])) j++;
      if (j >= lines.length) break; // 未闭合 → 降级，剩余行一律不当命令（防自锁）
      if (scannable) for (let k = i + 1; k < j; k++) result[k] = true;
      i = j + 1;
      continue;
    }
    if (TEST_LINE_RE.test(lines[i])) result[i] = true;
    i += 1;
  }
  return result;
}

/**
 * 反斜杠续行归一：把以 `\`（行尾，允许尾随空白）结尾的命令行与其后续物理行合并为
 * 单个【逻辑语句】，保留起始物理行号用于报告定位。
 *
 * 为什么必须先归一（行级规则的前置）：proposer 常把一条 shell pipeline 写成多物理行
 * （`curl ... \` 续 `| jq -e ...`）。若规则按物理行扫描，只看见首行 curl、看不见续行的
 * jq -e → 误报 weak-oracle/curl-no-jq（生产 run c0e2546b 被冤枉 3+ 轮的根因）。
 * 归一后所有行级规则（curl-no-jq / or-true / file-existence 等）都在完整逻辑语句上判定，
 * 既消盲区，也不给作弊者用续行拆词绕过的机会（拆开的词会被重新拼回）。
 *
 * 安全：只对【命令行】（Test: 行 / bash 围栏块内）启动归一；散文行即便以 `\` 结尾也不吞并
 * 其后的命令行（命令行仍会作为独立逻辑行被处理），不引入"散文吞命令"的绕过面。
 *
 * @param {string[]} lines      物理行数组
 * @param {boolean[]} isCommand markCommandLines 的逐物理行命令标记
 * @returns {{content:string, lineNo:number}[]}  逻辑行（仅命令行；lineNo=起始物理行号，1-based）
 */
function buildLogicalLines(lines, isCommand) {
  const out = [];
  let i = 0;
  while (i < lines.length) {
    if (!isCommand[i]) {
      i += 1;
      continue;
    }
    const startNo = i + 1;
    const parts = [];
    let k = i;
    while (k < lines.length) {
      const raw = lines[k];
      const continues = /\\\s*$/.test(raw);
      parts.push(continues ? raw.replace(/\\\s*$/, '') : raw);
      if (!continues) break;
      k += 1;
    }
    out.push({ content: parts.join(' '), lineNo: startNo });
    i = k + 1;
  }
  return out;
}

/**
 * 对一段合同文本做确定性 gate 判定（不读盘，便于单测）。
 * @param {string} text  合同（contract-dod.md）内容
 * @param {object} [opts]  { envCapability }
 * @returns {{ok:boolean, hits:object[], exemptions:object[], envMissing:object[]}}
 */
export function evaluateContractText(text, opts = {}) {
  const envCap = opts.envCapability || ENV_CAPABILITY;
  const lines = String(text == null ? '' : text).split('\n');

  const exemptions = parseExemptions(lines);
  const exemptIds = new Set(exemptions.map((e) => e.ruleId));

  // 只对验收命令行跑规则（Test: 行 / bash 围栏块），不误伤散文描述
  const isCommand = markCommandLines(lines);
  const hasAssertion = isCommand.some(Boolean);
  // 反斜杠续行归一为逻辑语句（保留起始物理行号），所有行级规则在完整逻辑语句上判定
  const logicalLines = buildLogicalLines(lines, isCommand);

  const hits = [];
  const envMissing = [];

  for (let idx = 0; idx < logicalLines.length; idx++) {
    const { content: line, lineNo } = logicalLines[idx];
    // gate-allow 行本身不参与规则检测（它是元数据，不是验收脚本）
    if (/gate-allow:/.test(line)) continue;
    // 纯注释行（行首 #）不参与任何规则/env 扫描——先剥离注释，再谈规则
    if (isCommentLine(line)) continue;
    const excerpt = line.trim().slice(0, 160);

    // 跨语句规则（如 curl-no-jq 的 capture-then-assert）需要后续逻辑语句上下文
    const ctx = { logicalLines, index: idx };

    for (const rule of RULES) {
      if (rule.detect(line, ctx)) {
        hits.push({
          ruleId: rule.id,
          line: lineNo,
          excerpt,
          feedback: rule.feedback({ line: lineNo }),
          exempted: exemptIds.has(rule.id),
        });
      }
    }

    // 工具 preflight：引用环境能力清单外的二进制（仅命令位置，排除 URL/路径/镜像名子串）
    // 例：https://playwright.dev、docker.io/img、/usr/bin/foo-docker 不算「引用该二进制」。
    for (const tool of envCap.unavailable) {
      if (new RegExp(`(?<![\\w./-])${tool}(?![\\w.-])`).test(line)) {
        envMissing.push({
          ruleId: 'env-missing',
          tool,
          line: lineNo,
          excerpt,
          exempted: exemptIds.has('env-missing') || exemptIds.has(`env-missing/${tool}`),
        });
      }
    }
  }

  // 结构性：无任何可验收断言 → 不合格（空脚本/无命令）
  if (!hasAssertion) {
    hits.push({
      ruleId: 'structural/no-assertion',
      line: 0,
      excerpt: '(无验收命令)',
      feedback: '合同无可验收断言——不合格',
      exempted: exemptIds.has('structural/no-assertion'),
    });
  }

  // 豁免留痕：标记每条豁免是否真命中了某条 hit / env_missing（不存在的 rule-id → matched=false，不静默吞掉）
  for (const ex of exemptions) {
    ex.matched =
      hits.some((h) => h.ruleId === ex.ruleId) ||
      envMissing.some((e) => e.ruleId === ex.ruleId || `env-missing/${e.tool}` === ex.ruleId);
  }

  const unexempted = hits.filter((h) => !h.exempted);
  const unexemptedEnv = envMissing.filter((e) => !e.exempted);
  const ok = unexempted.length === 0 && unexemptedEnv.length === 0;

  return { ok, hits, exemptions, envMissing };
}

/**
 * 读取 fixtureDir 下的合同并跑 gate（单一来源；CLI 与 graph 节点共享）。
 * fail-closed：目录/文件不可读 → throw（调用方决定退出码；CLI 据此非零退出）。
 *
 * @param {string} fixtureDir  含 contract-dod.md（或 contract-draft.md）的目录
 * @param {object} [opts]  { contractFile, envCapability, readFile }
 * @returns {Promise<{ok:boolean, hits:object[], exemptions:object[], envMissing:object[], contractFile:string}>}
 */
export async function runContractGate(fixtureDir, opts = {}) {
  if (!fixtureDir || typeof fixtureDir !== 'string') {
    throw new Error('runContractGate: fixtureDir 必填（fail-closed）');
  }
  const readFile = opts.readFile || ((p) => fs.promises.readFile(p, 'utf8'));

  let contractFile = opts.contractFile;
  if (!contractFile) {
    const candidates = [
      path.join(fixtureDir, 'contract-dod.md'),
      path.join(fixtureDir, 'contract-draft.md'),
    ];
    contractFile = candidates.find((p) => fs.existsSync(p));
    if (!contractFile) {
      // fail-closed：没有可读合同绝不放行
      throw new Error(
        `runContractGate: ${fixtureDir} 下无 contract-dod.md / contract-draft.md（fail-closed）`
      );
    }
  }

  const text = await readFile(contractFile);
  const res = evaluateContractText(text, opts);
  return { ...res, contractFile };
}

/**
 * 把 gate 结果格式化成人类可读 + 可 grep 的报告（CLI stdout / 节点 feedback 共用）。
 * - 每条未豁免命中：`HIT <ruleId> <file>:<line> — <excerpt>`
 * - 每条豁免：`EXEMPT <ruleId> (gate-allow, matched=<bool>) — <reason>`（留痕）
 * - 每条 env_missing：`env_missing: <tool> <file>:<line> — <excerpt>`
 */
export function formatGateReport(result, fileLabel = 'contract-dod.md') {
  const out = [];
  for (const h of result.hits || []) {
    if (h.exempted) continue;
    out.push(`HIT ${h.ruleId} ${fileLabel}:${h.line} — ${h.excerpt}  | ${h.feedback}`);
  }
  for (const ex of result.exemptions || []) {
    out.push(
      `EXEMPT ${ex.ruleId} (gate-allow, matched=${ex.matched}) — 豁免理由: ${ex.reason || '(未填)'}`
    );
  }
  for (const em of result.envMissing || []) {
    if (em.exempted) continue;
    out.push(`env_missing: ${em.tool} ${fileLabel}:${em.line} — ${em.excerpt}`);
  }
  if (out.length === 0) return '';
  // 通用逃生口提示（报告头部）：proposer 不一定知道 gate-allow 这个单条豁免逃生口。
  const header =
    '提示：确属误报可在合同中用 `gate-allow: <rule-id> <理由>` 单条豁免留痕（逐条精确豁免，不影响其余红线）。';
  return [header, ...out].join('\n');
}
