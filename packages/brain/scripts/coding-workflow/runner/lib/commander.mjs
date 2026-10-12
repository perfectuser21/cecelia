// coding commander（决策 c167d6e3，018e4e84「Commander 是 workflow 的陪跑/兜底」）：runner 自己开的 cw PR 在 QA 门或
// CI 修复升级后，下一轮起 Opus 会话按规格逐条裁决并动手——维持/修订规格（只许在 02-spec.md 末尾追加裁决节）、
// TDD 修代码、给 CI 修复追加额度——程序核对后推送，写 07-commander-rN.md 裁决记录，解除升级，记 Brain
// result.commander_overrides 与 commander span。改需求/改写规格/削弱测试/输出不合格/会话失败/裁决上交/
// 本 PR 介入满 cfg.commanderMax 次/基础设施类升级 → Bark 主理人（同一个升级只通知一次）。
// qa_smoke_missing（API 类 PR 一条回归 smoke 都没固化，决策 4fe863c3）：裁决「放行」（必须写理由）且没改代码 → 直接批准
// 裁决记录推送后的 head；否则只解除升级，head 已变，QA 门下一轮按新 head 重跑。
// 状态：<logDir>[/<仓库命名空间>]/commander-<pr>.json { interventions: [...], human }。
import fs from 'node:fs';
import path from 'node:path';
import { git } from './proc.mjs';
import { removeWorktree } from './worktree.mjs';
import { listOwnPrs } from './cifix-scan.mjs';
import { intentOf, preparePrWorktree, checkFixCommits, pushPrHead, headOf } from './pr-branch.mjs';
import { gateSpan, postSpans } from './spans.mjs';
import { runClaude, loadPrompt } from '../../lib/claude.mjs';
import { sessionLogPath, sessionSummary } from './session-log.mjs';
import { prFile } from './repos.mjs';

// commander 能处理的升级；其余（预览环境、裁判不可用/关闭、改动超限、评估会话坏、sprint 丢失……）是基础设施或要人定，直接通知主理人
export const HANDLED = new Set(['judge_contract_gap', 'judge_ruling_conflict', 'qa_fix_failed', 'qa_stalled', 'qa_cannot_verify', 'qa_smoke_missing', 'ci_fix_exhausted']);
const CLAUDE_TOOLS = ['--allowedTools', 'Bash', '--disallowedTools', 'Bash(git push:*)', 'Bash(gh:*)'];
const RUNNER_ID = ['-c', 'user.name=coding-workflow-runner', '-c', 'user.email=coding-workflow-runner@cecelia.local'];
const VERDICTS = new Set(['维持规格', '采纳', '追加额度', '放行', '上交']);

const file = (cfg, name) => prFile(cfg, name);
const readJson = (p, fallback) => {
  try {
    return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch {
    return fallback;
  }
};
const writeJson = (p, v) => {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, `${JSON.stringify(v, null, 2)}\n`);
};
const readCmd = (cfg, pr) => ({ interventions: [], human: null, ...readJson(file(cfg, `commander-${pr}.json`), {}) });

/** 这个 PR 当前的升级：QA 门优先，其次 CI 修复。 */
function escalationOf(cfg, pr) {
  const qa = readJson(file(cfg, `qa-${pr}.json`), null);
  if (qa?.escalated) return { kind: 'qa', detail: qa.escalated, qa };
  const ci = readJson(file(cfg, `cifix-${pr}.json`), null);
  if (ci?.escalated) return { kind: 'cifix', detail: ci.escalated, ci };
  return null;
}

/** 裁决 JSON 校验 → { ruling } 或 { error }。 */
export function parseRuling(text) {
  let r;
  try {
    r = JSON.parse(text);
  } catch {
    return { error: 'json_invalid' };
  }
  if (!['resume', 'human'].includes(r?.action)) return { error: 'action_invalid' };
  if (!Array.isArray(r.rulings) || r.rulings.length === 0) return { error: 'rulings_missing' };
  for (const x of r.rulings) {
    if (![x?.issue, x?.reason].every((v) => typeof v === 'string' && v.trim()) || !VERDICTS.has(x?.verdict)) return { error: 'ruling_item_invalid' };
  }
  if (typeof r.summary !== 'string' || !r.summary.trim()) return { error: 'summary_missing' };
  if (r.action === 'human' && !(typeof r.human_reason === 'string' && r.human_reason.trim())) return { error: 'human_reason_missing' };
  return { ruling: { ...r, reset_ci_budget: r.reset_ci_budget === true } };
}

