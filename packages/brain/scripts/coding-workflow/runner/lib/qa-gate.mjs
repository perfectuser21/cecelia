// QA 门（evaluator 真人 QA，决策 02d8e749）：runner 自己开的 cw PR，必需检查全绿后、合并前，在 PR 预览环境里由
// evaluate 活动像真人 QA 一样黑盒验收。PASS → QA 报告提交进 PR、开自动合并；FAIL → 报告提交、开发按报告修复、推送、
// CI 再跑、再验（不设轮数上限）。失败数连续 3 轮不降（不收敛）、评估会话连坏、预览环境长期起不来 → 升级给 coding commander。
// 状态：<logDir>/qa-<pr>.json；Brain 任务 result.qa（摘要）与 result.escalations。合并后停掉该 PR 的预览环境释放容量。
import fs from 'node:fs';
import path from 'node:path';
import { run, git } from './proc.mjs';
import { removeWorktree } from './worktree.mjs';
import { ghJson, listOwnPrs, requiredState, CW_BRANCH_RE } from './cifix-scan.mjs';
import { intentOf, remoteTaskId, preparePrWorktree, checkFixCommits, pushPrHead } from './pr-branch.mjs';
import { previewOf } from '../../lib/preview.mjs';
import { runClaude, loadPrompt } from '../../lib/claude.mjs';

const EVALUATE_REL = 'packages/brain/scripts/coding-workflow/activities/evaluate.mjs';
const EVALUATE_TIMEOUT_MS = 55 * 60 * 1000;
const GH_TIMEOUT_MS = 60 * 1000;
const STALL_ROUNDS = 3;
const CLAUDE_TOOLS = ['--allowedTools', 'Bash', '--disallowedTools', 'Bash(git push:*)', 'Bash(gh:*)'];
const RUNNER_ID = ['-c', 'user.name=coding-workflow-runner', '-c', 'user.email=coding-workflow-runner@cecelia.local'];

const statePath = (cfg, pr) => path.join(cfg.logDir, `qa-${pr}.json`);

function readState(cfg, pr) {
  try {
    const s = JSON.parse(fs.readFileSync(statePath(cfg, pr), 'utf8'));
    return { rounds: [], bad: 0, ...s, rounds: Array.isArray(s?.rounds) ? s.rounds : [] };
  } catch {
    return { rounds: [], bad: 0 };
  }
}

function writeState(cfg, pr, s) {
  fs.mkdirSync(cfg.logDir, { recursive: true });
  fs.writeFileSync(statePath(cfg, pr), `${JSON.stringify(s, null, 2)}\n`);
}

