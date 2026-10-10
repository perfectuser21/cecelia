// evaluator 真人 QA 报告（05-qa-report-rN.md）的解析与判定（纯函数）。
//   `### T-n` 按 QA 场景测：对应 Q-n、verdict、```command```、```output```（同 04 证据格式，复用 lib/evidence.mjs）
//   `### X-n` 探索发现：对应 I-n/Q-n、verdict（FAIL = 发现问题）、严重度、场景 + 命令与输出
//   T-n 另可判 CANNOT_VERIFY（验不了，必须写 `原因:`；审计 #38，旧 evaluator unverifiable 第三态）
import fs from 'node:fs';
import path from 'node:path';
import { parseEvidence } from './evidence.mjs';
import { BLOCKING } from './review.mjs';

const Q_RE = /^Q-\d+$/;
export const CANNOT_VERIFY = 'CANNOT_VERIFY';
const IQ_RE = /^[IQ]-\d+$/;
const FIELD = (name) => new RegExp(`^\\s*(?:[-*]\\s+)?(?:\\*\\*)?${name}(?:\\*\\*)?\\s*[:：]\\s*(.*?)\\s*$`);
const SEVERITY_RE = FIELD('严重度');
const SCENE_RE = FIELD('场景');
// 单元测试当证据（那是 CI 的事，不是真人 QA）
const UNIT_TEST_RE = /\b(?:vitest|jest|mocha)\b|\bnpm\s+(?:run\s+)?test\b|\bnode\s+--test\b|\bnpx\s+playwright\s+test\b/;
// 生产 Brain：本机 5221 是 socat 代理到 us-vps 生产；us-vps tailscale IP / 主机别名
const PRODUCTION_TARGET_RE = /:5221\b|\b(?:localhost|127\.0\.0\.1)\s+5221\b|100\.79\.41\.61|\bus-vps\b/;
// 真正发出访问的命令（网络请求 / 数据库 / 远程登录 / 脚本里的 fetch）；grep/cat/sed 读到这些字样不算碰生产
// （金丝雀 3e8414f6：规格 Q-n 本就写着 localhost:5221，只读命令被误判 evaluate_touched_production）
const NETWORK_RE = /\b(?:curl|wget|nc|ncat|telnet|psql|pg_dump|ssh|scp|rsync|fetch|axios|requests|http\.get|https\.get)\b/;

/** X-n 小节里的 严重度/场景（parseEvidence 不认这两个字段，单独扫）。 */
function findingFields(text) {
  const out = {};
  let id = null;
  for (const line of text.split(/\r?\n/)) {
    const h = /^### (X-\d+)/.exec(line);
    if (h) {
      id = h[1];
      out[id] = { severity: '', scene: '' };
      continue;
    }
    if (/^#{1,3}\s/.test(line)) {
      id = null;
      continue;
    }
    if (!id) continue;
    const s = SEVERITY_RE.exec(line);
    if (s && !out[id].severity) out[id].severity = s[1].replace(/\*\*/g, '');
    const c = SCENE_RE.exec(line);
    if (c && !out[id].scene) out[id].scene = c[1].replace(/\*\*/g, '');
  }
  return out;
}

/** → { tests: [{id, covers, verdict, command, output}], findings: [{…, severity, scene}], errors } */
export function parseQaReport(text) {
  const raw = typeof text === 'string' ? text : '';
  const t = parseEvidence(raw, { prefix: 'T', coversRe: Q_RE, verdicts: ['PASS', 'FAIL', CANNOT_VERIFY] });
  const x = parseEvidence(raw, { prefix: 'X', coversRe: IQ_RE });
  const fields = findingFields(raw);
  const errors = [...t.errors, ...x.errors];
  for (const item of t.items) if (item.verdict === CANNOT_VERIFY && !item.reason) errors.push(`${item.id}:reason_missing`);
  const findings = x.items.map((item) => {
    const f = fields[item.id] ?? { severity: '', scene: '' };
    if (item.verdict === 'FAIL') {
      if (!f.severity) errors.push(`${item.id}:severity_missing`);
      if (!f.scene) errors.push(`${item.id}:scene_missing`);
    }
    return { ...item, ...f };
  });
  return { tests: t.items, findings, errors };
}

/**
 * 判定：格式错 → reason qa_report_invalid；有 Q-n 没测 → reason qa_incomplete（报告不合格，不是产品不合格）；
 * 否则 verdict：有 T-n FAIL 或判 FAIL 的阻断/重要发现 → FAIL（failed/blocking 交给修复环）；
 * 没有 FAIL 但有 T-n 验不了 → CANNOT_VERIFY（不进修复环，交人看；cannot_verify 带原因）；全 PASS → PASS。
 */
