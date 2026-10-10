// run-once.mjs 的「cw PR 与 main 冲突」处理（金丝雀 4 #6232：QA+裁判通过后与 main 冲突 → GitHub 不跑 CI，
// ciFix 找不到失败检查、合并门等不到绿灯，runner 静默空转）。冲突时由 ciFix 合并 origin/main：
// 只追加的登记表程序按 union 合并；其余冲突派 claude 解决；核对只看 PR 自身相对 main 的改动。
import { describe, it, expect, beforeAll, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { git } from '../../__tests__/helpers/git.mjs';
import { startFakeBrain, makeSandbox, runnerEnv, runOnceProcess, readJsonLines } from './helpers/sandbox.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FAKE_GH_CI = path.join(HERE, 'fixtures/fake-gh-ci.mjs');
const FAKE_CLAUDE = path.join(HERE, 'fixtures/fake-claude-cifix.mjs');
const TASK = 'bd2b1556-8a14-4042-88dc-e7972ba52075';
const BRANCH = 'cp-10101755-cw-bd2b1556';
const SPRINT = 'sprints/10101755-cw-bd2b1556';
const ALLOW = 'packages/quality/smoke-allowlist.txt';

describe('runner 处理与 main 冲突的 cw PR', () => {
  let sb;
  let brain;
  let head;
  const files = {};

  beforeAll(() => {
    fs.chmodSync(FAKE_GH_CI, 0o755);
    fs.chmodSync(FAKE_CLAUDE, 0o755);
  });

  const write = (rel, text) => {
    fs.mkdirSync(path.dirname(path.join(sb.seed, rel)), { recursive: true });
    fs.writeFileSync(path.join(sb.seed, rel), text);
  };
  const commitAll = (msg) => {
    git(sb.seed, 'add', '.');
    git(sb.seed, 'commit', '-q', '-m', msg);
  };

  beforeEach(() => {
    sb = makeSandbox();
    write(ALLOW, 'a.sh\n');
    write('src/x.txt', 'base\n');
    write('src/b.test.mjs', "it('b', () => {\n  expect(1).toBe(1);\n});\n");
    commitAll('chore: base');
    git(sb.seed, 'push', '-q', 'origin', 'main');
    git(sb.seed, 'checkout', '-q', '-b', BRANCH);
    write(path.join(SPRINT, '01-intent.md'), `---\ntask_id: ${TASK}\nstep: intent\nupstream: []\n---\n# x\n\n### I-1\n验收\n`);
    write(ALLOW, 'a.sh\npr.sh\n');
    commitAll('feat: cw');
    git(sb.seed, 'push', '-q', 'origin', BRANCH);
    head = git(sb.seed, 'rev-parse', 'HEAD').trim();
    git(sb.clone, 'config', 'core.hooksPath', path.join(sb.root, 'no-hooks'));
    files.ghState = path.join(sb.root, 'gh-ci.json');
    files.prompt = path.join(sb.root, 'prompt.txt');
  });

  afterEach(async () => {
    if (brain) await brain.close();
    brain = null;
    sb.cleanup();
  });

  /** main 往前走：登记表追加一行（与 PR 同处追加 → 文本冲突）+ 别的 sprint 目录；code=true 时再改 src/x.txt。 */
  const advanceMain = ({ code = false } = {}) => {
    git(sb.seed, 'checkout', '-q', 'main');
    write(ALLOW, 'a.sh\nmain.sh\n');
    write('sprints/10100000-cw-deadbeef/01-intent.md', '# 别的 sprint\n');
    if (code) write('src/x.txt', 'main\n');
    commitAll('feat: main 前进');
    git(sb.seed, 'push', '-q', 'origin', 'main');
    git(sb.seed, 'checkout', '-q', BRANCH);
    if (code) {
      write('src/x.txt', 'pr\n');
      commitAll('feat: pr 改 x');
      git(sb.seed, 'push', '-q', 'origin', BRANCH);
      head = git(sb.seed, 'rev-parse', 'HEAD').trim();
    }
  };

  const ghState = () => ({ prs: [{ number: 77, headRefName: BRANCH, headRefOid: head, url: 'https://github.com/x/y/pull/77', isDraft: false, mergeable: 'CONFLICTING' }] });
  const go = async ({ mode = 'resolve' } = {}) => {
    fs.writeFileSync(files.ghState, JSON.stringify(ghState()));
    brain = await startFakeBrain({ tasks: [] });
    return runOnceProcess(runnerEnv(sb, brain.url, {
      CODING_WF_CIFIX: '1',
      CODING_WF_GH_BIN: FAKE_GH_CI,
      FAKE_GH_CI: files.ghState,
      CODING_WF_CLAUDE_BIN: FAKE_CLAUDE,
      FAKE_CIFIX_MODE: mode,
      FAKE_CIFIX_PROMPT: files.prompt,
    }));
  };
  const remoteHead = () => git(sb.origin, 'rev-parse', BRANCH).trim();
  const state = () => JSON.parse(fs.readFileSync(path.join(sb.logDir, 'cifix-77.json'), 'utf8'));
  const remoteFile = (rel) => git(sb.origin, 'show', `${BRANCH}:${rel}`);
  const seedQaPassed = () => {
    fs.mkdirSync(sb.logDir, { recursive: true });
    fs.writeFileSync(path.join(sb.logDir, 'qa-77.json'), JSON.stringify({ passed: true, approved: { head, round: 1 }, rounds: [{ round: 1, head, verdict: 'PASS', fails: 0, judge: { verdict: 'PASS' } }] }));
  };
  const qaState = () => JSON.parse(fs.readFileSync(path.join(sb.logDir, 'qa-77.json'), 'utf8'));

  it('只追加登记表冲突：程序合并 origin/main（登记表取并集），不派 claude、不算 main 带来的 sprints/；保留 QA 通过', async () => {
    advanceMain();
    seedQaPassed();
    const r = await go();
    expect(r.exitCode, r.stderr).toBe(0);
    expect(fs.existsSync(files.prompt)).toBe(false);
    expect(remoteHead()).not.toBe(head);
    expect(git(sb.origin, 'merge-base', '--is-ancestor', 'main', BRANCH)).toBe('');
    expect(remoteFile(ALLOW).split('\n').filter(Boolean).sort()).toEqual(['a.sh', 'main.sh', 'pr.sh']);
    expect(state().attempts).toMatchObject([{ kind: 'conflict', head, result: 'pushed' }]);
    expect(qaState().passed).toBe(true);
  });

  it('代码冲突：派 claude 解决并完成合并 → 推送；prompt 列出冲突文件；QA 已通过则撤销（新 head 重新 QA + 裁判）', async () => {
    advanceMain({ code: true });
    seedQaPassed();
    const r = await go({ mode: 'resolve' });
    expect(r.exitCode, r.stderr).toBe(0);
    const prompt = fs.readFileSync(files.prompt, 'utf8');
    expect(prompt).toContain('src/x.txt');
    expect(prompt).not.toContain(ALLOW);
    expect(git(sb.origin, 'merge-base', '--is-ancestor', 'main', BRANCH)).toBe('');
    expect(remoteFile('src/x.txt')).toBe('resolved\n');
    expect(state().attempts).toMatchObject([{ kind: 'conflict', head, result: 'pushed' }]);
    expect(qaState()).toMatchObject({ passed: false, revoked: [expect.objectContaining({ reason: 'conflict_fix_changed_code', files: ['src/x.txt'] })] });
    expect(readJsonLines(sb.ghLog)).toContainEqual(['pr', 'merge', '77', '--disable-auto']);
  });

  it('claude 没完成合并 → 不推送，记 merge_unfinished；同一 head 再冲突 → 升级 conflict_unresolved（P1）', async () => {
    advanceMain({ code: true });
    let r = await go({ mode: 'none' });
    expect(r.exitCode, r.stderr).toBe(0);
    expect(remoteHead()).toBe(head);
    expect(state().attempts).toMatchObject([{ kind: 'conflict', head, result: 'merge_unfinished' }]);
    await brain.close();
    brain = null;
    r = await go({ mode: 'resolve' });
    expect(r.exitCode, r.stderr).toBe(0);
    expect(r.stderr).toContain('[coding-ci][P1]');
    expect(state().escalated).toMatchObject({ type: 'ci_fix_exhausted', reason: 'conflict_unresolved', pr: 77 });
    expect(remoteHead()).toBe(head);
  });

  it('冲突修复不占 CI 修复次数：CI 修复已用完 2 次，冲突照样处理', async () => {
    advanceMain();
    fs.mkdirSync(sb.logDir, { recursive: true });
    fs.writeFileSync(path.join(sb.logDir, 'cifix-77.json'), JSON.stringify({ attempts: [{ head: 'a'.repeat(40), result: 'pushed' }, { head: 'b'.repeat(40), result: 'pushed' }] }));
    const r = await go();
    expect(r.exitCode, r.stderr).toBe(0);
    expect(state().escalated).toBeUndefined();
    expect(state().attempts.at(-1)).toMatchObject({ kind: 'conflict', result: 'pushed' });
  });
});
