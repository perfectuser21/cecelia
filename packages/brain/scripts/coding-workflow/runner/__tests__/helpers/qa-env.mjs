// QA 门 / 合并门用例共用的测试环境：临时 origin 上的 cw PR 分支（带 sprint 01/02 与一个代码文件）、假 gh、
// 假预览（同时扮演预览管理 API 与预览 Brain 的 /health）、假独立裁判、假 evaluate、假修复 claude、假 Brain。
// useQaEnv() 在当前 describe 里注册 beforeAll/beforeEach/afterEach，返回的对象字段每个用例刷新。
import { beforeAll, beforeEach, afterEach } from 'vitest';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { git } from '../../../__tests__/helpers/git.mjs';
import { FAKE_EXECUTOR, startFakeBrain, makeSandbox, runnerEnv, runOnceProcess, readJsonLines } from './sandbox.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const FAKE_GH_CI = path.join(HERE, '../fixtures/fake-gh-ci.mjs');
export const FAKE_EVALUATE = path.join(HERE, '../fixtures/fake-evaluate.mjs');
export const FAKE_CLAUDE = path.join(HERE, '../fixtures/fake-claude-cifix.mjs');
export const TASK = 'c954ebfd-469f-4006-a95f-b277fa6564f6';
export const BRANCH = 'cp-10091835-cw-c954ebfd';
export const SPRINT = 'sprints/10091835-cw-c954ebfd';
export const INTENT = `---\ntask_id: ${TASK}\nstep: intent\nupstream: []\n---\n# x\n\n### I-1\n验收\n`;
const JUDGE_ISSUE = (type) => ({ id: 'J-1', type, severity: '阻断', covers: ['I-1'], detail: `${type} 问题`, where: 'src/feature.js:1' });
const JUDGE_REPLY = {
  pass: { coverage: [{ intent: 'I-1', satisfied: true, evidence: 'T-1 真实输出' }], issues: [], summary: 'ok' },
  ...Object.fromEntries([['product', 'product'], ['qa_gap', 'qa_gap'], ['contract', 'contract_gap']].map(([mode, type]) => [mode, {
    coverage: [{ intent: 'I-1', satisfied: false, evidence: '见 J-1' }], issues: [JUDGE_ISSUE(type)], summary: 'no',
  }])),
};

