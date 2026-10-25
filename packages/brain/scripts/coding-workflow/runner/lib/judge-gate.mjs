import { controllerIdentity, withRecordProvenance, sealStageEvidence } from '../../lib/record-provenance.mjs';
import { sourceContext, judgeSourceFacts } from './source-provenance.mjs';
// 独立裁判步（决策 02d8e749 ②d）：QA 门里真人 QA PASS 之后、开自动合并之前，在 PR worktree 里
// 读需求 01、合同 02、QA 报告 05 与 PR 代码改动（相对 main，不含 sprints/），交给不同模型（lib/judge.mjs）复核，
// 裁决写 <sprint>/06-judge-r<round>.md（由 QA 门提交进 PR）。
import fs from 'node:fs';
import path from 'node:path';
import { git } from './proc.mjs';
import { buildJudgePrompt, parseJudge, decideJudge, renderJudgeReport, callJudge, judgeFileName, JUDGE_DIFF_LIMIT } from '../../lib/judge.mjs';

const SOURCE_CONTROLLER = controllerIdentity(import.meta.url, ['../../lib/judge.mjs', '../../lib/codex-judge.mjs', './source-provenance.mjs'].map(p => new URL(p, import.meta.url)));

/** 本轮之前已提交的裁决：[{ round, rel }]（sprint 内 06-judge-r<k>.md，k < round，按轮次升序）。 */
export function priorJudgeFiles(worktree, sprintDir, round) {
  const out = [];
  for (let k = 1; k < round; k += 1) {
    const rel = `${sprintDir}/${judgeFileName(k)}`;
    if (fs.existsSync(path.join(worktree, rel))) out.push({ round: k, rel });
  }
  return out;
}

/** PR 相对 main 的代码改动（三点 diff，排除 sprints/ 验收记录）。 */
async function prDiff(worktree) {
  const r = await git(worktree, ['diff', 'origin/main...HEAD', '--', '.', ':(exclude)sprints']);
  if (r.code !== 0) throw new Error('judge_diff_failed');
  return r.stdout;
}

/**
 * 跑一次裁判。成功 → { verdict, failure_class, blocking, unsatisfied, file, model, usage }（已写 06 文件）；
 * 调用失败/输出不合格 → { error, errors? }（模型原始输出记到 logDir）。不抛错。
 */
export async function runJudge(cfg, worktree, intent, options) {
  const context = sourceContext(cfg, worktree, intent, 'judge', options.round, SOURCE_CONTROLLER);
  const run = () => runJudgeObserved(cfg, worktree, intent, options);
  return context ? withRecordProvenance(context, run) : run();
}

