// publish 活动：把 sprint 目录的 md 链提交、推送，并开草稿 PR（该分支已有 PR 则复用）。
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { runActivity, validateBase, fail, childEnv, log } from '../lib/protocol.mjs';
import { intentHeading, prKindOf } from '../lib/pr-kind.mjs';
import { parseReview } from '../lib/review.mjs';
import { RUBRIC_DIMS } from '../lib/gan.mjs';
import { SPEC_FILE, uncoveredSection } from '../lib/spec-check.mjs';

const GH_AUTH_RE = /\bHTTP 401\b|authentication|auth login|missing required scope|bad credentials/i;
// 凭据提示会让无 tty 的子进程挂住；--literal-pathspecs 禁用 :/ 等 pathspec 魔法
const CHILD_ENV = { ...childEnv(), GIT_TERMINAL_PROMPT: '0' };
const GIT_PATHSPEC = ['--literal-pathspecs'];
// 与本机全局 pre-commit 钩子（~/.git-hooks/pre-commit）的分支名正则保持一致，否则 commit 会被钩子拒绝
const BRANCH_RE = /^cp-[0-9]{8,10}-[a-z0-9][a-z0-9_-]*$/;
const STDERR_TAIL_LINES = 20;
const BUILD_FILE = '03-build.md';
const BASE_REF = process.env.CODING_WF_BASE_REF || 'origin/main';
const BRAIN_SRC_RE = /^packages\/brain\/src\//;
const FRAGMENT_RE = /^changes\/(?!README\.md$).+\.md$/i;

/** 运行子进程（不经 shell），输出转写到本进程 stderr；返回 { code, stdout, stderr, output }。 */
function runCmd(bin, args, cwd) {
  return new Promise((resolve) => {
    let stdout = '';
    let stderr = '';
    let output = '';
    let child;
    try {
      child = spawn(bin, args, { cwd, env: CHILD_ENV, stdio: ['ignore', 'pipe', 'pipe'] });
    } catch (error) {
      const message = String(error?.message || error);
      resolve({ code: null, stdout: '', stderr: message, output: message });
      return;
    }
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk) => {
      stdout += chunk;
      output += chunk;
      process.stderr.write(chunk);
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk;
      output += chunk;
      process.stderr.write(chunk);
    });
    child.on('error', (error) => {
      log(`[publish] 启动 ${bin} 失败: ${error?.message || error}`);
      resolve({ code: null, stdout, stderr: `${stderr}\n${error?.message || error}`, output: `${output}\n${error?.message || error}` });
    });
    child.on('close', (code) => resolve({ code, stdout, stderr, output }));
  });
}

const lastLine = (text) => text.trim().split('\n').filter(Boolean).pop() || '';

/**
 * PR/提交标题：链里有 03-build.md（带代码提交）时用 feat(workflow): <01-intent 标题>，
 * 标题以 bug/修复/fix 开头则用 fix(workflow):；只有文档链时保持 docs(sprint): <id> md 链 …。
 */
function prTitle(chainFiles, dir, taskId) {
  if (!chainFiles.includes(BUILD_FILE)) {
    return `docs(sprint): ${taskId.slice(0, 8)} md 链 ${chainFiles.map((f) => String(f).replace(/\.md$/, '')).join(' → ')}`;
  }
  const heading = intentHeading(dir) || `coding workflow ${taskId.slice(0, 8)}`;
  return `${prKindOf(heading)}(workflow): ${heading}`;
}

/**
 * 版本碎片（changes/README.md：PR 不碰版本五件套，改 packages/brain/src 的 PR 带 changes/<分支>.md，
 * 合并后 auto-version 统一 bump）：改了 Brain 源码且分支上还没有碎片 → 写一份；返回相对路径或 null。
 */
async function ensureVersionFragment({ worktree, branch, dir, taskId, sprintRel }) {
  const diff = await runCmd('git', ['-C', worktree, 'diff', '--name-only', `${BASE_REF}...HEAD`]);
  if (diff.code !== 0) {
    log(`[publish] 取相对 ${BASE_REF} 的改动失败，不写版本碎片`);
    return null;
  }
  const files = diff.stdout.split('\n').filter(Boolean);
  if (!files.some((f) => BRAIN_SRC_RE.test(f)) || files.some((f) => FRAGMENT_RE.test(f))) return null;
  const rel = `changes/${branch}.md`;
  const heading = intentHeading(dir) || `coding workflow ${taskId.slice(0, 8)}`;
  fs.mkdirSync(path.join(worktree, 'changes'), { recursive: true });
  fs.writeFileSync(path.join(worktree, rel), `## Brain {VERSION} — ${heading}\n\n- coding workflow 任务 ${taskId.slice(0, 8)}：需求、合同与验收记录见 ${sprintRel}/。\n`);
  return rel;
}

/**
 * PR 正文的验收摘要：verify 通过后上下文里有 evidence_file 与 verified_ids（全部 PASS 才会走到 publish），
 * 逐条列出 I-n 的 verdict；没有则返回空串（只有 01/02 的旧链）。
 */
function acceptanceSummary({ evidence_file: evidenceFile, verified_ids: ids }, sprintRel) {
  if (typeof evidenceFile !== 'string' || !Array.isArray(ids) || ids.length === 0) return '';
  const lines = ids.filter((id) => typeof id === 'string').map((id) => `- ${id}：PASS`);
  return [`## 验收摘要（${sprintRel}/${evidenceFile}）`, ...lines].join('\n');
}

