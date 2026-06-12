/**
 * harness-judge.js — 独立验收裁判（DeepSeek via ToAPIs）。
 *
 * 验证架构的灵魂是「运动员-摄像头-裁判」三权分立：
 *   ① 运动员（evaluator agent）：像人类 QA 一样在真实环境亲手执行验证，执行权不被代码取代。
 *   ② 摄像头（证据留痕）：agent 的会话产物（取证 stdout 转录 + .brain-result.json + 合同 E2E 输出）。
 *   ③ 裁判（本模块）：evaluator 回调后，Brain 把【证据 + 合同 + Golden Path】交给 DeepSeek
 *      独立判读，产出 verdict + Golden Path 覆盖对照表。运动员说 PASS 但裁判说 FAIL 或覆盖缺步
 *      → 终判 FAIL（裁判意见优先）。运动员不能给自己发奖牌。
 *
 * 容错：裁判调用失败（网络/超时/限流）→ fail-open 保留 agent verdict + warn（裁判瘫痪不瘫痪流水线）；
 *       JUDGE_STRICT=1 时改 fail-closed（裁判失败即终判 FAIL）。
 */

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

const DEFAULT_BASE_URL = 'https://toapis.com/v1';
const DEFAULT_MODEL = 'deepseek-v4-flash';
const DEFAULT_TIMEOUT_MS = 60_000;
const TRANSCRIPT_CAP = 16_000;
const TOAPIS_CREDS_FILE = path.join(os.homedir(), '.credentials', 'toapis.env');

// ── 配置解析：env 优先 → ~/.credentials/toapis.env 兜底（容器内此文件 read-only mount） ──
export async function resolveToapisConfig(deps = {}) {
  const readFileFn = deps.readFileFn || ((p) => readFile(p, 'utf8'));
  let apiKey = (process.env.TOAPIS_API_KEY || '').trim();
  let baseUrl = (process.env.TOAPIS_BASE_URL || '').trim();
  if (!apiKey || !baseUrl) {
    try {
      const content = await readFileFn(deps.credsPath || TOAPIS_CREDS_FILE);
      for (const line of String(content).split(/\r?\n/)) {
        const m = line.match(/^\s*(TOAPIS_API_KEY|TOAPIS_BASE_URL)\s*=\s*(\S+)\s*$/);
        if (m) {
          if (m[1] === 'TOAPIS_API_KEY' && !apiKey) apiKey = m[2];
          if (m[1] === 'TOAPIS_BASE_URL' && !baseUrl) baseUrl = m[2];
        }
      }
    } catch { /* 文件不存在/不可读 → 走 env 或默认 */ }
  }
  return {
    apiKey,
    baseUrl: baseUrl || DEFAULT_BASE_URL,
    model: process.env.TOAPIS_JUDGE_MODEL || DEFAULT_MODEL,
  };
}

export function normalizeJudgeVerdict(v) {
  const s = String(v || '').trim().toUpperCase();
  if (s === 'PASS') return 'PASS';
  if (s === 'FAIL') return 'FAIL';
  // 裁判输出非预期值时保守判 FAIL（运动员说 PASS，裁判含糊 → 不放行）
  return 'FAIL';
}

