#!/usr/bin/env node
// 假 claude：按 FAKE_CLAUDE_MODE（ok | nofile | auth | fail | outside）模拟 `claude -p <prompt> ...`。
import fs from 'node:fs';
import path from 'node:path';

const mode = process.env.FAKE_CLAUDE_MODE || 'ok';
const argv = process.argv.slice(2);
const prompt = argv[argv.indexOf('-p') + 1] || '';

if (mode === 'auth') {
  process.stderr.write('Invalid API key · Please run /login\n');
  process.exit(1);
}
if (mode === 'fail') {
  process.stderr.write(`${process.env.FAKE_CLAUDE_TEXT || 'something went wrong'}\n`);
  process.exit(1);
}

console.log(`FAKE_ARGS: ${argv.filter((a) => a !== prompt).join(' ')}`);
console.log(`FAKE_CWD: ${process.cwd()}`);
console.log(`FAKE_ENV: CLAUDECODE=${process.env.CLAUDECODE ?? '<unset>'} CLAUDE_CODE_ENTRYPOINT=${process.env.CLAUDE_CODE_ENTRYPOINT ?? '<unset>'} GIT_DIR=${process.env.GIT_DIR ?? '<unset>'}`);
console.log(`FAKE_INTENT_PATH: ${(prompt.match(/^INTENT_PATH: (.+)$/m) || [])[1]}`);
for (let i = 0; i < 200; i += 1) console.log(`fake claude log line ${i}`);

if (mode === 'nofile') process.exit(0);

const specPath = (prompt.match(/^SPEC_PATH: (.+)$/m) || [])[1];
const taskId = (prompt.match(/^TASK_ID: (.+)$/m) || [])[1];
const ids = ((prompt.match(/^INTENT_IDS: (.+)$/m) || [])[1] || '').split(',').map((s) => s.trim()).filter(Boolean);
const upstream = ids.map((id) => `01-intent.md#${id}`);
const sections = ids.map((id, i) => `### S-${i + 1}\n对应 ${id}：改 foo.js，验证 npm test\n`);
fs.mkdirSync(path.dirname(specPath), { recursive: true });
fs.writeFileSync(
  specPath,
  `---\ntask_id: ${taskId}\nstep: spec\nupstream: ${JSON.stringify(upstream)}\n---\n# spec\n\n${sections.join('\n')}`,
);
// outside：除合法 02-spec.md 外，再往 worktree 根（子进程 cwd）写一个越界文件
if (mode === 'outside') fs.writeFileSync('stray.txt', 'out of scope\n');
