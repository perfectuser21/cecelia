---
task_id: ecd50ab6-7553-4633-9bfe-2ae9448af68d
step: verify
upstream: ["01-intent.md#I-1", "01-intent.md#I-2", "01-intent.md#I-3", "01-intent.md#I-4"]
---

### E-1
对应: I-1
verdict: PASS

```command
node --input-type=module <<'NODE'
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
const readme = fs.readFileSync('packages/brain/scripts/coding-workflow/runner/README.md', 'utf8');
const cli = 'packages/brain/scripts/coding-workflow/runner/status.mjs';
for (const s of ['--log-dir <回执目录>', '--log-dir <回执目录> --json', 'mtime', '不能证明服务健康']) assert.ok(readme.includes(s), s);
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cw-verify-i1-'));
try {
  for (const [name, when] of [['old.json', 1000], ['new.json', 2000]]) {
    const file = path.join(dir, name);
    fs.writeFileSync(file, JSON.stringify({ status: 'completed', outputs: { pr_url: 'https://github.com/a/b/pull/1' } }));
    fs.utimesSync(file, when, when);
  }
  const run = (...args) => spawnSync(process.execPath, [cli, ...args], { encoding: 'utf8' });
  const rows = run('--log-dir', dir, '--json');
  assert.equal(rows.status, 0);
  assert.deepEqual(JSON.parse(rows.stdout).map(x => x.task_id), ['new', 'old']);
  const empty = run('--log-dir', path.join(dir, 'missing'), '--json');
  assert.equal(empty.status, 0);
  assert.deepEqual(JSON.parse(empty.stdout), []);
  const text = run('--log-dir', path.join(dir, 'missing'));
  assert.equal(text.status, 0);
  assert.match(text.stdout, /没有运行记录/);
  console.log('I-1 PASS: README 记载 --log-dir/--json 与 mtime 倒序；CLI 实测顺序 new,old；缺失目录 JSON=[]，文本=没有运行记录。');
} finally { fs.rmSync(dir, { recursive: true, force: true }); }
NODE
```

```output
I-1 PASS: README 记载 --log-dir/--json 与 mtime 倒序；CLI 实测顺序 new,old；缺失目录 JSON=[]，文本=没有运行记录。
```

### E-2
对应: I-2
verdict: PASS

```command
node --input-type=module <<'NODE'
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { collectStatus } from './packages/brain/scripts/coding-workflow/runner/status.mjs';
const readme = fs.readFileSync('packages/brain/scripts/coding-workflow/runner/README.md', 'utf8');
for (const s of ['running', 'completed', 'partial', 'failed', 'unreadable', 'qa-*.json', 'commander-*.json', 'pr-sync-pending.json', '不能据此删除文件', 'attempts', 'last_result']) assert.ok(readme.includes(s), s);
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cw-verify-i2-'));
try {
  const put = (name, value) => fs.writeFileSync(path.join(dir, name), typeof value === 'string' ? value : JSON.stringify(value));
  put('running.json', { last_event: 'step', status: 'completed' });
  put('completed.json', { status: 'completed', outputs: { pr_url: 'https://github.com/a/b/pull/42' } });
  put('partial.json', { status: 'partial', activities: [{ key: 'one', status: 'completed' }, { key: 'two', status: 'failed', attempts: [{ reason_code: 'try_failed' }] }] });
  put('failed.json', { status: 'failed', reason_code: 'run_failed' });
  put('qa-1.json', {});
  put('commander-1.json', {});
  put('pr-sync-pending.json', {});
  put('bad.json', '{');
  put('cifix-42.json', { attempts: [{ result: 'failed' }, { result: 'pushed' }] });
  const rows = Object.fromEntries(collectStatus(dir).map(x => [x.task_id, x]));
  assert.equal(rows.running.status, 'running');
  assert.equal(rows.completed.status, 'completed');
  assert.equal(rows.partial.reason_code, 'try_failed');
  assert.equal(rows.partial.failed_activity, 'two');
  assert.equal(rows.failed.reason_code, 'run_failed');
  for (const n of ['qa-1', 'commander-1', 'pr-sync-pending', 'bad']) assert.equal(rows[n].status, 'unreadable');
  assert.equal(rows['cifix-42'], undefined);
  assert.deepEqual(rows.completed.ci_fix, { attempts: 2, last_result: 'pushed' });
  console.log('I-2 PASS: running/completed/partial/failed/unreadable 实测符合 README；合法非回执 JSON 显示 unreadable；ci_fix attempts=2 last_result=pushed。');
} finally { fs.rmSync(dir, { recursive: true, force: true }); }
NODE
```

```output
I-2 PASS: running/completed/partial/failed/unreadable 实测符合 README；合法非回执 JSON 显示 unreadable；ci_fix attempts=2 last_result=pushed。
```

### E-3
对应: I-3
verdict: PASS

