import { it, expect } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { screenshotProblems } from '../lib/qa-report.mjs';
import { isReadonlyQaCommand } from '../lib/readonly-qa-ast.mjs';
import { readonlyQaScript } from '../lib/readonly-qa-command.mjs';
const fixtures = JSON.parse(fs.readFileSync(new URL('./fixtures/qa-readonly-browser.json', import.meta.url), 'utf8'));
const check = (command) => screenshotProblems({ items: [{ id: 'T', command }], shotsDir: '/__cw_missing_shots__', executions: [] });
const t5 = fixtures[0].command;
const t6 = fixtures[1].command;
const script = t6.slice("node -e '".length, -1);
const node = s => `node -e '${s}'`;

it.each(fixtures)('真实 $id 原文只读检查不启动浏览器，不应要求截图', ({ command }) => {
  expect(isReadonlyQaCommand(command)).toBe(true);
  expect(check(command)).toEqual([]);
});

it.each([
  t6.replace('node -e', '/usr/bin/node -e'),
  t6.replace('node -e', '/opt/homebrew/bin/node -e'),
  `${t6}''`, // 相邻空引号不产生第二个参数。
  `node -e "${script.replaceAll('\\', '\\\\').replaceAll('"', '\\"')}"`,
])('完整静态参数的受支持拼写保留：%s', command => {
  expect(isReadonlyQaCommand(command)).toBe(true);
  expect(check(command)).toEqual([]);
});

it.each([
  node(script.replace('require("fs")', 'require("child_process")')),
  node(script.replace('require("fs")', 'require(process.env.MODULE)')),
  node(script.replace('require("fs")', 'require("f"+"s")')),
  node(script.replace('require("fs")', 'import("playwright")')),
  node(script.replace('const fs=', 'var fs=')),
  node(script.replace('const fs=', 'let fs=')),
  node(script.replace('const fs=', 'const JSON={parse:()=>require("playwright")};const fs=')),
  node(script.replace('const fs=', 'const console={log:()=>require("playwright")};const fs=')),
  node(script.replace('const fs=', 'const Error=()=>require("playwright");const fs=')),
  node(script.replace('const fs=', 'const require=()=>require("playwright");const fs=')),
  node(script.replace('x=>x.key', 'fs=>fs.key')),
  node(script.replace('x=>x.key', 'JSON=>JSON.key')),
  node(script.replace('x=>x.key', '(x=process.exit(0))=>x.key')),
  node(script.replace('x=>x.key==="zenithjoy-workspace"', 'x=>{return x.key==="zenithjoy-workspace"}')),
  node(script.replace('x=>x.key==="zenithjoy-workspace"', 'x=>(process.exit(0),true)')),
  node(script.replace('x=>x.key==="zenithjoy-workspace"', 'async x=>x.key==="zenithjoy-workspace"')),
  node(script.replace('r.repos', 'r.__proto__')),
  node(script.replace('r.repos', 'r["constructor"]')),
  node(script.replace('r.repos', 'r.constr\\u0075ctor')),
  node(script.replace('r.repos', 'r[process.env.KEY]')),
  node(script.replace('r.repos', 'r["re"+"pos"]')),
  node(script.replace('r.repos', 'r?.repos')),
  node(script.replace('JSON.parse(', 'JSON["constructor"](')),
  node(script.replace('JSON.parse(', 'eval(')),
  node(script.replace('JSON.parse(', 'Function(')),
  node(script.replace('JSON.parse(', 'new Function(')),
  node(script.replace('"utf8"', 'process.env.ENCODING')),
  node(script.replace('"packages/brain/scripts/coding-workflow/runner/README.md"', 'process.env.FILE')),
  node(script.replace('packages/brain/scripts/coding-workflow/runner/README.md', '../README.md')),
  node(script.replace('packages/brain/scripts/coding-workflow/runner/README.md', '/tmp/README.md')),
  node(script.replace('packages/brain/scripts/coding-workflow/runner/README.md', '.secret.json')),
  node(script.replace('console.log(', 'console.log.call(null,')),
  node(script.replace('console.log(', 'process.stdout.write(')),
  node(script.replace('console.log(', 'globalThis.console.log(')),
  node(script.replace('const fs=', '/* playwright */const fs=')),
  node(script + ';fs.writeFileSync("out","playwright")'),
  node(script + ';fs.readFileSync=()=>"playwright"'),
  node(script + ';JSON.parse=()=>"playwright"'),
  node(script + ';Object.prototype.find=()=>require("playwright")'),
  node(script + ';process.exit(0)'),
  node(script + ';(()=>require("playwright"))()'),
  node(script + ';eval("playwright")'),
  node(script + ';import("playwright")'),
  node(script + ';require("playwright").chromium.launch()'),
  t6 + ' --require playwright', t6 + ' && true', t6 + '\ntrue',
  t6 + ' 2>/dev/null', t6 + ' | cat',
  t6.replace('node -e', 'env node -e'), t6.replace('node -e', 'node\n-e'),
  t6.replace('node -e', 'node -r playwright -e'),
  t5.replace('$(git rev-parse HEAD)', '$(npx playwright --version)'),
  t5.replace('curl -fsS', 'curl --config malicious -fsS'),
  t5.replace('http://localhost:5301', 'http://example.com:5301'),
  t5.replace('&& node -e', '; node -e'),
  t5.replace('.git_sha == $sha', 'true'),
  t5.replace('node -e', 'npx playwright --version; node -e'),
])('未知 AST / 副作用 / 原型 / 遮蔽 / shell 封套不得证明只读：%s', command => {
  expect(isReadonlyQaCommand(command)).toBe(false);
  expect(check(command)).toEqual(['screenshot_none:T']);
});

