#!/usr/bin/env node
// 假 claude（CI 修复用）：prompt 写进 FAKE_CIFIX_PROMPT；按 FAKE_CIFIX_MODE 在 cwd（PR 分支 worktree）里：
// fix（改 src/fix.txt 并提交）| resolve（解决合并冲突：src/x.txt 写 resolved，提交完成合并）| fragment（只补 changes/ 碎片并提交）| skiptest / deltest / lessassert（削弱测试）| none（什么都不做）| dirty（只改不提交）| tamper（改 sprint 的 01-intent.md 并提交）| tamper-smoke（改 runner 生成的 cw-*-qa-smoke.sh 并提交）| ruling-conflict（不改，输出 RULING_CONFLICT 行）
// coding commander：cmd-resume（只写裁决）| cmd-amend（规格末尾追加 commander 裁决节并提交）| cmd-fix（改 src 并提交）| cmd-human（裁决要上交）
// | cmd-garbage（不写裁决）| cmd-intent（改 01-intent）| cmd-rewrite（改写规格原有内容）；裁决写到 prompt 里 RULING_PATH 行给的路径，FAKE_CMD_RULING 可覆盖裁决内容| fail（非 0 退出）
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const argv = process.argv.slice(2);
const prompt = argv[argv.indexOf('-p') + 1] || '';
if (process.env.FAKE_CIFIX_PROMPT) fs.writeFileSync(process.env.FAKE_CIFIX_PROMPT, prompt);
if (process.env.FAKE_CIFIX_ARGS) fs.writeFileSync(process.env.FAKE_CIFIX_ARGS, JSON.stringify(argv));
const mode = process.env.FAKE_CIFIX_MODE || 'fix';
const git = (...args) => execFileSync('git', args, { stdio: ['ignore', 'pipe', 'pipe'], encoding: 'utf8' });
const commit = (file, text, message) => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.appendFileSync(file, text);
  git('add', file);
  git('-c', 'user.name=fake', '-c', 'user.email=fake@example.com', 'commit', '-q', '-m', message);
};

if (mode === 'fail') process.exit(1);
if (mode === 'resolve') {
  fs.writeFileSync('src/x.txt', 'resolved\n');
  git('add', '-A');
  git('-c', 'user.name=fake', '-c', 'user.email=fake@example.com', 'commit', '-q', '--no-edit');
}
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
// 金丝雀 4：修复会话改了 runner 生成的 QA 回归 smoke（与下次固化互相覆盖）
if (mode === 'tamper-smoke') commit('packages/brain/scripts/smoke/cw-c954ebfd-qa-smoke.sh', 'echo Q1_OK\n', 'fix: smoke 加标记');
if (mode === 'ruling-conflict') console.log('RULING_CONFLICT: J-1 要求报错，与规格 S-1 第 3 点（约束读不到返回空数组）矛盾');
if (mode.startsWith('cmd-')) {
  const rulingPath = /^RULING_PATH: (.+)$/m.exec(prompt)?.[1]?.trim();
  const sprint = fs.existsSync('sprints') ? fs.readdirSync('sprints').find((d) => /-cw-/.test(d)) : null;
  const spec = sprint ? path.join('sprints', sprint, '02-spec.md') : null;
  if (mode === 'cmd-amend') commit(spec, '\n## commander 裁决（测试）\n- J-1：维持规格\n', 'docs(spec): commander 裁决');
  if (mode === 'cmd-fix') commit('src/commander-fix.txt', 'fixed\n', 'fix: commander 按裁决修复');
  if (mode === 'cmd-intent') commit(path.join('sprints', sprint, '01-intent.md'), '\n放宽\n', 'docs: 改需求');
  if (mode === 'cmd-rewrite') {
    fs.writeFileSync(spec, '### S-1\n改写\n\n## commander 裁决\n- x\n');
    git('add', spec);
    git('-c', 'user.name=fake', '-c', 'user.email=fake@example.com', 'commit', '-q', '-m', 'docs: 改写规格');
  }
  const ruling = process.env.FAKE_CMD_RULING ? JSON.parse(process.env.FAKE_CMD_RULING) : (mode === 'cmd-human'
    ? { action: 'human', rulings: [{ issue: 'J-1', verdict: '上交', reason: '需求本身要改' }], human_reason: '需求 I-3 与现有路由冲突，需主理人定', summary: '上交' }
    : { action: 'resume', rulings: [{ issue: 'J-1', verdict: '维持规格', reason: '规格已登记未覆盖链路' }], reset_ci_budget: false, summary: '维持规格继续' });
  if (rulingPath && mode !== 'cmd-garbage') fs.writeFileSync(rulingPath, JSON.stringify(ruling));
}
console.log(`fake claude ci-fix mode=${mode}`);
// 会话正文（真 claude 收尾时的 markdown 总结 + 一行 stderr）：只该落进按 PR 分开的会话文件，不该进 runner 主日志
console.log(`## FAKE_SESSION_BODY mode=${mode}\n\n| 项 | 结论 |\n|---|---|\n| J-1 | 已修 |`);
process.stderr.write(`FAKE_SESSION_STDERR mode=${mode}\n`);
// FAKE_CIFIX_COST：末尾输出一行 result 事件（真 claude --output-format json 的形状），供计费与摘要测试
if (process.env.FAKE_CIFIX_COST) {
  console.log(JSON.stringify({ type: 'result', subtype: 'success', is_error: false, num_turns: 3, duration_ms: 1000,
    total_cost_usd: Number(process.env.FAKE_CIFIX_COST), result: 'FAKE_SESSION_BODY 修完了\n第二行' }));
}
