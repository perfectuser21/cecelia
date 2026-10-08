#!/usr/bin/env node
// 假 claude（CI 修复用）：prompt 写进 FAKE_CIFIX_PROMPT；按 FAKE_CIFIX_MODE 在 cwd（PR 分支 worktree）里：
// fix（改 src/fix.txt 并提交）| none（什么都不做）| dirty（只改不提交）| tamper（改 sprint 的 01-intent.md 并提交）| fail（非 0 退出）
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const argv = process.argv.slice(2);
const prompt = argv[argv.indexOf('-p') + 1] || '';
if (process.env.FAKE_CIFIX_PROMPT) fs.writeFileSync(process.env.FAKE_CIFIX_PROMPT, prompt);
const mode = process.env.FAKE_CIFIX_MODE || 'fix';
const git = (...args) => execFileSync('git', args, { stdio: ['ignore', 'pipe', 'pipe'], encoding: 'utf8' });
const commit = (file, text, message) => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.appendFileSync(file, text);
  git('add', file);
  git('-c', 'user.name=fake', '-c', 'user.email=fake@example.com', 'commit', '-q', '-m', message);
};

if (mode === 'fail') process.exit(1);
if (mode === 'fix') commit('src/fix.txt', 'fixed\n', 'fix(ci): 修复 CI 失败');
if (mode === 'dirty') fs.writeFileSync('src-dirty.txt', 'uncommitted\n');
if (mode === 'tamper') {
  const sprint = fs.readdirSync('sprints').find((d) => /-cw-/.test(d));
  commit(path.join('sprints', sprint, '01-intent.md'), '\n放宽验收\n', 'fix: 改验收');
}
console.log(`fake claude ci-fix mode=${mode}`);
