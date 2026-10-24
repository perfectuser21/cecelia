import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { B2_T3, B3_T1 } from './fixtures/qa-doc-data-commands.mjs';
import { parse } from 'acorn';
import { trivialAssertions } from '../lib/qa-report.mjs';

// 原 canary 3a27ca36 / 02-spec.md Q1：保留完整原命令，不拆 --dry-run 绕过门禁。
const script = 'const fs=require("fs");const p="packages/brain/scripts/coding-workflow/runner/README.md";const s=fs.readFileSync(p,"utf8");for(const x of ["CODING_WF_PROVIDER=codex","CODING_WF_CODEX_MODEL=gpt-6-sol","CODING_WF_JUDGE_PROVIDER=codex","CODING_WF_JUDGE_MODEL=gpt-6-astra","CODING_WF_REPOS=cecelia","--dry-run","runtime_install_disabled"])if(!s.includes(x))throw Error(x);console.log("安装手册核对通过")';
const command = `node -e '${script}'`;
const reject = (cmd) => trivialAssertions([{ id: 'Q1', verdict: 'PASS', command: cmd }]);
const node = (code) => `node -e '${code}'`;
const doubleQuoted = `node -e "${script.replaceAll('"', '\\"')}"`;

describe('只读文档中的 dry-run 字面量', () => {
  it('真实 Q1 完整命令是可失败的读取断言，不是假执行', () => {
    expect(reject(command)).toEqual([]);
  });

  it.each([
    doubleQuoted,
    command.replace('node -e', '/usr/bin/node -e'),
    command.replace('node -e', '/usr/local/bin/node -e'),
    command.replace('node -e', '/opt/homebrew/bin/node -e'),
    ` \t${command}\t `,
    node(script + ';'),
    node(script.replace('const fs=', 'const\tfs = ')),
  ])('静态完整 shell 参数允许明确支持的拼写：%s', (cmd) => {
    expect(reject(cmd)).toEqual([]);
  });

  it('真实临时文档完整时成功，缺任一词或缺文件时失败', () => {
    const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'qa-doc-assertion-'));
    const file = path.join(cwd, 'packages/brain/scripts/coding-workflow/runner/README.md');
    const tokens = JSON.parse(script.match(/of (\[.*?\])/)[1]);
    const run = () => spawnSync('/bin/sh', ['-c', command], { cwd, encoding: 'utf8' });
    try {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, tokens.join('\n'));
      expect(run()).toMatchObject({ status: 0, stdout: '安装手册核对通过\n' });
      expect(spawnSync('/bin/sh', ['-c', doubleQuoted], { cwd, encoding: 'utf8' }))
        .toMatchObject({ status: 0, stdout: '安装手册核对通过\n' });
      for (const token of tokens) {
        fs.writeFileSync(file, tokens.filter((t) => t !== token).join('\n'));
        expect(run().status).not.toBe(0);
      }
      fs.unlinkSync(file);
      expect(run().status).not.toBe(0);
    } finally { fs.rmSync(cwd, { recursive: true, force: true }); }
  });

  it.each([
    'node tool.mjs --dry-run', 'node tool.mjs "--dry-run"', 'node tool.mjs --dry-run=true',
    'bash install.sh --dry-run',
    `node -e 'require("child_process").execSync("bash install.sh --dry-run")'`,
    `${command} --dry-run`, `${command} extra`, `${command}; bash install.sh --dry-run`,
    `${command}\nbash install.sh --dry-run`, `${command} && true`, `${command} || true`, `${command}; exit 0`,
    `env ${command}`, `NODE_OPTIONS=--require=evil ${command}`, `echo ${command}`, `/bin/sh -c "${command}"`,
    command.replace('node -e', 'node\n-e'), command.replace('node -e', 'node\r-e'),
    node(script + ';require("child_process").execSync("true")'),
    node(script.replace('const fs=', '/* --dry-run */const fs=')),
    node(script.replace('const fs=', '// --dry-run\nconst fs=')),
    node(script.replace('require("fs")', 'require(`fs`)')),
    node(script.replace('readFileSync', '["readFileSync"]')),
    node(script.replace('"fs"', '"f"+"s"')),
    node(script.replace('"fs"', '"\\u0066s"')),
    node(script.replace('throw Error(x)', 'console.log(x)')),
    node(script.replace('!s.includes(x)', 's.includes(x)')),
    node(script.replace('for(const x of', 'for(const y of')),
    node(script.replace('"utf8"', 'process.env.ENCODING')),
    node(script.replace('packages/brain/scripts/coding-workflow/runner/README.md', '../README.md')),
    node(script.replace('packages/brain/scripts/coding-workflow/runner/README.md', '/tmp/README.md')),
    node(script.replace('packages/brain/scripts/coding-workflow/runner/README.md', 'README.js')),
    node(script.replace(/\[.*?\]/, '[]') + ';console.log("--dry-run")'),
    node(script.replace('console.log("安装手册核对通过")', 'console.log(process.env.X)')),
    node(script.replace('const fs=', 'const other=')),
    command.replace("node -e '", 'node -e "').replace(/'$/, '"'),
    doubleQuoted.replace('const fs=', '$X;const fs='),
    doubleQuoted.replace('const fs=', '`true`;const fs='),
    doubleQuoted.replace('const fs=', '\\$X;const fs='),
    `${command}''`, `${command} 2>/dev/null`, `${command} | cat`,
    command.slice(0, -1), command.replace('node -e ', 'node -e -- '),
    command.replace('node -e', './node -e'),
    node(script.replace('const p=', 'const\np=')),
    node(script.replace('"--dry-run"', '"--dry-run",')),
    node(script.replace('"--dry-run"', '"--dry-run", ""')),
    node(script.replace('s.includes(x)', 's.includes("--dry-run")')),
    node(script.replace('"安装手册核对通过"', '`--dry-run ${process.exit(0)}`')),
    node(script.replace('const fs=', 'const fs2=')),
    node(script.replace('console.log', 'console["log"]')),
    node(script.replace('"fs"', '"node:fs"')),
    node(script.replace('throw Error(x);', 'throw Error(x);process.exit(0);')),
  ])('未知或危险命令仍拒绝：%s', (cmd) => {
    expect(reject(cmd)).toEqual(['Q1']);
  });
});


