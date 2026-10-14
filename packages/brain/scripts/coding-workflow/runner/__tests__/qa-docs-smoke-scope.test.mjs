import { beforeEach, afterEach, it, expect } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { execFileSync } from 'node:child_process';
import { solidifyQa } from '../lib/qa-solidify.mjs';

const TASK = '3a27ca36-7be9-4efc-a27f-18361dae6557';
const SPRINT = 'sprints/10141904-cw-3a27ca36';
const BRANCH = 'cp-10141904-cw-3a27ca36';
const SMOKE = 'packages/brain/scripts/smoke/cw-3a27ca36-qa-smoke.sh';
const ALLOW = 'packages/quality/smoke-allowlist.txt';
let root, server, url, calls;
const git = (...args) => execFileSync('git', ['-C', root, ...args], { encoding: 'utf8' }).trim();
const write = (file, text) => { fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true }); fs.writeFileSync(path.join(root, file), text); };
const commit = () => { git('add', '.'); git('-c', 'core.hooksPath=/dev/null', 'commit', '-qm', 'fixture change'); };

beforeEach(async () => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'qa-docs-smoke-'));
  git('init', '-q', '-b', 'main'); git('config', 'user.name', 'fixture'); git('config', 'user.email', 'fixture@example.invalid');
  write('README.md', 'old documentation\n'); write('app.js', 'export default 1;\n');
  write('packages/brain/src/routes/example.js', 'export default 1;\n');
  write(ALLOW, '# existing registrations\n'); commit(); git('update-ref', 'refs/remotes/origin/main', 'HEAD');
  calls = 0; server = http.createServer((req, res) => { calls++; res.setHeader('content-type', 'application/json'); res.end('{"status":"ok"}'); });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve)); url = `http://127.0.0.1:${server.address().port}`;
});
afterEach(async () => { await new Promise(resolve => server.close(resolve)); fs.rmSync(root, { recursive: true, force: true }); });

async function solidify({ broken = false } = {}) {
  // 真正调用隔离 HTTP health，报告命令在固化前由原 preflight 再真跑；不 mock Git/网络/固化器。
  expect(await (await fetch(url + '/api/brain/health')).json()).toEqual({ status: 'ok' });
  const command = `curl -fsS ${url}/api/brain/health | grep -q '${broken ? 'missing-value' : '"status":"ok"'}'`;
  write(`${SPRINT}/05-qa-report-r2.md`, `---\ntask_id: ${TASK}\nstep: evaluate\nupstream: ["02-spec.md#Q-1"]\n---\n### T-1\n对应: Q-1\nverdict: PASS\n\`\`\`command\n${command}\n\`\`\`\n\`\`\`output\n\n\`\`\`\n`);
  write(`${SPRINT}/06-judge-r2.md`, 'verdict: PASS\n');
  const state = {};
  const changed = await solidifyQa({ cfg: {}, log() {} }, { number: 6433, headRefName: BRANCH }, state, 2, root, { taskId: TASK, sprintDir: SPRINT }, '05-qa-report-r2.md', url);
  return { state, changed };
}

it('真实 docs-only + health PASS：不写 smoke/allowlist，不再预跑，记录明确原因', async () => {
  write('README.md', 'updated documentation\n'); commit();
  const before = fs.readFileSync(path.join(root, ALLOW), 'utf8');
  const { state, changed } = await solidify();
  expect(changed).toEqual([]); expect(fs.existsSync(path.join(root, SMOKE))).toBe(false);
  expect(fs.readFileSync(path.join(root, ALLOW), 'utf8')).toBe(before);
  expect(calls).toBe(1); expect(state.smoke_note).toContain('纯 Markdown 文档');
  expect(state.smoke).toBeUndefined(); expect(state.smoke_missing).toBeUndefined();
});

