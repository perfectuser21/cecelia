---
task_id: 5190fd91-d6c9-4247-850b-5700051a4830
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
const root = 'packages/brain/scripts/coding-workflow/runner';
const readme = fs.readFileSync(root + '/README.md', 'utf8');
const source = fs.readFileSync(root + '/status.mjs', 'utf8');
const config = fs.readFileSync(root + '/lib/config.mjs', 'utf8');
for (const term of ['--log-dir', '--json', 'mtime', '倒序', '[]', '不证明服务健康', '没有运行记录']) assert.ok(readme.includes(term), term);
assert.match(source, /rows\.sort\(\(a, b\) => b\.mtimeMs - a\.mtimeMs\)/);
assert.match(config, /env\.CODING_WF_LOG_DIR \|\| path\.join\(home, '\.cecelia\/coding-workflow-runner'\)/);
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cw-verify-i1-'));
try {
  const missing = path.join(dir, 'missing');
  const run = (...args) => {
    const r = spawnSync('node', [root + '/status.mjs', ...args], { encoding: 'utf8' });
    assert.equal(r.status, 0, r.stderr);
    return r.stdout.trim();
  };
  assert.equal(run('--log-dir', missing, '--json'), '[]');
  assert.equal(run('--log-dir', missing), '没有运行记录（' + missing + '）');
  const older = path.join(dir, 'older.json'), newer = path.join(dir, 'newer.json');
  fs.writeFileSync(older, JSON.stringify({ status: 'failed' }));
  fs.writeFileSync(newer, JSON.stringify({ status: 'completed', outputs: { pr_url: 'https://github.com/o/r/pull/12' } }));
  fs.utimesSync(older, 1000, 1000);
  fs.utimesSync(newer, 2000, 2000);
  const rows = JSON.parse(run('--log-dir', dir, '--json'));
  assert.deepEqual(rows.map(r => r.task_id), ['newer', 'older']);
  console.log('I-1 README/源码参数、默认目录、mtime 倒序：PASS');
  console.log('I-1 不存在目录 JSON=[]、普通提示、退出码 0：PASS');
  console.log('I-1 临时回执排序：newer,older');
} finally { fs.rmSync(dir, { recursive: true, force: true }); }
NODE
```

```output
I-1 README/源码参数、默认目录、mtime 倒序：PASS
I-1 不存在目录 JSON=[]、普通提示、退出码 0：PASS
I-1 临时回执排序：newer,older
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
import { collectStatus, formatStatus } from './packages/brain/scripts/coding-workflow/runner/status.mjs';
const readme = fs.readFileSync('packages/brain/scripts/coding-workflow/runner/README.md', 'utf8');
for (const term of ['running', 'completed', 'partial', 'failed', 'unreadable', 'last_event', 'reason_code', 'ci_fix', 'attempts', 'last_result', 'pr-sync-pending.json', '不能单独证明文件损坏', '不能据此删除文件或待办']) assert.ok(readme.includes(term), term);
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cw-verify-i2-'));
try {
  const put = (name, value) => fs.writeFileSync(path.join(dir, name + '.json'), JSON.stringify(value));
  put('running', { last_event: 'started' });
  put('completed', { status: 'completed', outputs: { pr_url: 'https://example.test/pull/12' } });
  put('partial', { status: 'partial', activities: [{ key: 'done', status: 'completed' }, { key: 'broken', status: 'failed', attempts: [{ reason_code: 'older' }, { reason_code: 'latest' }] }] });
  put('failed', { status: 'failed', reason_code: 'receipt_fallback' });
  put('qa', { phase: 'qa', result: 'PASS' });
  put('commander', { phase: 'commander' });
  put('pr-sync-pending', { task_id: 'x', pending: true });
  put('cifix-12', { attempts: [{ result: 'failed' }, { result: 'fixed' }] });
  const rows = collectStatus(dir);
  const by = Object.fromEntries(rows.map(r => [r.task_id, r]));
  assert.equal(rows.length, 7);
  assert.equal(by.running.status, 'running');
  assert.equal(by.completed.status, 'completed');
  assert.deepEqual(by.completed.ci_fix, { attempts: 2, last_result: 'fixed' });
  assert.equal(by.partial.status, 'partial');
  assert.equal(by.partial.failed_activity, 'broken');
  assert.equal(by.partial.reason_code, 'latest');
  assert.equal(by.failed.reason_code, 'receipt_fallback');
  for (const name of ['qa', 'commander', 'pr-sync-pending']) assert.equal(by[name].status, 'unreadable');
  assert.ok(formatStatus(rows).includes('ci_fix=2次 last=fixed'));
  console.log('I-2 五种状态及 partial/failed 原因：PASS');
  console.log('I-2 ci_fix attempts=2 last_result=fixed；cifix 文件不作为回执：PASS');
  console.log('I-2 qa、commander、pr-sync-pending 合法 JSON 均显示 unreadable：PASS');
  console.log('I-2 README 禁止据 unreadable 删除现场：PASS');
} finally { fs.rmSync(dir, { recursive: true, force: true }); }
NODE
```

```output
I-2 五种状态及 partial/failed 原因：PASS
I-2 ci_fix attempts=2 last_result=fixed；cifix 文件不作为回执：PASS
I-2 qa、commander、pr-sync-pending 合法 JSON 均显示 unreadable：PASS
I-2 README 禁止据 unreadable 删除现场：PASS
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
const root = 'packages/brain/scripts/coding-workflow/runner';
const readme = fs.readFileSync(root + '/README.md', 'utf8');
const section = readme.split('## 运行回执如何判读\n')[1]?.split('\n## ')[0];
assert.ok(section);
for (const term of ['completed', 'PR', 'head', 'GitHub 实际合并结果', 'runner.phase=merged', 'merge.merged=true', 'QA 终态', '--json', 'pr_url', '不手工更改批准状态或历史 FAIL 记录']) assert.ok(section.includes(term), term);
assert.ok(section.includes('回执与最终合并是两项事实'));
const result = summarizeReceipt({ status: 'completed', outputs: {} });
assert.deepEqual({ status: result.status, reason_code: result.reason_code, pr_url: result.pr_url }, { status: 'completed', reason_code: 'pr_url_missing', pr_url: null });
const table = formatStatus([{ task_id: 'sample', mtime: '2026-10-17T00:00:00.000Z', ...result, ci_fix: null }]);
assert.ok(table.includes('completed'));
assert.ok(!table.includes('pr_url_missing'));
console.log('I-3 无 PR URL 的 completed：status=completed reason_code=pr_url_missing pr_url=null');
console.log('I-3 普通 completed 行不显示 pr_url_missing：PASS');
console.log('I-3 README 要求核对 PR/head、GitHub 合并、Brain merge/phase/QA 终态并禁止手工改记录：PASS');
NODE
```

```output
I-3 无 PR URL 的 completed：status=completed reason_code=pr_url_missing pr_url=null
I-3 普通 completed 行不显示 pr_url_missing：PASS
I-3 README 要求核对 PR/head、GitHub 合并、Brain merge/phase/QA 终态并禁止手工改记录：PASS
```

### E-4
对应: I-4
verdict: PASS

```command
python3 - <<'PY'
import re
import subprocess
from pathlib import Path
base = '04b88ddba4b1aa23a156d59734b4d88f621fe1e9'
readme = 'packages/brain/scripts/coding-workflow/runner/README.md'
manifest = '.implementation-source-relations.json'
sprint = 'sprints/10170627-cw-5190fd91/'
def git(*args):
    return subprocess.check_output(['git', *args])