// 两个真实坏尝试：分类器误把静态文档数据识别成 dry-run 执行。
const fixtureFiles = (source) => {
  const words = {};
  for (const n of parse(source, { ecmaVersion: 2022 }).body) {
    const call = n.type === 'ForOfStatement' && n.body?.test?.argument;
    if (call?.callee?.property?.name !== 'includes') continue;
    const key = call.callee.object.name;
    words[key] = [...(words[key] || []), ...n.right.elements.map(x => x.value)];
  }
  const plan = { title: '文档', change_kind: 'capability_change', map_scope_hint: ['F1'],
    acceptance: ['可核实'], repo: 'cecelia', gp_anchor: 'none(docs)' };
  return {
    'packages/brain/scripts/coding-workflow/runner/README.md':
      '### 单任务示例\n```json\n' + JSON.stringify(plan) + '\n```\n'
      + (words.s || []).join('\n') + '\n### 两任务批次示例\n',
    'packages/brain/scripts/coding-workflow/new-task.mjs': (words.n || []).join('\n'),
    'packages/brain/scripts/coding-workflow/runner/lib/repos.mjs': (words.r || []).join('\n'),
  };
};
const sandbox = (source, check) => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'qa-doc-data-'));
  const files = fixtureFiles(source);
  try {
    for (const [name, content] of Object.entries(files)) {
      fs.mkdirSync(path.dirname(path.join(cwd, name)), { recursive: true });
      fs.writeFileSync(path.join(cwd, name), content);
    }
    const run = (code = source) => spawnSync(process.execPath, ['-e', code], { cwd, encoding: 'utf8' });
    check({ cwd, files, run });
  } finally { fs.rmSync(cwd, { recursive: true, force: true }); }
};
const renamed = (source) => {
  const names = { fs: 'io', p: 'docPath', s: 'manual', n: 'sourceText', r: 'reposText',
    x: 'token', j: 'plan', b: 'block', cut: 'section' };
  const edits = [];
  const visit = (n, parent, key) => {
    if (!n || typeof n !== 'object') return;
    if (n.type === 'Identifier' && names[n.name]
      && !(parent?.type === 'MemberExpression' && key === 'property' && !parent.computed)) {
      edits.push([n.start, n.end, names[n.name]]);
    }
    for (const [k, v] of Object.entries(n)) {
      if (Array.isArray(v)) v.forEach(child => visit(child, n, k));
      else if (v && typeof v === 'object') visit(v, n, k);
    }
  };
  visit(parse(source, { ecmaVersion: 2022 }));
  for (const [start, end, text] of edits.sort((a, b) => b[0] - a[0])) {
    source = source.slice(0, start) + text + source.slice(end);
  }
  return source;
};

