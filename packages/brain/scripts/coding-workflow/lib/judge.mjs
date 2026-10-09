// 独立裁判（决策 02d8e749 的 ②d）：真人 QA PASS 后、合并前，用不同于开发/QA 的模型复核
// 「需求 01 + 合同 02 + QA 报告 05 + PR 改动」，逐条判 I-n 是否真被满足。
// 问题三类：product（代码没做到）/ qa_gap（QA 没真验到）/ contract_gap（合同没覆盖需求）。
// 裁决由程序判（不信模型自报 verdict）：每条 I-n 都满足且没有阻断/重要问题才 PASS。
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { loadPrompt } from './claude.mjs';
import { BLOCKING } from './review.mjs';

// 与 Brain 现役裁判（src/harness-judge.js）同一默认：裁判不能比被审的角色弱
export const DEFAULT_JUDGE_MODEL = 'gpt-5.6-sol';
const DEFAULT_API = 'https://toapis.com/v1';
const DEFAULT_TIMEOUT_MS = 10 * 60 * 1000;
const SEVERITIES = new Set(['阻断', '重要', '建议']);
// 问题类型 → 失败类别；顺序即优先级（产品问题先修，其次补验，最后回到需求层面）
const TYPE_CLASS = [['product', 'product_failure'], ['qa_gap', 'qa_insufficient'], ['contract_gap', 'contract_gap']];
const TYPES = new Set(TYPE_CLASS.map(([t]) => t));
const CAPS = { intent: 20000, spec: 40000, qaReport: 40000, diff: 60000 };
const I_RE = /^I-\d+$/;

export const judgeFileName = (round) => `06-judge-r${round}.md`;

const cap = (text, n) => {
  const s = String(text ?? '');
  return s.length > n ? `${s.slice(0, n)}\n…（已截断，原文 ${s.length} 字符）` : s;
};

/** → { system, user } */
export function buildJudgePrompt({ intent, spec, qaReport, qaReportFile = '05-qa-report.md', diff, intentIds, round = 1 }) {
  return {
    system: '你是严格的独立验收裁判，只输出合法 JSON。输出使用简体中文。',
    user: loadPrompt('judge', {
      ROUND: String(round),
      INTENT_IDS: intentIds.join(','),
      QA_REPORT_FILE: qaReportFile,
      INTENT: cap(intent, CAPS.intent),
      SPEC: cap(spec, CAPS.spec),
      QA_REPORT: cap(qaReport, CAPS.qaReport),
      DIFF: cap(diff, CAPS.diff) || '（无代码改动）',
    }),
  };
}

function checkIssue(raw, intentIds, errors) {
  const id = typeof raw?.id === 'string' && /^J-\d+$/.test(raw.id) ? raw.id : `J-?${errors.length}`;
  const covers = Array.isArray(raw?.covers) ? raw.covers.map(String) : [];
  if (!TYPES.has(raw?.type)) errors.push(`${id}:type_invalid`);
  if (!SEVERITIES.has(raw?.severity)) errors.push(`${id}:severity_invalid`);
  if (covers.length === 0 || covers.some((c) => !intentIds.includes(c))) errors.push(`${id}:covers_invalid`);
  if (!String(raw?.detail ?? '').trim()) errors.push(`${id}:detail_missing`);
  return { id, type: raw?.type, severity: raw?.severity, covers, detail: String(raw?.detail ?? ''), where: String(raw?.where ?? '') };
}

/** 解析模型输出 → { coverage, issues, summary, errors }。 */
export function parseJudge(content, { intentIds }) {
  const m = /\{[\s\S]*\}/.exec(String(content ?? ''));
  if (!m) return { coverage: [], issues: [], summary: '', errors: ['json_missing'] };
  let obj;
  try {
    obj = JSON.parse(m[0]);
  } catch {
    return { coverage: [], issues: [], summary: '', errors: ['json_invalid'] };
  }
  const errors = [];
  const coverage = [];
  for (const c of Array.isArray(obj.coverage) ? obj.coverage : []) {
    const intent = String(c?.intent ?? '');
    if (!I_RE.test(intent) || !intentIds.includes(intent)) {
      errors.push(`${intent || '?'}:coverage_unknown`);
      continue;
    }
    if (typeof c.satisfied !== 'boolean') errors.push(`${intent}:satisfied_invalid`);
    if (!String(c.evidence ?? '').trim()) errors.push(`${intent}:evidence_missing`);
    coverage.push({ intent, satisfied: c.satisfied === true, evidence: String(c.evidence ?? '') });
  }
  for (const id of intentIds) if (!coverage.some((c) => c.intent === id)) errors.push(`${id}:coverage_missing`);
  const issues = (Array.isArray(obj.issues) ? obj.issues : []).map((i) => checkIssue(i, intentIds, errors));
  // satisfied 非布尔已报错，不再重复追究原因
  const explicitNo = new Set((Array.isArray(obj.coverage) ? obj.coverage : []).filter((c) => c?.satisfied === false).map((c) => c.intent));
  for (const c of coverage.filter((x) => explicitNo.has(x.intent))) {
    if (!issues.some((i) => BLOCKING.has(i.severity) && i.covers.includes(c.intent))) errors.push(`${c.intent}:unsatisfied_without_issue`);
  }
  return { coverage, issues, summary: String(obj.summary ?? ''), errors };
}

