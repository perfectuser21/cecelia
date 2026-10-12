// 多仓库命名空间（C4）：状态文件按仓库分目录（cecelia 沿用旧路径）、必需检查缓存按仓库区分。
// 复现两类串仓：① 两个仓库同号 PR（cecelia #2125 与 zenithjoy #2125）的 qa/cifix/commander 状态互相覆盖；
// ② 进程级单例缓存把先查到的仓库的必需检查名用到另一个仓库，少登记的 PR 被判「全绿」放行合并。
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { loadRepos, resolveEntry, repoView, stateDir, prFile } from '../lib/repos.mjs';
import { readState as readQa, writeState as writeQa } from '../lib/qa-gate.mjs';
import { readState as readCi, statePath as ciPath, requiredState } from '../lib/cifix-scan.mjs';
import { acceptedKeys } from '../lib/cv-accepted.mjs';
import { sessionLogPath } from '../lib/session-log.mjs';
import { cleanupRetention } from '../lib/retention.mjs';

const DAY = 24 * 3600 * 1000;
const repos = loadRepos();
const entry = (key) => resolveEntry(repos.find((r) => r.key === key), { HOME: '/h' });

let dir;
let cecelia;
let zj;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cw-ns-'));
  const base = { logDir: path.join(dir, 'logs'), ghBin: 'gh', logRetentionDays: 30, failedRetentionDays: 7 };
  const ce = entry('cecelia');
  const ze = entry('zenithjoy-workspace');
  const cfg = { ...base, repos: [ce, ze] };
  cecelia = repoView(cfg, { ...ce, clone: path.join(dir, 'c'), worktreeBase: path.join(dir, 'cw') });
  zj = repoView(cfg, { ...ze, clone: path.join(dir, 'z'), worktreeBase: path.join(dir, 'zw') });
});

afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

describe('状态路径按仓库分命名空间', () => {
  it('cecelia 沿用旧路径 <logDir>/qa-<pr>.json（零迁移）；zenithjoy 落 <logDir>/zenithjoy-workspace/', () => {
    expect(stateDir(cecelia)).toBe(cecelia.logDir);
    expect(prFile(cecelia, 'qa-2125.json')).toBe(path.join(cecelia.logDir, 'qa-2125.json'));
    expect(prFile(zj, 'qa-2125.json')).toBe(path.join(zj.logDir, 'zenithjoy-workspace', 'qa-2125.json'));
    expect(ciPath(cecelia, 2125)).toBe(path.join(cecelia.logDir, 'cifix-2125.json'));
    expect(ciPath(zj, 2125)).toBe(path.join(zj.logDir, 'zenithjoy-workspace', 'cifix-2125.json'));
    expect(sessionLogPath(zj, 'cifix', 2125, 'x')).toBe(path.join(zj.logDir, 'zenithjoy-workspace', 'cifix-2125-x.log'));
    // 没有仓库视图的旧调用方（status.mjs 只传 logDir）照旧
    expect(stateDir({ logDir: '/l' })).toBe('/l');
  });

  it('两个仓库同号 PR #2125：QA 状态（含 C3 的 closed / reopened）互不覆盖', () => {
    writeQa(cecelia, 2125, { rounds: [], bad: 0, approved: { head: 'c' }, closed: { at: 't', head: 'c' } });
    writeQa(zj, 2125, { rounds: [], bad: 2, reopened: [{ at: 't2' }] });
    expect(readQa(cecelia, 2125)).toMatchObject({ approved: { head: 'c' }, closed: { head: 'c' }, bad: 0 });
    expect(readQa(cecelia, 2125).reopened).toBeUndefined();
    expect(readQa(zj, 2125)).toMatchObject({ bad: 2, reopened: [{ at: 't2' }] });
    expect(readQa(zj, 2125).approved).toBeUndefined();
    expect(fs.existsSync(path.join(cecelia.logDir, 'qa-2125.json'))).toBe(true);
    expect(fs.existsSync(path.join(zj.logDir, 'zenithjoy-workspace', 'qa-2125.json'))).toBe(true);
  });

  it('CI 修复状态与 commander 裁决记录同样按仓库读', () => {
    fs.mkdirSync(path.join(zj.logDir, 'zenithjoy-workspace'), { recursive: true });
    fs.writeFileSync(ciPath(zj, 2125), JSON.stringify({ attempts: [{ head: 'z' }], escalated: { type: 'x' } }));
    expect(readCi(zj, 2125).attempts).toHaveLength(1);
    expect(readCi(cecelia, 2125)).toEqual({ attempts: [] });
    const cs = { interventions: [{ action: 'resume', escalation: { type: 'qa_cannot_verify', cannot_verify: [{ id: 'C-1', covers: ['Q-3'] }] }, rulings: [{ issue: 'C-1', verdict: '维持规格' }] }] };
    fs.writeFileSync(prFile(zj, 'commander-2125.json'), JSON.stringify(cs));
    expect([...acceptedKeys(zj, 2125)]).toEqual(['Q-3']);
    expect([...acceptedKeys(cecelia, 2125)]).toEqual([]);
  });

  it('保留期清理也扫各仓库命名空间目录：超期日志删、状态台账不删', async () => {
    const ns = path.join(zj.logDir, 'zenithjoy-workspace');
    fs.mkdirSync(ns, { recursive: true });
    const old = (f) => { fs.writeFileSync(f, '{}'); const t = new Date(Date.now() - 40 * DAY); fs.utimesSync(f, t, t); };
    old(path.join(ns, 'qa-2125.json'));
    old(path.join(ns, 'cifix-2125.json'));
    old(path.join(ns, 'cifix-2125-1.log'));
    old(path.join(zj.logDir, 'qa-2125.json'));
    old(path.join(zj.logDir, 'old-task.log'));
    await cleanupRetention({ ...cecelia, repo: path.join(dir, 'none'), worktreeBase: path.join(dir, 'none-w') });
    expect(fs.existsSync(path.join(ns, 'qa-2125.json'))).toBe(true);
    expect(fs.existsSync(path.join(ns, 'cifix-2125.json'))).toBe(true);
    expect(fs.existsSync(path.join(ns, 'cifix-2125-1.log'))).toBe(false);
    expect(fs.existsSync(path.join(zj.logDir, 'qa-2125.json'))).toBe(true);
    expect(fs.existsSync(path.join(zj.logDir, 'old-task.log'))).toBe(false);
  });
});

