import { it, expect } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { screenshotProblems, trivialAssertions, productionTouches } from '../lib/qa-report.mjs';
import { isReadonlyQaCommand } from '../lib/readonly-qa-ast.mjs';
import { readonlyQaScript } from '../lib/readonly-qa-command.mjs';
import { bashExecutions, unverifiedItems } from '../lib/transcript.mjs';

// Canary 3a27ca36 / QA r2 第三次：命令/输出逐字保留，来源摘要随 fixture 记录。
const { items } = JSON.parse(fs.readFileSync(new URL('./fixtures/qa-const-readonly.json', import.meta.url), 'utf8'));
const affected = items.filter(x => ['T-14','T-15','T-16','T-17','T-18','T-19','T-20','T-21'].includes(x.id));
const shots = list => screenshotProblems({ items: list, shotsDir: '/__cw_no_shots__', executions: [] });
const node = source => `node -e '${source}'`;
const text = 'const fs=require("fs");const p="README.md";const s=fs.readFileSync(p,"utf8");if(!s.includes("playwright"))throw Error("missing");';
const json = 'const fs=require("fs");const p="data.json";const s=JSON.parse(fs.readFileSync(p,"utf8"));';

it.each(affected)('真实 $id 的 const 路径与 JSON 判断可证明只读', item => {
  expect(isReadonlyQaCommand(item.command)).toBe(true);
  expect(shots([item])).toEqual([]);
});

it('完整原报告 22 项经过现有截图/断言/生产与原生证据门，误报消失', () => {
  expect(items).toHaveLength(22);
  expect(shots(items)).toEqual([]);
  expect(trivialAssertions(items)).toEqual([]);
  expect(productionTouches(items)).toEqual([]);
  // 这里只测试既有绑定规则；真实 61 命令 JSONL 整体回放另存 artifact，不伪造原生运行。
  const item = affected[0];
  const event = { type:'item.completed', item:{ type:'command_execution', id:'fixture', command:item.command, aggregated_output:item.output, exit_code:0 } };
  expect(unverifiedItems([item],bashExecutions(JSON.stringify(event)))).toEqual([]);
  event.item.command += '; node -e \'require("playwright").chromium.launch()\'';
  expect(unverifiedItems([item],bashExecutions(JSON.stringify(event)))).not.toEqual([]);
});

it.each([
  json+'if(!s.integrity)throw Error("playwright");',
  json+'if(s.unwanted)throw Error("playwright");',
  json+'if(!s.repos.find(x=>x.key==="playwright"))throw Error("missing");',
  json+'if(!s.integrity||s.version!=="1")throw Error("playwright");',
])('仅纯 JSON 数据用于真值判断：%s', source => expect(isReadonlyQaCommand(node(source))).toBe(true));

it.each([
  text.replace('const p="README.md"','let p="README.md"'),
  text.replace('const p="README.md"','var p="README.md"'),
  text.replace('const p="README.md"','const q="README.md";const p=q'),
  text.replace('const p="README.md"','const p="README"+".md"'),
  text.replace('const p="README.md"','const p=`README.md`'),
  text.replace('const p="README.md"','const p=process.env.FILE'),
  text.replace('const p="README.md"','const p=fs.readFileSync("path.md","utf8")'),
  text.replace('const p="README.md";','')+'const p="README.md";',
  text.replace('const p="README.md";','const p=q;const q="README.md";'),
  text.replace('const s=', 'p="other.md";const s='),
  text.replace('const s=', 'const p="other.md";const s='),
  text.replace('const s=', 'const reader=fs.readFileSync;const s=').replace('fs.readFileSync(p,','reader(p,'),
  text.replace('const p="README.md";const s=fs.readFileSync(p,"utf8");', 'for(const p of ["README.md"])if(!fs.readFileSync(p,"utf8").includes("playwright"))throw Error("missing");const s="playwright";'),
  text.replace('const p="README.md";','for(const p of ["README.md"])if(!p.includes("md"))throw Error("missing");'),
  text.replace('const s=', 'for(const p of ["README.md"])if(!p.includes("md"))throw Error("missing");const s='),
  ...['../README.md','/tmp/README.md','.private.json','a/../README.md','a/.private.json','README.js','README\\n.md','\\u002e\\u002e/README.md'].map(p=>text.replace('README.md',p)),
  text.replace('"utf8"','"utf16le"'),
  json+'if(!s.__proto__)throw Error("playwright");',
  json+'if(!s["constructor"])throw Error("playwright");',
  json+'if(!s["constr"+"uctor"])throw Error("playwright");',
  json+'if(!s[process.env.KEY])throw Error("playwright");',
  json+'if(!s?.integrity)throw Error("playwright");',
  json+'if(!s.integrity())throw Error("playwright");',
  json+'if(!s.repos.find(x=>x.key==="a").constructor)throw Error("playwright");',
  json+'if(!s.repos.find(p=>p.key==="playwright"))throw Error("missing");',
  json+'if(!fs)throw Error("playwright");',
  json+'if((s.integrity||"playwright").includes("a"))throw Error("missing");',
  json+'if((s.integrity&&s.other).find(x=>x.key==="playwright"))throw Error("missing");',
  json.replace('JSON.parse(fs.readFileSync(p,"utf8"))','JSON.parse(fs.readFileSync(p,"utf8"),x=>x)')+'if(!s.ok)throw Error("playwright");',
  text+'fs.writeFileSync(p,"changed");',
  text+'fs.readFileSync=()=>"playwright";',
  text+'s.extra=true;',
  text+'JSON.parse=()=>"playwright";',
  text+'require("child_process").execSync("true");',
  text+'require("playwright").chromium.launch();',
  'require("playwright").chromium.launch();'+text,
  'try{'+text+'}catch(e){}',
])('const / JSON 扩展不能授权未知路径、作用域、调用或修改：%s', source => {
  const command=node(source);
  expect(isReadonlyQaCommand(command)).toBe(false);
  expect(shots([{id:'bad',command}])).toEqual(['screenshot_none:bad']);
});