async function runJudgeObserved(cfg, worktree, intent, { round, reportRel, log, qaStageEventId, sourceMode = 'pending', testedHead }) {
  const read = (rel) => fs.readFileSync(path.join(worktree, rel), 'utf8');
  let texts;
  try {
    texts = { intent: read(`${intent.sprintDir}/01-intent.md`), spec: read(`${intent.sprintDir}/02-spec.md`), qaReport: read(reportRel) };
  } catch {
    return { error: 'judge_input_missing' };
  }
  let reply, facts;
  try {
    const exact = await git(worktree, ['rev-parse', 'HEAD']);
    if (exact.code !== 0) throw new Error('judge_head_missing');
    facts = judgeSourceFacts(cfg, worktree, intent, exact.stdout.trim(), reportRel,
      { mode: sourceMode, stageEventId: qaStageEventId, testedHead, round });
    const diff = await prDiff(worktree);
    // 裁判必须看到完整改动（审计 #43）：超限不截断照判，交 coding commander
    if (diff.length > JUDGE_DIFF_LIMIT) return { error: 'judge_input_truncated', escalate: true, diff_chars: diff.length };
    // 前几轮裁决（金丝雀 4 翻转）：裁判知道开发方已经照哪些结论改过
    const priorRulings = priorJudgeFiles(worktree, intent.sprintDir, round).map((f) => ({ round: f.round, text: read(f.rel) }));
    const prompt = buildJudgePrompt({ ...texts, diff, qaReportFile: path.basename(reportRel), intentIds: intent.intentIds, round, priorRulings });
    if (facts) prompt.user = `受信控制器来源事实（阶段接收/登记及current_qa.isolation所列本轮控制器临时隐藏与原样恢复；仅解释精确03/04工作区暂移，不证明Git历史保密、不豁免产品范围或命令语义；sealed_not_registered不是已登记；historical_execution仅为已登记build/verify阶段当时原生执行，按其stage_input_head与来源身份核验，不是本轮QA执行或产品PASS。失败会话/非零退出/空输出均保留，历史不能替代本轮验证）：\n${JSON.stringify(facts)}\n\n${prompt.user}`;
    const transcriptPath = path.join(cfg.logDir, `judge-${intent.taskId || path.basename(intent.sprintDir)}-r${round}-${Date.now()}.jsonl`);
    reply = await callJudge(prompt, { ...cfg.judgeConn, timeoutMs: cfg.judgeTimeoutMs, transcriptPath });
  } catch (error) {
    const reason = String(error?.message || error).split(':')[0];
    return { error: reason, ...(/^(?:judge_codex_(?:auth|configuration|config_missing)|judge_input_budget_(?:invalid|exceeded))$/.test(reason) ? { escalate: true } : {}) };
  }
  const parsed = parseJudge(reply.content, { intentIds: intent.intentIds });
  if (parsed.errors.length > 0) {
    fs.mkdirSync(cfg.logDir, { recursive: true });
    fs.writeFileSync(path.join(cfg.logDir, `judge-invalid-${Date.now()}.txt`), String(reply.content));
    log?.(`独立裁判输出不合格：${parsed.errors.join(', ')}`);
    return { error: 'judge_output_invalid', errors: parsed.errors };
  }
  const decision = decideJudge(parsed);
  const file = judgeFileName(round);
  const model = cfg.judgeConn.model;
  fs.writeFileSync(path.join(worktree, intent.sprintDir, file), renderJudgeReport({ round, model, parsed, decision, qaReport: path.basename(reportRel) }));
  try {
    sealStageEvidence({ files: [`${intent.sprintDir}/${file}`], producer: 'controller_render',
      result: { status: 'completed', outputs: { judge_verdict: decision.verdict } },
      controllerInput: { round, reportRel, parsed, decision, input_sha256: reply.input_sha256 ?? null,
        materials_sha256: reply.materials_sha256 ?? null, stdin_sha256: reply.stdin_sha256 ?? null, stdin_bytes: reply.stdin_bytes ?? null,
        judge_input_event_id: reply.judge_input_event_id ?? null,
        ...(facts ? { qa_stage_event_id: facts.current_qa.records.find(r => r.path === reportRel)?.stage_event_id,
          tested_head: facts.current_qa.records.find(r => r.path === reportRel)?.stage_input_head } : {}) } });
  } catch (error) { return { error: error.message }; }
  // 建议级问题不阻断，但要可见（审计 #41）
  const concerns = parsed.issues.filter((i) => i.severity === '建议').map(({ id, severity, covers, detail, where }) => ({ id, severity, covers, detail, where }));
  return { ...decision, concerns, file, model, usage: reply.usage, ...(reply.provider ? { provider: reply.provider, cost_usd: reply.cost_usd, transcript_path: reply.transcriptPath, input_sha256: reply.input_sha256, materials_sha256: reply.materials_sha256, stdin_sha256: reply.stdin_sha256, stdin_bytes: reply.stdin_bytes,
      ...(reply.judge_input_event_id ? { judge_input_event_id: reply.judge_input_event_id } : {}),
      ...(reply.source_native_event_id ? { source_native_event_id: reply.source_native_event_id } : {}) } : {}) };
}
