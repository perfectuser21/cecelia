---
task_id: 6d966473-8217-4881-9373-457abef4428f
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
const cli = 'packages/brain/scripts/coding-workflow/runner/status.mjs';
const readme = fs.readFileSync('packages/brain/scripts/coding-workflow/runner/README.md', 'utf8');
assert.match(readme, /status\.mjs \[--log-dir <dir>\] \[--json\]/);
assert.match(readme, /loadConfig\(\)\.logDir/);
assert.match(readme, /mtime 倒序/);
assert.match(readme, /\[\].*不证明服务健康/);
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cw-verify-i1-'));
try {
  const missing = path.join(dir, 'missing');
  assert.equal(execFileSync('node', [cli, '--log-dir', missing, '--json'], {encoding:'utf8'}).trim(), '[]');
  assert.equal(execFileSync('node', [cli, '--log-dir', dir, '--json'], {encoding:'utf8'}).trim(), '[]');
  fs.writeFileSync(path.join(dir, 'old.json'), JSON.stringify({status:'completed',outputs:{pr_url:'https://github.com/o/r/pull/1'}}));
  fs.writeFileSync(path.join(dir, 'new.json'), JSON.stringify({last_event:'working'}));
  fs.utimesSync(path.join(dir, 'old.json'), 1000, 1000);
  fs.utimesSync(path.join(dir, 'new.json'), 2000, 2000);
  const rows = JSON.parse(execFileSync('node', [cli, '--log-dir', dir, '--json'], {encoding:'utf8'}));
  assert.deepEqual(rows.map(r => r.task_id), ['new','old']);
  assert.deepEqual(rows.map(r => r.status), ['running','completed']);
  console.log('I-1 PASS: README选项、默认目录、mtime倒序、空结果解释与CLI实测一致');
  console.log('缺失目录=[]；空目录=[]；排序=new,old');
} finally { fs.rmSync(dir, {recursive:true, force:true}); }
NODE
```

```output
I-1 PASS: README选项、默认目录、mtime倒序、空结果解释与CLI实测一致
缺失目录=[]；空目录=[]；排序=new,old
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
import { execFileSync } from 'node:child_process';
const cli = 'packages/brain/scripts/coding-workflow/runner/status.mjs';
const readme = fs.readFileSync('packages/brain/scripts/coding-workflow/runner/README.md','utf8');
for (const word of ['running','completed','partial','failed','unreadable','qa','commander','pr-sync-pending.json','ci_fix.attempts','ci_fix.last_result']) assert.ok(readme.includes(word), word);
assert.match(readme, /不要因此删除这些文件、待办或其它现场记录/);
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'cw-verify-i2-'));
try {
  const put=(name,value)=>fs.writeFileSync(path.join(dir,name),typeof value==='string'?value:JSON.stringify(value));
  put('running.json',{last_event:'step'});
  put('completed.json',{status:'completed',outputs:{pr_url:'https://github.com/o/r/pull/42'}});
  put('partial.json',{status:'partial',activities:[{key:'a',status:'completed'},{key:'b',status:'failed',attempts:[{reason_code:'attempt_failed'}]}]});
  put('failed.json',{status:'failed',reason_code:'receipt_failed'});
  put('qa.json',{kind:'qa'});
  put('commander.json',{kind:'commander'});
  put('pr-sync-pending.json',{kind:'pending'});
  put('broken.json','{');
  put('cifix-42.json',{attempts:[{result:'failed'},{result:'passed'}]});
  const rows=JSON.parse(execFileSync('node',[cli,'--log-dir',dir,'--json'],{encoding:'utf8'}));
  const by=Object.fromEntries(rows.map(r=>[r.task_id,r]));
  assert.equal(rows.length,8);
  assert.equal(by.running.status,'running');
  assert.equal(by.completed.status,'completed');
  assert.equal(by.partial.status,'partial');
  assert.equal(by.partial.failed_activity,'b');
  assert.equal(by.partial.reason_code,'attempt_failed');
  assert.equal(by.failed.status,'failed');
  assert.equal(by.failed.reason_code,'receipt_failed');
  for(const id of ['qa','commander','pr-sync-pending','broken']) assert.equal(by[id].status,'unreadable');
  assert.deepEqual(by.completed.ci_fix,{attempts:2,last_result:'passed'});
  assert.equal(by.failed.ci_fix,null);
  console.log('I-2 PASS: running/completed/partial/failed/unreadable与源码和CLI一致');
  console.log('非回执 qa、commander、pr-sync-pending => unreadable；cifix-42不列任务行');
  console.log('ci_fix: attempts=2, last_result=passed；失败活动=b, reason_code=attempt_failed');
} finally {fs.rmSync(dir,{recursive:true,force:true});}
NODE
```

```output
I-2 PASS: running/completed/partial/failed/unreadable与源码和CLI一致
非回执 qa、commander、pr-sync-pending => unreadable；cifix-42不列任务行
ci_fix: attempts=2, last_result=passed；失败活动=b, reason_code=attempt_failed
```

### E-3
对应: I-3
verdict: PASS

```command
node --input-type=module <<'NODE'
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
const cli='packages/brain/scripts/coding-workflow/runner/status.mjs';
const readme=fs.readFileSync('packages/brain/scripts/coding-workflow/runner/README.md','utf8');
for(const phrase of ['reason_code=pr_url_missing','formatStatus','GitHub 上对应 PR 与最终 head','runner.phase=merged','merge.merged=true','QA 终态','不手工改批准、FAIL 记录或 Brain 状态']) assert.ok(readme.includes(phrase),phrase);
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'cw-verify-i3-'));
try {
  fs.writeFileSync(path.join(dir,'done.json'),JSON.stringify({status:'completed',outputs:{}}));
  const row=JSON.parse(execFileSync('node',[cli,'--log-dir',dir,'--json'],{encoding:'utf8'}))[0];
  assert.equal(row.status,'completed');
  assert.equal(row.reason_code,'pr_url_missing');
  assert.equal(row.pr_url,null);
  const line=execFileSync('node',[cli,'--log-dir',dir],{encoding:'utf8'}).trim();
  assert.match(line,/done  completed/);
  assert.ok(!line.includes('pr_url_missing'));
  console.log('I-3 PASS: completed无PR URL仍为completed，JSON reason_code=pr_url_missing');
  console.log('文本completed行未显示pr_url_missing；README要求核对PR/head、Brain合并和QA终态');
} finally {fs.rmSync(dir,{recursive:true,force:true});}
NODE
```

```output
I-3 PASS: completed无PR URL仍为completed，JSON reason_code=pr_url_missing
文本completed行未显示pr_url_missing；README要求核对PR/head、Brain合并和QA终态
```

### E-4
对应: I-4
verdict: PASS

```command
python3 - <<'PY'
import pathlib,re,subprocess
base='a039701b0bbbc739623cc73823ad47bf5e584ee7'
readme='packages/brain/scripts/coding-workflow/runner/README.md'
manifest='.implementation-source-relations.json'
sprint='sprints/10241840-cw-6d966473/'
def git(*args):
    return subprocess.check_output(['git',*args],text=True)