describe('qa-doc-assertion 多文件数据来源证明', () => {
  it.each([['真实T3', B2_T3], ['真实split/JSON T1', B3_T1]])('%s 不把数据marker当执行参数', (_, fixture) => {
    expect(reject(fixture.command)).toEqual([]);
    expect(reject(node(renamed(fixture.script)))).toEqual([]);
  });
  it.each([['真实T3', B2_T3], ['真实split/JSON T1', B3_T1]])('%s 在真实临时内容缺词/缺文件时必须失败', (_, fixture) => {
    sandbox(fixture.script, ({ cwd, files, run }) => {
      expect(run().status).toBe(0);
      expect(run(renamed(fixture.script)).status).toBe(0);
      for (const [file, text] of Object.entries(files).filter(([, text]) => text)) {
        fs.writeFileSync(path.join(cwd, file), '缺少所需内容');
        expect(run().status).not.toBe(0);
        fs.writeFileSync(path.join(cwd, file), text);
        fs.unlinkSync(path.join(cwd, file));
        expect(run().status).not.toBe(0);
        fs.writeFileSync(path.join(cwd, file), text);
      }
      if (fixture === B3_T1) {
        const file = Object.keys(files)[0];
        fs.writeFileSync(path.join(cwd, file), files[file].replace(/\{"title".*?\}/, '{broken'));
        expect(run().status).not.toBe(0);
      }
    });
  });
  const s = B2_T3.script;
  const j = B3_T1.script;
  it.each([
    s + ';require("child_process").execSync("true")',
    s + ';require("child_process").spawnSync("node",["tool.mjs","--dry-run"])',
    s.replace('const n=fs.readFileSync(', 'const n=unknown('),
    s.replace('if(!n.includes(x))throw Error(x)', 'if(!s.includes(x))throw Error(x)'),
    s.replace('if(!s.includes(x))throw Error(x)', 'if(false)throw Error(x)'),
    s.replace('throw Error(x)', 'console.log(x)'),
    s.replace('"utf8"', 'process.env.ENCODING'),
    s.replace('runner/README.md', '../README.md'),
    s + ';if(false)eval("--dry-run")',
    s + ';console.log("--dry-run")',
    j.replace('JSON.parse(b)', 'JSON.parse("{}")'),
    j.replace('j[x]', 'j[process.env.KEY]'),
    j.replace('String.fromCharCode(96)', 'String.fromCharCode(process.env.CODE)'),
    j.replace('.split("### 单任务示例")', '.split("")'),
    j.replace('JSON.parse(b)', 'JSON.parse(b||"{}")'),
    s.replace('const fs=', '/* --dry-run */const fs='),
    s + ';process.exit(0)',
    s.replace('if(!s.includes(x))', 'if(false&&!s.includes(x))'),
    s.replace('if(!s.includes(x))', 'if(true||!s.includes(x))'),
    s.replace('if(!n.includes(x))', 'if(n===n)'),
    s.replace('if(!s.includes(x))', 'if(!s.includes("--dry-run"))'),
    s.replace('if(!s.includes(x))', 'if(!n.includes(x))'),
    s.replace('if(!n.includes(x))', 'if(!n.includes(x)||n.includes(x))'),
    j.replace('j[x]', 'j["constructor"]'),
    j.replace('.repeat(3)', '.repeat(1000000)'),
    j.replace('String.fromCharCode(96)', 'String.fromCharCode(99999)'),
  ])('未知/执行/装饰读取/常量假断言不获豁免：%s', (code) => {
    expect(reject(node(code))).toEqual(['Q1']);
  });
});


// 静态内容里恒假的条件不能为一个读取制造“可失败”凭证。
describe('qa-doc-assertion 相关条件不能伪造依赖', () => {
  const prefix = 'const fs=require("fs");';
  const marker = 'const s=fs.readFileSync("b.md","utf8");for(const x of ["--dry-run"])if(!s.includes(x))throw Error(x);';
  it.each([
    prefix + 'const a=fs.readFileSync("a.md","utf8");const b=fs.readFileSync("a.md","utf8");if(a!==b)throw Error("same file");' + marker,
    prefix + 'const a=JSON.parse(fs.readFileSync("a.json","utf8"));if(a.x===1&&a.x!==1)throw Error("contradiction");' + marker,
    prefix + 'const a=fs.readFileSync("a.md","utf8");if(!a.includes("x")&&a.includes("xx"))throw Error("substring");' + marker,
    prefix + 'const t=fs.readFileSync("a.json","utf8");const a=JSON.parse(t);const b=JSON.parse(t.split("not-in-file")[0]);if(a.x===1&&b.x!==1)throw Error("same data");' + marker,
  ])('同源/互补/包含关系不能获得豁免：%s', (code) => {
    expect(reject(node(code))).toEqual(['Q1']);
  });
});