/** 起一个 JSON 小服务：handler(req, raw, res) 返回要写的对象或自己 end。 */
async function serve(handler) {
  const server = http.createServer((req, res) => {
    let raw = '';
    req.on('data', (d) => { raw += d; });
    req.on('end', () => {
      res.setHeader('content-type', 'application/json');
      handler(req, raw, res);
    });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  return server;
}

/** onReady(E)：每个用例的环境就绪后回调（vitest 的多个 beforeEach 可能并行，别另写 beforeEach 去取 E 的字段）。 */
export function useQaEnv({ onReady } = {}) {
  const E = { files: {} };

  beforeAll(() => {
    for (const f of [FAKE_GH_CI, FAKE_EVALUATE, FAKE_CLAUDE, FAKE_EXECUTOR]) fs.chmodSync(f, 0o755);
  });

  beforeEach(async () => {
    const sb = makeSandbox();
    E.sb = sb;
    git(sb.seed, 'checkout', '-q', '-b', BRANCH);
    fs.mkdirSync(path.join(sb.seed, SPRINT), { recursive: true });
    fs.writeFileSync(path.join(sb.seed, SPRINT, '01-intent.md'), INTENT);
    fs.writeFileSync(path.join(sb.seed, SPRINT, '02-spec.md'), '### S-1\n\n## QA 场景\n\n### Q-1\n对应: I-1\n操作: x\n期望: y\n');
    fs.mkdirSync(path.join(sb.seed, 'src'), { recursive: true });
    fs.writeFileSync(path.join(sb.seed, 'src/feature.js'), 'export const MARKER_CODE = 1;\n');
    git(sb.seed, 'add', '.');
    git(sb.seed, 'commit', '-q', '-m', 'feat: cw');
    git(sb.seed, 'push', '-q', 'origin', BRANCH);
    E.head = git(sb.seed, 'rev-parse', 'HEAD').trim();
    git(sb.clone, 'config', 'core.hooksPath', path.join(sb.root, 'no-hooks'));
    Object.assign(E.files, { gh: path.join(sb.root, 'gh-ci.json'), qaLog: path.join(sb.root, 'qa.log'), prompt: path.join(sb.root, 'prompt.txt') });

    const preview = { status: { 77: { status: 'active', port: 0 } }, start: 200, calls: [] };
    preview.server = await serve((req, raw, res) => {
      preview.calls.push({ method: req.method, url: req.url, auth: req.headers.authorization ?? null, raw });
      // 预览 Brain 的 /health：git_sha 默认等于假 gh 里 PR 当前 head（已部署最新），preview.sha 可指定旧版本
      if (req.url === '/api/brain/health') {
        const ghState = JSON.parse(fs.readFileSync(E.files.gh, 'utf8'));
        return res.end(JSON.stringify({ status: 'healthy', git_sha: preview.sha ?? ghState.prs?.[0]?.headRefOid ?? null }));
      }
      const st = /\/api\/brain\/preview\/status\/(\d+)$/.exec(req.url);
      if (st) {
        const p = preview.status[st[1]];
        if (!p) { res.statusCode = 404; return res.end('{}'); }
        return res.end(JSON.stringify({ pr_number: Number(st[1]), ...p }));
      }
      if (req.url === '/api/brain/preview/start') { res.statusCode = preview.start; return res.end(JSON.stringify({ port: 5309, reason: 'disk' })); }
      if (/\/api\/brain\/preview\/stop\/\d+$/.test(req.url)) return res.end('{"ok":true}');
      res.statusCode = 404;
      return res.end('{}');
    });
    preview.api = `http://127.0.0.1:${preview.server.address().port}`;
    // 预览端口就是这个假服务自己
    preview.status[77].port = preview.server.address().port;
    E.preview = preview;

    // 假独立裁判（OpenAI 兼容 chat/completions）：按 judge.mode 回放
    const judge = { mode: 'pass', calls: [] };
    judge.server = await serve((req, raw, res) => {
      judge.calls.push({ url: req.url, auth: req.headers.authorization ?? null, body: JSON.parse(raw || '{}') });
      if (judge.mode === 'http500') { res.statusCode = 500; return res.end('boom'); }
      const content = judge.mode === 'garbage' ? '我觉得没问题' : JSON.stringify(JUDGE_REPLY[judge.mode]);
      return res.end(JSON.stringify({ choices: [{ message: { content } }], usage: { total_tokens: 1234 } }));
    });
    judge.api = `http://127.0.0.1:${judge.server.address().port}/v1`;
    E.judge = judge;
    onReady?.(E);
  });

  afterEach(async () => {
    await E.closeBrain();
    await new Promise((r) => E.preview.server.close(r));
    await new Promise((r) => E.judge.server.close(r));
    E.sb.cleanup();
  });

  E.closeBrain = async () => {
    if (E.brain) await E.brain.close();
    E.brain = null;
  };
  E.pr = (extra = {}) => ({ number: 77, headRefName: BRANCH, headRefOid: E.head, url: 'https://github.com/x/y/pull/77', isDraft: false, ...extra });
  E.green = (extra = {}) => ({ prs: [E.pr()], required: { 77: [{ name: 'ci-passed', bucket: 'pass' }] }, checks: { 77: [] }, ...extra });
  E.go = async (ghState, { mode = 'pass', extra = {}, tasks = [] } = {}) => {
    fs.writeFileSync(E.files.gh, JSON.stringify(ghState));
    E.brain = await startFakeBrain({ tasks });
    return runOnceProcess(runnerEnv(E.sb, E.brain.url, {
      CODING_WF_QA_GATE: '1',
      CODING_WF_GH_BIN: FAKE_GH_CI,
      FAKE_GH_CI: E.files.gh,
      CODING_WF_EVALUATE: FAKE_EVALUATE,
      FAKE_QA_MODE: mode,
      FAKE_QA_LOG: E.files.qaLog,
      CODING_WF_PREVIEW_API: E.preview.api,
      CODING_WF_PREVIEW_HOST: '127.0.0.1',
      DEPLOY_TOKEN: 'tok-1',
      CODING_WF_CLAUDE_BIN: FAKE_CLAUDE,
      FAKE_CIFIX_MODE: 'fix',
      FAKE_CIFIX_PROMPT: E.files.prompt,
      CODING_WF_JUDGE_API: E.judge.api,
      CODING_WF_JUDGE_MODEL: 'judge-m',
      CODING_WF_JUDGE_CREDS: path.join(E.sb.root, 'no-creds.env'),
      TOAPIS_API_KEY: 'jk',
      ...extra,
    }));
  };
  // 往 PR 分支追加一个文件并推送
  E.addToBranch = (rel, content) => {
    fs.mkdirSync(path.dirname(path.join(E.sb.seed, rel)), { recursive: true });
    fs.writeFileSync(path.join(E.sb.seed, rel), content);
    git(E.sb.seed, 'add', '.');
    git(E.sb.seed, 'commit', '-q', '-m', `docs: ${rel}`);
    git(E.sb.seed, 'push', '-q', 'origin', BRANCH);
  };
  E.remoteHead = () => git(E.sb.origin, 'rev-parse', BRANCH).trim();
  E.statePath = () => path.join(E.sb.logDir, 'qa-77.json');
  E.state = () => JSON.parse(fs.readFileSync(E.statePath(), 'utf8'));
  E.seedState = (s) => { fs.mkdirSync(E.sb.logDir, { recursive: true }); fs.writeFileSync(E.statePath(), JSON.stringify(s)); };
  E.qaCalls = () => readJsonLines(E.files.qaLog);
  E.ghCalls = () => readJsonLines(E.sb.ghLog);
  E.originLog = () => git(E.sb.origin, 'log', '--format=%s', BRANCH).trim().split('\n');
  E.brainResults = () => E.brain.patches.filter((p) => p.id === TASK).map((p) => p.body.result);
  return E;
}
