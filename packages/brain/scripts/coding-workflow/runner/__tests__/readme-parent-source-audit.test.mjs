import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const readme = fileURLToPath(new URL('../README.md', import.meta.url));

test('README 的逐父来源命令展开嵌套文件的路径、blob 和 mode', () => {
  const repo = mkdtempSync(join(tmpdir(), 'cw-parent-audit-'));
  const git = (...args) => execFileSync('git', ['-c', 'core.hooksPath=/dev/null', ...args], {
    cwd: repo,
    encoding: 'utf8',
  }).trim();

  try {
    git('init', '-q');
    git('config', 'user.name', 'QA Fixture');
    git('config', 'user.email', 'qa@example.invalid');
    const nested = 'packages/brain/scripts/coding-workflow/runner/README.md';
    mkdirSync(join(repo, 'packages/brain/scripts/coding-workflow/runner'), { recursive: true });
    writeFileSync(join(repo, nested), 'before\n');
    git('add', nested);
    git('commit', '-qm', 'base');
    const parent = git('rev-parse', 'HEAD');
    writeFileSync(join(repo, nested), 'after\n');
    git('add', nested);
    git('commit', '-qm', 'change nested README');
    const child = git('rev-parse', 'HEAD');

    const section = readFileSync(readme, 'utf8').split('## 合并前后 HEAD、草稿 ready 双入口与交接 Learning 核账').at(-1);
    const documented = section.match(/git diff-tree [^`\n]*<父SHA> <子SHA>/)?.[0];
    assert.ok(documented, 'README 应给出逐父来源命令');
    const command = documented.replace('<父SHA>', parent).replace('<子SHA>', child);
    const output = execFileSync('sh', ['-c', command], { cwd: repo, encoding: 'utf8' });
    assert.match(output, new RegExp(`^:100644 100644 [0-9a-f]{40} [0-9a-f]{40} M\\t${nested.replaceAll('.', '\\.')}\\n$`));
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});