// ── 合同 / Golden Path 解析 ──────────────────────────────────────────────────
// 从 contract-draft.md 提取 ## E2E 验收 段（裁判据此知道「该验什么」）。
export function extractE2ESection(contractText) {
  if (!contractText) return '';
  const m = contractText.match(/##\s*E2E[^\n]*\n([\s\S]*?)(?=\n##\s+[^\n]|$)/);
  return m ? m[1].trim() : '';
}

// 从 sprint-prd.md 提取 ## Golden Path 段的有序步骤（裁判逐步对照覆盖）。
export function parseGoldenPathSteps(prdText) {
  if (!prdText) return [];
  const m = prdText.match(/##\s*Golden\s*Path[^\n]*\n([\s\S]*?)(?=\n##\s+|$)/i);
  const section = m ? m[1] : '';
  const steps = [];
  for (const line of section.split('\n')) {
    const sm = line.match(/^\s*(\d+)[.)、]\s+(.*\S)/);
    if (sm) steps.push(sm[2].trim());
  }
  return steps;
}

// ── 证据收集 ─────────────────────────────────────────────────────────────────
export async function collectEvidence(ctx, deps = {}) {
  const readFileFn = deps.readFileFn || ((p) => readFile(p, 'utf8'));
  const { worktreePath, sprintDir, transcript, brainResult } = ctx;
  let contractText = '';
  let prdText = '';
  if (worktreePath && sprintDir) {
    try {
      contractText = await readFileFn(path.join(worktreePath, sprintDir, 'contract-draft.md'));
    } catch { /* 合同缺失 → 空段，裁判仅凭 transcript 判 */ }
    try {
      prdText = await readFileFn(path.join(worktreePath, sprintDir, 'sprint-prd.md'));
    } catch { /* PRD 缺失 → 无 Golden Path 步骤 */ }
  }
  let resolvedBrainResult = brainResult || null;
  if (!resolvedBrainResult && worktreePath) {
    try {
      resolvedBrainResult = JSON.parse(await readFileFn(path.join(worktreePath, '.brain-result.json')));
    } catch { /* 读不到 → null */ }
  }
  const t = String(transcript || '');
  return {
    contractE2E: extractE2ESection(contractText),
    goldenPathSteps: parseGoldenPathSteps(prdText),
    transcript: t.length > TRANSCRIPT_CAP ? t.slice(-TRANSCRIPT_CAP) : t,
    brainResult: resolvedBrainResult,
  };
}

// ── 裁判 prompt ─────────────────────────────────────────────────────────────
export function buildJudgePrompt(input) {
  const { contractE2E, goldenPathSteps, agentVerdict, transcript, brainResult } = input;
  const gpLines = (goldenPathSteps && goldenPathSteps.length)
    ? goldenPathSteps.map((s, i) => `${i + 1}. ${s}`).join('\n')
    : '（PRD 未声明 Golden Path 步骤）';
  return [
    '你是独立验收裁判（裁判不执行任何命令，只读运动员留下的证据判读）。',
    '运动员（evaluator agent）已在真实环境亲手执行验证，并自报 verdict。你的职责是独立复核：',
    '运动员可能漏验、误判或夸大。运动员不能给自己发奖牌——以证据为准。',
    '',
    '## 合同 E2E 验收要求',
    contractE2E || '（合同未提供 E2E 段）',
    '',
    '## Golden Path（必须逐步覆盖）',
    gpLines,
    '',
    `## 运动员自报 verdict：${agentVerdict}`,
    '',
    '## 运动员执行证据（取证 stdout 转录 + .brain-result.json）',
    '### transcript',
    transcript || '（空）',
    '### .brain-result.json',
    brainResult ? JSON.stringify(brainResult).slice(0, 2000) : '（无）',
    '',
    '## 裁判规则',
    '- 对 Golden Path 每一步，按顺序给出一条 coverage 条目（step 字段回显该步），passed=true/false。',
    '- 证据中能确证该步真实通过 → passed=true，evidence 引用证据原文片段；',
    '- 证据缺失/含糊/与该步无关/显示失败 → passed=false。',
    '- 任一 Golden Path 步骤 passed=false，或证据不足以支撑运动员的 PASS → 整体 verdict=FAIL。',
    '- 只有所有步骤都有确凿证据通过时才 verdict=PASS。',
    '',
    '只输出 JSON（不要任何解释文字、不要 markdown 代码围栏）：',
    '{"verdict":"PASS"|"FAIL","coverage":[{"step":"<步骤>","passed":true,"evidence":"<证据片段>"}],"feedback":"<若FAIL，给运动员的结构化修复反馈>"}',
  ].join('\n');
}

// ── DeepSeek 调用（ToAPIs，OpenAI chat/completions 兼容） ────────────────────
export async function callDeepSeekJudge(input, opts = {}) {
  const cfg = opts.config || await resolveToapisConfig(opts);
  if (!cfg.apiKey) throw new Error('toapis_key_unavailable');
  const fetchFn = opts.fetchFn || fetch;
  const timeoutMs = opts.timeoutMs || DEFAULT_TIMEOUT_MS;
  const prompt = buildJudgePrompt(input);

  const resp = await fetchFn(`${cfg.baseUrl.replace(/\/+$/, '')}/chat/completions`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${cfg.apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: cfg.model,
      messages: [
        { role: 'system', content: '你是严格的独立验收裁判，只输出合法 JSON。' },
        { role: 'user', content: prompt },
      ],
      temperature: 0,
    }),
    signal: AbortSignal.timeout(timeoutMs),
  });

  if (!resp.ok) {
    const t = await resp.text().catch(() => 'unknown');
    throw new Error(`toapis HTTP ${resp.status}: ${String(t).slice(0, 200)}`);
  }

  const data = await resp.json();
  // deepseek-v4-flash 是 reasoning 模型：读 choices[0].message.content，忽略 reasoning_content。
  const content = data?.choices?.[0]?.message?.content || '';
  if (!content.trim()) throw new Error('toapis empty content');

  const jsonMatch = content.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error('judge returned no JSON');
  const parsed = JSON.parse(jsonMatch[0]);
  return {
    verdict: normalizeJudgeVerdict(parsed.verdict),
    coverage: Array.isArray(parsed.coverage) ? parsed.coverage : [],
    feedback: parsed.feedback || null,
  };
}