async function previewCall(cfg, route, body) {
  try {
    const res = await fetch(`${cfg.previewApi.replace(/\/+$/, '')}/api/brain/preview/${route}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...(cfg.deployToken ? { authorization: `Bearer ${cfg.deployToken}` } : {}) },
      body: JSON.stringify(body ?? {}),
      signal: AbortSignal.timeout(30000),
    });
    return { ok: res.ok, status: res.status, body: await res.text().catch(() => '') };
  } catch (error) {
    return { ok: false, status: 0, body: String(error?.message || error) };
  }
}

/** 回写 Brain：result.qa 摘要（+ 升级记录）。拿不到 task_id 只记本地。 */
async function report(ctx, taskId, s) {
  if (!taskId) return;
  const last = s.rounds.at(-1);
  const result = { qa: { verdict: last?.verdict ?? null, rounds: s.rounds.length, passed: Boolean(s.passed), last_report: last?.report ?? null } };
  if (s.escalated) result.escalations = [s.escalated];
  const r = await ctx.brain.patch(taskId, { result });
  if (!r.ok) ctx.log(`QA 门回写 Brain 任务 ${taskId} 失败（HTTP ${r.status}）`);
}

/** 升级给 coding commander：记状态、P1 日志、回写 Brain；之后本 PR 不再自动处理。 */
async function escalate(ctx, pr, s, taskId, detail) {
  s.escalated = { ...detail, pr: pr.number, at: new Date().toISOString() };
  ctx.log(`[coding-qa][P1] PR #${pr.number} QA 门升级给 coding commander：${detail.type} ${JSON.stringify(detail)}`);
  writeState(ctx.cfg, pr.number, s);
  await report(ctx, taskId ?? (await remoteTaskId(ctx.cfg, pr.headRefName)), s);
}

/** 已合并且 QA 通过过的 PR：停掉预览环境释放容量（只停一次）。 */
async function stopMergedPreviews(ctx) {
  const merged = await ghJson(ctx.cfg, ['pr', 'list', '--state', 'merged', '--limit', '30', '--json', 'number,headRefName']);
  for (const pr of (Array.isArray(merged) ? merged : []).filter((p) => CW_BRANCH_RE.test(p.headRefName ?? ''))) {
    const s = readState(ctx.cfg, pr.number);
    if (!s.passed || s.preview_stopped) continue;
    const r = await previewCall(ctx.cfg, `stop/${pr.number}`);
    ctx.log(`停 PR #${pr.number} 预览环境：HTTP ${r.status}`);
    if (r.ok) writeState(ctx.cfg, pr.number, { ...s, preview_stopped: true });
  }
}

/** 预览环境没就绪：不存在/已停 → 请求启动；容量拒绝超过时限 → 升级。 */
async function ensurePreview(ctx, pr, s, p) {
  if (p.state === 'pending' || p.state === 'error') {
    ctx.log(`PR #${pr.number} 预览环境 ${p.state}，下轮再验`);
    return;
  }
  const r = await previewCall(ctx.cfg, 'start', { pr_number: pr.number, branch_name: pr.headRefName, base_repo: 'cecelia' });
  const now = Date.now();
  if (r.ok) {
    s.preview = { requested_at: new Date(now).toISOString() };
    ctx.log(`PR #${pr.number} 预览环境已请求启动`);
    writeState(ctx.cfg, pr.number, s);
    return;
  }
  const since = s.preview?.rejected_since ? Date.parse(s.preview.rejected_since) : now;
  s.preview = { ...s.preview, rejected_since: new Date(since).toISOString(), last_error: `HTTP ${r.status} ${r.body.slice(0, 300)}` };
  ctx.log(`PR #${pr.number} 预览环境启动被拒：${s.preview.last_error}`);
  if (now - since >= ctx.cfg.qaPreviewEscalateMs) {
    await escalate(ctx, pr, s, null, { type: 'qa_preview_unavailable', last_error: s.preview.last_error, since: s.preview.rejected_since });
    return;
  }
  writeState(ctx.cfg, pr.number, s);
}

/** 跑 evaluate 活动（json-stdio），返回解析后的结果对象或 null。 */
async function evaluate(ctx, worktree, input, signal) {
  const entry = ctx.cfg.evaluateEntry ?? path.join(worktree, EVALUATE_REL);
  const r = await run(process.execPath, [entry], { cwd: worktree, input: JSON.stringify(input), timeoutMs: EVALUATE_TIMEOUT_MS, signal });
  const line = r.stdout.trim().split('\n').reverse().find((l) => l.startsWith('{'));
  try {
    return line ? JSON.parse(line) : null;
  } catch {
    return null;
  }
}

/** 把本轮 QA 报告（和截图目录）提交并推到 PR 分支。 */
async function commitReport(worktree, pr, sprintDir, reportFile, round, verdict) {
  const shots = `${sprintDir}/qa-r${round}`;
  const paths = [`${sprintDir}/${reportFile}`, ...(fs.existsSync(path.join(worktree, shots)) ? [shots] : [])];
  if ((await git(worktree, ['add', '--', ...paths])).code !== 0) throw new Error('qa_report_add_failed');
  if ((await git(worktree, [...RUNNER_ID, 'commit', '-q', '-m', `docs(qa): 第 ${round} 轮真人 QA ${verdict}`])).code !== 0) throw new Error('qa_report_commit_failed');
  await pushPrHead(worktree, pr.headRefName);
}

/** 开发按 QA 报告修复（TDD），程序核对后推送；返回 'pushed' 或失败原因。 */
async function qaFix(ctx, pr, worktree, intent, outputs) {
  const before = (await git(worktree, ['rev-parse', 'HEAD'])).stdout.trim();
  const qa = outputs.qa;
  const issues = [...qa.failed, ...qa.blocking].map((i) => `- ${i.id}（对应 ${(i.covers ?? []).join('、')}${i.severity ? `，${i.severity}` : ''}）${i.scene ? `：${i.scene}` : ''}`).join('\n');
  const prompt = loadPrompt('qa-fix', {
    BRANCH: pr.headRefName,
    QA_REPORT_PATH: path.join(worktree, intent.sprintDir, outputs.qa_report_file),
    INTENT_PATH: path.join(worktree, intent.sprintDir, '01-intent.md'),
    SPEC_PATH: path.join(worktree, intent.sprintDir, '02-spec.md'),
    QA_ISSUES: issues || '（见报告）',
  });
  const run = await runClaude({ args: ['-p', prompt, '--permission-mode', 'acceptEdits', ...CLAUDE_TOOLS], cwd: worktree, timeoutMs: ctx.cfg.qaFixTimeoutMs, tag: 'qa-fix', isolateRemote: true });
  fs.mkdirSync(ctx.cfg.logDir, { recursive: true });
  fs.writeFileSync(path.join(ctx.cfg.logDir, `qa-fix-${pr.number}-${Date.now()}.log`), run.output ?? '');
  if (run.timedOut) return 'claude_timeout';
  if (run.terminated || run.code !== 0) return 'claude_failed';
  try {
    await checkFixCommits(worktree, before);
    await pushPrHead(worktree, pr.headRefName);
    return 'pushed';
  } catch (error) {
    return error?.message || 'qa_fix_error';
  }
}

/** 一轮 QA：检出 PR 版本 → evaluate → 提交报告 → PASS 开自动合并 / FAIL 修复或升级。 */
async function qaRound(ctx, pr, s, signal) {
  const { cfg } = ctx;
  const round = s.rounds.length + 1;
  const worktree = path.join(cfg.worktreeBase, `qa-${pr.number}-${round}`);
  fs.mkdirSync(cfg.worktreeBase, { recursive: true });
  if (fs.existsSync(worktree)) await removeWorktree(cfg, worktree, null);
  fs.rmSync(worktree, { recursive: true, force: true });
  let intent = null;
  try {
    await preparePrWorktree(cfg, pr, worktree, signal);
    intent = intentOf(worktree, pr.headRefName);
    if (!intent?.taskId) return await escalate(ctx, pr, s, null, { type: 'qa_sprint_missing' });
    ctx.log(`QA 门 PR #${pr.number} 第 ${round} 轮真人 QA 开始`);
    const result = await evaluate(ctx, worktree, {
      run_tag: `qa-${pr.number}-r${round}`, task_id: intent.taskId, worktree, sprint_dir: intent.sprintDir,
      intent_ids: intent.intentIds, intent_sha256: intent.intentSha256, pr_number: pr.number, round,
      budget: { max_duration_s: Math.round(EVALUATE_TIMEOUT_MS / 1000) },
    }, signal);
    const qa = result?.status === 'completed' ? result.outputs?.qa : null;
    if (!qa) {
      s.bad = (s.bad ?? 0) + 1;
      const reason = result?.reason_code ?? 'evaluate_crashed';
      ctx.log(`QA 门 PR #${pr.number} 评估出错（连续 ${s.bad} 次）：${reason}`);
      if (result?.failure_class === 'fatal' || result?.failure_class === 'needs_human' || s.bad >= cfg.qaMaxBadStreak) {
        return await escalate(ctx, pr, s, intent.taskId, { type: 'qa_evaluator_broken', reason_code: reason });
      }
      writeState(cfg, pr.number, s);
      return undefined;
    }
    s.bad = 0;
    const fails = qa.failed.length + qa.blocking.length;
    await commitReport(worktree, pr, intent.sprintDir, result.outputs.qa_report_file, round, qa.verdict);
    const entry = { round, head: pr.headRefOid, verdict: qa.verdict, fails, report: `${intent.sprintDir}/${result.outputs.qa_report_file}`, cost_usd: qa.cost_usd, at: new Date().toISOString() };
    s.rounds.push(entry);
    ctx.log(`QA 门 PR #${pr.number} 第 ${round} 轮 ${qa.verdict}（失败 ${fails}）`);
    if (qa.verdict === 'PASS') {
      const merge = await run(cfg.ghBin, ['pr', 'merge', String(pr.number), '--auto', '--squash'], { cwd: cfg.repo, timeoutMs: GH_TIMEOUT_MS });
      entry.automerge = merge.code === 0;
      s.passed = true;
    } else {
      const last = s.rounds.slice(-STALL_ROUNDS);
      if (last.length === STALL_ROUNDS && last.every((r, i) => i === 0 || r.fails >= last[i - 1].fails)) {
        return await escalate(ctx, pr, s, intent.taskId, { type: 'qa_stalled', fails: last.map((r) => r.fails) });
      }
      entry.fix = await qaFix(ctx, pr, worktree, intent, result.outputs);
    }
    writeState(cfg, pr.number, s);
    await report(ctx, intent.taskId, s);
    return undefined;
  } catch (error) {
    s.bad = (s.bad ?? 0) + 1;
    ctx.log(`QA 门 PR #${pr.number} 出错：${error?.message || error}`);
    writeState(cfg, pr.number, s);
    return undefined;
  } finally {
    await removeWorktree(cfg, worktree, pr.headRefName);
    fs.rmSync(worktree, { recursive: true, force: true });
  }
}

/** 本轮至多验一个 PR；真跑了 QA（无论结果）返回 true，没有可验的返回 false。不抛错。 */
export async function runQaGate(ctx, signal) {
  const { cfg } = ctx;
  try {
    await stopMergedPreviews(ctx);
    const prs = await listOwnPrs(cfg);
    if (!prs) return false;
    for (const pr of prs) {
      const s = readState(cfg, pr.number);
      if (s.escalated || s.passed || s.rounds.at(-1)?.head === pr.headRefOid) continue;
      if ((await requiredState(cfg, pr.number)).state !== 'pass') continue;
      const p = await previewOf(pr.number, { api: cfg.previewApi });
      if (p.state !== 'active') {
        await ensurePreview(ctx, pr, s, p);
        continue;
      }
      await qaRound(ctx, pr, s, signal);
      return true;
    }
  } catch (error) {
    ctx.log(`QA 门出错：${error?.message || error}`);
  }
  return false;
}
