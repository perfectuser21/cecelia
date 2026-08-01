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

import { readFile, writeFile, mkdir, readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

const DEFAULT_BASE_URL = 'https://toapis.com/v1';
const DEFAULT_MODEL = 'deepseek-v4-flash';
const DEFAULT_TIMEOUT_MS = 60_000;
const TRANSCRIPT_CAP = 16_000;
// agent 完整 stdout 转录上限（#3345 forensics 文件，比 callback 的 4KB tail 全；
// 保留尾部 = 脚本执行的命令输出段通常在后半程）。
const AGENT_STDOUT_CAP = 20_000;
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
        const m = line.match(/^\s*(?:export\s+)?(TOAPIS_API_KEY|TOAPIS_BASE_URL)\s*=\s*(\S+)\s*$/);
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

export function validateIndependentJudgeStageFacts(stageFacts) {
  if (stageFacts?.current_stage !== 'independent_judge') {
    return { pass: true, reasons: [] };
  }
  const reasons = [];
  if (stageFacts.pr_state !== 'OPEN') {
    reasons.push(`pr_state 必须为 "OPEN"，实际为 ${JSON.stringify(stageFacts.pr_state)}`);
  }
  if (!String(stageFacts.head_sha || '').trim()) {
    reasons.push('head_sha 缺失');
  }
  if (stageFacts.pr_merged !== false) {
    reasons.push(`pr_merged 必须为 false，实际为 ${JSON.stringify(stageFacts.pr_merged)}`);
  }
  if (stageFacts.merge_gate_approved !== false) {
    reasons.push(
      `merge_gate_approved 必须为 false，实际为 ${JSON.stringify(stageFacts.merge_gate_approved)}`
    );
  }
  return { pass: reasons.length === 0, reasons };
}

// ── 戏院错配闸（theater_mismatch）关键词配置 ─────────────────────────────────
// FR-02: GP 或 contract BEHAVIOR 含真机关键词但 target_environment 属于「轻量」环境 → FAIL
// 轻量环境：local_api / mac_web（不具备真机执行能力）
// 关键词大小写不敏感；THEATER_KEYWORDS_EXTRA env 支持逗号分隔扩展词
export const THEATER_REAL_MACHINE_KEYWORDS = [
  '微信',
  'UIA',
  'xian-rog',
  'windows_wechat',
  '真机',
  'RPA',
  'adb',
  'android',
];

const THEATER_LIGHT_ENVS = new Set(['local_api', 'mac_web']);

// ── 刀B 机械预检（root 杠杆，决策 dc18d43d「无闸不成文」）────────────────────
// 同步校验 brainResult 结构，任一项不满足即返回 FAIL 对象（null = 全过）。
// 在 judge 路由最前执行，不进 AI 裁判。

// L3 真机指纹关键词（满足其一即视为真机证据）：
//   - 设备路径：/data/、/sdcard/、com.（Android 包名路径）
//   - UIA 标识：UiSelector、UiAutomator、AccessibilityNodeInfo
//   - adb 命令：adb shell
//   - 截图：.png 或 .jpg 绝对路径（以 / 开头后跟非空路径含扩展名）
const L3_DEVICE_KEYWORDS = [
  '/data/',
  '/sdcard/',
  'UiSelector',
  'UiAutomator',
  'AccessibilityNodeInfo',
  'adb shell',
];
const L3_SCREENSHOT_RE = /\/[^\s]+\.(png|jpg)/i;

/**
 * hasL3DeviceEvidence(text) — 判断 log_tail 或 screenshot 字段是否含真机指纹关键词。
 * true = 含真机证据（PASS）；false = 无真机证据（L3 下应 FAIL）。
 */
function hasL3DeviceEvidence(logTail, screenshotPath) {
  const combined = String(logTail || '') + ' ' + String(screenshotPath || '');
  for (const kw of L3_DEVICE_KEYWORDS) {
    if (combined.includes(kw)) return true;
  }
  if (L3_SCREENSHOT_RE.test(combined)) return true;
  return false;
}

export function runMechanicalPreflightChecks(brainResult) {
  if (!brainResult || !Array.isArray(brainResult.behavior_tests) || brainResult.behavior_tests.length === 0) {
    return { verdict: 'FAIL', feedback: 'behavior_tests 为空：evaluator 未提供行为测试结果', mechFail: 'no_behavior_tests' };
  }
  if (brainResult.exit_code === undefined || brainResult.exit_code === null) {
    return { verdict: 'FAIL', feedback: 'verdict 缺 exit_code：退出码证据缺失', mechFail: 'missing_exit_code' };
  }
  if (!brainResult.log_tail || String(brainResult.log_tail).trim() === '') {
    return { verdict: 'FAIL', feedback: 'verdict 缺 log_tail：执行日志证据缺失', mechFail: 'missing_log_tail' };
  }

  // ── L3 真机指纹执法（verification_level 分级校验） ──────────────────────────
  // 顶层 verification_level 为默认继承值；条目级优先（条目显式声明时覆盖顶层）。
  // 缺省（无任何 verification_level）视为 L2，不做真机指纹校验（存量兼容）。
  const topLevel = brainResult.verification_level || null;

  for (let i = 0; i < brainResult.behavior_tests.length; i++) {
    const bt = brainResult.behavior_tests[i] || {};
    // 条目级优先；无条目级则继承顶层；最终缺省 L2（不执法）
    const effectiveLevel = bt.verification_level || topLevel || 'L2';

    if (effectiveLevel === 'L3') {
      // L3 要求 log_tail 或 screenshot 中含真机指纹关键词
      if (!hasL3DeviceEvidence(bt.log_tail, bt.screenshot)) {
        return {
          verdict: 'FAIL',
          feedback: `behavior_tests[${i}] 声明 L3 验证等级，但 log_tail 不含真机指纹关键词（adb shell / UiSelector / UiAutomator / AccessibilityNodeInfo / /data/ / /sdcard/ / 截图绝对路径）。纯 curl 或 vitest 输出不满足 L3 真机证据要求。`,
          mechFail: 'level_evidence_mismatch',
        };
      }
    }
  }

  return null;
}

// 异步对账 judgments_written 声明数 vs decisions 表实际写入数。
// 声明 != 实查 → FAIL；未声明/DB 异常 → null（保守跳过）。
export async function checkJudgmentsWritten(brainResult, taskId, pool) {
  const declared = brainResult?.judgments_written;
  if (declared === undefined || declared === null) return null;
  try {
    const { rows } = await pool.query(
      `SELECT COUNT(*)::int AS cnt FROM decisions WHERE source_ref = $1 AND category = 'judgment'`,
      [String(taskId)]
    );
    const actual = Number(rows[0]?.cnt ?? 0);
    if (Number(declared) !== actual) {
      return {
        verdict: 'FAIL',
        feedback: `judgments_written 声明 ${declared} 条，decisions 表实查 ${actual} 条`,
        mechFail: 'judgments_written_mismatch',
      };
    }
    return null;
  } catch (err) {
    console.warn(`[judge] checkJudgmentsWritten DB 查询失败（保守跳过）: ${err.message}`);
    return null;
  }
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

// ── agent 完整 stdout 转录（#3345 forensics 文件） ────────────────────────────
// evaluator 容器把 claude stdout tee 到 ${promptDir}/<taskId>.<runInstance>.stdout（#3345 命名协议）。
// callback body 只回传该文件 last 4KB（entrypoint.sh tail -c 4000），裁判据此巧妇难为无米之炊。
// 这里据 taskId 在 promptDir 里找最新 .stdout（evaluator 回调刚落盘 → 最新 mtime 即本次取证），
// 读全文交给裁判。runInstance 由 docker-executor 随机生成且不回传，故按 taskId 前缀 + 最新 mtime 定位。
export async function resolveStdoutFile({ promptDir, taskId }, deps = {}) {
  if (!promptDir || !taskId) return null;
  const listDirFn = deps.listDirFn || ((d) => readdir(d));
  const statFn = deps.statFn || ((p) => stat(p));
  let names;
  try {
    names = await listDirFn(promptDir);
  } catch {
    return null; // 目录不存在/不可读 → 退回 callback transcript
  }
  const prefix = `${taskId}.`;
  const cands = (names || []).filter((n) => n.startsWith(prefix) && n.endsWith('.stdout'));
  if (!cands.length) return null;
  let best = null;
  let bestM = -1;
  for (const n of cands) {
    const full = path.join(promptDir, n);
    try {
      const s = await statFn(full);
      const m = s.mtimeMs || 0;
      if (m > bestM) { bestM = m; best = full; }
    } catch { /* 单文件 stat 失败 → 跳过 */ }
  }
  return best;
}

// 从 forensics stdout 文件内容提取可读转录：
//   - --output-format json（单对象）→ 取 .result 叙述（去掉 usage/token 噪音）；
//   - --output-format stream-json（NDJSON，skill 修好后含 tool_result 命令输出）/ 纯文本 → 原样返回。
export function extractAgentTranscript(raw) {
  const s = String(raw || '').trim();
  if (!s) return '';
  try {
    const obj = JSON.parse(s);
    if (obj && typeof obj.result === 'string') return obj.result;
  } catch { /* 非单对象 JSON（NDJSON/纯文本）→ 原样 */ }
  return s;
}

// ── 证据收集 ─────────────────────────────────────────────────────────────────
export async function collectEvidence(ctx, deps = {}) {
  const readFileFn = deps.readFileFn || ((p) => readFile(p, 'utf8'));
  const {
    worktreePath,
    sprintDir,
    transcript,
    brainResult,
    promptDir,
    taskId,
    contractText: embeddedContractText,
    prdText: embeddedPrdText,
  } = ctx;
  let contractText = typeof embeddedContractText === 'string' ? embeddedContractText : '';
  let prdText = typeof embeddedPrdText === 'string' ? embeddedPrdText : '';
  if (worktreePath && sprintDir) {
    if (!contractText) {
      try {
        contractText = await readFileFn(path.join(worktreePath, sprintDir, 'contract-draft.md'));
      } catch { /* 合同缺失 → 空段，裁判仅凭 transcript 判 */ }
    }
    if (!prdText) {
      try {
        prdText = await readFileFn(path.join(worktreePath, sprintDir, 'sprint-prd.md'));
      } catch { /* PRD 缺失 → 无 Golden Path 步骤 */ }
    }
  }
  let resolvedBrainResult = brainResult || null;
  if (!resolvedBrainResult && worktreePath) {
    try {
      resolvedBrainResult = JSON.parse(await readFileFn(path.join(worktreePath, '.brain-result.json')));
    } catch { /* 读不到 → null */ }
  }
  // agent 完整 stdout 转录（比 callback 4KB tail 全；找不到 → 退回 transcript，fail-open）。
  let agentStdout = '';
  try {
    const stdoutFile = await resolveStdoutFile({ promptDir, taskId }, deps);
    if (stdoutFile) {
      agentStdout = extractAgentTranscript(await readFileFn(stdoutFile));
    }
  } catch { /* 取证文件读失败 → 退回 callback transcript */ }
  const cappedStdout = agentStdout.length > AGENT_STDOUT_CAP
    ? agentStdout.slice(-AGENT_STDOUT_CAP)
    : agentStdout;

  const t = String(transcript || '');
  return {
    contractE2E: extractE2ESection(contractText),
    goldenPathSteps: parseGoldenPathSteps(prdText),
    transcript: t.length > TRANSCRIPT_CAP ? t.slice(-TRANSCRIPT_CAP) : t,
    agentStdout: cappedStdout,
    brainResult: resolvedBrainResult,
  };
}

// ── brainResult 结构化压缩（修复整体头部截断误判问题） ──────────────────────
/**
 * compressBrainResult(brainResult) — 结构化压缩 .brain-result.json 证据。
 *
 * 修复 task ea20ba86：原 JSON.stringify(brainResult).slice(0,2000) 整体头部截断，
 * 导致 behavior_tests 后排条目（index ≥ 1）对裁判完全不可见，引发误判 FAIL。
 *
 * 压缩规则：
 *   - 顶层：verdict / exit_code / log_tail（截 500 字符）
 *   - behavior_tests：逐条展开，每条 command（截 200）+ exit_code + log_tail（截 600）
 *   - 条目上限：前 8 条，超出追加「另有 N 条已省略」
 *   - 总预算：6000 字符
 */
export function compressBrainResult(brainResult) {
  if (!brainResult) return '（无）';

  const MAX_TOP_LOG = 500;
  const MAX_CMD = 200;
  const MAX_TEST_LOG = 600;
  const MAX_ITEMS = 8;
  const TRUNCATED_MARK = '…（已截断）';

  const parts = [];

  // 顶层字段
  if (brainResult.verdict !== undefined) parts.push(`verdict: ${brainResult.verdict}`);
  if (brainResult.exit_code !== undefined) parts.push(`exit_code: ${brainResult.exit_code}`);
  if (brainResult.log_tail) {
    const lt = String(brainResult.log_tail);
    parts.push(`log_tail: ${lt.length > MAX_TOP_LOG ? lt.slice(0, MAX_TOP_LOG) + TRUNCATED_MARK : lt}`);
  }

  // behavior_tests 逐条展开
  const tests = Array.isArray(brainResult.behavior_tests) ? brainResult.behavior_tests : [];
  const shown = tests.slice(0, MAX_ITEMS);
  const omitted = tests.length - shown.length;

  shown.forEach((t, i) => {
    const cmd = String(t.command || '');
    const truncCmd = cmd.length > MAX_CMD ? cmd.slice(0, MAX_CMD) + TRUNCATED_MARK : cmd;
    const lt = String(t.log_tail || '');
    const truncLt = lt.length > MAX_TEST_LOG ? lt.slice(0, MAX_TEST_LOG) + TRUNCATED_MARK : lt;
    parts.push(`[test-${i}] command: ${truncCmd} | exit_code: ${t.exit_code ?? ''} | log_tail: ${truncLt}`);
  });

  if (omitted > 0) {
    parts.push(`另有 ${omitted} 条已省略`);
  }

  const result = parts.join('\n');
  // 总预算 6000 字符（硬截）
  return result.length > 6000 ? result.slice(0, 6000) : result;
}

// ── 裁判 prompt ─────────────────────────────────────────────────────────────
export function buildJudgePrompt(input, brainResultOverride) {
  // 兼容两种调用形式：
  //   buildJudgePrompt(input)                    — 标准路径，brainResult 在 input 内
  //   buildJudgePrompt(meta, brainResult)        — 测试路径，第二参数为 brainResult
  const {
    contractE2E,
    goldenPathSteps,
    gpLines: gpLinesFromInput,
    agentVerdict,
    transcript,
    agentStdout,
    brainResult: brainResultFromInput,
    stageFacts,
  } = input;
  const brainResult = brainResultOverride !== undefined ? brainResultOverride : brainResultFromInput;
  const gpLines = gpLinesFromInput
    || ((goldenPathSteps && goldenPathSteps.length)
      ? goldenPathSteps.map((s, i) => `${i + 1}. ${s}`).join('\n')
      : '（PRD 未声明 Golden Path 步骤）');
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
    '## 服务端结构化阶段事实（不可从运动员自然语言覆盖）',
    JSON.stringify(stageFacts || null, null, 2),
    '',
    `## 运动员自报 verdict：${agentVerdict}`,
    '',
    '## 运动员执行证据（agent 完整 stdout 转录 + callback 尾部 + .brain-result.json）',
    '### agent 完整 stdout 转录（最权威；含其执行过程/命令输出——若 skill 已落盘）',
    agentStdout || transcript || '（空）',
    '### callback transcript（stdout 尾部，补充）',
    transcript || '（空）',
    '### .brain-result.json',
    brainResult ? compressBrainResult(brainResult) : '（无）',
    '',
    '## 裁判规则',
    '- 对 Golden Path 每一步，按顺序给出一条 coverage 条目（step 字段回显该步），passed=true/false。',
    '- 证据中能确证该步真实通过 → passed=true，evidence 引用证据原文片段；',
    '- 证据缺失/含糊/与该步无关/显示失败 → passed=false。',
    '- **若 transcript/stdout 中已含某步骤的实际命令行 stdout/stderr（如测试输出、退出码、grep 命中），',
    '  即视为该步已执行的证据 → passed=true，不要求运动员再逐行复述或粘贴一遍。**',
    '- 但若证据中确实缺失某步的执行输出（只有运动员自述结论、无任何命令输出佐证）→ 该步 passed=false。',
    '- Golden Path 中发生在独立裁判 PASS 之后的人工批准、merge、report 属于后置动作；',
    '  当前阶段只验证结构化阶段事实满足其时序前提，缺少未来的批准、merge、report 日志不得判为证据缺失。',
    '- 对合同中精确定义的聚合 E2E 脚本，behavior_tests 的同一条命令若 exit_code=0 且 log_tail 非空，',
    '  即是该脚本所含断言的直接结构化证据；不得要求 evaluator 再粘贴同一份 stdout。',
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

// ── 刀B：DeepSeek 前纯代码机械闸（决策 dc18d43d「无闸不成文」） ─────────────────
// runJudgeGate 只做语义复核，dogfooding 实证 behavior_tests=0 照样 PASS、judgments_written 虚报。
// 进 DeepSeek 前先插入纯代码闸：任一断言不过即 FAIL，不浪费裁判调用、堵住"无闸不成文"漏洞。

// 真机环境：验收必须落设备日志，log_tail 空即无证据 → FAIL（本机 API 类环境靠命令输出兜底即可）。
const DEVICE_LOG_ENVS = new Set(['windows_wechat']);
const MECH_SCAN_MAX_DEPTH = 4;
const TEST_FILE_RE = /\.test\.(ts|js|mjs|sh)$/;
const CONCRETE_BEHAVIOR_LINE_RE = /^\s*(?:[-*+]|\d+[.)])\s+(?:\[[ xX]\]\s+)?\[BEHAVIOR\]\s+\S/i;
const CONCRETE_BEHAVIOR_HEADING_RE = /^\s*#{2,6}\s+\[BEHAVIOR\]\s*\[BEHAVIOR-\d+\]\s+\S/i;

function countConcreteBehaviorLines(text) {
  return String(text || '').split(/\r?\n/).filter((line) => (
    CONCRETE_BEHAVIOR_LINE_RE.test(line)
    || CONCRETE_BEHAVIOR_HEADING_RE.test(line)
  )).length;
}

// 递归列 sprint 目录下测试文件（深度≤MECH_SCAN_MAX_DEPTH，跳 node_modules/.git）。
async function defaultListTestFiles(rootDir) {
  const found = [];
  async function walk(dir, depth) {
    if (depth > MECH_SCAN_MAX_DEPTH) return;
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch { return; /* 目录不存在/不可读 → 视作无测试 */ }
    for (const ent of entries) {
      const name = ent.name;
      if (name === 'node_modules' || name === '.git') continue;
      const full = path.join(dir, name);
      if (ent.isDirectory()) {
        await walk(full, depth + 1);
      } else if (TEST_FILE_RE.test(name)) {
        found.push(full);
      }
    }
  }
  await walk(rootDir, 0);
  return found;
}

/**
 * runMechanicalGate — DeepSeek 前的纯代码机械闸（三断言，全过才 pass）。
 *   ① behavior_tests 声明（E1 机械化）：brainResult.behavior_tests 必须是非空数组
 *      （evaluator 1.23.0 E1 硬要求产出 behavior_tests:[{command,exit_code,log_tail}]）；
 *      每条目 exit_code 有值（0 合法）；log_tail 空时按环境校准（真机必须设备日志；
 *      本机 API 类靠 ctx.agentStdout/transcript 命令输出兜底）。这是治「behavior_tests=0
 *      照样 PASS」的正主。注意 exit_code/log_tail 是条目级字段，.brain-result.json 顶层
 *      schema 只有 {verdict, task_id, failed_step, log_excerpt}，顶层无这两个字段。
 *   ② sprint 测试文件存在性：sprint 目录递归有测试文件，或 contract-dod.md 含 [BEHAVIOR]，
 *      两者全 0 → FAIL（理由关键词 contract_tests，与①的 behavior_tests 区分）。
 *   ③ judgments_written 对账：声明数不得 > decisions 表回读数（无声明则跳过；非数字声明 → FAIL）。
 *
 * @param {object} ctx {taskId, worktreePath, sprintDir, brainResult, agentStdout, transcript}
 * @param {object} deps {readFileFn?, listTestFilesFn?, dbPool?}
 * @returns {Promise<{pass:boolean, reasons:string[], env:string}>}
 */
export async function runMechanicalGate(ctx, deps = {}) {
  const readFileFn = deps.readFileFn || ((p) => readFile(p, 'utf8'));
  const listTestFilesFn = deps.listTestFilesFn || defaultListTestFiles;
  const dbPool = deps.dbPool || null;
  const reasons = [];
  const brainResult = ctx.brainResult || null;

  // 环境判定（log_tail 兜底口径 + 报告用）：查不到/异常 → 缺省 local_api（最宽口径，不误杀）。
  let env = 'local_api';
  if (dbPool && dbPool.query && ctx.taskId) {
    try {
      const { rows } = await dbPool.query(
        `SELECT payload->>'target_environment' AS target_environment FROM tasks WHERE id = $1`,
        [String(ctx.taskId)]
      );
      if (rows && rows[0] && rows[0].target_environment) env = rows[0].target_environment;
    } catch (err) {
      console.warn(`[judge] 机械闸查 target_environment 失败 → 缺省 local_api：${err.message}`);
    }
  }

  // ① behavior_tests 声明（E1 机械化）：evaluator 1.23.0 产出 behavior_tests:[{command,exit_code,log_tail}]。
  //    exit_code/log_tail 是条目级字段（.brain-result.json 顶层 schema 无此二字段）。
  const behaviorTests = brainResult && Array.isArray(brainResult.behavior_tests) ? brainResult.behavior_tests : null;
  if (!behaviorTests || behaviorTests.length === 0) {
    reasons.push('behavior_tests 声明为空（.brain-result.json 无 behavior_tests 数组或空数组——「无测试照样 PASS」漏洞的正主）');
  } else {
    // 命令输出兜底（log_tail 空时用）：agentStdout 或 callback transcript 非空即可。
    const hasCmdOut = String(ctx.agentStdout || '').trim() || String(ctx.transcript || '').trim();
    for (let i = 0; i < behaviorTests.length; i++) {
      const bt = behaviorTests[i] || {};
      if (bt.exit_code === undefined || bt.exit_code === null) {
        reasons.push(`behavior_tests[${i}] 缺 exit_code（无退出码证据；0 合法）`);
      }
      const lt = bt.log_tail != null ? String(bt.log_tail).trim() : '';
      if (!lt) {
        if (DEVICE_LOG_ENVS.has(env)) {
          reasons.push(`behavior_tests[${i}] log_tail 为空且环境=${env}（真机必须设备日志证据）`);
        } else if (!hasCmdOut) {
          reasons.push(`behavior_tests[${i}] log_tail 为空且无 agentStdout/transcript 命令输出兜底（无执行证据）`);
        }
      }
    }
  }

  // ② sprint 测试文件存在性：文件扫描 + kernel 合同 [BEHAVIOR] fallback，两者全 0 → FAIL。
  // Kernel 的 proposer 真相文件是 contract-draft.md；旧 controller 仍可能产出 contract-dod.md，
  // 所以两者都读，避免有真实合同却被误判 contract_tests=0。
  const sprintRoot = path.join(ctx.worktreePath || '', ctx.sprintDir || '');
  let testCount = 0;
  try {
    const files = await listTestFilesFn(sprintRoot);
    testCount = Array.isArray(files) ? files.length : 0;
  } catch { testCount = 0; }
  if (testCount === 0) {
    let behaviorCount = countConcreteBehaviorLines(ctx.contractText);
    if (behaviorCount === 0) {
      for (const contractName of ['contract-dod.md', 'contract-draft.md']) {
        try {
          const contract = await readFileFn(path.join(ctx.worktreePath || '', ctx.sprintDir || '', contractName));
          behaviorCount += countConcreteBehaviorLines(contract);
        } catch { /* missing contract variant */ }
      }
    }
    if (behaviorCount === 0) {
      reasons.push('contract_tests 为 0（sprint 目录无 *.test.{ts,js,mjs,sh}，contract-dod.md/contract-draft.md 亦无 [BEHAVIOR]）');
    }
  }

  // ③ judgments_written 对账
  const declared = brainResult ? brainResult.judgments_written : undefined;
  if (declared !== undefined && declared !== null) {
    // 非数字声明（如 "若干"）不得静默放行：NaN 视为 FAIL（无法对账即视作虚报）。
    if (Number.isNaN(Number(declared))) {
      reasons.push(`judgments_written 声明非数字（${JSON.stringify(declared)}），无法对账`);
    } else if (dbPool && dbPool.query) {
      try {
        const { rows } = await dbPool.query(
          `SELECT COUNT(*)::int AS count FROM decisions WHERE category = 'judgment' AND source_ref = $1`,
          [String(ctx.taskId)]
        );
        const count = rows && rows[0] ? Number(rows[0].count) : 0;
        if (Number(declared) > count) {
          reasons.push(`judgments_written 虚报：声明 ${declared} > decisions 回读 ${count}`);
        }
      } catch (err) {
        console.warn(`[judge] 机械闸对账 judgments 查询异常 → 跳过该项（non-fatal）：${err.message}`);
      }
    }
    // 无 dbPool → 无从对账，跳过（不误杀）
  }

  // ④ 戏院错配闸（theater_mismatch）FR-02
  // 仅在轻量环境（local_api / mac_web）下触发：若 sprint-prd GP 段或 contract BEHAVIOR 文本含真机关键词 → FAIL
  if (THEATER_LIGHT_ENVS.has(env)) {
    let prdTextForTheater = '';
    let contractTextForTheater = '';
    try {
      prdTextForTheater = await readFileFn(path.join(ctx.worktreePath || '', ctx.sprintDir || '', 'sprint-prd.md'));
    } catch { /* sprint-prd 缺失 → 保守跳过，不误杀 */ }
    try {
      contractTextForTheater = await readFileFn(path.join(ctx.worktreePath || '', ctx.sprintDir || '', 'contract-draft.md'));
    } catch { /* contract 缺失 → 保守跳过 */ }

    // 提取 GP 段
    const gpMatch = prdTextForTheater.match(/##\s*Golden\s*Path[^\n]*\n([\s\S]*?)(?=\n##\s+|$)/i);
    const gpSection = gpMatch ? gpMatch[1] : prdTextForTheater;

    // 提取 BEHAVIOR 行（contract 命令文本）
    const behaviorLines = contractTextForTheater.split('\n').filter((l) => l.includes('[BEHAVIOR]') || l.startsWith('Test:'));
    const behaviorText = behaviorLines.join(' ');

    // 合并扫描文本
    const theaterScanText = (gpSection + ' ' + behaviorText).toLowerCase();

    // 构建关键词列表（默认 + THEATER_KEYWORDS_EXTRA env 扩展）
    const extraKws = (process.env.THEATER_KEYWORDS_EXTRA || '')
      .split(',')
      .map((k) => k.trim())
      .filter((k) => k.length > 0);
    const allTheaterKws = [...THEATER_REAL_MACHINE_KEYWORDS, ...extraKws];

    const hitKw = allTheaterKws.find((kw) => theaterScanText.includes(kw.toLowerCase()));
    if (hitKw) {
      reasons.push(
        `theater_mismatch: GP/contract BEHAVIOR 含真机关键词「${hitKw}」，` +
        `但 target_environment=${env}（轻量环境，不具备真机执行能力）。` +
        `应路由至 windows_wechat / xian-rog 等真机环境。`
      );
    }
  }

  // ⑤ 元验证补丁（meta_verification_gap）FR-03
  // sprint-prd 标题或 GP 出口含 smoke/验证脚本/演习 关键词时，
  // contract BEHAVIOR 中必须有至少一条含真机关键词或 verification_level: L3 → 否则 FAIL
  const META_VERIFY_TRIGGER_KEYWORDS = ['smoke', '验证脚本', '演习'];
  let prdTextForMeta = '';
  let contractTextForMeta = '';
  try {
    prdTextForMeta = await readFileFn(path.join(ctx.worktreePath || '', ctx.sprintDir || '', 'sprint-prd.md'));
  } catch { /* 缺失 → 跳过 */ }
  try {
    contractTextForMeta = await readFileFn(path.join(ctx.worktreePath || '', ctx.sprintDir || '', 'contract-draft.md'));
  } catch { /* 缺失 → 跳过 */ }

  // 检查标题（第一行）和 GP 段是否含触发词
  const prdFirstLine = (prdTextForMeta.split('\n')[0] || '').toLowerCase();
  const gpMatchMeta = prdTextForMeta.match(/##\s*Golden\s*Path[^\n]*\n([\s\S]*?)(?=\n##\s+|$)/i);
  const gpSectionMeta = (gpMatchMeta ? gpMatchMeta[1] : '').toLowerCase();
  const metaTriggerHit = META_VERIFY_TRIGGER_KEYWORDS.find(
    (kw) => prdFirstLine.includes(kw.toLowerCase()) || gpSectionMeta.includes(kw.toLowerCase())
  );

  if (metaTriggerHit && prdTextForMeta) {
    // contract BEHAVIOR 中必须有：真机关键词 或 verification_level: L3
    const contractLower = contractTextForMeta.toLowerCase();
    const extraKwsMeta = (process.env.THEATER_KEYWORDS_EXTRA || '')
      .split(',')
      .map((k) => k.trim())
      .filter((k) => k.length > 0);
    const allKwsMeta = [...THEATER_REAL_MACHINE_KEYWORDS, ...extraKwsMeta];
    const hasTheaterKwInContract = allKwsMeta.some((kw) => contractLower.includes(kw.toLowerCase()));
    const hasL3InContract = contractLower.includes('verification_level: l3');
    if (!hasTheaterKwInContract && !hasL3InContract) {
      reasons.push(
        `meta_verification_gap: sprint-prd 含「${metaTriggerHit}」类标题/GP，` +
        `但 contract [BEHAVIOR] 中无真机关键词（${THEATER_REAL_MACHINE_KEYWORDS.slice(0, 4).join('/')}…）` +
        `也无 verification_level: L3 断言。smoke/演习类交付须有真目标复核断言。`
      );
    }
  }

  // ⑥ GP-Anchor 一致性核查（GP锚定闭环刀4 — file-existence gated，与刀3 skill层同一哲学）
  // product-map/generated/product-map.json 不存在（非zenithjoy-workspace项目的sprint）→ 完全跳过
  let productMapRaw = null;
  try {
    productMapRaw = await readFileFn(path.join(ctx.worktreePath || '', 'product-map/generated/product-map.json'));
  } catch { /* 不存在 → 跳过本项检查 */ }

  if (productMapRaw) {
    let contractTextForAnchor = '';
    try {
      contractTextForAnchor = await readFileFn(path.join(ctx.worktreePath || '', ctx.sprintDir || '', 'contract-draft.md'));
    } catch { /* 缺失走下方"无GP-Anchor声明"分支 */ }

    const skippedDeclared = /gp-anchor:\s*skipped/i.test(contractTextForAnchor);
    // 排除 "gp-anchor: skipped ..." 本身被误认成一条待解析的 GP-Anchor 声明
    // （两者共享 "gp-anchor:" 前缀，大小写不敏感匹配下会互相命中）。
    const anchorMatch = skippedDeclared
      ? null
      : contractTextForAnchor.match(/GP-Anchor:\s*(\S.*)\s*$/im);

    if (!skippedDeclared && !anchorMatch) {
      reasons.push(
        'gp_anchor_missing: 本sprint所在仓库存在 product-map.json，但 contract-draft.md 既无 「## GP-Anchor」声明也无 「gp-anchor: skipped」说明。'
      );
    } else if (anchorMatch) {
      const decl = anchorMatch[1].trim();
      const progMatch = decl.match(/^([a-z0-9_]+)\/([a-z0-9_]+)#step\d+$/);
      const keepGreenMatch = decl.match(/^([a-z0-9_]+)\/([a-z0-9_]+)\s+keep-green$/);
      const noneMatch = decl.match(/^none\((infra|docs|config|backlog)\)/);

      if (progMatch || keepGreenMatch) {
        const [, lineId, gpId] = progMatch || keepGreenMatch;
        try {
          const map = JSON.parse(productMapRaw);
          const exists = Array.isArray(map.golden_paths) &&
            map.golden_paths.some((g) => g.line_id === lineId && g.id === gpId);
          if (!exists) {
            reasons.push(`gp_anchor_id_notfound: 声明的 ${lineId}/${gpId} 在 product-map.json 里查无。`);
          }
        } catch (err) {
          reasons.push(`gp_anchor_env_fail: product-map.json 解析失败（${err.message}），无法核对 id 存在性。`);
        }
      } else if (!noneMatch) {
        reasons.push(
          `gp_anchor_format_invalid: GP-Anchor 声明「${decl}」不合法（须为 <line>/<gp>#stepN、<line>/<gp> keep-green、或 none(infra|docs|config|backlog)）。`
        );
      }
    }
  }

  return { pass: reasons.length === 0, reasons, env };
}

/**
 * runJudgeGate — 独立裁判门。仅对 agent verdict===PASS 生效（运动员说 PASS 才需复核）。
 * 非 PASS（agent 已 FAIL）直接透传走现有 fix loop，不浪费裁判调用。
 *
 * @param {object} ctx  {agentVerdict, agentFeedback, transcript, brainResult, worktreePath, sprintDir, instanceLabel, promptDir, taskId}
 *                       promptDir+taskId 用于定位 evaluator 完整 stdout 转录（#3345 forensics 文件）。
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

  const stagePreflight = validateIndependentJudgeStageFacts(ctx.stageFacts);
  if (!stagePreflight.pass) {
    const fb = `结构化阶段闸 FAIL：\n- ${stagePreflight.reasons.join('\n- ')}`;
    await persistJudgeArtifact({
      worktreePath: ctx.worktreePath,
      instanceLabel: ctx.instanceLabel,
      payload: {
        agentVerdict,
        stageFacts: ctx.stageFacts,
        stagePreflight,
        finalVerdict: 'FAIL',
        failureClass: 'evidence_invalid',
      },
    }, opts);
    console.warn(`[judge] 结构化阶段闸 FAIL → 不调 DeepSeek：${stagePreflight.reasons.join('；')}`);
    return {
      verdict: 'FAIL',
      feedback: fb,
      judged: true,
      failure_class: 'evidence_invalid',
    };
  }

  const ev = await collectFn({
    worktreePath: ctx.worktreePath,
    sprintDir: ctx.sprintDir,
    contractText: ctx.contractText,
    prdText: ctx.prdText,
    transcript: ctx.transcript,
    brainResult: ctx.brainResult,
    promptDir: ctx.promptDir,
    taskId: ctx.taskId,
  }, opts);

  // 刀B：机械闸先行（纯代码，FAIL 不调 DeepSeek）——决策 dc18d43d「无闸不成文」
  const mech = await runMechanicalGate(
    { ...ctx, brainResult: ev.brainResult || ctx.brainResult, agentStdout: ev.agentStdout, transcript: ev.transcript },
    opts
  );
  if (!mech.pass) {
    const fb = `机械闸 FAIL（无闸不成文 dc18d43d）：\n- ${mech.reasons.join('\n- ')}`;
    await persistJudgeArtifact({
      worktreePath: ctx.worktreePath,
      instanceLabel: ctx.instanceLabel,
      payload: { agentVerdict, mechanicalGate: mech, finalVerdict: 'FAIL' },
    }, opts);
    console.warn(`[judge] 机械闸 FAIL → 不调 DeepSeek：${mech.reasons.join('；')}`);
    return { verdict: 'FAIL', feedback: fb, judged: true };
  }

  // 证据门：无合同 E2E 段且无 Golden Path 步骤 → 裁判没有「该验什么」的独立基准，无法做覆盖对照
  // → fail-open 保留 agent verdict（不浪费裁判调用，也不在缺证据时凭空否决运动员）。
  // Fleet 路径从批准后的 TaskBundle 读取锁版本文本；旧本地路径回退读取 sprint 文件。
  if (!ev.contractE2E && (!ev.goldenPathSteps || ev.goldenPathSteps.length === 0)) {
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
      agentStdout: ev.agentStdout,
      brainResult: ev.brainResult,
      stageFacts: ctx.stageFacts,
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
      stageFacts: ctx.stageFacts,
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
