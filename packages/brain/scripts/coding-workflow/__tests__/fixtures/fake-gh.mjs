#!/usr/bin/env node
// 假 gh：按 FAKE_GH_MODE（existing | new | auth | branchfail）模拟 `gh pr list` / `gh pr create`。
// FAKE_GH_LOG 指向文件时，把每次调用的 argv（JSON 一行）追加进去。
import fs from 'node:fs';

const mode = process.env.FAKE_GH_MODE || 'new';
const argv = process.argv.slice(2);
if (process.env.FAKE_GH_LOG) fs.appendFileSync(process.env.FAKE_GH_LOG, `${JSON.stringify(argv)}\n`);

if (mode === 'auth') {
  process.stderr.write('HTTP 401: Bad credentials (https://api.github.com/graphql)\n');
  process.exit(1);
}

if (mode === 'branchfail') {
  process.stderr.write('could not create pull request for branch cp-oauth-fix: network timeout\n');
  process.exit(1);
}

const sub =`${argv[0]} ${argv[1]}`;
if (sub === 'pr list') {
  if (mode === 'existing') process.stdout.write('https://github.com/example/repo/pull/1\n');
  process.exit(0);
}
if (sub === 'pr create') {
  process.stdout.write('https://github.com/example/repo/pull/2\n');
  process.exit(0);
}
process.stderr.write(`fake gh: unsupported args ${argv.join(' ')}\n`);
process.exit(1);