/** 程序裁决：→ { verdict, failure_class, blocking, unsatisfied }。 */
export function decideJudge({ coverage, issues }) {
  const blocking = issues.filter((i) => BLOCKING.has(i.severity));
  const unsatisfied = coverage.filter((c) => !c.satisfied).map((c) => c.intent);
  if (blocking.length === 0 && unsatisfied.length === 0) return { verdict: 'PASS', failure_class: null, blocking: [], unsatisfied: [] };
  const failureClass = TYPE_CLASS.find(([t]) => blocking.some((i) => i.type === t))?.[1] ?? 'product_failure';
  return { verdict: 'FAIL', failure_class: failureClass, blocking, unsatisfied };
}

/** 06-judge-r<round>.md */
export function renderJudgeReport({ round, model, parsed, decision, qaReport }) {
  const lines = [
    `# 独立裁判（第 ${round} 轮）`,
    '',
    `- 裁决：**${decision.verdict}**${decision.failure_class ? `（${decision.failure_class}）` : ''}`,
    `- 模型：${model}`,
    `- 复核的 QA 报告：${qaReport}`,
    `- 总评：${parsed.summary || '（无）'}`,
    '',
    '## 需求覆盖',
  ];
  for (const c of parsed.coverage) lines.push('', `### ${c.intent}`, `- ${c.satisfied ? '满足' : '未满足'}`, `- 依据：${c.evidence}`);
  lines.push('', '## 问题');
  if (parsed.issues.length === 0) lines.push('', '（无）');
  for (const i of parsed.issues) {
    lines.push('', `### ${i.id}`, `- 类型：${i.type}`, `- 严重度：${i.severity}`, `- 对应：${i.covers.join('、')}`, `- 位置：${i.where || '（未给）'}`, `- 说明：${i.detail}`);
  }
  return `${lines.join('\n')}\n`;
}

function readCreds(file) {
  try {
    const out = {};
    for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
      const m = /^\s*(?:export\s+)?(TOAPIS_API_KEY|TOAPIS_BASE_URL)\s*=\s*(\S+)\s*$/.exec(line);
      if (m) out[m[1]] = m[2];
    }
    return out;
  } catch {
    return {};
  }
}

/** 裁判连接配置：环境变量优先，否则读 ToAPIs 凭据文件（运行时读，不进代码/plist）。 */
export function resolveJudgeConfig(env = process.env) {
  const creds = readCreds(env.CODING_WF_JUDGE_CREDS || path.join(env.HOME || os.homedir(), '.credentials/toapis.env'));
  return {
    api: env.CODING_WF_JUDGE_API || env.TOAPIS_BASE_URL || creds.TOAPIS_BASE_URL || DEFAULT_API,
    key: env.TOAPIS_API_KEY || creds.TOAPIS_API_KEY || null,
    model: env.CODING_WF_JUDGE_MODEL || env.TOAPIS_JUDGE_MODEL || DEFAULT_JUDGE_MODEL,
  };
}

/** OpenAI 兼容 chat/completions → { content, usage }；失败抛 Error(judge_*)。 */
export async function callJudge({ system, user }, { api, key, model, timeoutMs = DEFAULT_TIMEOUT_MS, fetchFn = fetch }) {
  if (!key) throw new Error('judge_key_missing');
  let res;
  try {
    res = await fetchFn(`${String(api).replace(/\/+$/, '')}/chat/completions`, {
      method: 'POST',
      headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
      body: JSON.stringify({ model, temperature: 0, messages: [{ role: 'system', content: system }, { role: 'user', content: user }] }),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (error) {
    throw new Error(`judge_network: ${error?.message || error}`);
  }
  if (!res.ok) throw new Error(`judge_http_${res.status}`);
  const data = await res.json();
  const content = data?.choices?.[0]?.message?.content ?? '';
  if (!String(content).trim()) throw new Error('judge_empty');
  return { content, usage: data?.usage ?? null };
}