assert git('rev-parse', '--verify', base + '^{commit}').decode().strip() == base
assert git('merge-base', '--is-ancestor', base, 'HEAD') == b''
commits = git('rev-list', '--reverse', base + '..HEAD').decode().splitlines()
for sha in commits:
    parents = git('rev-list', '--parents', '-n', '1', sha).decode().split()
    assert len(parents) == 2, parents
    changed = set(git('diff', '--name-only', '--no-renames', '-z', parents[1], sha).decode().strip('\0').split('\0'))
    assert changed == {readme}, (sha, changed)
head = set(filter(None, git('diff', '--name-only', '--no-renames', '-z', base, 'HEAD').decode().split('\0')))
staged = set(filter(None, git('diff', '--cached', '--name-only', '--no-renames', '-z').decode().split('\0')))
worktree = set(filter(None, git('diff', '--name-only', '--no-renames', '-z').decode().split('\0')))
untracked = sorted(filter(None, git('ls-files', '--others', '--exclude-standard', '-z').decode().split('\0')))
allowed = re.compile(r'(?:01-intent|01-invariants|02-spec|02-review|02-review-r[1-9][0-9]*|02-response-r[1-9][0-9]*|03-build|04-evidence)\.md')
outside = [p for p in untracked if not (p.startswith(sprint) and allowed.fullmatch(p[len(sprint):]))]
assert head == {readme}, head
assert not staged and not worktree, (staged, worktree)
assert not outside, outside
original = git('show', base + ':' + readme).splitlines(keepends=True)
current = Path(readme).read_bytes().splitlines(keepends=True)
it = iter(current)
assert all(any(line == candidate for candidate in it) for line in original)
assert git('show', base + ':' + manifest) == Path(manifest).read_bytes()
print('I-4 固定基线至 HEAD 提交数:', len(commits))
print('I-4 HEAD 产品改动:', ', '.join(sorted(head)))
print('I-4 暂存区与工作区改动: 0')
print('I-4 全仓未跟踪文件数:', len(untracked), '；越界文件数:', len(outside))
print('I-4 基线 README 原文逐行原字节保留且顺序不变：PASS')
print('I-4 manifest 与固定基线字节相同：PASS')
PY
```

```output
I-4 固定基线至 HEAD 提交数: 1
I-4 HEAD 产品改动: packages/brain/scripts/coding-workflow/runner/README.md
I-4 暂存区与工作区改动: 0
I-4 全仓未跟踪文件数: 9 ；越界文件数: 0
I-4 基线 README 原文逐行原字节保留且顺序不变：PASS
I-4 manifest 与固定基线字节相同：PASS
```