// ── coverage 覆盖校验（代码判，不信裁判文字） ────────────────────────────────
export function validateCoverage(coverage, goldenPathSteps) {
  const cov = Array.isArray(coverage) ? coverage : [];
  const steps = Array.isArray(goldenPathSteps) ? goldenPathSteps : [];
  const missing = [];
  const failed = [];
  // PRD 声明的每个 Golden Path 步骤必须有 coverage 条目且 passed=true。
  for (let i = 0; i < steps.length; i++) {
    const entry = cov[i];
    if (!entry) { missing.push({ index: i + 1, step: steps[i] }); continue; }
    if (entry.passed !== true) {
      failed.push({ index: i + 1, step: steps[i], evidence: entry.evidence || entry.record_segment || null });
    }
  }
  // 即使无 Golden Path，裁判自报覆盖里出现 passed=false 也判失败。
  for (let i = steps.length; i < cov.length; i++) {
    if (cov[i] && cov[i].passed === false) {
      failed.push({ index: i + 1, step: cov[i].step || `coverage[${i}]`, evidence: cov[i].evidence || null });
    }
  }
  return { ok: missing.length === 0 && failed.length === 0, missing, failed };
}

function formatJudgeFeedback({ judgeResult, cov, agentVerdict }) {
  const parts = [`独立裁判终判 FAIL（运动员自报 ${agentVerdict}，裁判=${judgeResult.verdict}）。`];
  if (judgeResult.feedback) parts.push(`裁判意见：${judgeResult.feedback}`);
  if (cov.missing.length) {
    parts.push('Golden Path 缺步（无 coverage 覆盖）：' + cov.missing.map((m) => `#${m.index} ${m.step}`).join('；'));
  }
  if (cov.failed.length) {
    parts.push('Golden Path 未通过步骤：' + cov.failed.map((f) => `#${f.index} ${f.step}${f.evidence ? `（证据：${f.evidence}）` : ''}`).join('；'));
  }
  return parts.join('\n').slice(0, 1500);
}

// ── 裁判产物落盘（judge-<instance>.json，按运行实例命名取证） ─────────────────
async function persistJudgeArtifact(ctx, deps = {}) {
  const writeFileFn = deps.writeFileFn || (async (p, c) => {
    await mkdir(path.dirname(p), { recursive: true });
    await writeFile(p, c, 'utf8');
  });
  const { worktreePath, instanceLabel, payload } = ctx;
  if (!worktreePath) return null;
  const safe = String(instanceLabel || 'unknown').replace(/[^a-zA-Z0-9._-]/g, '');
  const filePath = path.join(worktreePath, '.cecelia', `judge-${safe}.json`);
  try {
    await writeFileFn(filePath, JSON.stringify(payload, null, 2));
    return filePath;
  } catch (err) {
    console.warn(`[judge] 裁判产物落盘失败（不影响裁决）：${err.message}`);
    return null;
  }
}

