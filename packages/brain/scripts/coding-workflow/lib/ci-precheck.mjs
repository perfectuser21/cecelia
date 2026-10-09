// CI 门禁本地预检（审计 P1 #4，对应旧 harness「CI 门禁三件套前置进 generator 验收」）：推上 GitHub 之前，
// 在 worktree 里跑 ci-passed 依赖的、能本地离线复现的规矩类门禁，免得推上去再被 CI 打红、多烧一轮修复。
// 不在这里跑：版本碎片（publish 保证）、落后 main（runner update-branch）、要数据库/联网的（dod-behavior-dynamic、brain-diff-coverage）。
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { childEnv } from './protocol.mjs';

export { prKindOf } from './pr-kind.mjs';

export const PR_SIZE_LIMIT = 3000;
const BASE = 'origin/main';
const OUTPUT_TAIL = 3000;
const CHECK_TIMEOUT_MS = 5 * 60 * 1000;

const lint = (name) => ({ name, cmd: ['bash', `.github/workflows/scripts/${name}.sh`, BASE] });

/** ci.yml 里 ci-passed 依赖、能本地离线复现的门禁；feature PR（publish 标题为 feat）传 PR_LABELS=feature。 */
export function defaultChecks({ branch, feature }) {
  return [
    lint('lint-test-pairing'),
    { ...lint('lint-feature-has-smoke'), env: { PR_LABELS: feature ? 'feature' : '' } },
    lint('lint-tdd-commit-order'),
    lint('lint-test-quality'),
    lint('lint-no-mock-only-test'),
    lint('lint-no-fake-test'),
    lint('lint-gp-anchor-artifact'),
    { name: 'branch-naming', cmd: ['bash', 'scripts/ci/check-branch-naming.sh', branch] },
    { name: 'registry-lint', cmd: ['node', 'scripts/registry-lint.mjs'] },
    { name: 'lint-migration-unique-version', cmd: ['node', '.github/workflows/scripts/lint-migration-unique-version.cjs'] },
    { name: 'pr-size-check', builtin: 'pr-size' },
  ];
}

function exec(cmd, args, { cwd, env, timeoutMs = CHECK_TIMEOUT_MS }) {
  return new Promise((resolve) => {
    let output = '';
    const child = spawn(cmd, args, { cwd, env, stdio: ['ignore', 'pipe', 'pipe'] });
    const timer = setTimeout(() => child.kill('SIGKILL'), timeoutMs);
    child.stdout.on('data', (d) => { output += d; });
    child.stderr.on('data', (d) => { output += d; });
    child.on('error', (error) => {
      clearTimeout(timer);
      resolve({ code: null, output: `${output}\n${error.message}` });
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ code, output });
    });
  });
}

/** 同 CI 的 pr-size-check：相对 base 新增行数超过上限失败（sprint md 链也算）；取不到 base 跳过。 */
async function prSize(worktree) {
  const r = await exec('git', ['diff', '--numstat', `${BASE}...HEAD`], { cwd: worktree, env: childEnv() });
  if (r.code !== 0) return { ok: true, skipped: true, output_tail: `取不到 ${BASE}，跳过` };
  const added = r.output.split('\n').reduce((sum, line) => sum + (Number(line.split('\t')[0]) || 0), 0);
  return added > PR_SIZE_LIMIT
    ? { ok: false, output_tail: `相对 ${BASE} 新增 ${added} 行，超过上限 ${PR_SIZE_LIMIT}（sprint md 链也计入），请拆小或精简` }
    : { ok: true, output_tail: `新增 ${added} 行` };
}

/** 依次跑门禁 → [{ name, ok, skipped?, output_tail }]。脚本文件不存在的项跳过（ok + skipped）。 */
export async function runPrechecks(worktree, { checks, env = {} }) {
  const results = [];
  for (const check of checks) {
    if (check.builtin === 'pr-size') {
      results.push({ name: check.name, ...(await prSize(worktree)) });
      continue;
    }
    const [cmd, ...args] = check.cmd;
    const script = ['bash', 'node'].includes(cmd) && args[0] && !args[0].startsWith('-') ? args[0] : null;
    if (script && !fs.existsSync(path.join(worktree, script))) {
      results.push({ name: check.name, ok: true, skipped: true, output_tail: `${script} 不存在，跳过` });
      continue;
    }
    const r = await exec(cmd, args, { cwd: worktree, env: { ...childEnv(), ...env, ...(check.env ?? {}) } });
    results.push({ name: check.name, ok: r.code === 0, output_tail: r.output.slice(-OUTPUT_TAIL) });
  }
  return results;
}