head=git('rev-parse','HEAD').strip()
assert re.fullmatch(r'[0-9a-f]{40}',head)
tracked=set()
for label,args in [('base_to_HEAD',('diff','--name-only',base,'HEAD')),('staged',('diff','--cached','--name-only')),('worktree',('diff','--name-only'))]:
    paths=[p for p in git(*args).splitlines() if p]
    print(label+':',paths)
    tracked.update(paths)
assert tracked=={readme},tracked
untracked=git('ls-files','--others','--exclude-standard').splitlines()
print('untracked_all:',untracked)
allowed={sprint+n for n in ['01-intent.md','01-invariants.md','02-spec.md','02-review.md','02-review-r1.md']}
assert set(untracked)==allowed,(set(untracked)-allowed,allowed-set(untracked))
old=subprocess.check_output(['git','show',f'{base}:{readme}']).splitlines(keepends=True)
new=pathlib.Path(readme).read_bytes().splitlines(keepends=True)
cursor=iter(new)
assert all(any(line==candidate for candidate in cursor) for line in old),'基线README原文或顺序被改'
assert subprocess.check_output(['git','show',f'{base}:{manifest}'])==pathlib.Path(manifest).read_bytes(),'manifest与基线不同'
print('I-4 PASS: README为唯一产品改动；基线原文逐行逐字按序保留；manifest与基线字节相同')
print('HEAD:',head)
PY
```

```output
base_to_HEAD: ['packages/brain/scripts/coding-workflow/runner/README.md']
staged: []
worktree: []
untracked_all: ['sprints/10241840-cw-6d966473/01-intent.md', 'sprints/10241840-cw-6d966473/01-invariants.md', 'sprints/10241840-cw-6d966473/02-review-r1.md', 'sprints/10241840-cw-6d966473/02-review.md', 'sprints/10241840-cw-6d966473/02-spec.md']
I-4 PASS: README为唯一产品改动；基线原文逐行逐字按序保留；manifest与基线字节相同
HEAD: 510941c0231ff43428232b2891c37e4c83d28f1d
```
