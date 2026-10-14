import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
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
