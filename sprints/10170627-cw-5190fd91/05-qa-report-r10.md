---
task_id: 5190fd91-d6c9-4247-850b-5700051a4830
step: evaluate
upstream: ["02-spec.md#Q-1", "02-spec.md#Q-2", "02-spec.md#Q-3", "02-spec.md#Q-4"]
---
# QA 报告（第 10 轮，环境 http://localhost:5301）

TESTED_HEAD: e155382a75885815d9cd838670df39cbb3ed9447

本任务的产品是本地 CLI 判读文档，规格明确无需 HTTP 或页面操作。本轮只在隔离临时目录造回执并运行 CLI；没有访问生产 Brain。Q-4 固定 initial base 为 `04b88ddba4b1aa23a156d59734b4d88f621fe1e9`。可信控制器本轮隐藏事件 `29ba6519-5d1d-47ee-8b93-a4c313ed260f` 指明 03/04 暂不可见；完整恢复尚未发生，由会话后的裁判核验。

### T-1
对应: Q-1
verdict: PASS
```command
set -e
D=$(mktemp -d)
node packages/brain/scripts/coding-workflow/runner/status.mjs --log-dir "$D" --json
node packages/brain/scripts/coding-workflow/runner/status.mjs --log-dir "$D"
node packages/brain/scripts/coding-workflow/runner/status.mjs --log-dir "$D/missing" --json
node packages/brain/scripts/coding-workflow/runner/status.mjs --log-dir "$D/missing"
printf '%s' '{"status":"completed","outputs":{"pr_url":"https://github.com/example/repo/pull/12"}}' > "$D/older.json"
printf '%s' '{"status":"completed","outputs":{"pr_url":"https://github.com/example/repo/pull/12"}}' > "$D/newer.json"
touch -t 202001010000 "$D/older.json"
touch -t 202101010000 "$D/newer.json"
node packages/brain/scripts/coding-workflow/runner/status.mjs --log-dir "$D" --json
```
```output
[]
没有运行记录（/var/folders/z2/c1vyr94567g4hcyzw3hvyt2r0000gn/T/tmp.73ggRPszdD）
[]
没有运行记录（/var/folders/z2/c1vyr94567g4hcyzw3hvyt2r0000gn/T/tmp.73ggRPszdD/missing）
[{"task_id":"newer","mtime":"2020-12-31T16:00:00.000Z","status":"completed","failed_activity":null,"reason_code":null,"pr_url":"https://github.com/example/repo/pull/12","ci_fix":null},{"task_id":"older","mtime":"2019-12-31T16:00:00.000Z","status":"completed","failed_activity":null,"reason_code":null,"pr_url":"https://github.com/example/repo/pull/12","ci_fix":null}]
```
退出码: 0

### T-2
对应: Q-2
verdict: PASS
```command
set -e
D=$(mktemp -d)
printf '%s' '{"last_event":{"type":"started"}}' > "$D/run.json"
printf '%s' '{"status":"partial","activities":[{"status":"failed","key":"collect","attempts":[{"reason_code":"collect_timeout"}]}]}' > "$D/partial.json"
printf '%s' '{"status":"failed","reason_code":"run_failed"}' > "$D/failed.json"
printf '%s' '{"status":"completed","outputs":{"pr_url":"https://github.com/example/repo/pull/37"}}' > "$D/ok.json"
printf '%s' '{"status":"completed","outputs":{"pr_url":"https://example.invalid/pull/37"}}' > "$D/non-github.json"
printf '%s' '{"attempts":[{"result":"failed"},{"result":"passed"}]}' > "$D/cifix-37.json"
printf '%s' '{"qa_state":"approved"}' > "$D/qa.json"
printf '%s' '{"commander_state":"done"}' > "$D/commander.json"
printf '%s' '{"pending":true}' > "$D/pr-sync-pending.json"
printf '%s' '{broken' > "$D/broken.json"
node packages/brain/scripts/coding-workflow/runner/status.mjs --log-dir "$D" --json
node packages/brain/scripts/coding-workflow/runner/status.mjs --log-dir "$D"
```
```output
[{"task_id":"broken","mtime":"2026-10-17T08:51:54.025Z","status":"unreadable","failed_activity":null,"reason_code":null,"pr_url":null,"ci_fix":null},{"task_id":"pr-sync-pending","mtime":"2026-10-17T08:51:54.025Z","status":"unreadable","failed_activity":null,"reason_code":null,"pr_url":null,"ci_fix":null},{"task_id":"commander","mtime":"2026-10-17T08:51:54.025Z","status":"unreadable","failed_activity":null,"reason_code":null,"pr_url":null,"ci_fix":null},{"task_id":"qa","mtime":"2026-10-17T08:51:54.024Z","status":"unreadable","failed_activity":null,"reason_code":null,"pr_url":null,"ci_fix":null},{"task_id":"non-github","mtime":"2026-10-17T08:51:54.024Z","status":"completed","failed_activity":null,"reason_code":null,"pr_url":"https://example.invalid/pull/37","ci_fix":{"attempts":2,"last_result":"passed"}},{"task_id":"ok","mtime":"2026-10-17T08:51:54.024Z","status":"completed","failed_activity":null,"reason_code":null,"pr_url":"https://github.com/example/repo/pull/37","ci_fix":{"attempts":2,"last_result":"passed"}},{"task_id":"failed","mtime":"2026-10-17T08:51:54.024Z","status":"failed","failed_activity":null,"reason_code":"run_failed","pr_url":null,"ci_fix":null},{"task_id":"partial","mtime":"2026-10-17T08:51:54.024Z","status":"partial","failed_activity":"collect","reason_code":"collect_timeout","pr_url":null,"ci_fix":null},{"task_id":"run","mtime":"2026-10-17T08:51:54.024Z","status":"running","failed_activity":null,"reason_code":null,"pr_url":null,"ci_fix":null}]
broken  unreadable  2026-10-17T08:51:54.025Z  failed_activity=- reason_code=-
pr-sync-pending  unreadable  2026-10-17T08:51:54.025Z  failed_activity=- reason_code=-
commander  unreadable  2026-10-17T08:51:54.025Z  failed_activity=- reason_code=-
qa  unreadable  2026-10-17T08:51:54.024Z  failed_activity=- reason_code=-
non-github  completed  2026-10-17T08:51:54.024Z  https://example.invalid/pull/37  ci_fix=2次 last=passed
ok  completed  2026-10-17T08:51:54.024Z  https://github.com/example/repo/pull/37  ci_fix=2次 last=passed
failed  failed  2026-10-17T08:51:54.024Z  failed_activity=- reason_code=run_failed
partial  partial  2026-10-17T08:51:54.024Z  failed_activity=collect reason_code=collect_timeout
run  running  2026-10-17T08:51:54.024Z  failed_activity=- reason_code=-
```
退出码: 0

### T-3
对应: Q-3
verdict: PASS
```command
set -e
D=$(mktemp -d)
printf '%s' '{"status":"completed","outputs":{}}' > "$D/missing-pr.json"
printf '%s' '{"status":"completed","outputs":{"pr_url":"https://github.com/example/repo/pull/38"}}' > "$D/with-pr.json"
node packages/brain/scripts/coding-workflow/runner/status.mjs --log-dir "$D" --json
node packages/brain/scripts/coding-workflow/runner/status.mjs --log-dir "$D"
```
```output
[{"task_id":"with-pr","mtime":"2026-10-17T08:51:54.024Z","status":"completed","failed_activity":null,"reason_code":null,"pr_url":"https://github.com/example/repo/pull/38","ci_fix":null},{"task_id":"missing-pr","mtime":"2026-10-17T08:51:54.024Z","status":"completed","failed_activity":null,"reason_code":"pr_url_missing","pr_url":null,"ci_fix":null}]
with-pr  completed  2026-10-17T08:51:54.024Z  https://github.com/example/repo/pull/38
missing-pr  completed  2026-10-17T08:51:54.024Z
```
退出码: 0

### T-4
对应: Q-1, Q-2, Q-3
verdict: PASS
场景: 真读最终 README，核对用法、状态、缺 PR URL、合并终态与只读诊断要求。
```command
node -e 'const fs=require("fs");const p="packages/brain/scripts/coding-workflow/runner/README.md";const s=fs.readFileSync(p,"utf8");for(const x of ["--log-dir","--json","CODING_WF_LOG_DIR","mtime","不证明服务健康","running","partial","failed","unreadable","pr-sync-pending.json","非 GitHub 域名","ci_fix","pr_url_missing","runner.phase=merged","merge.merged=true","QA 终态","当前 head","实际合并","不手工更改批准状态或历史 FAIL"])if(!s.includes(x))throw Error(x);console.log("README 19 项断言通过")'
```
```output
README 19 项断言通过
```
退出码: 0

### T-5
对应: Q-4
verdict: PASS
场景: 固定 HEAD、完整 DAG、基线至 HEAD 路径差异、暂存区、工作区和全仓未跟踪文件，分别以真实 Git 命令读取。工作区只显示本轮受控隐藏的两份文件。
```command
git rev-parse HEAD
```
```output
e155382a75885815d9cd838670df39cbb3ed9447
```
退出码: 0

```command
git rev-list --reverse --topo-order --parents 04b88ddba4b1aa23a156d59734b4d88f621fe1e9..HEAD
```
```output
178f61849d85be5a9370f23c033e48ae006cfe25 04b88ddba4b1aa23a156d59734b4d88f621fe1e9
42943dfe5fc3f0680291322a5440bcd46159cbeb 178f61849d85be5a9370f23c033e48ae006cfe25
53cdf746c0c7f446cb7b6987e170d76248999f1d 04b88ddba4b1aa23a156d59734b4d88f621fe1e9
f9460639ab0b5e2cd7b05f4f109db13a51b64f01 42943dfe5fc3f0680291322a5440bcd46159cbeb 53cdf746c0c7f446cb7b6987e170d76248999f1d
f3dbd423fab3eddea650ac361d4651f393cfd40f f9460639ab0b5e2cd7b05f4f109db13a51b64f01
200baf82ef92f25d8b10031b52596b1e24fb70a7 f3dbd423fab3eddea650ac361d4651f393cfd40f
ea0573f2d1e2a95f5cb7727a70c581d325b1fd21 200baf82ef92f25d8b10031b52596b1e24fb70a7
8fa7a1c035bd76335c99fe71ed7450d5832b49e8 ea0573f2d1e2a95f5cb7727a70c581d325b1fd21
a36edb98dcf000ff653236e7674cac6117e30652 8fa7a1c035bd76335c99fe71ed7450d5832b49e8
eb96ceb14f76a1572145644d5defc1fec6a49f1b a36edb98dcf000ff653236e7674cac6117e30652
6e0b4202c1b659de1bf99ad62d42c73d09dca6bc eb96ceb14f76a1572145644d5defc1fec6a49f1b
6f6b6af1ad459f88536235f94a8f585fdead34d5 6e0b4202c1b659de1bf99ad62d42c73d09dca6bc
acc49fa52b4ed059df42560a54663e6f34ad7ff7 6f6b6af1ad459f88536235f94a8f585fdead34d5
15c90a4a0021a40170e46aeacf6fddc91d563cf0 acc49fa52b4ed059df42560a54663e6f34ad7ff7
52e2106ed03b255f18fa834ff33cf1315944e307 15c90a4a0021a40170e46aeacf6fddc91d563cf0
83e9532d4f68a0da797664b7e8c4b9408988d894 52e2106ed03b255f18fa834ff33cf1315944e307
f2afa40e9b2fdc44f61fabb9c2cbf148091e0d75 83e9532d4f68a0da797664b7e8c4b9408988d894
a2e88ebb066f8ac8a9f7b08c4e8263299b6bdfac 53cdf746c0c7f446cb7b6987e170d76248999f1d
fd845665a3678b4f83ddfae98ba5ca432e459b81 a2e88ebb066f8ac8a9f7b08c4e8263299b6bdfac
61db485cb350b7c6e626e95b83345ec23d94bf22 fd845665a3678b4f83ddfae98ba5ca432e459b81
db16f7475971decc1b832eec7a9d952bbdf2766f f2afa40e9b2fdc44f61fabb9c2cbf148091e0d75 61db485cb350b7c6e626e95b83345ec23d94bf22
dacf5bf376fa619ebce6efdf76b1ea090edabe75 61db485cb350b7c6e626e95b83345ec23d94bf22
2732b510b621af4d35336e829617b3921e125128 dacf5bf376fa619ebce6efdf76b1ea090edabe75
73b660f6cc3e206926fbc64e572868f23d361ac4 db16f7475971decc1b832eec7a9d952bbdf2766f 2732b510b621af4d35336e829617b3921e125128
a77e886a5faa28e910bc46ac306c21ade5977847 73b660f6cc3e206926fbc64e572868f23d361ac4
6d1f6b0bb87e8cf7a824b585d0df50382ca193f8 2732b510b621af4d35336e829617b3921e125128
e155382a75885815d9cd838670df39cbb3ed9447 a77e886a5faa28e910bc46ac306c21ade5977847 6d1f6b0bb87e8cf7a824b585d0df50382ca193f8
```
退出码: 0

```command
git diff --name-status 04b88ddba4b1aa23a156d59734b4d88f621fe1e9 HEAD
```
```output
M	.brain-versions
M	.dod.md
M	.implementation-source-relations.json
M	DEFINITION.md
D	changes/cp-10170325-ci-budget-headroom.md
M	package-lock.json
M	packages/brain/VERSION
M	packages/brain/package-lock.json
M	packages/brain/package.json
M	packages/brain/scripts/coding-workflow/runner/README.md
A	packages/brain/scripts/smoke/leadgen-physical-adb-routing-smoke.sh
M	packages/brain/src/__tests__/integration/crm-store.pg.integration.test.js
M	packages/brain/src/crm/notion-content.js
M	packages/brain/src/crm/notion-content.test.js
M	packages/brain/src/crm/notion-sync.js
M	packages/brain/src/lib/__tests__/leadgen-batch-proof.test.js
M	packages/brain/src/lib/__tests__/leadgen-dispatch-contract.test.js
M	packages/brain/src/lib/__tests__/leadgen-dispatch.test.js
M	packages/brain/src/lib/__tests__/leadgen-resources.test.js
M	packages/brain/src/lib/leadgen-batch-proof.js
M	packages/brain/src/lib/leadgen-controller.js
M	packages/brain/src/lib/leadgen-controller.test.js
M	packages/brain/src/lib/leadgen-dispatch-contract.js
M	packages/brain/src/lib/leadgen-dispatch.js
M	packages/brain/src/lib/leadgen-resources.js
M	packages/quality/smoke-allowlist.txt
A	sprints/10170627-cw-5190fd91/01-intent.md
A	sprints/10170627-cw-5190fd91/01-invariants.md
A	sprints/10170627-cw-5190fd91/02-response-r1.md
A	sprints/10170627-cw-5190fd91/02-response-r2.md
A	sprints/10170627-cw-5190fd91/02-review-r1.md
A	sprints/10170627-cw-5190fd91/02-review-r2.md
A	sprints/10170627-cw-5190fd91/02-review-r3.md
A	sprints/10170627-cw-5190fd91/02-review.md
A	sprints/10170627-cw-5190fd91/02-spec.md
A	sprints/10170627-cw-5190fd91/03-build.md
A	sprints/10170627-cw-5190fd91/04-evidence.md
A	sprints/10170627-cw-5190fd91/05-qa-report-r1.md
A	sprints/10170627-cw-5190fd91/05-qa-report-r2.md
A	sprints/10170627-cw-5190fd91/05-qa-report-r3.md
A	sprints/10170627-cw-5190fd91/05-qa-report-r4.md
A	sprints/10170627-cw-5190fd91/05-qa-report-r5.md
A	sprints/10170627-cw-5190fd91/05-qa-report-r6.md
A	sprints/10170627-cw-5190fd91/05-qa-report-r7.md
A	sprints/10170627-cw-5190fd91/05-qa-report-r8.md
A	sprints/10170627-cw-5190fd91/05-qa-report-r9.md
A	sprints/10170627-cw-5190fd91/06-judge-r2.md
A	sprints/10170627-cw-5190fd91/06-judge-r3.md
A	sprints/10170627-cw-5190fd91/06-judge-r4.md
A	sprints/10170627-cw-5190fd91/06-judge-r5.md
A	sprints/10170627-cw-5190fd91/06-judge-r6.md
A	sprints/10170627-cw-5190fd91/06-judge-r7.md
A	sprints/10170627-cw-5190fd91/06-judge-r8.md
A	sprints/10170627-cw-5190fd91/06-judge-r9.md
A	sprints/10170627-cw-5190fd91/07-commander-r1.md
A	sprints/10170627-cw-5190fd91/07-commander-r2.md
A	sprints/10170627-cw-5190fd91/07-commander-r3.md
```
退出码: 0

```command
git diff --cached --name-status
```
```output

```
退出码: 0

```command
git diff --name-status
```
```output
D	sprints/10170627-cw-5190fd91/03-build.md
D	sprints/10170627-cw-5190fd91/04-evidence.md
```
退出码: 0

```command
git ls-files --others --exclude-standard
```
```output

```
退出码: 0


### T-6
对应: Q-4
verdict: PASS
场景: 对 31 条父边逐路径枚举完整 40 位 blob、mode 与字节数，重算规范 Git blob 哈希，逐条比对可见内容归属；报告核对任务、阶段、精确轮次及正文锚点，规格两次纯追加；隐藏 03/04 仅做对象哈希与模式核验。输出完整，未截断。
```command
python3 - <<'PY'
import subprocess,hashlib,json,re,sys
B='04b88ddba4b1aa23a156d59734b4d88f621fe1e9'
S='sprints/10170627-cw-5190fd91/'
H='e155382a75885815d9cd838670df39cbb3ed9447'
R='packages/brain/scripts/coding-workflow/runner/README.md'
M='.implementation-source-relations.json'
sync={'f9460639ab0b5e2cd7b05f4f109db13a51b64f01','db16f7475971decc1b832eec7a9d952bbdf2766f','73b660f6cc3e206926fbc64e572868f23d361ac4','e155382a75885815d9cd838670df39cbb3ed9447'}
def git(*a):
 p=subprocess.run(['git',*a],stdout=subprocess.PIPE,stderr=subprocess.PIPE)
 if p.returncode: raise RuntimeError('git '+str(a)+' '+p.stderr.decode(errors='replace'))
 return p.stdout
def blob(oid):
 b=git('cat-file','blob',oid)
 v=hashlib.sha1(b'blob '+str(len(b)).encode()+b'\0'+b).hexdigest()
 if v!=oid or int(git('cat-file','-s',oid))!=len(b): raise AssertionError('blob mismatch '+oid)
 return b
def at(commit,path):
 try:return git('show',commit+':'+path)
 except RuntimeError:return None
def report_rule(path,data):
 s=data.decode('utf8')
 if '/06-judge-r' in path:
  n=path.split('-r')[-1].split('.')[0]
  if ('第 '+n+' 轮') not in s[:160] or '裁决' not in s or '问题' not in s:raise AssertionError('judge round/content '+path)
  return 'judge-exact-round/decision/issues'
 if '/07-commander-r' in path:
  n=path.split('-r')[-1].split('.')[0]
  if ('第 '+n+' 次') not in s[:160] or '裁决' not in s:raise AssertionError('commander round/content '+path)
  return 'commander-exact-round/decision'
 if '/02-response-r' in path:
  if not re.search(r'### R-\d+\n处理: (采纳|拒绝|部分采纳)',s):raise AssertionError('response decision '+path)
  if '说明:' not in s:raise AssertionError('response explanation '+path)
  return 'response-round/decision/explanation'
 if path.endswith('01-invariants.md'):
  if not s.startswith('# 铁律清单') or len(re.findall(r'^### INV-',s,re.M))<10:raise AssertionError('invariants content '+path)
  return 'invariants-headings-and-rules'
 if not s.startswith('---\n') or 'task_id: 5190fd91-d6c9-4247-850b-5700051a4830' not in s.split('---',2)[1]:raise AssertionError('report frontmatter '+path)
 name=path.split('/')[-1]
 expected='intent' if name.startswith('01-') else 'spec' if name=='02-spec.md' else 'spec_review' if name.startswith(('02-review','02-response')) else 'evaluate' if name.startswith('05-') else 'judge' if name.startswith('06-') else 'commander' if name.startswith('07-') else None
 if expected and ('step: '+expected) not in s.split('---',2)[1]: raise AssertionError('report stage '+path)
 if name.startswith('05-'):
  n=name.split('-r')[-1].split('.')[0]
  if ('第 '+n+' 轮') not in s[:250] or not re.search(r'### T-\d+',s):raise AssertionError('QA exact round/cases '+path)
 if name.startswith('06-') and not ('裁决' in s or 'verdict' in s):raise AssertionError('judge decision '+path)
 if name.startswith('07-') and not ('裁决' in s or 'Commander' in s):raise AssertionError('commander decision '+path)
 return 'frontmatter/task/stage/body='+expected
lines=git('rev-list','--reverse','--topo-order','--parents',B+'..'+H).decode().splitlines()
commits=[x.split() for x in lines]
upstream=set()
for parts in commits:
 if len(parts)==3:
  second=parts[2]
  upstream.update(git('rev-list',B+'..'+second).decode().splitlines())
for parts in commits:
 c=parts[0]
 for p in parts[1:]:
  raw=git('diff','--no-ext-diff','--no-renames','--raw','--full-index','--abbrev=40',p,c,'--').decode().splitlines()
  print('EDGE',p,c,'changes',len(raw))
  for line in raw:
   meta,path=line.split('\t',1)
   fields=meta.split()
   oldmode,newmode,oldid,newid=fields[:4]
   for oid in (oldid,newid):
    if set(oid)!={'0'}:blob(oid)
   hidden=path.endswith(('03-build.md','04-evidence.md'))
   old=at(p,path) if set(oldid)!={'0'} and not hidden else None
   new=at(c,path) if set(newid)!={'0'} and not hidden else None
   oldsize=int(git('cat-file','-s',oldid)) if set(oldid)!={'0'} else 0
   newsize=int(git('cat-file','-s',newid)) if set(newid)!={'0'} else 0
   if old is not None and hashlib.sha1(b'blob '+str(len(old)).encode()+b'\0'+old).hexdigest()!=oldid:raise AssertionError('old tree '+path)
   if new is not None and hashlib.sha1(b'blob '+str(len(new)).encode()+b'\0'+new).hexdigest()!=newid:raise AssertionError('new tree '+path)
   if hidden:
    if c in sync and newid!=git('rev-parse',parts[1]+':'+path).decode().strip():raise AssertionError('sync hidden object changed '+path)
    rule='hidden-object-hash-mode-only'
   elif c in upstream:
    if path.startswith(S) or path==R:raise AssertionError('upstream touched task path '+path)
    rule='upstream-main-content'
   elif c in sync:
    other=parts[2] if p==parts[1] else parts[1]
    expected=at(other,path)
    if path==M:rule='sync-manifest-defer-source-gate'
    elif path.startswith(S) or path==R:
     if new!=at(parts[1],path):raise AssertionError('sync task content changed '+path)
     rule='sync-preserves-task-content'
    else:
     if new!=at(parts[2],path):raise AssertionError('sync upstream content mismatch '+path)
     rule='sync-matches-main-content'
   elif path==R:
    if old is None or new is None or not all(any(x==y for y in it) for it in [iter(new)] for x in old):raise AssertionError('README preservation '+c)
    rule='README-old-byte-subsequence'
   elif path==M:
    a=json.loads(old); b=json.loads(new)
    keep=a['relations']; now=b['relations']
    if now[-len(keep):]!=keep or {k:v for k,v in a.items() if k!='relations'}!={k:v for k,v in b.items() if k!='relations'}:raise AssertionError('manifest history '+c)
    added=now[:-len(keep)]
    if not added:raise AssertionError('manifest no added lines '+c)
    for x in added:
     q=x['path']
     if x!={'owner_path':'packages/brain/scripts/coding-workflow/runner/run-once.mjs','path':q,'role':'documentation'} or not q.startswith(S) or not q.endswith('.md') or at(c,q) is None:raise AssertionError('manifest relation '+q)
    rule='manifest-prefix-add='+str(len(added))+' preserved='+str(len(keep))
   elif path.startswith(S):
    if path.endswith(('03-build.md','04-evidence.md')):
     rule='hidden-object-only'
    elif new is None:raise AssertionError('task report deleted '+path)
    else:
     rule=report_rule(path,new)
     if path.endswith('02-spec.md') and old is not None:
      if not new.startswith(old):raise AssertionError('spec not pure append '+c)
      tail=new[len(old):].decode()
      if c=='200baf82ef92f25d8b10031b52596b1e24fb70a7' and not tail.lstrip().startswith('## commander 裁决（第 1 次）'):raise AssertionError('first spec append')
      if c=='eb96ceb14f76a1572145644d5defc1fec6a49f1b' and not tail.lstrip().startswith('## commander 裁决（第 2 次）'):raise AssertionError('second spec append')
      rule+=' pure-append'
   else:raise AssertionError('unowned task change '+c+' '+path)
   print('PATH',path,oldmode,newmode,oldid,newid,'bytes',oldsize,newsize,'hash=ok','content='+rule)
print('AUDIT_OK edges',sum(len(x)-1 for x in commits))
PY
```
```output
EDGE 04b88ddba4b1aa23a156d59734b4d88f621fe1e9 178f61849d85be5a9370f23c033e48ae006cfe25 changes 1
PATH packages/brain/scripts/coding-workflow/runner/README.md :100644 100644 6e6eb65f64c55bdad786b619e2e9a4ef66225297 3e8eea166d021b985bff0c71e1ccbc87d234d248 bytes 10889 13572 hash=ok content=README-old-byte-subsequence
EDGE 178f61849d85be5a9370f23c033e48ae006cfe25 42943dfe5fc3f0680291322a5440bcd46159cbeb changes 12
PATH .implementation-source-relations.json :100644 100644 b4d00c4f7ea1c087ce0511769e1e25299326cbfd 24de93e0438b1c2a800654e7e0407b2949ef5233 bytes 54286 56013 hash=ok content=manifest-prefix-add=11 preserved=307
PATH sprints/10170627-cw-5190fd91/01-intent.md :000000 100644 0000000000000000000000000000000000000000 3a1529d7a143b6fdcf1305b9d72480c22c4d3a8c bytes 0 15486 hash=ok content=frontmatter/task/stage/body=intent
PATH sprints/10170627-cw-5190fd91/01-invariants.md :000000 100644 0000000000000000000000000000000000000000 2276b9f0bca1d5fd3e422ef6e962e1259e266703 bytes 0 89736 hash=ok content=invariants-headings-and-rules
PATH sprints/10170627-cw-5190fd91/02-response-r1.md :000000 100644 0000000000000000000000000000000000000000 f89998664a7a99d3f8bfc0b8b4f0ac0955c8b83a bytes 0 589 hash=ok content=response-round/decision/explanation
PATH sprints/10170627-cw-5190fd91/02-response-r2.md :000000 100644 0000000000000000000000000000000000000000 677402ca401d014befa03669d7b1a1aa04a917b2 bytes 0 1084 hash=ok content=response-round/decision/explanation
PATH sprints/10170627-cw-5190fd91/02-review-r1.md :000000 100644 0000000000000000000000000000000000000000 8b068bd99a4c2f5abc189032698f21ad8e267be6 bytes 0 1223 hash=ok content=frontmatter/task/stage/body=spec_review
PATH sprints/10170627-cw-5190fd91/02-review-r2.md :000000 100644 0000000000000000000000000000000000000000 7c80b836bc8c5469525c21273be83ad0e8dde8fc bytes 0 1436 hash=ok content=frontmatter/task/stage/body=spec_review
PATH sprints/10170627-cw-5190fd91/02-review-r3.md :000000 100644 0000000000000000000000000000000000000000 e6922e12ac037d6b2ac8839985f3434b9d4f48e5 bytes 0 1113 hash=ok content=frontmatter/task/stage/body=spec_review
PATH sprints/10170627-cw-5190fd91/02-review.md :000000 100644 0000000000000000000000000000000000000000 e6922e12ac037d6b2ac8839985f3434b9d4f48e5 bytes 0 1113 hash=ok content=frontmatter/task/stage/body=spec_review
PATH sprints/10170627-cw-5190fd91/02-spec.md :000000 100644 0000000000000000000000000000000000000000 9827a68e93e8e7d2b0c21dcb517cb6c6848e2093 bytes 0 18898 hash=ok content=frontmatter/task/stage/body=spec
PATH sprints/10170627-cw-5190fd91/03-build.md :000000 100644 0000000000000000000000000000000000000000 0d96f563734111cfdcd2049a91b8d0973da5adff bytes 0 5095 hash=ok content=hidden-object-hash-mode-only
PATH sprints/10170627-cw-5190fd91/04-evidence.md :000000 100644 0000000000000000000000000000000000000000 46a81734ed6702902319dcbe09f211bf692b0f88 bytes 0 9894 hash=ok content=hidden-object-hash-mode-only
EDGE 04b88ddba4b1aa23a156d59734b4d88f621fe1e9 53cdf746c0c7f446cb7b6987e170d76248999f1d changes 8
PATH .brain-versions :100644 100644 765a3cb613f52cc52b92c04158a540cbe7fba43d f3d261425e53f40ece495da8192f24c6040c909d bytes 9 9 hash=ok content=upstream-main-content
PATH .implementation-source-relations.json :100644 100644 b4d00c4f7ea1c087ce0511769e1e25299326cbfd ffadfb9335a468ec6b871f54fd9a6db08ae9e09d bytes 54286 54140 hash=ok content=upstream-main-content
PATH DEFINITION.md :100644 100644 c61152020942f82f1de6315cb58dda302a1e92cc a4b46caf2f7230368a87796071009b8b35fcc44b bytes 769540 770019 hash=ok content=upstream-main-content
PATH changes/cp-10170325-ci-budget-headroom.md :100644 000000 61678453253490efe1e7e647f808ac43965eaac1 0000000000000000000000000000000000000000 bytes 479 0 hash=ok content=upstream-main-content
PATH package-lock.json :100644 100644 f6a79a39a78356e1a59b763567ac45af92e79f5b aaeb525fdffb110004342b8c6b4f96893d362179 bytes 698744 698744 hash=ok content=upstream-main-content
PATH packages/brain/VERSION :100644 100644 765a3cb613f52cc52b92c04158a540cbe7fba43d f3d261425e53f40ece495da8192f24c6040c909d bytes 9 9 hash=ok content=upstream-main-content
PATH packages/brain/package-lock.json :100644 100644 bd0894471f6609afd0506fb31cabb315e8a97b25 ecb84839f8de085394f8aa50dd5f0100b1e99465 bytes 378833 378833 hash=ok content=upstream-main-content
PATH packages/brain/package.json :100644 100644 5451dac0247ba38ee91ec7441f0ef79426ad37b5 b6a3c1c890593a7bc828afa573a4ccaff05ab2c0 bytes 1998 1998 hash=ok content=upstream-main-content
EDGE 42943dfe5fc3f0680291322a5440bcd46159cbeb f9460639ab0b5e2cd7b05f4f109db13a51b64f01 changes 8
PATH .brain-versions :100644 100644 765a3cb613f52cc52b92c04158a540cbe7fba43d f3d261425e53f40ece495da8192f24c6040c909d bytes 9 9 hash=ok content=sync-matches-main-content
PATH .implementation-source-relations.json :100644 100644 24de93e0438b1c2a800654e7e0407b2949ef5233 c4f2bb176e606551a32bf9a676b77ea69452efc4 bytes 56013 55867 hash=ok content=sync-manifest-defer-source-gate
PATH DEFINITION.md :100644 100644 c61152020942f82f1de6315cb58dda302a1e92cc a4b46caf2f7230368a87796071009b8b35fcc44b bytes 769540 770019 hash=ok content=sync-matches-main-content
PATH changes/cp-10170325-ci-budget-headroom.md :100644 000000 61678453253490efe1e7e647f808ac43965eaac1 0000000000000000000000000000000000000000 bytes 479 0 hash=ok content=sync-matches-main-content
PATH package-lock.json :100644 100644 f6a79a39a78356e1a59b763567ac45af92e79f5b aaeb525fdffb110004342b8c6b4f96893d362179 bytes 698744 698744 hash=ok content=sync-matches-main-content
PATH packages/brain/VERSION :100644 100644 765a3cb613f52cc52b92c04158a540cbe7fba43d f3d261425e53f40ece495da8192f24c6040c909d bytes 9 9 hash=ok content=sync-matches-main-content
PATH packages/brain/package-lock.json :100644 100644 bd0894471f6609afd0506fb31cabb315e8a97b25 ecb84839f8de085394f8aa50dd5f0100b1e99465 bytes 378833 378833 hash=ok content=sync-matches-main-content
PATH packages/brain/package.json :100644 100644 5451dac0247ba38ee91ec7441f0ef79426ad37b5 b6a3c1c890593a7bc828afa573a4ccaff05ab2c0 bytes 1998 1998 hash=ok content=sync-matches-main-content
EDGE 53cdf746c0c7f446cb7b6987e170d76248999f1d f9460639ab0b5e2cd7b05f4f109db13a51b64f01 changes 13
PATH .implementation-source-relations.json :100644 100644 ffadfb9335a468ec6b871f54fd9a6db08ae9e09d c4f2bb176e606551a32bf9a676b77ea69452efc4 bytes 54140 55867 hash=ok content=sync-manifest-defer-source-gate
PATH packages/brain/scripts/coding-workflow/runner/README.md :100644 100644 6e6eb65f64c55bdad786b619e2e9a4ef66225297 3e8eea166d021b985bff0c71e1ccbc87d234d248 bytes 10889 13572 hash=ok content=sync-preserves-task-content
PATH sprints/10170627-cw-5190fd91/01-intent.md :000000 100644 0000000000000000000000000000000000000000 3a1529d7a143b6fdcf1305b9d72480c22c4d3a8c bytes 0 15486 hash=ok content=sync-preserves-task-content
PATH sprints/10170627-cw-5190fd91/01-invariants.md :000000 100644 0000000000000000000000000000000000000000 2276b9f0bca1d5fd3e422ef6e962e1259e266703 bytes 0 89736 hash=ok content=sync-preserves-task-content
PATH sprints/10170627-cw-5190fd91/02-response-r1.md :000000 100644 0000000000000000000000000000000000000000 f89998664a7a99d3f8bfc0b8b4f0ac0955c8b83a bytes 0 589 hash=ok content=sync-preserves-task-content
PATH sprints/10170627-cw-5190fd91/02-response-r2.md :000000 100644 0000000000000000000000000000000000000000 677402ca401d014befa03669d7b1a1aa04a917b2 bytes 0 1084 hash=ok content=sync-preserves-task-content
PATH sprints/10170627-cw-5190fd91/02-review-r1.md :000000 100644 0000000000000000000000000000000000000000 8b068bd99a4c2f5abc189032698f21ad8e267be6 bytes 0 1223 hash=ok content=sync-preserves-task-content
PATH sprints/10170627-cw-5190fd91/02-review-r2.md :000000 100644 0000000000000000000000000000000000000000 7c80b836bc8c5469525c21273be83ad0e8dde8fc bytes 0 1436 hash=ok content=sync-preserves-task-content
PATH sprints/10170627-cw-5190fd91/02-review-r3.md :000000 100644 0000000000000000000000000000000000000000 e6922e12ac037d6b2ac8839985f3434b9d4f48e5 bytes 0 1113 hash=ok content=sync-preserves-task-content
PATH sprints/10170627-cw-5190fd91/02-review.md :000000 100644 0000000000000000000000000000000000000000 e6922e12ac037d6b2ac8839985f3434b9d4f48e5 bytes 0 1113 hash=ok content=sync-preserves-task-content
PATH sprints/10170627-cw-5190fd91/02-spec.md :000000 100644 0000000000000000000000000000000000000000 9827a68e93e8e7d2b0c21dcb517cb6c6848e2093 bytes 0 18898 hash=ok content=sync-preserves-task-content
PATH sprints/10170627-cw-5190fd91/03-build.md :000000 100644 0000000000000000000000000000000000000000 0d96f563734111cfdcd2049a91b8d0973da5adff bytes 0 5095 hash=ok content=hidden-object-hash-mode-only
PATH sprints/10170627-cw-5190fd91/04-evidence.md :000000 100644 0000000000000000000000000000000000000000 46a81734ed6702902319dcbe09f211bf692b0f88 bytes 0 9894 hash=ok content=hidden-object-hash-mode-only
EDGE f9460639ab0b5e2cd7b05f4f109db13a51b64f01 f3dbd423fab3eddea650ac361d4651f393cfd40f changes 2
PATH .implementation-source-relations.json :100644 100644 c4f2bb176e606551a32bf9a676b77ea69452efc4 f3d532f650f678b481fb7125e80f72231bf50d2e bytes 55867 56028 hash=ok content=manifest-prefix-add=1 preserved=317
PATH sprints/10170627-cw-5190fd91/05-qa-report-r1.md :000000 100644 0000000000000000000000000000000000000000 766cc68f7f0cb7bd81da2711b7eb920992f04c05 bytes 0 19119 hash=ok content=frontmatter/task/stage/body=evaluate
EDGE f3dbd423fab3eddea650ac361d4651f393cfd40f 200baf82ef92f25d8b10031b52596b1e24fb70a7 changes 1
PATH sprints/10170627-cw-5190fd91/02-spec.md :100644 100644 9827a68e93e8e7d2b0c21dcb517cb6c6848e2093 51450ee5ebc6651ffd41d88a24e283dafa5ca9ae bytes 18898 21682 hash=ok content=frontmatter/task/stage/body=spec pure-append
EDGE 200baf82ef92f25d8b10031b52596b1e24fb70a7 ea0573f2d1e2a95f5cb7727a70c581d325b1fd21 changes 2
PATH .implementation-source-relations.json :100644 100644 f3d532f650f678b481fb7125e80f72231bf50d2e f0d372e0cb26eb55d12f9def947b73c081b8f963 bytes 56028 56189 hash=ok content=manifest-prefix-add=1 preserved=318
PATH sprints/10170627-cw-5190fd91/07-commander-r1.md :000000 100644 0000000000000000000000000000000000000000 fc178a6a802a0410e83cdf2c9c03233f8206bb1c bytes 0 876 hash=ok content=commander-exact-round/decision
EDGE ea0573f2d1e2a95f5cb7727a70c581d325b1fd21 8fa7a1c035bd76335c99fe71ed7450d5832b49e8 changes 3
PATH .implementation-source-relations.json :100644 100644 f0d372e0cb26eb55d12f9def947b73c081b8f963 eab6aa5c1fbf307fe497d8450d3b9837ecb6977b bytes 56189 56507 hash=ok content=manifest-prefix-add=2 preserved=319
PATH sprints/10170627-cw-5190fd91/05-qa-report-r2.md :000000 100644 0000000000000000000000000000000000000000 05e0b0b9c9bb8608cbceed644e7c8b9e8243aeee bytes 0 49562 hash=ok content=frontmatter/task/stage/body=evaluate
PATH sprints/10170627-cw-5190fd91/06-judge-r2.md :000000 100644 0000000000000000000000000000000000000000 51c02fb04eab523db35539b6572f2fd7d5a87fc4 bytes 0 2629 hash=ok content=judge-exact-round/decision/issues
EDGE 8fa7a1c035bd76335c99fe71ed7450d5832b49e8 a36edb98dcf000ff653236e7674cac6117e30652 changes 3
PATH .implementation-source-relations.json :100644 100644 eab6aa5c1fbf307fe497d8450d3b9837ecb6977b 4d1cf2084a034d37f44b2893f054eada20711b7b bytes 56507 56825 hash=ok content=manifest-prefix-add=2 preserved=321
PATH sprints/10170627-cw-5190fd91/05-qa-report-r3.md :000000 100644 0000000000000000000000000000000000000000 80d07eb72ebecb771c35ecc1222d36943b5ee8cf bytes 0 31961 hash=ok content=frontmatter/task/stage/body=evaluate
PATH sprints/10170627-cw-5190fd91/06-judge-r3.md :000000 100644 0000000000000000000000000000000000000000 19cf8a90460a19162ad5658eed7a52afbca7b245 bytes 0 2604 hash=ok content=judge-exact-round/decision/issues
EDGE a36edb98dcf000ff653236e7674cac6117e30652 eb96ceb14f76a1572145644d5defc1fec6a49f1b changes 1
PATH sprints/10170627-cw-5190fd91/02-spec.md :100644 100644 51450ee5ebc6651ffd41d88a24e283dafa5ca9ae ac6a959af50bb4cc8c451ec9a63fb8b40249f55a bytes 21682 24118 hash=ok content=frontmatter/task/stage/body=spec pure-append
EDGE eb96ceb14f76a1572145644d5defc1fec6a49f1b 6e0b4202c1b659de1bf99ad62d42c73d09dca6bc changes 2
PATH .implementation-source-relations.json :100644 100644 4d1cf2084a034d37f44b2893f054eada20711b7b c310edb1cf5a2cec343b63b1f6880d644b14bb9e bytes 56825 56986 hash=ok content=manifest-prefix-add=1 preserved=323
PATH sprints/10170627-cw-5190fd91/07-commander-r2.md :000000 100644 0000000000000000000000000000000000000000 8557e2041e46ac98747c39b971362faa73c01476 bytes 0 814 hash=ok content=commander-exact-round/decision
EDGE 6e0b4202c1b659de1bf99ad62d42c73d09dca6bc 6f6b6af1ad459f88536235f94a8f585fdead34d5 changes 3
PATH .implementation-source-relations.json :100644 100644 c310edb1cf5a2cec343b63b1f6880d644b14bb9e 7959d010b9929becc96b6ec4f49a09794436f986 bytes 56986 57304 hash=ok content=manifest-prefix-add=2 preserved=324
PATH sprints/10170627-cw-5190fd91/05-qa-report-r4.md :000000 100644 0000000000000000000000000000000000000000 87fb6a1d598e87fe04037c492ba89bd0d9e4b673 bytes 0 30876 hash=ok content=frontmatter/task/stage/body=evaluate
PATH sprints/10170627-cw-5190fd91/06-judge-r4.md :000000 100644 0000000000000000000000000000000000000000 d160e5c15e7d84936779f0130ee8d5ee714589f2 bytes 0 3147 hash=ok content=judge-exact-round/decision/issues
EDGE 6f6b6af1ad459f88536235f94a8f585fdead34d5 acc49fa52b4ed059df42560a54663e6f34ad7ff7 changes 3
PATH .implementation-source-relations.json :100644 100644 7959d010b9929becc96b6ec4f49a09794436f986 12c7a90aa088564674dff14f80493b660bafdecf bytes 57304 57622 hash=ok content=manifest-prefix-add=2 preserved=326
PATH sprints/10170627-cw-5190fd91/05-qa-report-r5.md :000000 100644 0000000000000000000000000000000000000000 688569245080675321cd6e221576d446e4891a09 bytes 0 16278 hash=ok content=frontmatter/task/stage/body=evaluate
PATH sprints/10170627-cw-5190fd91/06-judge-r5.md :000000 100644 0000000000000000000000000000000000000000 2d9eb07b649746b2c46b592c9fb994d89afec79c bytes 0 3122 hash=ok content=judge-exact-round/decision/issues
EDGE acc49fa52b4ed059df42560a54663e6f34ad7ff7 15c90a4a0021a40170e46aeacf6fddc91d563cf0 changes 3
PATH .implementation-source-relations.json :100644 100644 12c7a90aa088564674dff14f80493b660bafdecf c41636011cd352bf88b75b263900869615f54545 bytes 57622 57940 hash=ok content=manifest-prefix-add=2 preserved=328
PATH sprints/10170627-cw-5190fd91/05-qa-report-r6.md :000000 100644 0000000000000000000000000000000000000000 06675ebe45a8fe0bb2df689097c7f7e08df2962b bytes 0 19071 hash=ok content=frontmatter/task/stage/body=evaluate
PATH sprints/10170627-cw-5190fd91/06-judge-r6.md :000000 100644 0000000000000000000000000000000000000000 6d491ef52f7145dd367f863ab358b06e6458cbd9 bytes 0 2777 hash=ok content=judge-exact-round/decision/issues
EDGE 15c90a4a0021a40170e46aeacf6fddc91d563cf0 52e2106ed03b255f18fa834ff33cf1315944e307 changes 3
PATH .implementation-source-relations.json :100644 100644 c41636011cd352bf88b75b263900869615f54545 1e5b7a23fe5fc8ddc638cd35fcd97681ebbd6773 bytes 57940 58258 hash=ok content=manifest-prefix-add=2 preserved=330
PATH sprints/10170627-cw-5190fd91/05-qa-report-r7.md :000000 100644 0000000000000000000000000000000000000000 041d7d6d327c5d54c55f9d18aaa58bb0df1b3f1f bytes 0 11400 hash=ok content=frontmatter/task/stage/body=evaluate
PATH sprints/10170627-cw-5190fd91/06-judge-r7.md :000000 100644 0000000000000000000000000000000000000000 c2060875f9c27303aa8843a0e7f26ec70af900c2 bytes 0 3555 hash=ok content=judge-exact-round/decision/issues
EDGE 52e2106ed03b255f18fa834ff33cf1315944e307 83e9532d4f68a0da797664b7e8c4b9408988d894 changes 3
PATH .implementation-source-relations.json :100644 100644 1e5b7a23fe5fc8ddc638cd35fcd97681ebbd6773 d1f7ac6374e0ecba3e356de7775de5117eadb496 bytes 58258 58576 hash=ok content=manifest-prefix-add=2 preserved=332
PATH sprints/10170627-cw-5190fd91/05-qa-report-r8.md :000000 100644 0000000000000000000000000000000000000000 addc857f7c2b240942075415b9808d598ed6426f bytes 0 29257 hash=ok content=frontmatter/task/stage/body=evaluate
PATH sprints/10170627-cw-5190fd91/06-judge-r8.md :000000 100644 0000000000000000000000000000000000000000 b6d7969319acd43ce65e13921740445f10332304 bytes 0 2716 hash=ok content=judge-exact-round/decision/issues
EDGE 83e9532d4f68a0da797664b7e8c4b9408988d894 f2afa40e9b2fdc44f61fabb9c2cbf148091e0d75 changes 3
PATH .implementation-source-relations.json :100644 100644 d1f7ac6374e0ecba3e356de7775de5117eadb496 98b32b5b70cf5681b32bc46813fdeb2fc2b712cf bytes 58576 58894 hash=ok content=manifest-prefix-add=2 preserved=334
PATH sprints/10170627-cw-5190fd91/05-qa-report-r9.md :000000 100644 0000000000000000000000000000000000000000 21dc9e047e470bcf07084cd121040245c734c64e bytes 0 116015 hash=ok content=frontmatter/task/stage/body=evaluate
PATH sprints/10170627-cw-5190fd91/06-judge-r9.md :000000 100644 0000000000000000000000000000000000000000 decb11a82e9272a24e4ff0f95b250e67d692395d bytes 0 3308 hash=ok content=judge-exact-round/decision/issues
EDGE 53cdf746c0c7f446cb7b6987e170d76248999f1d a2e88ebb066f8ac8a9f7b08c4e8263299b6bdfac changes 10
PATH .brain-versions :100644 100644 f3d261425e53f40ece495da8192f24c6040c909d c06a3400387292f30d4d25034d6600ca57b85af7 bytes 9 9 hash=ok content=upstream-main-content
PATH .dod.md :100644 100644 878f57c2d6857d5d931046a35ffb8cf04d1738d2 6cf33ef5b1680f6a5ea77e5adbc116322c0a72e1 bytes 222428 223219 hash=ok content=upstream-main-content
PATH DEFINITION.md :100644 100644 a4b46caf2f7230368a87796071009b8b35fcc44b 495b74a3f05a45ce6898d96a1a94012afb37752f bytes 770019 770688 hash=ok content=upstream-main-content
PATH package-lock.json :100644 100644 aaeb525fdffb110004342b8c6b4f96893d362179 b2e8b826f0f79f6819581b7d1bf735eacdc30a84 bytes 698744 698744 hash=ok content=upstream-main-content
PATH packages/brain/package-lock.json :100644 100644 ecb84839f8de085394f8aa50dd5f0100b1e99465 b15659ae018fa5424a70121efaeedbfd61281802 bytes 378833 378833 hash=ok content=upstream-main-content
PATH packages/brain/package.json :100644 100644 b6a3c1c890593a7bc828afa573a4ccaff05ab2c0 12c367d938c205def96708d2d7adc6c75e1ff76c bytes 1998 1998 hash=ok content=upstream-main-content
PATH packages/brain/src/__tests__/integration/crm-store.pg.integration.test.js :100644 100644 83f9ec30b3d7659f71def1415cbfbe9812b15e56 22799349a36509c2acfc8e569f0d2e1cb7860729 bytes 14428 17988 hash=ok content=upstream-main-content
PATH packages/brain/src/crm/notion-content.js :100644 100644 8171b10a1d46a896fbc9a0344e83ef6976b3539b f298634d9e92d06aee146eba21e29fc5c484ca33 bytes 1650 5983 hash=ok content=upstream-main-content
PATH packages/brain/src/crm/notion-content.test.js :100644 100644 fddc9530af3ebb9e3b344e0e81911b5dc74b0b32 931421fc1c90bfebb7c0148ade21e47ac8e67a7a bytes 1203 12648 hash=ok content=upstream-main-content
PATH packages/brain/src/crm/notion-sync.js :100644 100644 50bda4d951db1be1e3f82df1d6f90f52b6b2e72e 1353447dd4babc8978c4db8d8969892edfa9bb2e bytes 10263 10272 hash=ok content=upstream-main-content
EDGE a2e88ebb066f8ac8a9f7b08c4e8263299b6bdfac fd845665a3678b4f83ddfae98ba5ca432e459b81 changes 6
PATH .brain-versions :100644 100644 c06a3400387292f30d4d25034d6600ca57b85af7 08dd5367bdac76fe26ef2f2c6e3f4fb5ca336ff0 bytes 9 9 hash=ok content=upstream-main-content
PATH DEFINITION.md :100644 100644 495b74a3f05a45ce6898d96a1a94012afb37752f a55044e301df6bad41e0ffb1a2722f5a714d0bda bytes 770688 770688 hash=ok content=upstream-main-content
PATH package-lock.json :100644 100644 b2e8b826f0f79f6819581b7d1bf735eacdc30a84 4109f2892089feb8371f91443caf753472dfde52 bytes 698744 698744 hash=ok content=upstream-main-content
PATH packages/brain/VERSION :100644 100644 f3d261425e53f40ece495da8192f24c6040c909d 08dd5367bdac76fe26ef2f2c6e3f4fb5ca336ff0 bytes 9 9 hash=ok content=upstream-main-content
PATH packages/brain/package-lock.json :100644 100644 b15659ae018fa5424a70121efaeedbfd61281802 f6aa59c8390db2690cbb07b94d77dc9ac0b8de80 bytes 378833 378833 hash=ok content=upstream-main-content
PATH packages/brain/package.json :100644 100644 12c367d938c205def96708d2d7adc6c75e1ff76c acc959c95931f8dce5ef3f33b94844e7b22ef922 bytes 1998 1998 hash=ok content=upstream-main-content
EDGE fd845665a3678b4f83ddfae98ba5ca432e459b81 61db485cb350b7c6e626e95b83345ec23d94bf22 changes 12
PATH .implementation-source-relations.json :100644 100644 ffadfb9335a468ec6b871f54fd9a6db08ae9e09d 5e9b541f31960b9374f125ebde1e6a04a1c1978b bytes 54140 54429 hash=ok content=upstream-main-content
PATH changes/cp-10171325-cw-7cc9ae9a.md :000000 100644 0000000000000000000000000000000000000000 4a1b4652b6371dc20341cf6282b16ca83e0343fb bytes 0 582 hash=ok content=upstream-main-content
PATH packages/brain/scripts/smoke/leadgen-physical-adb-routing-smoke.sh :000000 100644 0000000000000000000000000000000000000000 b4f48455262b920bf3bf99749a6cc5e4a484b182 bytes 0 11150 hash=ok content=upstream-main-content
PATH packages/brain/src/lib/__tests__/leadgen-dispatch-contract.test.js :100644 100644 4070ba66cb8a877d8fc6b65d047a2b91d5d09b20 5dfbb21e116bba6f41bb884aadc1251352e7a8b6 bytes 3209 4162 hash=ok content=upstream-main-content
PATH packages/brain/src/lib/__tests__/leadgen-dispatch.test.js :100644 100644 da6d328c9b6cb2e405d1835aea98e40eec11856d b826e192490b41b453430b53a96ea816d041bad4 bytes 9495 10532 hash=ok content=upstream-main-content
PATH packages/brain/src/lib/__tests__/leadgen-resources.test.js :100644 100644 dd456907fe5060aa7d29e57ff2994e757e0bff06 917bfaa0b0877a609255a9d4c6550701ec05c049 bytes 12613 12980 hash=ok content=upstream-main-content
PATH packages/brain/src/lib/leadgen-controller.js :100644 100644 35f0189b28438c78eb454978280f96b2ab3744f5 a47b56bffe0699b82187b2b28fcca0ce809426d4 bytes 13624 15729 hash=ok content=upstream-main-content
PATH packages/brain/src/lib/leadgen-controller.test.js :100644 100644 b46ef2dbda88fec3df96f4f44e2ae90867a83bf1 8c2ddc0d671393f327689dc12b24f8fc21c17e34 bytes 13588 16269 hash=ok content=upstream-main-content
PATH packages/brain/src/lib/leadgen-dispatch-contract.js :100644 100644 0811142a63c74dc169d0a846002a7dcf357fe55c 9d3182e19715c8c6f386bd8fb889a7e97bdebfdb bytes 6848 7090 hash=ok content=upstream-main-content
PATH packages/brain/src/lib/leadgen-dispatch.js :100644 100644 f418ccf66474b1a68751b995e6eda4e09f3b08f5 147f4db67ed06a71508d6033b221c5ebf80f425a bytes 10113 10535 hash=ok content=upstream-main-content
PATH packages/brain/src/lib/leadgen-resources.js :100644 100644 c24234923cbba2767c121255a462368c06f16d6c 824f669484ef91dab64362e9462352fef437ab5b bytes 1116 1310 hash=ok content=upstream-main-content
PATH packages/quality/smoke-allowlist.txt :100644 100644 7eae98b7945878111618caeb1b0b174a4a5c04a4 9c6d2a1d1aa0c275ce594f7ba7804dc769cdb0ac bytes 13285 13323 hash=ok content=upstream-main-content
EDGE f2afa40e9b2fdc44f61fabb9c2cbf148091e0d75 db16f7475971decc1b832eec7a9d952bbdf2766f changes 23
PATH .brain-versions :100644 100644 f3d261425e53f40ece495da8192f24c6040c909d 08dd5367bdac76fe26ef2f2c6e3f4fb5ca336ff0 bytes 9 9 hash=ok content=sync-matches-main-content
PATH .dod.md :100644 100644 878f57c2d6857d5d931046a35ffb8cf04d1738d2 6cf33ef5b1680f6a5ea77e5adbc116322c0a72e1 bytes 222428 223219 hash=ok content=sync-matches-main-content
PATH .implementation-source-relations.json :100644 100644 98b32b5b70cf5681b32bc46813fdeb2fc2b712cf 046577ea20378c19bd0bcea687faf8c23005c9e5 bytes 58894 59183 hash=ok content=sync-manifest-defer-source-gate
PATH DEFINITION.md :100644 100644 a4b46caf2f7230368a87796071009b8b35fcc44b a55044e301df6bad41e0ffb1a2722f5a714d0bda bytes 770019 770688 hash=ok content=sync-matches-main-content
PATH changes/cp-10171325-cw-7cc9ae9a.md :000000 100644 0000000000000000000000000000000000000000 4a1b4652b6371dc20341cf6282b16ca83e0343fb bytes 0 582 hash=ok content=sync-matches-main-content
PATH package-lock.json :100644 100644 aaeb525fdffb110004342b8c6b4f96893d362179 4109f2892089feb8371f91443caf753472dfde52 bytes 698744 698744 hash=ok content=sync-matches-main-content
PATH packages/brain/VERSION :100644 100644 f3d261425e53f40ece495da8192f24c6040c909d 08dd5367bdac76fe26ef2f2c6e3f4fb5ca336ff0 bytes 9 9 hash=ok content=sync-matches-main-content
PATH packages/brain/package-lock.json :100644 100644 ecb84839f8de085394f8aa50dd5f0100b1e99465 f6aa59c8390db2690cbb07b94d77dc9ac0b8de80 bytes 378833 378833 hash=ok content=sync-matches-main-content
PATH packages/brain/package.json :100644 100644 b6a3c1c890593a7bc828afa573a4ccaff05ab2c0 acc959c95931f8dce5ef3f33b94844e7b22ef922 bytes 1998 1998 hash=ok content=sync-matches-main-content
PATH packages/brain/scripts/smoke/leadgen-physical-adb-routing-smoke.sh :000000 100644 0000000000000000000000000000000000000000 b4f48455262b920bf3bf99749a6cc5e4a484b182 bytes 0 11150 hash=ok content=sync-matches-main-content
PATH packages/brain/src/__tests__/integration/crm-store.pg.integration.test.js :100644 100644 83f9ec30b3d7659f71def1415cbfbe9812b15e56 22799349a36509c2acfc8e569f0d2e1cb7860729 bytes 14428 17988 hash=ok content=sync-matches-main-content
PATH packages/brain/src/crm/notion-content.js :100644 100644 8171b10a1d46a896fbc9a0344e83ef6976b3539b f298634d9e92d06aee146eba21e29fc5c484ca33 bytes 1650 5983 hash=ok content=sync-matches-main-content
PATH packages/brain/src/crm/notion-content.test.js :100644 100644 fddc9530af3ebb9e3b344e0e81911b5dc74b0b32 931421fc1c90bfebb7c0148ade21e47ac8e67a7a bytes 1203 12648 hash=ok content=sync-matches-main-content
PATH packages/brain/src/crm/notion-sync.js :100644 100644 50bda4d951db1be1e3f82df1d6f90f52b6b2e72e 1353447dd4babc8978c4db8d8969892edfa9bb2e bytes 10263 10272 hash=ok content=sync-matches-main-content
PATH packages/brain/src/lib/__tests__/leadgen-dispatch-contract.test.js :100644 100644 4070ba66cb8a877d8fc6b65d047a2b91d5d09b20 5dfbb21e116bba6f41bb884aadc1251352e7a8b6 bytes 3209 4162 hash=ok content=sync-matches-main-content
PATH packages/brain/src/lib/__tests__/leadgen-dispatch.test.js :100644 100644 da6d328c9b6cb2e405d1835aea98e40eec11856d b826e192490b41b453430b53a96ea816d041bad4 bytes 9495 10532 hash=ok content=sync-matches-main-content
PATH packages/brain/src/lib/__tests__/leadgen-resources.test.js :100644 100644 dd456907fe5060aa7d29e57ff2994e757e0bff06 917bfaa0b0877a609255a9d4c6550701ec05c049 bytes 12613 12980 hash=ok content=sync-matches-main-content
PATH packages/brain/src/lib/leadgen-controller.js :100644 100644 35f0189b28438c78eb454978280f96b2ab3744f5 a47b56bffe0699b82187b2b28fcca0ce809426d4 bytes 13624 15729 hash=ok content=sync-matches-main-content
PATH packages/brain/src/lib/leadgen-controller.test.js :100644 100644 b46ef2dbda88fec3df96f4f44e2ae90867a83bf1 8c2ddc0d671393f327689dc12b24f8fc21c17e34 bytes 13588 16269 hash=ok content=sync-matches-main-content
PATH packages/brain/src/lib/leadgen-dispatch-contract.js :100644 100644 0811142a63c74dc169d0a846002a7dcf357fe55c 9d3182e19715c8c6f386bd8fb889a7e97bdebfdb bytes 6848 7090 hash=ok content=sync-matches-main-content
PATH packages/brain/src/lib/leadgen-dispatch.js :100644 100644 f418ccf66474b1a68751b995e6eda4e09f3b08f5 147f4db67ed06a71508d6033b221c5ebf80f425a bytes 10113 10535 hash=ok content=sync-matches-main-content
PATH packages/brain/src/lib/leadgen-resources.js :100644 100644 c24234923cbba2767c121255a462368c06f16d6c 824f669484ef91dab64362e9462352fef437ab5b bytes 1116 1310 hash=ok content=sync-matches-main-content
PATH packages/quality/smoke-allowlist.txt :100644 100644 7eae98b7945878111618caeb1b0b174a4a5c04a4 9c6d2a1d1aa0c275ce594f7ba7804dc769cdb0ac bytes 13285 13323 hash=ok content=sync-matches-main-content
EDGE 61db485cb350b7c6e626e95b83345ec23d94bf22 db16f7475971decc1b832eec7a9d952bbdf2766f changes 32
PATH .implementation-source-relations.json :100644 100644 5e9b541f31960b9374f125ebde1e6a04a1c1978b 046577ea20378c19bd0bcea687faf8c23005c9e5 bytes 54429 59183 hash=ok content=sync-manifest-defer-source-gate
PATH packages/brain/scripts/coding-workflow/runner/README.md :100644 100644 6e6eb65f64c55bdad786b619e2e9a4ef66225297 3e8eea166d021b985bff0c71e1ccbc87d234d248 bytes 10889 13572 hash=ok content=sync-preserves-task-content
PATH sprints/10170627-cw-5190fd91/01-intent.md :000000 100644 0000000000000000000000000000000000000000 3a1529d7a143b6fdcf1305b9d72480c22c4d3a8c bytes 0 15486 hash=ok content=sync-preserves-task-content
PATH sprints/10170627-cw-5190fd91/01-invariants.md :000000 100644 0000000000000000000000000000000000000000 2276b9f0bca1d5fd3e422ef6e962e1259e266703 bytes 0 89736 hash=ok content=sync-preserves-task-content
PATH sprints/10170627-cw-5190fd91/02-response-r1.md :000000 100644 0000000000000000000000000000000000000000 f89998664a7a99d3f8bfc0b8b4f0ac0955c8b83a bytes 0 589 hash=ok content=sync-preserves-task-content
PATH sprints/10170627-cw-5190fd91/02-response-r2.md :000000 100644 0000000000000000000000000000000000000000 677402ca401d014befa03669d7b1a1aa04a917b2 bytes 0 1084 hash=ok content=sync-preserves-task-content
PATH sprints/10170627-cw-5190fd91/02-review-r1.md :000000 100644 0000000000000000000000000000000000000000 8b068bd99a4c2f5abc189032698f21ad8e267be6 bytes 0 1223 hash=ok content=sync-preserves-task-content
PATH sprints/10170627-cw-5190fd91/02-review-r2.md :000000 100644 0000000000000000000000000000000000000000 7c80b836bc8c5469525c21273be83ad0e8dde8fc bytes 0 1436 hash=ok content=sync-preserves-task-content
PATH sprints/10170627-cw-5190fd91/02-review-r3.md :000000 100644 0000000000000000000000000000000000000000 e6922e12ac037d6b2ac8839985f3434b9d4f48e5 bytes 0 1113 hash=ok content=sync-preserves-task-content
PATH sprints/10170627-cw-5190fd91/02-review.md :000000 100644 0000000000000000000000000000000000000000 e6922e12ac037d6b2ac8839985f3434b9d4f48e5 bytes 0 1113 hash=ok content=sync-preserves-task-content
PATH sprints/10170627-cw-5190fd91/02-spec.md :000000 100644 0000000000000000000000000000000000000000 ac6a959af50bb4cc8c451ec9a63fb8b40249f55a bytes 0 24118 hash=ok content=sync-preserves-task-content
PATH sprints/10170627-cw-5190fd91/03-build.md :000000 100644 0000000000000000000000000000000000000000 0d96f563734111cfdcd2049a91b8d0973da5adff bytes 0 5095 hash=ok content=hidden-object-hash-mode-only
PATH sprints/10170627-cw-5190fd91/04-evidence.md :000000 100644 0000000000000000000000000000000000000000 46a81734ed6702902319dcbe09f211bf692b0f88 bytes 0 9894 hash=ok content=hidden-object-hash-mode-only
PATH sprints/10170627-cw-5190fd91/05-qa-report-r1.md :000000 100644 0000000000000000000000000000000000000000 766cc68f7f0cb7bd81da2711b7eb920992f04c05 bytes 0 19119 hash=ok content=sync-preserves-task-content
PATH sprints/10170627-cw-5190fd91/05-qa-report-r2.md :000000 100644 0000000000000000000000000000000000000000 05e0b0b9c9bb8608cbceed644e7c8b9e8243aeee bytes 0 49562 hash=ok content=sync-preserves-task-content
PATH sprints/10170627-cw-5190fd91/05-qa-report-r3.md :000000 100644 0000000000000000000000000000000000000000 80d07eb72ebecb771c35ecc1222d36943b5ee8cf bytes 0 31961 hash=ok content=sync-preserves-task-content
PATH sprints/10170627-cw-5190fd91/05-qa-report-r4.md :000000 100644 0000000000000000000000000000000000000000 87fb6a1d598e87fe04037c492ba89bd0d9e4b673 bytes 0 30876 hash=ok content=sync-preserves-task-content
PATH sprints/10170627-cw-5190fd91/05-qa-report-r5.md :000000 100644 0000000000000000000000000000000000000000 688569245080675321cd6e221576d446e4891a09 bytes 0 16278 hash=ok content=sync-preserves-task-content
PATH sprints/10170627-cw-5190fd91/05-qa-report-r6.md :000000 100644 0000000000000000000000000000000000000000 06675ebe45a8fe0bb2df689097c7f7e08df2962b bytes 0 19071 hash=ok content=sync-preserves-task-content
PATH sprints/10170627-cw-5190fd91/05-qa-report-r7.md :000000 100644 0000000000000000000000000000000000000000 041d7d6d327c5d54c55f9d18aaa58bb0df1b3f1f bytes 0 11400 hash=ok content=sync-preserves-task-content
PATH sprints/10170627-cw-5190fd91/05-qa-report-r8.md :000000 100644 0000000000000000000000000000000000000000 addc857f7c2b240942075415b9808d598ed6426f bytes 0 29257 hash=ok content=sync-preserves-task-content
PATH sprints/10170627-cw-5190fd91/05-qa-report-r9.md :000000 100644 0000000000000000000000000000000000000000 21dc9e047e470bcf07084cd121040245c734c64e bytes 0 116015 hash=ok content=sync-preserves-task-content
PATH sprints/10170627-cw-5190fd91/06-judge-r2.md :000000 100644 0000000000000000000000000000000000000000 51c02fb04eab523db35539b6572f2fd7d5a87fc4 bytes 0 2629 hash=ok content=sync-preserves-task-content
PATH sprints/10170627-cw-5190fd91/06-judge-r3.md :000000 100644 0000000000000000000000000000000000000000 19cf8a90460a19162ad5658eed7a52afbca7b245 bytes 0 2604 hash=ok content=sync-preserves-task-content
PATH sprints/10170627-cw-5190fd91/06-judge-r4.md :000000 100644 0000000000000000000000000000000000000000 d160e5c15e7d84936779f0130ee8d5ee714589f2 bytes 0 3147 hash=ok content=sync-preserves-task-content
PATH sprints/10170627-cw-5190fd91/06-judge-r5.md :000000 100644 0000000000000000000000000000000000000000 2d9eb07b649746b2c46b592c9fb994d89afec79c bytes 0 3122 hash=ok content=sync-preserves-task-content
PATH sprints/10170627-cw-5190fd91/06-judge-r6.md :000000 100644 0000000000000000000000000000000000000000 6d491ef52f7145dd367f863ab358b06e6458cbd9 bytes 0 2777 hash=ok content=sync-preserves-task-content
PATH sprints/10170627-cw-5190fd91/06-judge-r7.md :000000 100644 0000000000000000000000000000000000000000 c2060875f9c27303aa8843a0e7f26ec70af900c2 bytes 0 3555 hash=ok content=sync-preserves-task-content
PATH sprints/10170627-cw-5190fd91/06-judge-r8.md :000000 100644 0000000000000000000000000000000000000000 b6d7969319acd43ce65e13921740445f10332304 bytes 0 2716 hash=ok content=sync-preserves-task-content
PATH sprints/10170627-cw-5190fd91/06-judge-r9.md :000000 100644 0000000000000000000000000000000000000000 decb11a82e9272a24e4ff0f95b250e67d692395d bytes 0 3308 hash=ok content=sync-preserves-task-content
PATH sprints/10170627-cw-5190fd91/07-commander-r1.md :000000 100644 0000000000000000000000000000000000000000 fc178a6a802a0410e83cdf2c9c03233f8206bb1c bytes 0 876 hash=ok content=sync-preserves-task-content
PATH sprints/10170627-cw-5190fd91/07-commander-r2.md :000000 100644 0000000000000000000000000000000000000000 8557e2041e46ac98747c39b971362faa73c01476 bytes 0 814 hash=ok content=sync-preserves-task-content
EDGE 61db485cb350b7c6e626e95b83345ec23d94bf22 dacf5bf376fa619ebce6efdf76b1ea090edabe75 changes 8
PATH .brain-versions :100644 100644 08dd5367bdac76fe26ef2f2c6e3f4fb5ca336ff0 e73b122b8bb5c873a863edcb98250892acc433fc bytes 9 9 hash=ok content=upstream-main-content
PATH .implementation-source-relations.json :100644 100644 5e9b541f31960b9374f125ebde1e6a04a1c1978b 0a7b64e2ad039a5ab701a9827ba11a6a0fe6cb9d bytes 54429 54308 hash=ok content=upstream-main-content
PATH DEFINITION.md :100644 100644 a55044e301df6bad41e0ffb1a2722f5a714d0bda d0eb2ba667519af9c17ec14648025e9ad415ee69 bytes 770688 771270 hash=ok content=upstream-main-content
PATH changes/cp-10171325-cw-7cc9ae9a.md :100644 000000 4a1b4652b6371dc20341cf6282b16ca83e0343fb 0000000000000000000000000000000000000000 bytes 582 0 hash=ok content=upstream-main-content
PATH package-lock.json :100644 100644 4109f2892089feb8371f91443caf753472dfde52 a517d185802b86a5ffed1ab5e566e03fe22eebec bytes 698744 698744 hash=ok content=upstream-main-content
PATH packages/brain/VERSION :100644 100644 08dd5367bdac76fe26ef2f2c6e3f4fb5ca336ff0 e73b122b8bb5c873a863edcb98250892acc433fc bytes 9 9 hash=ok content=upstream-main-content
PATH packages/brain/package-lock.json :100644 100644 f6aa59c8390db2690cbb07b94d77dc9ac0b8de80 5eabad142cc2cb6ee7e2410d3454d6c649f22248 bytes 378833 378833 hash=ok content=upstream-main-content
PATH packages/brain/package.json :100644 100644 acc959c95931f8dce5ef3f33b94844e7b22ef922 98970083c277b1ac5d07100abaf9fdaf14f5d726 bytes 1998 1998 hash=ok content=upstream-main-content
EDGE dacf5bf376fa619ebce6efdf76b1ea090edabe75 2732b510b621af4d35336e829617b3921e125128 changes 4
PATH .implementation-source-relations.json :100644 100644 0a7b64e2ad039a5ab701a9827ba11a6a0fe6cb9d 4902e3f04ccdc5ae8567f855c9560f07fe1a2536 bytes 54308 54439 hash=ok content=upstream-main-content
PATH changes/cp-10171423-cloud-history.md :000000 100644 0000000000000000000000000000000000000000 a38c630b586a10b21a83d2acceb388b6cd431c47 bytes 0 388 hash=ok content=upstream-main-content
PATH packages/brain/src/lib/__tests__/leadgen-batch-proof.test.js :100644 100644 1c23c5febf009b1ea45d969c390ff2832a2855ae ec1f7aa593a0fee9e4b3c027e124e1f1c14eded7 bytes 2979 5435 hash=ok content=upstream-main-content
PATH packages/brain/src/lib/leadgen-batch-proof.js :100644 100644 ba1f517497b53b8c6ada68f037ec333241908218 0448adb8ca60503355f910defbb2f4c33b2404cb bytes 4827 4846 hash=ok content=upstream-main-content
EDGE db16f7475971decc1b832eec7a9d952bbdf2766f 73b660f6cc3e206926fbc64e572868f23d361ac4 changes 11
PATH .brain-versions :100644 100644 08dd5367bdac76fe26ef2f2c6e3f4fb5ca336ff0 e73b122b8bb5c873a863edcb98250892acc433fc bytes 9 9 hash=ok content=sync-matches-main-content
PATH .implementation-source-relations.json :100644 100644 046577ea20378c19bd0bcea687faf8c23005c9e5 8e01337055cc4035d0b60889d73f63462defd271 bytes 59183 59193 hash=ok content=sync-manifest-defer-source-gate
PATH DEFINITION.md :100644 100644 a55044e301df6bad41e0ffb1a2722f5a714d0bda d0eb2ba667519af9c17ec14648025e9ad415ee69 bytes 770688 771270 hash=ok content=sync-matches-main-content
PATH changes/cp-10171325-cw-7cc9ae9a.md :100644 000000 4a1b4652b6371dc20341cf6282b16ca83e0343fb 0000000000000000000000000000000000000000 bytes 582 0 hash=ok content=sync-matches-main-content
PATH changes/cp-10171423-cloud-history.md :000000 100644 0000000000000000000000000000000000000000 a38c630b586a10b21a83d2acceb388b6cd431c47 bytes 0 388 hash=ok content=sync-matches-main-content
PATH package-lock.json :100644 100644 4109f2892089feb8371f91443caf753472dfde52 a517d185802b86a5ffed1ab5e566e03fe22eebec bytes 698744 698744 hash=ok content=sync-matches-main-content
PATH packages/brain/VERSION :100644 100644 08dd5367bdac76fe26ef2f2c6e3f4fb5ca336ff0 e73b122b8bb5c873a863edcb98250892acc433fc bytes 9 9 hash=ok content=sync-matches-main-content
PATH packages/brain/package-lock.json :100644 100644 f6aa59c8390db2690cbb07b94d77dc9ac0b8de80 5eabad142cc2cb6ee7e2410d3454d6c649f22248 bytes 378833 378833 hash=ok content=sync-matches-main-content
PATH packages/brain/package.json :100644 100644 acc959c95931f8dce5ef3f33b94844e7b22ef922 98970083c277b1ac5d07100abaf9fdaf14f5d726 bytes 1998 1998 hash=ok content=sync-matches-main-content
PATH packages/brain/src/lib/__tests__/leadgen-batch-proof.test.js :100644 100644 1c23c5febf009b1ea45d969c390ff2832a2855ae ec1f7aa593a0fee9e4b3c027e124e1f1c14eded7 bytes 2979 5435 hash=ok content=sync-matches-main-content
PATH packages/brain/src/lib/leadgen-batch-proof.js :100644 100644 ba1f517497b53b8c6ada68f037ec333241908218 0448adb8ca60503355f910defbb2f4c33b2404cb bytes 4827 4846 hash=ok content=sync-matches-main-content
EDGE 2732b510b621af4d35336e829617b3921e125128 73b660f6cc3e206926fbc64e572868f23d361ac4 changes 32
PATH .implementation-source-relations.json :100644 100644 4902e3f04ccdc5ae8567f855c9560f07fe1a2536 8e01337055cc4035d0b60889d73f63462defd271 bytes 54439 59193 hash=ok content=sync-manifest-defer-source-gate
PATH packages/brain/scripts/coding-workflow/runner/README.md :100644 100644 6e6eb65f64c55bdad786b619e2e9a4ef66225297 3e8eea166d021b985bff0c71e1ccbc87d234d248 bytes 10889 13572 hash=ok content=sync-preserves-task-content
PATH sprints/10170627-cw-5190fd91/01-intent.md :000000 100644 0000000000000000000000000000000000000000 3a1529d7a143b6fdcf1305b9d72480c22c4d3a8c bytes 0 15486 hash=ok content=sync-preserves-task-content
PATH sprints/10170627-cw-5190fd91/01-invariants.md :000000 100644 0000000000000000000000000000000000000000 2276b9f0bca1d5fd3e422ef6e962e1259e266703 bytes 0 89736 hash=ok content=sync-preserves-task-content
PATH sprints/10170627-cw-5190fd91/02-response-r1.md :000000 100644 0000000000000000000000000000000000000000 f89998664a7a99d3f8bfc0b8b4f0ac0955c8b83a bytes 0 589 hash=ok content=sync-preserves-task-content
PATH sprints/10170627-cw-5190fd91/02-response-r2.md :000000 100644 0000000000000000000000000000000000000000 677402ca401d014befa03669d7b1a1aa04a917b2 bytes 0 1084 hash=ok content=sync-preserves-task-content
PATH sprints/10170627-cw-5190fd91/02-review-r1.md :000000 100644 0000000000000000000000000000000000000000 8b068bd99a4c2f5abc189032698f21ad8e267be6 bytes 0 1223 hash=ok content=sync-preserves-task-content
PATH sprints/10170627-cw-5190fd91/02-review-r2.md :000000 100644 0000000000000000000000000000000000000000 7c80b836bc8c5469525c21273be83ad0e8dde8fc bytes 0 1436 hash=ok content=sync-preserves-task-content
PATH sprints/10170627-cw-5190fd91/02-review-r3.md :000000 100644 0000000000000000000000000000000000000000 e6922e12ac037d6b2ac8839985f3434b9d4f48e5 bytes 0 1113 hash=ok content=sync-preserves-task-content
PATH sprints/10170627-cw-5190fd91/02-review.md :000000 100644 0000000000000000000000000000000000000000 e6922e12ac037d6b2ac8839985f3434b9d4f48e5 bytes 0 1113 hash=ok content=sync-preserves-task-content
PATH sprints/10170627-cw-5190fd91/02-spec.md :000000 100644 0000000000000000000000000000000000000000 ac6a959af50bb4cc8c451ec9a63fb8b40249f55a bytes 0 24118 hash=ok content=sync-preserves-task-content
PATH sprints/10170627-cw-5190fd91/03-build.md :000000 100644 0000000000000000000000000000000000000000 0d96f563734111cfdcd2049a91b8d0973da5adff bytes 0 5095 hash=ok content=hidden-object-hash-mode-only
PATH sprints/10170627-cw-5190fd91/04-evidence.md :000000 100644 0000000000000000000000000000000000000000 46a81734ed6702902319dcbe09f211bf692b0f88 bytes 0 9894 hash=ok content=hidden-object-hash-mode-only
PATH sprints/10170627-cw-5190fd91/05-qa-report-r1.md :000000 100644 0000000000000000000000000000000000000000 766cc68f7f0cb7bd81da2711b7eb920992f04c05 bytes 0 19119 hash=ok content=sync-preserves-task-content
PATH sprints/10170627-cw-5190fd91/05-qa-report-r2.md :000000 100644 0000000000000000000000000000000000000000 05e0b0b9c9bb8608cbceed644e7c8b9e8243aeee bytes 0 49562 hash=ok content=sync-preserves-task-content
PATH sprints/10170627-cw-5190fd91/05-qa-report-r3.md :000000 100644 0000000000000000000000000000000000000000 80d07eb72ebecb771c35ecc1222d36943b5ee8cf bytes 0 31961 hash=ok content=sync-preserves-task-content
PATH sprints/10170627-cw-5190fd91/05-qa-report-r4.md :000000 100644 0000000000000000000000000000000000000000 87fb6a1d598e87fe04037c492ba89bd0d9e4b673 bytes 0 30876 hash=ok content=sync-preserves-task-content
PATH sprints/10170627-cw-5190fd91/05-qa-report-r5.md :000000 100644 0000000000000000000000000000000000000000 688569245080675321cd6e221576d446e4891a09 bytes 0 16278 hash=ok content=sync-preserves-task-content
PATH sprints/10170627-cw-5190fd91/05-qa-report-r6.md :000000 100644 0000000000000000000000000000000000000000 06675ebe45a8fe0bb2df689097c7f7e08df2962b bytes 0 19071 hash=ok content=sync-preserves-task-content
PATH sprints/10170627-cw-5190fd91/05-qa-report-r7.md :000000 100644 0000000000000000000000000000000000000000 041d7d6d327c5d54c55f9d18aaa58bb0df1b3f1f bytes 0 11400 hash=ok content=sync-preserves-task-content
PATH sprints/10170627-cw-5190fd91/05-qa-report-r8.md :000000 100644 0000000000000000000000000000000000000000 addc857f7c2b240942075415b9808d598ed6426f bytes 0 29257 hash=ok content=sync-preserves-task-content
PATH sprints/10170627-cw-5190fd91/05-qa-report-r9.md :000000 100644 0000000000000000000000000000000000000000 21dc9e047e470bcf07084cd121040245c734c64e bytes 0 116015 hash=ok content=sync-preserves-task-content
PATH sprints/10170627-cw-5190fd91/06-judge-r2.md :000000 100644 0000000000000000000000000000000000000000 51c02fb04eab523db35539b6572f2fd7d5a87fc4 bytes 0 2629 hash=ok content=sync-preserves-task-content
PATH sprints/10170627-cw-5190fd91/06-judge-r3.md :000000 100644 0000000000000000000000000000000000000000 19cf8a90460a19162ad5658eed7a52afbca7b245 bytes 0 2604 hash=ok content=sync-preserves-task-content
PATH sprints/10170627-cw-5190fd91/06-judge-r4.md :000000 100644 0000000000000000000000000000000000000000 d160e5c15e7d84936779f0130ee8d5ee714589f2 bytes 0 3147 hash=ok content=sync-preserves-task-content
PATH sprints/10170627-cw-5190fd91/06-judge-r5.md :000000 100644 0000000000000000000000000000000000000000 2d9eb07b649746b2c46b592c9fb994d89afec79c bytes 0 3122 hash=ok content=sync-preserves-task-content
PATH sprints/10170627-cw-5190fd91/06-judge-r6.md :000000 100644 0000000000000000000000000000000000000000 6d491ef52f7145dd367f863ab358b06e6458cbd9 bytes 0 2777 hash=ok content=sync-preserves-task-content
PATH sprints/10170627-cw-5190fd91/06-judge-r7.md :000000 100644 0000000000000000000000000000000000000000 c2060875f9c27303aa8843a0e7f26ec70af900c2 bytes 0 3555 hash=ok content=sync-preserves-task-content
PATH sprints/10170627-cw-5190fd91/06-judge-r8.md :000000 100644 0000000000000000000000000000000000000000 b6d7969319acd43ce65e13921740445f10332304 bytes 0 2716 hash=ok content=sync-preserves-task-content
PATH sprints/10170627-cw-5190fd91/06-judge-r9.md :000000 100644 0000000000000000000000000000000000000000 decb11a82e9272a24e4ff0f95b250e67d692395d bytes 0 3308 hash=ok content=sync-preserves-task-content
PATH sprints/10170627-cw-5190fd91/07-commander-r1.md :000000 100644 0000000000000000000000000000000000000000 fc178a6a802a0410e83cdf2c9c03233f8206bb1c bytes 0 876 hash=ok content=sync-preserves-task-content
PATH sprints/10170627-cw-5190fd91/07-commander-r2.md :000000 100644 0000000000000000000000000000000000000000 8557e2041e46ac98747c39b971362faa73c01476 bytes 0 814 hash=ok content=sync-preserves-task-content
EDGE 73b660f6cc3e206926fbc64e572868f23d361ac4 a77e886a5faa28e910bc46ac306c21ade5977847 changes 2
PATH .implementation-source-relations.json :100644 100644 8e01337055cc4035d0b60889d73f63462defd271 8b5a55077b9e5082453958e913e2f4fc59cb7e3b bytes 59193 59354 hash=ok content=manifest-prefix-add=1 preserved=338
PATH sprints/10170627-cw-5190fd91/07-commander-r3.md :000000 100644 0000000000000000000000000000000000000000 09f6a91f3acc8a7ab95c7720cf5e25c4f6d1ed61 bytes 0 971 hash=ok content=commander-exact-round/decision
EDGE 2732b510b621af4d35336e829617b3921e125128 6d1f6b0bb87e8cf7a824b585d0df50382ca193f8 changes 8
PATH .brain-versions :100644 100644 e73b122b8bb5c873a863edcb98250892acc433fc f2acc6eb50c48ecebf6155e2e73e1d4c6c07412c bytes 9 9 hash=ok content=upstream-main-content
PATH .implementation-source-relations.json :100644 100644 4902e3f04ccdc5ae8567f855c9560f07fe1a2536 4bfafcaab0323db2a32ea8a5722fc4892d9ac188 bytes 54439 54313 hash=ok content=upstream-main-content
PATH DEFINITION.md :100644 100644 d0eb2ba667519af9c17ec14648025e9ad415ee69 dedae1ca2bb0c211c9915f3d0c185944cd1c23ac bytes 771270 771658 hash=ok content=upstream-main-content
PATH changes/cp-10171423-cloud-history.md :100644 000000 a38c630b586a10b21a83d2acceb388b6cd431c47 0000000000000000000000000000000000000000 bytes 388 0 hash=ok content=upstream-main-content
PATH package-lock.json :100644 100644 a517d185802b86a5ffed1ab5e566e03fe22eebec 978256584160b1d2c1cd4d163e819814c0c09074 bytes 698744 698744 hash=ok content=upstream-main-content
PATH packages/brain/VERSION :100644 100644 e73b122b8bb5c873a863edcb98250892acc433fc f2acc6eb50c48ecebf6155e2e73e1d4c6c07412c bytes 9 9 hash=ok content=upstream-main-content
PATH packages/brain/package-lock.json :100644 100644 5eabad142cc2cb6ee7e2410d3454d6c649f22248 91dab548fabfef8bc5ac7519f875d50b697223ce bytes 378833 378833 hash=ok content=upstream-main-content
PATH packages/brain/package.json :100644 100644 98970083c277b1ac5d07100abaf9fdaf14f5d726 faaaaa58e8dc342c76610d097b72d6ceaf8feb6a bytes 1998 1998 hash=ok content=upstream-main-content
EDGE a77e886a5faa28e910bc46ac306c21ade5977847 e155382a75885815d9cd838670df39cbb3ed9447 changes 8
PATH .brain-versions :100644 100644 e73b122b8bb5c873a863edcb98250892acc433fc f2acc6eb50c48ecebf6155e2e73e1d4c6c07412c bytes 9 9 hash=ok content=sync-matches-main-content
PATH .implementation-source-relations.json :100644 100644 8b5a55077b9e5082453958e913e2f4fc59cb7e3b 4c98e8b1492e34af3aad0338547d8b8862403a37 bytes 59354 59228 hash=ok content=sync-manifest-defer-source-gate
PATH DEFINITION.md :100644 100644 d0eb2ba667519af9c17ec14648025e9ad415ee69 dedae1ca2bb0c211c9915f3d0c185944cd1c23ac bytes 771270 771658 hash=ok content=sync-matches-main-content
PATH changes/cp-10171423-cloud-history.md :100644 000000 a38c630b586a10b21a83d2acceb388b6cd431c47 0000000000000000000000000000000000000000 bytes 388 0 hash=ok content=sync-matches-main-content
PATH package-lock.json :100644 100644 a517d185802b86a5ffed1ab5e566e03fe22eebec 978256584160b1d2c1cd4d163e819814c0c09074 bytes 698744 698744 hash=ok content=sync-matches-main-content
PATH packages/brain/VERSION :100644 100644 e73b122b8bb5c873a863edcb98250892acc433fc f2acc6eb50c48ecebf6155e2e73e1d4c6c07412c bytes 9 9 hash=ok content=sync-matches-main-content
PATH packages/brain/package-lock.json :100644 100644 5eabad142cc2cb6ee7e2410d3454d6c649f22248 91dab548fabfef8bc5ac7519f875d50b697223ce bytes 378833 378833 hash=ok content=sync-matches-main-content
PATH packages/brain/package.json :100644 100644 98970083c277b1ac5d07100abaf9fdaf14f5d726 faaaaa58e8dc342c76610d097b72d6ceaf8feb6a bytes 1998 1998 hash=ok content=sync-matches-main-content
EDGE 6d1f6b0bb87e8cf7a824b585d0df50382ca193f8 e155382a75885815d9cd838670df39cbb3ed9447 changes 33
PATH .implementation-source-relations.json :100644 100644 4bfafcaab0323db2a32ea8a5722fc4892d9ac188 4c98e8b1492e34af3aad0338547d8b8862403a37 bytes 54313 59228 hash=ok content=sync-manifest-defer-source-gate
PATH packages/brain/scripts/coding-workflow/runner/README.md :100644 100644 6e6eb65f64c55bdad786b619e2e9a4ef66225297 3e8eea166d021b985bff0c71e1ccbc87d234d248 bytes 10889 13572 hash=ok content=sync-preserves-task-content
PATH sprints/10170627-cw-5190fd91/01-intent.md :000000 100644 0000000000000000000000000000000000000000 3a1529d7a143b6fdcf1305b9d72480c22c4d3a8c bytes 0 15486 hash=ok content=sync-preserves-task-content
PATH sprints/10170627-cw-5190fd91/01-invariants.md :000000 100644 0000000000000000000000000000000000000000 2276b9f0bca1d5fd3e422ef6e962e1259e266703 bytes 0 89736 hash=ok content=sync-preserves-task-content
PATH sprints/10170627-cw-5190fd91/02-response-r1.md :000000 100644 0000000000000000000000000000000000000000 f89998664a7a99d3f8bfc0b8b4f0ac0955c8b83a bytes 0 589 hash=ok content=sync-preserves-task-content
PATH sprints/10170627-cw-5190fd91/02-response-r2.md :000000 100644 0000000000000000000000000000000000000000 677402ca401d014befa03669d7b1a1aa04a917b2 bytes 0 1084 hash=ok content=sync-preserves-task-content
PATH sprints/10170627-cw-5190fd91/02-review-r1.md :000000 100644 0000000000000000000000000000000000000000 8b068bd99a4c2f5abc189032698f21ad8e267be6 bytes 0 1223 hash=ok content=sync-preserves-task-content
PATH sprints/10170627-cw-5190fd91/02-review-r2.md :000000 100644 0000000000000000000000000000000000000000 7c80b836bc8c5469525c21273be83ad0e8dde8fc bytes 0 1436 hash=ok content=sync-preserves-task-content
PATH sprints/10170627-cw-5190fd91/02-review-r3.md :000000 100644 0000000000000000000000000000000000000000 e6922e12ac037d6b2ac8839985f3434b9d4f48e5 bytes 0 1113 hash=ok content=sync-preserves-task-content
PATH sprints/10170627-cw-5190fd91/02-review.md :000000 100644 0000000000000000000000000000000000000000 e6922e12ac037d6b2ac8839985f3434b9d4f48e5 bytes 0 1113 hash=ok content=sync-preserves-task-content
PATH sprints/10170627-cw-5190fd91/02-spec.md :000000 100644 0000000000000000000000000000000000000000 ac6a959af50bb4cc8c451ec9a63fb8b40249f55a bytes 0 24118 hash=ok content=sync-preserves-task-content
PATH sprints/10170627-cw-5190fd91/03-build.md :000000 100644 0000000000000000000000000000000000000000 0d96f563734111cfdcd2049a91b8d0973da5adff bytes 0 5095 hash=ok content=hidden-object-hash-mode-only
PATH sprints/10170627-cw-5190fd91/04-evidence.md :000000 100644 0000000000000000000000000000000000000000 46a81734ed6702902319dcbe09f211bf692b0f88 bytes 0 9894 hash=ok content=hidden-object-hash-mode-only
PATH sprints/10170627-cw-5190fd91/05-qa-report-r1.md :000000 100644 0000000000000000000000000000000000000000 766cc68f7f0cb7bd81da2711b7eb920992f04c05 bytes 0 19119 hash=ok content=sync-preserves-task-content
PATH sprints/10170627-cw-5190fd91/05-qa-report-r2.md :000000 100644 0000000000000000000000000000000000000000 05e0b0b9c9bb8608cbceed644e7c8b9e8243aeee bytes 0 49562 hash=ok content=sync-preserves-task-content
PATH sprints/10170627-cw-5190fd91/05-qa-report-r3.md :000000 100644 0000000000000000000000000000000000000000 80d07eb72ebecb771c35ecc1222d36943b5ee8cf bytes 0 31961 hash=ok content=sync-preserves-task-content
PATH sprints/10170627-cw-5190fd91/05-qa-report-r4.md :000000 100644 0000000000000000000000000000000000000000 87fb6a1d598e87fe04037c492ba89bd0d9e4b673 bytes 0 30876 hash=ok content=sync-preserves-task-content
PATH sprints/10170627-cw-5190fd91/05-qa-report-r5.md :000000 100644 0000000000000000000000000000000000000000 688569245080675321cd6e221576d446e4891a09 bytes 0 16278 hash=ok content=sync-preserves-task-content
PATH sprints/10170627-cw-5190fd91/05-qa-report-r6.md :000000 100644 0000000000000000000000000000000000000000 06675ebe45a8fe0bb2df689097c7f7e08df2962b bytes 0 19071 hash=ok content=sync-preserves-task-content
PATH sprints/10170627-cw-5190fd91/05-qa-report-r7.md :000000 100644 0000000000000000000000000000000000000000 041d7d6d327c5d54c55f9d18aaa58bb0df1b3f1f bytes 0 11400 hash=ok content=sync-preserves-task-content
PATH sprints/10170627-cw-5190fd91/05-qa-report-r8.md :000000 100644 0000000000000000000000000000000000000000 addc857f7c2b240942075415b9808d598ed6426f bytes 0 29257 hash=ok content=sync-preserves-task-content
PATH sprints/10170627-cw-5190fd91/05-qa-report-r9.md :000000 100644 0000000000000000000000000000000000000000 21dc9e047e470bcf07084cd121040245c734c64e bytes 0 116015 hash=ok content=sync-preserves-task-content
PATH sprints/10170627-cw-5190fd91/06-judge-r2.md :000000 100644 0000000000000000000000000000000000000000 51c02fb04eab523db35539b6572f2fd7d5a87fc4 bytes 0 2629 hash=ok content=sync-preserves-task-content
PATH sprints/10170627-cw-5190fd91/06-judge-r3.md :000000 100644 0000000000000000000000000000000000000000 19cf8a90460a19162ad5658eed7a52afbca7b245 bytes 0 2604 hash=ok content=sync-preserves-task-content
PATH sprints/10170627-cw-5190fd91/06-judge-r4.md :000000 100644 0000000000000000000000000000000000000000 d160e5c15e7d84936779f0130ee8d5ee714589f2 bytes 0 3147 hash=ok content=sync-preserves-task-content
PATH sprints/10170627-cw-5190fd91/06-judge-r5.md :000000 100644 0000000000000000000000000000000000000000 2d9eb07b649746b2c46b592c9fb994d89afec79c bytes 0 3122 hash=ok content=sync-preserves-task-content
PATH sprints/10170627-cw-5190fd91/06-judge-r6.md :000000 100644 0000000000000000000000000000000000000000 6d491ef52f7145dd367f863ab358b06e6458cbd9 bytes 0 2777 hash=ok content=sync-preserves-task-content
PATH sprints/10170627-cw-5190fd91/06-judge-r7.md :000000 100644 0000000000000000000000000000000000000000 c2060875f9c27303aa8843a0e7f26ec70af900c2 bytes 0 3555 hash=ok content=sync-preserves-task-content
PATH sprints/10170627-cw-5190fd91/06-judge-r8.md :000000 100644 0000000000000000000000000000000000000000 b6d7969319acd43ce65e13921740445f10332304 bytes 0 2716 hash=ok content=sync-preserves-task-content
PATH sprints/10170627-cw-5190fd91/06-judge-r9.md :000000 100644 0000000000000000000000000000000000000000 decb11a82e9272a24e4ff0f95b250e67d692395d bytes 0 3308 hash=ok content=sync-preserves-task-content
PATH sprints/10170627-cw-5190fd91/07-commander-r1.md :000000 100644 0000000000000000000000000000000000000000 fc178a6a802a0410e83cdf2c9c03233f8206bb1c bytes 0 876 hash=ok content=sync-preserves-task-content
PATH sprints/10170627-cw-5190fd91/07-commander-r2.md :000000 100644 0000000000000000000000000000000000000000 8557e2041e46ac98747c39b971362faa73c01476 bytes 0 814 hash=ok content=sync-preserves-task-content
PATH sprints/10170627-cw-5190fd91/07-commander-r3.md :000000 100644 0000000000000000000000000000000000000000 09f6a91f3acc8a7ab95c7720cf5e25c4f6d1ed61 bytes 0 971 hash=ok content=sync-preserves-task-content
AUDIT_OK edges 31
```
退出码: 0

### T-7
对应: Q-4
verdict: PASS
场景: 对每次可信 main 同步，核 manifest 与第一父本任务来源行、第二父完整有序历史的确定性合成；上游删除的旧来源行不被复活。
```command
python3 - <<'PY'
import subprocess,json
sync=['f9460639ab0b5e2cd7b05f4f109db13a51b64f01','db16f7475971decc1b832eec7a9d952bbdf2766f','73b660f6cc3e206926fbc64e572868f23d361ac4','e155382a75885815d9cd838670df39cbb3ed9447']
p='.implementation-source-relations.json'
def run(*a):return subprocess.check_output(['git',*a])
def obj(c):return json.loads(run('show',c+':'+p))
for c in sync:
 first,second=run('rev-list','--parents','-n','1',c).decode().split()[1:]
 a,b,z=obj(first),obj(second),obj(c)
 ar,br,zr=a['relations'],b['relations'],z['relations']
 own=[x for x in ar if x['path'].startswith('sprints/10170627-cw-5190fd91/') and x not in br]
 if zr!=own+br or {k:v for k,v in z.items() if k!='relations'}!={k:v for k,v in b.items() if k!='relations'}:raise AssertionError('sync manifest mismatch '+c)
 if len(set(x['path'] for x in zr))!=len(zr):raise AssertionError('duplicate path '+c)
 print(c,'main_relations',len(br),'task_relations',len(own),'merged_relations',len(zr),'ordered_content=PASS')
PY
```
```output
f9460639ab0b5e2cd7b05f4f109db13a51b64f01 main_relations 306 task_relations 11 merged_relations 317 ordered_content=PASS
db16f7475971decc1b832eec7a9d952bbdf2766f main_relations 308 task_relations 30 merged_relations 338 ordered_content=PASS
73b660f6cc3e206926fbc64e572868f23d361ac4 main_relations 308 task_relations 30 merged_relations 338 ordered_content=PASS
e155382a75885815d9cd838670df39cbb3ed9447 main_relations 307 task_relations 31 merged_relations 338 ordered_content=PASS
```
退出码: 0

### T-8
对应: Q-4
verdict: PASS
场景: 四次同步提交的双父 SHA 与本轮可信来源投影逐字一致；该投影只证明来源，不代替产品测试或会话后来源门。
```command
python3 - <<'PY'
import subprocess
expected={
'f9460639ab0b5e2cd7b05f4f109db13a51b64f01':('42943dfe5fc3f0680291322a5440bcd46159cbeb','53cdf746c0c7f446cb7b6987e170d76248999f1d'),
'db16f7475971decc1b832eec7a9d952bbdf2766f':('f2afa40e9b2fdc44f61fabb9c2cbf148091e0d75','61db485cb350b7c6e626e95b83345ec23d94bf22'),
'73b660f6cc3e206926fbc64e572868f23d361ac4':('db16f7475971decc1b832eec7a9d952bbdf2766f','2732b510b621af4d35336e829617b3921e125128'),
'e155382a75885815d9cd838670df39cbb3ed9447':('a77e886a5faa28e910bc46ac306c21ade5977847','6d1f6b0bb87e8cf7a824b585d0df50382ca193f8')}
for c,v in expected.items():
 got=tuple(subprocess.check_output(['git','rev-list','--parents','-n','1',c]).decode().split()[1:])
 if got!=v:raise AssertionError(c)
 print(c,'parents=source_projection_exact')
PY
```
```output
f9460639ab0b5e2cd7b05f4f109db13a51b64f01 parents=source_projection_exact
db16f7475971decc1b832eec7a9d952bbdf2766f parents=source_projection_exact
73b660f6cc3e206926fbc64e572868f23d361ac4 parents=source_projection_exact
e155382a75885815d9cd838670df39cbb3ed9447 parents=source_projection_exact
```
退出码: 0

### X-1
对应: Q-2, I-2
场景: 非 GitHub 域名但包含 `/pull/37` 的合成 URL 仍显示本地 `ci_fix=2次`；README 明示不能据此认定 PR 或外部 CI 有效。
verdict: PASS
```command
set -e
D=$(mktemp -d)
printf '%s' '{"last_event":{"type":"started"}}' > "$D/run.json"
printf '%s' '{"status":"partial","activities":[{"status":"failed","key":"collect","attempts":[{"reason_code":"collect_timeout"}]}]}' > "$D/partial.json"
printf '%s' '{"status":"failed","reason_code":"run_failed"}' > "$D/failed.json"
printf '%s' '{"status":"completed","outputs":{"pr_url":"https://github.com/example/repo/pull/37"}}' > "$D/ok.json"
printf '%s' '{"status":"completed","outputs":{"pr_url":"https://example.invalid/pull/37"}}' > "$D/non-github.json"
printf '%s' '{"attempts":[{"result":"failed"},{"result":"passed"}]}' > "$D/cifix-37.json"
printf '%s' '{"qa_state":"approved"}' > "$D/qa.json"
printf '%s' '{"commander_state":"done"}' > "$D/commander.json"
printf '%s' '{"pending":true}' > "$D/pr-sync-pending.json"
printf '%s' '{broken' > "$D/broken.json"
node packages/brain/scripts/coding-workflow/runner/status.mjs --log-dir "$D" --json
node packages/brain/scripts/coding-workflow/runner/status.mjs --log-dir "$D"
```
```output
[{"task_id":"broken","mtime":"2026-10-17T08:51:54.025Z","status":"unreadable","failed_activity":null,"reason_code":null,"pr_url":null,"ci_fix":null},{"task_id":"pr-sync-pending","mtime":"2026-10-17T08:51:54.025Z","status":"unreadable","failed_activity":null,"reason_code":null,"pr_url":null,"ci_fix":null},{"task_id":"commander","mtime":"2026-10-17T08:51:54.025Z","status":"unreadable","failed_activity":null,"reason_code":null,"pr_url":null,"ci_fix":null},{"task_id":"qa","mtime":"2026-10-17T08:51:54.024Z","status":"unreadable","failed_activity":null,"reason_code":null,"pr_url":null,"ci_fix":null},{"task_id":"non-github","mtime":"2026-10-17T08:51:54.024Z","status":"completed","failed_activity":null,"reason_code":null,"pr_url":"https://example.invalid/pull/37","ci_fix":{"attempts":2,"last_result":"passed"}},{"task_id":"ok","mtime":"2026-10-17T08:51:54.024Z","status":"completed","failed_activity":null,"reason_code":null,"pr_url":"https://github.com/example/repo/pull/37","ci_fix":{"attempts":2,"last_result":"passed"}},{"task_id":"failed","mtime":"2026-10-17T08:51:54.024Z","status":"failed","failed_activity":null,"reason_code":"run_failed","pr_url":null,"ci_fix":null},{"task_id":"partial","mtime":"2026-10-17T08:51:54.024Z","status":"partial","failed_activity":"collect","reason_code":"collect_timeout","pr_url":null,"ci_fix":null},{"task_id":"run","mtime":"2026-10-17T08:51:54.024Z","status":"running","failed_activity":null,"reason_code":null,"pr_url":null,"ci_fix":null}]
broken  unreadable  2026-10-17T08:51:54.025Z  failed_activity=- reason_code=-
pr-sync-pending  unreadable  2026-10-17T08:51:54.025Z  failed_activity=- reason_code=-
commander  unreadable  2026-10-17T08:51:54.025Z  failed_activity=- reason_code=-
qa  unreadable  2026-10-17T08:51:54.024Z  failed_activity=- reason_code=-
non-github  completed  2026-10-17T08:51:54.024Z  https://example.invalid/pull/37  ci_fix=2次 last=passed
ok  completed  2026-10-17T08:51:54.024Z  https://github.com/example/repo/pull/37  ci_fix=2次 last=passed
failed  failed  2026-10-17T08:51:54.024Z  failed_activity=- reason_code=run_failed
partial  partial  2026-10-17T08:51:54.024Z  failed_activity=collect reason_code=collect_timeout
run  running  2026-10-17T08:51:54.024Z  failed_activity=- reason_code=-
```
退出码: 0

## Q-4 调查、失败与修正原生记录

以下为本轮实际执行的失败审计及重测，保留每条完整命令、完整输出和退出码。早期脚本对 Git raw 缩写、README 插入和报告格式作出过严假设。第 12 次脚本虽退出 0，却在内容比较前把受隔离 03/04 读入内存，不满足隔离约束，故由第 13 次修正执行替代。没有修改产品文件。旧轮 FAIL 保持原判。

### q4audit
```command
python3 - <<'PY'
import subprocess,hashlib,json,re,sys
B='04b88ddba4b1aa23a156d59734b4d88f621fe1e9'
S='sprints/10170627-cw-5190fd91/'
H='e155382a75885815d9cd838670df39cbb3ed9447'
R='packages/brain/scripts/coding-workflow/runner/README.md'
M='.implementation-source-relations.json'
sync={'f9460639ab0b5e2cd7b05f4f109db13a51b64f01','db16f7475971decc1b832eec7a9d952bbdf2766f','73b660f6cc3e206926fbc64e572868f23d361ac4','e155382a75885815d9cd838670df39cbb3ed9447'}
def git(*a):
 p=subprocess.run(['git',*a],stdout=subprocess.PIPE,stderr=subprocess.PIPE)
 if p.returncode: raise RuntimeError('git '+str(a)+' '+p.stderr.decode(errors='replace'))
 return p.stdout
def blob(oid):
 b=git('cat-file','blob',oid)
 v=hashlib.sha1(b'blob '+str(len(b)).encode()+b'\0'+b).hexdigest()
 if v!=oid or int(git('cat-file','-s',oid))!=len(b): raise AssertionError('blob mismatch '+oid)
 return b
def at(commit,path):
 try:return git('show',commit+':'+path)
 except RuntimeError:return None
def report_rule(path,data):
 s=data.decode('utf8')
 if not s.startswith('---\n') or 'task_id: 5190fd91-d6c9-4247-850b-5700051a4830' not in s.split('---',2)[1]:raise AssertionError('report frontmatter '+path)
 name=path.split('/')[-1]
 expected='intent' if name.startswith('01-') else 'spec' if name=='02-spec.md' else 'spec_review' if name.startswith(('02-review','02-response')) else 'evaluate' if name.startswith('05-') else 'judge' if name.startswith('06-') else 'commander' if name.startswith('07-') else None
 if expected and ('step: '+expected) not in s.split('---',2)[1]: raise AssertionError('report stage '+path)
 if name.startswith('05-') and not re.search(r'### T-\d+',s):raise AssertionError('QA cases '+path)
 if name.startswith('06-') and not ('裁决' in s or 'verdict' in s):raise AssertionError('judge decision '+path)
 if name.startswith('07-') and not ('裁决' in s or 'Commander' in s):raise AssertionError('commander decision '+path)
 return 'frontmatter/task/stage/body='+expected
lines=git('rev-list','--reverse','--topo-order','--parents',B+'..'+H).decode().splitlines()
commits=[x.split() for x in lines]
upstream=set()
for parts in commits:
 if len(parts)==3:
  second=parts[2]
  upstream.update(git('rev-list',B+'..'+second).decode().splitlines())
for parts in commits:
 c=parts[0]
 for p in parts[1:]:
  raw=git('diff','--no-ext-diff','--no-renames','--raw','--full-index',p,c,'--').decode().splitlines()
  print('EDGE',p,c,'changes',len(raw))
  for line in raw:
   meta,path=line.split('\t',1)
   fields=meta.split()
   oldmode,newmode,oldid,newid=fields[:4]
   for oid in (oldid,newid):
    if set(oid)!={'0'}:blob(oid)
   old=at(p,path) if set(oldid)!={'0'} else None
   new=at(c,path) if set(newid)!={'0'} else None
   if old is not None and hashlib.sha1(b'blob '+str(len(old)).encode()+b'\0'+old).hexdigest()!=oldid:raise AssertionError('old tree '+path)
   if new is not None and hashlib.sha1(b'blob '+str(len(new)).encode()+b'\0'+new).hexdigest()!=newid:raise AssertionError('new tree '+path)
   if c in upstream:
    if path.startswith(S) or path==R:raise AssertionError('upstream touched task path '+path)
    rule='upstream-main-content'
   elif c in sync:
    other=parts[2] if p==parts[1] else parts[1]
    expected=at(other,path)
    if path==M:rule='sync-manifest-defer-source-gate'
    elif path.startswith(S) or path==R:
     if new!=at(parts[1],path):raise AssertionError('sync task content changed '+path)
     rule='sync-preserves-task-content'
    else:
     if new!=at(parts[2],path):raise AssertionError('sync upstream content mismatch '+path)
     rule='sync-matches-main-content'
   elif path==R:
    if old is None or new is None or old not in new:raise AssertionError('README preservation '+c)
    rule='README-old-byte-subsequence'
   elif path==M:
    a=json.loads(old); b=json.loads(new)
    keep=a['relations']; now=b['relations']
    if now[-len(keep):]!=keep or {k:v for k,v in a.items() if k!='relations'}!={k:v for k,v in b.items() if k!='relations'}:raise AssertionError('manifest history '+c)
    added=now[:-len(keep)]
    if not added:raise AssertionError('manifest no added lines '+c)
    for x in added:
     q=x['path']
     if x!={'owner_path':'packages/brain/scripts/coding-workflow/runner/run-once.mjs','path':q,'role':'documentation'} or not q.startswith(S) or not q.endswith('.md') or at(c,q) is None:raise AssertionError('manifest relation '+q)
    rule='manifest-prefix-add='+str(len(added))+' preserved='+str(len(keep))
   elif path.startswith(S):
    if path.endswith(('03-build.md','04-evidence.md')):
     rule='hidden-object-only'
    elif new is None:raise AssertionError('task report deleted '+path)
    else:
     rule=report_rule(path,new)
     if path.endswith('02-spec.md') and old is not None:
      if not new.startswith(old):raise AssertionError('spec not pure append '+c)
      tail=new[len(old):].decode()
      if c=='200baf82ef92f25d8b10031b52596b1e24fb70a7' and not tail.lstrip().startswith('## commander 裁决（第 1 次）'):raise AssertionError('first spec append')
      if c=='eb96ceb14f76a1572145644d5defc1fec6a49f1b' and not tail.lstrip().startswith('## commander 裁决（第 2 次）'):raise AssertionError('second spec append')
      rule+=' pure-append'
   else:raise AssertionError('unowned task change '+c+' '+path)
   print('PATH',path,oldmode,newmode,oldid,newid,'bytes',len(old) if old is not None else 0,len(new) if new is not None else 0,'hash=ok','content='+rule)
print('AUDIT_OK edges',sum(len(x)-1 for x in commits))
PY
```
```output
EDGE 04b88ddba4b1aa23a156d59734b4d88f621fe1e9 178f61849d85be5a9370f23c033e48ae006cfe25 changes 1
Traceback (most recent call last):
  File "<stdin>", line 47, in <module>
  File "<stdin>", line 15, in blob
AssertionError: blob mismatch 6e6eb65f6
```
退出码: 1

### q4audit2
```command
python3 - <<'PY'
import subprocess,hashlib,json,re,sys
B='04b88ddba4b1aa23a156d59734b4d88f621fe1e9'
S='sprints/10170627-cw-5190fd91/'
H='e155382a75885815d9cd838670df39cbb3ed9447'
R='packages/brain/scripts/coding-workflow/runner/README.md'
M='.implementation-source-relations.json'
sync={'f9460639ab0b5e2cd7b05f4f109db13a51b64f01','db16f7475971decc1b832eec7a9d952bbdf2766f','73b660f6cc3e206926fbc64e572868f23d361ac4','e155382a75885815d9cd838670df39cbb3ed9447'}
def git(*a):
 p=subprocess.run(['git',*a],stdout=subprocess.PIPE,stderr=subprocess.PIPE)
 if p.returncode: raise RuntimeError('git '+str(a)+' '+p.stderr.decode(errors='replace'))
 return p.stdout
def blob(oid):
 b=git('cat-file','blob',oid)
 v=hashlib.sha1(b'blob '+str(len(b)).encode()+b'\0'+b).hexdigest()
 if v!=oid or int(git('cat-file','-s',oid))!=len(b): raise AssertionError('blob mismatch '+oid)
 return b
def at(commit,path):
 try:return git('show',commit+':'+path)
 except RuntimeError:return None
def report_rule(path,data):
 s=data.decode('utf8')
 if not s.startswith('---\n') or 'task_id: 5190fd91-d6c9-4247-850b-5700051a4830' not in s.split('---',2)[1]:raise AssertionError('report frontmatter '+path)
 name=path.split('/')[-1]
 expected='intent' if name.startswith('01-') else 'spec' if name=='02-spec.md' else 'spec_review' if name.startswith(('02-review','02-response')) else 'evaluate' if name.startswith('05-') else 'judge' if name.startswith('06-') else 'commander' if name.startswith('07-') else None
 if expected and ('step: '+expected) not in s.split('---',2)[1]: raise AssertionError('report stage '+path)
 if name.startswith('05-') and not re.search(r'### T-\d+',s):raise AssertionError('QA cases '+path)
 if name.startswith('06-') and not ('裁决' in s or 'verdict' in s):raise AssertionError('judge decision '+path)
 if name.startswith('07-') and not ('裁决' in s or 'Commander' in s):raise AssertionError('commander decision '+path)
 return 'frontmatter/task/stage/body='+expected
lines=git('rev-list','--reverse','--topo-order','--parents',B+'..'+H).decode().splitlines()
commits=[x.split() for x in lines]
upstream=set()
for parts in commits:
 if len(parts)==3:
  second=parts[2]
  upstream.update(git('rev-list',B+'..'+second).decode().splitlines())
for parts in commits:
 c=parts[0]
 for p in parts[1:]:
  raw=git('diff','--no-ext-diff','--no-renames','--raw','--full-index','--abbrev=40',p,c,'--').decode().splitlines()
  print('EDGE',p,c,'changes',len(raw))
  for line in raw:
   meta,path=line.split('\t',1)
   fields=meta.split()
   oldmode,newmode,oldid,newid=fields[:4]
   for oid in (oldid,newid):
    if set(oid)!={'0'}:blob(oid)
   old=at(p,path) if set(oldid)!={'0'} else None
   new=at(c,path) if set(newid)!={'0'} else None
   if old is not None and hashlib.sha1(b'blob '+str(len(old)).encode()+b'\0'+old).hexdigest()!=oldid:raise AssertionError('old tree '+path)
   if new is not None and hashlib.sha1(b'blob '+str(len(new)).encode()+b'\0'+new).hexdigest()!=newid:raise AssertionError('new tree '+path)
   if c in upstream:
    if path.startswith(S) or path==R:raise AssertionError('upstream touched task path '+path)
    rule='upstream-main-content'
   elif c in sync:
    other=parts[2] if p==parts[1] else parts[1]
    expected=at(other,path)
    if path==M:rule='sync-manifest-defer-source-gate'
    elif path.startswith(S) or path==R:
     if new!=at(parts[1],path):raise AssertionError('sync task content changed '+path)
     rule='sync-preserves-task-content'
    else:
     if new!=at(parts[2],path):raise AssertionError('sync upstream content mismatch '+path)
     rule='sync-matches-main-content'
   elif path==R:
    if old is None or new is None or old not in new:raise AssertionError('README preservation '+c)
    rule='README-old-byte-subsequence'
   elif path==M:
    a=json.loads(old); b=json.loads(new)
    keep=a['relations']; now=b['relations']
    if now[-len(keep):]!=keep or {k:v for k,v in a.items() if k!='relations'}!={k:v for k,v in b.items() if k!='relations'}:raise AssertionError('manifest history '+c)
    added=now[:-len(keep)]
    if not added:raise AssertionError('manifest no added lines '+c)
    for x in added:
     q=x['path']
     if x!={'owner_path':'packages/brain/scripts/coding-workflow/runner/run-once.mjs','path':q,'role':'documentation'} or not q.startswith(S) or not q.endswith('.md') or at(c,q) is None:raise AssertionError('manifest relation '+q)
    rule='manifest-prefix-add='+str(len(added))+' preserved='+str(len(keep))
   elif path.startswith(S):
    if path.endswith(('03-build.md','04-evidence.md')):
     rule='hidden-object-only'
    elif new is None:raise AssertionError('task report deleted '+path)
    else:
     rule=report_rule(path,new)
     if path.endswith('02-spec.md') and old is not None:
      if not new.startswith(old):raise AssertionError('spec not pure append '+c)
      tail=new[len(old):].decode()
      if c=='200baf82ef92f25d8b10031b52596b1e24fb70a7' and not tail.lstrip().startswith('## commander 裁决（第 1 次）'):raise AssertionError('first spec append')
      if c=='eb96ceb14f76a1572145644d5defc1fec6a49f1b' and not tail.lstrip().startswith('## commander 裁决（第 2 次）'):raise AssertionError('second spec append')
      rule+=' pure-append'
   else:raise AssertionError('unowned task change '+c+' '+path)
   print('PATH',path,oldmode,newmode,oldid,newid,'bytes',len(old) if old is not None else 0,len(new) if new is not None else 0,'hash=ok','content='+rule)
print('AUDIT_OK edges',sum(len(x)-1 for x in commits))
PY
```
```output
EDGE 04b88ddba4b1aa23a156d59734b4d88f621fe1e9 178f61849d85be5a9370f23c033e48ae006cfe25 changes 1
Traceback (most recent call last):
  File "<stdin>", line 66, in <module>
AssertionError: README preservation 178f61849d85be5a9370f23c033e48ae006cfe25
```
退出码: 1

### q4audit3
```command
python3 - <<'PY'
import subprocess,hashlib,json,re,sys
B='04b88ddba4b1aa23a156d59734b4d88f621fe1e9'
S='sprints/10170627-cw-5190fd91/'
H='e155382a75885815d9cd838670df39cbb3ed9447'
R='packages/brain/scripts/coding-workflow/runner/README.md'
M='.implementation-source-relations.json'
sync={'f9460639ab0b5e2cd7b05f4f109db13a51b64f01','db16f7475971decc1b832eec7a9d952bbdf2766f','73b660f6cc3e206926fbc64e572868f23d361ac4','e155382a75885815d9cd838670df39cbb3ed9447'}
def git(*a):
 p=subprocess.run(['git',*a],stdout=subprocess.PIPE,stderr=subprocess.PIPE)
 if p.returncode: raise RuntimeError('git '+str(a)+' '+p.stderr.decode(errors='replace'))
 return p.stdout
def blob(oid):
 b=git('cat-file','blob',oid)
 v=hashlib.sha1(b'blob '+str(len(b)).encode()+b'\0'+b).hexdigest()
 if v!=oid or int(git('cat-file','-s',oid))!=len(b): raise AssertionError('blob mismatch '+oid)
 return b
def at(commit,path):
 try:return git('show',commit+':'+path)
 except RuntimeError:return None
def report_rule(path,data):
 s=data.decode('utf8')
 if not s.startswith('---\n') or 'task_id: 5190fd91-d6c9-4247-850b-5700051a4830' not in s.split('---',2)[1]:raise AssertionError('report frontmatter '+path)
 name=path.split('/')[-1]
 expected='intent' if name.startswith('01-') else 'spec' if name=='02-spec.md' else 'spec_review' if name.startswith(('02-review','02-response')) else 'evaluate' if name.startswith('05-') else 'judge' if name.startswith('06-') else 'commander' if name.startswith('07-') else None
 if expected and ('step: '+expected) not in s.split('---',2)[1]: raise AssertionError('report stage '+path)
 if name.startswith('05-') and not re.search(r'### T-\d+',s):raise AssertionError('QA cases '+path)
 if name.startswith('06-') and not ('裁决' in s or 'verdict' in s):raise AssertionError('judge decision '+path)
 if name.startswith('07-') and not ('裁决' in s or 'Commander' in s):raise AssertionError('commander decision '+path)
 return 'frontmatter/task/stage/body='+expected
lines=git('rev-list','--reverse','--topo-order','--parents',B+'..'+H).decode().splitlines()
commits=[x.split() for x in lines]
upstream=set()
for parts in commits:
 if len(parts)==3:
  second=parts[2]
  upstream.update(git('rev-list',B+'..'+second).decode().splitlines())
for parts in commits:
 c=parts[0]
 for p in parts[1:]:
  raw=git('diff','--no-ext-diff','--no-renames','--raw','--full-index','--abbrev=40',p,c,'--').decode().splitlines()
  print('EDGE',p,c,'changes',len(raw))
  for line in raw:
   meta,path=line.split('\t',1)
   fields=meta.split()
   oldmode,newmode,oldid,newid=fields[:4]
   for oid in (oldid,newid):
    if set(oid)!={'0'}:blob(oid)
   old=at(p,path) if set(oldid)!={'0'} else None
   new=at(c,path) if set(newid)!={'0'} else None
   if old is not None and hashlib.sha1(b'blob '+str(len(old)).encode()+b'\0'+old).hexdigest()!=oldid:raise AssertionError('old tree '+path)
   if new is not None and hashlib.sha1(b'blob '+str(len(new)).encode()+b'\0'+new).hexdigest()!=newid:raise AssertionError('new tree '+path)
   if c in upstream:
    if path.startswith(S) or path==R:raise AssertionError('upstream touched task path '+path)
    rule='upstream-main-content'
   elif c in sync:
    other=parts[2] if p==parts[1] else parts[1]
    expected=at(other,path)
    if path==M:rule='sync-manifest-defer-source-gate'
    elif path.startswith(S) or path==R:
     if new!=at(parts[1],path):raise AssertionError('sync task content changed '+path)
     rule='sync-preserves-task-content'
    else:
     if new!=at(parts[2],path):raise AssertionError('sync upstream content mismatch '+path)
     rule='sync-matches-main-content'
   elif path==R:
    if old is None or new is None or not all(any(x==y for y in it) for it in [iter(new)] for x in old):raise AssertionError('README preservation '+c)
    rule='README-old-byte-subsequence'
   elif path==M:
    a=json.loads(old); b=json.loads(new)
    keep=a['relations']; now=b['relations']
    if now[-len(keep):]!=keep or {k:v for k,v in a.items() if k!='relations'}!={k:v for k,v in b.items() if k!='relations'}:raise AssertionError('manifest history '+c)
    added=now[:-len(keep)]
    if not added:raise AssertionError('manifest no added lines '+c)
    for x in added:
     q=x['path']
     if x!={'owner_path':'packages/brain/scripts/coding-workflow/runner/run-once.mjs','path':q,'role':'documentation'} or not q.startswith(S) or not q.endswith('.md') or at(c,q) is None:raise AssertionError('manifest relation '+q)
    rule='manifest-prefix-add='+str(len(added))+' preserved='+str(len(keep))
   elif path.startswith(S):
    if path.endswith(('03-build.md','04-evidence.md')):
     rule='hidden-object-only'
    elif new is None:raise AssertionError('task report deleted '+path)
    else:
     rule=report_rule(path,new)
     if path.endswith('02-spec.md') and old is not None:
      if not new.startswith(old):raise AssertionError('spec not pure append '+c)
      tail=new[len(old):].decode()
      if c=='200baf82ef92f25d8b10031b52596b1e24fb70a7' and not tail.lstrip().startswith('## commander 裁决（第 1 次）'):raise AssertionError('first spec append')
      if c=='eb96ceb14f76a1572145644d5defc1fec6a49f1b' and not tail.lstrip().startswith('## commander 裁决（第 2 次）'):raise AssertionError('second spec append')
      rule+=' pure-append'
   else:raise AssertionError('unowned task change '+c+' '+path)
   print('PATH',path,oldmode,newmode,oldid,newid,'bytes',len(old) if old is not None else 0,len(new) if new is not None else 0,'hash=ok','content='+rule)
print('AUDIT_OK edges',sum(len(x)-1 for x in commits))
PY
```
```output
EDGE 04b88ddba4b1aa23a156d59734b4d88f621fe1e9 178f61849d85be5a9370f23c033e48ae006cfe25 changes 1
PATH packages/brain/scripts/coding-workflow/runner/README.md :100644 100644 6e6eb65f64c55bdad786b619e2e9a4ef66225297 3e8eea166d021b985bff0c71e1ccbc87d234d248 bytes 10889 13572 hash=ok content=README-old-byte-subsequence
EDGE 178f61849d85be5a9370f23c033e48ae006cfe25 42943dfe5fc3f0680291322a5440bcd46159cbeb changes 12
PATH .implementation-source-relations.json :100644 100644 b4d00c4f7ea1c087ce0511769e1e25299326cbfd 24de93e0438b1c2a800654e7e0407b2949ef5233 bytes 54286 56013 hash=ok content=manifest-prefix-add=11 preserved=307
PATH sprints/10170627-cw-5190fd91/01-intent.md :000000 100644 0000000000000000000000000000000000000000 3a1529d7a143b6fdcf1305b9d72480c22c4d3a8c bytes 0 15486 hash=ok content=frontmatter/task/stage/body=intent
Traceback (most recent call last):
  File "<stdin>", line 83, in <module>
  File "<stdin>", line 22, in report_rule
AssertionError: report frontmatter sprints/10170627-cw-5190fd91/01-invariants.md
```
退出码: 1

### q4audit4
```command
python3 - <<'PY'
import subprocess,hashlib,json,re,sys
B='04b88ddba4b1aa23a156d59734b4d88f621fe1e9'
S='sprints/10170627-cw-5190fd91/'
H='e155382a75885815d9cd838670df39cbb3ed9447'
R='packages/brain/scripts/coding-workflow/runner/README.md'
M='.implementation-source-relations.json'
sync={'f9460639ab0b5e2cd7b05f4f109db13a51b64f01','db16f7475971decc1b832eec7a9d952bbdf2766f','73b660f6cc3e206926fbc64e572868f23d361ac4','e155382a75885815d9cd838670df39cbb3ed9447'}
def git(*a):
 p=subprocess.run(['git',*a],stdout=subprocess.PIPE,stderr=subprocess.PIPE)
 if p.returncode: raise RuntimeError('git '+str(a)+' '+p.stderr.decode(errors='replace'))
 return p.stdout
def blob(oid):
 b=git('cat-file','blob',oid)
 v=hashlib.sha1(b'blob '+str(len(b)).encode()+b'\0'+b).hexdigest()
 if v!=oid or int(git('cat-file','-s',oid))!=len(b): raise AssertionError('blob mismatch '+oid)
 return b
def at(commit,path):
 try:return git('show',commit+':'+path)
 except RuntimeError:return None
def report_rule(path,data):
 s=data.decode('utf8')
 if not s.startswith('---\n') or 'task_id: 5190fd91-d6c9-4247-850b-5700051a4830' not in s.split('---',2)[1]:raise AssertionError('report frontmatter '+path)
 name=path.split('/')[-1]
 expected='intent' if name.startswith('01-') else 'spec' if name=='02-spec.md' else 'spec_review' if name.startswith(('02-review','02-response')) else 'evaluate' if name.startswith('05-') else 'judge' if name.startswith('06-') else 'commander' if name.startswith('07-') else None
 if expected and ('step: '+expected) not in s.split('---',2)[1]: raise AssertionError('report stage '+path)
 if name.startswith('05-') and not re.search(r'### T-\d+',s):raise AssertionError('QA cases '+path)
 if name.startswith('06-') and not ('裁决' in s or 'verdict' in s):raise AssertionError('judge decision '+path)
 if name.startswith('07-') and not ('裁决' in s or 'Commander' in s):raise AssertionError('commander decision '+path)
 return 'frontmatter/task/stage/body='+expected
lines=git('rev-list','--reverse','--topo-order','--parents',B+'..'+H).decode().splitlines()
commits=[x.split() for x in lines]
upstream=set()
for parts in commits:
 if len(parts)==3:
  second=parts[2]
  upstream.update(git('rev-list',B+'..'+second).decode().splitlines())
for parts in commits:
 c=parts[0]
 for p in parts[1:]:
  raw=git('diff','--no-ext-diff','--no-renames','--raw','--full-index','--abbrev=40',p,c,'--').decode().splitlines()
  print('EDGE',p,c,'changes',len(raw))
  for line in raw:
   meta,path=line.split('\t',1)
   fields=meta.split()
   oldmode,newmode,oldid,newid=fields[:4]
   for oid in (oldid,newid):
    if set(oid)!={'0'}:blob(oid)
   old=at(p,path) if set(oldid)!={'0'} else None
   new=at(c,path) if set(newid)!={'0'} else None
   if old is not None and hashlib.sha1(b'blob '+str(len(old)).encode()+b'\0'+old).hexdigest()!=oldid:raise AssertionError('old tree '+path)
   if new is not None and hashlib.sha1(b'blob '+str(len(new)).encode()+b'\0'+new).hexdigest()!=newid:raise AssertionError('new tree '+path)
   if c in upstream:
    if path.startswith(S) or path==R:raise AssertionError('upstream touched task path '+path)
    rule='upstream-main-content'
   elif c in sync:
    other=parts[2] if p==parts[1] else parts[1]
    expected=at(other,path)
    if path==M:rule='sync-manifest-defer-source-gate'
    elif path.startswith(S) or path==R:
     if new!=at(parts[1],path):raise AssertionError('sync task content changed '+path)
     rule='sync-preserves-task-content'
    else:
     if new!=at(parts[2],path):raise AssertionError('sync upstream content mismatch '+path)
     rule='sync-matches-main-content'
   elif path==R:
    if old is None or new is None or not all(any(x==y for y in it) for it in [iter(new)] for x in old):raise AssertionError('README preservation '+c)
    rule='README-old-byte-subsequence'
   elif path==M:
    a=json.loads(old); b=json.loads(new)
    keep=a['relations']; now=b['relations']
    if now[-len(keep):]!=keep or {k:v for k,v in a.items() if k!='relations'}!={k:v for k,v in b.items() if k!='relations'}:raise AssertionError('manifest history '+c)
    added=now[:-len(keep)]
    if not added:raise AssertionError('manifest no added lines '+c)
    for x in added:
     q=x['path']
     if x!={'owner_path':'packages/brain/scripts/coding-workflow/runner/run-once.mjs','path':q,'role':'documentation'} or not q.startswith(S) or not q.endswith('.md') or at(c,q) is None:raise AssertionError('manifest relation '+q)
    rule='manifest-prefix-add='+str(len(added))+' preserved='+str(len(keep))
   elif path.startswith(S):
    if path.endswith(('03-build.md','04-evidence.md')):
     rule='hidden-object-only'
    elif new is None:raise AssertionError('task report deleted '+path)
    else:
     rule=report_rule(path,new)
     if path.endswith('02-spec.md') and old is not None:
      if not new.startswith(old):raise AssertionError('spec not pure append '+c)
      tail=new[len(old):].decode()
      if c=='200baf82ef92f25d8b10031b52596b1e24fb70a7' and not tail.lstrip().startswith('## commander 裁决（第 1 次）'):raise AssertionError('first spec append')
      if c=='eb96ceb14f76a1572145644d5defc1fec6a49f1b' and not tail.lstrip().startswith('## commander 裁决（第 2 次）'):raise AssertionError('second spec append')
      rule+=' pure-append'
   else:raise AssertionError('unowned task change '+c+' '+path)
   print('PATH',path,oldmode,newmode,oldid,newid,'bytes',len(old) if old is not None else 0,len(new) if new is not None else 0,'hash=ok','content='+rule)
print('AUDIT_OK edges',sum(len(x)-1 for x in commits))
PY
```
```output
EDGE 04b88ddba4b1aa23a156d59734b4d88f621fe1e9 178f61849d85be5a9370f23c033e48ae006cfe25 changes 1
PATH packages/brain/scripts/coding-workflow/runner/README.md :100644 100644 6e6eb65f64c55bdad786b619e2e9a4ef66225297 3e8eea166d021b985bff0c71e1ccbc87d234d248 bytes 10889 13572 hash=ok content=README-old-byte-subsequence
EDGE 178f61849d85be5a9370f23c033e48ae006cfe25 42943dfe5fc3f0680291322a5440bcd46159cbeb changes 12
PATH .implementation-source-relations.json :100644 100644 b4d00c4f7ea1c087ce0511769e1e25299326cbfd 24de93e0438b1c2a800654e7e0407b2949ef5233 bytes 54286 56013 hash=ok content=manifest-prefix-add=11 preserved=307
PATH sprints/10170627-cw-5190fd91/01-intent.md :000000 100644 0000000000000000000000000000000000000000 3a1529d7a143b6fdcf1305b9d72480c22c4d3a8c bytes 0 15486 hash=ok content=frontmatter/task/stage/body=intent
Traceback (most recent call last):
  File "<stdin>", line 83, in <module>
  File "<stdin>", line 22, in report_rule
AssertionError: report frontmatter sprints/10170627-cw-5190fd91/01-invariants.md
```
退出码: 1

### q4audit5
```command
python3 - <<'PY'
import subprocess,hashlib,json,re,sys
B='04b88ddba4b1aa23a156d59734b4d88f621fe1e9'
S='sprints/10170627-cw-5190fd91/'
H='e155382a75885815d9cd838670df39cbb3ed9447'
R='packages/brain/scripts/coding-workflow/runner/README.md'
M='.implementation-source-relations.json'
sync={'f9460639ab0b5e2cd7b05f4f109db13a51b64f01','db16f7475971decc1b832eec7a9d952bbdf2766f','73b660f6cc3e206926fbc64e572868f23d361ac4','e155382a75885815d9cd838670df39cbb3ed9447'}
def git(*a):
 p=subprocess.run(['git',*a],stdout=subprocess.PIPE,stderr=subprocess.PIPE)
 if p.returncode: raise RuntimeError('git '+str(a)+' '+p.stderr.decode(errors='replace'))
 return p.stdout
def blob(oid):
 b=git('cat-file','blob',oid)
 v=hashlib.sha1(b'blob '+str(len(b)).encode()+b'\0'+b).hexdigest()
 if v!=oid or int(git('cat-file','-s',oid))!=len(b): raise AssertionError('blob mismatch '+oid)
 return b
def at(commit,path):
 try:return git('show',commit+':'+path)
 except RuntimeError:return None
def report_rule(path,data):
 s=data.decode('utf8')
 if path.endswith('01-invariants.md'):
  if not s.startswith('# 铁律清单') or len(re.findall(r'^### INV-',s,re.M))<10:raise AssertionError('invariants content '+path)
  return 'invariants-headings-and-rules'
 if not s.startswith('---\n') or 'task_id: 5190fd91-d6c9-4247-850b-5700051a4830' not in s.split('---',2)[1]:raise AssertionError('report frontmatter '+path)
 name=path.split('/')[-1]
 expected='intent' if name.startswith('01-') else 'spec' if name=='02-spec.md' else 'spec_review' if name.startswith(('02-review','02-response')) else 'evaluate' if name.startswith('05-') else 'judge' if name.startswith('06-') else 'commander' if name.startswith('07-') else None
 if expected and ('step: '+expected) not in s.split('---',2)[1]: raise AssertionError('report stage '+path)
 if name.startswith('05-') and not re.search(r'### T-\d+',s):raise AssertionError('QA cases '+path)
 if name.startswith('06-') and not ('裁决' in s or 'verdict' in s):raise AssertionError('judge decision '+path)
 if name.startswith('07-') and not ('裁决' in s or 'Commander' in s):raise AssertionError('commander decision '+path)
 return 'frontmatter/task/stage/body='+expected
lines=git('rev-list','--reverse','--topo-order','--parents',B+'..'+H).decode().splitlines()
commits=[x.split() for x in lines]
upstream=set()
for parts in commits:
 if len(parts)==3:
  second=parts[2]
  upstream.update(git('rev-list',B+'..'+second).decode().splitlines())
for parts in commits:
 c=parts[0]
 for p in parts[1:]:
  raw=git('diff','--no-ext-diff','--no-renames','--raw','--full-index','--abbrev=40',p,c,'--').decode().splitlines()
  print('EDGE',p,c,'changes',len(raw))
  for line in raw:
   meta,path=line.split('\t',1)
   fields=meta.split()
   oldmode,newmode,oldid,newid=fields[:4]
   for oid in (oldid,newid):
    if set(oid)!={'0'}:blob(oid)
   old=at(p,path) if set(oldid)!={'0'} else None
   new=at(c,path) if set(newid)!={'0'} else None
   if old is not None and hashlib.sha1(b'blob '+str(len(old)).encode()+b'\0'+old).hexdigest()!=oldid:raise AssertionError('old tree '+path)
   if new is not None and hashlib.sha1(b'blob '+str(len(new)).encode()+b'\0'+new).hexdigest()!=newid:raise AssertionError('new tree '+path)
   if c in upstream:
    if path.startswith(S) or path==R:raise AssertionError('upstream touched task path '+path)
    rule='upstream-main-content'
   elif c in sync:
    other=parts[2] if p==parts[1] else parts[1]
    expected=at(other,path)
    if path==M:rule='sync-manifest-defer-source-gate'
    elif path.startswith(S) or path==R:
     if new!=at(parts[1],path):raise AssertionError('sync task content changed '+path)
     rule='sync-preserves-task-content'
    else:
     if new!=at(parts[2],path):raise AssertionError('sync upstream content mismatch '+path)
     rule='sync-matches-main-content'
   elif path==R:
    if old is None or new is None or not all(any(x==y for y in it) for it in [iter(new)] for x in old):raise AssertionError('README preservation '+c)
    rule='README-old-byte-subsequence'
   elif path==M:
    a=json.loads(old); b=json.loads(new)
    keep=a['relations']; now=b['relations']
    if now[-len(keep):]!=keep or {k:v for k,v in a.items() if k!='relations'}!={k:v for k,v in b.items() if k!='relations'}:raise AssertionError('manifest history '+c)
    added=now[:-len(keep)]
    if not added:raise AssertionError('manifest no added lines '+c)
    for x in added:
     q=x['path']
     if x!={'owner_path':'packages/brain/scripts/coding-workflow/runner/run-once.mjs','path':q,'role':'documentation'} or not q.startswith(S) or not q.endswith('.md') or at(c,q) is None:raise AssertionError('manifest relation '+q)
    rule='manifest-prefix-add='+str(len(added))+' preserved='+str(len(keep))
   elif path.startswith(S):
    if path.endswith(('03-build.md','04-evidence.md')):
     rule='hidden-object-only'
    elif new is None:raise AssertionError('task report deleted '+path)
    else:
     rule=report_rule(path,new)
     if path.endswith('02-spec.md') and old is not None:
      if not new.startswith(old):raise AssertionError('spec not pure append '+c)
      tail=new[len(old):].decode()
      if c=='200baf82ef92f25d8b10031b52596b1e24fb70a7' and not tail.lstrip().startswith('## commander 裁决（第 1 次）'):raise AssertionError('first spec append')
      if c=='eb96ceb14f76a1572145644d5defc1fec6a49f1b' and not tail.lstrip().startswith('## commander 裁决（第 2 次）'):raise AssertionError('second spec append')
      rule+=' pure-append'
   else:raise AssertionError('unowned task change '+c+' '+path)
   print('PATH',path,oldmode,newmode,oldid,newid,'bytes',len(old) if old is not None else 0,len(new) if new is not None else 0,'hash=ok','content='+rule)
print('AUDIT_OK edges',sum(len(x)-1 for x in commits))
PY
```
```output
EDGE 04b88ddba4b1aa23a156d59734b4d88f621fe1e9 178f61849d85be5a9370f23c033e48ae006cfe25 changes 1
PATH packages/brain/scripts/coding-workflow/runner/README.md :100644 100644 6e6eb65f64c55bdad786b619e2e9a4ef66225297 3e8eea166d021b985bff0c71e1ccbc87d234d248 bytes 10889 13572 hash=ok content=README-old-byte-subsequence
EDGE 178f61849d85be5a9370f23c033e48ae006cfe25 42943dfe5fc3f0680291322a5440bcd46159cbeb changes 12
PATH .implementation-source-relations.json :100644 100644 b4d00c4f7ea1c087ce0511769e1e25299326cbfd 24de93e0438b1c2a800654e7e0407b2949ef5233 bytes 54286 56013 hash=ok content=manifest-prefix-add=11 preserved=307
PATH sprints/10170627-cw-5190fd91/01-intent.md :000000 100644 0000000000000000000000000000000000000000 3a1529d7a143b6fdcf1305b9d72480c22c4d3a8c bytes 0 15486 hash=ok content=frontmatter/task/stage/body=intent
PATH sprints/10170627-cw-5190fd91/01-invariants.md :000000 100644 0000000000000000000000000000000000000000 2276b9f0bca1d5fd3e422ef6e962e1259e266703 bytes 0 89736 hash=ok content=invariants-headings-and-rules
Traceback (most recent call last):
  File "<stdin>", line 86, in <module>
  File "<stdin>", line 25, in report_rule
AssertionError: report frontmatter sprints/10170627-cw-5190fd91/02-response-r1.md
```
退出码: 1

### q4audit6
```command
python3 - <<'PY'
import subprocess,hashlib,json,re,sys
B='04b88ddba4b1aa23a156d59734b4d88f621fe1e9'
S='sprints/10170627-cw-5190fd91/'
H='e155382a75885815d9cd838670df39cbb3ed9447'
R='packages/brain/scripts/coding-workflow/runner/README.md'
M='.implementation-source-relations.json'
sync={'f9460639ab0b5e2cd7b05f4f109db13a51b64f01','db16f7475971decc1b832eec7a9d952bbdf2766f','73b660f6cc3e206926fbc64e572868f23d361ac4','e155382a75885815d9cd838670df39cbb3ed9447'}
def git(*a):
 p=subprocess.run(['git',*a],stdout=subprocess.PIPE,stderr=subprocess.PIPE)
 if p.returncode: raise RuntimeError('git '+str(a)+' '+p.stderr.decode(errors='replace'))
 return p.stdout
def blob(oid):
 b=git('cat-file','blob',oid)
 v=hashlib.sha1(b'blob '+str(len(b)).encode()+b'\0'+b).hexdigest()
 if v!=oid or int(git('cat-file','-s',oid))!=len(b): raise AssertionError('blob mismatch '+oid)
 return b
def at(commit,path):
 try:return git('show',commit+':'+path)
 except RuntimeError:return None
def report_rule(path,data):
 s=data.decode('utf8')
 if '/02-response-r' in path:
  if not re.match(r'### R-\d+\n处理: (采纳|拒绝|部分采纳)',s):raise AssertionError('response decision '+path)
  if '说明:' not in s:raise AssertionError('response explanation '+path)
  return 'response-round/decision/explanation'
 if path.endswith('01-invariants.md'):
  if not s.startswith('# 铁律清单') or len(re.findall(r'^### INV-',s,re.M))<10:raise AssertionError('invariants content '+path)
  return 'invariants-headings-and-rules'
 if not s.startswith('---\n') or 'task_id: 5190fd91-d6c9-4247-850b-5700051a4830' not in s.split('---',2)[1]:raise AssertionError('report frontmatter '+path)
 name=path.split('/')[-1]
 expected='intent' if name.startswith('01-') else 'spec' if name=='02-spec.md' else 'spec_review' if name.startswith(('02-review','02-response')) else 'evaluate' if name.startswith('05-') else 'judge' if name.startswith('06-') else 'commander' if name.startswith('07-') else None
 if expected and ('step: '+expected) not in s.split('---',2)[1]: raise AssertionError('report stage '+path)
 if name.startswith('05-') and not re.search(r'### T-\d+',s):raise AssertionError('QA cases '+path)
 if name.startswith('06-') and not ('裁决' in s or 'verdict' in s):raise AssertionError('judge decision '+path)
 if name.startswith('07-') and not ('裁决' in s or 'Commander' in s):raise AssertionError('commander decision '+path)
 return 'frontmatter/task/stage/body='+expected
lines=git('rev-list','--reverse','--topo-order','--parents',B+'..'+H).decode().splitlines()
commits=[x.split() for x in lines]
upstream=set()
for parts in commits:
 if len(parts)==3:
  second=parts[2]
  upstream.update(git('rev-list',B+'..'+second).decode().splitlines())
for parts in commits:
 c=parts[0]
 for p in parts[1:]:
  raw=git('diff','--no-ext-diff','--no-renames','--raw','--full-index','--abbrev=40',p,c,'--').decode().splitlines()
  print('EDGE',p,c,'changes',len(raw))
  for line in raw:
   meta,path=line.split('\t',1)
   fields=meta.split()
   oldmode,newmode,oldid,newid=fields[:4]
   for oid in (oldid,newid):
    if set(oid)!={'0'}:blob(oid)
   old=at(p,path) if set(oldid)!={'0'} else None
   new=at(c,path) if set(newid)!={'0'} else None
   if old is not None and hashlib.sha1(b'blob '+str(len(old)).encode()+b'\0'+old).hexdigest()!=oldid:raise AssertionError('old tree '+path)
   if new is not None and hashlib.sha1(b'blob '+str(len(new)).encode()+b'\0'+new).hexdigest()!=newid:raise AssertionError('new tree '+path)
   if c in upstream:
    if path.startswith(S) or path==R:raise AssertionError('upstream touched task path '+path)
    rule='upstream-main-content'
   elif c in sync:
    other=parts[2] if p==parts[1] else parts[1]
    expected=at(other,path)
    if path==M:rule='sync-manifest-defer-source-gate'
    elif path.startswith(S) or path==R:
     if new!=at(parts[1],path):raise AssertionError('sync task content changed '+path)
     rule='sync-preserves-task-content'
    else:
     if new!=at(parts[2],path):raise AssertionError('sync upstream content mismatch '+path)
     rule='sync-matches-main-content'
   elif path==R:
    if old is None or new is None or not all(any(x==y for y in it) for it in [iter(new)] for x in old):raise AssertionError('README preservation '+c)
    rule='README-old-byte-subsequence'
   elif path==M:
    a=json.loads(old); b=json.loads(new)
    keep=a['relations']; now=b['relations']
    if now[-len(keep):]!=keep or {k:v for k,v in a.items() if k!='relations'}!={k:v for k,v in b.items() if k!='relations'}:raise AssertionError('manifest history '+c)
    added=now[:-len(keep)]
    if not added:raise AssertionError('manifest no added lines '+c)
    for x in added:
     q=x['path']
     if x!={'owner_path':'packages/brain/scripts/coding-workflow/runner/run-once.mjs','path':q,'role':'documentation'} or not q.startswith(S) or not q.endswith('.md') or at(c,q) is None:raise AssertionError('manifest relation '+q)
    rule='manifest-prefix-add='+str(len(added))+' preserved='+str(len(keep))
   elif path.startswith(S):
    if path.endswith(('03-build.md','04-evidence.md')):
     rule='hidden-object-only'
    elif new is None:raise AssertionError('task report deleted '+path)
    else:
     rule=report_rule(path,new)
     if path.endswith('02-spec.md') and old is not None:
      if not new.startswith(old):raise AssertionError('spec not pure append '+c)
      tail=new[len(old):].decode()
      if c=='200baf82ef92f25d8b10031b52596b1e24fb70a7' and not tail.lstrip().startswith('## commander 裁决（第 1 次）'):raise AssertionError('first spec append')
      if c=='eb96ceb14f76a1572145644d5defc1fec6a49f1b' and not tail.lstrip().startswith('## commander 裁决（第 2 次）'):raise AssertionError('second spec append')
      rule+=' pure-append'
   else:raise AssertionError('unowned task change '+c+' '+path)
   print('PATH',path,oldmode,newmode,oldid,newid,'bytes',len(old) if old is not None else 0,len(new) if new is not None else 0,'hash=ok','content='+rule)
print('AUDIT_OK edges',sum(len(x)-1 for x in commits))
PY
```
```output
EDGE 04b88ddba4b1aa23a156d59734b4d88f621fe1e9 178f61849d85be5a9370f23c033e48ae006cfe25 changes 1
PATH packages/brain/scripts/coding-workflow/runner/README.md :100644 100644 6e6eb65f64c55bdad786b619e2e9a4ef66225297 3e8eea166d021b985bff0c71e1ccbc87d234d248 bytes 10889 13572 hash=ok content=README-old-byte-subsequence
EDGE 178f61849d85be5a9370f23c033e48ae006cfe25 42943dfe5fc3f0680291322a5440bcd46159cbeb changes 12
PATH .implementation-source-relations.json :100644 100644 b4d00c4f7ea1c087ce0511769e1e25299326cbfd 24de93e0438b1c2a800654e7e0407b2949ef5233 bytes 54286 56013 hash=ok content=manifest-prefix-add=11 preserved=307
PATH sprints/10170627-cw-5190fd91/01-intent.md :000000 100644 0000000000000000000000000000000000000000 3a1529d7a143b6fdcf1305b9d72480c22c4d3a8c bytes 0 15486 hash=ok content=frontmatter/task/stage/body=intent
PATH sprints/10170627-cw-5190fd91/01-invariants.md :000000 100644 0000000000000000000000000000000000000000 2276b9f0bca1d5fd3e422ef6e962e1259e266703 bytes 0 89736 hash=ok content=invariants-headings-and-rules
PATH sprints/10170627-cw-5190fd91/02-response-r1.md :000000 100644 0000000000000000000000000000000000000000 f89998664a7a99d3f8bfc0b8b4f0ac0955c8b83a bytes 0 589 hash=ok content=response-round/decision/explanation
Traceback (most recent call last):
  File "<stdin>", line 90, in <module>
  File "<stdin>", line 23, in report_rule
AssertionError: response decision sprints/10170627-cw-5190fd91/02-response-r2.md
```
退出码: 1

### q4audit7
```command
python3 - <<'PY'
import subprocess,hashlib,json,re,sys
B='04b88ddba4b1aa23a156d59734b4d88f621fe1e9'
S='sprints/10170627-cw-5190fd91/'
H='e155382a75885815d9cd838670df39cbb3ed9447'
R='packages/brain/scripts/coding-workflow/runner/README.md'
M='.implementation-source-relations.json'
sync={'f9460639ab0b5e2cd7b05f4f109db13a51b64f01','db16f7475971decc1b832eec7a9d952bbdf2766f','73b660f6cc3e206926fbc64e572868f23d361ac4','e155382a75885815d9cd838670df39cbb3ed9447'}
def git(*a):
 p=subprocess.run(['git',*a],stdout=subprocess.PIPE,stderr=subprocess.PIPE)
 if p.returncode: raise RuntimeError('git '+str(a)+' '+p.stderr.decode(errors='replace'))
 return p.stdout
def blob(oid):
 b=git('cat-file','blob',oid)
 v=hashlib.sha1(b'blob '+str(len(b)).encode()+b'\0'+b).hexdigest()
 if v!=oid or int(git('cat-file','-s',oid))!=len(b): raise AssertionError('blob mismatch '+oid)
 return b
def at(commit,path):
 try:return git('show',commit+':'+path)
 except RuntimeError:return None
def report_rule(path,data):
 s=data.decode('utf8')
 if '/02-response-r' in path:
  if not re.search(r'### R-\d+\n处理: (采纳|拒绝|部分采纳)',s):raise AssertionError('response decision '+path)
  if '说明:' not in s:raise AssertionError('response explanation '+path)
  return 'response-round/decision/explanation'
 if path.endswith('01-invariants.md'):
  if not s.startswith('# 铁律清单') or len(re.findall(r'^### INV-',s,re.M))<10:raise AssertionError('invariants content '+path)
  return 'invariants-headings-and-rules'
 if not s.startswith('---\n') or 'task_id: 5190fd91-d6c9-4247-850b-5700051a4830' not in s.split('---',2)[1]:raise AssertionError('report frontmatter '+path)
 name=path.split('/')[-1]
 expected='intent' if name.startswith('01-') else 'spec' if name=='02-spec.md' else 'spec_review' if name.startswith(('02-review','02-response')) else 'evaluate' if name.startswith('05-') else 'judge' if name.startswith('06-') else 'commander' if name.startswith('07-') else None
 if expected and ('step: '+expected) not in s.split('---',2)[1]: raise AssertionError('report stage '+path)
 if name.startswith('05-') and not re.search(r'### T-\d+',s):raise AssertionError('QA cases '+path)
 if name.startswith('06-') and not ('裁决' in s or 'verdict' in s):raise AssertionError('judge decision '+path)
 if name.startswith('07-') and not ('裁决' in s or 'Commander' in s):raise AssertionError('commander decision '+path)
 return 'frontmatter/task/stage/body='+expected
lines=git('rev-list','--reverse','--topo-order','--parents',B+'..'+H).decode().splitlines()
commits=[x.split() for x in lines]
upstream=set()
for parts in commits:
 if len(parts)==3:
  second=parts[2]
  upstream.update(git('rev-list',B+'..'+second).decode().splitlines())
for parts in commits:
 c=parts[0]
 for p in parts[1:]:
  raw=git('diff','--no-ext-diff','--no-renames','--raw','--full-index','--abbrev=40',p,c,'--').decode().splitlines()
  print('EDGE',p,c,'changes',len(raw))
  for line in raw:
   meta,path=line.split('\t',1)
   fields=meta.split()
   oldmode,newmode,oldid,newid=fields[:4]
   for oid in (oldid,newid):
    if set(oid)!={'0'}:blob(oid)
   old=at(p,path) if set(oldid)!={'0'} else None
   new=at(c,path) if set(newid)!={'0'} else None
   if old is not None and hashlib.sha1(b'blob '+str(len(old)).encode()+b'\0'+old).hexdigest()!=oldid:raise AssertionError('old tree '+path)
   if new is not None and hashlib.sha1(b'blob '+str(len(new)).encode()+b'\0'+new).hexdigest()!=newid:raise AssertionError('new tree '+path)
   if c in upstream:
    if path.startswith(S) or path==R:raise AssertionError('upstream touched task path '+path)
    rule='upstream-main-content'
   elif c in sync:
    other=parts[2] if p==parts[1] else parts[1]
    expected=at(other,path)
    if path==M:rule='sync-manifest-defer-source-gate'
    elif path.startswith(S) or path==R:
     if new!=at(parts[1],path):raise AssertionError('sync task content changed '+path)
     rule='sync-preserves-task-content'
    else:
     if new!=at(parts[2],path):raise AssertionError('sync upstream content mismatch '+path)
     rule='sync-matches-main-content'
   elif path==R:
    if old is None or new is None or not all(any(x==y for y in it) for it in [iter(new)] for x in old):raise AssertionError('README preservation '+c)
    rule='README-old-byte-subsequence'
   elif path==M:
    a=json.loads(old); b=json.loads(new)
    keep=a['relations']; now=b['relations']
    if now[-len(keep):]!=keep or {k:v for k,v in a.items() if k!='relations'}!={k:v for k,v in b.items() if k!='relations'}:raise AssertionError('manifest history '+c)
    added=now[:-len(keep)]
    if not added:raise AssertionError('manifest no added lines '+c)
    for x in added:
     q=x['path']
     if x!={'owner_path':'packages/brain/scripts/coding-workflow/runner/run-once.mjs','path':q,'role':'documentation'} or not q.startswith(S) or not q.endswith('.md') or at(c,q) is None:raise AssertionError('manifest relation '+q)
    rule='manifest-prefix-add='+str(len(added))+' preserved='+str(len(keep))
   elif path.startswith(S):
    if path.endswith(('03-build.md','04-evidence.md')):
     rule='hidden-object-only'
    elif new is None:raise AssertionError('task report deleted '+path)
    else:
     rule=report_rule(path,new)
     if path.endswith('02-spec.md') and old is not None:
      if not new.startswith(old):raise AssertionError('spec not pure append '+c)
      tail=new[len(old):].decode()
      if c=='200baf82ef92f25d8b10031b52596b1e24fb70a7' and not tail.lstrip().startswith('## commander 裁决（第 1 次）'):raise AssertionError('first spec append')
      if c=='eb96ceb14f76a1572145644d5defc1fec6a49f1b' and not tail.lstrip().startswith('## commander 裁决（第 2 次）'):raise AssertionError('second spec append')
      rule+=' pure-append'
   else:raise AssertionError('unowned task change '+c+' '+path)
   print('PATH',path,oldmode,newmode,oldid,newid,'bytes',len(old) if old is not None else 0,len(new) if new is not None else 0,'hash=ok','content='+rule)
print('AUDIT_OK edges',sum(len(x)-1 for x in commits))
PY
```
```output
EDGE 04b88ddba4b1aa23a156d59734b4d88f621fe1e9 178f61849d85be5a9370f23c033e48ae006cfe25 changes 1
PATH packages/brain/scripts/coding-workflow/runner/README.md :100644 100644 6e6eb65f64c55bdad786b619e2e9a4ef66225297 3e8eea166d021b985bff0c71e1ccbc87d234d248 bytes 10889 13572 hash=ok content=README-old-byte-subsequence
EDGE 178f61849d85be5a9370f23c033e48ae006cfe25 42943dfe5fc3f0680291322a5440bcd46159cbeb changes 12
PATH .implementation-source-relations.json :100644 100644 b4d00c4f7ea1c087ce0511769e1e25299326cbfd 24de93e0438b1c2a800654e7e0407b2949ef5233 bytes 54286 56013 hash=ok content=manifest-prefix-add=11 preserved=307
PATH sprints/10170627-cw-5190fd91/01-intent.md :000000 100644 0000000000000000000000000000000000000000 3a1529d7a143b6fdcf1305b9d72480c22c4d3a8c bytes 0 15486 hash=ok content=frontmatter/task/stage/body=intent
PATH sprints/10170627-cw-5190fd91/01-invariants.md :000000 100644 0000000000000000000000000000000000000000 2276b9f0bca1d5fd3e422ef6e962e1259e266703 bytes 0 89736 hash=ok content=invariants-headings-and-rules
PATH sprints/10170627-cw-5190fd91/02-response-r1.md :000000 100644 0000000000000000000000000000000000000000 f89998664a7a99d3f8bfc0b8b4f0ac0955c8b83a bytes 0 589 hash=ok content=response-round/decision/explanation
PATH sprints/10170627-cw-5190fd91/02-response-r2.md :000000 100644 0000000000000000000000000000000000000000 677402ca401d014befa03669d7b1a1aa04a917b2 bytes 0 1084 hash=ok content=response-round/decision/explanation
PATH sprints/10170627-cw-5190fd91/02-review-r1.md :000000 100644 0000000000000000000000000000000000000000 8b068bd99a4c2f5abc189032698f21ad8e267be6 bytes 0 1223 hash=ok content=frontmatter/task/stage/body=spec_review
PATH sprints/10170627-cw-5190fd91/02-review-r2.md :000000 100644 0000000000000000000000000000000000000000 7c80b836bc8c5469525c21273be83ad0e8dde8fc bytes 0 1436 hash=ok content=frontmatter/task/stage/body=spec_review
PATH sprints/10170627-cw-5190fd91/02-review-r3.md :000000 100644 0000000000000000000000000000000000000000 e6922e12ac037d6b2ac8839985f3434b9d4f48e5 bytes 0 1113 hash=ok content=frontmatter/task/stage/body=spec_review
PATH sprints/10170627-cw-5190fd91/02-review.md :000000 100644 0000000000000000000000000000000000000000 e6922e12ac037d6b2ac8839985f3434b9d4f48e5 bytes 0 1113 hash=ok content=frontmatter/task/stage/body=spec_review
PATH sprints/10170627-cw-5190fd91/02-spec.md :000000 100644 0000000000000000000000000000000000000000 9827a68e93e8e7d2b0c21dcb517cb6c6848e2093 bytes 0 18898 hash=ok content=frontmatter/task/stage/body=spec
PATH sprints/10170627-cw-5190fd91/03-build.md :000000 100644 0000000000000000000000000000000000000000 0d96f563734111cfdcd2049a91b8d0973da5adff bytes 0 5095 hash=ok content=hidden-object-only
PATH sprints/10170627-cw-5190fd91/04-evidence.md :000000 100644 0000000000000000000000000000000000000000 46a81734ed6702902319dcbe09f211bf692b0f88 bytes 0 9894 hash=ok content=hidden-object-only
EDGE 04b88ddba4b1aa23a156d59734b4d88f621fe1e9 53cdf746c0c7f446cb7b6987e170d76248999f1d changes 8
PATH .brain-versions :100644 100644 765a3cb613f52cc52b92c04158a540cbe7fba43d f3d261425e53f40ece495da8192f24c6040c909d bytes 9 9 hash=ok content=upstream-main-content
PATH .implementation-source-relations.json :100644 100644 b4d00c4f7ea1c087ce0511769e1e25299326cbfd ffadfb9335a468ec6b871f54fd9a6db08ae9e09d bytes 54286 54140 hash=ok content=upstream-main-content
PATH DEFINITION.md :100644 100644 c61152020942f82f1de6315cb58dda302a1e92cc a4b46caf2f7230368a87796071009b8b35fcc44b bytes 769540 770019 hash=ok content=upstream-main-content
PATH changes/cp-10170325-ci-budget-headroom.md :100644 000000 61678453253490efe1e7e647f808ac43965eaac1 0000000000000000000000000000000000000000 bytes 479 0 hash=ok content=upstream-main-content
PATH package-lock.json :100644 100644 f6a79a39a78356e1a59b763567ac45af92e79f5b aaeb525fdffb110004342b8c6b4f96893d362179 bytes 698744 698744 hash=ok content=upstream-main-content
PATH packages/brain/VERSION :100644 100644 765a3cb613f52cc52b92c04158a540cbe7fba43d f3d261425e53f40ece495da8192f24c6040c909d bytes 9 9 hash=ok content=upstream-main-content
PATH packages/brain/package-lock.json :100644 100644 bd0894471f6609afd0506fb31cabb315e8a97b25 ecb84839f8de085394f8aa50dd5f0100b1e99465 bytes 378833 378833 hash=ok content=upstream-main-content
PATH packages/brain/package.json :100644 100644 5451dac0247ba38ee91ec7441f0ef79426ad37b5 b6a3c1c890593a7bc828afa573a4ccaff05ab2c0 bytes 1998 1998 hash=ok content=upstream-main-content
EDGE 42943dfe5fc3f0680291322a5440bcd46159cbeb f9460639ab0b5e2cd7b05f4f109db13a51b64f01 changes 8
PATH .brain-versions :100644 100644 765a3cb613f52cc52b92c04158a540cbe7fba43d f3d261425e53f40ece495da8192f24c6040c909d bytes 9 9 hash=ok content=sync-matches-main-content
PATH .implementation-source-relations.json :100644 100644 24de93e0438b1c2a800654e7e0407b2949ef5233 c4f2bb176e606551a32bf9a676b77ea69452efc4 bytes 56013 55867 hash=ok content=sync-manifest-defer-source-gate
PATH DEFINITION.md :100644 100644 c61152020942f82f1de6315cb58dda302a1e92cc a4b46caf2f7230368a87796071009b8b35fcc44b bytes 769540 770019 hash=ok content=sync-matches-main-content
PATH changes/cp-10170325-ci-budget-headroom.md :100644 000000 61678453253490efe1e7e647f808ac43965eaac1 0000000000000000000000000000000000000000 bytes 479 0 hash=ok content=sync-matches-main-content
PATH package-lock.json :100644 100644 f6a79a39a78356e1a59b763567ac45af92e79f5b aaeb525fdffb110004342b8c6b4f96893d362179 bytes 698744 698744 hash=ok content=sync-matches-main-content
PATH packages/brain/VERSION :100644 100644 765a3cb613f52cc52b92c04158a540cbe7fba43d f3d261425e53f40ece495da8192f24c6040c909d bytes 9 9 hash=ok content=sync-matches-main-content
PATH packages/brain/package-lock.json :100644 100644 bd0894471f6609afd0506fb31cabb315e8a97b25 ecb84839f8de085394f8aa50dd5f0100b1e99465 bytes 378833 378833 hash=ok content=sync-matches-main-content
PATH packages/brain/package.json :100644 100644 5451dac0247ba38ee91ec7441f0ef79426ad37b5 b6a3c1c890593a7bc828afa573a4ccaff05ab2c0 bytes 1998 1998 hash=ok content=sync-matches-main-content
EDGE 53cdf746c0c7f446cb7b6987e170d76248999f1d f9460639ab0b5e2cd7b05f4f109db13a51b64f01 changes 13
PATH .implementation-source-relations.json :100644 100644 ffadfb9335a468ec6b871f54fd9a6db08ae9e09d c4f2bb176e606551a32bf9a676b77ea69452efc4 bytes 54140 55867 hash=ok content=sync-manifest-defer-source-gate
PATH packages/brain/scripts/coding-workflow/runner/README.md :100644 100644 6e6eb65f64c55bdad786b619e2e9a4ef66225297 3e8eea166d021b985bff0c71e1ccbc87d234d248 bytes 10889 13572 hash=ok content=sync-preserves-task-content
PATH sprints/10170627-cw-5190fd91/01-intent.md :000000 100644 0000000000000000000000000000000000000000 3a1529d7a143b6fdcf1305b9d72480c22c4d3a8c bytes 0 15486 hash=ok content=sync-preserves-task-content
PATH sprints/10170627-cw-5190fd91/01-invariants.md :000000 100644 0000000000000000000000000000000000000000 2276b9f0bca1d5fd3e422ef6e962e1259e266703 bytes 0 89736 hash=ok content=sync-preserves-task-content
PATH sprints/10170627-cw-5190fd91/02-response-r1.md :000000 100644 0000000000000000000000000000000000000000 f89998664a7a99d3f8bfc0b8b4f0ac0955c8b83a bytes 0 589 hash=ok content=sync-preserves-task-content
PATH sprints/10170627-cw-5190fd91/02-response-r2.md :000000 100644 0000000000000000000000000000000000000000 677402ca401d014befa03669d7b1a1aa04a917b2 bytes 0 1084 hash=ok content=sync-preserves-task-content
PATH sprints/10170627-cw-5190fd91/02-review-r1.md :000000 100644 0000000000000000000000000000000000000000 8b068bd99a4c2f5abc189032698f21ad8e267be6 bytes 0 1223 hash=ok content=sync-preserves-task-content
PATH sprints/10170627-cw-5190fd91/02-review-r2.md :000000 100644 0000000000000000000000000000000000000000 7c80b836bc8c5469525c21273be83ad0e8dde8fc bytes 0 1436 hash=ok content=sync-preserves-task-content
PATH sprints/10170627-cw-5190fd91/02-review-r3.md :000000 100644 0000000000000000000000000000000000000000 e6922e12ac037d6b2ac8839985f3434b9d4f48e5 bytes 0 1113 hash=ok content=sync-preserves-task-content
PATH sprints/10170627-cw-5190fd91/02-review.md :000000 100644 0000000000000000000000000000000000000000 e6922e12ac037d6b2ac8839985f3434b9d4f48e5 bytes 0 1113 hash=ok content=sync-preserves-task-content
PATH sprints/10170627-cw-5190fd91/02-spec.md :000000 100644 0000000000000000000000000000000000000000 9827a68e93e8e7d2b0c21dcb517cb6c6848e2093 bytes 0 18898 hash=ok content=sync-preserves-task-content
PATH sprints/10170627-cw-5190fd91/03-build.md :000000 100644 0000000000000000000000000000000000000000 0d96f563734111cfdcd2049a91b8d0973da5adff bytes 0 5095 hash=ok content=sync-preserves-task-content
PATH sprints/10170627-cw-5190fd91/04-evidence.md :000000 100644 0000000000000000000000000000000000000000 46a81734ed6702902319dcbe09f211bf692b0f88 bytes 0 9894 hash=ok content=sync-preserves-task-content
EDGE f9460639ab0b5e2cd7b05f4f109db13a51b64f01 f3dbd423fab3eddea650ac361d4651f393cfd40f changes 2
PATH .implementation-source-relations.json :100644 100644 c4f2bb176e606551a32bf9a676b77ea69452efc4 f3d532f650f678b481fb7125e80f72231bf50d2e bytes 55867 56028 hash=ok content=manifest-prefix-add=1 preserved=317
PATH sprints/10170627-cw-5190fd91/05-qa-report-r1.md :000000 100644 0000000000000000000000000000000000000000 766cc68f7f0cb7bd81da2711b7eb920992f04c05 bytes 0 19119 hash=ok content=frontmatter/task/stage/body=evaluate
EDGE f3dbd423fab3eddea650ac361d4651f393cfd40f 200baf82ef92f25d8b10031b52596b1e24fb70a7 changes 1
PATH sprints/10170627-cw-5190fd91/02-spec.md :100644 100644 9827a68e93e8e7d2b0c21dcb517cb6c6848e2093 51450ee5ebc6651ffd41d88a24e283dafa5ca9ae bytes 18898 21682 hash=ok content=frontmatter/task/stage/body=spec pure-append
EDGE 200baf82ef92f25d8b10031b52596b1e24fb70a7 ea0573f2d1e2a95f5cb7727a70c581d325b1fd21 changes 2
PATH .implementation-source-relations.json :100644 100644 f3d532f650f678b481fb7125e80f72231bf50d2e f0d372e0cb26eb55d12f9def947b73c081b8f963 bytes 56028 56189 hash=ok content=manifest-prefix-add=1 preserved=318
Traceback (most recent call last):
  File "<stdin>", line 90, in <module>
  File "<stdin>", line 29, in report_rule
AssertionError: report frontmatter sprints/10170627-cw-5190fd91/07-commander-r1.md
```
退出码: 1

### q4audit8
```command
python3 - <<'PY'
import subprocess,hashlib,json,re,sys
B='04b88ddba4b1aa23a156d59734b4d88f621fe1e9'
S='sprints/10170627-cw-5190fd91/'
H='e155382a75885815d9cd838670df39cbb3ed9447'
R='packages/brain/scripts/coding-workflow/runner/README.md'
M='.implementation-source-relations.json'
sync={'f9460639ab0b5e2cd7b05f4f109db13a51b64f01','db16f7475971decc1b832eec7a9d952bbdf2766f','73b660f6cc3e206926fbc64e572868f23d361ac4','e155382a75885815d9cd838670df39cbb3ed9447'}
def git(*a):
 p=subprocess.run(['git',*a],stdout=subprocess.PIPE,stderr=subprocess.PIPE)
 if p.returncode: raise RuntimeError('git '+str(a)+' '+p.stderr.decode(errors='replace'))
 return p.stdout
def blob(oid):
 b=git('cat-file','blob',oid)
 v=hashlib.sha1(b'blob '+str(len(b)).encode()+b'\0'+b).hexdigest()
 if v!=oid or int(git('cat-file','-s',oid))!=len(b): raise AssertionError('blob mismatch '+oid)
 return b
def at(commit,path):
 try:return git('show',commit+':'+path)
 except RuntimeError:return None
def report_rule(path,data):
 s=data.decode('utf8')
 if '/07-commander-r' in path:
  if '裁决' not in s or 'Q-4' not in s:raise AssertionError('commander content '+path)
  return 'commander-round/case/decision'
 if '/02-response-r' in path:
  if not re.search(r'### R-\d+\n处理: (采纳|拒绝|部分采纳)',s):raise AssertionError('response decision '+path)
  if '说明:' not in s:raise AssertionError('response explanation '+path)
  return 'response-round/decision/explanation'
 if path.endswith('01-invariants.md'):
  if not s.startswith('# 铁律清单') or len(re.findall(r'^### INV-',s,re.M))<10:raise AssertionError('invariants content '+path)
  return 'invariants-headings-and-rules'
 if not s.startswith('---\n') or 'task_id: 5190fd91-d6c9-4247-850b-5700051a4830' not in s.split('---',2)[1]:raise AssertionError('report frontmatter '+path)
 name=path.split('/')[-1]
 expected='intent' if name.startswith('01-') else 'spec' if name=='02-spec.md' else 'spec_review' if name.startswith(('02-review','02-response')) else 'evaluate' if name.startswith('05-') else 'judge' if name.startswith('06-') else 'commander' if name.startswith('07-') else None
 if expected and ('step: '+expected) not in s.split('---',2)[1]: raise AssertionError('report stage '+path)
 if name.startswith('05-') and not re.search(r'### T-\d+',s):raise AssertionError('QA cases '+path)
 if name.startswith('06-') and not ('裁决' in s or 'verdict' in s):raise AssertionError('judge decision '+path)
 if name.startswith('07-') and not ('裁决' in s or 'Commander' in s):raise AssertionError('commander decision '+path)
 return 'frontmatter/task/stage/body='+expected
lines=git('rev-list','--reverse','--topo-order','--parents',B+'..'+H).decode().splitlines()
commits=[x.split() for x in lines]
upstream=set()
for parts in commits:
 if len(parts)==3:
  second=parts[2]
  upstream.update(git('rev-list',B+'..'+second).decode().splitlines())
for parts in commits:
 c=parts[0]
 for p in parts[1:]:
  raw=git('diff','--no-ext-diff','--no-renames','--raw','--full-index','--abbrev=40',p,c,'--').decode().splitlines()
  print('EDGE',p,c,'changes',len(raw))
  for line in raw:
   meta,path=line.split('\t',1)
   fields=meta.split()
   oldmode,newmode,oldid,newid=fields[:4]
   for oid in (oldid,newid):
    if set(oid)!={'0'}:blob(oid)
   old=at(p,path) if set(oldid)!={'0'} else None
   new=at(c,path) if set(newid)!={'0'} else None
   if old is not None and hashlib.sha1(b'blob '+str(len(old)).encode()+b'\0'+old).hexdigest()!=oldid:raise AssertionError('old tree '+path)
   if new is not None and hashlib.sha1(b'blob '+str(len(new)).encode()+b'\0'+new).hexdigest()!=newid:raise AssertionError('new tree '+path)
   if c in upstream:
    if path.startswith(S) or path==R:raise AssertionError('upstream touched task path '+path)
    rule='upstream-main-content'
   elif c in sync:
    other=parts[2] if p==parts[1] else parts[1]
    expected=at(other,path)
    if path==M:rule='sync-manifest-defer-source-gate'
    elif path.startswith(S) or path==R:
     if new!=at(parts[1],path):raise AssertionError('sync task content changed '+path)
     rule='sync-preserves-task-content'
    else:
     if new!=at(parts[2],path):raise AssertionError('sync upstream content mismatch '+path)
     rule='sync-matches-main-content'
   elif path==R:
    if old is None or new is None or not all(any(x==y for y in it) for it in [iter(new)] for x in old):raise AssertionError('README preservation '+c)
    rule='README-old-byte-subsequence'
   elif path==M:
    a=json.loads(old); b=json.loads(new)
    keep=a['relations']; now=b['relations']
    if now[-len(keep):]!=keep or {k:v for k,v in a.items() if k!='relations'}!={k:v for k,v in b.items() if k!='relations'}:raise AssertionError('manifest history '+c)
    added=now[:-len(keep)]
    if not added:raise AssertionError('manifest no added lines '+c)
    for x in added:
     q=x['path']
     if x!={'owner_path':'packages/brain/scripts/coding-workflow/runner/run-once.mjs','path':q,'role':'documentation'} or not q.startswith(S) or not q.endswith('.md') or at(c,q) is None:raise AssertionError('manifest relation '+q)
    rule='manifest-prefix-add='+str(len(added))+' preserved='+str(len(keep))
   elif path.startswith(S):
    if path.endswith(('03-build.md','04-evidence.md')):
     rule='hidden-object-only'
    elif new is None:raise AssertionError('task report deleted '+path)
    else:
     rule=report_rule(path,new)
     if path.endswith('02-spec.md') and old is not None:
      if not new.startswith(old):raise AssertionError('spec not pure append '+c)
      tail=new[len(old):].decode()
      if c=='200baf82ef92f25d8b10031b52596b1e24fb70a7' and not tail.lstrip().startswith('## commander 裁决（第 1 次）'):raise AssertionError('first spec append')
      if c=='eb96ceb14f76a1572145644d5defc1fec6a49f1b' and not tail.lstrip().startswith('## commander 裁决（第 2 次）'):raise AssertionError('second spec append')
      rule+=' pure-append'
   else:raise AssertionError('unowned task change '+c+' '+path)
   print('PATH',path,oldmode,newmode,oldid,newid,'bytes',len(old) if old is not None else 0,len(new) if new is not None else 0,'hash=ok','content='+rule)
print('AUDIT_OK edges',sum(len(x)-1 for x in commits))
PY
```
```output
EDGE 04b88ddba4b1aa23a156d59734b4d88f621fe1e9 178f61849d85be5a9370f23c033e48ae006cfe25 changes 1
PATH packages/brain/scripts/coding-workflow/runner/README.md :100644 100644 6e6eb65f64c55bdad786b619e2e9a4ef66225297 3e8eea166d021b985bff0c71e1ccbc87d234d248 bytes 10889 13572 hash=ok content=README-old-byte-subsequence
EDGE 178f61849d85be5a9370f23c033e48ae006cfe25 42943dfe5fc3f0680291322a5440bcd46159cbeb changes 12
PATH .implementation-source-relations.json :100644 100644 b4d00c4f7ea1c087ce0511769e1e25299326cbfd 24de93e0438b1c2a800654e7e0407b2949ef5233 bytes 54286 56013 hash=ok content=manifest-prefix-add=11 preserved=307
PATH sprints/10170627-cw-5190fd91/01-intent.md :000000 100644 0000000000000000000000000000000000000000 3a1529d7a143b6fdcf1305b9d72480c22c4d3a8c bytes 0 15486 hash=ok content=frontmatter/task/stage/body=intent
PATH sprints/10170627-cw-5190fd91/01-invariants.md :000000 100644 0000000000000000000000000000000000000000 2276b9f0bca1d5fd3e422ef6e962e1259e266703 bytes 0 89736 hash=ok content=invariants-headings-and-rules
PATH sprints/10170627-cw-5190fd91/02-response-r1.md :000000 100644 0000000000000000000000000000000000000000 f89998664a7a99d3f8bfc0b8b4f0ac0955c8b83a bytes 0 589 hash=ok content=response-round/decision/explanation
PATH sprints/10170627-cw-5190fd91/02-response-r2.md :000000 100644 0000000000000000000000000000000000000000 677402ca401d014befa03669d7b1a1aa04a917b2 bytes 0 1084 hash=ok content=response-round/decision/explanation
PATH sprints/10170627-cw-5190fd91/02-review-r1.md :000000 100644 0000000000000000000000000000000000000000 8b068bd99a4c2f5abc189032698f21ad8e267be6 bytes 0 1223 hash=ok content=frontmatter/task/stage/body=spec_review
PATH sprints/10170627-cw-5190fd91/02-review-r2.md :000000 100644 0000000000000000000000000000000000000000 7c80b836bc8c5469525c21273be83ad0e8dde8fc bytes 0 1436 hash=ok content=frontmatter/task/stage/body=spec_review
PATH sprints/10170627-cw-5190fd91/02-review-r3.md :000000 100644 0000000000000000000000000000000000000000 e6922e12ac037d6b2ac8839985f3434b9d4f48e5 bytes 0 1113 hash=ok content=frontmatter/task/stage/body=spec_review
PATH sprints/10170627-cw-5190fd91/02-review.md :000000 100644 0000000000000000000000000000000000000000 e6922e12ac037d6b2ac8839985f3434b9d4f48e5 bytes 0 1113 hash=ok content=frontmatter/task/stage/body=spec_review
PATH sprints/10170627-cw-5190fd91/02-spec.md :000000 100644 0000000000000000000000000000000000000000 9827a68e93e8e7d2b0c21dcb517cb6c6848e2093 bytes 0 18898 hash=ok content=frontmatter/task/stage/body=spec
PATH sprints/10170627-cw-5190fd91/03-build.md :000000 100644 0000000000000000000000000000000000000000 0d96f563734111cfdcd2049a91b8d0973da5adff bytes 0 5095 hash=ok content=hidden-object-only
PATH sprints/10170627-cw-5190fd91/04-evidence.md :000000 100644 0000000000000000000000000000000000000000 46a81734ed6702902319dcbe09f211bf692b0f88 bytes 0 9894 hash=ok content=hidden-object-only
EDGE 04b88ddba4b1aa23a156d59734b4d88f621fe1e9 53cdf746c0c7f446cb7b6987e170d76248999f1d changes 8
PATH .brain-versions :100644 100644 765a3cb613f52cc52b92c04158a540cbe7fba43d f3d261425e53f40ece495da8192f24c6040c909d bytes 9 9 hash=ok content=upstream-main-content
PATH .implementation-source-relations.json :100644 100644 b4d00c4f7ea1c087ce0511769e1e25299326cbfd ffadfb9335a468ec6b871f54fd9a6db08ae9e09d bytes 54286 54140 hash=ok content=upstream-main-content
PATH DEFINITION.md :100644 100644 c61152020942f82f1de6315cb58dda302a1e92cc a4b46caf2f7230368a87796071009b8b35fcc44b bytes 769540 770019 hash=ok content=upstream-main-content
PATH changes/cp-10170325-ci-budget-headroom.md :100644 000000 61678453253490efe1e7e647f808ac43965eaac1 0000000000000000000000000000000000000000 bytes 479 0 hash=ok content=upstream-main-content
PATH package-lock.json :100644 100644 f6a79a39a78356e1a59b763567ac45af92e79f5b aaeb525fdffb110004342b8c6b4f96893d362179 bytes 698744 698744 hash=ok content=upstream-main-content
PATH packages/brain/VERSION :100644 100644 765a3cb613f52cc52b92c04158a540cbe7fba43d f3d261425e53f40ece495da8192f24c6040c909d bytes 9 9 hash=ok content=upstream-main-content
PATH packages/brain/package-lock.json :100644 100644 bd0894471f6609afd0506fb31cabb315e8a97b25 ecb84839f8de085394f8aa50dd5f0100b1e99465 bytes 378833 378833 hash=ok content=upstream-main-content
PATH packages/brain/package.json :100644 100644 5451dac0247ba38ee91ec7441f0ef79426ad37b5 b6a3c1c890593a7bc828afa573a4ccaff05ab2c0 bytes 1998 1998 hash=ok content=upstream-main-content
EDGE 42943dfe5fc3f0680291322a5440bcd46159cbeb f9460639ab0b5e2cd7b05f4f109db13a51b64f01 changes 8
PATH .brain-versions :100644 100644 765a3cb613f52cc52b92c04158a540cbe7fba43d f3d261425e53f40ece495da8192f24c6040c909d bytes 9 9 hash=ok content=sync-matches-main-content
PATH .implementation-source-relations.json :100644 100644 24de93e0438b1c2a800654e7e0407b2949ef5233 c4f2bb176e606551a32bf9a676b77ea69452efc4 bytes 56013 55867 hash=ok content=sync-manifest-defer-source-gate
PATH DEFINITION.md :100644 100644 c61152020942f82f1de6315cb58dda302a1e92cc a4b46caf2f7230368a87796071009b8b35fcc44b bytes 769540 770019 hash=ok content=sync-matches-main-content
PATH changes/cp-10170325-ci-budget-headroom.md :100644 000000 61678453253490efe1e7e647f808ac43965eaac1 0000000000000000000000000000000000000000 bytes 479 0 hash=ok content=sync-matches-main-content
PATH package-lock.json :100644 100644 f6a79a39a78356e1a59b763567ac45af92e79f5b aaeb525fdffb110004342b8c6b4f96893d362179 bytes 698744 698744 hash=ok content=sync-matches-main-content
PATH packages/brain/VERSION :100644 100644 765a3cb613f52cc52b92c04158a540cbe7fba43d f3d261425e53f40ece495da8192f24c6040c909d bytes 9 9 hash=ok content=sync-matches-main-content
PATH packages/brain/package-lock.json :100644 100644 bd0894471f6609afd0506fb31cabb315e8a97b25 ecb84839f8de085394f8aa50dd5f0100b1e99465 bytes 378833 378833 hash=ok content=sync-matches-main-content
PATH packages/brain/package.json :100644 100644 5451dac0247ba38ee91ec7441f0ef79426ad37b5 b6a3c1c890593a7bc828afa573a4ccaff05ab2c0 bytes 1998 1998 hash=ok content=sync-matches-main-content
EDGE 53cdf746c0c7f446cb7b6987e170d76248999f1d f9460639ab0b5e2cd7b05f4f109db13a51b64f01 changes 13
PATH .implementation-source-relations.json :100644 100644 ffadfb9335a468ec6b871f54fd9a6db08ae9e09d c4f2bb176e606551a32bf9a676b77ea69452efc4 bytes 54140 55867 hash=ok content=sync-manifest-defer-source-gate
PATH packages/brain/scripts/coding-workflow/runner/README.md :100644 100644 6e6eb65f64c55bdad786b619e2e9a4ef66225297 3e8eea166d021b985bff0c71e1ccbc87d234d248 bytes 10889 13572 hash=ok content=sync-preserves-task-content
PATH sprints/10170627-cw-5190fd91/01-intent.md :000000 100644 0000000000000000000000000000000000000000 3a1529d7a143b6fdcf1305b9d72480c22c4d3a8c bytes 0 15486 hash=ok content=sync-preserves-task-content
PATH sprints/10170627-cw-5190fd91/01-invariants.md :000000 100644 0000000000000000000000000000000000000000 2276b9f0bca1d5fd3e422ef6e962e1259e266703 bytes 0 89736 hash=ok content=sync-preserves-task-content
PATH sprints/10170627-cw-5190fd91/02-response-r1.md :000000 100644 0000000000000000000000000000000000000000 f89998664a7a99d3f8bfc0b8b4f0ac0955c8b83a bytes 0 589 hash=ok content=sync-preserves-task-content
PATH sprints/10170627-cw-5190fd91/02-response-r2.md :000000 100644 0000000000000000000000000000000000000000 677402ca401d014befa03669d7b1a1aa04a917b2 bytes 0 1084 hash=ok content=sync-preserves-task-content
PATH sprints/10170627-cw-5190fd91/02-review-r1.md :000000 100644 0000000000000000000000000000000000000000 8b068bd99a4c2f5abc189032698f21ad8e267be6 bytes 0 1223 hash=ok content=sync-preserves-task-content
PATH sprints/10170627-cw-5190fd91/02-review-r2.md :000000 100644 0000000000000000000000000000000000000000 7c80b836bc8c5469525c21273be83ad0e8dde8fc bytes 0 1436 hash=ok content=sync-preserves-task-content
PATH sprints/10170627-cw-5190fd91/02-review-r3.md :000000 100644 0000000000000000000000000000000000000000 e6922e12ac037d6b2ac8839985f3434b9d4f48e5 bytes 0 1113 hash=ok content=sync-preserves-task-content
PATH sprints/10170627-cw-5190fd91/02-review.md :000000 100644 0000000000000000000000000000000000000000 e6922e12ac037d6b2ac8839985f3434b9d4f48e5 bytes 0 1113 hash=ok content=sync-preserves-task-content
PATH sprints/10170627-cw-5190fd91/02-spec.md :000000 100644 0000000000000000000000000000000000000000 9827a68e93e8e7d2b0c21dcb517cb6c6848e2093 bytes 0 18898 hash=ok content=sync-preserves-task-content
PATH sprints/10170627-cw-5190fd91/03-build.md :000000 100644 0000000000000000000000000000000000000000 0d96f563734111cfdcd2049a91b8d0973da5adff bytes 0 5095 hash=ok content=sync-preserves-task-content
PATH sprints/10170627-cw-5190fd91/04-evidence.md :000000 100644 0000000000000000000000000000000000000000 46a81734ed6702902319dcbe09f211bf692b0f88 bytes 0 9894 hash=ok content=sync-preserves-task-content
EDGE f9460639ab0b5e2cd7b05f4f109db13a51b64f01 f3dbd423fab3eddea650ac361d4651f393cfd40f changes 2
PATH .implementation-source-relations.json :100644 100644 c4f2bb176e606551a32bf9a676b77ea69452efc4 f3d532f650f678b481fb7125e80f72231bf50d2e bytes 55867 56028 hash=ok content=manifest-prefix-add=1 preserved=317
PATH sprints/10170627-cw-5190fd91/05-qa-report-r1.md :000000 100644 0000000000000000000000000000000000000000 766cc68f7f0cb7bd81da2711b7eb920992f04c05 bytes 0 19119 hash=ok content=frontmatter/task/stage/body=evaluate
EDGE f3dbd423fab3eddea650ac361d4651f393cfd40f 200baf82ef92f25d8b10031b52596b1e24fb70a7 changes 1
PATH sprints/10170627-cw-5190fd91/02-spec.md :100644 100644 9827a68e93e8e7d2b0c21dcb517cb6c6848e2093 51450ee5ebc6651ffd41d88a24e283dafa5ca9ae bytes 18898 21682 hash=ok content=frontmatter/task/stage/body=spec pure-append
EDGE 200baf82ef92f25d8b10031b52596b1e24fb70a7 ea0573f2d1e2a95f5cb7727a70c581d325b1fd21 changes 2
PATH .implementation-source-relations.json :100644 100644 f3d532f650f678b481fb7125e80f72231bf50d2e f0d372e0cb26eb55d12f9def947b73c081b8f963 bytes 56028 56189 hash=ok content=manifest-prefix-add=1 preserved=318
PATH sprints/10170627-cw-5190fd91/07-commander-r1.md :000000 100644 0000000000000000000000000000000000000000 fc178a6a802a0410e83cdf2c9c03233f8206bb1c bytes 0 876 hash=ok content=commander-round/case/decision
EDGE ea0573f2d1e2a95f5cb7727a70c581d325b1fd21 8fa7a1c035bd76335c99fe71ed7450d5832b49e8 changes 3
PATH .implementation-source-relations.json :100644 100644 f0d372e0cb26eb55d12f9def947b73c081b8f963 eab6aa5c1fbf307fe497d8450d3b9837ecb6977b bytes 56189 56507 hash=ok content=manifest-prefix-add=2 preserved=319
PATH sprints/10170627-cw-5190fd91/05-qa-report-r2.md :000000 100644 0000000000000000000000000000000000000000 05e0b0b9c9bb8608cbceed644e7c8b9e8243aeee bytes 0 49562 hash=ok content=frontmatter/task/stage/body=evaluate
Traceback (most recent call last):
  File "<stdin>", line 93, in <module>
  File "<stdin>", line 32, in report_rule
AssertionError: report frontmatter sprints/10170627-cw-5190fd91/06-judge-r2.md
```
退出码: 1

### q4audit9
```command
python3 - <<'PY'
import subprocess,hashlib,json,re,sys
B='04b88ddba4b1aa23a156d59734b4d88f621fe1e9'
S='sprints/10170627-cw-5190fd91/'
H='e155382a75885815d9cd838670df39cbb3ed9447'
R='packages/brain/scripts/coding-workflow/runner/README.md'
M='.implementation-source-relations.json'
sync={'f9460639ab0b5e2cd7b05f4f109db13a51b64f01','db16f7475971decc1b832eec7a9d952bbdf2766f','73b660f6cc3e206926fbc64e572868f23d361ac4','e155382a75885815d9cd838670df39cbb3ed9447'}
def git(*a):
 p=subprocess.run(['git',*a],stdout=subprocess.PIPE,stderr=subprocess.PIPE)
 if p.returncode: raise RuntimeError('git '+str(a)+' '+p.stderr.decode(errors='replace'))
 return p.stdout
def blob(oid):
 b=git('cat-file','blob',oid)
 v=hashlib.sha1(b'blob '+str(len(b)).encode()+b'\0'+b).hexdigest()
 if v!=oid or int(git('cat-file','-s',oid))!=len(b): raise AssertionError('blob mismatch '+oid)
 return b
def at(commit,path):
 try:return git('show',commit+':'+path)
 except RuntimeError:return None
def report_rule(path,data):
 s=data.decode('utf8')
 if '/06-judge-r' in path:
  if '裁决' not in s or '问题' not in s:raise AssertionError('judge content '+path)
  return 'judge-round/decision/issues'
 if '/07-commander-r' in path:
  if '裁决' not in s or 'Q-4' not in s:raise AssertionError('commander content '+path)
  return 'commander-round/case/decision'
 if '/02-response-r' in path:
  if not re.search(r'### R-\d+\n处理: (采纳|拒绝|部分采纳)',s):raise AssertionError('response decision '+path)
  if '说明:' not in s:raise AssertionError('response explanation '+path)
  return 'response-round/decision/explanation'
 if path.endswith('01-invariants.md'):
  if not s.startswith('# 铁律清单') or len(re.findall(r'^### INV-',s,re.M))<10:raise AssertionError('invariants content '+path)
  return 'invariants-headings-and-rules'
 if not s.startswith('---\n') or 'task_id: 5190fd91-d6c9-4247-850b-5700051a4830' not in s.split('---',2)[1]:raise AssertionError('report frontmatter '+path)
 name=path.split('/')[-1]
 expected='intent' if name.startswith('01-') else 'spec' if name=='02-spec.md' else 'spec_review' if name.startswith(('02-review','02-response')) else 'evaluate' if name.startswith('05-') else 'judge' if name.startswith('06-') else 'commander' if name.startswith('07-') else None
 if expected and ('step: '+expected) not in s.split('---',2)[1]: raise AssertionError('report stage '+path)
 if name.startswith('05-') and not re.search(r'### T-\d+',s):raise AssertionError('QA cases '+path)
 if name.startswith('06-') and not ('裁决' in s or 'verdict' in s):raise AssertionError('judge decision '+path)
 if name.startswith('07-') and not ('裁决' in s or 'Commander' in s):raise AssertionError('commander decision '+path)
 return 'frontmatter/task/stage/body='+expected
lines=git('rev-list','--reverse','--topo-order','--parents',B+'..'+H).decode().splitlines()
commits=[x.split() for x in lines]
upstream=set()
for parts in commits:
 if len(parts)==3:
  second=parts[2]
  upstream.update(git('rev-list',B+'..'+second).decode().splitlines())
for parts in commits:
 c=parts[0]
 for p in parts[1:]:
  raw=git('diff','--no-ext-diff','--no-renames','--raw','--full-index','--abbrev=40',p,c,'--').decode().splitlines()
  print('EDGE',p,c,'changes',len(raw))
  for line in raw:
   meta,path=line.split('\t',1)
   fields=meta.split()
   oldmode,newmode,oldid,newid=fields[:4]
   for oid in (oldid,newid):
    if set(oid)!={'0'}:blob(oid)
   old=at(p,path) if set(oldid)!={'0'} else None
   new=at(c,path) if set(newid)!={'0'} else None
   if old is not None and hashlib.sha1(b'blob '+str(len(old)).encode()+b'\0'+old).hexdigest()!=oldid:raise AssertionError('old tree '+path)
   if new is not None and hashlib.sha1(b'blob '+str(len(new)).encode()+b'\0'+new).hexdigest()!=newid:raise AssertionError('new tree '+path)
   if c in upstream:
    if path.startswith(S) or path==R:raise AssertionError('upstream touched task path '+path)
    rule='upstream-main-content'
   elif c in sync:
    other=parts[2] if p==parts[1] else parts[1]
    expected=at(other,path)
    if path==M:rule='sync-manifest-defer-source-gate'
    elif path.startswith(S) or path==R:
     if new!=at(parts[1],path):raise AssertionError('sync task content changed '+path)
     rule='sync-preserves-task-content'
    else:
     if new!=at(parts[2],path):raise AssertionError('sync upstream content mismatch '+path)
     rule='sync-matches-main-content'
   elif path==R:
    if old is None or new is None or not all(any(x==y for y in it) for it in [iter(new)] for x in old):raise AssertionError('README preservation '+c)
    rule='README-old-byte-subsequence'
   elif path==M:
    a=json.loads(old); b=json.loads(new)
    keep=a['relations']; now=b['relations']
    if now[-len(keep):]!=keep or {k:v for k,v in a.items() if k!='relations'}!={k:v for k,v in b.items() if k!='relations'}:raise AssertionError('manifest history '+c)
    added=now[:-len(keep)]
    if not added:raise AssertionError('manifest no added lines '+c)
    for x in added:
     q=x['path']
     if x!={'owner_path':'packages/brain/scripts/coding-workflow/runner/run-once.mjs','path':q,'role':'documentation'} or not q.startswith(S) or not q.endswith('.md') or at(c,q) is None:raise AssertionError('manifest relation '+q)
    rule='manifest-prefix-add='+str(len(added))+' preserved='+str(len(keep))
   elif path.startswith(S):
    if path.endswith(('03-build.md','04-evidence.md')):
     rule='hidden-object-only'
    elif new is None:raise AssertionError('task report deleted '+path)
    else:
     rule=report_rule(path,new)
     if path.endswith('02-spec.md') and old is not None:
      if not new.startswith(old):raise AssertionError('spec not pure append '+c)
      tail=new[len(old):].decode()
      if c=='200baf82ef92f25d8b10031b52596b1e24fb70a7' and not tail.lstrip().startswith('## commander 裁决（第 1 次）'):raise AssertionError('first spec append')
      if c=='eb96ceb14f76a1572145644d5defc1fec6a49f1b' and not tail.lstrip().startswith('## commander 裁决（第 2 次）'):raise AssertionError('second spec append')
      rule+=' pure-append'
   else:raise AssertionError('unowned task change '+c+' '+path)
   print('PATH',path,oldmode,newmode,oldid,newid,'bytes',len(old) if old is not None else 0,len(new) if new is not None else 0,'hash=ok','content='+rule)
print('AUDIT_OK edges',sum(len(x)-1 for x in commits))
PY
```
```output
EDGE 04b88ddba4b1aa23a156d59734b4d88f621fe1e9 178f61849d85be5a9370f23c033e48ae006cfe25 changes 1
PATH packages/brain/scripts/coding-workflow/runner/README.md :100644 100644 6e6eb65f64c55bdad786b619e2e9a4ef66225297 3e8eea166d021b985bff0c71e1ccbc87d234d248 bytes 10889 13572 hash=ok content=README-old-byte-subsequence
EDGE 178f61849d85be5a9370f23c033e48ae006cfe25 42943dfe5fc3f0680291322a5440bcd46159cbeb changes 12
PATH .implementation-source-relations.json :100644 100644 b4d00c4f7ea1c087ce0511769e1e25299326cbfd 24de93e0438b1c2a800654e7e0407b2949ef5233 bytes 54286 56013 hash=ok content=manifest-prefix-add=11 preserved=307
PATH sprints/10170627-cw-5190fd91/01-intent.md :000000 100644 0000000000000000000000000000000000000000 3a1529d7a143b6fdcf1305b9d72480c22c4d3a8c bytes 0 15486 hash=ok content=frontmatter/task/stage/body=intent
PATH sprints/10170627-cw-5190fd91/01-invariants.md :000000 100644 0000000000000000000000000000000000000000 2276b9f0bca1d5fd3e422ef6e962e1259e266703 bytes 0 89736 hash=ok content=invariants-headings-and-rules
PATH sprints/10170627-cw-5190fd91/02-response-r1.md :000000 100644 0000000000000000000000000000000000000000 f89998664a7a99d3f8bfc0b8b4f0ac0955c8b83a bytes 0 589 hash=ok content=response-round/decision/explanation
PATH sprints/10170627-cw-5190fd91/02-response-r2.md :000000 100644 0000000000000000000000000000000000000000 677402ca401d014befa03669d7b1a1aa04a917b2 bytes 0 1084 hash=ok content=response-round/decision/explanation
PATH sprints/10170627-cw-5190fd91/02-review-r1.md :000000 100644 0000000000000000000000000000000000000000 8b068bd99a4c2f5abc189032698f21ad8e267be6 bytes 0 1223 hash=ok content=frontmatter/task/stage/body=spec_review
PATH sprints/10170627-cw-5190fd91/02-review-r2.md :000000 100644 0000000000000000000000000000000000000000 7c80b836bc8c5469525c21273be83ad0e8dde8fc bytes 0 1436 hash=ok content=frontmatter/task/stage/body=spec_review
PATH sprints/10170627-cw-5190fd91/02-review-r3.md :000000 100644 0000000000000000000000000000000000000000 e6922e12ac037d6b2ac8839985f3434b9d4f48e5 bytes 0 1113 hash=ok content=frontmatter/task/stage/body=spec_review
PATH sprints/10170627-cw-5190fd91/02-review.md :000000 100644 0000000000000000000000000000000000000000 e6922e12ac037d6b2ac8839985f3434b9d4f48e5 bytes 0 1113 hash=ok content=frontmatter/task/stage/body=spec_review
PATH sprints/10170627-cw-5190fd91/02-spec.md :000000 100644 0000000000000000000000000000000000000000 9827a68e93e8e7d2b0c21dcb517cb6c6848e2093 bytes 0 18898 hash=ok content=frontmatter/task/stage/body=spec
PATH sprints/10170627-cw-5190fd91/03-build.md :000000 100644 0000000000000000000000000000000000000000 0d96f563734111cfdcd2049a91b8d0973da5adff bytes 0 5095 hash=ok content=hidden-object-only
PATH sprints/10170627-cw-5190fd91/04-evidence.md :000000 100644 0000000000000000000000000000000000000000 46a81734ed6702902319dcbe09f211bf692b0f88 bytes 0 9894 hash=ok content=hidden-object-only
EDGE 04b88ddba4b1aa23a156d59734b4d88f621fe1e9 53cdf746c0c7f446cb7b6987e170d76248999f1d changes 8
PATH .brain-versions :100644 100644 765a3cb613f52cc52b92c04158a540cbe7fba43d f3d261425e53f40ece495da8192f24c6040c909d bytes 9 9 hash=ok content=upstream-main-content
PATH .implementation-source-relations.json :100644 100644 b4d00c4f7ea1c087ce0511769e1e25299326cbfd ffadfb9335a468ec6b871f54fd9a6db08ae9e09d bytes 54286 54140 hash=ok content=upstream-main-content
PATH DEFINITION.md :100644 100644 c61152020942f82f1de6315cb58dda302a1e92cc a4b46caf2f7230368a87796071009b8b35fcc44b bytes 769540 770019 hash=ok content=upstream-main-content
PATH changes/cp-10170325-ci-budget-headroom.md :100644 000000 61678453253490efe1e7e647f808ac43965eaac1 0000000000000000000000000000000000000000 bytes 479 0 hash=ok content=upstream-main-content
PATH package-lock.json :100644 100644 f6a79a39a78356e1a59b763567ac45af92e79f5b aaeb525fdffb110004342b8c6b4f96893d362179 bytes 698744 698744 hash=ok content=upstream-main-content
PATH packages/brain/VERSION :100644 100644 765a3cb613f52cc52b92c04158a540cbe7fba43d f3d261425e53f40ece495da8192f24c6040c909d bytes 9 9 hash=ok content=upstream-main-content
PATH packages/brain/package-lock.json :100644 100644 bd0894471f6609afd0506fb31cabb315e8a97b25 ecb84839f8de085394f8aa50dd5f0100b1e99465 bytes 378833 378833 hash=ok content=upstream-main-content
PATH packages/brain/package.json :100644 100644 5451dac0247ba38ee91ec7441f0ef79426ad37b5 b6a3c1c890593a7bc828afa573a4ccaff05ab2c0 bytes 1998 1998 hash=ok content=upstream-main-content
EDGE 42943dfe5fc3f0680291322a5440bcd46159cbeb f9460639ab0b5e2cd7b05f4f109db13a51b64f01 changes 8
PATH .brain-versions :100644 100644 765a3cb613f52cc52b92c04158a540cbe7fba43d f3d261425e53f40ece495da8192f24c6040c909d bytes 9 9 hash=ok content=sync-matches-main-content
PATH .implementation-source-relations.json :100644 100644 24de93e0438b1c2a800654e7e0407b2949ef5233 c4f2bb176e606551a32bf9a676b77ea69452efc4 bytes 56013 55867 hash=ok content=sync-manifest-defer-source-gate
PATH DEFINITION.md :100644 100644 c61152020942f82f1de6315cb58dda302a1e92cc a4b46caf2f7230368a87796071009b8b35fcc44b bytes 769540 770019 hash=ok content=sync-matches-main-content
PATH changes/cp-10170325-ci-budget-headroom.md :100644 000000 61678453253490efe1e7e647f808ac43965eaac1 0000000000000000000000000000000000000000 bytes 479 0 hash=ok content=sync-matches-main-content
PATH package-lock.json :100644 100644 f6a79a39a78356e1a59b763567ac45af92e79f5b aaeb525fdffb110004342b8c6b4f96893d362179 bytes 698744 698744 hash=ok content=sync-matches-main-content
PATH packages/brain/VERSION :100644 100644 765a3cb613f52cc52b92c04158a540cbe7fba43d f3d261425e53f40ece495da8192f24c6040c909d bytes 9 9 hash=ok content=sync-matches-main-content
PATH packages/brain/package-lock.json :100644 100644 bd0894471f6609afd0506fb31cabb315e8a97b25 ecb84839f8de085394f8aa50dd5f0100b1e99465 bytes 378833 378833 hash=ok content=sync-matches-main-content
PATH packages/brain/package.json :100644 100644 5451dac0247ba38ee91ec7441f0ef79426ad37b5 b6a3c1c890593a7bc828afa573a4ccaff05ab2c0 bytes 1998 1998 hash=ok content=sync-matches-main-content
EDGE 53cdf746c0c7f446cb7b6987e170d76248999f1d f9460639ab0b5e2cd7b05f4f109db13a51b64f01 changes 13
PATH .implementation-source-relations.json :100644 100644 ffadfb9335a468ec6b871f54fd9a6db08ae9e09d c4f2bb176e606551a32bf9a676b77ea69452efc4 bytes 54140 55867 hash=ok content=sync-manifest-defer-source-gate
PATH packages/brain/scripts/coding-workflow/runner/README.md :100644 100644 6e6eb65f64c55bdad786b619e2e9a4ef66225297 3e8eea166d021b985bff0c71e1ccbc87d234d248 bytes 10889 13572 hash=ok content=sync-preserves-task-content
PATH sprints/10170627-cw-5190fd91/01-intent.md :000000 100644 0000000000000000000000000000000000000000 3a1529d7a143b6fdcf1305b9d72480c22c4d3a8c bytes 0 15486 hash=ok content=sync-preserves-task-content
PATH sprints/10170627-cw-5190fd91/01-invariants.md :000000 100644 0000000000000000000000000000000000000000 2276b9f0bca1d5fd3e422ef6e962e1259e266703 bytes 0 89736 hash=ok content=sync-preserves-task-content
PATH sprints/10170627-cw-5190fd91/02-response-r1.md :000000 100644 0000000000000000000000000000000000000000 f89998664a7a99d3f8bfc0b8b4f0ac0955c8b83a bytes 0 589 hash=ok content=sync-preserves-task-content
PATH sprints/10170627-cw-5190fd91/02-response-r2.md :000000 100644 0000000000000000000000000000000000000000 677402ca401d014befa03669d7b1a1aa04a917b2 bytes 0 1084 hash=ok content=sync-preserves-task-content
PATH sprints/10170627-cw-5190fd91/02-review-r1.md :000000 100644 0000000000000000000000000000000000000000 8b068bd99a4c2f5abc189032698f21ad8e267be6 bytes 0 1223 hash=ok content=sync-preserves-task-content
PATH sprints/10170627-cw-5190fd91/02-review-r2.md :000000 100644 0000000000000000000000000000000000000000 7c80b836bc8c5469525c21273be83ad0e8dde8fc bytes 0 1436 hash=ok content=sync-preserves-task-content
PATH sprints/10170627-cw-5190fd91/02-review-r3.md :000000 100644 0000000000000000000000000000000000000000 e6922e12ac037d6b2ac8839985f3434b9d4f48e5 bytes 0 1113 hash=ok content=sync-preserves-task-content
PATH sprints/10170627-cw-5190fd91/02-review.md :000000 100644 0000000000000000000000000000000000000000 e6922e12ac037d6b2ac8839985f3434b9d4f48e5 bytes 0 1113 hash=ok content=sync-preserves-task-content
PATH sprints/10170627-cw-5190fd91/02-spec.md :000000 100644 0000000000000000000000000000000000000000 9827a68e93e8e7d2b0c21dcb517cb6c6848e2093 bytes 0 18898 hash=ok content=sync-preserves-task-content
PATH sprints/10170627-cw-5190fd91/03-build.md :000000 100644 0000000000000000000000000000000000000000 0d96f563734111cfdcd2049a91b8d0973da5adff bytes 0 5095 hash=ok content=sync-preserves-task-content
PATH sprints/10170627-cw-5190fd91/04-evidence.md :000000 100644 0000000000000000000000000000000000000000 46a81734ed6702902319dcbe09f211bf692b0f88 bytes 0 9894 hash=ok content=sync-preserves-task-content
EDGE f9460639ab0b5e2cd7b05f4f109db13a51b64f01 f3dbd423fab3eddea650ac361d4651f393cfd40f changes 2
PATH .implementation-source-relations.json :100644 100644 c4f2bb176e606551a32bf9a676b77ea69452efc4 f3d532f650f678b481fb7125e80f72231bf50d2e bytes 55867 56028 hash=ok content=manifest-prefix-add=1 preserved=317
PATH sprints/10170627-cw-5190fd91/05-qa-report-r1.md :000000 100644 0000000000000000000000000000000000000000 766cc68f7f0cb7bd81da2711b7eb920992f04c05 bytes 0 19119 hash=ok content=frontmatter/task/stage/body=evaluate
EDGE f3dbd423fab3eddea650ac361d4651f393cfd40f 200baf82ef92f25d8b10031b52596b1e24fb70a7 changes 1
PATH sprints/10170627-cw-5190fd91/02-spec.md :100644 100644 9827a68e93e8e7d2b0c21dcb517cb6c6848e2093 51450ee5ebc6651ffd41d88a24e283dafa5ca9ae bytes 18898 21682 hash=ok content=frontmatter/task/stage/body=spec pure-append
EDGE 200baf82ef92f25d8b10031b52596b1e24fb70a7 ea0573f2d1e2a95f5cb7727a70c581d325b1fd21 changes 2
PATH .implementation-source-relations.json :100644 100644 f3d532f650f678b481fb7125e80f72231bf50d2e f0d372e0cb26eb55d12f9def947b73c081b8f963 bytes 56028 56189 hash=ok content=manifest-prefix-add=1 preserved=318
PATH sprints/10170627-cw-5190fd91/07-commander-r1.md :000000 100644 0000000000000000000000000000000000000000 fc178a6a802a0410e83cdf2c9c03233f8206bb1c bytes 0 876 hash=ok content=commander-round/case/decision
EDGE ea0573f2d1e2a95f5cb7727a70c581d325b1fd21 8fa7a1c035bd76335c99fe71ed7450d5832b49e8 changes 3
PATH .implementation-source-relations.json :100644 100644 f0d372e0cb26eb55d12f9def947b73c081b8f963 eab6aa5c1fbf307fe497d8450d3b9837ecb6977b bytes 56189 56507 hash=ok content=manifest-prefix-add=2 preserved=319
PATH sprints/10170627-cw-5190fd91/05-qa-report-r2.md :000000 100644 0000000000000000000000000000000000000000 05e0b0b9c9bb8608cbceed644e7c8b9e8243aeee bytes 0 49562 hash=ok content=frontmatter/task/stage/body=evaluate
PATH sprints/10170627-cw-5190fd91/06-judge-r2.md :000000 100644 0000000000000000000000000000000000000000 51c02fb04eab523db35539b6572f2fd7d5a87fc4 bytes 0 2629 hash=ok content=judge-round/decision/issues
EDGE 8fa7a1c035bd76335c99fe71ed7450d5832b49e8 a36edb98dcf000ff653236e7674cac6117e30652 changes 3
PATH .implementation-source-relations.json :100644 100644 eab6aa5c1fbf307fe497d8450d3b9837ecb6977b 4d1cf2084a034d37f44b2893f054eada20711b7b bytes 56507 56825 hash=ok content=manifest-prefix-add=2 preserved=321
PATH sprints/10170627-cw-5190fd91/05-qa-report-r3.md :000000 100644 0000000000000000000000000000000000000000 80d07eb72ebecb771c35ecc1222d36943b5ee8cf bytes 0 31961 hash=ok content=frontmatter/task/stage/body=evaluate
PATH sprints/10170627-cw-5190fd91/06-judge-r3.md :000000 100644 0000000000000000000000000000000000000000 19cf8a90460a19162ad5658eed7a52afbca7b245 bytes 0 2604 hash=ok content=judge-round/decision/issues
EDGE a36edb98dcf000ff653236e7674cac6117e30652 eb96ceb14f76a1572145644d5defc1fec6a49f1b changes 1
PATH sprints/10170627-cw-5190fd91/02-spec.md :100644 100644 51450ee5ebc6651ffd41d88a24e283dafa5ca9ae ac6a959af50bb4cc8c451ec9a63fb8b40249f55a bytes 21682 24118 hash=ok content=frontmatter/task/stage/body=spec pure-append
EDGE eb96ceb14f76a1572145644d5defc1fec6a49f1b 6e0b4202c1b659de1bf99ad62d42c73d09dca6bc changes 2
PATH .implementation-source-relations.json :100644 100644 4d1cf2084a034d37f44b2893f054eada20711b7b c310edb1cf5a2cec343b63b1f6880d644b14bb9e bytes 56825 56986 hash=ok content=manifest-prefix-add=1 preserved=323
PATH sprints/10170627-cw-5190fd91/07-commander-r2.md :000000 100644 0000000000000000000000000000000000000000 8557e2041e46ac98747c39b971362faa73c01476 bytes 0 814 hash=ok content=commander-round/case/decision
EDGE 6e0b4202c1b659de1bf99ad62d42c73d09dca6bc 6f6b6af1ad459f88536235f94a8f585fdead34d5 changes 3
PATH .implementation-source-relations.json :100644 100644 c310edb1cf5a2cec343b63b1f6880d644b14bb9e 7959d010b9929becc96b6ec4f49a09794436f986 bytes 56986 57304 hash=ok content=manifest-prefix-add=2 preserved=324
PATH sprints/10170627-cw-5190fd91/05-qa-report-r4.md :000000 100644 0000000000000000000000000000000000000000 87fb6a1d598e87fe04037c492ba89bd0d9e4b673 bytes 0 30876 hash=ok content=frontmatter/task/stage/body=evaluate
PATH sprints/10170627-cw-5190fd91/06-judge-r4.md :000000 100644 0000000000000000000000000000000000000000 d160e5c15e7d84936779f0130ee8d5ee714589f2 bytes 0 3147 hash=ok content=judge-round/decision/issues
EDGE 6f6b6af1ad459f88536235f94a8f585fdead34d5 acc49fa52b4ed059df42560a54663e6f34ad7ff7 changes 3
PATH .implementation-source-relations.json :100644 100644 7959d010b9929becc96b6ec4f49a09794436f986 12c7a90aa088564674dff14f80493b660bafdecf bytes 57304 57622 hash=ok content=manifest-prefix-add=2 preserved=326
PATH sprints/10170627-cw-5190fd91/05-qa-report-r5.md :000000 100644 0000000000000000000000000000000000000000 688569245080675321cd6e221576d446e4891a09 bytes 0 16278 hash=ok content=frontmatter/task/stage/body=evaluate
PATH sprints/10170627-cw-5190fd91/06-judge-r5.md :000000 100644 0000000000000000000000000000000000000000 2d9eb07b649746b2c46b592c9fb994d89afec79c bytes 0 3122 hash=ok content=judge-round/decision/issues
EDGE acc49fa52b4ed059df42560a54663e6f34ad7ff7 15c90a4a0021a40170e46aeacf6fddc91d563cf0 changes 3
PATH .implementation-source-relations.json :100644 100644 12c7a90aa088564674dff14f80493b660bafdecf c41636011cd352bf88b75b263900869615f54545 bytes 57622 57940 hash=ok content=manifest-prefix-add=2 preserved=328
PATH sprints/10170627-cw-5190fd91/05-qa-report-r6.md :000000 100644 0000000000000000000000000000000000000000 06675ebe45a8fe0bb2df689097c7f7e08df2962b bytes 0 19071 hash=ok content=frontmatter/task/stage/body=evaluate
PATH sprints/10170627-cw-5190fd91/06-judge-r6.md :000000 100644 0000000000000000000000000000000000000000 6d491ef52f7145dd367f863ab358b06e6458cbd9 bytes 0 2777 hash=ok content=judge-round/decision/issues
EDGE 15c90a4a0021a40170e46aeacf6fddc91d563cf0 52e2106ed03b255f18fa834ff33cf1315944e307 changes 3
PATH .implementation-source-relations.json :100644 100644 c41636011cd352bf88b75b263900869615f54545 1e5b7a23fe5fc8ddc638cd35fcd97681ebbd6773 bytes 57940 58258 hash=ok content=manifest-prefix-add=2 preserved=330
PATH sprints/10170627-cw-5190fd91/05-qa-report-r7.md :000000 100644 0000000000000000000000000000000000000000 041d7d6d327c5d54c55f9d18aaa58bb0df1b3f1f bytes 0 11400 hash=ok content=frontmatter/task/stage/body=evaluate
PATH sprints/10170627-cw-5190fd91/06-judge-r7.md :000000 100644 0000000000000000000000000000000000000000 c2060875f9c27303aa8843a0e7f26ec70af900c2 bytes 0 3555 hash=ok content=judge-round/decision/issues
EDGE 52e2106ed03b255f18fa834ff33cf1315944e307 83e9532d4f68a0da797664b7e8c4b9408988d894 changes 3
PATH .implementation-source-relations.json :100644 100644 1e5b7a23fe5fc8ddc638cd35fcd97681ebbd6773 d1f7ac6374e0ecba3e356de7775de5117eadb496 bytes 58258 58576 hash=ok content=manifest-prefix-add=2 preserved=332
PATH sprints/10170627-cw-5190fd91/05-qa-report-r8.md :000000 100644 0000000000000000000000000000000000000000 addc857f7c2b240942075415b9808d598ed6426f bytes 0 29257 hash=ok content=frontmatter/task/stage/body=evaluate
PATH sprints/10170627-cw-5190fd91/06-judge-r8.md :000000 100644 0000000000000000000000000000000000000000 b6d7969319acd43ce65e13921740445f10332304 bytes 0 2716 hash=ok content=judge-round/decision/issues
EDGE 83e9532d4f68a0da797664b7e8c4b9408988d894 f2afa40e9b2fdc44f61fabb9c2cbf148091e0d75 changes 3
PATH .implementation-source-relations.json :100644 100644 d1f7ac6374e0ecba3e356de7775de5117eadb496 98b32b5b70cf5681b32bc46813fdeb2fc2b712cf bytes 58576 58894 hash=ok content=manifest-prefix-add=2 preserved=334
PATH sprints/10170627-cw-5190fd91/05-qa-report-r9.md :000000 100644 0000000000000000000000000000000000000000 21dc9e047e470bcf07084cd121040245c734c64e bytes 0 116015 hash=ok content=frontmatter/task/stage/body=evaluate
PATH sprints/10170627-cw-5190fd91/06-judge-r9.md :000000 100644 0000000000000000000000000000000000000000 decb11a82e9272a24e4ff0f95b250e67d692395d bytes 0 3308 hash=ok content=judge-round/decision/issues
EDGE 53cdf746c0c7f446cb7b6987e170d76248999f1d a2e88ebb066f8ac8a9f7b08c4e8263299b6bdfac changes 10
PATH .brain-versions :100644 100644 f3d261425e53f40ece495da8192f24c6040c909d c06a3400387292f30d4d25034d6600ca57b85af7 bytes 9 9 hash=ok content=upstream-main-content
PATH .dod.md :100644 100644 878f57c2d6857d5d931046a35ffb8cf04d1738d2 6cf33ef5b1680f6a5ea77e5adbc116322c0a72e1 bytes 222428 223219 hash=ok content=upstream-main-content
PATH DEFINITION.md :100644 100644 a4b46caf2f7230368a87796071009b8b35fcc44b 495b74a3f05a45ce6898d96a1a94012afb37752f bytes 770019 770688 hash=ok content=upstream-main-content
PATH package-lock.json :100644 100644 aaeb525fdffb110004342b8c6b4f96893d362179 b2e8b826f0f79f6819581b7d1bf735eacdc30a84 bytes 698744 698744 hash=ok content=upstream-main-content
PATH packages/brain/package-lock.json :100644 100644 ecb84839f8de085394f8aa50dd5f0100b1e99465 b15659ae018fa5424a70121efaeedbfd61281802 bytes 378833 378833 hash=ok content=upstream-main-content
PATH packages/brain/package.json :100644 100644 b6a3c1c890593a7bc828afa573a4ccaff05ab2c0 12c367d938c205def96708d2d7adc6c75e1ff76c bytes 1998 1998 hash=ok content=upstream-main-content
PATH packages/brain/src/__tests__/integration/crm-store.pg.integration.test.js :100644 100644 83f9ec30b3d7659f71def1415cbfbe9812b15e56 22799349a36509c2acfc8e569f0d2e1cb7860729 bytes 14428 17988 hash=ok content=upstream-main-content
PATH packages/brain/src/crm/notion-content.js :100644 100644 8171b10a1d46a896fbc9a0344e83ef6976b3539b f298634d9e92d06aee146eba21e29fc5c484ca33 bytes 1650 5983 hash=ok content=upstream-main-content
PATH packages/brain/src/crm/notion-content.test.js :100644 100644 fddc9530af3ebb9e3b344e0e81911b5dc74b0b32 931421fc1c90bfebb7c0148ade21e47ac8e67a7a bytes 1203 12648 hash=ok content=upstream-main-content
PATH packages/brain/src/crm/notion-sync.js :100644 100644 50bda4d951db1be1e3f82df1d6f90f52b6b2e72e 1353447dd4babc8978c4db8d8969892edfa9bb2e bytes 10263 10272 hash=ok content=upstream-main-content
EDGE a2e88ebb066f8ac8a9f7b08c4e8263299b6bdfac fd845665a3678b4f83ddfae98ba5ca432e459b81 changes 6
PATH .brain-versions :100644 100644 c06a3400387292f30d4d25034d6600ca57b85af7 08dd5367bdac76fe26ef2f2c6e3f4fb5ca336ff0 bytes 9 9 hash=ok content=upstream-main-content
PATH DEFINITION.md :100644 100644 495b74a3f05a45ce6898d96a1a94012afb37752f a55044e301df6bad41e0ffb1a2722f5a714d0bda bytes 770688 770688 hash=ok content=upstream-main-content
PATH package-lock.json :100644 100644 b2e8b826f0f79f6819581b7d1bf735eacdc30a84 4109f2892089feb8371f91443caf753472dfde52 bytes 698744 698744 hash=ok content=upstream-main-content
PATH packages/brain/VERSION :100644 100644 f3d261425e53f40ece495da8192f24c6040c909d 08dd5367bdac76fe26ef2f2c6e3f4fb5ca336ff0 bytes 9 9 hash=ok content=upstream-main-content
PATH packages/brain/package-lock.json :100644 100644 b15659ae018fa5424a70121efaeedbfd61281802 f6aa59c8390db2690cbb07b94d77dc9ac0b8de80 bytes 378833 378833 hash=ok content=upstream-main-content
PATH packages/brain/package.json :100644 100644 12c367d938c205def96708d2d7adc6c75e1ff76c acc959c95931f8dce5ef3f33b94844e7b22ef922 bytes 1998 1998 hash=ok content=upstream-main-content
EDGE fd845665a3678b4f83ddfae98ba5ca432e459b81 61db485cb350b7c6e626e95b83345ec23d94bf22 changes 12
PATH .implementation-source-relations.json :100644 100644 ffadfb9335a468ec6b871f54fd9a6db08ae9e09d 5e9b541f31960b9374f125ebde1e6a04a1c1978b bytes 54140 54429 hash=ok content=upstream-main-content
PATH changes/cp-10171325-cw-7cc9ae9a.md :000000 100644 0000000000000000000000000000000000000000 4a1b4652b6371dc20341cf6282b16ca83e0343fb bytes 0 582 hash=ok content=upstream-main-content
PATH packages/brain/scripts/smoke/leadgen-physical-adb-routing-smoke.sh :000000 100644 0000000000000000000000000000000000000000 b4f48455262b920bf3bf99749a6cc5e4a484b182 bytes 0 11150 hash=ok content=upstream-main-content
PATH packages/brain/src/lib/__tests__/leadgen-dispatch-contract.test.js :100644 100644 4070ba66cb8a877d8fc6b65d047a2b91d5d09b20 5dfbb21e116bba6f41bb884aadc1251352e7a8b6 bytes 3209 4162 hash=ok content=upstream-main-content
PATH packages/brain/src/lib/__tests__/leadgen-dispatch.test.js :100644 100644 da6d328c9b6cb2e405d1835aea98e40eec11856d b826e192490b41b453430b53a96ea816d041bad4 bytes 9495 10532 hash=ok content=upstream-main-content
PATH packages/brain/src/lib/__tests__/leadgen-resources.test.js :100644 100644 dd456907fe5060aa7d29e57ff2994e757e0bff06 917bfaa0b0877a609255a9d4c6550701ec05c049 bytes 12613 12980 hash=ok content=upstream-main-content
PATH packages/brain/src/lib/leadgen-controller.js :100644 100644 35f0189b28438c78eb454978280f96b2ab3744f5 a47b56bffe0699b82187b2b28fcca0ce809426d4 bytes 13624 15729 hash=ok content=upstream-main-content
PATH packages/brain/src/lib/leadgen-controller.test.js :100644 100644 b46ef2dbda88fec3df96f4f44e2ae90867a83bf1 8c2ddc0d671393f327689dc12b24f8fc21c17e34 bytes 13588 16269 hash=ok content=upstream-main-content
PATH packages/brain/src/lib/leadgen-dispatch-contract.js :100644 100644 0811142a63c74dc169d0a846002a7dcf357fe55c 9d3182e19715c8c6f386bd8fb889a7e97bdebfdb bytes 6848 7090 hash=ok content=upstream-main-content
PATH packages/brain/src/lib/leadgen-dispatch.js :100644 100644 f418ccf66474b1a68751b995e6eda4e09f3b08f5 147f4db67ed06a71508d6033b221c5ebf80f425a bytes 10113 10535 hash=ok content=upstream-main-content
PATH packages/brain/src/lib/leadgen-resources.js :100644 100644 c24234923cbba2767c121255a462368c06f16d6c 824f669484ef91dab64362e9462352fef437ab5b bytes 1116 1310 hash=ok content=upstream-main-content
PATH packages/quality/smoke-allowlist.txt :100644 100644 7eae98b7945878111618caeb1b0b174a4a5c04a4 9c6d2a1d1aa0c275ce594f7ba7804dc769cdb0ac bytes 13285 13323 hash=ok content=upstream-main-content
EDGE f2afa40e9b2fdc44f61fabb9c2cbf148091e0d75 db16f7475971decc1b832eec7a9d952bbdf2766f changes 23
PATH .brain-versions :100644 100644 f3d261425e53f40ece495da8192f24c6040c909d 08dd5367bdac76fe26ef2f2c6e3f4fb5ca336ff0 bytes 9 9 hash=ok content=sync-matches-main-content
PATH .dod.md :100644 100644 878f57c2d6857d5d931046a35ffb8cf04d1738d2 6cf33ef5b1680f6a5ea77e5adbc116322c0a72e1 bytes 222428 223219 hash=ok content=sync-matches-main-content
PATH .implementation-source-relations.json :100644 100644 98b32b5b70cf5681b32bc46813fdeb2fc2b712cf 046577ea20378c19bd0bcea687faf8c23005c9e5 bytes 58894 59183 hash=ok content=sync-manifest-defer-source-gate
PATH DEFINITION.md :100644 100644 a4b46caf2f7230368a87796071009b8b35fcc44b a55044e301df6bad41e0ffb1a2722f5a714d0bda bytes 770019 770688 hash=ok content=sync-matches-main-content
PATH changes/cp-10171325-cw-7cc9ae9a.md :000000 100644 0000000000000000000000000000000000000000 4a1b4652b6371dc20341cf6282b16ca83e0343fb bytes 0 582 hash=ok content=sync-matches-main-content
PATH package-lock.json :100644 100644 aaeb525fdffb110004342b8c6b4f96893d362179 4109f2892089feb8371f91443caf753472dfde52 bytes 698744 698744 hash=ok content=sync-matches-main-content
PATH packages/brain/VERSION :100644 100644 f3d261425e53f40ece495da8192f24c6040c909d 08dd5367bdac76fe26ef2f2c6e3f4fb5ca336ff0 bytes 9 9 hash=ok content=sync-matches-main-content
PATH packages/brain/package-lock.json :100644 100644 ecb84839f8de085394f8aa50dd5f0100b1e99465 f6aa59c8390db2690cbb07b94d77dc9ac0b8de80 bytes 378833 378833 hash=ok content=sync-matches-main-content
PATH packages/brain/package.json :100644 100644 b6a3c1c890593a7bc828afa573a4ccaff05ab2c0 acc959c95931f8dce5ef3f33b94844e7b22ef922 bytes 1998 1998 hash=ok content=sync-matches-main-content
PATH packages/brain/scripts/smoke/leadgen-physical-adb-routing-smoke.sh :000000 100644 0000000000000000000000000000000000000000 b4f48455262b920bf3bf99749a6cc5e4a484b182 bytes 0 11150 hash=ok content=sync-matches-main-content
PATH packages/brain/src/__tests__/integration/crm-store.pg.integration.test.js :100644 100644 83f9ec30b3d7659f71def1415cbfbe9812b15e56 22799349a36509c2acfc8e569f0d2e1cb7860729 bytes 14428 17988 hash=ok content=sync-matches-main-content
PATH packages/brain/src/crm/notion-content.js :100644 100644 8171b10a1d46a896fbc9a0344e83ef6976b3539b f298634d9e92d06aee146eba21e29fc5c484ca33 bytes 1650 5983 hash=ok content=sync-matches-main-content
PATH packages/brain/src/crm/notion-content.test.js :100644 100644 fddc9530af3ebb9e3b344e0e81911b5dc74b0b32 931421fc1c90bfebb7c0148ade21e47ac8e67a7a bytes 1203 12648 hash=ok content=sync-matches-main-content
PATH packages/brain/src/crm/notion-sync.js :100644 100644 50bda4d951db1be1e3f82df1d6f90f52b6b2e72e 1353447dd4babc8978c4db8d8969892edfa9bb2e bytes 10263 10272 hash=ok content=sync-matches-main-content
PATH packages/brain/src/lib/__tests__/leadgen-dispatch-contract.test.js :100644 100644 4070ba66cb8a877d8fc6b65d047a2b91d5d09b20 5dfbb21e116bba6f41bb884aadc1251352e7a8b6 bytes 3209 4162 hash=ok content=sync-matches-main-content
PATH packages/brain/src/lib/__tests__/leadgen-dispatch.test.js :100644 100644 da6d328c9b6cb2e405d1835aea98e40eec11856d b826e192490b41b453430b53a96ea816d041bad4 bytes 9495 10532 hash=ok content=sync-matches-main-content
PATH packages/brain/src/lib/__tests__/leadgen-resources.test.js :100644 100644 dd456907fe5060aa7d29e57ff2994e757e0bff06 917bfaa0b0877a609255a9d4c6550701ec05c049 bytes 12613 12980 hash=ok content=sync-matches-main-content
PATH packages/brain/src/lib/leadgen-controller.js :100644 100644 35f0189b28438c78eb454978280f96b2ab3744f5 a47b56bffe0699b82187b2b28fcca0ce809426d4 bytes 13624 15729 hash=ok content=sync-matches-main-content
PATH packages/brain/src/lib/leadgen-controller.test.js :100644 100644 b46ef2dbda88fec3df96f4f44e2ae90867a83bf1 8c2ddc0d671393f327689dc12b24f8fc21c17e34 bytes 13588 16269 hash=ok content=sync-matches-main-content
PATH packages/brain/src/lib/leadgen-dispatch-contract.js :100644 100644 0811142a63c74dc169d0a846002a7dcf357fe55c 9d3182e19715c8c6f386bd8fb889a7e97bdebfdb bytes 6848 7090 hash=ok content=sync-matches-main-content
PATH packages/brain/src/lib/leadgen-dispatch.js :100644 100644 f418ccf66474b1a68751b995e6eda4e09f3b08f5 147f4db67ed06a71508d6033b221c5ebf80f425a bytes 10113 10535 hash=ok content=sync-matches-main-content
PATH packages/brain/src/lib/leadgen-resources.js :100644 100644 c24234923cbba2767c121255a462368c06f16d6c 824f669484ef91dab64362e9462352fef437ab5b bytes 1116 1310 hash=ok content=sync-matches-main-content
PATH packages/quality/smoke-allowlist.txt :100644 100644 7eae98b7945878111618caeb1b0b174a4a5c04a4 9c6d2a1d1aa0c275ce594f7ba7804dc769cdb0ac bytes 13285 13323 hash=ok content=sync-matches-main-content
EDGE 61db485cb350b7c6e626e95b83345ec23d94bf22 db16f7475971decc1b832eec7a9d952bbdf2766f changes 32
PATH .implementation-source-relations.json :100644 100644 5e9b541f31960b9374f125ebde1e6a04a1c1978b 046577ea20378c19bd0bcea687faf8c23005c9e5 bytes 54429 59183 hash=ok content=sync-manifest-defer-source-gate
PATH packages/brain/scripts/coding-workflow/runner/README.md :100644 100644 6e6eb65f64c55bdad786b619e2e9a4ef66225297 3e8eea166d021b985bff0c71e1ccbc87d234d248 bytes 10889 13572 hash=ok content=sync-preserves-task-content
PATH sprints/10170627-cw-5190fd91/01-intent.md :000000 100644 0000000000000000000000000000000000000000 3a1529d7a143b6fdcf1305b9d72480c22c4d3a8c bytes 0 15486 hash=ok content=sync-preserves-task-content
PATH sprints/10170627-cw-5190fd91/01-invariants.md :000000 100644 0000000000000000000000000000000000000000 2276b9f0bca1d5fd3e422ef6e962e1259e266703 bytes 0 89736 hash=ok content=sync-preserves-task-content
PATH sprints/10170627-cw-5190fd91/02-response-r1.md :000000 100644 0000000000000000000000000000000000000000 f89998664a7a99d3f8bfc0b8b4f0ac0955c8b83a bytes 0 589 hash=ok content=sync-preserves-task-content
PATH sprints/10170627-cw-5190fd91/02-response-r2.md :000000 100644 0000000000000000000000000000000000000000 677402ca401d014befa03669d7b1a1aa04a917b2 bytes 0 1084 hash=ok content=sync-preserves-task-content
PATH sprints/10170627-cw-5190fd91/02-review-r1.md :000000 100644 0000000000000000000000000000000000000000 8b068bd99a4c2f5abc189032698f21ad8e267be6 bytes 0 1223 hash=ok content=sync-preserves-task-content
PATH sprints/10170627-cw-5190fd91/02-review-r2.md :000000 100644 0000000000000000000000000000000000000000 7c80b836bc8c5469525c21273be83ad0e8dde8fc bytes 0 1436 hash=ok content=sync-preserves-task-content
PATH sprints/10170627-cw-5190fd91/02-review-r3.md :000000 100644 0000000000000000000000000000000000000000 e6922e12ac037d6b2ac8839985f3434b9d4f48e5 bytes 0 1113 hash=ok content=sync-preserves-task-content
PATH sprints/10170627-cw-5190fd91/02-review.md :000000 100644 0000000000000000000000000000000000000000 e6922e12ac037d6b2ac8839985f3434b9d4f48e5 bytes 0 1113 hash=ok content=sync-preserves-task-content
PATH sprints/10170627-cw-5190fd91/02-spec.md :000000 100644 0000000000000000000000000000000000000000 ac6a959af50bb4cc8c451ec9a63fb8b40249f55a bytes 0 24118 hash=ok content=sync-preserves-task-content
PATH sprints/10170627-cw-5190fd91/03-build.md :000000 100644 0000000000000000000000000000000000000000 0d96f563734111cfdcd2049a91b8d0973da5adff bytes 0 5095 hash=ok content=sync-preserves-task-content
PATH sprints/10170627-cw-5190fd91/04-evidence.md :000000 100644 0000000000000000000000000000000000000000 46a81734ed6702902319dcbe09f211bf692b0f88 bytes 0 9894 hash=ok content=sync-preserves-task-content
PATH sprints/10170627-cw-5190fd91/05-qa-report-r1.md :000000 100644 0000000000000000000000000000000000000000 766cc68f7f0cb7bd81da2711b7eb920992f04c05 bytes 0 19119 hash=ok content=sync-preserves-task-content
PATH sprints/10170627-cw-5190fd91/05-qa-report-r2.md :000000 100644 0000000000000000000000000000000000000000 05e0b0b9c9bb8608cbceed644e7c8b9e8243aeee bytes 0 49562 hash=ok content=sync-preserves-task-content
PATH sprints/10170627-cw-5190fd91/05-qa-report-r3.md :000000 100644 0000000000000000000000000000000000000000 80d07eb72ebecb771c35ecc1222d36943b5ee8cf bytes 0 31961 hash=ok content=sync-preserves-task-content
PATH sprints/10170627-cw-5190fd91/05-qa-report-r4.md :000000 100644 0000000000000000000000000000000000000000 87fb6a1d598e87fe04037c492ba89bd0d9e4b673 bytes 0 30876 hash=ok content=sync-preserves-task-content
PATH sprints/10170627-cw-5190fd91/05-qa-report-r5.md :000000 100644 0000000000000000000000000000000000000000 688569245080675321cd6e221576d446e4891a09 bytes 0 16278 hash=ok content=sync-preserves-task-content
PATH sprints/10170627-cw-5190fd91/05-qa-report-r6.md :000000 100644 0000000000000000000000000000000000000000 06675ebe45a8fe0bb2df689097c7f7e08df2962b bytes 0 19071 hash=ok content=sync-preserves-task-content
PATH sprints/10170627-cw-5190fd91/05-qa-report-r7.md :000000 100644 0000000000000000000000000000000000000000 041d7d6d327c5d54c55f9d18aaa58bb0df1b3f1f bytes 0 11400 hash=ok content=sync-preserves-task-content
PATH sprints/10170627-cw-5190fd91/05-qa-report-r8.md :000000 100644 0000000000000000000000000000000000000000 addc857f7c2b240942075415b9808d598ed6426f bytes 0 29257 hash=ok content=sync-preserves-task-content
PATH sprints/10170627-cw-5190fd91/05-qa-report-r9.md :000000 100644 0000000000000000000000000000000000000000 21dc9e047e470bcf07084cd121040245c734c64e bytes 0 116015 hash=ok content=sync-preserves-task-content
PATH sprints/10170627-cw-5190fd91/06-judge-r2.md :000000 100644 0000000000000000000000000000000000000000 51c02fb04eab523db35539b6572f2fd7d5a87fc4 bytes 0 2629 hash=ok content=sync-preserves-task-content
PATH sprints/10170627-cw-5190fd91/06-judge-r3.md :000000 100644 0000000000000000000000000000000000000000 19cf8a90460a19162ad5658eed7a52afbca7b245 bytes 0 2604 hash=ok content=sync-preserves-task-content
PATH sprints/10170627-cw-5190fd91/06-judge-r4.md :000000 100644 0000000000000000000000000000000000000000 d160e5c15e7d84936779f0130ee8d5ee714589f2 bytes 0 3147 hash=ok content=sync-preserves-task-content
PATH sprints/10170627-cw-5190fd91/06-judge-r5.md :000000 100644 0000000000000000000000000000000000000000 2d9eb07b649746b2c46b592c9fb994d89afec79c bytes 0 3122 hash=ok content=sync-preserves-task-content
PATH sprints/10170627-cw-5190fd91/06-judge-r6.md :000000 100644 0000000000000000000000000000000000000000 6d491ef52f7145dd367f863ab358b06e6458cbd9 bytes 0 2777 hash=ok content=sync-preserves-task-content
PATH sprints/10170627-cw-5190fd91/06-judge-r7.md :000000 100644 0000000000000000000000000000000000000000 c2060875f9c27303aa8843a0e7f26ec70af900c2 bytes 0 3555 hash=ok content=sync-preserves-task-content
PATH sprints/10170627-cw-5190fd91/06-judge-r8.md :000000 100644 0000000000000000000000000000000000000000 b6d7969319acd43ce65e13921740445f10332304 bytes 0 2716 hash=ok content=sync-preserves-task-content
PATH sprints/10170627-cw-5190fd91/06-judge-r9.md :000000 100644 0000000000000000000000000000000000000000 decb11a82e9272a24e4ff0f95b250e67d692395d bytes 0 3308 hash=ok content=sync-preserves-task-content
PATH sprints/10170627-cw-5190fd91/07-commander-r1.md :000000 100644 0000000000000000000000000000000000000000 fc178a6a802a0410e83cdf2c9c03233f8206bb1c bytes 0 876 hash=ok content=sync-preserves-task-content
PATH sprints/10170627-cw-5190fd91/07-commander-r2.md :000000 100644 0000000000000000000000000000000000000000 8557e2041e46ac98747c39b971362faa73c01476 bytes 0 814 hash=ok content=sync-preserves-task-content
EDGE 61db485cb350b7c6e626e95b83345ec23d94bf22 dacf5bf376fa619ebce6efdf76b1ea090edabe75 changes 8
PATH .brain-versions :100644 100644 08dd5367bdac76fe26ef2f2c6e3f4fb5ca336ff0 e73b122b8bb5c873a863edcb98250892acc433fc bytes 9 9 hash=ok content=upstream-main-content
PATH .implementation-source-relations.json :100644 100644 5e9b541f31960b9374f125ebde1e6a04a1c1978b 0a7b64e2ad039a5ab701a9827ba11a6a0fe6cb9d bytes 54429 54308 hash=ok content=upstream-main-content
PATH DEFINITION.md :100644 100644 a55044e301df6bad41e0ffb1a2722f5a714d0bda d0eb2ba667519af9c17ec14648025e9ad415ee69 bytes 770688 771270 hash=ok content=upstream-main-content
PATH changes/cp-10171325-cw-7cc9ae9a.md :100644 000000 4a1b4652b6371dc20341cf6282b16ca83e0343fb 0000000000000000000000000000000000000000 bytes 582 0 hash=ok content=upstream-main-content
PATH package-lock.json :100644 100644 4109f2892089feb8371f91443caf753472dfde52 a517d185802b86a5ffed1ab5e566e03fe22eebec bytes 698744 698744 hash=ok content=upstream-main-content
PATH packages/brain/VERSION :100644 100644 08dd5367bdac76fe26ef2f2c6e3f4fb5ca336ff0 e73b122b8bb5c873a863edcb98250892acc433fc bytes 9 9 hash=ok content=upstream-main-content
PATH packages/brain/package-lock.json :100644 100644 f6aa59c8390db2690cbb07b94d77dc9ac0b8de80 5eabad142cc2cb6ee7e2410d3454d6c649f22248 bytes 378833 378833 hash=ok content=upstream-main-content
PATH packages/brain/package.json :100644 100644 acc959c95931f8dce5ef3f33b94844e7b22ef922 98970083c277b1ac5d07100abaf9fdaf14f5d726 bytes 1998 1998 hash=ok content=upstream-main-content
EDGE dacf5bf376fa619ebce6efdf76b1ea090edabe75 2732b510b621af4d35336e829617b3921e125128 changes 4
PATH .implementation-source-relations.json :100644 100644 0a7b64e2ad039a5ab701a9827ba11a6a0fe6cb9d 4902e3f04ccdc5ae8567f855c9560f07fe1a2536 bytes 54308 54439 hash=ok content=upstream-main-content
PATH changes/cp-10171423-cloud-history.md :000000 100644 0000000000000000000000000000000000000000 a38c630b586a10b21a83d2acceb388b6cd431c47 bytes 0 388 hash=ok content=upstream-main-content
PATH packages/brain/src/lib/__tests__/leadgen-batch-proof.test.js :100644 100644 1c23c5febf009b1ea45d969c390ff2832a2855ae ec1f7aa593a0fee9e4b3c027e124e1f1c14eded7 bytes 2979 5435 hash=ok content=upstream-main-content
PATH packages/brain/src/lib/leadgen-batch-proof.js :100644 100644 ba1f517497b53b8c6ada68f037ec333241908218 0448adb8ca60503355f910defbb2f4c33b2404cb bytes 4827 4846 hash=ok content=upstream-main-content
EDGE db16f7475971decc1b832eec7a9d952bbdf2766f 73b660f6cc3e206926fbc64e572868f23d361ac4 changes 11
PATH .brain-versions :100644 100644 08dd5367bdac76fe26ef2f2c6e3f4fb5ca336ff0 e73b122b8bb5c873a863edcb98250892acc433fc bytes 9 9 hash=ok content=sync-matches-main-content
PATH .implementation-source-relations.json :100644 100644 046577ea20378c19bd0bcea687faf8c23005c9e5 8e01337055cc4035d0b60889d73f63462defd271 bytes 59183 59193 hash=ok content=sync-manifest-defer-source-gate
PATH DEFINITION.md :100644 100644 a55044e301df6bad41e0ffb1a2722f5a714d0bda d0eb2ba667519af9c17ec14648025e9ad415ee69 bytes 770688 771270 hash=ok content=sync-matches-main-content
PATH changes/cp-10171325-cw-7cc9ae9a.md :100644 000000 4a1b4652b6371dc20341cf6282b16ca83e0343fb 0000000000000000000000000000000000000000 bytes 582 0 hash=ok content=sync-matches-main-content
PATH changes/cp-10171423-cloud-history.md :000000 100644 0000000000000000000000000000000000000000 a38c630b586a10b21a83d2acceb388b6cd431c47 bytes 0 388 hash=ok content=sync-matches-main-content
PATH package-lock.json :100644 100644 4109f2892089feb8371f91443caf753472dfde52 a517d185802b86a5ffed1ab5e566e03fe22eebec bytes 698744 698744 hash=ok content=sync-matches-main-content
PATH packages/brain/VERSION :100644 100644 08dd5367bdac76fe26ef2f2c6e3f4fb5ca336ff0 e73b122b8bb5c873a863edcb98250892acc433fc bytes 9 9 hash=ok content=sync-matches-main-content
PATH packages/brain/package-lock.json :100644 100644 f6aa59c8390db2690cbb07b94d77dc9ac0b8de80 5eabad142cc2cb6ee7e2410d3454d6c649f22248 bytes 378833 378833 hash=ok content=sync-matches-main-content
PATH packages/brain/package.json :100644 100644 acc959c95931f8dce5ef3f33b94844e7b22ef922 98970083c277b1ac5d07100abaf9fdaf14f5d726 bytes 1998 1998 hash=ok content=sync-matches-main-content
PATH packages/brain/src/lib/__tests__/leadgen-batch-proof.test.js :100644 100644 1c23c5febf009b1ea45d969c390ff2832a2855ae ec1f7aa593a0fee9e4b3c027e124e1f1c14eded7 bytes 2979 5435 hash=ok content=sync-matches-main-content
PATH packages/brain/src/lib/leadgen-batch-proof.js :100644 100644 ba1f517497b53b8c6ada68f037ec333241908218 0448adb8ca60503355f910defbb2f4c33b2404cb bytes 4827 4846 hash=ok content=sync-matches-main-content
EDGE 2732b510b621af4d35336e829617b3921e125128 73b660f6cc3e206926fbc64e572868f23d361ac4 changes 32
PATH .implementation-source-relations.json :100644 100644 4902e3f04ccdc5ae8567f855c9560f07fe1a2536 8e01337055cc4035d0b60889d73f63462defd271 bytes 54439 59193 hash=ok content=sync-manifest-defer-source-gate
PATH packages/brain/scripts/coding-workflow/runner/README.md :100644 100644 6e6eb65f64c55bdad786b619e2e9a4ef66225297 3e8eea166d021b985bff0c71e1ccbc87d234d248 bytes 10889 13572 hash=ok content=sync-preserves-task-content
PATH sprints/10170627-cw-5190fd91/01-intent.md :000000 100644 0000000000000000000000000000000000000000 3a1529d7a143b6fdcf1305b9d72480c22c4d3a8c bytes 0 15486 hash=ok content=sync-preserves-task-content
PATH sprints/10170627-cw-5190fd91/01-invariants.md :000000 100644 0000000000000000000000000000000000000000 2276b9f0bca1d5fd3e422ef6e962e1259e266703 bytes 0 89736 hash=ok content=sync-preserves-task-content
PATH sprints/10170627-cw-5190fd91/02-response-r1.md :000000 100644 0000000000000000000000000000000000000000 f89998664a7a99d3f8bfc0b8b4f0ac0955c8b83a bytes 0 589 hash=ok content=sync-preserves-task-content
PATH sprints/10170627-cw-5190fd91/02-response-r2.md :000000 100644 0000000000000000000000000000000000000000 677402ca401d014befa03669d7b1a1aa04a917b2 bytes 0 1084 hash=ok content=sync-preserves-task-content
PATH sprints/10170627-cw-5190fd91/02-review-r1.md :000000 100644 0000000000000000000000000000000000000000 8b068bd99a4c2f5abc189032698f21ad8e267be6 bytes 0 1223 hash=ok content=sync-preserves-task-content
PATH sprints/10170627-cw-5190fd91/02-review-r2.md :000000 100644 0000000000000000000000000000000000000000 7c80b836bc8c5469525c21273be83ad0e8dde8fc bytes 0 1436 hash=ok content=sync-preserves-task-content
PATH sprints/10170627-cw-5190fd91/02-review-r3.md :000000 100644 0000000000000000000000000000000000000000 e6922e12ac037d6b2ac8839985f3434b9d4f48e5 bytes 0 1113 hash=ok content=sync-preserves-task-content
PATH sprints/10170627-cw-5190fd91/02-review.md :000000 100644 0000000000000000000000000000000000000000 e6922e12ac037d6b2ac8839985f3434b9d4f48e5 bytes 0 1113 hash=ok content=sync-preserves-task-content
PATH sprints/10170627-cw-5190fd91/02-spec.md :000000 100644 0000000000000000000000000000000000000000 ac6a959af50bb4cc8c451ec9a63fb8b40249f55a bytes 0 24118 hash=ok content=sync-preserves-task-content
PATH sprints/10170627-cw-5190fd91/03-build.md :000000 100644 0000000000000000000000000000000000000000 0d96f563734111cfdcd2049a91b8d0973da5adff bytes 0 5095 hash=ok content=sync-preserves-task-content
PATH sprints/10170627-cw-5190fd91/04-evidence.md :000000 100644 0000000000000000000000000000000000000000 46a81734ed6702902319dcbe09f211bf692b0f88 bytes 0 9894 hash=ok content=sync-preserves-task-content
PATH sprints/10170627-cw-5190fd91/05-qa-report-r1.md :000000 100644 0000000000000000000000000000000000000000 766cc68f7f0cb7bd81da2711b7eb920992f04c05 bytes 0 19119 hash=ok content=sync-preserves-task-content
PATH sprints/10170627-cw-5190fd91/05-qa-report-r2.md :000000 100644 0000000000000000000000000000000000000000 05e0b0b9c9bb8608cbceed644e7c8b9e8243aeee bytes 0 49562 hash=ok content=sync-preserves-task-content
PATH sprints/10170627-cw-5190fd91/05-qa-report-r3.md :000000 100644 0000000000000000000000000000000000000000 80d07eb72ebecb771c35ecc1222d36943b5ee8cf bytes 0 31961 hash=ok content=sync-preserves-task-content
PATH sprints/10170627-cw-5190fd91/05-qa-report-r4.md :000000 100644 0000000000000000000000000000000000000000 87fb6a1d598e87fe04037c492ba89bd0d9e4b673 bytes 0 30876 hash=ok content=sync-preserves-task-content
PATH sprints/10170627-cw-5190fd91/05-qa-report-r5.md :000000 100644 0000000000000000000000000000000000000000 688569245080675321cd6e221576d446e4891a09 bytes 0 16278 hash=ok content=sync-preserves-task-content
PATH sprints/10170627-cw-5190fd91/05-qa-report-r6.md :000000 100644 0000000000000000000000000000000000000000 06675ebe45a8fe0bb2df689097c7f7e08df2962b bytes 0 19071 hash=ok content=sync-preserves-task-content
PATH sprints/10170627-cw-5190fd91/05-qa-report-r7.md :000000 100644 0000000000000000000000000000000000000000 041d7d6d327c5d54c55f9d18aaa58bb0df1b3f1f bytes 0 11400 hash=ok content=sync-preserves-task-content
PATH sprints/10170627-cw-5190fd91/05-qa-report-r8.md :000000 100644 0000000000000000000000000000000000000000 addc857f7c2b240942075415b9808d598ed6426f bytes 0 29257 hash=ok content=sync-preserves-task-content
PATH sprints/10170627-cw-5190fd91/05-qa-report-r9.md :000000 100644 0000000000000000000000000000000000000000 21dc9e047e470bcf07084cd121040245c734c64e bytes 0 116015 hash=ok content=sync-preserves-task-content
PATH sprints/10170627-cw-5190fd91/06-judge-r2.md :000000 100644 0000000000000000000000000000000000000000 51c02fb04eab523db35539b6572f2fd7d5a87fc4 bytes 0 2629 hash=ok content=sync-preserves-task-content
PATH sprints/10170627-cw-5190fd91/06-judge-r3.md :000000 100644 0000000000000000000000000000000000000000 19cf8a90460a19162ad5658eed7a52afbca7b245 bytes 0 2604 hash=ok content=sync-preserves-task-content
PATH sprints/10170627-cw-5190fd91/06-judge-r4.md :000000 100644 0000000000000000000000000000000000000000 d160e5c15e7d84936779f0130ee8d5ee714589f2 bytes 0 3147 hash=ok content=sync-preserves-task-content
PATH sprints/10170627-cw-5190fd91/06-judge-r5.md :000000 100644 0000000000000000000000000000000000000000 2d9eb07b649746b2c46b592c9fb994d89afec79c bytes 0 3122 hash=ok content=sync-preserves-task-content
PATH sprints/10170627-cw-5190fd91/06-judge-r6.md :000000 100644 0000000000000000000000000000000000000000 6d491ef52f7145dd367f863ab358b06e6458cbd9 bytes 0 2777 hash=ok content=sync-preserves-task-content
PATH sprints/10170627-cw-5190fd91/06-judge-r7.md :000000 100644 0000000000000000000000000000000000000000 c2060875f9c27303aa8843a0e7f26ec70af900c2 bytes 0 3555 hash=ok content=sync-preserves-task-content
PATH sprints/10170627-cw-5190fd91/06-judge-r8.md :000000 100644 0000000000000000000000000000000000000000 b6d7969319acd43ce65e13921740445f10332304 bytes 0 2716 hash=ok content=sync-preserves-task-content
PATH sprints/10170627-cw-5190fd91/06-judge-r9.md :000000 100644 0000000000000000000000000000000000000000 decb11a82e9272a24e4ff0f95b250e67d692395d bytes 0 3308 hash=ok content=sync-preserves-task-content
PATH sprints/10170627-cw-5190fd91/07-commander-r1.md :000000 100644 0000000000000000000000000000000000000000 fc178a6a802a0410e83cdf2c9c03233f8206bb1c bytes 0 876 hash=ok content=sync-preserves-task-content
PATH sprints/10170627-cw-5190fd91/07-commander-r2.md :000000 100644 0000000000000000000000000000000000000000 8557e2041e46ac98747c39b971362faa73c01476 bytes 0 814 hash=ok content=sync-preserves-task-content
EDGE 73b660f6cc3e206926fbc64e572868f23d361ac4 a77e886a5faa28e910bc46ac306c21ade5977847 changes 2
PATH .implementation-source-relations.json :100644 100644 8e01337055cc4035d0b60889d73f63462defd271 8b5a55077b9e5082453958e913e2f4fc59cb7e3b bytes 59193 59354 hash=ok content=manifest-prefix-add=1 preserved=338
Traceback (most recent call last):
  File "<stdin>", line 96, in <module>
  File "<stdin>", line 26, in report_rule
AssertionError: commander content sprints/10170627-cw-5190fd91/07-commander-r3.md
```
退出码: 1

### q4audit10
```command
python3 - <<'PY'
import subprocess,hashlib,json,re,sys
B='04b88ddba4b1aa23a156d59734b4d88f621fe1e9'
S='sprints/10170627-cw-5190fd91/'
H='e155382a75885815d9cd838670df39cbb3ed9447'
R='packages/brain/scripts/coding-workflow/runner/README.md'
M='.implementation-source-relations.json'
sync={'f9460639ab0b5e2cd7b05f4f109db13a51b64f01','db16f7475971decc1b832eec7a9d952bbdf2766f','73b660f6cc3e206926fbc64e572868f23d361ac4','e155382a75885815d9cd838670df39cbb3ed9447'}
def git(*a):
 p=subprocess.run(['git',*a],stdout=subprocess.PIPE,stderr=subprocess.PIPE)
 if p.returncode: raise RuntimeError('git '+str(a)+' '+p.stderr.decode(errors='replace'))
 return p.stdout
def blob(oid):
 b=git('cat-file','blob',oid)
 v=hashlib.sha1(b'blob '+str(len(b)).encode()+b'\0'+b).hexdigest()
 if v!=oid or int(git('cat-file','-s',oid))!=len(b): raise AssertionError('blob mismatch '+oid)
 return b
def at(commit,path):
 try:return git('show',commit+':'+path)
 except RuntimeError:return None
def report_rule(path,data):
 s=data.decode('utf8')
 if '/06-judge-r' in path:
  if '裁决' not in s or '问题' not in s:raise AssertionError('judge content '+path)
  return 'judge-round/decision/issues'
 if '/07-commander-r' in path:
  if '裁决' not in s or len(s)<100:raise AssertionError('commander content '+path)
  return 'commander-round/case/decision'
 if '/02-response-r' in path:
  if not re.search(r'### R-\d+\n处理: (采纳|拒绝|部分采纳)',s):raise AssertionError('response decision '+path)
  if '说明:' not in s:raise AssertionError('response explanation '+path)
  return 'response-round/decision/explanation'
 if path.endswith('01-invariants.md'):
  if not s.startswith('# 铁律清单') or len(re.findall(r'^### INV-',s,re.M))<10:raise AssertionError('invariants content '+path)
  return 'invariants-headings-and-rules'
 if not s.startswith('---\n') or 'task_id: 5190fd91-d6c9-4247-850b-5700051a4830' not in s.split('---',2)[1]:raise AssertionError('report frontmatter '+path)
 name=path.split('/')[-1]
 expected='intent' if name.startswith('01-') else 'spec' if name=='02-spec.md' else 'spec_review' if name.startswith(('02-review','02-response')) else 'evaluate' if name.startswith('05-') else 'judge' if name.startswith('06-') else 'commander' if name.startswith('07-') else None
 if expected and ('step: '+expected) not in s.split('---',2)[1]: raise AssertionError('report stage '+path)
 if name.startswith('05-') and not re.search(r'### T-\d+',s):raise AssertionError('QA cases '+path)
 if name.startswith('06-') and not ('裁决' in s or 'verdict' in s):raise AssertionError('judge decision '+path)
 if name.startswith('07-') and not ('裁决' in s or 'Commander' in s):raise AssertionError('commander decision '+path)
 return 'frontmatter/task/stage/body='+expected
lines=git('rev-list','--reverse','--topo-order','--parents',B+'..'+H).decode().splitlines()
commits=[x.split() for x in lines]
upstream=set()
for parts in commits:
 if len(parts)==3:
  second=parts[2]
  upstream.update(git('rev-list',B+'..'+second).decode().splitlines())
for parts in commits:
 c=parts[0]
 for p in parts[1:]:
  raw=git('diff','--no-ext-diff','--no-renames','--raw','--full-index','--abbrev=40',p,c,'--').decode().splitlines()
  print('EDGE',p,c,'changes',len(raw))
  for line in raw:
   meta,path=line.split('\t',1)
   fields=meta.split()
   oldmode,newmode,oldid,newid=fields[:4]
   for oid in (oldid,newid):
    if set(oid)!={'0'}:blob(oid)
   old=at(p,path) if set(oldid)!={'0'} else None
   new=at(c,path) if set(newid)!={'0'} else None
   if old is not None and hashlib.sha1(b'blob '+str(len(old)).encode()+b'\0'+old).hexdigest()!=oldid:raise AssertionError('old tree '+path)
   if new is not None and hashlib.sha1(b'blob '+str(len(new)).encode()+b'\0'+new).hexdigest()!=newid:raise AssertionError('new tree '+path)
   if c in upstream:
    if path.startswith(S) or path==R:raise AssertionError('upstream touched task path '+path)
    rule='upstream-main-content'
   elif c in sync:
    other=parts[2] if p==parts[1] else parts[1]
    expected=at(other,path)
    if path==M:rule='sync-manifest-defer-source-gate'
    elif path.startswith(S) or path==R:
     if new!=at(parts[1],path):raise AssertionError('sync task content changed '+path)
     rule='sync-preserves-task-content'
    else:
     if new!=at(parts[2],path):raise AssertionError('sync upstream content mismatch '+path)
     rule='sync-matches-main-content'
   elif path==R:
    if old is None or new is None or not all(any(x==y for y in it) for it in [iter(new)] for x in old):raise AssertionError('README preservation '+c)
    rule='README-old-byte-subsequence'
   elif path==M:
    a=json.loads(old); b=json.loads(new)
    keep=a['relations']; now=b['relations']
    if now[-len(keep):]!=keep or {k:v for k,v in a.items() if k!='relations'}!={k:v for k,v in b.items() if k!='relations'}:raise AssertionError('manifest history '+c)
    added=now[:-len(keep)]
    if not added:raise AssertionError('manifest no added lines '+c)
    for x in added:
     q=x['path']
     if x!={'owner_path':'packages/brain/scripts/coding-workflow/runner/run-once.mjs','path':q,'role':'documentation'} or not q.startswith(S) or not q.endswith('.md') or at(c,q) is None:raise AssertionError('manifest relation '+q)
    rule='manifest-prefix-add='+str(len(added))+' preserved='+str(len(keep))
   elif path.startswith(S):
    if path.endswith(('03-build.md','04-evidence.md')):
     rule='hidden-object-only'
    elif new is None:raise AssertionError('task report deleted '+path)
    else:
     rule=report_rule(path,new)
     if path.endswith('02-spec.md') and old is not None:
      if not new.startswith(old):raise AssertionError('spec not pure append '+c)
      tail=new[len(old):].decode()
      if c=='200baf82ef92f25d8b10031b52596b1e24fb70a7' and not tail.lstrip().startswith('## commander 裁决（第 1 次）'):raise AssertionError('first spec append')
      if c=='eb96ceb14f76a1572145644d5defc1fec6a49f1b' and not tail.lstrip().startswith('## commander 裁决（第 2 次）'):raise AssertionError('second spec append')
      rule+=' pure-append'
   else:raise AssertionError('unowned task change '+c+' '+path)
   print('PATH',path,oldmode,newmode,oldid,newid,'bytes',len(old) if old is not None else 0,len(new) if new is not None else 0,'hash=ok','content='+rule)
print('AUDIT_OK edges',sum(len(x)-1 for x in commits))
PY
```
```output
EDGE 04b88ddba4b1aa23a156d59734b4d88f621fe1e9 178f61849d85be5a9370f23c033e48ae006cfe25 changes 1
PATH packages/brain/scripts/coding-workflow/runner/README.md :100644 100644 6e6eb65f64c55bdad786b619e2e9a4ef66225297 3e8eea166d021b985bff0c71e1ccbc87d234d248 bytes 10889 13572 hash=ok content=README-old-byte-subsequence
EDGE 178f61849d85be5a9370f23c033e48ae006cfe25 42943dfe5fc3f0680291322a5440bcd46159cbeb changes 12
PATH .implementation-source-relations.json :100644 100644 b4d00c4f7ea1c087ce0511769e1e25299326cbfd 24de93e0438b1c2a800654e7e0407b2949ef5233 bytes 54286 56013 hash=ok content=manifest-prefix-add=11 preserved=307
PATH sprints/10170627-cw-5190fd91/01-intent.md :000000 100644 0000000000000000000000000000000000000000 3a1529d7a143b6fdcf1305b9d72480c22c4d3a8c bytes 0 15486 hash=ok content=frontmatter/task/stage/body=intent
PATH sprints/10170627-cw-5190fd91/01-invariants.md :000000 100644 0000000000000000000000000000000000000000 2276b9f0bca1d5fd3e422ef6e962e1259e266703 bytes 0 89736 hash=ok content=invariants-headings-and-rules
PATH sprints/10170627-cw-5190fd91/02-response-r1.md :000000 100644 0000000000000000000000000000000000000000 f89998664a7a99d3f8bfc0b8b4f0ac0955c8b83a bytes 0 589 hash=ok content=response-round/decision/explanation
PATH sprints/10170627-cw-5190fd91/02-response-r2.md :000000 100644 0000000000000000000000000000000000000000 677402ca401d014befa03669d7b1a1aa04a917b2 bytes 0 1084 hash=ok content=response-round/decision/explanation
PATH sprints/10170627-cw-5190fd91/02-review-r1.md :000000 100644 0000000000000000000000000000000000000000 8b068bd99a4c2f5abc189032698f21ad8e267be6 bytes 0 1223 hash=ok content=frontmatter/task/stage/body=spec_review
PATH sprints/10170627-cw-5190fd91/02-review-r2.md :000000 100644 0000000000000000000000000000000000000000 7c80b836bc8c5469525c21273be83ad0e8dde8fc bytes 0 1436 hash=ok content=frontmatter/task/stage/body=spec_review
PATH sprints/10170627-cw-5190fd91/02-review-r3.md :000000 100644 0000000000000000000000000000000000000000 e6922e12ac037d6b2ac8839985f3434b9d4f48e5 bytes 0 1113 hash=ok content=frontmatter/task/stage/body=spec_review
PATH sprints/10170627-cw-5190fd91/02-review.md :000000 100644 0000000000000000000000000000000000000000 e6922e12ac037d6b2ac8839985f3434b9d4f48e5 bytes 0 1113 hash=ok content=frontmatter/task/stage/body=spec_review
PATH sprints/10170627-cw-5190fd91/02-spec.md :000000 100644 0000000000000000000000000000000000000000 9827a68e93e8e7d2b0c21dcb517cb6c6848e2093 bytes 0 18898 hash=ok content=frontmatter/task/stage/body=spec
PATH sprints/10170627-cw-5190fd91/03-build.md :000000 100644 0000000000000000000000000000000000000000 0d96f563734111cfdcd2049a91b8d0973da5adff bytes 0 5095 hash=ok content=hidden-object-only
PATH sprints/10170627-cw-5190fd91/04-evidence.md :000000 100644 0000000000000000000000000000000000000000 46a81734ed6702902319dcbe09f211bf692b0f88 bytes 0 9894 hash=ok content=hidden-object-only
EDGE 04b88ddba4b1aa23a156d59734b4d88f621fe1e9 53cdf746c0c7f446cb7b6987e170d76248999f1d changes 8
PATH .brain-versions :100644 100644 765a3cb613f52cc52b92c04158a540cbe7fba43d f3d261425e53f40ece495da8192f24c6040c909d bytes 9 9 hash=ok content=upstream-main-content
PATH .implementation-source-relations.json :100644 100644 b4d00c4f7ea1c087ce0511769e1e25299326cbfd ffadfb9335a468ec6b871f54fd9a6db08ae9e09d bytes 54286 54140 hash=ok content=upstream-main-content
PATH DEFINITION.md :100644 100644 c61152020942f82f1de6315cb58dda302a1e92cc a4b46caf2f7230368a87796071009b8b35fcc44b bytes 769540 770019 hash=ok content=upstream-main-content
PATH changes/cp-10170325-ci-budget-headroom.md :100644 000000 61678453253490efe1e7e647f808ac43965eaac1 0000000000000000000000000000000000000000 bytes 479 0 hash=ok content=upstream-main-content
PATH package-lock.json :100644 100644 f6a79a39a78356e1a59b763567ac45af92e79f5b aaeb525fdffb110004342b8c6b4f96893d362179 bytes 698744 698744 hash=ok content=upstream-main-content
PATH packages/brain/VERSION :100644 100644 765a3cb613f52cc52b92c04158a540cbe7fba43d f3d261425e53f40ece495da8192f24c6040c909d bytes 9 9 hash=ok content=upstream-main-content
PATH packages/brain/package-lock.json :100644 100644 bd0894471f6609afd0506fb31cabb315e8a97b25 ecb84839f8de085394f8aa50dd5f0100b1e99465 bytes 378833 378833 hash=ok content=upstream-main-content
PATH packages/brain/package.json :100644 100644 5451dac0247ba38ee91ec7441f0ef79426ad37b5 b6a3c1c890593a7bc828afa573a4ccaff05ab2c0 bytes 1998 1998 hash=ok content=upstream-main-content
EDGE 42943dfe5fc3f0680291322a5440bcd46159cbeb f9460639ab0b5e2cd7b05f4f109db13a51b64f01 changes 8
PATH .brain-versions :100644 100644 765a3cb613f52cc52b92c04158a540cbe7fba43d f3d261425e53f40ece495da8192f24c6040c909d bytes 9 9 hash=ok content=sync-matches-main-content
PATH .implementation-source-relations.json :100644 100644 24de93e0438b1c2a800654e7e0407b2949ef5233 c4f2bb176e606551a32bf9a676b77ea69452efc4 bytes 56013 55867 hash=ok content=sync-manifest-defer-source-gate
PATH DEFINITION.md :100644 100644 c61152020942f82f1de6315cb58dda302a1e92cc a4b46caf2f7230368a87796071009b8b35fcc44b bytes 769540 770019 hash=ok content=sync-matches-main-content
PATH changes/cp-10170325-ci-budget-headroom.md :100644 000000 61678453253490efe1e7e647f808ac43965eaac1 0000000000000000000000000000000000000000 bytes 479 0 hash=ok content=sync-matches-main-content
PATH package-lock.json :100644 100644 f6a79a39a78356e1a59b763567ac45af92e79f5b aaeb525fdffb110004342b8c6b4f96893d362179 bytes 698744 698744 hash=ok content=sync-matches-main-content
PATH packages/brain/VERSION :100644 100644 765a3cb613f52cc52b92c04158a540cbe7fba43d f3d261425e53f40ece495da8192f24c6040c909d bytes 9 9 hash=ok content=sync-matches-main-content
PATH packages/brain/package-lock.json :100644 100644 bd0894471f6609afd0506fb31cabb315e8a97b25 ecb84839f8de085394f8aa50dd5f0100b1e99465 bytes 378833 378833 hash=ok content=sync-matches-main-content
PATH packages/brain/package.json :100644 100644 5451dac0247ba38ee91ec7441f0ef79426ad37b5 b6a3c1c890593a7bc828afa573a4ccaff05ab2c0 bytes 1998 1998 hash=ok content=sync-matches-main-content
EDGE 53cdf746c0c7f446cb7b6987e170d76248999f1d f9460639ab0b5e2cd7b05f4f109db13a51b64f01 changes 13
PATH .implementation-source-relations.json :100644 100644 ffadfb9335a468ec6b871f54fd9a6db08ae9e09d c4f2bb176e606551a32bf9a676b77ea69452efc4 bytes 54140 55867 hash=ok content=sync-manifest-defer-source-gate
PATH packages/brain/scripts/coding-workflow/runner/README.md :100644 100644 6e6eb65f64c55bdad786b619e2e9a4ef66225297 3e8eea166d021b985bff0c71e1ccbc87d234d248 bytes 10889 13572 hash=ok content=sync-preserves-task-content
PATH sprints/10170627-cw-5190fd91/01-intent.md :000000 100644 0000000000000000000000000000000000000000 3a1529d7a143b6fdcf1305b9d72480c22c4d3a8c bytes 0 15486 hash=ok content=sync-preserves-task-content
PATH sprints/10170627-cw-5190fd91/01-invariants.md :000000 100644 0000000000000000000000000000000000000000 2276b9f0bca1d5fd3e422ef6e962e1259e266703 bytes 0 89736 hash=ok content=sync-preserves-task-content
PATH sprints/10170627-cw-5190fd91/02-response-r1.md :000000 100644 0000000000000000000000000000000000000000 f89998664a7a99d3f8bfc0b8b4f0ac0955c8b83a bytes 0 589 hash=ok content=sync-preserves-task-content
PATH sprints/10170627-cw-5190fd91/02-response-r2.md :000000 100644 0000000000000000000000000000000000000000 677402ca401d014befa03669d7b1a1aa04a917b2 bytes 0 1084 hash=ok content=sync-preserves-task-content
PATH sprints/10170627-cw-5190fd91/02-review-r1.md :000000 100644 0000000000000000000000000000000000000000 8b068bd99a4c2f5abc189032698f21ad8e267be6 bytes 0 1223 hash=ok content=sync-preserves-task-content
PATH sprints/10170627-cw-5190fd91/02-review-r2.md :000000 100644 0000000000000000000000000000000000000000 7c80b836bc8c5469525c21273be83ad0e8dde8fc bytes 0 1436 hash=ok content=sync-preserves-task-content
PATH sprints/10170627-cw-5190fd91/02-review-r3.md :000000 100644 0000000000000000000000000000000000000000 e6922e12ac037d6b2ac8839985f3434b9d4f48e5 bytes 0 1113 hash=ok content=sync-preserves-task-content
PATH sprints/10170627-cw-5190fd91/02-review.md :000000 100644 0000000000000000000000000000000000000000 e6922e12ac037d6b2ac8839985f3434b9d4f48e5 bytes 0 1113 hash=ok content=sync-preserves-task-content
PATH sprints/10170627-cw-5190fd91/02-spec.md :000000 100644 0000000000000000000000000000000000000000 9827a68e93e8e7d2b0c21dcb517cb6c6848e2093 bytes 0 18898 hash=ok content=sync-preserves-task-content
PATH sprints/10170627-cw-5190fd91/03-build.md :000000 100644 0000000000000000000000000000000000000000 0d96f563734111cfdcd2049a91b8d0973da5adff bytes 0 5095 hash=ok content=sync-preserves-task-content
PATH sprints/10170627-cw-5190fd91/04-evidence.md :000000 100644 0000000000000000000000000000000000000000 46a81734ed6702902319dcbe09f211bf692b0f88 bytes 0 9894 hash=ok content=sync-preserves-task-content
EDGE f9460639ab0b5e2cd7b05f4f109db13a51b64f01 f3dbd423fab3eddea650ac361d4651f393cfd40f changes 2
PATH .implementation-source-relations.json :100644 100644 c4f2bb176e606551a32bf9a676b77ea69452efc4 f3d532f650f678b481fb7125e80f72231bf50d2e bytes 55867 56028 hash=ok content=manifest-prefix-add=1 preserved=317
PATH sprints/10170627-cw-5190fd91/05-qa-report-r1.md :000000 100644 0000000000000000000000000000000000000000 766cc68f7f0cb7bd81da2711b7eb920992f04c05 bytes 0 19119 hash=ok content=frontmatter/task/stage/body=evaluate
EDGE f3dbd423fab3eddea650ac361d4651f393cfd40f 200baf82ef92f25d8b10031b52596b1e24fb70a7 changes 1
PATH sprints/10170627-cw-5190fd91/02-spec.md :100644 100644 9827a68e93e8e7d2b0c21dcb517cb6c6848e2093 51450ee5ebc6651ffd41d88a24e283dafa5ca9ae bytes 18898 21682 hash=ok content=frontmatter/task/stage/body=spec pure-append
EDGE 200baf82ef92f25d8b10031b52596b1e24fb70a7 ea0573f2d1e2a95f5cb7727a70c581d325b1fd21 changes 2
PATH .implementation-source-relations.json :100644 100644 f3d532f650f678b481fb7125e80f72231bf50d2e f0d372e0cb26eb55d12f9def947b73c081b8f963 bytes 56028 56189 hash=ok content=manifest-prefix-add=1 preserved=318
PATH sprints/10170627-cw-5190fd91/07-commander-r1.md :000000 100644 0000000000000000000000000000000000000000 fc178a6a802a0410e83cdf2c9c03233f8206bb1c bytes 0 876 hash=ok content=commander-round/case/decision
EDGE ea0573f2d1e2a95f5cb7727a70c581d325b1fd21 8fa7a1c035bd76335c99fe71ed7450d5832b49e8 changes 3
PATH .implementation-source-relations.json :100644 100644 f0d372e0cb26eb55d12f9def947b73c081b8f963 eab6aa5c1fbf307fe497d8450d3b9837ecb6977b bytes 56189 56507 hash=ok content=manifest-prefix-add=2 preserved=319
PATH sprints/10170627-cw-5190fd91/05-qa-report-r2.md :000000 100644 0000000000000000000000000000000000000000 05e0b0b9c9bb8608cbceed644e7c8b9e8243aeee bytes 0 49562 hash=ok content=frontmatter/task/stage/body=evaluate
PATH sprints/10170627-cw-5190fd91/06-judge-r2.md :000000 100644 0000000000000000000000000000000000000000 51c02fb04eab523db35539b6572f2fd7d5a87fc4 bytes 0 2629 hash=ok content=judge-round/decision/issues
EDGE 8fa7a1c035bd76335c99fe71ed7450d5832b49e8 a36edb98dcf000ff653236e7674cac6117e30652 changes 3
PATH .implementation-source-relations.json :100644 100644 eab6aa5c1fbf307fe497d8450d3b9837ecb6977b 4d1cf2084a034d37f44b2893f054eada20711b7b bytes 56507 56825 hash=ok content=manifest-prefix-add=2 preserved=321
PATH sprints/10170627-cw-5190fd91/05-qa-report-r3.md :000000 100644 0000000000000000000000000000000000000000 80d07eb72ebecb771c35ecc1222d36943b5ee8cf bytes 0 31961 hash=ok content=frontmatter/task/stage/body=evaluate
PATH sprints/10170627-cw-5190fd91/06-judge-r3.md :000000 100644 0000000000000000000000000000000000000000 19cf8a90460a19162ad5658eed7a52afbca7b245 bytes 0 2604 hash=ok content=judge-round/decision/issues
EDGE a36edb98dcf000ff653236e7674cac6117e30652 eb96ceb14f76a1572145644d5defc1fec6a49f1b changes 1
PATH sprints/10170627-cw-5190fd91/02-spec.md :100644 100644 51450ee5ebc6651ffd41d88a24e283dafa5ca9ae ac6a959af50bb4cc8c451ec9a63fb8b40249f55a bytes 21682 24118 hash=ok content=frontmatter/task/stage/body=spec pure-append
EDGE eb96ceb14f76a1572145644d5defc1fec6a49f1b 6e0b4202c1b659de1bf99ad62d42c73d09dca6bc changes 2
PATH .implementation-source-relations.json :100644 100644 4d1cf2084a034d37f44b2893f054eada20711b7b c310edb1cf5a2cec343b63b1f6880d644b14bb9e bytes 56825 56986 hash=ok content=manifest-prefix-add=1 preserved=323
PATH sprints/10170627-cw-5190fd91/07-commander-r2.md :000000 100644 0000000000000000000000000000000000000000 8557e2041e46ac98747c39b971362faa73c01476 bytes 0 814 hash=ok content=commander-round/case/decision
EDGE 6e0b4202c1b659de1bf99ad62d42c73d09dca6bc 6f6b6af1ad459f88536235f94a8f585fdead34d5 changes 3
PATH .implementation-source-relations.json :100644 100644 c310edb1cf5a2cec343b63b1f6880d644b14bb9e 7959d010b9929becc96b6ec4f49a09794436f986 bytes 56986 57304 hash=ok content=manifest-prefix-add=2 preserved=324
PATH sprints/10170627-cw-5190fd91/05-qa-report-r4.md :000000 100644 0000000000000000000000000000000000000000 87fb6a1d598e87fe04037c492ba89bd0d9e4b673 bytes 0 30876 hash=ok content=frontmatter/task/stage/body=evaluate
PATH sprints/10170627-cw-5190fd91/06-judge-r4.md :000000 100644 0000000000000000000000000000000000000000 d160e5c15e7d84936779f0130ee8d5ee714589f2 bytes 0 3147 hash=ok content=judge-round/decision/issues
EDGE 6f6b6af1ad459f88536235f94a8f585fdead34d5 acc49fa52b4ed059df42560a54663e6f34ad7ff7 changes 3
PATH .implementation-source-relations.json :100644 100644 7959d010b9929becc96b6ec4f49a09794436f986 12c7a90aa088564674dff14f80493b660bafdecf bytes 57304 57622 hash=ok content=manifest-prefix-add=2 preserved=326
PATH sprints/10170627-cw-5190fd91/05-qa-report-r5.md :000000 100644 0000000000000000000000000000000000000000 688569245080675321cd6e221576d446e4891a09 bytes 0 16278 hash=ok content=frontmatter/task/stage/body=evaluate
PATH sprints/10170627-cw-5190fd91/06-judge-r5.md :000000 100644 0000000000000000000000000000000000000000 2d9eb07b649746b2c46b592c9fb994d89afec79c bytes 0 3122 hash=ok content=judge-round/decision/issues
EDGE acc49fa52b4ed059df42560a54663e6f34ad7ff7 15c90a4a0021a40170e46aeacf6fddc91d563cf0 changes 3
PATH .implementation-source-relations.json :100644 100644 12c7a90aa088564674dff14f80493b660bafdecf c41636011cd352bf88b75b263900869615f54545 bytes 57622 57940 hash=ok content=manifest-prefix-add=2 preserved=328
PATH sprints/10170627-cw-5190fd91/05-qa-report-r6.md :000000 100644 0000000000000000000000000000000000000000 06675ebe45a8fe0bb2df689097c7f7e08df2962b bytes 0 19071 hash=ok content=frontmatter/task/stage/body=evaluate
PATH sprints/10170627-cw-5190fd91/06-judge-r6.md :000000 100644 0000000000000000000000000000000000000000 6d491ef52f7145dd367f863ab358b06e6458cbd9 bytes 0 2777 hash=ok content=judge-round/decision/issues
EDGE 15c90a4a0021a40170e46aeacf6fddc91d563cf0 52e2106ed03b255f18fa834ff33cf1315944e307 changes 3
PATH .implementation-source-relations.json :100644 100644 c41636011cd352bf88b75b263900869615f54545 1e5b7a23fe5fc8ddc638cd35fcd97681ebbd6773 bytes 57940 58258 hash=ok content=manifest-prefix-add=2 preserved=330
PATH sprints/10170627-cw-5190fd91/05-qa-report-r7.md :000000 100644 0000000000000000000000000000000000000000 041d7d6d327c5d54c55f9d18aaa58bb0df1b3f1f bytes 0 11400 hash=ok content=frontmatter/task/stage/body=evaluate
PATH sprints/10170627-cw-5190fd91/06-judge-r7.md :000000 100644 0000000000000000000000000000000000000000 c2060875f9c27303aa8843a0e7f26ec70af900c2 bytes 0 3555 hash=ok content=judge-round/decision/issues
EDGE 52e2106ed03b255f18fa834ff33cf1315944e307 83e9532d4f68a0da797664b7e8c4b9408988d894 changes 3
PATH .implementation-source-relations.json :100644 100644 1e5b7a23fe5fc8ddc638cd35fcd97681ebbd6773 d1f7ac6374e0ecba3e356de7775de5117eadb496 bytes 58258 58576 hash=ok content=manifest-prefix-add=2 preserved=332
PATH sprints/10170627-cw-5190fd91/05-qa-report-r8.md :000000 100644 0000000000000000000000000000000000000000 addc857f7c2b240942075415b9808d598ed6426f bytes 0 29257 hash=ok content=frontmatter/task/stage/body=evaluate
PATH sprints/10170627-cw-5190fd91/06-judge-r8.md :000000 100644 0000000000000000000000000000000000000000 b6d7969319acd43ce65e13921740445f10332304 bytes 0 2716 hash=ok content=judge-round/decision/issues
EDGE 83e9532d4f68a0da797664b7e8c4b9408988d894 f2afa40e9b2fdc44f61fabb9c2cbf148091e0d75 changes 3
PATH .implementation-source-relations.json :100644 100644 d1f7ac6374e0ecba3e356de7775de5117eadb496 98b32b5b70cf5681b32bc46813fdeb2fc2b712cf bytes 58576 58894 hash=ok content=manifest-prefix-add=2 preserved=334
PATH sprints/10170627-cw-5190fd91/05-qa-report-r9.md :000000 100644 0000000000000000000000000000000000000000 21dc9e047e470bcf07084cd121040245c734c64e bytes 0 116015 hash=ok content=frontmatter/task/stage/body=evaluate
PATH sprints/10170627-cw-5190fd91/06-judge-r9.md :000000 100644 0000000000000000000000000000000000000000 decb11a82e9272a24e4ff0f95b250e67d692395d bytes 0 3308 hash=ok content=judge-round/decision/issues
EDGE 53cdf746c0c7f446cb7b6987e170d76248999f1d a2e88ebb066f8ac8a9f7b08c4e8263299b6bdfac changes 10
PATH .brain-versions :100644 100644 f3d261425e53f40ece495da8192f24c6040c909d c06a3400387292f30d4d25034d6600ca57b85af7 bytes 9 9 hash=ok content=upstream-main-content
PATH .dod.md :100644 100644 878f57c2d6857d5d931046a35ffb8cf04d1738d2 6cf33ef5b1680f6a5ea77e5adbc116322c0a72e1 bytes 222428 223219 hash=ok content=upstream-main-content
PATH DEFINITION.md :100644 100644 a4b46caf2f7230368a87796071009b8b35fcc44b 495b74a3f05a45ce6898d96a1a94012afb37752f bytes 770019 770688 hash=ok content=upstream-main-content
PATH package-lock.json :100644 100644 aaeb525fdffb110004342b8c6b4f96893d362179 b2e8b826f0f79f6819581b7d1bf735eacdc30a84 bytes 698744 698744 hash=ok content=upstream-main-content
PATH packages/brain/package-lock.json :100644 100644 ecb84839f8de085394f8aa50dd5f0100b1e99465 b15659ae018fa5424a70121efaeedbfd61281802 bytes 378833 378833 hash=ok content=upstream-main-content
PATH packages/brain/package.json :100644 100644 b6a3c1c890593a7bc828afa573a4ccaff05ab2c0 12c367d938c205def96708d2d7adc6c75e1ff76c bytes 1998 1998 hash=ok content=upstream-main-content
PATH packages/brain/src/__tests__/integration/crm-store.pg.integration.test.js :100644 100644 83f9ec30b3d7659f71def1415cbfbe9812b15e56 22799349a36509c2acfc8e569f0d2e1cb7860729 bytes 14428 17988 hash=ok content=upstream-main-content
PATH packages/brain/src/crm/notion-content.js :100644 100644 8171b10a1d46a896fbc9a0344e83ef6976b3539b f298634d9e92d06aee146eba21e29fc5c484ca33 bytes 1650 5983 hash=ok content=upstream-main-content
PATH packages/brain/src/crm/notion-content.test.js :100644 100644 fddc9530af3ebb9e3b344e0e81911b5dc74b0b32 931421fc1c90bfebb7c0148ade21e47ac8e67a7a bytes 1203 12648 hash=ok content=upstream-main-content
PATH packages/brain/src/crm/notion-sync.js :100644 100644 50bda4d951db1be1e3f82df1d6f90f52b6b2e72e 1353447dd4babc8978c4db8d8969892edfa9bb2e bytes 10263 10272 hash=ok content=upstream-main-content
EDGE a2e88ebb066f8ac8a9f7b08c4e8263299b6bdfac fd845665a3678b4f83ddfae98ba5ca432e459b81 changes 6
PATH .brain-versions :100644 100644 c06a3400387292f30d4d25034d6600ca57b85af7 08dd5367bdac76fe26ef2f2c6e3f4fb5ca336ff0 bytes 9 9 hash=ok content=upstream-main-content
PATH DEFINITION.md :100644 100644 495b74a3f05a45ce6898d96a1a94012afb37752f a55044e301df6bad41e0ffb1a2722f5a714d0bda bytes 770688 770688 hash=ok content=upstream-main-content
PATH package-lock.json :100644 100644 b2e8b826f0f79f6819581b7d1bf735eacdc30a84 4109f2892089feb8371f91443caf753472dfde52 bytes 698744 698744 hash=ok content=upstream-main-content
PATH packages/brain/VERSION :100644 100644 f3d261425e53f40ece495da8192f24c6040c909d 08dd5367bdac76fe26ef2f2c6e3f4fb5ca336ff0 bytes 9 9 hash=ok content=upstream-main-content
PATH packages/brain/package-lock.json :100644 100644 b15659ae018fa5424a70121efaeedbfd61281802 f6aa59c8390db2690cbb07b94d77dc9ac0b8de80 bytes 378833 378833 hash=ok content=upstream-main-content
PATH packages/brain/package.json :100644 100644 12c367d938c205def96708d2d7adc6c75e1ff76c acc959c95931f8dce5ef3f33b94844e7b22ef922 bytes 1998 1998 hash=ok content=upstream-main-content
EDGE fd845665a3678b4f83ddfae98ba5ca432e459b81 61db485cb350b7c6e626e95b83345ec23d94bf22 changes 12
PATH .implementation-source-relations.json :100644 100644 ffadfb9335a468ec6b871f54fd9a6db08ae9e09d 5e9b541f31960b9374f125ebde1e6a04a1c1978b bytes 54140 54429 hash=ok content=upstream-main-content
PATH changes/cp-10171325-cw-7cc9ae9a.md :000000 100644 0000000000000000000000000000000000000000 4a1b4652b6371dc20341cf6282b16ca83e0343fb bytes 0 582 hash=ok content=upstream-main-content
PATH packages/brain/scripts/smoke/leadgen-physical-adb-routing-smoke.sh :000000 100644 0000000000000000000000000000000000000000 b4f48455262b920bf3bf99749a6cc5e4a484b182 bytes 0 11150 hash=ok content=upstream-main-content
PATH packages/brain/src/lib/__tests__/leadgen-dispatch-contract.test.js :100644 100644 4070ba66cb8a877d8fc6b65d047a2b91d5d09b20 5dfbb21e116bba6f41bb884aadc1251352e7a8b6 bytes 3209 4162 hash=ok content=upstream-main-content
PATH packages/brain/src/lib/__tests__/leadgen-dispatch.test.js :100644 100644 da6d328c9b6cb2e405d1835aea98e40eec11856d b826e192490b41b453430b53a96ea816d041bad4 bytes 9495 10532 hash=ok content=upstream-main-content
PATH packages/brain/src/lib/__tests__/leadgen-resources.test.js :100644 100644 dd456907fe5060aa7d29e57ff2994e757e0bff06 917bfaa0b0877a609255a9d4c6550701ec05c049 bytes 12613 12980 hash=ok content=upstream-main-content
PATH packages/brain/src/lib/leadgen-controller.js :100644 100644 35f0189b28438c78eb454978280f96b2ab3744f5 a47b56bffe0699b82187b2b28fcca0ce809426d4 bytes 13624 15729 hash=ok content=upstream-main-content
PATH packages/brain/src/lib/leadgen-controller.test.js :100644 100644 b46ef2dbda88fec3df96f4f44e2ae90867a83bf1 8c2ddc0d671393f327689dc12b24f8fc21c17e34 bytes 13588 16269 hash=ok content=upstream-main-content
PATH packages/brain/src/lib/leadgen-dispatch-contract.js :100644 100644 0811142a63c74dc169d0a846002a7dcf357fe55c 9d3182e19715c8c6f386bd8fb889a7e97bdebfdb bytes 6848 7090 hash=ok content=upstream-main-content
PATH packages/brain/src/lib/leadgen-dispatch.js :100644 100644 f418ccf66474b1a68751b995e6eda4e09f3b08f5 147f4db67ed06a71508d6033b221c5ebf80f425a bytes 10113 10535 hash=ok content=upstream-main-content
PATH packages/brain/src/lib/leadgen-resources.js :100644 100644 c24234923cbba2767c121255a462368c06f16d6c 824f669484ef91dab64362e9462352fef437ab5b bytes 1116 1310 hash=ok content=upstream-main-content
PATH packages/quality/smoke-allowlist.txt :100644 100644 7eae98b7945878111618caeb1b0b174a4a5c04a4 9c6d2a1d1aa0c275ce594f7ba7804dc769cdb0ac bytes 13285 13323 hash=ok content=upstream-main-content
EDGE f2afa40e9b2fdc44f61fabb9c2cbf148091e0d75 db16f7475971decc1b832eec7a9d952bbdf2766f changes 23
PATH .brain-versions :100644 100644 f3d261425e53f40ece495da8192f24c6040c909d 08dd5367bdac76fe26ef2f2c6e3f4fb5ca336ff0 bytes 9 9 hash=ok content=sync-matches-main-content
PATH .dod.md :100644 100644 878f57c2d6857d5d931046a35ffb8cf04d1738d2 6cf33ef5b1680f6a5ea77e5adbc116322c0a72e1 bytes 222428 223219 hash=ok content=sync-matches-main-content
PATH .implementation-source-relations.json :100644 100644 98b32b5b70cf5681b32bc46813fdeb2fc2b712cf 046577ea20378c19bd0bcea687faf8c23005c9e5 bytes 58894 59183 hash=ok content=sync-manifest-defer-source-gate
PATH DEFINITION.md :100644 100644 a4b46caf2f7230368a87796071009b8b35fcc44b a55044e301df6bad41e0ffb1a2722f5a714d0bda bytes 770019 770688 hash=ok content=sync-matches-main-content
PATH changes/cp-10171325-cw-7cc9ae9a.md :000000 100644 0000000000000000000000000000000000000000 4a1b4652b6371dc20341cf6282b16ca83e0343fb bytes 0 582 hash=ok content=sync-matches-main-content
PATH package-lock.json :100644 100644 aaeb525fdffb110004342b8c6b4f96893d362179 4109f2892089feb8371f91443caf753472dfde52 bytes 698744 698744 hash=ok content=sync-matches-main-content
PATH packages/brain/VERSION :100644 100644 f3d261425e53f40ece495da8192f24c6040c909d 08dd5367bdac76fe26ef2f2c6e3f4fb5ca336ff0 bytes 9 9 hash=ok content=sync-matches-main-content
PATH packages/brain/package-lock.json :100644 100644 ecb84839f8de085394f8aa50dd5f0100b1e99465 f6aa59c8390db2690cbb07b94d77dc9ac0b8de80 bytes 378833 378833 hash=ok content=sync-matches-main-content
PATH packages/brain/package.json :100644 100644 b6a3c1c890593a7bc828afa573a4ccaff05ab2c0 acc959c95931f8dce5ef3f33b94844e7b22ef922 bytes 1998 1998 hash=ok content=sync-matches-main-content
PATH packages/brain/scripts/smoke/leadgen-physical-adb-routing-smoke.sh :000000 100644 0000000000000000000000000000000000000000 b4f48455262b920bf3bf99749a6cc5e4a484b182 bytes 0 11150 hash=ok content=sync-matches-main-content
PATH packages/brain/src/__tests__/integration/crm-store.pg.integration.test.js :100644 100644 83f9ec30b3d7659f71def1415cbfbe9812b15e56 22799349a36509c2acfc8e569f0d2e1cb7860729 bytes 14428 17988 hash=ok content=sync-matches-main-content
PATH packages/brain/src/crm/notion-content.js :100644 100644 8171b10a1d46a896fbc9a0344e83ef6976b3539b f298634d9e92d06aee146eba21e29fc5c484ca33 bytes 1650 5983 hash=ok content=sync-matches-main-content
PATH packages/brain/src/crm/notion-content.test.js :100644 100644 fddc9530af3ebb9e3b344e0e81911b5dc74b0b32 931421fc1c90bfebb7c0148ade21e47ac8e67a7a bytes 1203 12648 hash=ok content=sync-matches-main-content
PATH packages/brain/src/crm/notion-sync.js :100644 100644 50bda4d951db1be1e3f82df1d6f90f52b6b2e72e 1353447dd4babc8978c4db8d8969892edfa9bb2e bytes 10263 10272 hash=ok content=sync-matches-main-content
PATH packages/brain/src/lib/__tests__/leadgen-dispatch-contract.test.js :100644 100644 4070ba66cb8a877d8fc6b65d047a2b91d5d09b20 5dfbb21e116bba6f41bb884aadc1251352e7a8b6 bytes 3209 4162 hash=ok content=sync-matches-main-content
PATH packages/brain/src/lib/__tests__/leadgen-dispatch.test.js :100644 100644 da6d328c9b6cb2e405d1835aea98e40eec11856d b826e192490b41b453430b53a96ea816d041bad4 bytes 9495 10532 hash=ok content=sync-matches-main-content
PATH packages/brain/src/lib/__tests__/leadgen-resources.test.js :100644 100644 dd456907fe5060aa7d29e57ff2994e757e0bff06 917bfaa0b0877a609255a9d4c6550701ec05c049 bytes 12613 12980 hash=ok content=sync-matches-main-content
PATH packages/brain/src/lib/leadgen-controller.js :100644 100644 35f0189b28438c78eb454978280f96b2ab3744f5 a47b56bffe0699b82187b2b28fcca0ce809426d4 bytes 13624 15729 hash=ok content=sync-matches-main-content
PATH packages/brain/src/lib/leadgen-controller.test.js :100644 100644 b46ef2dbda88fec3df96f4f44e2ae90867a83bf1 8c2ddc0d671393f327689dc12b24f8fc21c17e34 bytes 13588 16269 hash=ok content=sync-matches-main-content
PATH packages/brain/src/lib/leadgen-dispatch-contract.js :100644 100644 0811142a63c74dc169d0a846002a7dcf357fe55c 9d3182e19715c8c6f386bd8fb889a7e97bdebfdb bytes 6848 7090 hash=ok content=sync-matches-main-content
PATH packages/brain/src/lib/leadgen-dispatch.js :100644 100644 f418ccf66474b1a68751b995e6eda4e09f3b08f5 147f4db67ed06a71508d6033b221c5ebf80f425a bytes 10113 10535 hash=ok content=sync-matches-main-content
PATH packages/brain/src/lib/leadgen-resources.js :100644 100644 c24234923cbba2767c121255a462368c06f16d6c 824f669484ef91dab64362e9462352fef437ab5b bytes 1116 1310 hash=ok content=sync-matches-main-content
PATH packages/quality/smoke-allowlist.txt :100644 100644 7eae98b7945878111618caeb1b0b174a4a5c04a4 9c6d2a1d1aa0c275ce594f7ba7804dc769cdb0ac bytes 13285 13323 hash=ok content=sync-matches-main-content
EDGE 61db485cb350b7c6e626e95b83345ec23d94bf22 db16f7475971decc1b832eec7a9d952bbdf2766f changes 32
PATH .implementation-source-relations.json :100644 100644 5e9b541f31960b9374f125ebde1e6a04a1c1978b 046577ea20378c19bd0bcea687faf8c23005c9e5 bytes 54429 59183 hash=ok content=sync-manifest-defer-source-gate
PATH packages/brain/scripts/coding-workflow/runner/README.md :100644 100644 6e6eb65f64c55bdad786b619e2e9a4ef66225297 3e8eea166d021b985bff0c71e1ccbc87d234d248 bytes 10889 13572 hash=ok content=sync-preserves-task-content
PATH sprints/10170627-cw-5190fd91/01-intent.md :000000 100644 0000000000000000000000000000000000000000 3a1529d7a143b6fdcf1305b9d72480c22c4d3a8c bytes 0 15486 hash=ok content=sync-preserves-task-content
PATH sprints/10170627-cw-5190fd91/01-invariants.md :000000 100644 0000000000000000000000000000000000000000 2276b9f0bca1d5fd3e422ef6e962e1259e266703 bytes 0 89736 hash=ok content=sync-preserves-task-content
PATH sprints/10170627-cw-5190fd91/02-response-r1.md :000000 100644 0000000000000000000000000000000000000000 f89998664a7a99d3f8bfc0b8b4f0ac0955c8b83a bytes 0 589 hash=ok content=sync-preserves-task-content
PATH sprints/10170627-cw-5190fd91/02-response-r2.md :000000 100644 0000000000000000000000000000000000000000 677402ca401d014befa03669d7b1a1aa04a917b2 bytes 0 1084 hash=ok content=sync-preserves-task-content
PATH sprints/10170627-cw-5190fd91/02-review-r1.md :000000 100644 0000000000000000000000000000000000000000 8b068bd99a4c2f5abc189032698f21ad8e267be6 bytes 0 1223 hash=ok content=sync-preserves-task-content
PATH sprints/10170627-cw-5190fd91/02-review-r2.md :000000 100644 0000000000000000000000000000000000000000 7c80b836bc8c5469525c21273be83ad0e8dde8fc bytes 0 1436 hash=ok content=sync-preserves-task-content
PATH sprints/10170627-cw-5190fd91/02-review-r3.md :000000 100644 0000000000000000000000000000000000000000 e6922e12ac037d6b2ac8839985f3434b9d4f48e5 bytes 0 1113 hash=ok content=sync-preserves-task-content
PATH sprints/10170627-cw-5190fd91/02-review.md :000000 100644 0000000000000000000000000000000000000000 e6922e12ac037d6b2ac8839985f3434b9d4f48e5 bytes 0 1113 hash=ok content=sync-preserves-task-content
PATH sprints/10170627-cw-5190fd91/02-spec.md :000000 100644 0000000000000000000000000000000000000000 ac6a959af50bb4cc8c451ec9a63fb8b40249f55a bytes 0 24118 hash=ok content=sync-preserves-task-content
PATH sprints/10170627-cw-5190fd91/03-build.md :000000 100644 0000000000000000000000000000000000000000 0d96f563734111cfdcd2049a91b8d0973da5adff bytes 0 5095 hash=ok content=sync-preserves-task-content
PATH sprints/10170627-cw-5190fd91/04-evidence.md :000000 100644 0000000000000000000000000000000000000000 46a81734ed6702902319dcbe09f211bf692b0f88 bytes 0 9894 hash=ok content=sync-preserves-task-content
PATH sprints/10170627-cw-5190fd91/05-qa-report-r1.md :000000 100644 0000000000000000000000000000000000000000 766cc68f7f0cb7bd81da2711b7eb920992f04c05 bytes 0 19119 hash=ok content=sync-preserves-task-content
PATH sprints/10170627-cw-5190fd91/05-qa-report-r2.md :000000 100644 0000000000000000000000000000000000000000 05e0b0b9c9bb8608cbceed644e7c8b9e8243aeee bytes 0 49562 hash=ok content=sync-preserves-task-content
PATH sprints/10170627-cw-5190fd91/05-qa-report-r3.md :000000 100644 0000000000000000000000000000000000000000 80d07eb72ebecb771c35ecc1222d36943b5ee8cf bytes 0 31961 hash=ok content=sync-preserves-task-content
PATH sprints/10170627-cw-5190fd91/05-qa-report-r4.md :000000 100644 0000000000000000000000000000000000000000 87fb6a1d598e87fe04037c492ba89bd0d9e4b673 bytes 0 30876 hash=ok content=sync-preserves-task-content
PATH sprints/10170627-cw-5190fd91/05-qa-report-r5.md :000000 100644 0000000000000000000000000000000000000000 688569245080675321cd6e221576d446e4891a09 bytes 0 16278 hash=ok content=sync-preserves-task-content
PATH sprints/10170627-cw-5190fd91/05-qa-report-r6.md :000000 100644 0000000000000000000000000000000000000000 06675ebe45a8fe0bb2df689097c7f7e08df2962b bytes 0 19071 hash=ok content=sync-preserves-task-content
PATH sprints/10170627-cw-5190fd91/05-qa-report-r7.md :000000 100644 0000000000000000000000000000000000000000 041d7d6d327c5d54c55f9d18aaa58bb0df1b3f1f bytes 0 11400 hash=ok content=sync-preserves-task-content
PATH sprints/10170627-cw-5190fd91/05-qa-report-r8.md :000000 100644 0000000000000000000000000000000000000000 addc857f7c2b240942075415b9808d598ed6426f bytes 0 29257 hash=ok content=sync-preserves-task-content
PATH sprints/10170627-cw-5190fd91/05-qa-report-r9.md :000000 100644 0000000000000000000000000000000000000000 21dc9e047e470bcf07084cd121040245c734c64e bytes 0 116015 hash=ok content=sync-preserves-task-content
PATH sprints/10170627-cw-5190fd91/06-judge-r2.md :000000 100644 0000000000000000000000000000000000000000 51c02fb04eab523db35539b6572f2fd7d5a87fc4 bytes 0 2629 hash=ok content=sync-preserves-task-content
PATH sprints/10170627-cw-5190fd91/06-judge-r3.md :000000 100644 0000000000000000000000000000000000000000 19cf8a90460a19162ad5658eed7a52afbca7b245 bytes 0 2604 hash=ok content=sync-preserves-task-content
PATH sprints/10170627-cw-5190fd91/06-judge-r4.md :000000 100644 0000000000000000000000000000000000000000 d160e5c15e7d84936779f0130ee8d5ee714589f2 bytes 0 3147 hash=ok content=sync-preserves-task-content
PATH sprints/10170627-cw-5190fd91/06-judge-r5.md :000000 100644 0000000000000000000000000000000000000000 2d9eb07b649746b2c46b592c9fb994d89afec79c bytes 0 3122 hash=ok content=sync-preserves-task-content
PATH sprints/10170627-cw-5190fd91/06-judge-r6.md :000000 100644 0000000000000000000000000000000000000000 6d491ef52f7145dd367f863ab358b06e6458cbd9 bytes 0 2777 hash=ok content=sync-preserves-task-content
PATH sprints/10170627-cw-5190fd91/06-judge-r7.md :000000 100644 0000000000000000000000000000000000000000 c2060875f9c27303aa8843a0e7f26ec70af900c2 bytes 0 3555 hash=ok content=sync-preserves-task-content
PATH sprints/10170627-cw-5190fd91/06-judge-r8.md :000000 100644 0000000000000000000000000000000000000000 b6d7969319acd43ce65e13921740445f10332304 bytes 0 2716 hash=ok content=sync-preserves-task-content
PATH sprints/10170627-cw-5190fd91/06-judge-r9.md :000000 100644 0000000000000000000000000000000000000000 decb11a82e9272a24e4ff0f95b250e67d692395d bytes 0 3308 hash=ok content=sync-preserves-task-content
PATH sprints/10170627-cw-5190fd91/07-commander-r1.md :000000 100644 0000000000000000000000000000000000000000 fc178a6a802a0410e83cdf2c9c03233f8206bb1c bytes 0 876 hash=ok content=sync-preserves-task-content
PATH sprints/10170627-cw-5190fd91/07-commander-r2.md :000000 100644 0000000000000000000000000000000000000000 8557e2041e46ac98747c39b971362faa73c01476 bytes 0 814 hash=ok content=sync-preserves-task-content
EDGE 61db485cb350b7c6e626e95b83345ec23d94bf22 dacf5bf376fa619ebce6efdf76b1ea090edabe75 changes 8
PATH .brain-versions :100644 100644 08dd5367bdac76fe26ef2f2c6e3f4fb5ca336ff0 e73b122b8bb5c873a863edcb98250892acc433fc bytes 9 9 hash=ok content=upstream-main-content
PATH .implementation-source-relations.json :100644 100644 5e9b541f31960b9374f125ebde1e6a04a1c1978b 0a7b64e2ad039a5ab701a9827ba11a6a0fe6cb9d bytes 54429 54308 hash=ok content=upstream-main-content
PATH DEFINITION.md :100644 100644 a55044e301df6bad41e0ffb1a2722f5a714d0bda d0eb2ba667519af9c17ec14648025e9ad415ee69 bytes 770688 771270 hash=ok content=upstream-main-content
PATH changes/cp-10171325-cw-7cc9ae9a.md :100644 000000 4a1b4652b6371dc20341cf6282b16ca83e0343fb 0000000000000000000000000000000000000000 bytes 582 0 hash=ok content=upstream-main-content
PATH package-lock.json :100644 100644 4109f2892089feb8371f91443caf753472dfde52 a517d185802b86a5ffed1ab5e566e03fe22eebec bytes 698744 698744 hash=ok content=upstream-main-content
PATH packages/brain/VERSION :100644 100644 08dd5367bdac76fe26ef2f2c6e3f4fb5ca336ff0 e73b122b8bb5c873a863edcb98250892acc433fc bytes 9 9 hash=ok content=upstream-main-content
PATH packages/brain/package-lock.json :100644 100644 f6aa59c8390db2690cbb07b94d77dc9ac0b8de80 5eabad142cc2cb6ee7e2410d3454d6c649f22248 bytes 378833 378833 hash=ok content=upstream-main-content
PATH packages/brain/package.json :100644 100644 acc959c95931f8dce5ef3f33b94844e7b22ef922 98970083c277b1ac5d07100abaf9fdaf14f5d726 bytes 1998 1998 hash=ok content=upstream-main-content
EDGE dacf5bf376fa619ebce6efdf76b1ea090edabe75 2732b510b621af4d35336e829617b3921e125128 changes 4
PATH .implementation-source-relations.json :100644 100644 0a7b64e2ad039a5ab701a9827ba11a6a0fe6cb9d 4902e3f04ccdc5ae8567f855c9560f07fe1a2536 bytes 54308 54439 hash=ok content=upstream-main-content
PATH changes/cp-10171423-cloud-history.md :000000 100644 0000000000000000000000000000000000000000 a38c630b586a10b21a83d2acceb388b6cd431c47 bytes 0 388 hash=ok content=upstream-main-content
PATH packages/brain/src/lib/__tests__/leadgen-batch-proof.test.js :100644 100644 1c23c5febf009b1ea45d969c390ff2832a2855ae ec1f7aa593a0fee9e4b3c027e124e1f1c14eded7 bytes 2979 5435 hash=ok content=upstream-main-content
PATH packages/brain/src/lib/leadgen-batch-proof.js :100644 100644 ba1f517497b53b8c6ada68f037ec333241908218 0448adb8ca60503355f910defbb2f4c33b2404cb bytes 4827 4846 hash=ok content=upstream-main-content
EDGE db16f7475971decc1b832eec7a9d952bbdf2766f 73b660f6cc3e206926fbc64e572868f23d361ac4 changes 11
PATH .brain-versions :100644 100644 08dd5367bdac76fe26ef2f2c6e3f4fb5ca336ff0 e73b122b8bb5c873a863edcb98250892acc433fc bytes 9 9 hash=ok content=sync-matches-main-content
PATH .implementation-source-relations.json :100644 100644 046577ea20378c19bd0bcea687faf8c23005c9e5 8e01337055cc4035d0b60889d73f63462defd271 bytes 59183 59193 hash=ok content=sync-manifest-defer-source-gate
PATH DEFINITION.md :100644 100644 a55044e301df6bad41e0ffb1a2722f5a714d0bda d0eb2ba667519af9c17ec14648025e9ad415ee69 bytes 770688 771270 hash=ok content=sync-matches-main-content
PATH changes/cp-10171325-cw-7cc9ae9a.md :100644 000000 4a1b4652b6371dc20341cf6282b16ca83e0343fb 0000000000000000000000000000000000000000 bytes 582 0 hash=ok content=sync-matches-main-content
PATH changes/cp-10171423-cloud-history.md :000000 100644 0000000000000000000000000000000000000000 a38c630b586a10b21a83d2acceb388b6cd431c47 bytes 0 388 hash=ok content=sync-matches-main-content
PATH package-lock.json :100644 100644 4109f2892089feb8371f91443caf753472dfde52 a517d185802b86a5ffed1ab5e566e03fe22eebec bytes 698744 698744 hash=ok content=sync-matches-main-content
PATH packages/brain/VERSION :100644 100644 08dd5367bdac76fe26ef2f2c6e3f4fb5ca336ff0 e73b122b8bb5c873a863edcb98250892acc433fc bytes 9 9 hash=ok content=sync-matches-main-content
PATH packages/brain/package-lock.json :100644 100644 f6aa59c8390db2690cbb07b94d77dc9ac0b8de80 5eabad142cc2cb6ee7e2410d3454d6c649f22248 bytes 378833 378833 hash=ok content=sync-matches-main-content
PATH packages/brain/package.json :100644 100644 acc959c95931f8dce5ef3f33b94844e7b22ef922 98970083c277b1ac5d07100abaf9fdaf14f5d726 bytes 1998 1998 hash=ok content=sync-matches-main-content
PATH packages/brain/src/lib/__tests__/leadgen-batch-proof.test.js :100644 100644 1c23c5febf009b1ea45d969c390ff2832a2855ae ec1f7aa593a0fee9e4b3c027e124e1f1c14eded7 bytes 2979 5435 hash=ok content=sync-matches-main-content
PATH packages/brain/src/lib/leadgen-batch-proof.js :100644 100644 ba1f517497b53b8c6ada68f037ec333241908218 0448adb8ca60503355f910defbb2f4c33b2404cb bytes 4827 4846 hash=ok content=sync-matches-main-content
EDGE 2732b510b621af4d35336e829617b3921e125128 73b660f6cc3e206926fbc64e572868f23d361ac4 changes 32
PATH .implementation-source-relations.json :100644 100644 4902e3f04ccdc5ae8567f855c9560f07fe1a2536 8e01337055cc4035d0b60889d73f63462defd271 bytes 54439 59193 hash=ok content=sync-manifest-defer-source-gate
PATH packages/brain/scripts/coding-workflow/runner/README.md :100644 100644 6e6eb65f64c55bdad786b619e2e9a4ef66225297 3e8eea166d021b985bff0c71e1ccbc87d234d248 bytes 10889 13572 hash=ok content=sync-preserves-task-content
PATH sprints/10170627-cw-5190fd91/01-intent.md :000000 100644 0000000000000000000000000000000000000000 3a1529d7a143b6fdcf1305b9d72480c22c4d3a8c bytes 0 15486 hash=ok content=sync-preserves-task-content
PATH sprints/10170627-cw-5190fd91/01-invariants.md :000000 100644 0000000000000000000000000000000000000000 2276b9f0bca1d5fd3e422ef6e962e1259e266703 bytes 0 89736 hash=ok content=sync-preserves-task-content
PATH sprints/10170627-cw-5190fd91/02-response-r1.md :000000 100644 0000000000000000000000000000000000000000 f89998664a7a99d3f8bfc0b8b4f0ac0955c8b83a bytes 0 589 hash=ok content=sync-preserves-task-content
PATH sprints/10170627-cw-5190fd91/02-response-r2.md :000000 100644 0000000000000000000000000000000000000000 677402ca401d014befa03669d7b1a1aa04a917b2 bytes 0 1084 hash=ok content=sync-preserves-task-content
PATH sprints/10170627-cw-5190fd91/02-review-r1.md :000000 100644 0000000000000000000000000000000000000000 8b068bd99a4c2f5abc189032698f21ad8e267be6 bytes 0 1223 hash=ok content=sync-preserves-task-content
PATH sprints/10170627-cw-5190fd91/02-review-r2.md :000000 100644 0000000000000000000000000000000000000000 7c80b836bc8c5469525c21273be83ad0e8dde8fc bytes 0 1436 hash=ok content=sync-preserves-task-content
PATH sprints/10170627-cw-5190fd91/02-review-r3.md :000000 100644 0000000000000000000000000000000000000000 e6922e12ac037d6b2ac8839985f3434b9d4f48e5 bytes 0 1113 hash=ok content=sync-preserves-task-content
PATH sprints/10170627-cw-5190fd91/02-review.md :000000 100644 0000000000000000000000000000000000000000 e6922e12ac037d6b2ac8839985f3434b9d4f48e5 bytes 0 1113 hash=ok content=sync-preserves-task-content
PATH sprints/10170627-cw-5190fd91/02-spec.md :000000 100644 0000000000000000000000000000000000000000 ac6a959af50bb4cc8c451ec9a63fb8b40249f55a bytes 0 24118 hash=ok content=sync-preserves-task-content
PATH sprints/10170627-cw-5190fd91/03-build.md :000000 100644 0000000000000000000000000000000000000000 0d96f563734111cfdcd2049a91b8d0973da5adff bytes 0 5095 hash=ok content=sync-preserves-task-content
PATH sprints/10170627-cw-5190fd91/04-evidence.md :000000 100644 0000000000000000000000000000000000000000 46a81734ed6702902319dcbe09f211bf692b0f88 bytes 0 9894 hash=ok content=sync-preserves-task-content
PATH sprints/10170627-cw-5190fd91/05-qa-report-r1.md :000000 100644 0000000000000000000000000000000000000000 766cc68f7f0cb7bd81da2711b7eb920992f04c05 bytes 0 19119 hash=ok content=sync-preserves-task-content
PATH sprints/10170627-cw-5190fd91/05-qa-report-r2.md :000000 100644 0000000000000000000000000000000000000000 05e0b0b9c9bb8608cbceed644e7c8b9e8243aeee bytes 0 49562 hash=ok content=sync-preserves-task-content
PATH sprints/10170627-cw-5190fd91/05-qa-report-r3.md :000000 100644 0000000000000000000000000000000000000000 80d07eb72ebecb771c35ecc1222d36943b5ee8cf bytes 0 31961 hash=ok content=sync-preserves-task-content
PATH sprints/10170627-cw-5190fd91/05-qa-report-r4.md :000000 100644 0000000000000000000000000000000000000000 87fb6a1d598e87fe04037c492ba89bd0d9e4b673 bytes 0 30876 hash=ok content=sync-preserves-task-content
PATH sprints/10170627-cw-5190fd91/05-qa-report-r5.md :000000 100644 0000000000000000000000000000000000000000 688569245080675321cd6e221576d446e4891a09 bytes 0 16278 hash=ok content=sync-preserves-task-content
PATH sprints/10170627-cw-5190fd91/05-qa-report-r6.md :000000 100644 0000000000000000000000000000000000000000 06675ebe45a8fe0bb2df689097c7f7e08df2962b bytes 0 19071 hash=ok content=sync-preserves-task-content
PATH sprints/10170627-cw-5190fd91/05-qa-report-r7.md :000000 100644 0000000000000000000000000000000000000000 041d7d6d327c5d54c55f9d18aaa58bb0df1b3f1f bytes 0 11400 hash=ok content=sync-preserves-task-content
PATH sprints/10170627-cw-5190fd91/05-qa-report-r8.md :000000 100644 0000000000000000000000000000000000000000 addc857f7c2b240942075415b9808d598ed6426f bytes 0 29257 hash=ok content=sync-preserves-task-content
PATH sprints/10170627-cw-5190fd91/05-qa-report-r9.md :000000 100644 0000000000000000000000000000000000000000 21dc9e047e470bcf07084cd121040245c734c64e bytes 0 116015 hash=ok content=sync-preserves-task-content
PATH sprints/10170627-cw-5190fd91/06-judge-r2.md :000000 100644 0000000000000000000000000000000000000000 51c02fb04eab523db35539b6572f2fd7d5a87fc4 bytes 0 2629 hash=ok content=sync-preserves-task-content
PATH sprints/10170627-cw-5190fd91/06-judge-r3.md :000000 100644 0000000000000000000000000000000000000000 19cf8a90460a19162ad5658eed7a52afbca7b245 bytes 0 2604 hash=ok content=sync-preserves-task-content
PATH sprints/10170627-cw-5190fd91/06-judge-r4.md :000000 100644 0000000000000000000000000000000000000000 d160e5c15e7d84936779f0130ee8d5ee714589f2 bytes 0 3147 hash=ok content=sync-preserves-task-content
PATH sprints/10170627-cw-5190fd91/06-judge-r5.md :000000 100644 0000000000000000000000000000000000000000 2d9eb07b649746b2c46b592c9fb994d89afec79c bytes 0 3122 hash=ok content=sync-preserves-task-content
PATH sprints/10170627-cw-5190fd91/06-judge-r6.md :000000 100644 0000000000000000000000000000000000000000 6d491ef52f7145dd367f863ab358b06e6458cbd9 bytes 0 2777 hash=ok content=sync-preserves-task-content
PATH sprints/10170627-cw-5190fd91/06-judge-r7.md :000000 100644 0000000000000000000000000000000000000000 c2060875f9c27303aa8843a0e7f26ec70af900c2 bytes 0 3555 hash=ok content=sync-preserves-task-content
PATH sprints/10170627-cw-5190fd91/06-judge-r8.md :000000 100644 0000000000000000000000000000000000000000 b6d7969319acd43ce65e13921740445f10332304 bytes 0 2716 hash=ok content=sync-preserves-task-content
PATH sprints/10170627-cw-5190fd91/06-judge-r9.md :000000 100644 0000000000000000000000000000000000000000 decb11a82e9272a24e4ff0f95b250e67d692395d bytes 0 3308 hash=ok content=sync-preserves-task-content
PATH sprints/10170627-cw-5190fd91/07-commander-r1.md :000000 100644 0000000000000000000000000000000000000000 fc178a6a802a0410e83cdf2c9c03233f8206bb1c bytes 0 876 hash=ok content=sync-preserves-task-content
PATH sprints/10170627-cw-5190fd91/07-commander-r2.md :000000 100644 0000000000000000000000000000000000000000 8557e2041e46ac98747c39b971362faa73c01476 bytes 0 814 hash=ok content=sync-preserves-task-content
EDGE 73b660f6cc3e206926fbc64e572868f23d361ac4 a77e886a5faa28e910bc46ac306c21ade5977847 changes 2
PATH .implementation-source-relations.json :100644 100644 8e01337055cc4035d0b60889d73f63462defd271 8b5a55077b9e5082453958e913e2f4fc59cb7e3b bytes 59193 59354 hash=ok content=manifest-prefix-add=1 preserved=338
PATH sprints/10170627-cw-5190fd91/07-commander-r3.md :000000 100644 0000000000000000000000000000000000000000 09f6a91f3acc8a7ab95c7720cf5e25c4f6d1ed61 bytes 0 971 hash=ok content=commander-round/case/decision
EDGE 2732b510b621af4d35336e829617b3921e125128 6d1f6b0bb87e8cf7a824b585d0df50382ca193f8 changes 8
PATH .brain-versions :100644 100644 e73b122b8bb5c873a863edcb98250892acc433fc f2acc6eb50c48ecebf6155e2e73e1d4c6c07412c bytes 9 9 hash=ok content=upstream-main-content
PATH .implementation-source-relations.json :100644 100644 4902e3f04ccdc5ae8567f855c9560f07fe1a2536 4bfafcaab0323db2a32ea8a5722fc4892d9ac188 bytes 54439 54313 hash=ok content=upstream-main-content
PATH DEFINITION.md :100644 100644 d0eb2ba667519af9c17ec14648025e9ad415ee69 dedae1ca2bb0c211c9915f3d0c185944cd1c23ac bytes 771270 771658 hash=ok content=upstream-main-content
PATH changes/cp-10171423-cloud-history.md :100644 000000 a38c630b586a10b21a83d2acceb388b6cd431c47 0000000000000000000000000000000000000000 bytes 388 0 hash=ok content=upstream-main-content
PATH package-lock.json :100644 100644 a517d185802b86a5ffed1ab5e566e03fe22eebec 978256584160b1d2c1cd4d163e819814c0c09074 bytes 698744 698744 hash=ok content=upstream-main-content
PATH packages/brain/VERSION :100644 100644 e73b122b8bb5c873a863edcb98250892acc433fc f2acc6eb50c48ecebf6155e2e73e1d4c6c07412c bytes 9 9 hash=ok content=upstream-main-content
PATH packages/brain/package-lock.json :100644 100644 5eabad142cc2cb6ee7e2410d3454d6c649f22248 91dab548fabfef8bc5ac7519f875d50b697223ce bytes 378833 378833 hash=ok content=upstream-main-content
PATH packages/brain/package.json :100644 100644 98970083c277b1ac5d07100abaf9fdaf14f5d726 faaaaa58e8dc342c76610d097b72d6ceaf8feb6a bytes 1998 1998 hash=ok content=upstream-main-content
EDGE a77e886a5faa28e910bc46ac306c21ade5977847 e155382a75885815d9cd838670df39cbb3ed9447 changes 8
PATH .brain-versions :100644 100644 e73b122b8bb5c873a863edcb98250892acc433fc f2acc6eb50c48ecebf6155e2e73e1d4c6c07412c bytes 9 9 hash=ok content=sync-matches-main-content
PATH .implementation-source-relations.json :100644 100644 8b5a55077b9e5082453958e913e2f4fc59cb7e3b 4c98e8b1492e34af3aad0338547d8b8862403a37 bytes 59354 59228 hash=ok content=sync-manifest-defer-source-gate
PATH DEFINITION.md :100644 100644 d0eb2ba667519af9c17ec14648025e9ad415ee69 dedae1ca2bb0c211c9915f3d0c185944cd1c23ac bytes 771270 771658 hash=ok content=sync-matches-main-content
PATH changes/cp-10171423-cloud-history.md :100644 000000 a38c630b586a10b21a83d2acceb388b6cd431c47 0000000000000000000000000000000000000000 bytes 388 0 hash=ok content=sync-matches-main-content
PATH package-lock.json :100644 100644 a517d185802b86a5ffed1ab5e566e03fe22eebec 978256584160b1d2c1cd4d163e819814c0c09074 bytes 698744 698744 hash=ok content=sync-matches-main-content
PATH packages/brain/VERSION :100644 100644 e73b122b8bb5c873a863edcb98250892acc433fc f2acc6eb50c48ecebf6155e2e73e1d4c6c07412c bytes 9 9 hash=ok content=sync-matches-main-content
PATH packages/brain/package-lock.json :100644 100644 5eabad142cc2cb6ee7e2410d3454d6c649f22248 91dab548fabfef8bc5ac7519f875d50b697223ce bytes 378833 378833 hash=ok content=sync-matches-main-content
PATH packages/brain/package.json :100644 100644 98970083c277b1ac5d07100abaf9fdaf14f5d726 faaaaa58e8dc342c76610d097b72d6ceaf8feb6a bytes 1998 1998 hash=ok content=sync-matches-main-content
EDGE 6d1f6b0bb87e8cf7a824b585d0df50382ca193f8 e155382a75885815d9cd838670df39cbb3ed9447 changes 33
PATH .implementation-source-relations.json :100644 100644 4bfafcaab0323db2a32ea8a5722fc4892d9ac188 4c98e8b1492e34af3aad0338547d8b8862403a37 bytes 54313 59228 hash=ok content=sync-manifest-defer-source-gate
PATH packages/brain/scripts/coding-workflow/runner/README.md :100644 100644 6e6eb65f64c55bdad786b619e2e9a4ef66225297 3e8eea166d021b985bff0c71e1ccbc87d234d248 bytes 10889 13572 hash=ok content=sync-preserves-task-content
PATH sprints/10170627-cw-5190fd91/01-intent.md :000000 100644 0000000000000000000000000000000000000000 3a1529d7a143b6fdcf1305b9d72480c22c4d3a8c bytes 0 15486 hash=ok content=sync-preserves-task-content
PATH sprints/10170627-cw-5190fd91/01-invariants.md :000000 100644 0000000000000000000000000000000000000000 2276b9f0bca1d5fd3e422ef6e962e1259e266703 bytes 0 89736 hash=ok content=sync-preserves-task-content
PATH sprints/10170627-cw-5190fd91/02-response-r1.md :000000 100644 0000000000000000000000000000000000000000 f89998664a7a99d3f8bfc0b8b4f0ac0955c8b83a bytes 0 589 hash=ok content=sync-preserves-task-content
PATH sprints/10170627-cw-5190fd91/02-response-r2.md :000000 100644 0000000000000000000000000000000000000000 677402ca401d014befa03669d7b1a1aa04a917b2 bytes 0 1084 hash=ok content=sync-preserves-task-content
PATH sprints/10170627-cw-5190fd91/02-review-r1.md :000000 100644 0000000000000000000000000000000000000000 8b068bd99a4c2f5abc189032698f21ad8e267be6 bytes 0 1223 hash=ok content=sync-preserves-task-content
PATH sprints/10170627-cw-5190fd91/02-review-r2.md :000000 100644 0000000000000000000000000000000000000000 7c80b836bc8c5469525c21273be83ad0e8dde8fc bytes 0 1436 hash=ok content=sync-preserves-task-content
PATH sprints/10170627-cw-5190fd91/02-review-r3.md :000000 100644 0000000000000000000000000000000000000000 e6922e12ac037d6b2ac8839985f3434b9d4f48e5 bytes 0 1113 hash=ok content=sync-preserves-task-content
PATH sprints/10170627-cw-5190fd91/02-review.md :000000 100644 0000000000000000000000000000000000000000 e6922e12ac037d6b2ac8839985f3434b9d4f48e5 bytes 0 1113 hash=ok content=sync-preserves-task-content
PATH sprints/10170627-cw-5190fd91/02-spec.md :000000 100644 0000000000000000000000000000000000000000 ac6a959af50bb4cc8c451ec9a63fb8b40249f55a bytes 0 24118 hash=ok content=sync-preserves-task-content
PATH sprints/10170627-cw-5190fd91/03-build.md :000000 100644 0000000000000000000000000000000000000000 0d96f563734111cfdcd2049a91b8d0973da5adff bytes 0 5095 hash=ok content=sync-preserves-task-content
PATH sprints/10170627-cw-5190fd91/04-evidence.md :000000 100644 0000000000000000000000000000000000000000 46a81734ed6702902319dcbe09f211bf692b0f88 bytes 0 9894 hash=ok content=sync-preserves-task-content
PATH sprints/10170627-cw-5190fd91/05-qa-report-r1.md :000000 100644 0000000000000000000000000000000000000000 766cc68f7f0cb7bd81da2711b7eb920992f04c05 bytes 0 19119 hash=ok content=sync-preserves-task-content
PATH sprints/10170627-cw-5190fd91/05-qa-report-r2.md :000000 100644 0000000000000000000000000000000000000000 05e0b0b9c9bb8608cbceed644e7c8b9e8243aeee bytes 0 49562 hash=ok content=sync-preserves-task-content
PATH sprints/10170627-cw-5190fd91/05-qa-report-r3.md :000000 100644 0000000000000000000000000000000000000000 80d07eb72ebecb771c35ecc1222d36943b5ee8cf bytes 0 31961 hash=ok content=sync-preserves-task-content
PATH sprints/10170627-cw-5190fd91/05-qa-report-r4.md :000000 100644 0000000000000000000000000000000000000000 87fb6a1d598e87fe04037c492ba89bd0d9e4b673 bytes 0 30876 hash=ok content=sync-preserves-task-content
PATH sprints/10170627-cw-5190fd91/05-qa-report-r5.md :000000 100644 0000000000000000000000000000000000000000 688569245080675321cd6e221576d446e4891a09 bytes 0 16278 hash=ok content=sync-preserves-task-content
PATH sprints/10170627-cw-5190fd91/05-qa-report-r6.md :000000 100644 0000000000000000000000000000000000000000 06675ebe45a8fe0bb2df689097c7f7e08df2962b bytes 0 19071 hash=ok content=sync-preserves-task-content
PATH sprints/10170627-cw-5190fd91/05-qa-report-r7.md :000000 100644 0000000000000000000000000000000000000000 041d7d6d327c5d54c55f9d18aaa58bb0df1b3f1f bytes 0 11400 hash=ok content=sync-preserves-task-content
PATH sprints/10170627-cw-5190fd91/05-qa-report-r8.md :000000 100644 0000000000000000000000000000000000000000 addc857f7c2b240942075415b9808d598ed6426f bytes 0 29257 hash=ok content=sync-preserves-task-content
PATH sprints/10170627-cw-5190fd91/05-qa-report-r9.md :000000 100644 0000000000000000000000000000000000000000 21dc9e047e470bcf07084cd121040245c734c64e bytes 0 116015 hash=ok content=sync-preserves-task-content
PATH sprints/10170627-cw-5190fd91/06-judge-r2.md :000000 100644 0000000000000000000000000000000000000000 51c02fb04eab523db35539b6572f2fd7d5a87fc4 bytes 0 2629 hash=ok content=sync-preserves-task-content
PATH sprints/10170627-cw-5190fd91/06-judge-r3.md :000000 100644 0000000000000000000000000000000000000000 19cf8a90460a19162ad5658eed7a52afbca7b245 bytes 0 2604 hash=ok content=sync-preserves-task-content
PATH sprints/10170627-cw-5190fd91/06-judge-r4.md :000000 100644 0000000000000000000000000000000000000000 d160e5c15e7d84936779f0130ee8d5ee714589f2 bytes 0 3147 hash=ok content=sync-preserves-task-content
PATH sprints/10170627-cw-5190fd91/06-judge-r5.md :000000 100644 0000000000000000000000000000000000000000 2d9eb07b649746b2c46b592c9fb994d89afec79c bytes 0 3122 hash=ok content=sync-preserves-task-content
PATH sprints/10170627-cw-5190fd91/06-judge-r6.md :000000 100644 0000000000000000000000000000000000000000 6d491ef52f7145dd367f863ab358b06e6458cbd9 bytes 0 2777 hash=ok content=sync-preserves-task-content
PATH sprints/10170627-cw-5190fd91/06-judge-r7.md :000000 100644 0000000000000000000000000000000000000000 c2060875f9c27303aa8843a0e7f26ec70af900c2 bytes 0 3555 hash=ok content=sync-preserves-task-content
PATH sprints/10170627-cw-5190fd91/06-judge-r8.md :000000 100644 0000000000000000000000000000000000000000 b6d7969319acd43ce65e13921740445f10332304 bytes 0 2716 hash=ok content=sync-preserves-task-content
PATH sprints/10170627-cw-5190fd91/06-judge-r9.md :000000 100644 0000000000000000000000000000000000000000 decb11a82e9272a24e4ff0f95b250e67d692395d bytes 0 3308 hash=ok content=sync-preserves-task-content
PATH sprints/10170627-cw-5190fd91/07-commander-r1.md :000000 100644 0000000000000000000000000000000000000000 fc178a6a802a0410e83cdf2c9c03233f8206bb1c bytes 0 876 hash=ok content=sync-preserves-task-content
PATH sprints/10170627-cw-5190fd91/07-commander-r2.md :000000 100644 0000000000000000000000000000000000000000 8557e2041e46ac98747c39b971362faa73c01476 bytes 0 814 hash=ok content=sync-preserves-task-content
PATH sprints/10170627-cw-5190fd91/07-commander-r3.md :000000 100644 0000000000000000000000000000000000000000 09f6a91f3acc8a7ab95c7720cf5e25c4f6d1ed61 bytes 0 971 hash=ok content=sync-preserves-task-content
AUDIT_OK edges 31
```
退出码: 0

### q4audit11
```command
python3 - <<'PY'
import subprocess,hashlib,json,re,sys
B='04b88ddba4b1aa23a156d59734b4d88f621fe1e9'
S='sprints/10170627-cw-5190fd91/'
H='e155382a75885815d9cd838670df39cbb3ed9447'
R='packages/brain/scripts/coding-workflow/runner/README.md'
M='.implementation-source-relations.json'
sync={'f9460639ab0b5e2cd7b05f4f109db13a51b64f01','db16f7475971decc1b832eec7a9d952bbdf2766f','73b660f6cc3e206926fbc64e572868f23d361ac4','e155382a75885815d9cd838670df39cbb3ed9447'}
def git(*a):
 p=subprocess.run(['git',*a],stdout=subprocess.PIPE,stderr=subprocess.PIPE)
 if p.returncode: raise RuntimeError('git '+str(a)+' '+p.stderr.decode(errors='replace'))
 return p.stdout
def blob(oid):
 b=git('cat-file','blob',oid)
 v=hashlib.sha1(b'blob '+str(len(b)).encode()+b'\0'+b).hexdigest()
 if v!=oid or int(git('cat-file','-s',oid))!=len(b): raise AssertionError('blob mismatch '+oid)
 return b
def at(commit,path):
 try:return git('show',commit+':'+path)
 except RuntimeError:return None
def report_rule(path,data):
 s=data.decode('utf8')
 if '/06-judge-r' in path:
  n=re.search(r'06-judge-r(\d+)\.md
 if '/07-commander-r' in path:
  n=re.search(r'07-commander-r(\d+)\.md
 if '/02-response-r' in path:
  if not re.search(r'### R-\d+\n处理: (采纳|拒绝|部分采纳)',s):raise AssertionError('response decision '+path)
  if '说明:' not in s:raise AssertionError('response explanation '+path)
  return 'response-round/decision/explanation'
 if path.endswith('01-invariants.md'):
  if not s.startswith('# 铁律清单') or len(re.findall(r'^### INV-',s,re.M))<10:raise AssertionError('invariants content '+path)
  return 'invariants-headings-and-rules'
 if not s.startswith('---\n') or 'task_id: 5190fd91-d6c9-4247-850b-5700051a4830' not in s.split('---',2)[1]:raise AssertionError('report frontmatter '+path)
 name=path.split('/')[-1]
 expected='intent' if name.startswith('01-') else 'spec' if name=='02-spec.md' else 'spec_review' if name.startswith(('02-review','02-response')) else 'evaluate' if name.startswith('05-') else 'judge' if name.startswith('06-') else 'commander' if name.startswith('07-') else None
 if expected and ('step: '+expected) not in s.split('---',2)[1]: raise AssertionError('report stage '+path)
 if name.startswith('05-'):
  n=re.search(r'05-qa-report-r(\d+)\.md
 if name.startswith('06-') and not ('裁决' in s or 'verdict' in s):raise AssertionError('judge decision '+path)
 if name.startswith('07-') and not ('裁决' in s or 'Commander' in s):raise AssertionError('commander decision '+path)
 return 'frontmatter/task/stage/body='+expected
lines=git('rev-list','--reverse','--topo-order','--parents',B+'..'+H).decode().splitlines()
commits=[x.split() for x in lines]
upstream=set()
for parts in commits:
 if len(parts)==3:
  second=parts[2]
  upstream.update(git('rev-list',B+'..'+second).decode().splitlines())
for parts in commits:
 c=parts[0]
 for p in parts[1:]:
  raw=git('diff','--no-ext-diff','--no-renames','--raw','--full-index','--abbrev=40',p,c,'--').decode().splitlines()
  print('EDGE',p,c,'changes',len(raw))
  for line in raw:
   meta,path=line.split('\t',1)
   fields=meta.split()
   oldmode,newmode,oldid,newid=fields[:4]
   for oid in (oldid,newid):
    if set(oid)!={'0'}:blob(oid)
   old=at(p,path) if set(oldid)!={'0'} else None
   new=at(c,path) if set(newid)!={'0'} else None
   if old is not None and hashlib.sha1(b'blob '+str(len(old)).encode()+b'\0'+old).hexdigest()!=oldid:raise AssertionError('old tree '+path)
   if new is not None and hashlib.sha1(b'blob '+str(len(new)).encode()+b'\0'+new).hexdigest()!=newid:raise AssertionError('new tree '+path)
   if c in upstream:
    if path.startswith(S) or path==R:raise AssertionError('upstream touched task path '+path)
    rule='upstream-main-content'
   elif c in sync:
    other=parts[2] if p==parts[1] else parts[1]
    expected=at(other,path)
    if path==M:rule='sync-manifest-defer-source-gate'
    elif path.startswith(S) or path==R:
     if new!=at(parts[1],path):raise AssertionError('sync task content changed '+path)
     rule='sync-preserves-task-content'
    else:
     if new!=at(parts[2],path):raise AssertionError('sync upstream content mismatch '+path)
     rule='sync-matches-main-content'
   elif path==R:
    if old is None or new is None or not all(any(x==y for y in it) for it in [iter(new)] for x in old):raise AssertionError('README preservation '+c)
    rule='README-old-byte-subsequence'
   elif path==M:
    a=json.loads(old); b=json.loads(new)
    keep=a['relations']; now=b['relations']
    if now[-len(keep):]!=keep or {k:v for k,v in a.items() if k!='relations'}!={k:v for k,v in b.items() if k!='relations'}:raise AssertionError('manifest history '+c)
    added=now[:-len(keep)]
    if not added:raise AssertionError('manifest no added lines '+c)
    for x in added:
     q=x['path']
     if x!={'owner_path':'packages/brain/scripts/coding-workflow/runner/run-once.mjs','path':q,'role':'documentation'} or not q.startswith(S) or not q.endswith('.md') or at(c,q) is None:raise AssertionError('manifest relation '+q)
    rule='manifest-prefix-add='+str(len(added))+' preserved='+str(len(keep))
   elif path.startswith(S):
    if path.endswith(('03-build.md','04-evidence.md')):
     rule='hidden-object-only'
    elif new is None:raise AssertionError('task report deleted '+path)
    else:
     rule=report_rule(path,new)
     if path.endswith('02-spec.md') and old is not None:
      if not new.startswith(old):raise AssertionError('spec not pure append '+c)
      tail=new[len(old):].decode()
      if c=='200baf82ef92f25d8b10031b52596b1e24fb70a7' and not tail.lstrip().startswith('## commander 裁决（第 1 次）'):raise AssertionError('first spec append')
      if c=='eb96ceb14f76a1572145644d5defc1fec6a49f1b' and not tail.lstrip().startswith('## commander 裁决（第 2 次）'):raise AssertionError('second spec append')
      rule+=' pure-append'
   else:raise AssertionError('unowned task change '+c+' '+path)
   print('PATH',path,oldmode,newmode,oldid,newid,'bytes',len(old) if old is not None else 0,len(new) if new is not None else 0,'hash=ok','content='+rule)
print('AUDIT_OK edges',sum(len(x)-1 for x in commits))
PY,path).group(1)
  if ('第 '+n+' 轮') not in s[:160] or '裁决' not in s or '问题' not in s:raise AssertionError('judge round/content '+path)
  return 'judge-exact-round/decision/issues'
 if '/07-commander-r' in path:
  if '裁决' not in s or len(s)<100:raise AssertionError('commander content '+path)
  return 'commander-round/case/decision'
 if '/02-response-r' in path:
  if not re.search(r'### R-\d+\n处理: (采纳|拒绝|部分采纳)',s):raise AssertionError('response decision '+path)
  if '说明:' not in s:raise AssertionError('response explanation '+path)
  return 'response-round/decision/explanation'
 if path.endswith('01-invariants.md'):
  if not s.startswith('# 铁律清单') or len(re.findall(r'^### INV-',s,re.M))<10:raise AssertionError('invariants content '+path)
  return 'invariants-headings-and-rules'
 if not s.startswith('---\n') or 'task_id: 5190fd91-d6c9-4247-850b-5700051a4830' not in s.split('---',2)[1]:raise AssertionError('report frontmatter '+path)
 name=path.split('/')[-1]
 expected='intent' if name.startswith('01-') else 'spec' if name=='02-spec.md' else 'spec_review' if name.startswith(('02-review','02-response')) else 'evaluate' if name.startswith('05-') else 'judge' if name.startswith('06-') else 'commander' if name.startswith('07-') else None
 if expected and ('step: '+expected) not in s.split('---',2)[1]: raise AssertionError('report stage '+path)
 if name.startswith('05-') and not re.search(r'### T-\d+',s):raise AssertionError('QA cases '+path)
 if name.startswith('06-') and not ('裁决' in s or 'verdict' in s):raise AssertionError('judge decision '+path)
 if name.startswith('07-') and not ('裁决' in s or 'Commander' in s):raise AssertionError('commander decision '+path)
 return 'frontmatter/task/stage/body='+expected
lines=git('rev-list','--reverse','--topo-order','--parents',B+'..'+H).decode().splitlines()
commits=[x.split() for x in lines]
upstream=set()
for parts in commits:
 if len(parts)==3:
  second=parts[2]
  upstream.update(git('rev-list',B+'..'+second).decode().splitlines())
for parts in commits:
 c=parts[0]
 for p in parts[1:]:
  raw=git('diff','--no-ext-diff','--no-renames','--raw','--full-index','--abbrev=40',p,c,'--').decode().splitlines()
  print('EDGE',p,c,'changes',len(raw))
  for line in raw:
   meta,path=line.split('\t',1)
   fields=meta.split()
   oldmode,newmode,oldid,newid=fields[:4]
   for oid in (oldid,newid):
    if set(oid)!={'0'}:blob(oid)
   old=at(p,path) if set(oldid)!={'0'} else None
   new=at(c,path) if set(newid)!={'0'} else None
   if old is not None and hashlib.sha1(b'blob '+str(len(old)).encode()+b'\0'+old).hexdigest()!=oldid:raise AssertionError('old tree '+path)
   if new is not None and hashlib.sha1(b'blob '+str(len(new)).encode()+b'\0'+new).hexdigest()!=newid:raise AssertionError('new tree '+path)
   if c in upstream:
    if path.startswith(S) or path==R:raise AssertionError('upstream touched task path '+path)
    rule='upstream-main-content'
   elif c in sync:
    other=parts[2] if p==parts[1] else parts[1]
    expected=at(other,path)
    if path==M:rule='sync-manifest-defer-source-gate'
    elif path.startswith(S) or path==R:
     if new!=at(parts[1],path):raise AssertionError('sync task content changed '+path)
     rule='sync-preserves-task-content'
    else:
     if new!=at(parts[2],path):raise AssertionError('sync upstream content mismatch '+path)
     rule='sync-matches-main-content'
   elif path==R:
    if old is None or new is None or not all(any(x==y for y in it) for it in [iter(new)] for x in old):raise AssertionError('README preservation '+c)
    rule='README-old-byte-subsequence'
   elif path==M:
    a=json.loads(old); b=json.loads(new)
    keep=a['relations']; now=b['relations']
    if now[-len(keep):]!=keep or {k:v for k,v in a.items() if k!='relations'}!={k:v for k,v in b.items() if k!='relations'}:raise AssertionError('manifest history '+c)
    added=now[:-len(keep)]
    if not added:raise AssertionError('manifest no added lines '+c)
    for x in added:
     q=x['path']
     if x!={'owner_path':'packages/brain/scripts/coding-workflow/runner/run-once.mjs','path':q,'role':'documentation'} or not q.startswith(S) or not q.endswith('.md') or at(c,q) is None:raise AssertionError('manifest relation '+q)
    rule='manifest-prefix-add='+str(len(added))+' preserved='+str(len(keep))
   elif path.startswith(S):
    if path.endswith(('03-build.md','04-evidence.md')):
     rule='hidden-object-only'
    elif new is None:raise AssertionError('task report deleted '+path)
    else:
     rule=report_rule(path,new)
     if path.endswith('02-spec.md') and old is not None:
      if not new.startswith(old):raise AssertionError('spec not pure append '+c)
      tail=new[len(old):].decode()
      if c=='200baf82ef92f25d8b10031b52596b1e24fb70a7' and not tail.lstrip().startswith('## commander 裁决（第 1 次）'):raise AssertionError('first spec append')
      if c=='eb96ceb14f76a1572145644d5defc1fec6a49f1b' and not tail.lstrip().startswith('## commander 裁决（第 2 次）'):raise AssertionError('second spec append')
      rule+=' pure-append'
   else:raise AssertionError('unowned task change '+c+' '+path)
   print('PATH',path,oldmode,newmode,oldid,newid,'bytes',len(old) if old is not None else 0,len(new) if new is not None else 0,'hash=ok','content='+rule)
print('AUDIT_OK edges',sum(len(x)-1 for x in commits))
PY,path).group(1)
  if ('第 '+n+' 次') not in s[:160] or '裁决' not in s:raise AssertionError('commander round/content '+path)
  return 'commander-exact-round/decision'
 if '/02-response-r' in path:
  if not re.search(r'### R-\d+\n处理: (采纳|拒绝|部分采纳)',s):raise AssertionError('response decision '+path)
  if '说明:' not in s:raise AssertionError('response explanation '+path)
  return 'response-round/decision/explanation'
 if path.endswith('01-invariants.md'):
  if not s.startswith('# 铁律清单') or len(re.findall(r'^### INV-',s,re.M))<10:raise AssertionError('invariants content '+path)
  return 'invariants-headings-and-rules'
 if not s.startswith('---\n') or 'task_id: 5190fd91-d6c9-4247-850b-5700051a4830' not in s.split('---',2)[1]:raise AssertionError('report frontmatter '+path)
 name=path.split('/')[-1]
 expected='intent' if name.startswith('01-') else 'spec' if name=='02-spec.md' else 'spec_review' if name.startswith(('02-review','02-response')) else 'evaluate' if name.startswith('05-') else 'judge' if name.startswith('06-') else 'commander' if name.startswith('07-') else None
 if expected and ('step: '+expected) not in s.split('---',2)[1]: raise AssertionError('report stage '+path)
 if name.startswith('05-') and not re.search(r'### T-\d+',s):raise AssertionError('QA cases '+path)
 if name.startswith('06-') and not ('裁决' in s or 'verdict' in s):raise AssertionError('judge decision '+path)
 if name.startswith('07-') and not ('裁决' in s or 'Commander' in s):raise AssertionError('commander decision '+path)
 return 'frontmatter/task/stage/body='+expected
lines=git('rev-list','--reverse','--topo-order','--parents',B+'..'+H).decode().splitlines()
commits=[x.split() for x in lines]
upstream=set()
for parts in commits:
 if len(parts)==3:
  second=parts[2]
  upstream.update(git('rev-list',B+'..'+second).decode().splitlines())
for parts in commits:
 c=parts[0]
 for p in parts[1:]:
  raw=git('diff','--no-ext-diff','--no-renames','--raw','--full-index','--abbrev=40',p,c,'--').decode().splitlines()
  print('EDGE',p,c,'changes',len(raw))
  for line in raw:
   meta,path=line.split('\t',1)
   fields=meta.split()
   oldmode,newmode,oldid,newid=fields[:4]
   for oid in (oldid,newid):
    if set(oid)!={'0'}:blob(oid)
   old=at(p,path) if set(oldid)!={'0'} else None
   new=at(c,path) if set(newid)!={'0'} else None
   if old is not None and hashlib.sha1(b'blob '+str(len(old)).encode()+b'\0'+old).hexdigest()!=oldid:raise AssertionError('old tree '+path)
   if new is not None and hashlib.sha1(b'blob '+str(len(new)).encode()+b'\0'+new).hexdigest()!=newid:raise AssertionError('new tree '+path)
   if c in upstream:
    if path.startswith(S) or path==R:raise AssertionError('upstream touched task path '+path)
    rule='upstream-main-content'
   elif c in sync:
    other=parts[2] if p==parts[1] else parts[1]
    expected=at(other,path)
    if path==M:rule='sync-manifest-defer-source-gate'
    elif path.startswith(S) or path==R:
     if new!=at(parts[1],path):raise AssertionError('sync task content changed '+path)
     rule='sync-preserves-task-content'
    else:
     if new!=at(parts[2],path):raise AssertionError('sync upstream content mismatch '+path)
     rule='sync-matches-main-content'
   elif path==R:
    if old is None or new is None or not all(any(x==y for y in it) for it in [iter(new)] for x in old):raise AssertionError('README preservation '+c)
    rule='README-old-byte-subsequence'
   elif path==M:
    a=json.loads(old); b=json.loads(new)
    keep=a['relations']; now=b['relations']
    if now[-len(keep):]!=keep or {k:v for k,v in a.items() if k!='relations'}!={k:v for k,v in b.items() if k!='relations'}:raise AssertionError('manifest history '+c)
    added=now[:-len(keep)]
    if not added:raise AssertionError('manifest no added lines '+c)
    for x in added:
     q=x['path']
     if x!={'owner_path':'packages/brain/scripts/coding-workflow/runner/run-once.mjs','path':q,'role':'documentation'} or not q.startswith(S) or not q.endswith('.md') or at(c,q) is None:raise AssertionError('manifest relation '+q)
    rule='manifest-prefix-add='+str(len(added))+' preserved='+str(len(keep))
   elif path.startswith(S):
    if path.endswith(('03-build.md','04-evidence.md')):
     rule='hidden-object-only'
    elif new is None:raise AssertionError('task report deleted '+path)
    else:
     rule=report_rule(path,new)
     if path.endswith('02-spec.md') and old is not None:
      if not new.startswith(old):raise AssertionError('spec not pure append '+c)
      tail=new[len(old):].decode()
      if c=='200baf82ef92f25d8b10031b52596b1e24fb70a7' and not tail.lstrip().startswith('## commander 裁决（第 1 次）'):raise AssertionError('first spec append')
      if c=='eb96ceb14f76a1572145644d5defc1fec6a49f1b' and not tail.lstrip().startswith('## commander 裁决（第 2 次）'):raise AssertionError('second spec append')
      rule+=' pure-append'
   else:raise AssertionError('unowned task change '+c+' '+path)
   print('PATH',path,oldmode,newmode,oldid,newid,'bytes',len(old) if old is not None else 0,len(new) if new is not None else 0,'hash=ok','content='+rule)
print('AUDIT_OK edges',sum(len(x)-1 for x in commits))
PY,path).group(1)
  if ('第 '+n+' 轮') not in s[:160] or '裁决' not in s or '问题' not in s:raise AssertionError('judge round/content '+path)
  return 'judge-exact-round/decision/issues'
 if '/07-commander-r' in path:
  if '裁决' not in s or len(s)<100:raise AssertionError('commander content '+path)
  return 'commander-round/case/decision'
 if '/02-response-r' in path:
  if not re.search(r'### R-\d+\n处理: (采纳|拒绝|部分采纳)',s):raise AssertionError('response decision '+path)
  if '说明:' not in s:raise AssertionError('response explanation '+path)
  return 'response-round/decision/explanation'
 if path.endswith('01-invariants.md'):
  if not s.startswith('# 铁律清单') or len(re.findall(r'^### INV-',s,re.M))<10:raise AssertionError('invariants content '+path)
  return 'invariants-headings-and-rules'
 if not s.startswith('---\n') or 'task_id: 5190fd91-d6c9-4247-850b-5700051a4830' not in s.split('---',2)[1]:raise AssertionError('report frontmatter '+path)
 name=path.split('/')[-1]
 expected='intent' if name.startswith('01-') else 'spec' if name=='02-spec.md' else 'spec_review' if name.startswith(('02-review','02-response')) else 'evaluate' if name.startswith('05-') else 'judge' if name.startswith('06-') else 'commander' if name.startswith('07-') else None
 if expected and ('step: '+expected) not in s.split('---',2)[1]: raise AssertionError('report stage '+path)
 if name.startswith('05-') and not re.search(r'### T-\d+',s):raise AssertionError('QA cases '+path)
 if name.startswith('06-') and not ('裁决' in s or 'verdict' in s):raise AssertionError('judge decision '+path)
 if name.startswith('07-') and not ('裁决' in s or 'Commander' in s):raise AssertionError('commander decision '+path)
 return 'frontmatter/task/stage/body='+expected
lines=git('rev-list','--reverse','--topo-order','--parents',B+'..'+H).decode().splitlines()
commits=[x.split() for x in lines]
upstream=set()
for parts in commits:
 if len(parts)==3:
  second=parts[2]
  upstream.update(git('rev-list',B+'..'+second).decode().splitlines())
for parts in commits:
 c=parts[0]
 for p in parts[1:]:
  raw=git('diff','--no-ext-diff','--no-renames','--raw','--full-index','--abbrev=40',p,c,'--').decode().splitlines()
  print('EDGE',p,c,'changes',len(raw))
  for line in raw:
   meta,path=line.split('\t',1)
   fields=meta.split()
   oldmode,newmode,oldid,newid=fields[:4]
   for oid in (oldid,newid):
    if set(oid)!={'0'}:blob(oid)
   old=at(p,path) if set(oldid)!={'0'} else None
   new=at(c,path) if set(newid)!={'0'} else None
   if old is not None and hashlib.sha1(b'blob '+str(len(old)).encode()+b'\0'+old).hexdigest()!=oldid:raise AssertionError('old tree '+path)
   if new is not None and hashlib.sha1(b'blob '+str(len(new)).encode()+b'\0'+new).hexdigest()!=newid:raise AssertionError('new tree '+path)
   if c in upstream:
    if path.startswith(S) or path==R:raise AssertionError('upstream touched task path '+path)
    rule='upstream-main-content'
   elif c in sync:
    other=parts[2] if p==parts[1] else parts[1]
    expected=at(other,path)
    if path==M:rule='sync-manifest-defer-source-gate'
    elif path.startswith(S) or path==R:
     if new!=at(parts[1],path):raise AssertionError('sync task content changed '+path)
     rule='sync-preserves-task-content'
    else:
     if new!=at(parts[2],path):raise AssertionError('sync upstream content mismatch '+path)
     rule='sync-matches-main-content'
   elif path==R:
    if old is None or new is None or not all(any(x==y for y in it) for it in [iter(new)] for x in old):raise AssertionError('README preservation '+c)
    rule='README-old-byte-subsequence'
   elif path==M:
    a=json.loads(old); b=json.loads(new)
    keep=a['relations']; now=b['relations']
    if now[-len(keep):]!=keep or {k:v for k,v in a.items() if k!='relations'}!={k:v for k,v in b.items() if k!='relations'}:raise AssertionError('manifest history '+c)
    added=now[:-len(keep)]
    if not added:raise AssertionError('manifest no added lines '+c)
    for x in added:
     q=x['path']
     if x!={'owner_path':'packages/brain/scripts/coding-workflow/runner/run-once.mjs','path':q,'role':'documentation'} or not q.startswith(S) or not q.endswith('.md') or at(c,q) is None:raise AssertionError('manifest relation '+q)
    rule='manifest-prefix-add='+str(len(added))+' preserved='+str(len(keep))
   elif path.startswith(S):
    if path.endswith(('03-build.md','04-evidence.md')):
     rule='hidden-object-only'
    elif new is None:raise AssertionError('task report deleted '+path)
    else:
     rule=report_rule(path,new)
     if path.endswith('02-spec.md') and old is not None:
      if not new.startswith(old):raise AssertionError('spec not pure append '+c)
      tail=new[len(old):].decode()
      if c=='200baf82ef92f25d8b10031b52596b1e24fb70a7' and not tail.lstrip().startswith('## commander 裁决（第 1 次）'):raise AssertionError('first spec append')
      if c=='eb96ceb14f76a1572145644d5defc1fec6a49f1b' and not tail.lstrip().startswith('## commander 裁决（第 2 次）'):raise AssertionError('second spec append')
      rule+=' pure-append'
   else:raise AssertionError('unowned task change '+c+' '+path)
   print('PATH',path,oldmode,newmode,oldid,newid,'bytes',len(old) if old is not None else 0,len(new) if new is not None else 0,'hash=ok','content='+rule)
print('AUDIT_OK edges',sum(len(x)-1 for x in commits))
PY,name).group(1)
  if ('第 '+n+' 轮') not in s[:250] or not re.search(r'### T-\d+',s):raise AssertionError('QA exact round/cases '+path)
 if name.startswith('06-') and not ('裁决' in s or 'verdict' in s):raise AssertionError('judge decision '+path)
 if name.startswith('07-') and not ('裁决' in s or 'Commander' in s):raise AssertionError('commander decision '+path)
 return 'frontmatter/task/stage/body='+expected
lines=git('rev-list','--reverse','--topo-order','--parents',B+'..'+H).decode().splitlines()
commits=[x.split() for x in lines]
upstream=set()
for parts in commits:
 if len(parts)==3:
  second=parts[2]
  upstream.update(git('rev-list',B+'..'+second).decode().splitlines())
for parts in commits:
 c=parts[0]
 for p in parts[1:]:
  raw=git('diff','--no-ext-diff','--no-renames','--raw','--full-index','--abbrev=40',p,c,'--').decode().splitlines()
  print('EDGE',p,c,'changes',len(raw))
  for line in raw:
   meta,path=line.split('\t',1)
   fields=meta.split()
   oldmode,newmode,oldid,newid=fields[:4]
   for oid in (oldid,newid):
    if set(oid)!={'0'}:blob(oid)
   old=at(p,path) if set(oldid)!={'0'} else None
   new=at(c,path) if set(newid)!={'0'} else None
   if old is not None and hashlib.sha1(b'blob '+str(len(old)).encode()+b'\0'+old).hexdigest()!=oldid:raise AssertionError('old tree '+path)
   if new is not None and hashlib.sha1(b'blob '+str(len(new)).encode()+b'\0'+new).hexdigest()!=newid:raise AssertionError('new tree '+path)
   if c in upstream:
    if path.startswith(S) or path==R:raise AssertionError('upstream touched task path '+path)
    rule='upstream-main-content'
   elif c in sync:
    other=parts[2] if p==parts[1] else parts[1]
    expected=at(other,path)
    if path==M:rule='sync-manifest-defer-source-gate'
    elif path.startswith(S) or path==R:
     if new!=at(parts[1],path):raise AssertionError('sync task content changed '+path)
     rule='sync-preserves-task-content'
    else:
     if new!=at(parts[2],path):raise AssertionError('sync upstream content mismatch '+path)
     rule='sync-matches-main-content'
   elif path==R:
    if old is None or new is None or not all(any(x==y for y in it) for it in [iter(new)] for x in old):raise AssertionError('README preservation '+c)
    rule='README-old-byte-subsequence'
   elif path==M:
    a=json.loads(old); b=json.loads(new)
    keep=a['relations']; now=b['relations']
    if now[-len(keep):]!=keep or {k:v for k,v in a.items() if k!='relations'}!={k:v for k,v in b.items() if k!='relations'}:raise AssertionError('manifest history '+c)
    added=now[:-len(keep)]
    if not added:raise AssertionError('manifest no added lines '+c)
    for x in added:
     q=x['path']
     if x!={'owner_path':'packages/brain/scripts/coding-workflow/runner/run-once.mjs','path':q,'role':'documentation'} or not q.startswith(S) or not q.endswith('.md') or at(c,q) is None:raise AssertionError('manifest relation '+q)
    rule='manifest-prefix-add='+str(len(added))+' preserved='+str(len(keep))
   elif path.startswith(S):
    if path.endswith(('03-build.md','04-evidence.md')):
     rule='hidden-object-only'
    elif new is None:raise AssertionError('task report deleted '+path)
    else:
     rule=report_rule(path,new)
     if path.endswith('02-spec.md') and old is not None:
      if not new.startswith(old):raise AssertionError('spec not pure append '+c)
      tail=new[len(old):].decode()
      if c=='200baf82ef92f25d8b10031b52596b1e24fb70a7' and not tail.lstrip().startswith('## commander 裁决（第 1 次）'):raise AssertionError('first spec append')
      if c=='eb96ceb14f76a1572145644d5defc1fec6a49f1b' and not tail.lstrip().startswith('## commander 裁决（第 2 次）'):raise AssertionError('second spec append')
      rule+=' pure-append'
   else:raise AssertionError('unowned task change '+c+' '+path)
   print('PATH',path,oldmode,newmode,oldid,newid,'bytes',len(old) if old is not None else 0,len(new) if new is not None else 0,'hash=ok','content='+rule)
print('AUDIT_OK edges',sum(len(x)-1 for x in commits))
PY,path).group(1)
  if ('第 '+n+' 轮') not in s[:160] or '裁决' not in s or '问题' not in s:raise AssertionError('judge round/content '+path)
  return 'judge-exact-round/decision/issues'
 if '/07-commander-r' in path:
  if '裁决' not in s or len(s)<100:raise AssertionError('commander content '+path)
  return 'commander-round/case/decision'
 if '/02-response-r' in path:
  if not re.search(r'### R-\d+\n处理: (采纳|拒绝|部分采纳)',s):raise AssertionError('response decision '+path)
  if '说明:' not in s:raise AssertionError('response explanation '+path)
  return 'response-round/decision/explanation'
 if path.endswith('01-invariants.md'):
  if not s.startswith('# 铁律清单') or len(re.findall(r'^### INV-',s,re.M))<10:raise AssertionError('invariants content '+path)
  return 'invariants-headings-and-rules'
 if not s.startswith('---\n') or 'task_id: 5190fd91-d6c9-4247-850b-5700051a4830' not in s.split('---',2)[1]:raise AssertionError('report frontmatter '+path)
 name=path.split('/')[-1]
 expected='intent' if name.startswith('01-') else 'spec' if name=='02-spec.md' else 'spec_review' if name.startswith(('02-review','02-response')) else 'evaluate' if name.startswith('05-') else 'judge' if name.startswith('06-') else 'commander' if name.startswith('07-') else None
 if expected and ('step: '+expected) not in s.split('---',2)[1]: raise AssertionError('report stage '+path)
 if name.startswith('05-') and not re.search(r'### T-\d+',s):raise AssertionError('QA cases '+path)
 if name.startswith('06-') and not ('裁决' in s or 'verdict' in s):raise AssertionError('judge decision '+path)
 if name.startswith('07-') and not ('裁决' in s or 'Commander' in s):raise AssertionError('commander decision '+path)
 return 'frontmatter/task/stage/body='+expected
lines=git('rev-list','--reverse','--topo-order','--parents',B+'..'+H).decode().splitlines()
commits=[x.split() for x in lines]
upstream=set()
for parts in commits:
 if len(parts)==3:
  second=parts[2]
  upstream.update(git('rev-list',B+'..'+second).decode().splitlines())
for parts in commits:
 c=parts[0]
 for p in parts[1:]:
  raw=git('diff','--no-ext-diff','--no-renames','--raw','--full-index','--abbrev=40',p,c,'--').decode().splitlines()
  print('EDGE',p,c,'changes',len(raw))
  for line in raw:
   meta,path=line.split('\t',1)
   fields=meta.split()
   oldmode,newmode,oldid,newid=fields[:4]
   for oid in (oldid,newid):
    if set(oid)!={'0'}:blob(oid)
   old=at(p,path) if set(oldid)!={'0'} else None
   new=at(c,path) if set(newid)!={'0'} else None
   if old is not None and hashlib.sha1(b'blob '+str(len(old)).encode()+b'\0'+old).hexdigest()!=oldid:raise AssertionError('old tree '+path)
   if new is not None and hashlib.sha1(b'blob '+str(len(new)).encode()+b'\0'+new).hexdigest()!=newid:raise AssertionError('new tree '+path)
   if c in upstream:
    if path.startswith(S) or path==R:raise AssertionError('upstream touched task path '+path)
    rule='upstream-main-content'
   elif c in sync:
    other=parts[2] if p==parts[1] else parts[1]
    expected=at(other,path)
    if path==M:rule='sync-manifest-defer-source-gate'
    elif path.startswith(S) or path==R:
     if new!=at(parts[1],path):raise AssertionError('sync task content changed '+path)
     rule='sync-preserves-task-content'
    else:
     if new!=at(parts[2],path):raise AssertionError('sync upstream content mismatch '+path)
     rule='sync-matches-main-content'
   elif path==R:
    if old is None or new is None or not all(any(x==y for y in it) for it in [iter(new)] for x in old):raise AssertionError('README preservation '+c)
    rule='README-old-byte-subsequence'
   elif path==M:
    a=json.loads(old); b=json.loads(new)
    keep=a['relations']; now=b['relations']
    if now[-len(keep):]!=keep or {k:v for k,v in a.items() if k!='relations'}!={k:v for k,v in b.items() if k!='relations'}:raise AssertionError('manifest history '+c)
    added=now[:-len(keep)]
    if not added:raise AssertionError('manifest no added lines '+c)
    for x in added:
     q=x['path']
     if x!={'owner_path':'packages/brain/scripts/coding-workflow/runner/run-once.mjs','path':q,'role':'documentation'} or not q.startswith(S) or not q.endswith('.md') or at(c,q) is None:raise AssertionError('manifest relation '+q)
    rule='manifest-prefix-add='+str(len(added))+' preserved='+str(len(keep))
   elif path.startswith(S):
    if path.endswith(('03-build.md','04-evidence.md')):
     rule='hidden-object-only'
    elif new is None:raise AssertionError('task report deleted '+path)
    else:
     rule=report_rule(path,new)
     if path.endswith('02-spec.md') and old is not None:
      if not new.startswith(old):raise AssertionError('spec not pure append '+c)
      tail=new[len(old):].decode()
      if c=='200baf82ef92f25d8b10031b52596b1e24fb70a7' and not tail.lstrip().startswith('## commander 裁决（第 1 次）'):raise AssertionError('first spec append')
      if c=='eb96ceb14f76a1572145644d5defc1fec6a49f1b' and not tail.lstrip().startswith('## commander 裁决（第 2 次）'):raise AssertionError('second spec append')
      rule+=' pure-append'
   else:raise AssertionError('unowned task change '+c+' '+path)
   print('PATH',path,oldmode,newmode,oldid,newid,'bytes',len(old) if old is not None else 0,len(new) if new is not None else 0,'hash=ok','content='+rule)
print('AUDIT_OK edges',sum(len(x)-1 for x in commits))
PY,path).group(1)
  if ('第 '+n+' 次') not in s[:160] or '裁决' not in s:raise AssertionError('commander round/content '+path)
  return 'commander-exact-round/decision'
 if '/02-response-r' in path:
  if not re.search(r'### R-\d+\n处理: (采纳|拒绝|部分采纳)',s):raise AssertionError('response decision '+path)
  if '说明:' not in s:raise AssertionError('response explanation '+path)
  return 'response-round/decision/explanation'
 if path.endswith('01-invariants.md'):
  if not s.startswith('# 铁律清单') or len(re.findall(r'^### INV-',s,re.M))<10:raise AssertionError('invariants content '+path)
  return 'invariants-headings-and-rules'
 if not s.startswith('---\n') or 'task_id: 5190fd91-d6c9-4247-850b-5700051a4830' not in s.split('---',2)[1]:raise AssertionError('report frontmatter '+path)
 name=path.split('/')[-1]
 expected='intent' if name.startswith('01-') else 'spec' if name=='02-spec.md' else 'spec_review' if name.startswith(('02-review','02-response')) else 'evaluate' if name.startswith('05-') else 'judge' if name.startswith('06-') else 'commander' if name.startswith('07-') else None
 if expected and ('step: '+expected) not in s.split('---',2)[1]: raise AssertionError('report stage '+path)
 if name.startswith('05-') and not re.search(r'### T-\d+',s):raise AssertionError('QA cases '+path)
 if name.startswith('06-') and not ('裁决' in s or 'verdict' in s):raise AssertionError('judge decision '+path)
 if name.startswith('07-') and not ('裁决' in s or 'Commander' in s):raise AssertionError('commander decision '+path)
 return 'frontmatter/task/stage/body='+expected
lines=git('rev-list','--reverse','--topo-order','--parents',B+'..'+H).decode().splitlines()
commits=[x.split() for x in lines]
upstream=set()
for parts in commits:
 if len(parts)==3:
  second=parts[2]
  upstream.update(git('rev-list',B+'..'+second).decode().splitlines())
for parts in commits:
 c=parts[0]
 for p in parts[1:]:
  raw=git('diff','--no-ext-diff','--no-renames','--raw','--full-index','--abbrev=40',p,c,'--').decode().splitlines()
  print('EDGE',p,c,'changes',len(raw))
  for line in raw:
   meta,path=line.split('\t',1)
   fields=meta.split()
   oldmode,newmode,oldid,newid=fields[:4]
   for oid in (oldid,newid):
    if set(oid)!={'0'}:blob(oid)
   old=at(p,path) if set(oldid)!={'0'} else None
   new=at(c,path) if set(newid)!={'0'} else None
   if old is not None and hashlib.sha1(b'blob '+str(len(old)).encode()+b'\0'+old).hexdigest()!=oldid:raise AssertionError('old tree '+path)
   if new is not None and hashlib.sha1(b'blob '+str(len(new)).encode()+b'\0'+new).hexdigest()!=newid:raise AssertionError('new tree '+path)
   if c in upstream:
    if path.startswith(S) or path==R:raise AssertionError('upstream touched task path '+path)
    rule='upstream-main-content'
   elif c in sync:
    other=parts[2] if p==parts[1] else parts[1]
    expected=at(other,path)
    if path==M:rule='sync-manifest-defer-source-gate'
    elif path.startswith(S) or path==R:
     if new!=at(parts[1],path):raise AssertionError('sync task content changed '+path)
     rule='sync-preserves-task-content'
    else:
     if new!=at(parts[2],path):raise AssertionError('sync upstream content mismatch '+path)
     rule='sync-matches-main-content'
   elif path==R:
    if old is None or new is None or not all(any(x==y for y in it) for it in [iter(new)] for x in old):raise AssertionError('README preservation '+c)
    rule='README-old-byte-subsequence'
   elif path==M:
    a=json.loads(old); b=json.loads(new)
    keep=a['relations']; now=b['relations']
    if now[-len(keep):]!=keep or {k:v for k,v in a.items() if k!='relations'}!={k:v for k,v in b.items() if k!='relations'}:raise AssertionError('manifest history '+c)
    added=now[:-len(keep)]
    if not added:raise AssertionError('manifest no added lines '+c)
    for x in added:
     q=x['path']
     if x!={'owner_path':'packages/brain/scripts/coding-workflow/runner/run-once.mjs','path':q,'role':'documentation'} or not q.startswith(S) or not q.endswith('.md') or at(c,q) is None:raise AssertionError('manifest relation '+q)
    rule='manifest-prefix-add='+str(len(added))+' preserved='+str(len(keep))
   elif path.startswith(S):
    if path.endswith(('03-build.md','04-evidence.md')):
     rule='hidden-object-only'
    elif new is None:raise AssertionError('task report deleted '+path)
    else:
     rule=report_rule(path,new)
     if path.endswith('02-spec.md') and old is not None:
      if not new.startswith(old):raise AssertionError('spec not pure append '+c)
      tail=new[len(old):].decode()
      if c=='200baf82ef92f25d8b10031b52596b1e24fb70a7' and not tail.lstrip().startswith('## commander 裁决（第 1 次）'):raise AssertionError('first spec append')
      if c=='eb96ceb14f76a1572145644d5defc1fec6a49f1b' and not tail.lstrip().startswith('## commander 裁决（第 2 次）'):raise AssertionError('second spec append')
      rule+=' pure-append'
   else:raise AssertionError('unowned task change '+c+' '+path)
   print('PATH',path,oldmode,newmode,oldid,newid,'bytes',len(old) if old is not None else 0,len(new) if new is not None else 0,'hash=ok','content='+rule)
print('AUDIT_OK edges',sum(len(x)-1 for x in commits))
PY,path).group(1)
  if ('第 '+n+' 轮') not in s[:160] or '裁决' not in s or '问题' not in s:raise AssertionError('judge round/content '+path)
  return 'judge-exact-round/decision/issues'
 if '/07-commander-r' in path:
  if '裁决' not in s or len(s)<100:raise AssertionError('commander content '+path)
  return 'commander-round/case/decision'
 if '/02-response-r' in path:
  if not re.search(r'### R-\d+\n处理: (采纳|拒绝|部分采纳)',s):raise AssertionError('response decision '+path)
  if '说明:' not in s:raise AssertionError('response explanation '+path)
  return 'response-round/decision/explanation'
 if path.endswith('01-invariants.md'):
  if not s.startswith('# 铁律清单') or len(re.findall(r'^### INV-',s,re.M))<10:raise AssertionError('invariants content '+path)
  return 'invariants-headings-and-rules'
 if not s.startswith('---\n') or 'task_id: 5190fd91-d6c9-4247-850b-5700051a4830' not in s.split('---',2)[1]:raise AssertionError('report frontmatter '+path)
 name=path.split('/')[-1]
 expected='intent' if name.startswith('01-') else 'spec' if name=='02-spec.md' else 'spec_review' if name.startswith(('02-review','02-response')) else 'evaluate' if name.startswith('05-') else 'judge' if name.startswith('06-') else 'commander' if name.startswith('07-') else None
 if expected and ('step: '+expected) not in s.split('---',2)[1]: raise AssertionError('report stage '+path)
 if name.startswith('05-') and not re.search(r'### T-\d+',s):raise AssertionError('QA cases '+path)
 if name.startswith('06-') and not ('裁决' in s or 'verdict' in s):raise AssertionError('judge decision '+path)
 if name.startswith('07-') and not ('裁决' in s or 'Commander' in s):raise AssertionError('commander decision '+path)
 return 'frontmatter/task/stage/body='+expected
lines=git('rev-list','--reverse','--topo-order','--parents',B+'..'+H).decode().splitlines()
commits=[x.split() for x in lines]
upstream=set()
for parts in commits:
 if len(parts)==3:
  second=parts[2]
  upstream.update(git('rev-list',B+'..'+second).decode().splitlines())
for parts in commits:
 c=parts[0]
 for p in parts[1:]:
  raw=git('diff','--no-ext-diff','--no-renames','--raw','--full-index','--abbrev=40',p,c,'--').decode().splitlines()
  print('EDGE',p,c,'changes',len(raw))
  for line in raw:
   meta,path=line.split('\t',1)
   fields=meta.split()
   oldmode,newmode,oldid,newid=fields[:4]
   for oid in (oldid,newid):
    if set(oid)!={'0'}:blob(oid)
   old=at(p,path) if set(oldid)!={'0'} else None
   new=at(c,path) if set(newid)!={'0'} else None
   if old is not None and hashlib.sha1(b'blob '+str(len(old)).encode()+b'\0'+old).hexdigest()!=oldid:raise AssertionError('old tree '+path)
   if new is not None and hashlib.sha1(b'blob '+str(len(new)).encode()+b'\0'+new).hexdigest()!=newid:raise AssertionError('new tree '+path)
   if c in upstream:
    if path.startswith(S) or path==R:raise AssertionError('upstream touched task path '+path)
    rule='upstream-main-content'
   elif c in sync:
    other=parts[2] if p==parts[1] else parts[1]
    expected=at(other,path)
    if path==M:rule='sync-manifest-defer-source-gate'
    elif path.startswith(S) or path==R:
     if new!=at(parts[1],path):raise AssertionError('sync task content changed '+path)
     rule='sync-preserves-task-content'
    else:
     if new!=at(parts[2],path):raise AssertionError('sync upstream content mismatch '+path)
     rule='sync-matches-main-content'
   elif path==R:
    if old is None or new is None or not all(any(x==y for y in it) for it in [iter(new)] for x in old):raise AssertionError('README preservation '+c)
    rule='README-old-byte-subsequence'
   elif path==M:
    a=json.loads(old); b=json.loads(new)
    keep=a['relations']; now=b['relations']
    if now[-len(keep):]!=keep or {k:v for k,v in a.items() if k!='relations'}!={k:v for k,v in b.items() if k!='relations'}:raise AssertionError('manifest history '+c)
    added=now[:-len(keep)]
    if not added:raise AssertionError('manifest no added lines '+c)
    for x in added:
     q=x['path']
     if x!={'owner_path':'packages/brain/scripts/coding-workflow/runner/run-once.mjs','path':q,'role':'documentation'} or not q.startswith(S) or not q.endswith('.md') or at(c,q) is None:raise AssertionError('manifest relation '+q)
    rule='manifest-prefix-add='+str(len(added))+' preserved='+str(len(keep))
   elif path.startswith(S):
    if path.endswith(('03-build.md','04-evidence.md')):
     rule='hidden-object-only'
    elif new is None:raise AssertionError('task report deleted '+path)
    else:
     rule=report_rule(path,new)
     if path.endswith('02-spec.md') and old is not None:
      if not new.startswith(old):raise AssertionError('spec not pure append '+c)
      tail=new[len(old):].decode()
      if c=='200baf82ef92f25d8b10031b52596b1e24fb70a7' and not tail.lstrip().startswith('## commander 裁决（第 1 次）'):raise AssertionError('first spec append')
      if c=='eb96ceb14f76a1572145644d5defc1fec6a49f1b' and not tail.lstrip().startswith('## commander 裁决（第 2 次）'):raise AssertionError('second spec append')
      rule+=' pure-append'
   else:raise AssertionError('unowned task change '+c+' '+path)
   print('PATH',path,oldmode,newmode,oldid,newid,'bytes',len(old) if old is not None else 0,len(new) if new is not None else 0,'hash=ok','content='+rule)
print('AUDIT_OK edges',sum(len(x)-1 for x in commits))
PY
```
```output
  File "<stdin>", line 23
    n=re.search(r'06-judge-r(\d+)\.md
                ^
SyntaxError: unterminated string literal (detected at line 23)
```
退出码: 1

### q4audit12
```command
python3 - <<'PY'
import subprocess,hashlib,json,re,sys
B='04b88ddba4b1aa23a156d59734b4d88f621fe1e9'
S='sprints/10170627-cw-5190fd91/'
H='e155382a75885815d9cd838670df39cbb3ed9447'
R='packages/brain/scripts/coding-workflow/runner/README.md'
M='.implementation-source-relations.json'
sync={'f9460639ab0b5e2cd7b05f4f109db13a51b64f01','db16f7475971decc1b832eec7a9d952bbdf2766f','73b660f6cc3e206926fbc64e572868f23d361ac4','e155382a75885815d9cd838670df39cbb3ed9447'}
def git(*a):
 p=subprocess.run(['git',*a],stdout=subprocess.PIPE,stderr=subprocess.PIPE)
 if p.returncode: raise RuntimeError('git '+str(a)+' '+p.stderr.decode(errors='replace'))
 return p.stdout
def blob(oid):
 b=git('cat-file','blob',oid)
 v=hashlib.sha1(b'blob '+str(len(b)).encode()+b'\0'+b).hexdigest()
 if v!=oid or int(git('cat-file','-s',oid))!=len(b): raise AssertionError('blob mismatch '+oid)
 return b
def at(commit,path):
 try:return git('show',commit+':'+path)
 except RuntimeError:return None
def report_rule(path,data):
 s=data.decode('utf8')
 if '/06-judge-r' in path:
  n=path.split('-r')[-1].split('.')[0]
  if ('第 '+n+' 轮') not in s[:160] or '裁决' not in s or '问题' not in s:raise AssertionError('judge round/content '+path)
  return 'judge-exact-round/decision/issues'
 if '/07-commander-r' in path:
  n=path.split('-r')[-1].split('.')[0]
  if ('第 '+n+' 次') not in s[:160] or '裁决' not in s:raise AssertionError('commander round/content '+path)
  return 'commander-exact-round/decision'
 if '/02-response-r' in path:
  if not re.search(r'### R-\d+\n处理: (采纳|拒绝|部分采纳)',s):raise AssertionError('response decision '+path)
  if '说明:' not in s:raise AssertionError('response explanation '+path)
  return 'response-round/decision/explanation'
 if path.endswith('01-invariants.md'):
  if not s.startswith('# 铁律清单') or len(re.findall(r'^### INV-',s,re.M))<10:raise AssertionError('invariants content '+path)
  return 'invariants-headings-and-rules'
 if not s.startswith('---\n') or 'task_id: 5190fd91-d6c9-4247-850b-5700051a4830' not in s.split('---',2)[1]:raise AssertionError('report frontmatter '+path)
 name=path.split('/')[-1]
 expected='intent' if name.startswith('01-') else 'spec' if name=='02-spec.md' else 'spec_review' if name.startswith(('02-review','02-response')) else 'evaluate' if name.startswith('05-') else 'judge' if name.startswith('06-') else 'commander' if name.startswith('07-') else None
 if expected and ('step: '+expected) not in s.split('---',2)[1]: raise AssertionError('report stage '+path)
 if name.startswith('05-'):
  n=name.split('-r')[-1].split('.')[0]
  if ('第 '+n+' 轮') not in s[:250] or not re.search(r'### T-\d+',s):raise AssertionError('QA exact round/cases '+path)
 if name.startswith('06-') and not ('裁决' in s or 'verdict' in s):raise AssertionError('judge decision '+path)
 if name.startswith('07-') and not ('裁决' in s or 'Commander' in s):raise AssertionError('commander decision '+path)
 return 'frontmatter/task/stage/body='+expected
lines=git('rev-list','--reverse','--topo-order','--parents',B+'..'+H).decode().splitlines()
commits=[x.split() for x in lines]
upstream=set()
for parts in commits:
 if len(parts)==3:
  second=parts[2]
  upstream.update(git('rev-list',B+'..'+second).decode().splitlines())
for parts in commits:
 c=parts[0]
 for p in parts[1:]:
  raw=git('diff','--no-ext-diff','--no-renames','--raw','--full-index','--abbrev=40',p,c,'--').decode().splitlines()
  print('EDGE',p,c,'changes',len(raw))
  for line in raw:
   meta,path=line.split('\t',1)
   fields=meta.split()
   oldmode,newmode,oldid,newid=fields[:4]
   for oid in (oldid,newid):
    if set(oid)!={'0'}:blob(oid)
   old=at(p,path) if set(oldid)!={'0'} else None
   new=at(c,path) if set(newid)!={'0'} else None
   if old is not None and hashlib.sha1(b'blob '+str(len(old)).encode()+b'\0'+old).hexdigest()!=oldid:raise AssertionError('old tree '+path)
   if new is not None and hashlib.sha1(b'blob '+str(len(new)).encode()+b'\0'+new).hexdigest()!=newid:raise AssertionError('new tree '+path)
   if c in upstream:
    if path.startswith(S) or path==R:raise AssertionError('upstream touched task path '+path)
    rule='upstream-main-content'
   elif c in sync:
    other=parts[2] if p==parts[1] else parts[1]
    expected=at(other,path)
    if path==M:rule='sync-manifest-defer-source-gate'
    elif path.startswith(S) or path==R:
     if new!=at(parts[1],path):raise AssertionError('sync task content changed '+path)
     rule='sync-preserves-task-content'
    else:
     if new!=at(parts[2],path):raise AssertionError('sync upstream content mismatch '+path)
     rule='sync-matches-main-content'
   elif path==R:
    if old is None or new is None or not all(any(x==y for y in it) for it in [iter(new)] for x in old):raise AssertionError('README preservation '+c)
    rule='README-old-byte-subsequence'
   elif path==M:
    a=json.loads(old); b=json.loads(new)
    keep=a['relations']; now=b['relations']
    if now[-len(keep):]!=keep or {k:v for k,v in a.items() if k!='relations'}!={k:v for k,v in b.items() if k!='relations'}:raise AssertionError('manifest history '+c)
    added=now[:-len(keep)]
    if not added:raise AssertionError('manifest no added lines '+c)
    for x in added:
     q=x['path']
     if x!={'owner_path':'packages/brain/scripts/coding-workflow/runner/run-once.mjs','path':q,'role':'documentation'} or not q.startswith(S) or not q.endswith('.md') or at(c,q) is None:raise AssertionError('manifest relation '+q)
    rule='manifest-prefix-add='+str(len(added))+' preserved='+str(len(keep))
   elif path.startswith(S):
    if path.endswith(('03-build.md','04-evidence.md')):
     rule='hidden-object-only'
    elif new is None:raise AssertionError('task report deleted '+path)
    else:
     rule=report_rule(path,new)
     if path.endswith('02-spec.md') and old is not None:
      if not new.startswith(old):raise AssertionError('spec not pure append '+c)
      tail=new[len(old):].decode()
      if c=='200baf82ef92f25d8b10031b52596b1e24fb70a7' and not tail.lstrip().startswith('## commander 裁决（第 1 次）'):raise AssertionError('first spec append')
      if c=='eb96ceb14f76a1572145644d5defc1fec6a49f1b' and not tail.lstrip().startswith('## commander 裁决（第 2 次）'):raise AssertionError('second spec append')
      rule+=' pure-append'
   else:raise AssertionError('unowned task change '+c+' '+path)
   print('PATH',path,oldmode,newmode,oldid,newid,'bytes',len(old) if old is not None else 0,len(new) if new is not None else 0,'hash=ok','content='+rule)
print('AUDIT_OK edges',sum(len(x)-1 for x in commits))
PY
```
```output
EDGE 04b88ddba4b1aa23a156d59734b4d88f621fe1e9 178f61849d85be5a9370f23c033e48ae006cfe25 changes 1
PATH packages/brain/scripts/coding-workflow/runner/README.md :100644 100644 6e6eb65f64c55bdad786b619e2e9a4ef66225297 3e8eea166d021b985bff0c71e1ccbc87d234d248 bytes 10889 13572 hash=ok content=README-old-byte-subsequence
EDGE 178f61849d85be5a9370f23c033e48ae006cfe25 42943dfe5fc3f0680291322a5440bcd46159cbeb changes 12
PATH .implementation-source-relations.json :100644 100644 b4d00c4f7ea1c087ce0511769e1e25299326cbfd 24de93e0438b1c2a800654e7e0407b2949ef5233 bytes 54286 56013 hash=ok content=manifest-prefix-add=11 preserved=307
PATH sprints/10170627-cw-5190fd91/01-intent.md :000000 100644 0000000000000000000000000000000000000000 3a1529d7a143b6fdcf1305b9d72480c22c4d3a8c bytes 0 15486 hash=ok content=frontmatter/task/stage/body=intent
PATH sprints/10170627-cw-5190fd91/01-invariants.md :000000 100644 0000000000000000000000000000000000000000 2276b9f0bca1d5fd3e422ef6e962e1259e266703 bytes 0 89736 hash=ok content=invariants-headings-and-rules
PATH sprints/10170627-cw-5190fd91/02-response-r1.md :000000 100644 0000000000000000000000000000000000000000 f89998664a7a99d3f8bfc0b8b4f0ac0955c8b83a bytes 0 589 hash=ok content=response-round/decision/explanation
PATH sprints/10170627-cw-5190fd91/02-response-r2.md :000000 100644 0000000000000000000000000000000000000000 677402ca401d014befa03669d7b1a1aa04a917b2 bytes 0 1084 hash=ok content=response-round/decision/explanation
PATH sprints/10170627-cw-5190fd91/02-review-r1.md :000000 100644 0000000000000000000000000000000000000000 8b068bd99a4c2f5abc189032698f21ad8e267be6 bytes 0 1223 hash=ok content=frontmatter/task/stage/body=spec_review
PATH sprints/10170627-cw-5190fd91/02-review-r2.md :000000 100644 0000000000000000000000000000000000000000 7c80b836bc8c5469525c21273be83ad0e8dde8fc bytes 0 1436 hash=ok content=frontmatter/task/stage/body=spec_review
PATH sprints/10170627-cw-5190fd91/02-review-r3.md :000000 100644 0000000000000000000000000000000000000000 e6922e12ac037d6b2ac8839985f3434b9d4f48e5 bytes 0 1113 hash=ok content=frontmatter/task/stage/body=spec_review
PATH sprints/10170627-cw-5190fd91/02-review.md :000000 100644 0000000000000000000000000000000000000000 e6922e12ac037d6b2ac8839985f3434b9d4f48e5 bytes 0 1113 hash=ok content=frontmatter/task/stage/body=spec_review
PATH sprints/10170627-cw-5190fd91/02-spec.md :000000 100644 0000000000000000000000000000000000000000 9827a68e93e8e7d2b0c21dcb517cb6c6848e2093 bytes 0 18898 hash=ok content=frontmatter/task/stage/body=spec
PATH sprints/10170627-cw-5190fd91/03-build.md :000000 100644 0000000000000000000000000000000000000000 0d96f563734111cfdcd2049a91b8d0973da5adff bytes 0 5095 hash=ok content=hidden-object-only
PATH sprints/10170627-cw-5190fd91/04-evidence.md :000000 100644 0000000000000000000000000000000000000000 46a81734ed6702902319dcbe09f211bf692b0f88 bytes 0 9894 hash=ok content=hidden-object-only
EDGE 04b88ddba4b1aa23a156d59734b4d88f621fe1e9 53cdf746c0c7f446cb7b6987e170d76248999f1d changes 8
PATH .brain-versions :100644 100644 765a3cb613f52cc52b92c04158a540cbe7fba43d f3d261425e53f40ece495da8192f24c6040c909d bytes 9 9 hash=ok content=upstream-main-content
PATH .implementation-source-relations.json :100644 100644 b4d00c4f7ea1c087ce0511769e1e25299326cbfd ffadfb9335a468ec6b871f54fd9a6db08ae9e09d bytes 54286 54140 hash=ok content=upstream-main-content
PATH DEFINITION.md :100644 100644 c61152020942f82f1de6315cb58dda302a1e92cc a4b46caf2f7230368a87796071009b8b35fcc44b bytes 769540 770019 hash=ok content=upstream-main-content
PATH changes/cp-10170325-ci-budget-headroom.md :100644 000000 61678453253490efe1e7e647f808ac43965eaac1 0000000000000000000000000000000000000000 bytes 479 0 hash=ok content=upstream-main-content
PATH package-lock.json :100644 100644 f6a79a39a78356e1a59b763567ac45af92e79f5b aaeb525fdffb110004342b8c6b4f96893d362179 bytes 698744 698744 hash=ok content=upstream-main-content
PATH packages/brain/VERSION :100644 100644 765a3cb613f52cc52b92c04158a540cbe7fba43d f3d261425e53f40ece495da8192f24c6040c909d bytes 9 9 hash=ok content=upstream-main-content
PATH packages/brain/package-lock.json :100644 100644 bd0894471f6609afd0506fb31cabb315e8a97b25 ecb84839f8de085394f8aa50dd5f0100b1e99465 bytes 378833 378833 hash=ok content=upstream-main-content
PATH packages/brain/package.json :100644 100644 5451dac0247ba38ee91ec7441f0ef79426ad37b5 b6a3c1c890593a7bc828afa573a4ccaff05ab2c0 bytes 1998 1998 hash=ok content=upstream-main-content
EDGE 42943dfe5fc3f0680291322a5440bcd46159cbeb f9460639ab0b5e2cd7b05f4f109db13a51b64f01 changes 8
PATH .brain-versions :100644 100644 765a3cb613f52cc52b92c04158a540cbe7fba43d f3d261425e53f40ece495da8192f24c6040c909d bytes 9 9 hash=ok content=sync-matches-main-content
PATH .implementation-source-relations.json :100644 100644 24de93e0438b1c2a800654e7e0407b2949ef5233 c4f2bb176e606551a32bf9a676b77ea69452efc4 bytes 56013 55867 hash=ok content=sync-manifest-defer-source-gate
PATH DEFINITION.md :100644 100644 c61152020942f82f1de6315cb58dda302a1e92cc a4b46caf2f7230368a87796071009b8b35fcc44b bytes 769540 770019 hash=ok content=sync-matches-main-content
PATH changes/cp-10170325-ci-budget-headroom.md :100644 000000 61678453253490efe1e7e647f808ac43965eaac1 0000000000000000000000000000000000000000 bytes 479 0 hash=ok content=sync-matches-main-content
PATH package-lock.json :100644 100644 f6a79a39a78356e1a59b763567ac45af92e79f5b aaeb525fdffb110004342b8c6b4f96893d362179 bytes 698744 698744 hash=ok content=sync-matches-main-content
PATH packages/brain/VERSION :100644 100644 765a3cb613f52cc52b92c04158a540cbe7fba43d f3d261425e53f40ece495da8192f24c6040c909d bytes 9 9 hash=ok content=sync-matches-main-content
PATH packages/brain/package-lock.json :100644 100644 bd0894471f6609afd0506fb31cabb315e8a97b25 ecb84839f8de085394f8aa50dd5f0100b1e99465 bytes 378833 378833 hash=ok content=sync-matches-main-content
PATH packages/brain/package.json :100644 100644 5451dac0247ba38ee91ec7441f0ef79426ad37b5 b6a3c1c890593a7bc828afa573a4ccaff05ab2c0 bytes 1998 1998 hash=ok content=sync-matches-main-content
EDGE 53cdf746c0c7f446cb7b6987e170d76248999f1d f9460639ab0b5e2cd7b05f4f109db13a51b64f01 changes 13
PATH .implementation-source-relations.json :100644 100644 ffadfb9335a468ec6b871f54fd9a6db08ae9e09d c4f2bb176e606551a32bf9a676b77ea69452efc4 bytes 54140 55867 hash=ok content=sync-manifest-defer-source-gate
PATH packages/brain/scripts/coding-workflow/runner/README.md :100644 100644 6e6eb65f64c55bdad786b619e2e9a4ef66225297 3e8eea166d021b985bff0c71e1ccbc87d234d248 bytes 10889 13572 hash=ok content=sync-preserves-task-content
PATH sprints/10170627-cw-5190fd91/01-intent.md :000000 100644 0000000000000000000000000000000000000000 3a1529d7a143b6fdcf1305b9d72480c22c4d3a8c bytes 0 15486 hash=ok content=sync-preserves-task-content
PATH sprints/10170627-cw-5190fd91/01-invariants.md :000000 100644 0000000000000000000000000000000000000000 2276b9f0bca1d5fd3e422ef6e962e1259e266703 bytes 0 89736 hash=ok content=sync-preserves-task-content
PATH sprints/10170627-cw-5190fd91/02-response-r1.md :000000 100644 0000000000000000000000000000000000000000 f89998664a7a99d3f8bfc0b8b4f0ac0955c8b83a bytes 0 589 hash=ok content=sync-preserves-task-content
PATH sprints/10170627-cw-5190fd91/02-response-r2.md :000000 100644 0000000000000000000000000000000000000000 677402ca401d014befa03669d7b1a1aa04a917b2 bytes 0 1084 hash=ok content=sync-preserves-task-content
PATH sprints/10170627-cw-5190fd91/02-review-r1.md :000000 100644 0000000000000000000000000000000000000000 8b068bd99a4c2f5abc189032698f21ad8e267be6 bytes 0 1223 hash=ok content=sync-preserves-task-content
PATH sprints/10170627-cw-5190fd91/02-review-r2.md :000000 100644 0000000000000000000000000000000000000000 7c80b836bc8c5469525c21273be83ad0e8dde8fc bytes 0 1436 hash=ok content=sync-preserves-task-content
PATH sprints/10170627-cw-5190fd91/02-review-r3.md :000000 100644 0000000000000000000000000000000000000000 e6922e12ac037d6b2ac8839985f3434b9d4f48e5 bytes 0 1113 hash=ok content=sync-preserves-task-content
PATH sprints/10170627-cw-5190fd91/02-review.md :000000 100644 0000000000000000000000000000000000000000 e6922e12ac037d6b2ac8839985f3434b9d4f48e5 bytes 0 1113 hash=ok content=sync-preserves-task-content
PATH sprints/10170627-cw-5190fd91/02-spec.md :000000 100644 0000000000000000000000000000000000000000 9827a68e93e8e7d2b0c21dcb517cb6c6848e2093 bytes 0 18898 hash=ok content=sync-preserves-task-content
PATH sprints/10170627-cw-5190fd91/03-build.md :000000 100644 0000000000000000000000000000000000000000 0d96f563734111cfdcd2049a91b8d0973da5adff bytes 0 5095 hash=ok content=sync-preserves-task-content
PATH sprints/10170627-cw-5190fd91/04-evidence.md :000000 100644 0000000000000000000000000000000000000000 46a81734ed6702902319dcbe09f211bf692b0f88 bytes 0 9894 hash=ok content=sync-preserves-task-content
EDGE f9460639ab0b5e2cd7b05f4f109db13a51b64f01 f3dbd423fab3eddea650ac361d4651f393cfd40f changes 2
PATH .implementation-source-relations.json :100644 100644 c4f2bb176e606551a32bf9a676b77ea69452efc4 f3d532f650f678b481fb7125e80f72231bf50d2e bytes 55867 56028 hash=ok content=manifest-prefix-add=1 preserved=317
PATH sprints/10170627-cw-5190fd91/05-qa-report-r1.md :000000 100644 0000000000000000000000000000000000000000 766cc68f7f0cb7bd81da2711b7eb920992f04c05 bytes 0 19119 hash=ok content=frontmatter/task/stage/body=evaluate
EDGE f3dbd423fab3eddea650ac361d4651f393cfd40f 200baf82ef92f25d8b10031b52596b1e24fb70a7 changes 1
PATH sprints/10170627-cw-5190fd91/02-spec.md :100644 100644 9827a68e93e8e7d2b0c21dcb517cb6c6848e2093 51450ee5ebc6651ffd41d88a24e283dafa5ca9ae bytes 18898 21682 hash=ok content=frontmatter/task/stage/body=spec pure-append
EDGE 200baf82ef92f25d8b10031b52596b1e24fb70a7 ea0573f2d1e2a95f5cb7727a70c581d325b1fd21 changes 2
PATH .implementation-source-relations.json :100644 100644 f3d532f650f678b481fb7125e80f72231bf50d2e f0d372e0cb26eb55d12f9def947b73c081b8f963 bytes 56028 56189 hash=ok content=manifest-prefix-add=1 preserved=318
PATH sprints/10170627-cw-5190fd91/07-commander-r1.md :000000 100644 0000000000000000000000000000000000000000 fc178a6a802a0410e83cdf2c9c03233f8206bb1c bytes 0 876 hash=ok content=commander-exact-round/decision
EDGE ea0573f2d1e2a95f5cb7727a70c581d325b1fd21 8fa7a1c035bd76335c99fe71ed7450d5832b49e8 changes 3
PATH .implementation-source-relations.json :100644 100644 f0d372e0cb26eb55d12f9def947b73c081b8f963 eab6aa5c1fbf307fe497d8450d3b9837ecb6977b bytes 56189 56507 hash=ok content=manifest-prefix-add=2 preserved=319
PATH sprints/10170627-cw-5190fd91/05-qa-report-r2.md :000000 100644 0000000000000000000000000000000000000000 05e0b0b9c9bb8608cbceed644e7c8b9e8243aeee bytes 0 49562 hash=ok content=frontmatter/task/stage/body=evaluate
PATH sprints/10170627-cw-5190fd91/06-judge-r2.md :000000 100644 0000000000000000000000000000000000000000 51c02fb04eab523db35539b6572f2fd7d5a87fc4 bytes 0 2629 hash=ok content=judge-exact-round/decision/issues
EDGE 8fa7a1c035bd76335c99fe71ed7450d5832b49e8 a36edb98dcf000ff653236e7674cac6117e30652 changes 3
PATH .implementation-source-relations.json :100644 100644 eab6aa5c1fbf307fe497d8450d3b9837ecb6977b 4d1cf2084a034d37f44b2893f054eada20711b7b bytes 56507 56825 hash=ok content=manifest-prefix-add=2 preserved=321
PATH sprints/10170627-cw-5190fd91/05-qa-report-r3.md :000000 100644 0000000000000000000000000000000000000000 80d07eb72ebecb771c35ecc1222d36943b5ee8cf bytes 0 31961 hash=ok content=frontmatter/task/stage/body=evaluate
PATH sprints/10170627-cw-5190fd91/06-judge-r3.md :000000 100644 0000000000000000000000000000000000000000 19cf8a90460a19162ad5658eed7a52afbca7b245 bytes 0 2604 hash=ok content=judge-exact-round/decision/issues
EDGE a36edb98dcf000ff653236e7674cac6117e30652 eb96ceb14f76a1572145644d5defc1fec6a49f1b changes 1
PATH sprints/10170627-cw-5190fd91/02-spec.md :100644 100644 51450ee5ebc6651ffd41d88a24e283dafa5ca9ae ac6a959af50bb4cc8c451ec9a63fb8b40249f55a bytes 21682 24118 hash=ok content=frontmatter/task/stage/body=spec pure-append
EDGE eb96ceb14f76a1572145644d5defc1fec6a49f1b 6e0b4202c1b659de1bf99ad62d42c73d09dca6bc changes 2
PATH .implementation-source-relations.json :100644 100644 4d1cf2084a034d37f44b2893f054eada20711b7b c310edb1cf5a2cec343b63b1f6880d644b14bb9e bytes 56825 56986 hash=ok content=manifest-prefix-add=1 preserved=323
PATH sprints/10170627-cw-5190fd91/07-commander-r2.md :000000 100644 0000000000000000000000000000000000000000 8557e2041e46ac98747c39b971362faa73c01476 bytes 0 814 hash=ok content=commander-exact-round/decision
EDGE 6e0b4202c1b659de1bf99ad62d42c73d09dca6bc 6f6b6af1ad459f88536235f94a8f585fdead34d5 changes 3
PATH .implementation-source-relations.json :100644 100644 c310edb1cf5a2cec343b63b1f6880d644b14bb9e 7959d010b9929becc96b6ec4f49a09794436f986 bytes 56986 57304 hash=ok content=manifest-prefix-add=2 preserved=324
PATH sprints/10170627-cw-5190fd91/05-qa-report-r4.md :000000 100644 0000000000000000000000000000000000000000 87fb6a1d598e87fe04037c492ba89bd0d9e4b673 bytes 0 30876 hash=ok content=frontmatter/task/stage/body=evaluate
PATH sprints/10170627-cw-5190fd91/06-judge-r4.md :000000 100644 0000000000000000000000000000000000000000 d160e5c15e7d84936779f0130ee8d5ee714589f2 bytes 0 3147 hash=ok content=judge-exact-round/decision/issues
EDGE 6f6b6af1ad459f88536235f94a8f585fdead34d5 acc49fa52b4ed059df42560a54663e6f34ad7ff7 changes 3
PATH .implementation-source-relations.json :100644 100644 7959d010b9929becc96b6ec4f49a09794436f986 12c7a90aa088564674dff14f80493b660bafdecf bytes 57304 57622 hash=ok content=manifest-prefix-add=2 preserved=326
PATH sprints/10170627-cw-5190fd91/05-qa-report-r5.md :000000 100644 0000000000000000000000000000000000000000 688569245080675321cd6e221576d446e4891a09 bytes 0 16278 hash=ok content=frontmatter/task/stage/body=evaluate
PATH sprints/10170627-cw-5190fd91/06-judge-r5.md :000000 100644 0000000000000000000000000000000000000000 2d9eb07b649746b2c46b592c9fb994d89afec79c bytes 0 3122 hash=ok content=judge-exact-round/decision/issues
EDGE acc49fa52b4ed059df42560a54663e6f34ad7ff7 15c90a4a0021a40170e46aeacf6fddc91d563cf0 changes 3
PATH .implementation-source-relations.json :100644 100644 12c7a90aa088564674dff14f80493b660bafdecf c41636011cd352bf88b75b263900869615f54545 bytes 57622 57940 hash=ok content=manifest-prefix-add=2 preserved=328
PATH sprints/10170627-cw-5190fd91/05-qa-report-r6.md :000000 100644 0000000000000000000000000000000000000000 06675ebe45a8fe0bb2df689097c7f7e08df2962b bytes 0 19071 hash=ok content=frontmatter/task/stage/body=evaluate
PATH sprints/10170627-cw-5190fd91/06-judge-r6.md :000000 100644 0000000000000000000000000000000000000000 6d491ef52f7145dd367f863ab358b06e6458cbd9 bytes 0 2777 hash=ok content=judge-exact-round/decision/issues
EDGE 15c90a4a0021a40170e46aeacf6fddc91d563cf0 52e2106ed03b255f18fa834ff33cf1315944e307 changes 3
PATH .implementation-source-relations.json :100644 100644 c41636011cd352bf88b75b263900869615f54545 1e5b7a23fe5fc8ddc638cd35fcd97681ebbd6773 bytes 57940 58258 hash=ok content=manifest-prefix-add=2 preserved=330
PATH sprints/10170627-cw-5190fd91/05-qa-report-r7.md :000000 100644 0000000000000000000000000000000000000000 041d7d6d327c5d54c55f9d18aaa58bb0df1b3f1f bytes 0 11400 hash=ok content=frontmatter/task/stage/body=evaluate
PATH sprints/10170627-cw-5190fd91/06-judge-r7.md :000000 100644 0000000000000000000000000000000000000000 c2060875f9c27303aa8843a0e7f26ec70af900c2 bytes 0 3555 hash=ok content=judge-exact-round/decision/issues
EDGE 52e2106ed03b255f18fa834ff33cf1315944e307 83e9532d4f68a0da797664b7e8c4b9408988d894 changes 3
PATH .implementation-source-relations.json :100644 100644 1e5b7a23fe5fc8ddc638cd35fcd97681ebbd6773 d1f7ac6374e0ecba3e356de7775de5117eadb496 bytes 58258 58576 hash=ok content=manifest-prefix-add=2 preserved=332
PATH sprints/10170627-cw-5190fd91/05-qa-report-r8.md :000000 100644 0000000000000000000000000000000000000000 addc857f7c2b240942075415b9808d598ed6426f bytes 0 29257 hash=ok content=frontmatter/task/stage/body=evaluate
PATH sprints/10170627-cw-5190fd91/06-judge-r8.md :000000 100644 0000000000000000000000000000000000000000 b6d7969319acd43ce65e13921740445f10332304 bytes 0 2716 hash=ok content=judge-exact-round/decision/issues
EDGE 83e9532d4f68a0da797664b7e8c4b9408988d894 f2afa40e9b2fdc44f61fabb9c2cbf148091e0d75 changes 3
PATH .implementation-source-relations.json :100644 100644 d1f7ac6374e0ecba3e356de7775de5117eadb496 98b32b5b70cf5681b32bc46813fdeb2fc2b712cf bytes 58576 58894 hash=ok content=manifest-prefix-add=2 preserved=334
PATH sprints/10170627-cw-5190fd91/05-qa-report-r9.md :000000 100644 0000000000000000000000000000000000000000 21dc9e047e470bcf07084cd121040245c734c64e bytes 0 116015 hash=ok content=frontmatter/task/stage/body=evaluate
PATH sprints/10170627-cw-5190fd91/06-judge-r9.md :000000 100644 0000000000000000000000000000000000000000 decb11a82e9272a24e4ff0f95b250e67d692395d bytes 0 3308 hash=ok content=judge-exact-round/decision/issues
EDGE 53cdf746c0c7f446cb7b6987e170d76248999f1d a2e88ebb066f8ac8a9f7b08c4e8263299b6bdfac changes 10
PATH .brain-versions :100644 100644 f3d261425e53f40ece495da8192f24c6040c909d c06a3400387292f30d4d25034d6600ca57b85af7 bytes 9 9 hash=ok content=upstream-main-content
PATH .dod.md :100644 100644 878f57c2d6857d5d931046a35ffb8cf04d1738d2 6cf33ef5b1680f6a5ea77e5adbc116322c0a72e1 bytes 222428 223219 hash=ok content=upstream-main-content
PATH DEFINITION.md :100644 100644 a4b46caf2f7230368a87796071009b8b35fcc44b 495b74a3f05a45ce6898d96a1a94012afb37752f bytes 770019 770688 hash=ok content=upstream-main-content
PATH package-lock.json :100644 100644 aaeb525fdffb110004342b8c6b4f96893d362179 b2e8b826f0f79f6819581b7d1bf735eacdc30a84 bytes 698744 698744 hash=ok content=upstream-main-content
PATH packages/brain/package-lock.json :100644 100644 ecb84839f8de085394f8aa50dd5f0100b1e99465 b15659ae018fa5424a70121efaeedbfd61281802 bytes 378833 378833 hash=ok content=upstream-main-content
PATH packages/brain/package.json :100644 100644 b6a3c1c890593a7bc828afa573a4ccaff05ab2c0 12c367d938c205def96708d2d7adc6c75e1ff76c bytes 1998 1998 hash=ok content=upstream-main-content
PATH packages/brain/src/__tests__/integration/crm-store.pg.integration.test.js :100644 100644 83f9ec30b3d7659f71def1415cbfbe9812b15e56 22799349a36509c2acfc8e569f0d2e1cb7860729 bytes 14428 17988 hash=ok content=upstream-main-content
PATH packages/brain/src/crm/notion-content.js :100644 100644 8171b10a1d46a896fbc9a0344e83ef6976b3539b f298634d9e92d06aee146eba21e29fc5c484ca33 bytes 1650 5983 hash=ok content=upstream-main-content
PATH packages/brain/src/crm/notion-content.test.js :100644 100644 fddc9530af3ebb9e3b344e0e81911b5dc74b0b32 931421fc1c90bfebb7c0148ade21e47ac8e67a7a bytes 1203 12648 hash=ok content=upstream-main-content
PATH packages/brain/src/crm/notion-sync.js :100644 100644 50bda4d951db1be1e3f82df1d6f90f52b6b2e72e 1353447dd4babc8978c4db8d8969892edfa9bb2e bytes 10263 10272 hash=ok content=upstream-main-content
EDGE a2e88ebb066f8ac8a9f7b08c4e8263299b6bdfac fd845665a3678b4f83ddfae98ba5ca432e459b81 changes 6
PATH .brain-versions :100644 100644 c06a3400387292f30d4d25034d6600ca57b85af7 08dd5367bdac76fe26ef2f2c6e3f4fb5ca336ff0 bytes 9 9 hash=ok content=upstream-main-content
PATH DEFINITION.md :100644 100644 495b74a3f05a45ce6898d96a1a94012afb37752f a55044e301df6bad41e0ffb1a2722f5a714d0bda bytes 770688 770688 hash=ok content=upstream-main-content
PATH package-lock.json :100644 100644 b2e8b826f0f79f6819581b7d1bf735eacdc30a84 4109f2892089feb8371f91443caf753472dfde52 bytes 698744 698744 hash=ok content=upstream-main-content
PATH packages/brain/VERSION :100644 100644 f3d261425e53f40ece495da8192f24c6040c909d 08dd5367bdac76fe26ef2f2c6e3f4fb5ca336ff0 bytes 9 9 hash=ok content=upstream-main-content
PATH packages/brain/package-lock.json :100644 100644 b15659ae018fa5424a70121efaeedbfd61281802 f6aa59c8390db2690cbb07b94d77dc9ac0b8de80 bytes 378833 378833 hash=ok content=upstream-main-content
PATH packages/brain/package.json :100644 100644 12c367d938c205def96708d2d7adc6c75e1ff76c acc959c95931f8dce5ef3f33b94844e7b22ef922 bytes 1998 1998 hash=ok content=upstream-main-content
EDGE fd845665a3678b4f83ddfae98ba5ca432e459b81 61db485cb350b7c6e626e95b83345ec23d94bf22 changes 12
PATH .implementation-source-relations.json :100644 100644 ffadfb9335a468ec6b871f54fd9a6db08ae9e09d 5e9b541f31960b9374f125ebde1e6a04a1c1978b bytes 54140 54429 hash=ok content=upstream-main-content
PATH changes/cp-10171325-cw-7cc9ae9a.md :000000 100644 0000000000000000000000000000000000000000 4a1b4652b6371dc20341cf6282b16ca83e0343fb bytes 0 582 hash=ok content=upstream-main-content
PATH packages/brain/scripts/smoke/leadgen-physical-adb-routing-smoke.sh :000000 100644 0000000000000000000000000000000000000000 b4f48455262b920bf3bf99749a6cc5e4a484b182 bytes 0 11150 hash=ok content=upstream-main-content
PATH packages/brain/src/lib/__tests__/leadgen-dispatch-contract.test.js :100644 100644 4070ba66cb8a877d8fc6b65d047a2b91d5d09b20 5dfbb21e116bba6f41bb884aadc1251352e7a8b6 bytes 3209 4162 hash=ok content=upstream-main-content
PATH packages/brain/src/lib/__tests__/leadgen-dispatch.test.js :100644 100644 da6d328c9b6cb2e405d1835aea98e40eec11856d b826e192490b41b453430b53a96ea816d041bad4 bytes 9495 10532 hash=ok content=upstream-main-content
PATH packages/brain/src/lib/__tests__/leadgen-resources.test.js :100644 100644 dd456907fe5060aa7d29e57ff2994e757e0bff06 917bfaa0b0877a609255a9d4c6550701ec05c049 bytes 12613 12980 hash=ok content=upstream-main-content
PATH packages/brain/src/lib/leadgen-controller.js :100644 100644 35f0189b28438c78eb454978280f96b2ab3744f5 a47b56bffe0699b82187b2b28fcca0ce809426d4 bytes 13624 15729 hash=ok content=upstream-main-content
PATH packages/brain/src/lib/leadgen-controller.test.js :100644 100644 b46ef2dbda88fec3df96f4f44e2ae90867a83bf1 8c2ddc0d671393f327689dc12b24f8fc21c17e34 bytes 13588 16269 hash=ok content=upstream-main-content
PATH packages/brain/src/lib/leadgen-dispatch-contract.js :100644 100644 0811142a63c74dc169d0a846002a7dcf357fe55c 9d3182e19715c8c6f386bd8fb889a7e97bdebfdb bytes 6848 7090 hash=ok content=upstream-main-content
PATH packages/brain/src/lib/leadgen-dispatch.js :100644 100644 f418ccf66474b1a68751b995e6eda4e09f3b08f5 147f4db67ed06a71508d6033b221c5ebf80f425a bytes 10113 10535 hash=ok content=upstream-main-content
PATH packages/brain/src/lib/leadgen-resources.js :100644 100644 c24234923cbba2767c121255a462368c06f16d6c 824f669484ef91dab64362e9462352fef437ab5b bytes 1116 1310 hash=ok content=upstream-main-content
PATH packages/quality/smoke-allowlist.txt :100644 100644 7eae98b7945878111618caeb1b0b174a4a5c04a4 9c6d2a1d1aa0c275ce594f7ba7804dc769cdb0ac bytes 13285 13323 hash=ok content=upstream-main-content
EDGE f2afa40e9b2fdc44f61fabb9c2cbf148091e0d75 db16f7475971decc1b832eec7a9d952bbdf2766f changes 23
PATH .brain-versions :100644 100644 f3d261425e53f40ece495da8192f24c6040c909d 08dd5367bdac76fe26ef2f2c6e3f4fb5ca336ff0 bytes 9 9 hash=ok content=sync-matches-main-content
PATH .dod.md :100644 100644 878f57c2d6857d5d931046a35ffb8cf04d1738d2 6cf33ef5b1680f6a5ea77e5adbc116322c0a72e1 bytes 222428 223219 hash=ok content=sync-matches-main-content
PATH .implementation-source-relations.json :100644 100644 98b32b5b70cf5681b32bc46813fdeb2fc2b712cf 046577ea20378c19bd0bcea687faf8c23005c9e5 bytes 58894 59183 hash=ok content=sync-manifest-defer-source-gate
PATH DEFINITION.md :100644 100644 a4b46caf2f7230368a87796071009b8b35fcc44b a55044e301df6bad41e0ffb1a2722f5a714d0bda bytes 770019 770688 hash=ok content=sync-matches-main-content
PATH changes/cp-10171325-cw-7cc9ae9a.md :000000 100644 0000000000000000000000000000000000000000 4a1b4652b6371dc20341cf6282b16ca83e0343fb bytes 0 582 hash=ok content=sync-matches-main-content
PATH package-lock.json :100644 100644 aaeb525fdffb110004342b8c6b4f96893d362179 4109f2892089feb8371f91443caf753472dfde52 bytes 698744 698744 hash=ok content=sync-matches-main-content
PATH packages/brain/VERSION :100644 100644 f3d261425e53f40ece495da8192f24c6040c909d 08dd5367bdac76fe26ef2f2c6e3f4fb5ca336ff0 bytes 9 9 hash=ok content=sync-matches-main-content
PATH packages/brain/package-lock.json :100644 100644 ecb84839f8de085394f8aa50dd5f0100b1e99465 f6aa59c8390db2690cbb07b94d77dc9ac0b8de80 bytes 378833 378833 hash=ok content=sync-matches-main-content
PATH packages/brain/package.json :100644 100644 b6a3c1c890593a7bc828afa573a4ccaff05ab2c0 acc959c95931f8dce5ef3f33b94844e7b22ef922 bytes 1998 1998 hash=ok content=sync-matches-main-content
PATH packages/brain/scripts/smoke/leadgen-physical-adb-routing-smoke.sh :000000 100644 0000000000000000000000000000000000000000 b4f48455262b920bf3bf99749a6cc5e4a484b182 bytes 0 11150 hash=ok content=sync-matches-main-content
PATH packages/brain/src/__tests__/integration/crm-store.pg.integration.test.js :100644 100644 83f9ec30b3d7659f71def1415cbfbe9812b15e56 22799349a36509c2acfc8e569f0d2e1cb7860729 bytes 14428 17988 hash=ok content=sync-matches-main-content
PATH packages/brain/src/crm/notion-content.js :100644 100644 8171b10a1d46a896fbc9a0344e83ef6976b3539b f298634d9e92d06aee146eba21e29fc5c484ca33 bytes 1650 5983 hash=ok content=sync-matches-main-content
PATH packages/brain/src/crm/notion-content.test.js :100644 100644 fddc9530af3ebb9e3b344e0e81911b5dc74b0b32 931421fc1c90bfebb7c0148ade21e47ac8e67a7a bytes 1203 12648 hash=ok content=sync-matches-main-content
PATH packages/brain/src/crm/notion-sync.js :100644 100644 50bda4d951db1be1e3f82df1d6f90f52b6b2e72e 1353447dd4babc8978c4db8d8969892edfa9bb2e bytes 10263 10272 hash=ok content=sync-matches-main-content
PATH packages/brain/src/lib/__tests__/leadgen-dispatch-contract.test.js :100644 100644 4070ba66cb8a877d8fc6b65d047a2b91d5d09b20 5dfbb21e116bba6f41bb884aadc1251352e7a8b6 bytes 3209 4162 hash=ok content=sync-matches-main-content
PATH packages/brain/src/lib/__tests__/leadgen-dispatch.test.js :100644 100644 da6d328c9b6cb2e405d1835aea98e40eec11856d b826e192490b41b453430b53a96ea816d041bad4 bytes 9495 10532 hash=ok content=sync-matches-main-content
PATH packages/brain/src/lib/__tests__/leadgen-resources.test.js :100644 100644 dd456907fe5060aa7d29e57ff2994e757e0bff06 917bfaa0b0877a609255a9d4c6550701ec05c049 bytes 12613 12980 hash=ok content=sync-matches-main-content
PATH packages/brain/src/lib/leadgen-controller.js :100644 100644 35f0189b28438c78eb454978280f96b2ab3744f5 a47b56bffe0699b82187b2b28fcca0ce809426d4 bytes 13624 15729 hash=ok content=sync-matches-main-content
PATH packages/brain/src/lib/leadgen-controller.test.js :100644 100644 b46ef2dbda88fec3df96f4f44e2ae90867a83bf1 8c2ddc0d671393f327689dc12b24f8fc21c17e34 bytes 13588 16269 hash=ok content=sync-matches-main-content
PATH packages/brain/src/lib/leadgen-dispatch-contract.js :100644 100644 0811142a63c74dc169d0a846002a7dcf357fe55c 9d3182e19715c8c6f386bd8fb889a7e97bdebfdb bytes 6848 7090 hash=ok content=sync-matches-main-content
PATH packages/brain/src/lib/leadgen-dispatch.js :100644 100644 f418ccf66474b1a68751b995e6eda4e09f3b08f5 147f4db67ed06a71508d6033b221c5ebf80f425a bytes 10113 10535 hash=ok content=sync-matches-main-content
PATH packages/brain/src/lib/leadgen-resources.js :100644 100644 c24234923cbba2767c121255a462368c06f16d6c 824f669484ef91dab64362e9462352fef437ab5b bytes 1116 1310 hash=ok content=sync-matches-main-content
PATH packages/quality/smoke-allowlist.txt :100644 100644 7eae98b7945878111618caeb1b0b174a4a5c04a4 9c6d2a1d1aa0c275ce594f7ba7804dc769cdb0ac bytes 13285 13323 hash=ok content=sync-matches-main-content
EDGE 61db485cb350b7c6e626e95b83345ec23d94bf22 db16f7475971decc1b832eec7a9d952bbdf2766f changes 32
PATH .implementation-source-relations.json :100644 100644 5e9b541f31960b9374f125ebde1e6a04a1c1978b 046577ea20378c19bd0bcea687faf8c23005c9e5 bytes 54429 59183 hash=ok content=sync-manifest-defer-source-gate
PATH packages/brain/scripts/coding-workflow/runner/README.md :100644 100644 6e6eb65f64c55bdad786b619e2e9a4ef66225297 3e8eea166d021b985bff0c71e1ccbc87d234d248 bytes 10889 13572 hash=ok content=sync-preserves-task-content
PATH sprints/10170627-cw-5190fd91/01-intent.md :000000 100644 0000000000000000000000000000000000000000 3a1529d7a143b6fdcf1305b9d72480c22c4d3a8c bytes 0 15486 hash=ok content=sync-preserves-task-content
PATH sprints/10170627-cw-5190fd91/01-invariants.md :000000 100644 0000000000000000000000000000000000000000 2276b9f0bca1d5fd3e422ef6e962e1259e266703 bytes 0 89736 hash=ok content=sync-preserves-task-content
PATH sprints/10170627-cw-5190fd91/02-response-r1.md :000000 100644 0000000000000000000000000000000000000000 f89998664a7a99d3f8bfc0b8b4f0ac0955c8b83a bytes 0 589 hash=ok content=sync-preserves-task-content
PATH sprints/10170627-cw-5190fd91/02-response-r2.md :000000 100644 0000000000000000000000000000000000000000 677402ca401d014befa03669d7b1a1aa04a917b2 bytes 0 1084 hash=ok content=sync-preserves-task-content
PATH sprints/10170627-cw-5190fd91/02-review-r1.md :000000 100644 0000000000000000000000000000000000000000 8b068bd99a4c2f5abc189032698f21ad8e267be6 bytes 0 1223 hash=ok content=sync-preserves-task-content
PATH sprints/10170627-cw-5190fd91/02-review-r2.md :000000 100644 0000000000000000000000000000000000000000 7c80b836bc8c5469525c21273be83ad0e8dde8fc bytes 0 1436 hash=ok content=sync-preserves-task-content
PATH sprints/10170627-cw-5190fd91/02-review-r3.md :000000 100644 0000000000000000000000000000000000000000 e6922e12ac037d6b2ac8839985f3434b9d4f48e5 bytes 0 1113 hash=ok content=sync-preserves-task-content
PATH sprints/10170627-cw-5190fd91/02-review.md :000000 100644 0000000000000000000000000000000000000000 e6922e12ac037d6b2ac8839985f3434b9d4f48e5 bytes 0 1113 hash=ok content=sync-preserves-task-content
PATH sprints/10170627-cw-5190fd91/02-spec.md :000000 100644 0000000000000000000000000000000000000000 ac6a959af50bb4cc8c451ec9a63fb8b40249f55a bytes 0 24118 hash=ok content=sync-preserves-task-content
PATH sprints/10170627-cw-5190fd91/03-build.md :000000 100644 0000000000000000000000000000000000000000 0d96f563734111cfdcd2049a91b8d0973da5adff bytes 0 5095 hash=ok content=sync-preserves-task-content
PATH sprints/10170627-cw-5190fd91/04-evidence.md :000000 100644 0000000000000000000000000000000000000000 46a81734ed6702902319dcbe09f211bf692b0f88 bytes 0 9894 hash=ok content=sync-preserves-task-content
PATH sprints/10170627-cw-5190fd91/05-qa-report-r1.md :000000 100644 0000000000000000000000000000000000000000 766cc68f7f0cb7bd81da2711b7eb920992f04c05 bytes 0 19119 hash=ok content=sync-preserves-task-content
PATH sprints/10170627-cw-5190fd91/05-qa-report-r2.md :000000 100644 0000000000000000000000000000000000000000 05e0b0b9c9bb8608cbceed644e7c8b9e8243aeee bytes 0 49562 hash=ok content=sync-preserves-task-content
PATH sprints/10170627-cw-5190fd91/05-qa-report-r3.md :000000 100644 0000000000000000000000000000000000000000 80d07eb72ebecb771c35ecc1222d36943b5ee8cf bytes 0 31961 hash=ok content=sync-preserves-task-content
PATH sprints/10170627-cw-5190fd91/05-qa-report-r4.md :000000 100644 0000000000000000000000000000000000000000 87fb6a1d598e87fe04037c492ba89bd0d9e4b673 bytes 0 30876 hash=ok content=sync-preserves-task-content
PATH sprints/10170627-cw-5190fd91/05-qa-report-r5.md :000000 100644 0000000000000000000000000000000000000000 688569245080675321cd6e221576d446e4891a09 bytes 0 16278 hash=ok content=sync-preserves-task-content
PATH sprints/10170627-cw-5190fd91/05-qa-report-r6.md :000000 100644 0000000000000000000000000000000000000000 06675ebe45a8fe0bb2df689097c7f7e08df2962b bytes 0 19071 hash=ok content=sync-preserves-task-content
PATH sprints/10170627-cw-5190fd91/05-qa-report-r7.md :000000 100644 0000000000000000000000000000000000000000 041d7d6d327c5d54c55f9d18aaa58bb0df1b3f1f bytes 0 11400 hash=ok content=sync-preserves-task-content
PATH sprints/10170627-cw-5190fd91/05-qa-report-r8.md :000000 100644 0000000000000000000000000000000000000000 addc857f7c2b240942075415b9808d598ed6426f bytes 0 29257 hash=ok content=sync-preserves-task-content
PATH sprints/10170627-cw-5190fd91/05-qa-report-r9.md :000000 100644 0000000000000000000000000000000000000000 21dc9e047e470bcf07084cd121040245c734c64e bytes 0 116015 hash=ok content=sync-preserves-task-content
PATH sprints/10170627-cw-5190fd91/06-judge-r2.md :000000 100644 0000000000000000000000000000000000000000 51c02fb04eab523db35539b6572f2fd7d5a87fc4 bytes 0 2629 hash=ok content=sync-preserves-task-content
PATH sprints/10170627-cw-5190fd91/06-judge-r3.md :000000 100644 0000000000000000000000000000000000000000 19cf8a90460a19162ad5658eed7a52afbca7b245 bytes 0 2604 hash=ok content=sync-preserves-task-content
PATH sprints/10170627-cw-5190fd91/06-judge-r4.md :000000 100644 0000000000000000000000000000000000000000 d160e5c15e7d84936779f0130ee8d5ee714589f2 bytes 0 3147 hash=ok content=sync-preserves-task-content
PATH sprints/10170627-cw-5190fd91/06-judge-r5.md :000000 100644 0000000000000000000000000000000000000000 2d9eb07b649746b2c46b592c9fb994d89afec79c bytes 0 3122 hash=ok content=sync-preserves-task-content
PATH sprints/10170627-cw-5190fd91/06-judge-r6.md :000000 100644 0000000000000000000000000000000000000000 6d491ef52f7145dd367f863ab358b06e6458cbd9 bytes 0 2777 hash=ok content=sync-preserves-task-content
PATH sprints/10170627-cw-5190fd91/06-judge-r7.md :000000 100644 0000000000000000000000000000000000000000 c2060875f9c27303aa8843a0e7f26ec70af900c2 bytes 0 3555 hash=ok content=sync-preserves-task-content
PATH sprints/10170627-cw-5190fd91/06-judge-r8.md :000000 100644 0000000000000000000000000000000000000000 b6d7969319acd43ce65e13921740445f10332304 bytes 0 2716 hash=ok content=sync-preserves-task-content
PATH sprints/10170627-cw-5190fd91/06-judge-r9.md :000000 100644 0000000000000000000000000000000000000000 decb11a82e9272a24e4ff0f95b250e67d692395d bytes 0 3308 hash=ok content=sync-preserves-task-content
PATH sprints/10170627-cw-5190fd91/07-commander-r1.md :000000 100644 0000000000000000000000000000000000000000 fc178a6a802a0410e83cdf2c9c03233f8206bb1c bytes 0 876 hash=ok content=sync-preserves-task-content
PATH sprints/10170627-cw-5190fd91/07-commander-r2.md :000000 100644 0000000000000000000000000000000000000000 8557e2041e46ac98747c39b971362faa73c01476 bytes 0 814 hash=ok content=sync-preserves-task-content
EDGE 61db485cb350b7c6e626e95b83345ec23d94bf22 dacf5bf376fa619ebce6efdf76b1ea090edabe75 changes 8
PATH .brain-versions :100644 100644 08dd5367bdac76fe26ef2f2c6e3f4fb5ca336ff0 e73b122b8bb5c873a863edcb98250892acc433fc bytes 9 9 hash=ok content=upstream-main-content
PATH .implementation-source-relations.json :100644 100644 5e9b541f31960b9374f125ebde1e6a04a1c1978b 0a7b64e2ad039a5ab701a9827ba11a6a0fe6cb9d bytes 54429 54308 hash=ok content=upstream-main-content
PATH DEFINITION.md :100644 100644 a55044e301df6bad41e0ffb1a2722f5a714d0bda d0eb2ba667519af9c17ec14648025e9ad415ee69 bytes 770688 771270 hash=ok content=upstream-main-content
PATH changes/cp-10171325-cw-7cc9ae9a.md :100644 000000 4a1b4652b6371dc20341cf6282b16ca83e0343fb 0000000000000000000000000000000000000000 bytes 582 0 hash=ok content=upstream-main-content
PATH package-lock.json :100644 100644 4109f2892089feb8371f91443caf753472dfde52 a517d185802b86a5ffed1ab5e566e03fe22eebec bytes 698744 698744 hash=ok content=upstream-main-content
PATH packages/brain/VERSION :100644 100644 08dd5367bdac76fe26ef2f2c6e3f4fb5ca336ff0 e73b122b8bb5c873a863edcb98250892acc433fc bytes 9 9 hash=ok content=upstream-main-content
PATH packages/brain/package-lock.json :100644 100644 f6aa59c8390db2690cbb07b94d77dc9ac0b8de80 5eabad142cc2cb6ee7e2410d3454d6c649f22248 bytes 378833 378833 hash=ok content=upstream-main-content
PATH packages/brain/package.json :100644 100644 acc959c95931f8dce5ef3f33b94844e7b22ef922 98970083c277b1ac5d07100abaf9fdaf14f5d726 bytes 1998 1998 hash=ok content=upstream-main-content
EDGE dacf5bf376fa619ebce6efdf76b1ea090edabe75 2732b510b621af4d35336e829617b3921e125128 changes 4
PATH .implementation-source-relations.json :100644 100644 0a7b64e2ad039a5ab701a9827ba11a6a0fe6cb9d 4902e3f04ccdc5ae8567f855c9560f07fe1a2536 bytes 54308 54439 hash=ok content=upstream-main-content
PATH changes/cp-10171423-cloud-history.md :000000 100644 0000000000000000000000000000000000000000 a38c630b586a10b21a83d2acceb388b6cd431c47 bytes 0 388 hash=ok content=upstream-main-content
PATH packages/brain/src/lib/__tests__/leadgen-batch-proof.test.js :100644 100644 1c23c5febf009b1ea45d969c390ff2832a2855ae ec1f7aa593a0fee9e4b3c027e124e1f1c14eded7 bytes 2979 5435 hash=ok content=upstream-main-content
PATH packages/brain/src/lib/leadgen-batch-proof.js :100644 100644 ba1f517497b53b8c6ada68f037ec333241908218 0448adb8ca60503355f910defbb2f4c33b2404cb bytes 4827 4846 hash=ok content=upstream-main-content
EDGE db16f7475971decc1b832eec7a9d952bbdf2766f 73b660f6cc3e206926fbc64e572868f23d361ac4 changes 11
PATH .brain-versions :100644 100644 08dd5367bdac76fe26ef2f2c6e3f4fb5ca336ff0 e73b122b8bb5c873a863edcb98250892acc433fc bytes 9 9 hash=ok content=sync-matches-main-content
PATH .implementation-source-relations.json :100644 100644 046577ea20378c19bd0bcea687faf8c23005c9e5 8e01337055cc4035d0b60889d73f63462defd271 bytes 59183 59193 hash=ok content=sync-manifest-defer-source-gate
PATH DEFINITION.md :100644 100644 a55044e301df6bad41e0ffb1a2722f5a714d0bda d0eb2ba667519af9c17ec14648025e9ad415ee69 bytes 770688 771270 hash=ok content=sync-matches-main-content
PATH changes/cp-10171325-cw-7cc9ae9a.md :100644 000000 4a1b4652b6371dc20341cf6282b16ca83e0343fb 0000000000000000000000000000000000000000 bytes 582 0 hash=ok content=sync-matches-main-content
PATH changes/cp-10171423-cloud-history.md :000000 100644 0000000000000000000000000000000000000000 a38c630b586a10b21a83d2acceb388b6cd431c47 bytes 0 388 hash=ok content=sync-matches-main-content
PATH package-lock.json :100644 100644 4109f2892089feb8371f91443caf753472dfde52 a517d185802b86a5ffed1ab5e566e03fe22eebec bytes 698744 698744 hash=ok content=sync-matches-main-content
PATH packages/brain/VERSION :100644 100644 08dd5367bdac76fe26ef2f2c6e3f4fb5ca336ff0 e73b122b8bb5c873a863edcb98250892acc433fc bytes 9 9 hash=ok content=sync-matches-main-content
PATH packages/brain/package-lock.json :100644 100644 f6aa59c8390db2690cbb07b94d77dc9ac0b8de80 5eabad142cc2cb6ee7e2410d3454d6c649f22248 bytes 378833 378833 hash=ok content=sync-matches-main-content
PATH packages/brain/package.json :100644 100644 acc959c95931f8dce5ef3f33b94844e7b22ef922 98970083c277b1ac5d07100abaf9fdaf14f5d726 bytes 1998 1998 hash=ok content=sync-matches-main-content
PATH packages/brain/src/lib/__tests__/leadgen-batch-proof.test.js :100644 100644 1c23c5febf009b1ea45d969c390ff2832a2855ae ec1f7aa593a0fee9e4b3c027e124e1f1c14eded7 bytes 2979 5435 hash=ok content=sync-matches-main-content
PATH packages/brain/src/lib/leadgen-batch-proof.js :100644 100644 ba1f517497b53b8c6ada68f037ec333241908218 0448adb8ca60503355f910defbb2f4c33b2404cb bytes 4827 4846 hash=ok content=sync-matches-main-content
EDGE 2732b510b621af4d35336e829617b3921e125128 73b660f6cc3e206926fbc64e572868f23d361ac4 changes 32
PATH .implementation-source-relations.json :100644 100644 4902e3f04ccdc5ae8567f855c9560f07fe1a2536 8e01337055cc4035d0b60889d73f63462defd271 bytes 54439 59193 hash=ok content=sync-manifest-defer-source-gate
PATH packages/brain/scripts/coding-workflow/runner/README.md :100644 100644 6e6eb65f64c55bdad786b619e2e9a4ef66225297 3e8eea166d021b985bff0c71e1ccbc87d234d248 bytes 10889 13572 hash=ok content=sync-preserves-task-content
PATH sprints/10170627-cw-5190fd91/01-intent.md :000000 100644 0000000000000000000000000000000000000000 3a1529d7a143b6fdcf1305b9d72480c22c4d3a8c bytes 0 15486 hash=ok content=sync-preserves-task-content
PATH sprints/10170627-cw-5190fd91/01-invariants.md :000000 100644 0000000000000000000000000000000000000000 2276b9f0bca1d5fd3e422ef6e962e1259e266703 bytes 0 89736 hash=ok content=sync-preserves-task-content
PATH sprints/10170627-cw-5190fd91/02-response-r1.md :000000 100644 0000000000000000000000000000000000000000 f89998664a7a99d3f8bfc0b8b4f0ac0955c8b83a bytes 0 589 hash=ok content=sync-preserves-task-content
PATH sprints/10170627-cw-5190fd91/02-response-r2.md :000000 100644 0000000000000000000000000000000000000000 677402ca401d014befa03669d7b1a1aa04a917b2 bytes 0 1084 hash=ok content=sync-preserves-task-content
PATH sprints/10170627-cw-5190fd91/02-review-r1.md :000000 100644 0000000000000000000000000000000000000000 8b068bd99a4c2f5abc189032698f21ad8e267be6 bytes 0 1223 hash=ok content=sync-preserves-task-content
PATH sprints/10170627-cw-5190fd91/02-review-r2.md :000000 100644 0000000000000000000000000000000000000000 7c80b836bc8c5469525c21273be83ad0e8dde8fc bytes 0 1436 hash=ok content=sync-preserves-task-content
PATH sprints/10170627-cw-5190fd91/02-review-r3.md :000000 100644 0000000000000000000000000000000000000000 e6922e12ac037d6b2ac8839985f3434b9d4f48e5 bytes 0 1113 hash=ok content=sync-preserves-task-content
PATH sprints/10170627-cw-5190fd91/02-review.md :000000 100644 0000000000000000000000000000000000000000 e6922e12ac037d6b2ac8839985f3434b9d4f48e5 bytes 0 1113 hash=ok content=sync-preserves-task-content
PATH sprints/10170627-cw-5190fd91/02-spec.md :000000 100644 0000000000000000000000000000000000000000 ac6a959af50bb4cc8c451ec9a63fb8b40249f55a bytes 0 24118 hash=ok content=sync-preserves-task-content
PATH sprints/10170627-cw-5190fd91/03-build.md :000000 100644 0000000000000000000000000000000000000000 0d96f563734111cfdcd2049a91b8d0973da5adff bytes 0 5095 hash=ok content=sync-preserves-task-content
PATH sprints/10170627-cw-5190fd91/04-evidence.md :000000 100644 0000000000000000000000000000000000000000 46a81734ed6702902319dcbe09f211bf692b0f88 bytes 0 9894 hash=ok content=sync-preserves-task-content
PATH sprints/10170627-cw-5190fd91/05-qa-report-r1.md :000000 100644 0000000000000000000000000000000000000000 766cc68f7f0cb7bd81da2711b7eb920992f04c05 bytes 0 19119 hash=ok content=sync-preserves-task-content
PATH sprints/10170627-cw-5190fd91/05-qa-report-r2.md :000000 100644 0000000000000000000000000000000000000000 05e0b0b9c9bb8608cbceed644e7c8b9e8243aeee bytes 0 49562 hash=ok content=sync-preserves-task-content
PATH sprints/10170627-cw-5190fd91/05-qa-report-r3.md :000000 100644 0000000000000000000000000000000000000000 80d07eb72ebecb771c35ecc1222d36943b5ee8cf bytes 0 31961 hash=ok content=sync-preserves-task-content
PATH sprints/10170627-cw-5190fd91/05-qa-report-r4.md :000000 100644 0000000000000000000000000000000000000000 87fb6a1d598e87fe04037c492ba89bd0d9e4b673 bytes 0 30876 hash=ok content=sync-preserves-task-content
PATH sprints/10170627-cw-5190fd91/05-qa-report-r5.md :000000 100644 0000000000000000000000000000000000000000 688569245080675321cd6e221576d446e4891a09 bytes 0 16278 hash=ok content=sync-preserves-task-content
PATH sprints/10170627-cw-5190fd91/05-qa-report-r6.md :000000 100644 0000000000000000000000000000000000000000 06675ebe45a8fe0bb2df689097c7f7e08df2962b bytes 0 19071 hash=ok content=sync-preserves-task-content
PATH sprints/10170627-cw-5190fd91/05-qa-report-r7.md :000000 100644 0000000000000000000000000000000000000000 041d7d6d327c5d54c55f9d18aaa58bb0df1b3f1f bytes 0 11400 hash=ok content=sync-preserves-task-content
PATH sprints/10170627-cw-5190fd91/05-qa-report-r8.md :000000 100644 0000000000000000000000000000000000000000 addc857f7c2b240942075415b9808d598ed6426f bytes 0 29257 hash=ok content=sync-preserves-task-content
PATH sprints/10170627-cw-5190fd91/05-qa-report-r9.md :000000 100644 0000000000000000000000000000000000000000 21dc9e047e470bcf07084cd121040245c734c64e bytes 0 116015 hash=ok content=sync-preserves-task-content
PATH sprints/10170627-cw-5190fd91/06-judge-r2.md :000000 100644 0000000000000000000000000000000000000000 51c02fb04eab523db35539b6572f2fd7d5a87fc4 bytes 0 2629 hash=ok content=sync-preserves-task-content
PATH sprints/10170627-cw-5190fd91/06-judge-r3.md :000000 100644 0000000000000000000000000000000000000000 19cf8a90460a19162ad5658eed7a52afbca7b245 bytes 0 2604 hash=ok content=sync-preserves-task-content
PATH sprints/10170627-cw-5190fd91/06-judge-r4.md :000000 100644 0000000000000000000000000000000000000000 d160e5c15e7d84936779f0130ee8d5ee714589f2 bytes 0 3147 hash=ok content=sync-preserves-task-content
PATH sprints/10170627-cw-5190fd91/06-judge-r5.md :000000 100644 0000000000000000000000000000000000000000 2d9eb07b649746b2c46b592c9fb994d89afec79c bytes 0 3122 hash=ok content=sync-preserves-task-content
PATH sprints/10170627-cw-5190fd91/06-judge-r6.md :000000 100644 0000000000000000000000000000000000000000 6d491ef52f7145dd367f863ab358b06e6458cbd9 bytes 0 2777 hash=ok content=sync-preserves-task-content
PATH sprints/10170627-cw-5190fd91/06-judge-r7.md :000000 100644 0000000000000000000000000000000000000000 c2060875f9c27303aa8843a0e7f26ec70af900c2 bytes 0 3555 hash=ok content=sync-preserves-task-content
PATH sprints/10170627-cw-5190fd91/06-judge-r8.md :000000 100644 0000000000000000000000000000000000000000 b6d7969319acd43ce65e13921740445f10332304 bytes 0 2716 hash=ok content=sync-preserves-task-content
PATH sprints/10170627-cw-5190fd91/06-judge-r9.md :000000 100644 0000000000000000000000000000000000000000 decb11a82e9272a24e4ff0f95b250e67d692395d bytes 0 3308 hash=ok content=sync-preserves-task-content
PATH sprints/10170627-cw-5190fd91/07-commander-r1.md :000000 100644 0000000000000000000000000000000000000000 fc178a6a802a0410e83cdf2c9c03233f8206bb1c bytes 0 876 hash=ok content=sync-preserves-task-content
PATH sprints/10170627-cw-5190fd91/07-commander-r2.md :000000 100644 0000000000000000000000000000000000000000 8557e2041e46ac98747c39b971362faa73c01476 bytes 0 814 hash=ok content=sync-preserves-task-content
EDGE 73b660f6cc3e206926fbc64e572868f23d361ac4 a77e886a5faa28e910bc46ac306c21ade5977847 changes 2
PATH .implementation-source-relations.json :100644 100644 8e01337055cc4035d0b60889d73f63462defd271 8b5a55077b9e5082453958e913e2f4fc59cb7e3b bytes 59193 59354 hash=ok content=manifest-prefix-add=1 preserved=338
PATH sprints/10170627-cw-5190fd91/07-commander-r3.md :000000 100644 0000000000000000000000000000000000000000 09f6a91f3acc8a7ab95c7720cf5e25c4f6d1ed61 bytes 0 971 hash=ok content=commander-exact-round/decision
EDGE 2732b510b621af4d35336e829617b3921e125128 6d1f6b0bb87e8cf7a824b585d0df50382ca193f8 changes 8
PATH .brain-versions :100644 100644 e73b122b8bb5c873a863edcb98250892acc433fc f2acc6eb50c48ecebf6155e2e73e1d4c6c07412c bytes 9 9 hash=ok content=upstream-main-content
PATH .implementation-source-relations.json :100644 100644 4902e3f04ccdc5ae8567f855c9560f07fe1a2536 4bfafcaab0323db2a32ea8a5722fc4892d9ac188 bytes 54439 54313 hash=ok content=upstream-main-content
PATH DEFINITION.md :100644 100644 d0eb2ba667519af9c17ec14648025e9ad415ee69 dedae1ca2bb0c211c9915f3d0c185944cd1c23ac bytes 771270 771658 hash=ok content=upstream-main-content
PATH changes/cp-10171423-cloud-history.md :100644 000000 a38c630b586a10b21a83d2acceb388b6cd431c47 0000000000000000000000000000000000000000 bytes 388 0 hash=ok content=upstream-main-content
PATH package-lock.json :100644 100644 a517d185802b86a5ffed1ab5e566e03fe22eebec 978256584160b1d2c1cd4d163e819814c0c09074 bytes 698744 698744 hash=ok content=upstream-main-content
PATH packages/brain/VERSION :100644 100644 e73b122b8bb5c873a863edcb98250892acc433fc f2acc6eb50c48ecebf6155e2e73e1d4c6c07412c bytes 9 9 hash=ok content=upstream-main-content
PATH packages/brain/package-lock.json :100644 100644 5eabad142cc2cb6ee7e2410d3454d6c649f22248 91dab548fabfef8bc5ac7519f875d50b697223ce bytes 378833 378833 hash=ok content=upstream-main-content
PATH packages/brain/package.json :100644 100644 98970083c277b1ac5d07100abaf9fdaf14f5d726 faaaaa58e8dc342c76610d097b72d6ceaf8feb6a bytes 1998 1998 hash=ok content=upstream-main-content
EDGE a77e886a5faa28e910bc46ac306c21ade5977847 e155382a75885815d9cd838670df39cbb3ed9447 changes 8
PATH .brain-versions :100644 100644 e73b122b8bb5c873a863edcb98250892acc433fc f2acc6eb50c48ecebf6155e2e73e1d4c6c07412c bytes 9 9 hash=ok content=sync-matches-main-content
PATH .implementation-source-relations.json :100644 100644 8b5a55077b9e5082453958e913e2f4fc59cb7e3b 4c98e8b1492e34af3aad0338547d8b8862403a37 bytes 59354 59228 hash=ok content=sync-manifest-defer-source-gate
PATH DEFINITION.md :100644 100644 d0eb2ba667519af9c17ec14648025e9ad415ee69 dedae1ca2bb0c211c9915f3d0c185944cd1c23ac bytes 771270 771658 hash=ok content=sync-matches-main-content
PATH changes/cp-10171423-cloud-history.md :100644 000000 a38c630b586a10b21a83d2acceb388b6cd431c47 0000000000000000000000000000000000000000 bytes 388 0 hash=ok content=sync-matches-main-content
PATH package-lock.json :100644 100644 a517d185802b86a5ffed1ab5e566e03fe22eebec 978256584160b1d2c1cd4d163e819814c0c09074 bytes 698744 698744 hash=ok content=sync-matches-main-content
PATH packages/brain/VERSION :100644 100644 e73b122b8bb5c873a863edcb98250892acc433fc f2acc6eb50c48ecebf6155e2e73e1d4c6c07412c bytes 9 9 hash=ok content=sync-matches-main-content
PATH packages/brain/package-lock.json :100644 100644 5eabad142cc2cb6ee7e2410d3454d6c649f22248 91dab548fabfef8bc5ac7519f875d50b697223ce bytes 378833 378833 hash=ok content=sync-matches-main-content
PATH packages/brain/package.json :100644 100644 98970083c277b1ac5d07100abaf9fdaf14f5d726 faaaaa58e8dc342c76610d097b72d6ceaf8feb6a bytes 1998 1998 hash=ok content=sync-matches-main-content
EDGE 6d1f6b0bb87e8cf7a824b585d0df50382ca193f8 e155382a75885815d9cd838670df39cbb3ed9447 changes 33
PATH .implementation-source-relations.json :100644 100644 4bfafcaab0323db2a32ea8a5722fc4892d9ac188 4c98e8b1492e34af3aad0338547d8b8862403a37 bytes 54313 59228 hash=ok content=sync-manifest-defer-source-gate
PATH packages/brain/scripts/coding-workflow/runner/README.md :100644 100644 6e6eb65f64c55bdad786b619e2e9a4ef66225297 3e8eea166d021b985bff0c71e1ccbc87d234d248 bytes 10889 13572 hash=ok content=sync-preserves-task-content
PATH sprints/10170627-cw-5190fd91/01-intent.md :000000 100644 0000000000000000000000000000000000000000 3a1529d7a143b6fdcf1305b9d72480c22c4d3a8c bytes 0 15486 hash=ok content=sync-preserves-task-content
PATH sprints/10170627-cw-5190fd91/01-invariants.md :000000 100644 0000000000000000000000000000000000000000 2276b9f0bca1d5fd3e422ef6e962e1259e266703 bytes 0 89736 hash=ok content=sync-preserves-task-content
PATH sprints/10170627-cw-5190fd91/02-response-r1.md :000000 100644 0000000000000000000000000000000000000000 f89998664a7a99d3f8bfc0b8b4f0ac0955c8b83a bytes 0 589 hash=ok content=sync-preserves-task-content
PATH sprints/10170627-cw-5190fd91/02-response-r2.md :000000 100644 0000000000000000000000000000000000000000 677402ca401d014befa03669d7b1a1aa04a917b2 bytes 0 1084 hash=ok content=sync-preserves-task-content
PATH sprints/10170627-cw-5190fd91/02-review-r1.md :000000 100644 0000000000000000000000000000000000000000 8b068bd99a4c2f5abc189032698f21ad8e267be6 bytes 0 1223 hash=ok content=sync-preserves-task-content
PATH sprints/10170627-cw-5190fd91/02-review-r2.md :000000 100644 0000000000000000000000000000000000000000 7c80b836bc8c5469525c21273be83ad0e8dde8fc bytes 0 1436 hash=ok content=sync-preserves-task-content
PATH sprints/10170627-cw-5190fd91/02-review-r3.md :000000 100644 0000000000000000000000000000000000000000 e6922e12ac037d6b2ac8839985f3434b9d4f48e5 bytes 0 1113 hash=ok content=sync-preserves-task-content
PATH sprints/10170627-cw-5190fd91/02-review.md :000000 100644 0000000000000000000000000000000000000000 e6922e12ac037d6b2ac8839985f3434b9d4f48e5 bytes 0 1113 hash=ok content=sync-preserves-task-content
PATH sprints/10170627-cw-5190fd91/02-spec.md :000000 100644 0000000000000000000000000000000000000000 ac6a959af50bb4cc8c451ec9a63fb8b40249f55a bytes 0 24118 hash=ok content=sync-preserves-task-content
PATH sprints/10170627-cw-5190fd91/03-build.md :000000 100644 0000000000000000000000000000000000000000 0d96f563734111cfdcd2049a91b8d0973da5adff bytes 0 5095 hash=ok content=sync-preserves-task-content
PATH sprints/10170627-cw-5190fd91/04-evidence.md :000000 100644 0000000000000000000000000000000000000000 46a81734ed6702902319dcbe09f211bf692b0f88 bytes 0 9894 hash=ok content=sync-preserves-task-content
PATH sprints/10170627-cw-5190fd91/05-qa-report-r1.md :000000 100644 0000000000000000000000000000000000000000 766cc68f7f0cb7bd81da2711b7eb920992f04c05 bytes 0 19119 hash=ok content=sync-preserves-task-content
PATH sprints/10170627-cw-5190fd91/05-qa-report-r2.md :000000 100644 0000000000000000000000000000000000000000 05e0b0b9c9bb8608cbceed644e7c8b9e8243aeee bytes 0 49562 hash=ok content=sync-preserves-task-content
PATH sprints/10170627-cw-5190fd91/05-qa-report-r3.md :000000 100644 0000000000000000000000000000000000000000 80d07eb72ebecb771c35ecc1222d36943b5ee8cf bytes 0 31961 hash=ok content=sync-preserves-task-content
PATH sprints/10170627-cw-5190fd91/05-qa-report-r4.md :000000 100644 0000000000000000000000000000000000000000 87fb6a1d598e87fe04037c492ba89bd0d9e4b673 bytes 0 30876 hash=ok content=sync-preserves-task-content
PATH sprints/10170627-cw-5190fd91/05-qa-report-r5.md :000000 100644 0000000000000000000000000000000000000000 688569245080675321cd6e221576d446e4891a09 bytes 0 16278 hash=ok content=sync-preserves-task-content
PATH sprints/10170627-cw-5190fd91/05-qa-report-r6.md :000000 100644 0000000000000000000000000000000000000000 06675ebe45a8fe0bb2df689097c7f7e08df2962b bytes 0 19071 hash=ok content=sync-preserves-task-content
PATH sprints/10170627-cw-5190fd91/05-qa-report-r7.md :000000 100644 0000000000000000000000000000000000000000 041d7d6d327c5d54c55f9d18aaa58bb0df1b3f1f bytes 0 11400 hash=ok content=sync-preserves-task-content
PATH sprints/10170627-cw-5190fd91/05-qa-report-r8.md :000000 100644 0000000000000000000000000000000000000000 addc857f7c2b240942075415b9808d598ed6426f bytes 0 29257 hash=ok content=sync-preserves-task-content
PATH sprints/10170627-cw-5190fd91/05-qa-report-r9.md :000000 100644 0000000000000000000000000000000000000000 21dc9e047e470bcf07084cd121040245c734c64e bytes 0 116015 hash=ok content=sync-preserves-task-content
PATH sprints/10170627-cw-5190fd91/06-judge-r2.md :000000 100644 0000000000000000000000000000000000000000 51c02fb04eab523db35539b6572f2fd7d5a87fc4 bytes 0 2629 hash=ok content=sync-preserves-task-content
PATH sprints/10170627-cw-5190fd91/06-judge-r3.md :000000 100644 0000000000000000000000000000000000000000 19cf8a90460a19162ad5658eed7a52afbca7b245 bytes 0 2604 hash=ok content=sync-preserves-task-content
PATH sprints/10170627-cw-5190fd91/06-judge-r4.md :000000 100644 0000000000000000000000000000000000000000 d160e5c15e7d84936779f0130ee8d5ee714589f2 bytes 0 3147 hash=ok content=sync-preserves-task-content
PATH sprints/10170627-cw-5190fd91/06-judge-r5.md :000000 100644 0000000000000000000000000000000000000000 2d9eb07b649746b2c46b592c9fb994d89afec79c bytes 0 3122 hash=ok content=sync-preserves-task-content
PATH sprints/10170627-cw-5190fd91/06-judge-r6.md :000000 100644 0000000000000000000000000000000000000000 6d491ef52f7145dd367f863ab358b06e6458cbd9 bytes 0 2777 hash=ok content=sync-preserves-task-content
PATH sprints/10170627-cw-5190fd91/06-judge-r7.md :000000 100644 0000000000000000000000000000000000000000 c2060875f9c27303aa8843a0e7f26ec70af900c2 bytes 0 3555 hash=ok content=sync-preserves-task-content
PATH sprints/10170627-cw-5190fd91/06-judge-r8.md :000000 100644 0000000000000000000000000000000000000000 b6d7969319acd43ce65e13921740445f10332304 bytes 0 2716 hash=ok content=sync-preserves-task-content
PATH sprints/10170627-cw-5190fd91/06-judge-r9.md :000000 100644 0000000000000000000000000000000000000000 decb11a82e9272a24e4ff0f95b250e67d692395d bytes 0 3308 hash=ok content=sync-preserves-task-content
PATH sprints/10170627-cw-5190fd91/07-commander-r1.md :000000 100644 0000000000000000000000000000000000000000 fc178a6a802a0410e83cdf2c9c03233f8206bb1c bytes 0 876 hash=ok content=sync-preserves-task-content
PATH sprints/10170627-cw-5190fd91/07-commander-r2.md :000000 100644 0000000000000000000000000000000000000000 8557e2041e46ac98747c39b971362faa73c01476 bytes 0 814 hash=ok content=sync-preserves-task-content
PATH sprints/10170627-cw-5190fd91/07-commander-r3.md :000000 100644 0000000000000000000000000000000000000000 09f6a91f3acc8a7ab95c7720cf5e25c4f6d1ed61 bytes 0 971 hash=ok content=sync-preserves-task-content
AUDIT_OK edges 31
```
退出码: 0

### q4manifest
```command
python3 - <<'PY'
import subprocess,json
sync=['f9460639ab0b5e2cd7b05f4f109db13a51b64f01','db16f7475971decc1b832eec7a9d952bbdf2766f','73b660f6cc3e206926fbc64e572868f23d361ac4','e155382a75885815d9cd838670df39cbb3ed9447']
p='.implementation-source-relations.json'
def run(*a):return subprocess.check_output(['git',*a])
def obj(c):return json.loads(run('show',c+':'+p))
for c in sync:
 first,second=run('rev-list','--parents','-n','1',c).decode().split()[1:]
 a,b,z=obj(first),obj(second),obj(c)
 ar,br,zr=a['relations'],b['relations'],z['relations']
 own=[x for x in ar if x not in br]
 if zr!=own+br or {k:v for k,v in z.items() if k!='relations'}!={k:v for k,v in b.items() if k!='relations'}:raise AssertionError('sync manifest mismatch '+c)
 if len(set(x['path'] for x in zr))!=len(zr):raise AssertionError('duplicate path '+c)
 print(c,'main_relations',len(br),'task_relations',len(own),'merged_relations',len(zr),'ordered_content=PASS')
PY
```
```output
Traceback (most recent call last):
  File "<stdin>", line 11, in <module>
AssertionError: sync manifest mismatch f9460639ab0b5e2cd7b05f4f109db13a51b64f01
```
退出码: 1

### q4manifesta
```command
python3 - <<'PY'
import subprocess,json
c='f9460639ab0b5e2cd7b05f4f109db13a51b64f01';p='.implementation-source-relations.json'
r=lambda x:json.loads(subprocess.check_output(['git','show',x+':'+p]))
f,m=subprocess.check_output(['git','rev-list','--parents','-n','1',c]).decode().split()[1:]
a,b,z=[r(x)['relations'] for x in (f,m,c)]
print('lengths',len(a),len(b),len(z))
print('first five merged',[x['path'] for x in z[:5]])
print('first five first',[x['path'] for x in a[:5]])
print('first five main',[x['path'] for x in b[:5]])
print('merged unique',len({x['path'] for x in z}))
print('first missing from merged',[x['path'] for x in a if x not in z][:5])
print('main missing from merged',[x['path'] for x in b if x not in z][:5])
PY
```
```output
lengths 318 306 317
first five merged ['sprints/10170627-cw-5190fd91/01-intent.md', 'sprints/10170627-cw-5190fd91/01-invariants.md', 'sprints/10170627-cw-5190fd91/02-response-r1.md', 'sprints/10170627-cw-5190fd91/02-response-r2.md', 'sprints/10170627-cw-5190fd91/02-review-r1.md']
first five first ['sprints/10170627-cw-5190fd91/01-intent.md', 'sprints/10170627-cw-5190fd91/01-invariants.md', 'sprints/10170627-cw-5190fd91/02-response-r1.md', 'sprints/10170627-cw-5190fd91/02-response-r2.md', 'sprints/10170627-cw-5190fd91/02-review-r1.md']
first five main ['docs/learnings/cp-10170325-ci-budget-headroom.md', 'packages/quality/__tests__/goldset-eval-cli.test.js', 'docs/learnings/cp-10170352-ci-consumer-source.md', 'docs/learnings/cp-10162312-source-diagnostics.md', 'docs/learnings/cp-10161920-cw-source-merge.md']
merged unique 317
first missing from merged ['changes/cp-10170325-ci-budget-headroom.md']
main missing from merged []
```
退出码: 0