```command
node --input-type=module <<'NODE'
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { summarizeReceipt } from './packages/brain/scripts/coding-workflow/runner/lib/receipt.mjs';
import { formatStatus } from './packages/brain/scripts/coding-workflow/runner/status.mjs';
const readme = fs.readFileSync('packages/brain/scripts/coding-workflow/runner/README.md', 'utf8');
for (const s of ['completed` 不等于最终合并', 'pr_url_missing', '--json` 核对 `pr_url`', 'headRefOid,state,mergedAt,url', 'result.runner.phase=merged', 'result.merge.merged=true', 'result.qa_state', '只读', '不手工修改批准、FAIL 记录']) assert.ok(readme.includes(s), s);
const row = summarizeReceipt({ status: 'completed' });
assert.equal(row.status, 'completed');
assert.equal(row.pr_url, null);
assert.equal(row.reason_code, 'pr_url_missing');
const table = formatStatus([{ task_id: 'example', mtime: '2026-10-17T00:00:00.000Z', ...row, ci_fix: null }]);
assert.ok(table.includes('completed'));
assert.ok(!table.includes('pr_url_missing'));
console.log('I-3 PASS: 无 PR URL 的 completed 回执仍为 completed，JSON 原因 pr_url_missing；文本表格未显示该原因；README 要求 PR/head、Brain merge/QA 终态只读核对。');
NODE
```

```output
I-3 PASS: 无 PR URL 的 completed 回执仍为 completed，JSON 原因 pr_url_missing；文本表格未显示该原因；README 要求 PR/head、Brain merge/QA 终态只读核对。
```

### E-4
对应: I-4
verdict: PASS

```command
python3 <<'PY'
from pathlib import Path
import re
import subprocess
base = 'a2b043435339c90b40d6fa0c0df369d15b18eb49'
readme = 'packages/brain/scripts/coding-workflow/runner/README.md'
manifest = '.implementation-source-relations.json'
sprint = 'sprints/10170022-cw-ecd50ab6/'
def git(*args):
    return subprocess.check_output(['git', *args])
def names(*args):
    return [x for x in git(*args).decode().splitlines() if x]
head = names('diff', '--name-only', base, 'HEAD')
staged = names('diff', '--cached', '--name-only')
worktree = names('diff', '--name-only')
untracked = names('ls-files', '--others', '--exclude-standard')
allowed_record = re.compile(r'(?:01-intent|01-invariants|02-spec|02-review(?:-r[1-9][0-9]*)?|02-response-r[1-9][0-9]*|03-build|04-evidence)\.md$')
excluded = [p for p in untracked if p.startswith(sprint) and allowed_record.fullmatch(p[len(sprint):])]
outside = sorted(set(untracked) - set(excluded))
commits = names('rev-list', '--reverse', f'{base}..HEAD')
touched = set()
for sha in commits:
    touched.update(names('diff-tree', '--root', '--no-commit-id', '--name-only', '-r', '-m', sha))
old = git('show', f'{base}:{readme}').splitlines(keepends=True)
new = Path(readme).read_bytes().splitlines(keepends=True)
cursor = iter(new)
preserved = all(any(line == candidate for candidate in cursor) for line in old)
base_manifest = git('show', f'{base}:{manifest}')
head_manifest = git('show', f'HEAD:{manifest}')
work_manifest = Path(manifest).read_bytes()
print('base..HEAD 文件:', head)
print('逐提交触及文件:', sorted(touched))
print('暂存区文件:', staged)
print('工作区文件:', worktree)
print('全仓未跟踪文件:', untracked)
print('排除的本任务流水线记录:', excluded)
print('未跟踪越界文件:', outside)
print('基线 README 原行字节按顺序保留:', preserved, '原行数:', len(old))
print('manifest 基线/HEAD/工作区字节相同:', base_manifest == head_manifest == work_manifest)
assert head == [readme] and touched == {readme}
assert not staged and not worktree and not outside
assert preserved and base_manifest == head_manifest == work_manifest
print('I-4 PASS: 固定基线全量范围、原文保留、manifest 零差异。')
PY
```

```output
base..HEAD 文件: ['packages/brain/scripts/coding-workflow/runner/README.md']
逐提交触及文件: ['packages/brain/scripts/coding-workflow/runner/README.md']
暂存区文件: []
工作区文件: []
全仓未跟踪文件: ['sprints/10170022-cw-ecd50ab6/01-intent.md', 'sprints/10170022-cw-ecd50ab6/01-invariants.md', 'sprints/10170022-cw-ecd50ab6/02-response-r1.md', 'sprints/10170022-cw-ecd50ab6/02-review-r1.md', 'sprints/10170022-cw-ecd50ab6/02-review-r2.md', 'sprints/10170022-cw-ecd50ab6/02-review.md', 'sprints/10170022-cw-ecd50ab6/02-spec.md']
排除的本任务流水线记录: ['sprints/10170022-cw-ecd50ab6/01-intent.md', 'sprints/10170022-cw-ecd50ab6/01-invariants.md', 'sprints/10170022-cw-ecd50ab6/02-response-r1.md', 'sprints/10170022-cw-ecd50ab6/02-review-r1.md', 'sprints/10170022-cw-ecd50ab6/02-review-r2.md', 'sprints/10170022-cw-ecd50ab6/02-review.md', 'sprints/10170022-cw-ecd50ab6/02-spec.md']
未跟踪越界文件: []
基线 README 原行字节按顺序保留: True 原行数: 81
manifest 基线/HEAD/工作区字节相同: True
I-4 PASS: 固定基线全量范围、原文保留、manifest 零差异。
```