/**
 * PR 正文的合同对抗小节：上下文有 review_file 时写轮数、结论与走势（gan 摘要）、最终评分、末轮每条问题（严重度 + 首行）；
 * 强制通过时醒目标出仍开着的问题。没有 review_file 或文件读不到返回空串（不出现小节，也不让 publish 失败）。
 */
function reviewSummary({ review_file: reviewFile, review_rounds: rounds, gan }, dir, sprintRel) {
  if (typeof reviewFile !== 'string' || reviewFile === '') return '';
  let text;
  try {
    text = fs.readFileSync(path.join(dir, reviewFile), 'utf8');
  } catch {
    return '';
  }
  const { scores, issues } = parseReview(text);
  const g = gan && typeof gan === 'object' ? gan : {};
  const scoreText = RUBRIC_DIMS.filter((d) => d in scores).map((d) => `${d} ${scores[d]}`).join(' / ');
  const lines = [
    `## 合同对抗（${sprintRel}/${reviewFile}）`,
    `- 轮数：${Number.isInteger(rounds) && rounds > 0 ? rounds : '未知'}`,
    `- 结论：${g.verdict ?? '未知'}（走势 ${g.trend ?? '未知'}，花费 $${g.cost_usd ?? '未知'}）`,
  ];
  if (scoreText) lines.push(`- 最终评分：${scoreText}`);
  if (g.verdict === 'FORCED') {
    const open = (g.open_issues ?? []).map((i) => `${i.id}［${i.severity}］`).join('、') || '无';
    lines.push(`- ⚠️ 强制通过（走势 ${g.trend}），仍开着：${open}`);
  }
  for (const { id, severity, targets, body } of issues) {
    lines.push(`- ${id}［${severity || '未标'}］（针对 ${targets.join('、')}）：${body.split('\n')[0]}`);
  }
  return lines.join('\n');
}

/** 审计 #10：02 的「未覆盖真实链路」原样转呈 PR 正文；读不到或没有这一段返回空串。 */
function uncoveredSummary(dir, sprintRel) {
  let text;
  try {
    text = fs.readFileSync(path.join(dir, SPEC_FILE), 'utf8');
  } catch {
    return '';
  }
  const body = uncoveredSection(text);
  return body ? `## 未覆盖真实链路（${sprintRel}/${SPEC_FILE}）\n${body}` : '';
}

await runActivity(async (input) => {
  const { worktree, sprint_dir: sprintDir, chain_files: chainFiles } = input;
  const { dir } = validateBase(input);
  const taskId = input.task_id;
  if (!Array.isArray(chainFiles) || chainFiles.length === 0) return fail('fatal', 'chain_files_missing');

  const branchRes = await runCmd('git', ['-C', worktree, 'rev-parse', '--abbrev-ref', 'HEAD']);
  const branch = branchRes.stdout.trim();
  if (branchRes.code !== 0 || !BRANCH_RE.test(branch)) return fail('fatal', 'branch_invalid');

  const title = prTitle(chainFiles, dir, taskId);
  const sprintRel = sprintDir.replace(/[\\/]+$/, '');

  const fragment = await ensureVersionFragment({ worktree, branch, dir, taskId, sprintRel });
  const paths = [sprintRel, ...(fragment ? [fragment] : [])];
  const add = await runCmd('git', [...GIT_PATHSPEC, '-C', worktree, 'add', '--', ...paths]);
  if (add.code !== 0) return fail('fatal', 'git_add_failed');

  // diff --cached --quiet：有暂存改动退出 1，无改动退出 0
  const staged = await runCmd('git', [...GIT_PATHSPEC, '-C', worktree, 'diff', '--cached', '--quiet', '--', ...paths]);
  if (staged.code === 1) {
    const commit = await runCmd('git', [...GIT_PATHSPEC, '-C', worktree, 'commit', '-m', title, '--', ...paths]);
    if (commit.code !== 0) {
      const stderrTail = commit.stderr.trim().split('\n').slice(-STDERR_TAIL_LINES);
      return fail('fatal', 'git_commit_failed', { evidence: [{ stderr_tail: stderrTail }] });
    }
  } else if (staged.code !== 0) {
    return fail('fatal', 'git_diff_failed');
  }

  const push = await runCmd('git', ['-C', worktree, 'push', '-u', 'origin', branch]);
  if (push.code !== 0) return fail('retryable', 'push_failed');

  const gh = process.env.CODING_WF_GH_BIN || 'gh';
  const ghFail = (res) => (GH_AUTH_RE.test(res.output) ? fail('needs_human', 'gh_auth') : fail('retryable', 'gh_failed'));

  const list = await runCmd(gh, ['pr', 'list', '--head', branch, '--json', 'url', '-q', '.[0].url'], worktree);
  if (list.code !== 0) return ghFail(list);
  let prUrl = lastLine(list.stdout);

  if (!prUrl) {
    const body = [
      chainFiles.map((f) => `- ${sprintRel}/${f}`).join('\n'),
      reviewSummary(input, dir, sprintRel),
      uncoveredSummary(dir, sprintRel),
      acceptanceSummary(input, sprintRel),
    ]
      .filter(Boolean)
      .join('\n\n');
    const create = await runCmd(
      gh,
      ['pr', 'create', '--draft', '--head', branch, '--title', title, '--body', body],
      worktree,
    );
    if (create.code !== 0) return ghFail(create);
    prUrl = lastLine(create.stdout);
    if (!prUrl) return fail('retryable', 'gh_failed');
  }

  return {
    status: 'completed',
    outputs: { pr_url: prUrl, branch },
    evidence: [`PR ${prUrl}（分支 ${branch}）`],
  };
});