it.each([' extra',' && true',' || true','; exit 0',' 2>/dev/null',' | cat','\nnode other.mjs'])('完整 shell 封套不扩展：%s', suffix => {
  const command=node(text)+suffix;
  expect(isReadonlyQaCommand(command)).toBe(false);
  expect(shots([{id:'bad',command}])).toEqual(['screenshot_none:bad']);
});

it('原命令真实读取临时文件：正确通过、逐词缺失/JSON篡改/缺文件失败，读取无修改', () => {
  const cwd=fs.mkdtempSync(path.join(os.tmpdir(),'cw-const-assertion-'));
  try {
    for(const item of affected) {
      const source=readonlyQaScript(item.command);
      const relative=source.match(/const p="([^"]+)";/)[1];
      const target=path.join(cwd,relative);
      const tokens=source.match(/for\(const x of (\[.*?\])\)/)?.[1];
      const expected=tokens ? JSON.parse(tokens).join('\n') : item.id==='T-18'
        ? JSON.stringify({packages:{'node_modules/playwright':{version:'1.62.1',integrity:'hash'},'node_modules/playwright-core':{version:'1.62.1',integrity:'hash'}}})
        : JSON.stringify({repos:[{key:'zenithjoy-workspace',automerge:false}]});
      fs.mkdirSync(path.dirname(target),{recursive:true}); fs.writeFileSync(target,expected);
      const run=()=>spawnSync(process.execPath,['-e',source],{cwd,encoding:'utf8'});
      expect(run(),item.id).toMatchObject({status:0,stdout:item.output+'\n'});
      expect(fs.readFileSync(target,'utf8')).toBe(expected);
      const invalid=tokens ? JSON.parse(tokens).map(t=>expected.replaceAll(t,'__missing__')) : item.id==='T-18'
        ? [expected.replace('1.62.1','0.0.0'),expected.replace('"integrity":"hash"','"integrity":""'),expected.replace('"integrity":"hash"','"missing":"hash"'), '{}']
        : [JSON.stringify({repos:[]}),expected.replace('false','true'),expected.replace('zenithjoy-workspace','other')];
      for(const bad of invalid) {fs.writeFileSync(target,bad);expect(run().status,item.id).not.toBe(0);expect(fs.readFileSync(target,'utf8')).toBe(bad);}
      fs.unlinkSync(target); expect(run().status,item.id).not.toBe(0);
    }
  } finally {fs.rmSync(cwd,{recursive:true,force:true});}
});

it.each(['evaluate.md','evaluate-local.md'])('QA入口 %s 的文档示例与两种既有门兼容且缺词会失败', file => {
  const prompt=fs.readFileSync(new URL('../prompts/'+file,import.meta.url),'utf8');
  const section=prompt.split('### 合同要求文档/源码核对时')[1]?.split('\n## ')[0] || '';
  const command=section.match(/```bash\n([^]*?)```/)?.[1].trim();
  expect(command).toBeTruthy();
  expect(isReadonlyQaCommand(command)).toBe(true);
  expect(trivialAssertions([{id:'sample',verdict:'PASS',command}])).toEqual([]);
  const cwd=fs.mkdtempSync(path.join(os.tmpdir(),'cw-const-prompt-'));
  try {
    const source=readonlyQaScript(command),tokens=JSON.parse(source.match(/of (\[.*?\])/)[1]);
    const target=path.join(cwd,source.match(/const p="([^"]+)"/)[1]);
    fs.mkdirSync(path.dirname(target),{recursive:true}); fs.writeFileSync(target,tokens.join('\n'));
    const run=()=>spawnSync(process.execPath,['-e',source],{cwd,encoding:'utf8'});
    expect(run().status).toBe(0);
    for(const token of tokens){fs.writeFileSync(target,tokens.filter(t=>t!==token).join('\n'));expect(run().status).not.toBe(0);}
  }finally{fs.rmSync(cwd,{recursive:true,force:true});}
});
