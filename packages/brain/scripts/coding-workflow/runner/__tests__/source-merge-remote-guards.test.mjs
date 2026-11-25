// 真实Git及受保护来源链；网络/模型仅本地CLI替身，不mock来源核验。
import { it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { git } from '../../__tests__/helpers/git.mjs';
import { sourceMergeFixture, BRANCH } from './helpers/source-merge-fixture.mjs';

const f = sourceMergeFixture(import.meta.url);
const { put, head, commit, runFix, editGh } = f;

it('auto关闭失败不push，不冒称旧QA已撤销', async () => {
  editGh(d => { d.mergeExit = 1; });
  fs.mkdirSync(f.sb.logDir, { recursive: true });fs.writeFileSync(path.join(f.sb.logDir, 'qa-77.json'), JSON.stringify({ passed: true, approved: { head: f.before, round: 1 } }));
  expect((await runFix()).result).toBe('source_merge_disable_auto_failed');
  expect(git(f.sb.origin, 'rev-parse', BRANCH).trim()).toBe(f.before);
  expect(JSON.parse(fs.readFileSync(path.join(f.sb.logDir, 'qa-77.json'))).passed).toBe(true);
}, 120000);

it('PR实际head已变拒绝，不运行模型', async () => {
  editGh(d => { d.prDetails = { 77: { ...d.prs[0], headRefOid: f.main } }; });
  expect((await runFix()).result).toBe('source_merge_pr_changed');
  expect(git(f.sb.origin, 'rev-parse', BRANCH).trim()).toBe(f.before);expect(fs.existsSync(path.join(f.sb.root, 'model-called'))).toBe(false);
}, 60000);

it('推送前main移动，精确远端guard拒绝；已撤旧QA不恢复', async () => {
  git(f.sb.seed, 'checkout', '-q', 'main');put('upstream-new.txt', 'new main');const moved = commit('fixture concurrent main');git(f.sb.seed, 'checkout', '-q', BRANCH);
  const wrapper = path.join(f.sb.root, 'race-gh.mjs');
  fs.writeFileSync(wrapper, `#!/usr/bin/env node\nimport{spawnSync,execFileSync}from'node:child_process';const a=process.argv.slice(2);const r=spawnSync(${JSON.stringify(f.cfg.ghBin)},a,{stdio:'inherit'});if(a.includes('--disable-auto'))execFileSync('/usr/bin/git',['--git-dir',${JSON.stringify(f.sb.origin)},'update-ref','refs/heads/main',${JSON.stringify(moved)},${JSON.stringify(f.main)}]);process.exit(r.status);\n`, { mode: 0o755 });
  // 对象需先发送到bare，但不更新main；独立临时fixture引用保留。
  git(f.sb.seed, 'push', '-q', 'origin', `${moved}:refs/heads/race-object`);f.cfg.ghBin = wrapper;
  expect((await runFix()).result).toBe('source_merge_remote_changed');
  expect(git(f.sb.origin, 'rev-parse', BRANCH).trim()).toBe(f.before);
  expect(JSON.parse(fs.readFileSync(path.join(f.sb.logDir, 'qa-77.json'))).passed).toBe(false);
}, 120000);

it.each(['retarget', 'fork'])('远端身份% s不可进入可信自仓同步'.replace('% s', '%s'), async kind => {
  editGh(d => { d.prDetails = { 77: { ...d.prs[0], ...(kind === 'retarget' ? { baseRefName: 'release' } : { isCrossRepository: true }) } }; });
  expect((await runFix()).result).toBe('source_merge_pr_identity');
  expect(git(f.sb.origin, 'rev-parse', BRANCH).trim()).toBe(f.before);
}, 120000);

it('disable-auto返回成功但实际auto仍开启也不可push', async () => {
  editGh(d => { d.prs[0].autoMergeRequest = { enabledAt: new Date().toISOString() }; });
  expect((await runFix()).result).toBe('source_merge_auto_still_enabled');
  expect(git(f.sb.origin, 'rev-parse', BRANCH).trim()).toBe(f.before);
}, 120000);

it('第二次PR读取后再retarget，推前第三次原生读取仍拒绝', async () => {
  const wrapper = path.join(f.sb.root, 'pr-race-gh.mjs');
  fs.writeFileSync(wrapper, `#!/usr/bin/env node\nimport fs from 'node:fs';import{spawnSync}from'node:child_process';const a=process.argv.slice(2);const r=spawnSync(${JSON.stringify(f.cfg.ghBin)},a,{stdio:'inherit'});if(a.includes('--disable-auto')){const p=process.env.FAKE_GH_CI,d=JSON.parse(fs.readFileSync(p));d.prDetails={77:{...d.prs[0],baseRefName:'release'}};fs.writeFileSync(p,JSON.stringify(d));}process.exit(r.status);\n`, { mode: 0o755 });
  f.cfg.ghBin = wrapper;
  expect((await runFix()).result).toBe('source_merge_pr_identity');
  expect(git(f.sb.origin, 'rev-parse', BRANCH).trim()).toBe(f.before);
}, 120000);
