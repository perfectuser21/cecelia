// 独立裁判步（决策 02d8e749 ②d）：QA 门里真人 QA PASS 之后、开自动合并之前，在 PR worktree 里
// 读需求 01、合同 02、QA 报告 05 与 PR 代码改动（相对 main，不含 sprints/），交给不同模型（lib/judge.mjs）复核，
// 裁决写 <sprint>/06-judge-r<round>.md（由 QA 门提交进 PR）。
import fs from 'node:fs';
import path from 'node:path';
import { git } from './proc.mjs';
import { buildJudgePrompt, parseJudge, decideJudge, renderJudgeReport, callJudge, judgeFileName, JUDGE_DIFF_LIMIT } from '../../lib/judge.mjs';

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
export async function runJudge(cfg, worktree, intent, { round, reportRel, log }) {
  const read = (rel) => fs.readFileSync(path.join(worktree, rel), 'utf8');
  let texts;
  try {
    texts = { intent: read(`${intent.sprintDir}/01-intent.md`), spec: read(`${intent.sprintDir}/02-spec.md`), qaReport: read(reportRel) };
  } catch {
    return { error: 'judge_input_missing' };
  }
  let reply;
  try {
    const diff = await prDiff(worktree);
    // 裁判必须看到完整改动（审计 #43）：超限不截断照判，交 coding commander
    if (diff.length > JUDGE_DIFF_LIMIT) return { error: 'judge_input_truncated', escalate: true, diff_chars: diff.length };
    // 前几轮裁决（金丝雀 4 翻转）：裁判知道开发方已经照哪些结论改过
    const priorRulings = priorJudgeFiles(worktree, intent.sprintDir, round).map((f) => ({ round: f.round, text: read(f.rel) }));
    const prompt = buildJudgePrompt({ ...texts, diff, qaReportFile: path.basename(reportRel), intentIds: intent.intentIds, round, priorRulings });
    reply = await callJudge(prompt, { ...cfg.judgeConn, timeoutMs: cfg.judgeTimeoutMs });
  } catch (error) {
    return { error: String(error?.message || error).split(':')[0] };
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
  // 建议级问题不阻断，但要可见（审计 #41）
  const concerns = parsed.issues.filter((i) => i.severity === '建议').map(({ id, severity, covers, detail, where }) => ({ id, severity, covers, detail, where }));
  return { ...decision, concerns, file, model, usage: reply.usage };
}
