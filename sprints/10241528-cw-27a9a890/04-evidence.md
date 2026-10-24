---
task_id: 27a9a890-fccc-4874-9655-420030b8587b
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
import { execFileSync } from 'node:child_process';
const root = 'packages/brain/scripts/coding-workflow/runner';
const readme = fs.readFileSync(root + '/README.md', 'utf8');
const source = fs.readFileSync(root + '/status.mjs', 'utf8');
for (const phrase of ['--log-dir <回执目录> --json', '默认 `logDir`', 'mtime 倒序', '目录不存在', '[]', '不能作为服务健康证明']) assert.ok(readme.includes(phrase), phrase);
for (const phrase of ["argv[i] === '--log-dir'", "argv[i] === '--json'", 'b.mtimeMs - a.mtimeMs', 'return []']) assert.ok(source.includes(phrase), phrase);
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cw-verify-i1-'));
try {
  const run = (...args) => execFileSync('node', [root + '/status.mjs', '--log-dir', ...args], { encoding: 'utf8' }).trim();
  assert.equal(run(dir, '--json'), '[]');
  assert.equal(run(dir).startsWith('没有运行记录'), true);
  fs.writeFileSync(path.join(dir, 'older.json'), '{"status":"completed","outputs":{"pr_url":"https://github.com/o/r/pull/1"}}');
  fs.writeFileSync(path.join(dir, 'newer.json'), '{"status":"running","last_event":"x"}');
  fs.utimesSync(path.join(dir, 'older.json'), new Date(1000), new Date(1000));
  fs.utimesSync(path.join(dir, 'newer.json'), new Date(2000), new Date(2000));
  assert.deepEqual(JSON.parse(run(dir, '--json')).map(x => x.task_id), ['newer', 'older']);
  assert.equal(run(dir).split('\n')[0].startsWith('newer  running'), true);
  assert.equal(run(path.join(dir, 'missing'), '--json'), '[]');
  console.log('I-1 PASS: README选项/排序/空结果表述与源码及真实CLI一致');
} finally { fs.rmSync(dir, { recursive: true, force: true }); }
NODE
```

```output
I-1 PASS: README选项/排序/空结果表述与源码及真实CLI一致
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
const root = 'packages/brain/scripts/coding-workflow/runner';
const readme = fs.readFileSync(root + '/README.md', 'utf8');
const receipt = fs.readFileSync(root + '/lib/receipt.mjs', 'utf8');
for (const phrase of ['`running`', '`completed`', '`partial`', '`failed`', '`unreadable`', '`failed_activity`', '`reason_code`', '`ci_fix.attempts`', '`ci_fix.last_result`', '`pr-sync-pending.json`', '不要据此删除文件']) assert.ok(readme.includes(phrase), phrase);
assert.ok(receipt.includes("failed.attempts.at(-1)?.reason_code"));
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cw-verify-i2-'));
try {
  const put = (name, value) => fs.writeFileSync(path.join(dir, name), typeof value === 'string' ? value : JSON.stringify(value));
  put('running.json', {last_event:'step'});
  put('completed.json', {status:'completed', outputs:{pr_url:'https://github.com/o/r/pull/42'}});
  put('partial.json', {status:'partial', activities:[{key:'qa',status:'failed',attempts:[{reason_code:'qa_fail'}]}]});
  put('failed.json', {status:'failed', reason_code:'run_fail'});
  put('qa-42.json', {phase:'done'});
  put('commander-42.json', {phase:'done'});
  put('pr-sync-pending.json', {pr:42});
  put('broken.json', '{');
  put('cifix-42.json', {attempts:[{result:'fail'},{result:'pass'}]});
  const rows = collectStatus(dir);
  const by = Object.fromEntries(rows.map(r => [r.task_id, r]));
  assert.equal(rows.length, 8);
  assert.equal(by.running.status, 'running');
  assert.equal(by.completed.status, 'completed');
  assert.deepEqual(by.completed.ci_fix, {attempts:2,last_result:'pass'});
  assert.equal(by.partial.failed_activity, 'qa');
  assert.equal(by.partial.reason_code, 'qa_fail');
  assert.equal(by.failed.status, 'failed');
  for (const name of ['qa-42','commander-42','pr-sync-pending','broken']) assert.equal(by[name].status, 'unreadable');
  assert.ok(formatStatus(rows).includes('ci_fix=2次 last=pass'));
  console.log('I-2 PASS: 五类状态、活动原因、ci_fix摘要及非回执JSON扫描行为均与README一致');
} finally { fs.rmSync(dir, {recursive:true,force:true}); }
NODE
```

```output
I-2 PASS: 五类状态、活动原因、ci_fix摘要及非回执JSON扫描行为均与README一致
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
for (const phrase of ['`completed` 仅表示执行器回执状态，不等于 PR 已合并', '`reason_code=pr_url_missing`', '`pr_url=null`', '文本的 completed 行默认不显示该原因', '先查看 `--json` 并核实 `pr_url`', '最终 head 确已合并', '`runner.phase=merged`', '`merge.merged=true`', 'QA 终态', '不手工修改批准状态或历史 FAIL 记录']) assert.ok(readme.includes(phrase), phrase);
const result = summarizeReceipt({status:'completed',outputs:{}});
assert.deepEqual({status:result.status, reason_code:result.reason_code, pr_url:result.pr_url}, {status:'completed',reason_code:'pr_url_missing',pr_url:null});
const line = formatStatus([{task_id:'t',status:result.status,mtime:'now',...result,ci_fix:null}]);
assert.ok(line.includes('completed'));
assert.ok(!line.includes('pr_url_missing'));
console.log('I-3 PASS: completed缺PR的真实摘要与文本行为吻合；README列明最终PR/head及Brain/QA只读判据');
NODE
```

```output
I-3 PASS: completed缺PR的真实摘要与文本行为吻合；README列明最终PR/head及Brain/QA只读判据
```

### E-4
对应: I-4
verdict: PASS

```command
python3 - <<'PY'
import re, subprocess
base = '6de9f4e25c0d0b456744a33aeca3fa92498c4138'
readme = 'packages/brain/scripts/coding-workflow/runner/README.md'
manifest = '.implementation-source-relations.json'
sprint = 'sprints/10241528-cw-27a9a890/'
def git(*args):
    return subprocess.check_output(['git', *args])
