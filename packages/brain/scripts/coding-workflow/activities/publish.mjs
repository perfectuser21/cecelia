// publish 活动：把 sprint 目录的 md 链提交、推送，并开草稿 PR（该分支已有 PR 则复用）。
import { spawn } from 'node:child_process';
import { runActivity, validateBase, fail, childEnv, log } from '../lib/protocol.mjs';

const GH_AUTH_RE = /\bHTTP 401\b|authentication|auth login|missing required scope|bad credentials/i;
// 凭据提示会让无 tty 的子进程挂住；--literal-pathspecs 禁用 :/ 等 pathspec 魔法
const CHILD_ENV = { ...childEnv(), GIT_TERMINAL_PROMPT: '0' };
const GIT_PATHSPEC = ['--literal-pathspecs'];

/** 运行子进程（不经 shell），输出转写到本进程 stderr；返回 { code, stdout, output }。 */
function runCmd(bin, args, cwd) {
  return new Promise((resolve) => {
    let stdout = '';
    let output = '';
    let child;
    try {
      child = spawn(bin, args, { cwd, env: CHILD_ENV, stdio: ['ignore', 'pipe', 'pipe'] });
    } catch (error) {
      resolve({ code: null, stdout: '', output: String(error?.message || error) });
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
      output += chunk;
      process.stderr.write(chunk);
    });
    child.on('error', (error) => {
      log(`[publish] 启动 ${bin} 失败: ${error?.message || error}`);
      resolve({ code: null, stdout, output: `${output}\n${error?.message || error}` });
    });
    child.on('close', (code) => resolve({ code, stdout, output }));
  });
}

const lastLine = (text) => text.trim().split('\n').filter(Boolean).pop() || '';

await runActivity(async (input) => {
  const { worktree, sprint_dir: sprintDir, chain_files: chainFiles } = input;
  validateBase(input);
  const taskId = input.task_id;
  if (!Array.isArray(chainFiles) || chainFiles.length === 0) return fail('fatal', 'chain_files_missing');

  const branchRes = await runCmd('git', ['-C', worktree, 'rev-parse', '--abbrev-ref', 'HEAD']);
  const branch = branchRes.stdout.trim();
  if (branchRes.code !== 0 || !branch.startsWith('cp-')) return fail('fatal', 'branch_invalid');

  const title = `docs(sprint): ${taskId.slice(0, 8)} md 链 01-intent → 02-spec`;
  const sprintRel = sprintDir.replace(/[\\/]+$/, '');

  const add = await runCmd('git', [...GIT_PATHSPEC, '-C', worktree, 'add', '--', sprintRel]);
  if (add.code !== 0) return fail('fatal', 'git_add_failed');

  // diff --cached --quiet：有暂存改动退出 1，无改动退出 0
  const staged = await runCmd('git', [...GIT_PATHSPEC, '-C', worktree, 'diff', '--cached', '--quiet', '--', sprintRel]);
  if (staged.code === 1) {
    const commit = await runCmd('git', [...GIT_PATHSPEC, '-C', worktree, 'commit', '-m', title, '--', sprintRel]);
    if (commit.code !== 0) return fail('fatal', 'git_commit_failed');
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
    const body = chainFiles.map((f) => `- ${sprintRel}/${f}`).join('\n');
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