export function judgeQa({ tests, findings, errors }, qaIds) {
  if (errors.length > 0) return { reason: 'qa_report_invalid', errors };
  const missing = qaIds.filter((q) => !tests.some((t) => t.covers.includes(q)));
  if (missing.length > 0) return { reason: 'qa_incomplete', missing };
  const failed = tests.filter((t) => t.verdict === 'FAIL');
  const blocking = findings.filter((f) => f.verdict === 'FAIL' && BLOCKING.has(f.severity));
  const cannot = tests.filter((t) => t.verdict === CANNOT_VERIFY);
  const verdict = failed.length > 0 || blocking.length > 0 ? 'FAIL' : cannot.length > 0 ? CANNOT_VERIFY : 'PASS';
  return { reason: null, verdict, failed, blocking, cannot_verify: cannot };
}

/** 用单元测试当证据的条目 id。 */
export function unitTestEvidence(items) {
  return items.filter((i) => UNIT_TEST_RE.test(i.command ?? '')).map((i) => i.id);
}

// 变量赋值指向生产（B=http://localhost:5221 之后 curl $B）
const PRODUCTION_ASSIGN_RE = /\b[A-Za-z_][A-Za-z0-9_]*=['"]?\S*(?::5221\b|100\.79\.41\.61|\bus-vps\b)/;

/**
 * 执行记录里访问过生产 Brain 的命令：按 ; && || | 切成片段，同一片段里既有访问动作又指向生产；
 * 或整条命令里有变量被赋成生产地址、同时有访问动作。
 */
export function productionTouches(executions) {
  return executions.map((e) => e.command).filter((c) => {
    const cmd = String(c);
    if (PRODUCTION_ASSIGN_RE.test(cmd) && NETWORK_RE.test(cmd)) return true;
    return cmd.split(/;|&&|\|\||\|/).some((part) => NETWORK_RE.test(part) && PRODUCTION_TARGET_RE.test(part));
  });
}

// 恒真命令（审计 #36，旧 evaluator 反作弊红线 + proposer 作弊反例清单）：吞掉失败、假执行、只回显自己的结论
const SWALLOW_RE = /\|\|\s*(?:true|:)\s*$|;\s*exit\s+0\s*$|--dry-run\b/;
const ECHO_ONLY_RE = /^\s*(?:echo|printf|true|:)(?:\s|$)/;

/** 判 PASS 却用恒真命令的条目 id（FAIL 条目不管：它已经在报问题）。 */
export function trivialAssertions(items) {
  return items.filter((i) => i.verdict === 'PASS').filter((i) => {
    const lines = String(i.command ?? '').split('\n').map((l) => l.trim()).filter(Boolean);
    if (lines.length === 0) return false;
    return lines.some((l) => SWALLOW_RE.test(l)) || lines.every((l) => ECHO_ONLY_RE.test(l));
  }).map((i) => i.id);
}

const SHOT_REF_RE = /^\s*(?:[-*]\s+)?(?:\*\*)?截图(?:\*\*)?\s*[:：]\s*(.+?)\s*$/gm;
const BROWSER_RE = /\bplaywright\b|\bchromium\b|\bpuppeteer\b/i;
const IMAGE_RE = /\.(?:png|jpe?g|webp)$/i;
const IMAGE_PATH_RE = /[\w./-]+\.(?:png|jpe?g|webp)\b/gi;

/** 条目是否用了浏览器：命令里直接出现，或跑的脚本是本次会话写出来、内容引用浏览器库的。 */
function usesBrowser(command, executions) {
  if (BROWSER_RE.test(command)) return true;
  const scripts = [...command.matchAll(/([\w./-]+\.(?:mjs|cjs|js|ts|py))\b/g)].map((m) => path.basename(m[1]));
  return scripts.some((name) => executions.some((e) => String(e.command).includes(name) && BROWSER_RE.test(String(e.command))));
}

/**
 * 截图校验（审计 #37，旧 evaluator 领域死规则：UI 必须有可见断言）：
 * 报告 `截图:` 引用的文件必须存在（相对 sprint 目录）→ screenshot_missing:<路径>；
 * 用了浏览器的条目，本轮截图目录里至少要有一张图 → screenshot_none:<id>。
 */
export function screenshotProblems({ reportText = '', items = [], executions = [], sprintDir, shotsDir }) {
  const problems = [];
  for (const m of reportText.matchAll(SHOT_REF_RE)) {
    // 截图行常在路径后写说明（金丝雀 3：「qa-r1/a.png（分类留空：弹窗已关…）、qa-r1/b.png（…）」）：只取图片路径
    for (const ref of m[1].match(IMAGE_PATH_RE) ?? []) {
      const file = path.resolve(sprintDir, ref);
      if (!file.startsWith(path.resolve(sprintDir) + path.sep) || !fs.existsSync(file)) problems.push(`screenshot_missing:${ref}`);
    }
  }
  const shots = fs.existsSync(shotsDir) ? fs.readdirSync(shotsDir).filter((f) => IMAGE_RE.test(f)) : [];
  if (shots.length === 0) {
    for (const i of items) if (usesBrowser(String(i.command ?? ''), executions)) problems.push(`screenshot_none:${i.id}`);
  }
  return problems;
}