def names(*args):
    return [line.split('\t')[-1] for line in git(*args).decode().splitlines()]
head = git('rev-parse','HEAD').decode().strip()
committed = names('diff','--name-status',base,'HEAD')
staged = names('diff','--cached','--name-status')
worktree = names('diff','--name-status')
untracked = git('ls-files','--others','--exclude-standard').decode().splitlines()
print('base_sha=' + base)
print('HEAD=' + head)
print('base_to_HEAD=' + repr(committed))
print('staged=' + repr(staged))
print('worktree=' + repr(worktree))
print('untracked_all=' + repr(untracked))
assert committed == [readme]
assert not staged and not worktree
allowed = re.compile(r'^(01-intent|01-invariants|02-spec|02-review|02-review-r[1-9][0-9]*|02-response-r[1-9][0-9]*|03-build|04-evidence)\.md$')
assert all(p.startswith(sprint) and allowed.fullmatch(p[len(sprint):]) for p in untracked)
original = git('show',base + ':' + readme).splitlines(keepends=True)
current = git('show','HEAD:' + readme).splitlines(keepends=True)
it = iter(current)
assert all(any(line == candidate for candidate in it) for line in original)
assert git('show',base + ':' + manifest) == git('show','HEAD:' + manifest)
assert git('show','HEAD:' + manifest) == open(manifest,'rb').read()
print('I-4 PASS: 仅README产品变更；基线原文逐行原字节有序保留；manifest不变；全仓未跟踪仅本轮流水线记录')
PY
```

```output
base_sha=6de9f4e25c0d0b456744a33aeca3fa92498c4138
HEAD=e7dd627c310d7f12d02878093252d53aae6e5f8c
base_to_HEAD=['packages/brain/scripts/coding-workflow/runner/README.md']
staged=[]
worktree=[]
untracked_all=['sprints/10241528-cw-27a9a890/01-intent.md', 'sprints/10241528-cw-27a9a890/01-invariants.md', 'sprints/10241528-cw-27a9a890/02-response-r1.md', 'sprints/10241528-cw-27a9a890/02-response-r2.md', 'sprints/10241528-cw-27a9a890/02-review-r1.md', 'sprints/10241528-cw-27a9a890/02-review-r2.md', 'sprints/10241528-cw-27a9a890/02-review-r3.md', 'sprints/10241528-cw-27a9a890/02-review.md', 'sprints/10241528-cw-27a9a890/02-spec.md', 'sprints/10241528-cw-27a9a890/04-evidence.md']
I-4 PASS: 仅README产品变更；基线原文逐行原字节有序保留；manifest不变；全仓未跟踪仅本轮流水线记录
```

