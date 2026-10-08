#!/usr/bin/env node
// 假 gh（CI 修复用）：argv 追加到 FAKE_GH_LOG；按 FAKE_GH_CI 指向的 JSON 回放：
// { prs: [...], required: { <pr>: [{name,bucket}] }, checks: { <pr>: [{name,bucket,link}] }, logs: { <jobId>: "..." } }
// `pr checks --required` 有 pending 时退出 8、有 fail 时退出 1（同真 gh），JSON 照常输出。
import fs from 'node:fs';

const argv = process.argv.slice(2);
if (process.env.FAKE_GH_LOG) fs.appendFileSync(process.env.FAKE_GH_LOG, `${JSON.stringify(argv)}\n`);
const state = process.env.FAKE_GH_CI ? JSON.parse(fs.readFileSync(process.env.FAKE_GH_CI, 'utf8')) : {};
const out = (value, code = 0) => {
  process.stdout.write(typeof value === 'string' ? value : JSON.stringify(value));
  process.exit(code);
};

if (argv[0] === 'pr' && argv[1] === 'list') out(state.prs ?? []);
if (argv[0] === 'pr' && argv[1] === 'checks') {
  const pr = argv[2];
  if (argv.includes('--required')) {
    const rows = state.required?.[pr];
    if (!rows) {
      process.stderr.write("no required checks reported on the branch\n");
      process.exit(1);
    }
    const code = rows.some((r) => r.bucket === 'pending') ? 8 : rows.some((r) => r.bucket === 'fail') ? 1 : 0;
    out(rows, code);
  }
  out(state.checks?.[pr] ?? []);
}
const job = argv[0] === 'api' ? /\/actions\/jobs\/(\d+)\/logs$/.exec(argv[1] ?? '') : null;
if (job) out(state.logs?.[job[1]] ?? '');
process.exit(Number(process.env.FAKE_GH_EXIT || 0));
