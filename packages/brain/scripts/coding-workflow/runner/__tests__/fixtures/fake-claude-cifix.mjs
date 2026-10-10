#!/usr/bin/env node
// 假 claude（CI 修复用）：prompt 写进 FAKE_CIFIX_PROMPT；按 FAKE_CIFIX_MODE 在 cwd（PR 分支 worktree）里：
// fix（改 src/fix.txt 并提交）| fragment（只补 changes/ 碎片并提交）| skiptest / deltest / lessassert（削弱测试）| none（什么都不做）| dirty（只改不提交）| tamper（改 sprint 的 01-intent.md 并提交）| fail（非 0 退出）
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
if (mode === 'fragment') commit('changes/frag.md', '## Brain {VERSION} — x\n', 'fix(brain): 补 changes/ 版本碎片');
// 削弱测试的三种手法（审计 #31，修复环节不得删测试/放宽断言来变绿）
if (mode === 'skiptest') commit('src/b.test.mjs', "it.skip('b', () => {\n  expect(1).toBe(1);\n  expect(2).toBe(2);\n});\n", 'fix(ci): 跳过不稳定用例');
// 删 PR 自己新加、main 上没有的测试（按裁决删超范围代码时连带删，决策 b057089b 允许）
if (mode === 'del-pr-test') {
  git('rm', '-q', 'src/pr-only.test.mjs');
  git('-c', 'user.name=fake', '-c', 'user.email=fake@example.com', 'commit', '-q', '-m', 'fix: 删掉超范围改动及其测试');
}
if (mode === 'deltest') {
  git('rm', '-q', 'src/b.test.mjs');
  git('-c', 'user.name=fake', '-c', 'user.email=fake@example.com', 'commit', '-q', '-m', 'fix(ci): 删掉过时测试');
}
if (mode === 'lessassert') {
  fs.writeFileSync('src/b.test.mjs', "it('b', () => {\n  expect(1).toBe(1);\n});\n");
  git('add', 'src/b.test.mjs');
  git('-c', 'user.name=fake', '-c', 'user.email=fake@example.com', 'commit', '-q', '-m', 'fix(ci): 精简断言');
}
if (mode === 'dirty') fs.writeFileSync('src-dirty.txt', 'uncommitted\n');
if (mode === 'tamper') {
  const sprint = fs.readdirSync('sprints').find((d) => /-cw-/.test(d));
  commit(path.join('sprints', sprint, '01-intent.md'), '\n放宽验收\n', 'fix: 改验收');
}
console.log(`fake claude ci-fix mode=${mode}`);
