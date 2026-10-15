import { it, expect } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { productionTouches } from '../lib/qa-report.mjs';
import { unwrapShellCommand } from '../lib/shell-command.mjs';

const fixture = JSON.parse(fs.readFileSync(new URL('./fixtures/qa-production-readonly.json', import.meta.url), 'utf8'));
const quote = s => "'" + s.replaceAll("'", "'\\''") + "'";
const node = s => 'node -e ' + quote(s);
const source = 'const fs=require("fs");const s=fs.readFileSync("README.md","utf8");if(!s.includes("curl http://localhost:5221"))throw Error("missing");console.log("checked");';
const pure = node(source);
const wrap = c => '/bin/zsh -lc ' + quote(c);
const hits = (command, patterns) => productionTouches([{ command }], patterns);
const health = port => `PREVIEW_URL=http://localhost:${port}; SHA=$(git rev-parse HEAD); curl -fsS "$PREVIEW_URL/api/brain/health" | jq -e --arg sha "$SHA" '.git_sha == $sha' && `;

it('真实 X1 普通与完整 Codex shell 封套仅读取 README，不是生产访问', () => {
  expect(unwrapShellCommand(fixture.native.command)).toBe(fixture.command);
  expect(hits(fixture.command)).toEqual([]);
  expect(hits(fixture.native.command)).toEqual([]);
});

it('自定义 production_re 同样区分纯文本读取与访问', () => {
  const cmd = pure.replace('localhost:5221', 'business.example:8088');
  expect(hits(cmd, ['business\\.example:8088'])).toEqual([]);
  expect(hits(wrap(cmd), ['business\\.example:8088'])).toEqual([]);
  const actual = health(8088) + cmd;
  expect(hits(actual, [':8088\\b'])).toEqual([actual]);
  expect(hits(wrap(actual), [':8088\\b'])).toEqual([wrap(actual)]);
});

it.each([
  health(5221) + pure, 'curl http://localhost:5221; ' + pure,
  pure + '; curl http://localhost:5221', pure + ' && curl http://localhost:5221',
  pure + ' | curl http://localhost:5221', pure + ' > result.md', pure + ' extra',
  'NODE_OPTIONS=--require=loader.cjs ' + pure, 'env ' + pure,
  pure + '$(curl http://localhost:5221)', pure + '`curl http://localhost:5221`',
  'node -e "$SCRIPT curl http://localhost:5221"',
  wrap(pure) + ' extra', wrap(wrap(pure)),
  node(source + 'fetch("http://localhost:5221");'),
  node(source + 'require("child_process").execSync("curl http://localhost:5221");'),
  node(source + 'fs.writeFileSync("out.md","curl http://localhost:5221");'),
  node(source.replace('require("fs")', 'require(process.env.MODULE)')),
  node(source + 'unknown();'),
  node(source.replace('README.md', '../README.md')),
  node(source.replace('README.md', '.hidden/README.md')),
  'curl http://localhost:5221', 'psql -h 100.79.41.61 -c "select 1"',
])('不能证明完整纯读取时仍沿用生产访问拦截：%s', command => {
  expect(hits(command)).toEqual([command]);
  expect(hits(wrap(command))).toEqual([wrap(command)]);
});

it('真实只读断言缺词即失败，运行不修改文件', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'qa-production-readonly-'));
  try {
    const file = path.join(root, 'README.md');
    for (const [text, status] of [['curl http://localhost:5221', 0], ['missing', 1]]) {
      fs.writeFileSync(file, text);
      const run = spawnSync('/bin/sh', ['-c', pure], { cwd: root, encoding: 'utf8' });
      expect(run.status).toBe(status);
      expect(fs.readFileSync(file, 'utf8')).toBe(text);
    }
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
