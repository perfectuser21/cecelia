// publish 活动：把 sprint 目录的 md 链提交、推送，并开草稿 PR（该分支已有 PR 则复用）。
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { runActivity, validateBase, fail, childEnv, log } from '../lib/protocol.mjs';
import { parseFrontmatter } from '../lib/md-chain.mjs';

const GH_AUTH_RE = /\bHTTP 401\b|authentication|auth login|missing required scope|bad credentials/i;
// 凭据提示会让无 tty 的子进程挂住；--literal-pathspecs 禁用 :/ 等 pathspec 魔法
const CHILD_ENV = { ...childEnv(), GIT_TERMINAL_PROMPT: '0' };
const GIT_PATHSPEC = ['--literal-pathspecs'];
// 与本机全局 pre-commit 钩子（~/.git-hooks/pre-commit）的分支名正则保持一致，否则 commit 会被钩子拒绝
const BRANCH_RE = /^cp-[0-9]{8,10}-[a-z0-9][a-z0-9_-]*$/;
const STDERR_TAIL_LINES = 20;
const BUILD_FILE = '03-build.md';
const FIX_RE = /^(?:修复|(?:bug|fix)\b)/i;

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

/** 01-intent.md 的第一个 `# 标题`；文件或标题不存在返回 ''。 */
function intentHeading(dir) {
  let text;
  try {
    text = fs.readFileSync(path.join(dir, '01-intent.md'), 'utf8');
  } catch {
    return '';
  }
  const body = parseFrontmatter(text)?.body ?? text;
  return (/^# (.+)$/m.exec(body)?.[1] ?? '').trim();
}

/**
 * PR/提交标题：链里有 03-build.md（带代码提交）时用 feat(workflow): <01-intent 标题>，
 * 标题以 bug/修复/fix 开头则用 fix(workflow):；只有文档链时保持 docs(sprint): <id> md 链 …。
 */
function prTitle(chainFiles, dir, taskId) {
  if (!chainFiles.includes(BUILD_FILE)) {
    return `docs(sprint): ${taskId.slice(0, 8)} md 链 ${chainFiles.map((f) => String(f).replace(/\.md$/, '')).join(' → ')}`;
  }
  const heading = intentHeading(dir) || `coding workflow ${taskId.slice(0, 8)}`;
  return `${FIX_RE.test(heading) ? 'fix' : 'feat'}(workflow): ${heading}`;
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

  const add = await runCmd('git', [...GIT_PATHSPEC, '-C', worktree, 'add', '--', sprintRel]);
  if (add.code !== 0) return fail('fatal', 'git_add_failed');

  // diff --cached --quiet：有暂存改动退出 1，无改动退出 0
  const staged = await runCmd('git', [...GIT_PATHSPEC, '-C', worktree, 'diff', '--cached', '--quiet', '--', sprintRel]);
  if (staged.code === 1) {
    const commit = await runCmd('git', [...GIT_PATHSPEC, '-C', worktree, 'commit', '-m', title, '--', sprintRel]);
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
    const body = [chainFiles.map((f) => `- ${sprintRel}/${f}`).join('\n'), acceptanceSummary(input, sprintRel)]
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
