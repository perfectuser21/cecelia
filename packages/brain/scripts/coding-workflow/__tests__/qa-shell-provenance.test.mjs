import { it, expect } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { screenshotProblems } from '../lib/qa-report.mjs';
import { readonlyQaScript } from '../lib/readonly-qa-command.mjs';
import { isReadonlyQaCommand } from '../lib/readonly-qa-ast.mjs';

const fixture=JSON.parse(fs.readFileSync(new URL('./fixtures/qa-shell-provenance.json',import.meta.url),'utf8'));
const quote=s=>"'"+s.replaceAll("'","'\\''")+"'";
const t13=fixture.items.find(x=>x.id==='T-13');
const status=fixture.items.filter(x=>['T-7','X-1'].includes(x.id));
const check=(items,commands=[])=>screenshotProblems({items,executions:commands.map(command=>({command})),shotsDir:'/__cw_missing_shots__'});
const query='/opt/homebrew/bin/rg --no-config -n -e \'playwright|status\' -- packages/brain/scripts/coding-workflow/runner/status.mjs';

it('真实 T13 完整相邻引号/外部转义单引号还原为同一个静态 node 参数',()=>{
  const source=readonlyQaScript(t13.command);
  expect(source).toContain('"serviceWorkers: \'block\'"');
  expect(isReadonlyQaCommand(t13.command)).toBe(true);
  expect(check([t13])).toEqual([]);
});

it.each([
  '/opt/homebrew/bin/rg','/usr/local/bin/rg','/usr/bin/rg',
])('反事实新查询仅 %s 的 no-config 明确形状不污染 status 证据',bin=>{
  const command=query.replace('/opt/homebrew/bin/rg',bin);
  expect(check(status,[command])).toEqual([]);
  expect(check(status,['/bin/zsh -lc '+quote(command)])).toEqual([]);
});

it('旧 rg 无环境证据仍未知：不能把历史 bad4 改成通过',()=>{
  expect(check(status,[fixture.pollutingCommand])).toEqual(['screenshot_none:T-7','screenshot_none:X-1']);
});

it.each([
  query.replace('--no-config ',''),query.replace('/opt/homebrew/bin/rg','rg'),
  query.replace('/opt/homebrew/bin/rg','/tmp/rg'),query.replace('/opt/homebrew/bin/rg','command rg'),
  query.replace('--no-config','--no-config --pre /tmp/processor'),
  query.replace('--no-config','--no-config --pre=/tmp/processor'),
  query.replace('-n -e','-nU -e'),query.replace('-n -e','--unknown -e'),
  query.replace('--no-config','--no-config --pcre2'),query.replace('--no-config','--no-config --files'),
  query.replace(' -e ', ' '),query.replace(' -- packages',' packages'),
  query.replace("'playwright|status'",'"playwright $FILTER"'),
  query.replace("'playwright|status'",'"playwright $(node status.mjs)"'),
  query.replace("'playwright|status'",'"playwright `node status.mjs`"'),
  query.replace('packages/brain','../packages/brain'),query.replace('packages/brain','.hidden/brain'),
  'RIPGREP_CONFIG_PATH=/tmp/config '+query,'env '+query,
  query+' > output.md',query+'; node status.mjs',query+' && true',query+' | cat',
  query+'\nnode status.mjs',query+' extra.js --pre evil',
  '/bin/zsh -lc '+quote(query)+' extra', '/bin/zsh -lc '+quote(query+'; node status.mjs'),
  'cat > status.mjs <<EOF\nrequire("playwright").chromium.launch()\nEOF',
  'node -e \'require("fs").writeFileSync("status.mjs","playwright")\'',
  'python unknown.py status.mjs playwright',
  'tee status.mjs <<EOF\nplaywright\nEOF',
])('未知查询/写脚本/配置或 shell 不消除来源疑似：%s',command=>{
  expect(check(status,[command])).toEqual(['screenshot_none:T-7','screenshot_none:X-1']);
});

it('明确只读查询不会盖掉同会话真正写脚本的浏览器来源，也不豁免浏览器项本身',()=>{
  const writer='cat > status.mjs <<EOF\nconst p=require("playwright");\nEOF';
  expect(check(status,[query,writer])).toEqual(['screenshot_none:T-7','screenshot_none:X-1']);
  expect(check([{id:'browser',command:'node -e \'require("playwright").chromium.launch()\''}],[query])).toEqual(['screenshot_none:browser']);
});