describe('必需检查缓存按仓库区分', () => {
  // 假 gh：按 cwd（仓库 clone）读 protection.json / required.json
  const fakeGh = () => {
    const p = path.join(dir, 'fake-gh');
    fs.writeFileSync(p, [
      '#!/usr/bin/env node',
      "const fs = require('node:fs');",
      'const a = process.argv.slice(2);',
      "const read = (f) => fs.readFileSync(f, 'utf8');",
      "if (a[0] === 'api' && /protection/.test(a[1])) { process.stdout.write(read('protection.json')); process.exit(0); }",
      "if (a[0] === 'api' && /rules/.test(a[1])) { process.stdout.write('[]'); process.exit(0); }",
      "if (a[0] === 'pr' && a[1] === 'checks') { process.stdout.write(read('required.json')); process.exit(0); }",
      'process.exit(1);',
    ].join('\n'));
    fs.chmodSync(p, 0o755);
    return p;
  };
  const seed = (clone, protection, required) => {
    fs.mkdirSync(clone, { recursive: true });
    fs.writeFileSync(path.join(clone, 'protection.json'), JSON.stringify(protection));
    fs.writeFileSync(path.join(clone, 'required.json'), JSON.stringify(required));
  };

  it('先查 A 仓（只要 ci-passed）再查 B 仓（12 个）：B 只登记了 ci-passed 必须是 pending，不能借 A 的缓存判 pass', async () => {
    const gh = fakeGh();
    const a = { ...cecelia, ghBin: gh };
    const b = { ...zj, ghBin: gh };
    const twelve = repos.find((r) => r.key === 'zenithjoy-workspace').required_checks;
    seed(a.repo, ['ci-passed'], [{ name: 'ci-passed', bucket: 'pass' }]);
    seed(b.repo, twelve, [{ name: 'ci-passed', bucket: 'pass' }]);
    expect(await requiredState(a, 2125)).toEqual({ state: 'pass', failed: [] });
    expect(await requiredState(b, 2125)).toEqual({ state: 'pending', failed: [] });
    // 回头再查 A：A 的缓存也没被 B 覆盖
    expect(await requiredState(a, 2125)).toEqual({ state: 'pass', failed: [] });
  });
});