/** 07-commander-r<n>.md */
export function renderRuling({ n, escalation, ruling, commits }) {
  const lines = [`# coding commander 裁决（第 ${n} 次）`, '', `- 升级：${escalation.type}`, `- 处理：${ruling.action === 'human' ? '上交主理人' : '解除升级，继续自动流程'}`,
    `- 总结：${ruling.summary}`, ...(ruling.reset_ci_budget ? ['- CI 修复额度：重置'] : []), ...(commits.length ? [`- 提交：${commits.map((c) => c.slice(0, 9)).join('、')}`] : []), '', '## 逐条裁决'];
  for (const x of ruling.rulings) lines.push('', `### ${x.issue}`, `- 裁决：${x.verdict}`, `- 理由：${x.reason}`);
  return `${lines.join('\n')}\n`;
}

/** 通知主理人（Bark）；记 commander 状态与 Brain，同一个升级只通知一次。 */
async function toHuman(ctx, pr, cs, esc, reason, detail, taskId = null) {
  const title = `coding commander 上交：PR #${pr.number}`;
  const body = `${esc?.detail?.type ?? '未知升级'}｜${reason}${detail ? `：${detail}` : ''}`;
  let notified = false;
  if (ctx.cfg.barkUrl) {
    try {
      const res = await fetch(`${ctx.cfg.barkUrl.replace(/\/+$/, '')}/${encodeURIComponent(title)}/${encodeURIComponent(body)}`, { signal: AbortSignal.timeout(15000) });
      notified = res.ok;
    } catch { /* 记日志即可 */ }
  }
  cs.human = { reason, detail: detail ?? null, escalation_at: esc?.detail?.at ?? null, at: new Date().toISOString(), notified };
  writeJson(file(ctx.cfg, `commander-${pr.number}.json`), cs);
  ctx.log(`[coding-commander][P1] PR #${pr.number} 上交主理人：${body}${notified ? '' : '（Bark 未送达）'}`);
  if (taskId) await ctx.brain.patch(taskId, { result: { commander_human: cs.human } });
}

/** qa_smoke_missing 裁决放行（且没改代码）：批准裁决记录推送后的 head，理由记进 smoke_waived 与 smoke_note。 */
function waiveSmoke(s, esc, ruling, { n, head, commits }) {
  const waived = ruling.rulings.filter((x) => x.verdict === '放行');
  if (esc.detail.type !== 'qa_smoke_missing' || waived.length === 0 || commits.length > 0) return;
  const reason = waived.map((x) => `${x.issue}：${x.reason}`).join('；');
  const at = new Date().toISOString();
  s.passed = true;
  s.approved = { head, round: s.rounds?.at(-1)?.round ?? esc.detail.round ?? null, at, by: 'coding-commander' };
  s.smoke_waived = { n, reason, at };
  delete s.smoke_missing;
  s.smoke_note = `${s.smoke_note ? `${s.smoke_note}；` : ''}commander 第 ${n} 次裁决放行：${reason}`;
}

/** 解除升级：QA 门 / CI 修复状态。 */
function release(cfg, pr, esc, ruling, done) {
  if (esc.kind === 'qa') {
    const s = readJson(file(cfg, `qa-${pr}.json`), {});
    delete s.escalated;
    delete s.mirrored;
    if (esc.detail.type === 'qa_stalled') s.stall_floor = (s.rounds ?? []).length;
    waiveSmoke(s, esc, ruling, done);
    writeJson(file(cfg, `qa-${pr}.json`), s);
    return;
  }
  const s = readJson(file(cfg, `cifix-${pr}.json`), {});
  delete s.escalated;
  delete s.mirrored;
  if (ruling.reset_ci_budget) {
    s.archived_attempts = [...(s.archived_attempts ?? []), ...(s.attempts ?? [])];
    s.attempts = [];
  }
  writeJson(file(cfg, `cifix-${pr}.json`), s);
}

