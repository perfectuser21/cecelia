// evaluator 真人 QA 报告（05-qa-report-rN.md）的解析与判定（纯函数）。
//   `### T-n` 按 QA 场景测：对应 Q-n、verdict、```command```、```output```（同 04 证据格式，复用 lib/evidence.mjs）
//   `### X-n` 探索发现：对应 I-n/Q-n、verdict（FAIL = 发现问题）、严重度、场景 + 命令与输出
import { parseEvidence } from './evidence.mjs';
import { BLOCKING } from './review.mjs';

const Q_RE = /^Q-\d+$/;
const IQ_RE = /^[IQ]-\d+$/;
const FIELD = (name) => new RegExp(`^\\s*(?:[-*]\\s+)?(?:\\*\\*)?${name}(?:\\*\\*)?\\s*[:：]\\s*(.*?)\\s*$`);
const SEVERITY_RE = FIELD('严重度');
const SCENE_RE = FIELD('场景');
// 单元测试当证据（那是 CI 的事，不是真人 QA）
const UNIT_TEST_RE = /\b(?:vitest|jest|mocha)\b|\bnpm\s+(?:run\s+)?test\b|\bnode\s+--test\b|\bnpx\s+playwright\s+test\b/;
// 生产 Brain：本机 5221 是 socat 代理到 us-vps 生产；us-vps tailscale IP
const PRODUCTION_RE = /(?:^|[^\d])5221(?:[^\d]|$)|100\.79\.41\.61/;

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
  const t = parseEvidence(raw, { prefix: 'T', coversRe: Q_RE });
  const x = parseEvidence(raw, { prefix: 'X', coversRe: IQ_RE });
  const fields = findingFields(raw);
  const errors = [...t.errors, ...x.errors];
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
 * 否则 verdict：T-n 全 PASS 且没有判 FAIL 的阻断/重要发现 → PASS，否则 FAIL（failed/blocking 交给修复环）。
 */
export function judgeQa({ tests, findings, errors }, qaIds) {
  if (errors.length > 0) return { reason: 'qa_report_invalid', errors };
  const missing = qaIds.filter((q) => !tests.some((t) => t.covers.includes(q)));
  if (missing.length > 0) return { reason: 'qa_incomplete', missing };
  const failed = tests.filter((t) => t.verdict === 'FAIL');
  const blocking = findings.filter((f) => f.verdict === 'FAIL' && BLOCKING.has(f.severity));
  return { reason: null, verdict: failed.length === 0 && blocking.length === 0 ? 'PASS' : 'FAIL', failed, blocking };
}

/** 用单元测试当证据的条目 id。 */
export function unitTestEvidence(items) {
  return items.filter((i) => UNIT_TEST_RE.test(i.command ?? '')).map((i) => i.id);
}

/** 执行记录里碰过生产 Brain 的命令。 */
export function productionTouches(executions) {
  return executions.map((e) => e.command).filter((c) => PRODUCTION_RE.test(c));
}