it('T13 新解析值与真实 shell→node argv 逐字一致，执行原命令缺词时非零',()=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'qa-static-word-'));
  try{
    const source=readonlyQaScript(t13.command);expect(source).not.toBeNull();
    // node -p 输出其收到的单个 argv：只还原参数，不运行其中源码。
    const word=t13.command.slice('node -e '.length);
    const argv=spawnSync('/bin/sh',['-c','node -p \'JSON.stringify(process.argv.slice(1))\' -- '+word],{encoding:'utf8'});
    expect(argv.status).toBe(0);expect(JSON.parse(argv.stdout)).toEqual([source]);
    const file=path.join(root,'packages/brain/scripts/coding-workflow/runner/README.md');
    const tokens=JSON.parse(source.match(/of (\[.*?\])/)[1]);
    fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,tokens.join('\n'));
    const run=()=>spawnSync('/bin/sh',['-c',t13.command],{cwd:root,encoding:'utf8'});
    expect(run()).toMatchObject({status:0,stdout:t13.output+'\n'});
    for(const token of tokens){const text=tokens.join('\n').replaceAll(token,'__missing__');fs.writeFileSync(file,text);expect(run().status).not.toBe(0);expect(fs.readFileSync(file,'utf8')).toBe(text);}
  }finally{fs.rmSync(root,{recursive:true,force:true});}
});

it.each([
  "'const '"+'"fs"'+"'=require(\"fs\");const s=fs.readFileSync(\"README.md\",\"utf8\");if(!s.includes(\"playwright\"))throw Error(\"missing\");'",
  "'const fs=require(\"fs\");const s=fs.readFileSync(\"README.md\",\"utf8\");if(!s.includes(\"playwright\"))throw Error(\"missing\");'"+"''",
])('相邻静态引用是一个参数而非额外 argv：%s',word=>expect(isReadonlyQaCommand('node -e '+word)).toBe(true));

it.each([
  t13.command+' extra',t13.command+'; true',t13.command+' && true',t13.command+' | cat',t13.command+' 2>/dev/null',
  t13.command+'\ntrue',t13.command+'$(true)',t13.command+'`true`',t13.command+'$X',
  t13.command.replace("'\\''","'$(true)'"),t13.command.replace("'\\''","'$X'"),
  'node -e '+t13.command.slice('node -e '.length)+'\\',
  'node -e $'+t13.command.slice('node -e '.length),
])('额外参数、展开、替换和 shell 操作仍拒：%s',command=>expect(readonlyQaScript(command)).toBeNull());

it('真实 rg 配置 --pre 会执行；新 no-config 查询读取文件但不执行预处理器',()=>{
  // 只为隔离 CLI 语义测试定位真实工具，不把任意 PATH 结果加入分类器白名单。
  const rg=spawnSync('/usr/bin/which',['rg'],{encoding:'utf8'}).stdout.trim();
  expect(rg,'测试需要真实 ripgrep').toBeTruthy();
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'qa-rg-config-'));
  try{
    const marker=path.join(root,'called'),pre=path.join(root,'pre.sh'),config=path.join(root,'rg.conf');
    fs.writeFileSync(path.join(root,'status.mjs'),'playwright\n');
    fs.writeFileSync(pre,'#!/bin/sh\nprintf called > '+quote(marker)+'\ncat "$1"\n',{mode:0o700});
    fs.writeFileSync(config,'--pre='+pre+'\n');
    const env={...process.env,RIPGREP_CONFIG_PATH:config};
    const original=spawnSync(rg,['-n','-e','playwright','--','status.mjs'],{cwd:root,env,encoding:'utf8'});
    expect(original.status,original.stderr).toBe(0);expect(fs.readFileSync(marker,'utf8')).toBe('called');fs.unlinkSync(marker);
    const safe=spawnSync(rg,['--no-config','-n','-e','playwright','--','status.mjs'],{cwd:root,env,encoding:'utf8'});
    expect(safe.status,safe.stderr).toBe(0);expect(safe.stdout).toContain('playwright');expect(fs.existsSync(marker)).toBe(false);
    expect(check(status,[query])).toEqual([]);
  }finally{fs.rmSync(root,{recursive:true,force:true});}
});

it.each(['evaluate.md','evaluate-local.md'])('入口 %s 的新查询形状确实不会污染来源',file=>{
  const prompt=fs.readFileSync(new URL('../prompts/'+file,import.meta.url),'utf8');
  const section=prompt.split('### 文档/源码调查中的查询来源')[1]?.split('\n## ')[0] || '';
  const command=section.match(/```bash\n([^]*?)```/)?.[1].trim();
  expect(command).toBeTruthy();
  expect(check(status,[command])).toEqual([]);
  expect(check(status,[command.replace('--no-config ','')])).toEqual(['screenshot_none:T-7','screenshot_none:X-1']);
});
