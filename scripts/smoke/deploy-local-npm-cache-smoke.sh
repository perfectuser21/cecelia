#!/usr/bin/env bash
# 真 deploy-local 入口验证 npm 参数；所有部署/网络边界均限制在 fixture。
set -euo pipefail
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
node --input-type=module - "$ROOT_DIR" <<'NODE'
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, copyFileSync, rmSync, realpathSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
const source = process.argv[2];
const root = realpathSync(mkdtempSync(join(tmpdir(), 'deploy-npm-behavior-')));
try {
  for (const dir of ['scripts', 'bin', 'home', 'apps/dashboard']) mkdirSync(join(root, dir), { recursive: true });
  copyFileSync(join(source, 'scripts/deploy-local.sh'), join(root, 'scripts/deploy-local.sh'));
  const write = (name, content) => writeFileSync(join(root, 'bin', name), content, { mode: 0o755 });
  // npm 只记录实际 argv：故障断言放在父进程，避免脚本吞掉 stub 错误后假绿。
  write('npm', `#!${process.execPath}
const fs=require('node:fs'); const args=process.argv.slice(2);
fs.appendFileSync(process.env.NPM_CALLS,JSON.stringify({args,cwd:process.cwd()})+'\\n');
if(args[0]==='run'||process.env.NPM_SCENARIO==='install-failure')process.exit(23);
if(process.env.NPM_SCENARIO==='retry'&&args.includes('--prefer-offline'))process.exit(19);
`);
  // Linux 容器构建也在 docker 边界停止，不启动任何真实容器。
  for (const name of ['docker', 'curl', 'ssh', 'rsync', 'launchctl', 'psql']) {
    write(name, '#!/bin/sh\nprintf "%s\\n" "$0 $*" >> "$BOUNDARY_CALLS"\nexit 23\n');
  }
  write('git', '#!/bin/sh\nexit 1\n');
  writeFileSync(join(root, 'scripts/brain-deploy.sh'), '#!/bin/sh\nprintf "brain-called\\n" >> "$BRAIN_CALLS"\n');
  for (const scenario of ['brain', 'dashboard', 'retry', 'install-failure']) {
    const callsFile = join(root, `${scenario}.jsonl`), brainCalls = join(root, `${scenario}.brain`);
    const env = {
      PATH: `${join(root, 'bin')}:${process.env.PATH}`, HOME: join(root, 'home'),
      CECELIA_DEPLOY_ROOT: root, NPM_CALLS: callsFile, NPM_SCENARIO: scenario,
      BOUNDARY_CALLS: join(root, `${scenario}.boundaries`), BRAIN_CALLS: brainCalls,
    };
    const changed = scenario === 'brain' ? 'packages/brain/src/server.js' : 'apps/dashboard/src/App.tsx';
    const result = spawnSync('bash', [join(root, 'scripts/deploy-local.sh'), `--changed=${changed}`], {
      cwd: root, env, encoding: 'utf8', timeout: 10000,
    });
    assert.equal(result.status, scenario === 'brain' ? 0 : scenario === 'install-failure' ? 1 : 23, result.stdout + result.stderr);
    const allCalls = readFileSync(callsFile, 'utf8').trim().split('\n').map(JSON.parse);
    const calls = allCalls.filter(call => ['ci', 'install'].includes(call.args[0]));
    assert.equal(calls.length, ['retry', 'install-failure'].includes(scenario) ? 2 : 1, `${scenario}: install/retry branch not exercised`);
    for (const { args, cwd } of calls) {
      assert.equal(cwd, root);
      assert.equal(args[args.indexOf('--cache') + 1], join(root, '.npm-cache'), `${scenario}: cache must use deployment root`);
      assert.equal(args[args.indexOf('--logs-dir') + 1], join(root, '.npm-logs'), `${scenario}: logs must use deployment root`);
    }
    if (scenario === 'brain') {
      assert.equal(calls[0].args[0], 'ci');
      assert.equal(readFileSync(brainCalls, 'utf8'), 'brain-called\n');
    } else {
      assert.equal(calls[0].args[0], 'install');
      if (scenario === 'retry') assert.ok(!calls[1].args.includes('--prefer-offline'));
    }
    if (scenario === 'install-failure') {
      assert.ok(allCalls.every(call => call.args[0] !== 'run'), '安装失败后不得进入构建');
      assert.ok(!existsSync(brainCalls), '安装失败后不得部署 Brain');
      assert.ok(!existsSync(env.BOUNDARY_CALLS), '安装失败后不得进入部署边界');
    }
    console.log(`PASS: ${scenario} 真入口的 ${calls.length} 次 npm 安装均使用部署根 cache/logs`);
  }
} finally { rmSync(root, { recursive: true, force: true }); }
NODE
