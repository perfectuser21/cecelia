#!/usr/bin/env node
// 假执行器：顶替 activity-contract-run.js，按 FAKE_EXEC_MODE 产出回执，不调 claude。
//   completed：七活动全完成，outputs.pr_url；FAKE_EXEC_REPORT=1 时像 report 活动一样 PATCH result.coding_workflow
//   failed：verify 失败（verification_failed），report 完成，整体 partial
//   crash：stdout 写垃圾并以 3 退出
//   hang：永不退出（等 runner 超时）
//   hang-tree：先拉起"独立进程组的子进程 → 再独立进程组的孙进程"（都忽略 SIGTERM），pid 写入 FAKE_EXEC_TREE_PIDS，然后永不退出
//   partial-pr：publish 已开 PR，report 失败，整体 partial
// FAKE_EXEC_LOG 指向文件时，写入一行 JSON：argv、cwd、stdin 信封、关心的 env 是否存在。
import fs from 'node:fs';
import { spawn } from 'node:child_process';

const argv = process.argv.slice(2);
const opt = (name) => {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : undefined;
};
const mode = process.env.FAKE_EXEC_MODE || 'completed';

let text = '';
process.stdin.setEncoding('utf8');
for await (const chunk of process.stdin) text += chunk;
const envelope = JSON.parse(text);
const input = envelope.input;

if (process.env.FAKE_EXEC_LOG) {
  const envSeen = {};
  for (const key of ['CLAUDECODE', 'CLAUDE_CODE_ENTRYPOINT', 'GIT_DIR', 'GIT_WORK_TREE', 'GIT_INDEX_FILE', 'CODING_WF_GH_BIN']) {
    envSeen[key] = key in process.env;
  }
  fs.appendFileSync(process.env.FAKE_EXEC_LOG, `${JSON.stringify({
    argv,
    cwd: process.cwd(),
    envelope,
    env: envSeen,
    contract_activities: envelope.contract?.activities?.map((a) => a.key),
  })}\n`);
}

const KEYS = ['intent', 'spec', 'build', 'verify', 'chain_check', 'publish', 'report'];
const done = (key) => ({ key, status: 'completed', attempts: [{ attempt: 1, status: 'completed', outputs: {} }] });

function finish(result, code) {
  const receipt = opt('--receipt');
  if (receipt) fs.writeFileSync(receipt, `${JSON.stringify(result)}\n`);
  process.stdout.write(`${JSON.stringify(result)}\n`);
  process.exitCode = code;
}

// 独立进程组、忽略 SIGTERM 的常驻进程；depth>0 时再拉起下一层。
const SLEEPER = `process.on('SIGTERM', () => {});
const { spawn } = require('node:child_process');
const fs = require('node:fs');
fs.appendFileSync(process.env.FAKE_EXEC_TREE_PIDS, process.pid + '\\n');
if (Number(process.argv[1]) > 0) {
  spawn(process.execPath, ['-e', process.env.FAKE_SLEEPER, String(Number(process.argv[1]) - 1)], { detached: true, stdio: 'ignore', env: process.env }).unref();
}
setInterval(() => {}, 1000);`;

if (mode === 'hang') {
  setInterval(() => {}, 1000);
} else if (mode === 'hang-tree') {
  spawn(process.execPath, ['-e', SLEEPER, '1'], {
    detached: true,
    stdio: 'ignore',
    env: { ...process.env, FAKE_SLEEPER: SLEEPER },
  }).unref();
  setInterval(() => {}, 1000);
} else if (mode === 'partial-pr') {
  finish({
    schema_version: 1,
    run_tag: input.run_tag,
    status: 'partial',
    outputs: { pr_url: 'https://github.com/example/repo/pull/9' },
    activities: [
      ...['intent', 'spec', 'build', 'verify', 'chain_check', 'publish'].map(done),
      { key: 'report', status: 'failed', attempts: [{ attempt: 1, status: 'failed', failure_class: 'retryable', reason_code: 'brain_unavailable' }] },
    ],
  }, 2);
} else if (mode === 'crash') {
  process.stdout.write('not json at all\n');
  process.exit(3);
} else if (mode === 'failed') {
  finish({
    schema_version: 1,
    run_tag: input.run_tag,
    status: 'partial',
    outputs: { verification: { reason_code: 'verification_failed' } },
    activities: [
      ...['intent', 'spec', 'build'].map(done),
      {
        key: 'verify',
        status: 'failed',
        attempts: [{ attempt: 1, status: 'failed', failure_class: 'fatal', reason_code: 'verification_failed' }],
      },
      done('report'),
    ],
  }, 2);
} else {
  const prUrl = 'https://github.com/example/repo/pull/9';
  if (process.env.FAKE_EXEC_REPORT === '1') {
    await fetch(`${input.brain_url}/api/brain/tasks/${input.task_id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ result: { coding_workflow: { pr_url: prUrl, run_tag: input.run_tag } } }),
    });
  }
  finish({
    schema_version: 1,
    run_tag: input.run_tag,
    status: 'completed',
    outputs: { pr_url: prUrl, branch: 'whatever' },
    activities: KEYS.map(done),
  }, 0);
}