it('暂存和未暂存的普通 Markdown 记录仍可证明只改文档', async () => {
  write('README.md', 'updated\n'); commit(); write('README.md', 'staged\n'); git('add', 'README.md'); write('README.md', 'unstaged\n');
  const { state, changed } = await solidify(); expect(changed).toEqual([]); expect(state.smoke_note).toContain('纯 Markdown 文档');
});

it('保留同任务旧 QA PNG/CJS 和新未提交记录，产品仅 README 时仍不生成 smoke', async () => {
  write('README.md', 'updated\n');
  write(`${SPRINT}/qa-r1/q-5-preview.png`, 'historical screenshot');
  write(`${SPRINT}/qa-r1/qa-playwright.cjs`, 'historical browser script'); commit();
  write(`${SPRINT}/qa-r2/receipt.json`, '{}');
  const { state, changed } = await solidify();
  expect(changed).toEqual([]); expect(calls).toBe(1); expect(state.smoke_note).toContain('纯 Markdown 文档');
  expect(fs.readFileSync(path.join(root, `${SPRINT}/qa-r1/qa-playwright.cjs`), 'utf8')).toBe('historical browser script');
});

it.each(['api', 'code', 'mixed', 'unknown-base', 'empty', 'untracked-code', 'staged-code', 'unstaged-code', 'reverted-code', 'staged-reverted-code', 'code-renamed-md', 'other-sprint-image', 'non-record-json', 'sprint-source', 'records-only', 'symlink-md', 'executable-md'])(
  '%s 不能按 docs-only 豁免，真实 API 命令仍固化', async kind => {
    if (!['empty', 'records-only'].includes(kind)) { write('README.md', 'updated\n'); commit(); }
    if (['api', 'mixed'].includes(kind)) { write('packages/brain/src/routes/example.js', 'export default 2;\n'); commit(); }
    if (kind === 'code') { write('app.js', 'export default 2;\n'); commit(); }
    if (kind === 'unknown-base') git('update-ref', '-d', 'refs/remotes/origin/main');
    if (kind === 'untracked-code') write('new.js', 'console.log(1)\n');
    if (kind === 'staged-code') { write('app.js', 'export default 2;\n'); git('add', 'app.js'); }
    if (kind === 'unstaged-code') write('app.js', 'export default 2;\n');
    if (kind === 'reverted-code') { write('app.js', 'export default 2;\n'); commit(); write('app.js', 'export default 1;\n'); }
    if (kind === 'staged-reverted-code') { write('app.js', 'export default 2;\n'); git('add', 'app.js'); write('app.js', 'export default 1;\n'); }
    if (kind === 'code-renamed-md') { git('mv', 'app.js', 'app.md'); commit(); }
    if (kind === 'other-sprint-image') write('sprints/10141904-cw-deadbeef/qa-r2/screenshot.png', 'image');
    if (kind === 'non-record-json') write(`${SPRINT}/result.json`, '{}');
    if (kind === 'sprint-source') write(`${SPRINT}/script.js`, 'code');
    if (kind === 'records-only') { write(`${SPRINT}/05-qa-report-r1.md`, 'old report'); commit(); }
    if (kind === 'symlink-md') fs.symlinkSync('app.js', path.join(root, 'link.md'));
    if (kind === 'executable-md') { fs.chmodSync(path.join(root, 'README.md'), 0o755); git('add', 'README.md'); commit(); }
    const { state, changed } = await solidify();
    expect(changed).toContain(SMOKE); expect(fs.readFileSync(path.join(root, ALLOW), 'utf8')).toContain('cw-3a27ca36-qa-smoke.sh');
    expect(state.smoke).toMatchObject({ round: 2, items: ['T-1'] }); expect(calls).toBe(2);
  },
);

it('API 变更的预跑失败仍触 smoke_missing，不能以 Markdown 记录抵消', async () => {
  write('packages/brain/src/routes/example.js', 'export default 2;\n'); commit();
  const { state, changed } = await solidify({ broken: true });
  expect(changed).toEqual([]); expect(state.smoke_missing).toBe(true); expect(state.smoke_gap.api_items).toEqual(['T-1']);
});
