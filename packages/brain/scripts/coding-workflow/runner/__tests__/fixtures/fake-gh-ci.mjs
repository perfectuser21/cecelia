#!/usr/bin/env node
// 假 gh（CI 修复用）：argv 追加到 FAKE_GH_LOG；按 FAKE_GH_CI 指向的 JSON 回放：
// { prs: [...], required: { <pr>: [{name,bucket}] }, checks: { <pr>: [{name,bucket,link}] }, logs: { <jobId>: "..." },
//   prStates: { <pr_url>: "MERGED"|"OPEN"|"CLOSED" } }
// `pr checks --required` 有 pending 时退出 8、有 fail 时退出 1（同真 gh），JSON 照常输出。
import fs from 'node:fs';

const argv = process.argv.slice(2);
if (process.env.FAKE_GH_LOG) fs.appendFileSync(process.env.FAKE_GH_LOG, `${JSON.stringify(argv)}\n`);
const state = process.env.FAKE_GH_CI ? JSON.parse(fs.readFileSync(process.env.FAKE_GH_CI, 'utf8')) : {};
const out = (value, code = 0) => {
  process.stdout.write(typeof value === 'string' ? value : JSON.stringify(value));
  process.exit(code);
};

if (argv[0] === 'pr' && argv[1] === 'list') out(argv.includes('merged') ? (state.mergedPrs ?? []) : (state.prs ?? []));
// pr view <url> --json state：按 prStates[url] 回放，未登记的 PR 报错退出 1
if (argv[0] === 'pr' && argv[1] === 'view') {
  const s = state.prStates?.[argv[2]];
  if (!s) process.exit(1);
  out({ state: s });
}
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
// 仓库规定的必需检查（分支保护 + 规则集，runner 用 --jq 取成名字数组）：requiredContexts 默认 ['ci-passed']，
// rulesetContexts 默认 []；requiredContextsFail=true 时分支保护查询失败退出 1
if (argv[0] === 'api' && /\/protection\/required_status_checks$/.test(argv[1] ?? '')) {
  if (state.requiredContextsFail) process.exit(1);
  out(state.requiredContexts ?? ['ci-passed']);
}
if (argv[0] === 'api' && /\/rules\/branches\//.test(argv[1] ?? '')) out(state.rulesetContexts ?? []);
const job = argv[0] === 'api' ? /\/actions\/jobs\/(\d+)\/logs$/.exec(argv[1] ?? '') : null;
if (job) out(state.logs?.[job[1]] ?? '');
process.exit(Number(process.env.FAKE_GH_EXIT || 0));