/** 核对 commander 的提交：同修复会话的核对（受保护路径、削弱测试），另许改规格但只许纯追加。失败抛 Error(reason)。 */
async function checkCommits(worktree, before, specRel) {
  const { commits } = await checkFixCommits(worktree, before, { allow: [specRel] });
  const old = await git(worktree, ['show', `${before}:${specRel}`]);
  const now = fs.readFileSync(path.join(worktree, specRel), 'utf8');
  if (old.code === 0 && now !== old.stdout && (!now.startsWith(old.stdout) || !now.slice(old.stdout.length).includes('commander 裁决'))) {
    throw new Error('spec_not_append');
  }
  return commits;
}

async function intervene(ctx, pr, esc, cs, signal) {
  const { cfg } = ctx;
  const n = cs.interventions.length + 1;
  const worktree = path.join(cfg.worktreeBase, `commander-${pr.number}-${n}`);
  fs.mkdirSync(cfg.worktreeBase, { recursive: true });
  if (fs.existsSync(worktree)) await removeWorktree(cfg, worktree, null);
  fs.rmSync(worktree, { recursive: true, force: true });
  const startedAt = Date.now();
  let taskId = null;
  let costUsd;
  const fail = async (reason, detail) => {
    await toHuman(ctx, pr, cs, esc, reason, detail, taskId);
    if (taskId) await postSpans(ctx, [gateSpan({ taskId, key: 'commander', startedAt, endedAt: Date.now(), ok: false, costUsd, occurrence: `${pr.number}:c${n}`, evidence: { escalation: esc.detail.type, reason } })]);
  };
  try {
    await preparePrWorktree(cfg, pr, worktree, signal);
    const intent = intentOf(worktree, pr.headRefName);
    if (!intent?.taskId) return await fail('commander_sprint_missing');
    taskId = intent.taskId;
    const before = await headOf(worktree);
    const specRel = `${intent.sprintDir}/02-spec.md`;
    const contextPath = file(cfg, `commander-${pr.number}-${n}-context.json`);
    const rulingPath = file(cfg, `commander-${pr.number}-${n}-ruling.json`);
    writeJson(contextPath, { pr: pr.number, branch: pr.headRefName, escalation: esc.detail, qa_state: readJson(file(cfg, `qa-${pr.number}.json`), null),
      ci_fix_state: readJson(file(cfg, `cifix-${pr.number}.json`), null), previous: cs.interventions });
    fs.rmSync(rulingPath, { force: true });
    const prompt = loadPrompt('commander', {
      ROUND: String(n), MAX: String(cfg.commanderMax), PR_NUMBER: `#${pr.number}`, BRANCH: pr.headRefName,
      ESCALATION_TYPE: esc.detail.type, ESCALATION_JSON: JSON.stringify(esc.detail), CONTEXT_PATH: contextPath,
      SPRINT_DIR: path.join(worktree, intent.sprintDir), INTENT_PATH: path.join(worktree, intent.sprintDir, '01-intent.md'),
      SPEC_PATH: path.join(worktree, specRel), RULING_PATH: rulingPath,
    });
    ctx.log(`coding commander PR #${pr.number} 第 ${n} 次介入（${esc.detail.type}）`);
    // 裁决文件写在 logDir（worktree 外）：显式授权该目录，否则 Write 被拒（真实 Opus 演练实证）
    const run = await runClaude({ args: ['-p', prompt, '--permission-mode', 'acceptEdits', '--add-dir', cfg.logDir, ...CLAUDE_TOOLS], cwd: worktree, timeoutMs: cfg.commanderTimeoutMs, tag: 'commander', isolateRemote: true,
      transcriptPath: sessionLogPath(cfg, 'commander', pr.number, n) });
    costUsd = run.cost_usd;
    ctx.log(sessionSummary('commander', pr.number, run));
    if (run.timedOut || run.terminated || run.code !== 0) return await fail('commander_session_failed', run.timedOut ? 'timeout' : `exit ${run.code}`);
    const parsed = parseRuling(fs.existsSync(rulingPath) ? fs.readFileSync(rulingPath, 'utf8') : '');
    if (parsed.error) return await fail('commander_output_invalid', parsed.error);
    const { ruling } = parsed;
    if (ruling.action === 'human') return await fail('commander_human', ruling.human_reason);
    let commits = [];
    if ((await headOf(worktree)) !== before) {
      try {
        commits = await checkCommits(worktree, before, specRel);
      } catch (error) {
        return await fail(`commander_${error?.message || 'commit_check_failed'}`);
      }
    } else if ((await git(worktree, ['status', '--porcelain'])).stdout.trim()) {
      return await fail('commander_uncommitted');
    }
    const record = `${intent.sprintDir}/07-commander-r${n}.md`;
    fs.writeFileSync(path.join(worktree, record), renderRuling({ n, escalation: esc.detail, ruling, commits }));
    if ((await git(worktree, ['add', '--', record])).code !== 0
      || (await git(worktree, [...RUNNER_ID, 'commit', '-q', '-m', `docs(commander): 第 ${n} 次 coding commander 裁决（${esc.detail.type}）`])).code !== 0) {
      return await fail('commander_record_commit_failed');
    }
    await pushPrHead(cfg, worktree, pr);
    const head = await headOf(worktree);
    release(cfg, pr.number, esc, ruling, { n, head, commits });
    const entry = { n, at: new Date().toISOString(), kind: esc.kind, escalation: esc.detail, action: 'resume', rulings: ruling.rulings, summary: ruling.summary,
      reset_ci_budget: ruling.reset_ci_budget, commits, record, head, cost_usd: costUsd ?? null };
    cs.interventions.push(entry);
    writeJson(file(cfg, `commander-${pr.number}.json`), cs);
    const task = await ctx.brain.getTask(taskId);
    const prev = task.ok ? task.body?.result?.commander_overrides ?? [] : [];
    const r = await ctx.brain.patch(taskId, { result: { commander_overrides: [...(Array.isArray(prev) ? prev : []), { ...entry, by: 'coding-commander' }] } });
    if (!r.ok) ctx.log(`coding commander 回写 Brain 任务 ${taskId} 失败（HTTP ${r.status}）`);
    await postSpans(ctx, [gateSpan({ taskId, key: 'commander', startedAt, endedAt: Date.now(), ok: true, costUsd, occurrence: `${pr.number}:c${n}`, evidence: { escalation: esc.detail.type, commits: commits.length } })]);
    ctx.log(`coding commander PR #${pr.number} 第 ${n} 次裁决：${ruling.summary}（解除 ${esc.detail.type}）`);
    return true;
  } catch (error) {
    // 会话期间 PR 被关：不推送、不 Bark，升级原样保留，交给外部关闭收尾（pr-closure.mjs）
    if (error?.message === 'pr_closed') {
      ctx.log(`coding commander PR #${pr.number} 已关闭，裁决不推送，交给关闭收尾`);
      return true;
    }
    return await fail('commander_error', String(error?.message || error).slice(0, 300));
  } finally {
    await removeWorktree(cfg, worktree, pr.headRefName);
    fs.rmSync(worktree, { recursive: true, force: true });
  }
}

/** 本轮至多处理一个升级了的 PR（介入或通知主理人都算处理）；处理了返回 true。不抛错。 */
export async function runCommander(ctx, signal) {
  const { cfg } = ctx;
  try {
    const prs = await listOwnPrs(cfg);
    for (const pr of prs ?? []) {
      const esc = escalationOf(cfg, pr.number);
      if (!esc) continue;
      const cs = readCmd(cfg, pr.number);
      // 已为这个升级通知过主理人：等人处理（人清掉升级后再升级的是新的一次）
      if (cs.human && cs.human.escalation_at === (esc.detail.at ?? null)) continue;
      if (!HANDLED.has(esc.detail.type)) {
        await toHuman(ctx, pr, cs, esc, 'infra_escalation', esc.detail.type);
        return true;
      }
      if (cs.interventions.length >= cfg.commanderMax) {
        await toHuman(ctx, pr, cs, esc, 'commander_limit', `本 PR 已介入 ${cs.interventions.length} 次`);
        return true;
      }
      await intervene(ctx, pr, esc, cs, signal);
      return true;
    }
  } catch (error) {
    ctx.log(`coding commander 出错：${error?.message || error}`);
  }
  return false;
}
