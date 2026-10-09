// 真实 CI 时序回放（决策 a1fdbc51 第③步）：按 PR #6139 首个代码 head 的真实必需检查登记时刻，逐轮回放 runner。
// 断言：必需检查没有全部登记且全绿之前，QA 一次都不开；全部登记且有红 → 走 CI 修复。数据见 fixtures/real-timing-6139.json。
import { describe, it, expect, beforeAll, beforeEach, afterEach } from 'vitest';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { git } from '../../__tests__/helpers/git.mjs';
import { startFakeBrain, makeSandbox, runnerEnv, runOnceProcess, readJsonLines } from './helpers/sandbox.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const TIMING = JSON.parse(fs.readFileSync(path.join(HERE, 'fixtures/real-timing-6139.json'), 'utf8'));
const FAKE_GH_CI = path.join(HERE, 'fixtures/fake-gh-ci.mjs');
const FAKE_EVALUATE = path.join(HERE, 'fixtures/fake-evaluate.mjs');
const FAKE_CLAUDE = path.join(HERE, 'fixtures/fake-claude-cifix.mjs');
const TASK = '4ac5fa39-521e-48b8-8b1a-ae1b79bcba2d';
const BRANCH = 'cp-10092117-cw-4ac5fa39';
const SPRINT = 'sprints/10092117-cw-4ac5fa39';

/** 某一时刻 `gh pr checks --required` 能看到的行：已开始的才登记，已结束的给结论。 */
function requiredAt(at) {
  const t = Date.parse(at);
  return Object.entries(TIMING.checks)
    .filter(([, c]) => Date.parse(c.started_at) <= t)
    .map(([name, c]) => ({ name, bucket: Date.parse(c.completed_at) > t ? 'pending' : c.conclusion === 'success' ? 'pass' : 'fail' }));
}

describe('真实 CI 时序回放（PR #6139）', () => {
  let sb;
  let preview;
  let head;
  const files = {};

  beforeAll(() => {
    for (const f of [FAKE_GH_CI, FAKE_EVALUATE, FAKE_CLAUDE]) fs.chmodSync(f, 0o755);
  });

  beforeEach(async () => {
    sb = makeSandbox();
    git(sb.seed, 'checkout', '-q', '-b', BRANCH);
    fs.mkdirSync(path.join(sb.seed, SPRINT), { recursive: true });
    fs.writeFileSync(path.join(sb.seed, SPRINT, '01-intent.md'), `---\ntask_id: ${TASK}\nstep: intent\nupstream: []\n---\n# x\n\n### I-1\n验收\n`);
    fs.writeFileSync(path.join(sb.seed, SPRINT, '02-spec.md'), '### S-1\n\n## QA 场景\n\n### Q-1\n对应: I-1\n操作: x\n期望: y\n');
    git(sb.seed, 'add', '.');
    git(sb.seed, 'commit', '-q', '-m', 'fix: cw');
    git(sb.seed, 'push', '-q', 'origin', BRANCH);
    head = git(sb.seed, 'rev-parse', 'HEAD').trim();
    git(sb.clone, 'config', 'core.hooksPath', path.join(sb.root, 'no-hooks'));
    Object.assign(files, { gh: path.join(sb.root, 'gh.json'), qaLog: path.join(sb.root, 'qa.log'), prompt: path.join(sb.root, 'prompt.txt') });
    // 预览环境一直 active：QA 门若误判 CI 绿，就一定会真的开 QA（不让预览不可用掩盖问题）
    preview = http.createServer((req, res) => {
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ pr_number: 6139, status: 'active', port: 5301 }));
    });
    await new Promise((r) => preview.listen(0, '127.0.0.1', r));
  });

  afterEach(async () => {
    await new Promise((r) => preview.close(r));
    sb.cleanup();
  });

  it('逐轮回放：未全部登记全绿时不开 QA；全部登记且 ci-passed 红 → CI 修复', async () => {
    for (const tick of TIMING.ticks) {
      fs.rmSync(files.prompt, { force: true });
      fs.writeFileSync(files.gh, JSON.stringify({
        prs: [{ number: 6139, headRefName: BRANCH, headRefOid: head, url: 'https://github.com/x/y/pull/6139', isDraft: false }],
        required: { 6139: requiredAt(tick.at) },
        requiredContexts: TIMING.required_contexts,
        checks: { 6139: [] },
      }));
      const brain = await startFakeBrain({ tasks: [] });
      const r = await runOnceProcess(runnerEnv(sb, brain.url, {
        CODING_WF_QA_GATE: '1', CODING_WF_CIFIX: '1', CODING_WF_GH_BIN: FAKE_GH_CI, FAKE_GH_CI: files.gh,
        CODING_WF_EVALUATE: FAKE_EVALUATE, FAKE_QA_LOG: files.qaLog, CODING_WF_PREVIEW_API: `http://127.0.0.1:${preview.address().port}`,
        CODING_WF_CLAUDE_BIN: FAKE_CLAUDE, FAKE_CIFIX_MODE: 'none', FAKE_CIFIX_PROMPT: files.prompt, CODING_WF_JUDGE: '0',
      }));
      await brain.close();
      expect(r.exitCode, `${tick.at} ${tick.note}\n${r.stderr}`).toBe(0);
      expect(readJsonLines(files.qaLog), `${tick.at} ${tick.note}：不该开 QA`).toEqual([]);
      expect(fs.existsSync(files.prompt), `${tick.at} ${tick.note}：CI 修复`).toBe(tick.expect === 'ci_fix');
    }
  });
});