/**
 * runJudgeGate — 独立裁判门。仅对 agent verdict===PASS 生效（运动员说 PASS 才需复核）。
 * 非 PASS（agent 已 FAIL）直接透传走现有 fix loop，不浪费裁判调用。
 *
 * @param {object} ctx  {agentVerdict, agentFeedback, transcript, brainResult, worktreePath, sprintDir, instanceLabel}
 * @param {object} opts {judgeFn, collectEvidence, strict, config, fetchFn, ...}
 * @returns {Promise<{verdict:'PASS'|'FAIL', feedback:string|null, judged:boolean, judgeError?:string}>}
 */
export async function runJudgeGate(ctx, opts = {}) {
  const { agentVerdict, agentFeedback } = ctx;
  if (agentVerdict !== 'PASS') {
    return { verdict: agentVerdict, feedback: agentFeedback || null, judged: false };
  }

  const strict = opts.strict ?? (process.env.JUDGE_STRICT === '1');
  const judgeFn = opts.judgeFn || callDeepSeekJudge;
  const collectFn = opts.collectEvidence || collectEvidence;

  const ev = await collectFn({
    worktreePath: ctx.worktreePath,
    sprintDir: ctx.sprintDir,
    transcript: ctx.transcript,
    brainResult: ctx.brainResult,
  }, opts);

  // 证据门：无合同 E2E 段且无 Golden Path 步骤 → 裁判没有「该验什么」的独立基准，无法做覆盖对照
  // → fail-open 保留 agent verdict（不浪费裁判调用，也不在缺证据时凭空否决运动员）。
  // 真实 sprint worktree 必有 contract-draft.md + sprint-prd.md，生产路径永远过此门。
  if (!ctx.worktreePath || (!ev.contractE2E && (!ev.goldenPathSteps || ev.goldenPathSteps.length === 0))) {
    console.log('[judge] 无合同/Golden Path 证据可独立判读 → 跳过裁判，保留 agent verdict');
    return { verdict: agentVerdict, feedback: agentFeedback || null, judged: false };
  }

  let judgeResult;
  try {
    judgeResult = await judgeFn({
      contractE2E: ev.contractE2E,
      goldenPathSteps: ev.goldenPathSteps,
      agentVerdict,
      transcript: ev.transcript,
      brainResult: ev.brainResult,
    }, opts);
  } catch (err) {
    await persistJudgeArtifact({
      worktreePath: ctx.worktreePath,
      instanceLabel: ctx.instanceLabel,
      payload: { agentVerdict, error: err.message, mode: strict ? 'fail-closed' : 'fail-open' },
    }, opts);
    if (strict) {
      console.warn(`[judge] DeepSeek 调用失败（JUDGE_STRICT=1 fail-closed → FAIL）：${err.message}`);
      return { verdict: 'FAIL', feedback: `独立裁判调用失败（JUDGE_STRICT fail-closed）：${err.message}`, judged: false, judgeError: err.message };
    }
    console.warn(`[judge] DeepSeek 调用失败（fail-open，保留 agent verdict=${agentVerdict}）：${err.message}`);
    return { verdict: agentVerdict, feedback: agentFeedback || null, judged: false, judgeError: err.message };
  }

  const cov = validateCoverage(judgeResult.coverage, ev.goldenPathSteps);
  const finalFail = judgeResult.verdict === 'FAIL' || !cov.ok;

  await persistJudgeArtifact({
    worktreePath: ctx.worktreePath,
    instanceLabel: ctx.instanceLabel,
    payload: {
      agentVerdict,
      judge: judgeResult,
      coverageCheck: cov,
      goldenPathSteps: ev.goldenPathSteps,
      finalVerdict: finalFail ? 'FAIL' : 'PASS',
    },
  }, opts);

  if (finalFail) {
    const fb = formatJudgeFeedback({ judgeResult, cov, agentVerdict });
    console.warn(`[judge] 裁判终判 FAIL（agent=PASS, judge=${judgeResult.verdict}, coverage_ok=${cov.ok}）→ feedback 进 fix loop`);
    return { verdict: 'FAIL', feedback: fb, judged: true };
  }
  console.log('[judge] 双 PASS（运动员 + 独立裁判）→ 照常 merge');
  return { verdict: 'PASS', feedback: null, judged: true };
}