it('只读证明不会把注释/模板/对象访问当字符串删除，也不凭“未见浏览器事件”放行', () => {
  for (const command of [node('console.log("playwright")'), node('const x=`playwright ${process.exit(0)}`'), node('const x={get playwright(){return require("playwright")}};x.playwright')]) {
    expect(isReadonlyQaCommand(command)).toBe(false);
    expect(check(command)).toEqual(['screenshot_none:T']);
  }
});

it('真实执行两份原文的 node 参数：完整文本/JSON通过，缺文件失败，读取不修改文件', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cw-readonly-files-'));
  const base = 'packages/brain/scripts/coding-workflow/';
  const files = {
    [base+'runner/README.md']: ['40 位 head SHA','CURL_HOME','同源 HTTP API','隔离 Chromium','CANNOT_VERIFY','WebSocket','Service Worker','跨源','playwright-1.62.1/node_modules','playwright-core','integrity','node_modules','chromium.launch({headless:true','preview_browser_unavailable','automerge=false','PR #2132','人工放行'].join('\n'),
    [base+'lib/preview-bridge.mjs']: 'body?.git_sha !== headSha\npreview_redirect_forbidden',
    [base+'lib/preview-browser.mjs']: "serviceWorkers: 'block'\nrouteWebSocket\npreview_browser_unavailable",
    [base+'runner/lib/merge-gate.mjs']: 'automerge=false',
    [base+'repos.json']: JSON.stringify({repos:[{key:'zenithjoy-workspace',automerge:false}]}),
    'package-lock.json': JSON.stringify({packages:{'node_modules/playwright':{version:'1.62.1'},'node_modules/playwright-core':{version:'1.62.1'}}}),
  };
  try {
    for (const [file, content] of Object.entries(files)) {
      const target = path.join(root,file); fs.mkdirSync(path.dirname(target),{recursive:true}); fs.writeFileSync(target,content);
    }
    for (const fixture of fixtures) {
      const result = spawnSync(process.execPath, ['-e', readonlyQaScript(fixture.command)], {cwd:root,encoding:'utf8'});
      expect(result.status,result.stderr).toBe(0);
      expect(result.stdout.trim()).toBe(fixture.output.split('\n').at(-1));
      for (const [file,content] of Object.entries(files)) expect(fs.readFileSync(path.join(root,file),'utf8')).toBe(content);
    }
    fs.unlinkSync(path.join(root,base+'runner/README.md'));
    for (const fixture of fixtures) {
      expect(spawnSync(process.execPath,['-e',readonlyQaScript(fixture.command)],{cwd:root,encoding:'utf8'}).status).not.toBe(0);
    }
  } finally { fs.rmSync(root,{recursive:true,force:true}); }
});

it.each([
  'npx playwright screenshot http://localhost:5301 shot.png',
  'node -e \'require("playwright").chromium.launch()\'',
  'node -e \'require("puppeteer").launch()\'',
  'node -e \'eval("require(\\"playwright\\").chromium.launch()")\'',
  ...fixtures.flatMap(({command}) => [
    command + '; npx playwright screenshot http://localhost:5301 shot.png',
    command.replace('const fs=require("fs")', 'const fs=require("playwright")'),
    command.replace('const fs=require("fs")', 'let fs=require("fs")'),
    command.replace('const fs=require("fs")', 'const fs=require("fs");fs.readFileSync=()=>"playwright";const unused=1'),
  ]),
])('浏览器调用及未知副作用不得豁免：%s', command => {
  expect(check(command)).toEqual(['screenshot_none:T']);
});

it('真实截图要求及截图文件存在性检查保留', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cw-browser-shots-'));
  try {
    fs.writeFileSync(path.join(root, 'shot.png'), 'fixture');
    expect(screenshotProblems({ items: [{id:'T',command:'npx playwright screenshot http://localhost:5301 shot.png'}], shotsDir: root })).toEqual([]);
    expect(screenshotProblems({ reportText: '截图: missing.png', sprintDir: root, items: [], shotsDir: root })).toEqual(['screenshot_missing:missing.png']);
  } finally { fs.rmSync(root, {recursive:true,force:true}); }
});
