// 真实Git及受保护来源链；网络/模型仅本地CLI替身，不mock来源核验。
import { beforeEach, afterEach, it, expect, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { git } from '../../__tests__/helpers/git.mjs';
import { makeSandbox } from './helpers/sandbox.mjs';
import { withRecordProvenance, controllerIdentity, captureNativeExecution, sealStageEvidence,
  beginRecordRegistration, observeRecordRegistration, finalizeRecordRegistration } from '../../lib/record-provenance.mjs';
import { registerRecordSources, RECORD_SOURCE_MANIFEST as MANIFEST, RECORD_SOURCE_OWNER as OWNER } from '../../lib/record-sources.mjs';
import { verifySourceHead } from '../lib/source-provenance.mjs';
import { runCiFix } from '../lib/cifix.mjs';

const TASK = '088c3431-57ca-4f2a-8a50-14601518e2a2', SPRINT = 'sprints/10121524-cw-088c3431', BRANCH = 'cp-10121524-cw-088c3431';
const README = 'packages/brain/scripts/coding-workflow/runner/README.md';
let sb, cfg, context, before, main, base, messages;
const put = (rel, value) => { const p = path.join(sb.seed, rel);fs.mkdirSync(path.dirname(p), { recursive: true });fs.writeFileSync(p, value); };
const head = () => git(sb.seed, 'rev-parse', 'HEAD').trim();
const commit = label => { git(sb.seed, 'add', '.');git(sb.seed, 'commit', '-qm', label);return head(); };
const report = step => `---\ntask_id: ${TASK}\nstep: ${step}\nupstream: []\n---\nactual ${step} fixture\n`;
const rel = name => `${SPRINT}/${name}`;
const proof = sha => withRecordProvenance({ ...context, stage: 'publish' }, () => verifySourceHead(cfg, sb.seed, context, sha));

beforeEach(() => {
  sb = makeSandbox();messages = [];
  // 本地bare是真实读写对象，仅canonical身份查询沿用既有self来源fixture。
  const bin = path.join(sb.root, 'bin');fs.mkdirSync(bin);
  fs.writeFileSync(path.join(bin, 'git'), '#!/bin/sh\ncase "$*" in *" remote get-url origin") echo https://github.com/perfectuser21/cecelia.git; exit 0;; esac\nexec /usr/bin/git "$@"\n', { mode: 0o755 });
  vi.stubEnv('PATH', `${bin}:${process.env.PATH}`);vi.stubEnv('HOME', sb.root);
  vi.stubEnv('CODING_WF_PROVIDER', 'codex');vi.stubEnv('CODING_WF_CODEX_HOME', sb.root);vi.stubEnv('FAKE_GH_LOG', sb.ghLog);
  put(OWNER, '// fixture controller\n');put(README, '# existing manual\n');
  put('docs/retired.md', 'retired\n');put('docs/retained.md', 'retained\n');
  const rows = ['docs/retired.md', 'docs/retained.md'].map(p => ({ owner_path: OWNER, path: p, role: 'documentation' }));
  put(MANIFEST, JSON.stringify({ schema_version: 1, repo: 'perfectuser21/cecelia', relations: rows }, null, 2) + '\n');
  base = commit('fixture trusted base');git(sb.seed, 'push', '-q', 'origin', 'main');
  git(sb.seed, 'checkout', '-qb', BRANCH);put(README, '# existing manual\n\n## task addition\n');commit('fixture product');
  context = { root: path.join(sb.root, 'protected'), worktree: sb.seed, taskId: TASK, sprintDir: SPRINT, controller: controllerIdentity(import.meta.url) };
  const files = [];
  for (const [stage, name] of [['intent', '01-intent.md'], ['build', '03-build.md'], ['verify', '04-evidence.md']]) {
    put(rel(name), report(stage));files.push(rel(name));
    withRecordProvenance({ ...context, stage }, () => {
      if (stage !== 'intent') {
        const stdout = execFileSync(process.execPath, ['-e', `console.log(JSON.stringify({type:'thread.started',thread_id:'actual-fixture-child'}));console.log(JSON.stringify({type:'turn.completed'}));`], { encoding: 'utf8' });
        captureNativeExecution({ provider: 'codex', code: 0, stdout });
      }
      sealStageEvidence({ files: [rel(name)], result: { status: 'completed' }, producer: stage === 'intent' ? 'controller' : 'model' });
    });
  }
  const token = beginRecordRegistration({ ...context, stage: 'publish' }, files);
  observeRecordRegistration(token, registerRecordSources(sb.seed, { taskId: TASK, sprintDir: SPRINT, stage: 'publish' }, files));
  before = commit('fixture real registration');finalizeRecordRegistration(token);git(sb.seed, 'push', '-q', 'origin', BRANCH);
  git(sb.seed, 'checkout', '-q', 'main');
  put(MANIFEST, JSON.stringify({ schema_version: 1, repo: 'perfectuser21/cecelia', relations: rows.slice(1) }, null, 2) + '\n');
  fs.unlinkSync(path.join(sb.seed, 'docs/retired.md'));main = commit('fixture legitimate upstream retirement');
  git(sb.seed, 'push', '-q', 'origin', 'main');git(sb.seed, 'checkout', '-q', BRANCH);git(sb.clone, 'fetch', '-q', 'origin');
  cfg = { repo: sb.clone, repoSlug: 'perfectuser21/cecelia', repoKey: 'cecelia', logDir: sb.logDir, worktreeBase: sb.worktreeBase,
    skipNpmCi: true, ghBin: fileURLToPath(new URL('./fixtures/fake-gh-ci.mjs', import.meta.url)), ciFixTimeoutMs: 20000, ciFixMaxAttempts: 2 };
  const state = path.join(sb.root, 'gh.json');fs.writeFileSync(state, JSON.stringify({ prs: [{ number: 77, headRefName: BRANCH, headRefOid: before, url: 'https://github.com/perfectuser21/cecelia/pull/77', isDraft: false, mergeable: 'CONFLICTING' }] }));
  vi.stubEnv('FAKE_GH_CI', state);
  // 旧流程调用这个真实子进程；它合成语义正确的manifest并提交，旧guard仍误拒。
  const model = path.join(sb.root, 'model.mjs');
  fs.writeFileSync(model, `#!/usr/bin/env node\nimport fs from 'node:fs';import{execFileSync as x}from'node:child_process';fs.readFileSync(0,'utf8');fs.appendFileSync(${JSON.stringify(path.join(sb.root, 'model-called'))},'called\\n');const git=(...a)=>x('/usr/bin/git',a,{encoding:'utf8'});const file=${JSON.stringify(MANIFEST)},before=${JSON.stringify(before)},base=${JSON.stringify(base)};const a=JSON.parse(git('show',before+':'+file)),b=JSON.parse(git('show',base+':'+file)),m=JSON.parse(git('show','origin/main:'+file));const known=new Set(b.relations.map(r=>r.path));m.relations=[...a.relations.filter(r=>!known.has(r.path)),...m.relations];fs.writeFileSync(file,JSON.stringify(m,null,2)+'\\n');git('add',file);git('-c','user.name=fixture-model','-c','user.email=fixture@example.invalid','commit','--no-edit');console.log(JSON.stringify({type:'thread.started',thread_id:'fixture-conflict-model'}));console.log(JSON.stringify({type:'turn.completed'}));\n`, { mode: 0o755 });
  vi.stubEnv('CODING_WF_CODEX_BIN', model);
});
afterEach(() => { vi.unstubAllEnvs();sb?.cleanup(); });

it.each(['无文本冲突', '真实文本冲突'])('真实已登记任务遇上游合法manifest删除（%s）：控制器合并推送，不误拒protected_path且模型不提交manifest', async layout => {
  if (layout === '真实文本冲突') {
    git(sb.seed, 'checkout', '-q', 'main');
    put(MANIFEST, JSON.stringify(JSON.parse(fs.readFileSync(path.join(sb.seed, MANIFEST)))) + '\n');
    main = commit('fixture upstream manifest formatting');git(sb.seed, 'push', '-q', 'origin', 'main');git(sb.seed, 'checkout', '-q', BRANCH);
  }
  expect(proof(before).status).toBe('verified');expect(proof(before).records).toHaveLength(3);
  const ctx = { cfg, log: s => messages.push(s), brain: { patch: async () => ({ ok: true }), postSpans: async () => ({ ok: true }) } };
  await withRecordProvenance({ ...context, stage: 'publish' }, () => runCiFix(ctx));
  const state = JSON.parse(fs.readFileSync(path.join(sb.logDir, 'cifix-77.json')));
  expect(state.attempts.at(-1).result, messages.join('\n')).toBe('pushed');
  expect(fs.existsSync(path.join(sb.root, 'model-called'))).toBe(false);
  const merged = git(sb.origin, 'rev-parse', BRANCH).trim();expect(merged).not.toBe(before);
  expect(git(sb.origin, 'show', '-s', '--format=%P', merged).trim().split(' ')).toEqual([before, main]);
  git(sb.seed, 'fetch', '-q', 'origin');expect(proof(merged).status).toBe('verified');
  const rows = JSON.parse(git(sb.origin, 'show', `${merged}:${MANIFEST}`)).relations;
  expect(rows.map(r => r.path)).toEqual([rel('01-intent.md'), rel('03-build.md'), rel('04-evidence.md'), 'docs/retained.md']);
  expect(rows.some(r => r.path === 'docs/retired.md')).toBe(false);
  expect(git(sb.origin, 'show', `${merged}:${README}`)).toBe(git(sb.seed, 'show', `${before}:${README}`));
}, 30000);
