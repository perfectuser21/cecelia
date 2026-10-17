---
task_id: 5190fd91-d6c9-4247-850b-5700051a4830
step: evaluate
upstream: ["02-spec.md#Q-1", "02-spec.md#Q-2", "02-spec.md#Q-3", "02-spec.md#Q-4"]
---
# QA 报告（第 9 轮，环境 http://localhost:5301）

TESTED_HEAD: 83e9532d4f68a0da797664b7e8c4b9408988d894。固定 initial base: 04b88ddba4b1aa23a156d59734b4d88f621fe1e9。本轮可信来源投影的同步事件为 c6de1e67-4b53-4d8b-b097-4a711c619c67；它只作来源事实，产品结论以下列真实操作为准。03-build.md 与 04-evidence.md 在本轮 QA 会话内按控制器事实临时隐藏，完整恢复尚未发生，由会话后裁判核验。没有访问生产 Brain、外部 PR 或 Dashboard 页面；Q-1 至 Q-3 的合同对象为本地 CLI 与 README，Q-4 为仓库范围。历史 FAIL/CANNOT_VERIFY 保持原状，本报告只判当前 HEAD。

### T-1
对应: Q-1
verdict: PASS

空目录与不存在目录均返回精确 JSON `[]`、普通模式给出实际目录；显式 mtime 排序为 newer、older。README 参数、默认目录和“无记录不证明健康”断言通过。

```command
node -e 'const fs=require("fs"),os=require("os"),path=require("path"),cp=require("child_process"),assert=require("assert");const d=fs.mkdtempSync(path.join(os.tmpdir(),"qa-r9-q1-"));const cli="packages/brain/scripts/coding-workflow/runner/status.mjs";const run=(dir,json)=>cp.execFileSync(process.execPath,[cli,"--log-dir",dir,...(json?["--json"]:[])],{encoding:"utf8"}).trim();try{for(const dir of [d,path.join(d,"missing")]){const j=run(dir,true),t=run(dir,false);assert.equal(j,"[]");assert.equal(t,"没有运行记录（"+dir+"）");console.log(JSON.stringify({case:dir===d?"empty":"missing",json:j,text:t,exit:0}))}for(const n of ["older","newer"])fs.writeFileSync(path.join(d,n+".json"),JSON.stringify({status:"completed",outputs:{pr_url:"https://github.com/example/repo/pull/12"}}));fs.utimesSync(path.join(d,"older.json"),1000,1000);fs.utimesSync(path.join(d,"newer.json"),2000,2000);const rows=JSON.parse(run(d,true));assert.deepEqual(rows.map(x=>x.task_id),["newer","older"]);const s=fs.readFileSync("packages/brain/scripts/coding-workflow/runner/README.md","utf8");for(const x of ["--log-dir","--json","CODING_WF_LOG_DIR","mtime","倒序","不证明服务健康"])assert(s.includes(x),x);console.log(JSON.stringify({order:rows.map(x=>x.task_id),statuses:rows.map(x=>x.status),readme:"PASS",exit:0}))}finally{fs.rmSync(d,{recursive:true,force:true})}'
```
```output
{"case":"empty","json":"[]","text":"没有运行记录（/var/folders/z2/c1vyr94567g4hcyzw3hvyt2r0000gn/T/qa-r9-q1-fXMQhh）","exit":0}
{"case":"missing","json":"[]","text":"没有运行记录（/var/folders/z2/c1vyr94567g4hcyzw3hvyt2r0000gn/T/qa-r9-q1-fXMQhh/missing）","exit":0}
{"order":["newer","older"],"statuses":["completed","completed"],"readme":"PASS","exit":0}
```
退出码: 0

### T-2
对应: Q-2
verdict: PASS

同一临时目录造齐十类文件，CLI 返回九行；cifix 状态文件没有单独成行。普通输出和 JSON 的状态、原因、两次本地修复摘要一致，README 明确非 GitHub URL 与 unreadable 的判读边界。

```command
node -e 'const fs=require("fs"),os=require("os"),path=require("path"),cp=require("child_process"),assert=require("assert");const d=fs.mkdtempSync(path.join(os.tmpdir(),"qa-r9-q2-"));const cli="packages/brain/scripts/coding-workflow/runner/status.mjs";const put=(n,v)=>fs.writeFileSync(path.join(d,n+".json"),typeof v==="string"?v:JSON.stringify(v));const run=(json)=>cp.execFileSync(process.execPath,[cli,"--log-dir",d,...(json?["--json"]:[])],{encoding:"utf8"}).trim();try{put("run",{last_event:"working"});put("partial",{status:"partial",activities:[{key:"collect",status:"failed",attempts:[{reason_code:"collect_timeout"}]}]});put("failed",{status:"failed"});for(const [n,u] of [["ok","https://github.com/example/repo/pull/37"],["non-github","https://example.invalid/pull/37"]])put(n,{status:"completed",outputs:{pr_url:u}});put("cifix-37",{attempts:[{result:"failed"},{result:"passed"}]});for(const n of ["qa","commander","pr-sync-pending"])put(n,{state:"valid"});put("broken","{bad");const rows=JSON.parse(run(true)),m=Object.fromEntries(rows.map(x=>[x.task_id,x])),plain=run(false);assert.equal(rows.length,9);assert.equal(m.run.status,"running");assert.equal(m.partial.status,"partial");assert.equal(m.partial.reason_code,"collect_timeout");assert.equal(m.failed.status,"failed");assert.equal(m.failed.reason_code,"run_failed");for(const n of ["ok","non-github"]){assert.equal(m[n].status,"completed");assert.deepEqual(m[n].ci_fix,{attempts:2,last_result:"passed"});assert(plain.includes(n+"  completed"));assert(plain.includes("ci_fix=2次 last=passed"))}for(const n of ["qa","commander","pr-sync-pending","broken"])assert.equal(m[n].status,"unreadable");assert(!m["cifix-37"]);const s=fs.readFileSync("packages/brain/scripts/coding-workflow/runner/README.md","utf8");for(const x of ["running","completed","partial","failed","unreadable","pr-sync-pending.json","不能单独证明文件损坏","不能据此认定关联了有效 PR"])assert(s.includes(x),x);console.log(JSON.stringify({rows:rows.map(x=>[x.task_id,x.status,x.reason_code,x.ci_fix]),plain:plain.split("\n").map(x=>x.replace(/20\d\d-\d\d-\d\dT[^ ]+/,"<mtime>")),readme:"PASS",exit:0}))}finally{fs.rmSync(d,{recursive:true,force:true})}'
```
```output
{"rows":[["broken","unreadable",null,null],["pr-sync-pending","unreadable",null,null],["commander","unreadable",null,null],["qa","unreadable",null,null],["non-github","completed",null,{"attempts":2,"last_result":"passed"}],["ok","completed",null,{"attempts":2,"last_result":"passed"}],["failed","failed","run_failed",null],["partial","partial","collect_timeout",null],["run","running",null,null]],"plain":["broken  unreadable  <mtime>  failed_activity=- reason_code=-","pr-sync-pending  unreadable  <mtime>  failed_activity=- reason_code=-","commander  unreadable  <mtime>  failed_activity=- reason_code=-","qa  unreadable  <mtime>  failed_activity=- reason_code=-","non-github  completed  <mtime>  https://example.invalid/pull/37  ci_fix=2次 last=passed","ok  completed  <mtime>  https://github.com/example/repo/pull/37  ci_fix=2次 last=passed","failed  failed  <mtime>  failed_activity=- reason_code=run_failed","partial  partial  <mtime>  failed_activity=collect reason_code=collect_timeout","run  running  <mtime>  failed_activity=- reason_code=-"],"readme":"PASS","exit":0}
```
退出码: 0

### T-3
对应: Q-3
verdict: PASS

缺 PR URL 的 completed 在 JSON 中保留状态并标记 pr_url_missing，普通行不显示该原因；无 cifix 时为 null。README 要求另核 PR/head 实际合并与 Brain/QA 终态，禁止手工改历史记录。本场景使用合成 URL，不声称实际合并。

```command
node -e 'const fs=require("fs"),os=require("os"),path=require("path"),cp=require("child_process"),assert=require("assert");const d=fs.mkdtempSync(path.join(os.tmpdir(),"qa-r9-q3-"));const cli="packages/brain/scripts/coding-workflow/runner/status.mjs";const run=(json)=>cp.execFileSync(process.execPath,[cli,"--log-dir",d,...(json?["--json"]:[])],{encoding:"utf8"}).trim();try{fs.writeFileSync(path.join(d,"missing-pr.json"),JSON.stringify({status:"completed",outputs:{}}));fs.writeFileSync(path.join(d,"with-pr.json"),JSON.stringify({status:"completed",outputs:{pr_url:"https://github.com/example/repo/pull/38"}}));const json=run(true),plain=run(false),rows=JSON.parse(json),m=Object.fromEntries(rows.map(x=>[x.task_id,x]));assert.equal(m["missing-pr"].status,"completed");assert.equal(m["missing-pr"].reason_code,"pr_url_missing");assert.equal(m["missing-pr"].pr_url,null);assert.equal(m["with-pr"].ci_fix,null);assert(!plain.includes("pr_url_missing"));const s=fs.readFileSync("packages/brain/scripts/coding-workflow/runner/README.md","utf8");for(const x of ["pr_url_missing","--json","当前 head","实际合并","runner.phase=merged","merge.merged=true","QA 终态","不手工更改批准状态或历史 FAIL"])assert(s.includes(x),x);console.log("JSON "+json);console.log("TEXT "+plain);console.log("README PASS; exit=0")}finally{fs.rmSync(d,{recursive:true,force:true})}'
```
```output
JSON [{"task_id":"with-pr","mtime":"2026-10-17T05:52:55.679Z","status":"completed","failed_activity":null,"reason_code":null,"pr_url":"https://github.com/example/repo/pull/38","ci_fix":null},{"task_id":"missing-pr","mtime":"2026-10-17T05:52:55.679Z","status":"completed","failed_activity":null,"reason_code":"pr_url_missing","pr_url":null,"ci_fix":null}]
TEXT with-pr  completed  2026-10-17T05:52:55.679Z  https://github.com/example/repo/pull/38
missing-pr  completed  2026-10-17T05:52:55.679Z
README PASS; exit=0
```
退出码: 0

### T-4
对应: Q-4
verdict: PASS

固定 HEAD 与 16 个提交的完整 DAG 已核。合并提交两条父边均纳入。每条 raw 路径的旧/新 mode、完整 blob ID、字节数和重算 Git 对象哈希逐项核验；可见内容按来源规则核验。README 基线原字节逐行按原顺序保留；两次规格修改为纯追加；每次自产 manifest 的历史关系原文后缀逐字保留，新增行检查路径、owner、role 和当时 Git 文件存在；同步 manifest 保留真实 main 历史并加 11 条本任务关系。上游八条路径的合并内容与 main 父版本一致；另一父边的 README 与报告与任务父版本一致。被隔离两份仅在进程内计算对象哈希与字节数，未输出正文。来源投影给出的六个关键文件 SHA256 与当前 Git 对象一致。完整恢复、正式 CI、远端合并、Brain 终态、Learning 与下次 tick 均未在本 QA 会话发生，留待后续关卡。

#### 固定 HEAD

```command
git rev-parse HEAD
```
```output
83e9532d4f68a0da797664b7e8c4b9408988d894
```
退出码: 0

#### 完整 DAG

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
```
退出码: 0

#### 固定基线到 HEAD 的全仓差异

```command
git diff --name-status 04b88ddba4b1aa23a156d59734b4d88f621fe1e9 HEAD
```
```output
M	.brain-versions
M	.implementation-source-relations.json
M	DEFINITION.md
D	changes/cp-10170325-ci-budget-headroom.md
M	package-lock.json
M	packages/brain/VERSION
M	packages/brain/package-lock.json
M	packages/brain/package.json
M	packages/brain/scripts/coding-workflow/runner/README.md
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
A	sprints/10170627-cw-5190fd91/06-judge-r2.md
A	sprints/10170627-cw-5190fd91/06-judge-r3.md
A	sprints/10170627-cw-5190fd91/06-judge-r4.md
A	sprints/10170627-cw-5190fd91/06-judge-r5.md
A	sprints/10170627-cw-5190fd91/06-judge-r6.md
A	sprints/10170627-cw-5190fd91/06-judge-r7.md
A	sprints/10170627-cw-5190fd91/06-judge-r8.md
A	sprints/10170627-cw-5190fd91/07-commander-r1.md
A	sprints/10170627-cw-5190fd91/07-commander-r2.md
```
退出码: 0

#### 暂存区

```command
git diff --cached --name-status
```
```output

```
退出码: 0

#### 工作区（两份受控隔离）

```command
git diff --name-status
```
```output
D	sprints/10170627-cw-5190fd91/03-build.md
D	sprints/10170627-cw-5190fd91/04-evidence.md
```
退出码: 0

#### 全仓未跟踪

```command
git ls-files --others --exclude-standard
```
```output

```
退出码: 0

#### 逐父边、逐 blob、逐内容和来源投影最终审计

```command
python3 - <<'PY'
import subprocess,json,hashlib,re,sys,difflib
B="04b88ddba4b1aa23a156d59734b4d88f621fe1e9"
H="83e9532d4f68a0da797664b7e8c4b9408988d894"
MAIN="53cdf746c0c7f446cb7b6987e170d76248999f1d"
S="sprints/10170627-cw-5190fd91/"
OWNER="packages/brain/scripts/coding-workflow/runner/run-once.mjs"
README="packages/brain/scripts/coding-workflow/runner/README.md"
MAN=".implementation-source-relations.json"
def g(*a):
 p=subprocess.run(["git",*a],stdout=subprocess.PIPE,stderr=subprocess.PIPE)
 if p.returncode: raise RuntimeError((a,p.stderr.decode()))
 return p.stdout
def blob(h):
 if h=="0"*40:return None
 b=g("cat-file","blob",h)
 size=int(g("cat-file","-s",h))
 digest=hashlib.sha1(b"blob "+str(len(b)).encode()+b"\0"+b).hexdigest()
 assert len(b)==size and digest==h,(h,size,len(b),digest)
 return b
def at(c,p):
 q=subprocess.run(["git","show",c+":"+p],stdout=subprocess.PIPE,stderr=subprocess.PIPE)
 return q.stdout if q.returncode==0 else None
def order(old,new):
 a=old.splitlines(keepends=True);b=new.splitlines(keepends=True);i=0
 for x in b:
  if i<len(a) and x==a[i]:i+=1
 return i==len(a)
def manifest(a,b,c,merge=False):
 old=json.loads(a);new=json.loads(b)
 assert old.keys()==new.keys() and all(old[k]==new[k] for k in old if k!="relations")
 x=old["relations"];y=new["relations"]
 if merge:
  mainraw=at(MAIN,MAN);main=json.loads(mainraw)["relations"]
  assert b.endswith(mainraw[mainraw.index(b'    {"owner_path"'):])
  task=[z for z in x if z["path"].startswith(S)]
  assert y==task+main,("merge manifest",len(y),len(task),len(main))
  return "main_history_plus_task_prefix="+str(len(task))
 assert y[-len(x):]==x if x else True
 assert b.endswith(a[a.index(b'    {"owner_path"'):])
 add=y[:len(y)-len(x)]
 for z in add:
  p=z["path"]
  assert set(z)=={"owner_path","path","role"} and z["owner_path"]==OWNER and z["role"]=="documentation" and p.startswith(S) and re.fullmatch(r"(?:01-(?:intent|invariants)|02-(?:spec|review|review-r[1-9][0-9]*|response-r[1-9][0-9]*)|03-build|04-evidence|05-qa-report-r[1-9][0-9]*|06-judge-r[1-9][0-9]*|07-commander-r[1-9][0-9]*)\.md",p[len(S):]),z
  assert at(c,p) is not None,p
 assert len({z["path"] for z in y})==len(y)
 return "preserved="+str(len(x))+" added="+str(len(add))
rows=g("rev-list","--reverse","--topo-order","--parents",B+".."+H).decode().splitlines()
assert len(rows)==16 and rows[-1].split()[0]==H
assert g("rev-list","--parents","-n","1",MAIN).decode().split()[1:]==[B]
base_readme=at(B,README);assert base_readme
for row in rows:
 c,*ps=row.split()
 for pi,p in enumerate(ps):
  raw=g("diff-tree","--no-commit-id","--raw","--no-abbrev","--no-renames","-r","-z",p,c)
  parts=raw.split(b"\0");items=[]
  for i in range(0,len(parts)-1,2):
   meta,path=parts[i].decode(),parts[i+1].decode()
   mm=re.fullmatch(r":([0-7]{6}) ([0-7]{6}) ([0-9a-f]{40}) ([0-9a-f]{40}) ([A-Z])",meta)
   assert mm,(c,p,meta,path)
   om,nm,oh,nh,st=mm.groups();old,new=blob(oh),blob(nh)
   assert (old is None)==(om=="000000") and (new is None)==(nm=="000000")
   assert at(p,path)==old and at(c,path)==new
   if c==MAIN:
    assert path not in (README,) and not path.startswith(S)
    rule="upstream_content"
   elif len(ps)==2 and pi==0:
    assert c=="f9460639ab0b5e2cd7b05f4f109db13a51b64f01" and ps[1]==MAIN
    assert path not in (README,) and not path.startswith(S)
    if path==MAN:rule=manifest(old,new,c,True)
    else:
     assert new==at(MAIN,path)
     rule="equals_main"
   elif len(ps)==2 and pi==1:
    assert path==README or path.startswith(S) or path==MAN
    if path==MAN:rule="task_manifest_retained"
    else:
     assert new==at(ps[0],path)
     rule="equals_task_parent"
   elif path==README:
    assert order(base_readme,new)
    rule="base_lines_preserved"
   elif path==MAN:
    rule=manifest(old,new,c)
   elif path.startswith(S):
    assert st=="A" or (path==S+"02-spec.md" and st=="M"),(c,path,st)
    if path in (S+"03-build.md",S+"04-evidence.md"):
     rule="isolated_blob_identity_only"
    elif st=="M":
     marker={ "200baf82ef92f25d8b10031b52596b1e24fb70a7":"## commander 裁决（第 1 次）","eb96ceb14f76a1572145644d5defc1fec6a49f1b":"## commander 裁决（第 2 次）"}.get(c)
     assert marker and new.startswith(old) and new[len(old):].strip().startswith(marker.encode()),(c,path)
     rule="spec_pure_append"
    else:
     assert len(new)>0,(c,path,st)
     rule="new_task_report_content"
   else:
    raise AssertionError(("unattributed",c,path))
   items.append((path,om,nm,oh,nh,len(old) if old else 0,len(new) if new else 0,rule))
  print("EDGE",c,p,"paths",len(items))
  for path,om,nm,oh,nh,osz,nsz,rule in items:
   print("PATH",path,"mode",om,nm,"old",oh,osz,"new",nh,nsz,"hash=ok","content="+rule)
assert order(base_readme,at(H,README))
expected={S+"01-intent.md":"745869be58738e2b0a05d54dc7f7627b8f71e0048e046f7a262b8a12e295f4ff",S+"02-spec.md":"4cf8ff0ad96e85c344ed31b00b1cac1e9e189a0cf9c78239000775445350c6cb",S+"03-build.md":"21c829a988c486f86688fbda67cbf2839ea106939b277496abc7bdbb88b4fe80",S+"04-evidence.md":"bdd4d537f13d0d487018e8f570bdbba20d48e4b46df35788cd8c22fb498ed69c",S+"05-qa-report-r8.md":"a616c6793af7398573d100b4311db2de620c16c7cbcf5efd291f4575952765d5",S+"06-judge-r8.md":"f2184708d199660f3a3b3428dbe44cec0da208ea4f36a2e958b689057482939e"}
for path,want in expected.items():
 assert hashlib.sha256(at(H,path)).hexdigest()==want,path
 print("PROVENANCE_SHA256",path,"PASS")
print("HEAD",H,"commits",len(rows),"README_BASE_ORDER=PASS","ALL_EDGES_BLOBS_CONTENT=PASS")
PY
```
```output
EDGE 178f61849d85be5a9370f23c033e48ae006cfe25 04b88ddba4b1aa23a156d59734b4d88f621fe1e9 paths 1
PATH packages/brain/scripts/coding-workflow/runner/README.md mode 100644 100644 old 6e6eb65f64c55bdad786b619e2e9a4ef66225297 10889 new 3e8eea166d021b985bff0c71e1ccbc87d234d248 13572 hash=ok content=base_lines_preserved
EDGE 42943dfe5fc3f0680291322a5440bcd46159cbeb 178f61849d85be5a9370f23c033e48ae006cfe25 paths 12
PATH .implementation-source-relations.json mode 100644 100644 old b4d00c4f7ea1c087ce0511769e1e25299326cbfd 54286 new 24de93e0438b1c2a800654e7e0407b2949ef5233 56013 hash=ok content=preserved=307 added=11
PATH sprints/10170627-cw-5190fd91/01-intent.md mode 000000 100644 old 0000000000000000000000000000000000000000 0 new 3a1529d7a143b6fdcf1305b9d72480c22c4d3a8c 15486 hash=ok content=new_task_report_content
PATH sprints/10170627-cw-5190fd91/01-invariants.md mode 000000 100644 old 0000000000000000000000000000000000000000 0 new 2276b9f0bca1d5fd3e422ef6e962e1259e266703 89736 hash=ok content=new_task_report_content
PATH sprints/10170627-cw-5190fd91/02-response-r1.md mode 000000 100644 old 0000000000000000000000000000000000000000 0 new f89998664a7a99d3f8bfc0b8b4f0ac0955c8b83a 589 hash=ok content=new_task_report_content
PATH sprints/10170627-cw-5190fd91/02-response-r2.md mode 000000 100644 old 0000000000000000000000000000000000000000 0 new 677402ca401d014befa03669d7b1a1aa04a917b2 1084 hash=ok content=new_task_report_content
PATH sprints/10170627-cw-5190fd91/02-review-r1.md mode 000000 100644 old 0000000000000000000000000000000000000000 0 new 8b068bd99a4c2f5abc189032698f21ad8e267be6 1223 hash=ok content=new_task_report_content
PATH sprints/10170627-cw-5190fd91/02-review-r2.md mode 000000 100644 old 0000000000000000000000000000000000000000 0 new 7c80b836bc8c5469525c21273be83ad0e8dde8fc 1436 hash=ok content=new_task_report_content
PATH sprints/10170627-cw-5190fd91/02-review-r3.md mode 000000 100644 old 0000000000000000000000000000000000000000 0 new e6922e12ac037d6b2ac8839985f3434b9d4f48e5 1113 hash=ok content=new_task_report_content
PATH sprints/10170627-cw-5190fd91/02-review.md mode 000000 100644 old 0000000000000000000000000000000000000000 0 new e6922e12ac037d6b2ac8839985f3434b9d4f48e5 1113 hash=ok content=new_task_report_content
PATH sprints/10170627-cw-5190fd91/02-spec.md mode 000000 100644 old 0000000000000000000000000000000000000000 0 new 9827a68e93e8e7d2b0c21dcb517cb6c6848e2093 18898 hash=ok content=new_task_report_content
PATH sprints/10170627-cw-5190fd91/03-build.md mode 000000 100644 old 0000000000000000000000000000000000000000 0 new 0d96f563734111cfdcd2049a91b8d0973da5adff 5095 hash=ok content=isolated_blob_identity_only
PATH sprints/10170627-cw-5190fd91/04-evidence.md mode 000000 100644 old 0000000000000000000000000000000000000000 0 new 46a81734ed6702902319dcbe09f211bf692b0f88 9894 hash=ok content=isolated_blob_identity_only
EDGE 53cdf746c0c7f446cb7b6987e170d76248999f1d 04b88ddba4b1aa23a156d59734b4d88f621fe1e9 paths 8
PATH .brain-versions mode 100644 100644 old 765a3cb613f52cc52b92c04158a540cbe7fba43d 9 new f3d261425e53f40ece495da8192f24c6040c909d 9 hash=ok content=upstream_content
PATH .implementation-source-relations.json mode 100644 100644 old b4d00c4f7ea1c087ce0511769e1e25299326cbfd 54286 new ffadfb9335a468ec6b871f54fd9a6db08ae9e09d 54140 hash=ok content=upstream_content
PATH DEFINITION.md mode 100644 100644 old c61152020942f82f1de6315cb58dda302a1e92cc 769540 new a4b46caf2f7230368a87796071009b8b35fcc44b 770019 hash=ok content=upstream_content
PATH changes/cp-10170325-ci-budget-headroom.md mode 100644 000000 old 61678453253490efe1e7e647f808ac43965eaac1 479 new 0000000000000000000000000000000000000000 0 hash=ok content=upstream_content
PATH package-lock.json mode 100644 100644 old f6a79a39a78356e1a59b763567ac45af92e79f5b 698744 new aaeb525fdffb110004342b8c6b4f96893d362179 698744 hash=ok content=upstream_content
PATH packages/brain/VERSION mode 100644 100644 old 765a3cb613f52cc52b92c04158a540cbe7fba43d 9 new f3d261425e53f40ece495da8192f24c6040c909d 9 hash=ok content=upstream_content
PATH packages/brain/package-lock.json mode 100644 100644 old bd0894471f6609afd0506fb31cabb315e8a97b25 378833 new ecb84839f8de085394f8aa50dd5f0100b1e99465 378833 hash=ok content=upstream_content
PATH packages/brain/package.json mode 100644 100644 old 5451dac0247ba38ee91ec7441f0ef79426ad37b5 1998 new b6a3c1c890593a7bc828afa573a4ccaff05ab2c0 1998 hash=ok content=upstream_content
EDGE f9460639ab0b5e2cd7b05f4f109db13a51b64f01 42943dfe5fc3f0680291322a5440bcd46159cbeb paths 8
PATH .brain-versions mode 100644 100644 old 765a3cb613f52cc52b92c04158a540cbe7fba43d 9 new f3d261425e53f40ece495da8192f24c6040c909d 9 hash=ok content=equals_main
PATH .implementation-source-relations.json mode 100644 100644 old 24de93e0438b1c2a800654e7e0407b2949ef5233 56013 new c4f2bb176e606551a32bf9a676b77ea69452efc4 55867 hash=ok content=main_history_plus_task_prefix=11
PATH DEFINITION.md mode 100644 100644 old c61152020942f82f1de6315cb58dda302a1e92cc 769540 new a4b46caf2f7230368a87796071009b8b35fcc44b 770019 hash=ok content=equals_main
PATH changes/cp-10170325-ci-budget-headroom.md mode 100644 000000 old 61678453253490efe1e7e647f808ac43965eaac1 479 new 0000000000000000000000000000000000000000 0 hash=ok content=equals_main
PATH package-lock.json mode 100644 100644 old f6a79a39a78356e1a59b763567ac45af92e79f5b 698744 new aaeb525fdffb110004342b8c6b4f96893d362179 698744 hash=ok content=equals_main
PATH packages/brain/VERSION mode 100644 100644 old 765a3cb613f52cc52b92c04158a540cbe7fba43d 9 new f3d261425e53f40ece495da8192f24c6040c909d 9 hash=ok content=equals_main
PATH packages/brain/package-lock.json mode 100644 100644 old bd0894471f6609afd0506fb31cabb315e8a97b25 378833 new ecb84839f8de085394f8aa50dd5f0100b1e99465 378833 hash=ok content=equals_main
PATH packages/brain/package.json mode 100644 100644 old 5451dac0247ba38ee91ec7441f0ef79426ad37b5 1998 new b6a3c1c890593a7bc828afa573a4ccaff05ab2c0 1998 hash=ok content=equals_main
EDGE f9460639ab0b5e2cd7b05f4f109db13a51b64f01 53cdf746c0c7f446cb7b6987e170d76248999f1d paths 13
PATH .implementation-source-relations.json mode 100644 100644 old ffadfb9335a468ec6b871f54fd9a6db08ae9e09d 54140 new c4f2bb176e606551a32bf9a676b77ea69452efc4 55867 hash=ok content=task_manifest_retained
PATH packages/brain/scripts/coding-workflow/runner/README.md mode 100644 100644 old 6e6eb65f64c55bdad786b619e2e9a4ef66225297 10889 new 3e8eea166d021b985bff0c71e1ccbc87d234d248 13572 hash=ok content=equals_task_parent
PATH sprints/10170627-cw-5190fd91/01-intent.md mode 000000 100644 old 0000000000000000000000000000000000000000 0 new 3a1529d7a143b6fdcf1305b9d72480c22c4d3a8c 15486 hash=ok content=equals_task_parent
PATH sprints/10170627-cw-5190fd91/01-invariants.md mode 000000 100644 old 0000000000000000000000000000000000000000 0 new 2276b9f0bca1d5fd3e422ef6e962e1259e266703 89736 hash=ok content=equals_task_parent
PATH sprints/10170627-cw-5190fd91/02-response-r1.md mode 000000 100644 old 0000000000000000000000000000000000000000 0 new f89998664a7a99d3f8bfc0b8b4f0ac0955c8b83a 589 hash=ok content=equals_task_parent
PATH sprints/10170627-cw-5190fd91/02-response-r2.md mode 000000 100644 old 0000000000000000000000000000000000000000 0 new 677402ca401d014befa03669d7b1a1aa04a917b2 1084 hash=ok content=equals_task_parent
PATH sprints/10170627-cw-5190fd91/02-review-r1.md mode 000000 100644 old 0000000000000000000000000000000000000000 0 new 8b068bd99a4c2f5abc189032698f21ad8e267be6 1223 hash=ok content=equals_task_parent
PATH sprints/10170627-cw-5190fd91/02-review-r2.md mode 000000 100644 old 0000000000000000000000000000000000000000 0 new 7c80b836bc8c5469525c21273be83ad0e8dde8fc 1436 hash=ok content=equals_task_parent
PATH sprints/10170627-cw-5190fd91/02-review-r3.md mode 000000 100644 old 0000000000000000000000000000000000000000 0 new e6922e12ac037d6b2ac8839985f3434b9d4f48e5 1113 hash=ok content=equals_task_parent
PATH sprints/10170627-cw-5190fd91/02-review.md mode 000000 100644 old 0000000000000000000000000000000000000000 0 new e6922e12ac037d6b2ac8839985f3434b9d4f48e5 1113 hash=ok content=equals_task_parent
PATH sprints/10170627-cw-5190fd91/02-spec.md mode 000000 100644 old 0000000000000000000000000000000000000000 0 new 9827a68e93e8e7d2b0c21dcb517cb6c6848e2093 18898 hash=ok content=equals_task_parent
PATH sprints/10170627-cw-5190fd91/03-build.md mode 000000 100644 old 0000000000000000000000000000000000000000 0 new 0d96f563734111cfdcd2049a91b8d0973da5adff 5095 hash=ok content=equals_task_parent
PATH sprints/10170627-cw-5190fd91/04-evidence.md mode 000000 100644 old 0000000000000000000000000000000000000000 0 new 46a81734ed6702902319dcbe09f211bf692b0f88 9894 hash=ok content=equals_task_parent
EDGE f3dbd423fab3eddea650ac361d4651f393cfd40f f9460639ab0b5e2cd7b05f4f109db13a51b64f01 paths 2
PATH .implementation-source-relations.json mode 100644 100644 old c4f2bb176e606551a32bf9a676b77ea69452efc4 55867 new f3d532f650f678b481fb7125e80f72231bf50d2e 56028 hash=ok content=preserved=317 added=1
PATH sprints/10170627-cw-5190fd91/05-qa-report-r1.md mode 000000 100644 old 0000000000000000000000000000000000000000 0 new 766cc68f7f0cb7bd81da2711b7eb920992f04c05 19119 hash=ok content=new_task_report_content
EDGE 200baf82ef92f25d8b10031b52596b1e24fb70a7 f3dbd423fab3eddea650ac361d4651f393cfd40f paths 1
PATH sprints/10170627-cw-5190fd91/02-spec.md mode 100644 100644 old 9827a68e93e8e7d2b0c21dcb517cb6c6848e2093 18898 new 51450ee5ebc6651ffd41d88a24e283dafa5ca9ae 21682 hash=ok content=spec_pure_append
EDGE ea0573f2d1e2a95f5cb7727a70c581d325b1fd21 200baf82ef92f25d8b10031b52596b1e24fb70a7 paths 2
PATH .implementation-source-relations.json mode 100644 100644 old f3d532f650f678b481fb7125e80f72231bf50d2e 56028 new f0d372e0cb26eb55d12f9def947b73c081b8f963 56189 hash=ok content=preserved=318 added=1
PATH sprints/10170627-cw-5190fd91/07-commander-r1.md mode 000000 100644 old 0000000000000000000000000000000000000000 0 new fc178a6a802a0410e83cdf2c9c03233f8206bb1c 876 hash=ok content=new_task_report_content
EDGE 8fa7a1c035bd76335c99fe71ed7450d5832b49e8 ea0573f2d1e2a95f5cb7727a70c581d325b1fd21 paths 3
PATH .implementation-source-relations.json mode 100644 100644 old f0d372e0cb26eb55d12f9def947b73c081b8f963 56189 new eab6aa5c1fbf307fe497d8450d3b9837ecb6977b 56507 hash=ok content=preserved=319 added=2
PATH sprints/10170627-cw-5190fd91/05-qa-report-r2.md mode 000000 100644 old 0000000000000000000000000000000000000000 0 new 05e0b0b9c9bb8608cbceed644e7c8b9e8243aeee 49562 hash=ok content=new_task_report_content
PATH sprints/10170627-cw-5190fd91/06-judge-r2.md mode 000000 100644 old 0000000000000000000000000000000000000000 0 new 51c02fb04eab523db35539b6572f2fd7d5a87fc4 2629 hash=ok content=new_task_report_content
EDGE a36edb98dcf000ff653236e7674cac6117e30652 8fa7a1c035bd76335c99fe71ed7450d5832b49e8 paths 3
PATH .implementation-source-relations.json mode 100644 100644 old eab6aa5c1fbf307fe497d8450d3b9837ecb6977b 56507 new 4d1cf2084a034d37f44b2893f054eada20711b7b 56825 hash=ok content=preserved=321 added=2
PATH sprints/10170627-cw-5190fd91/05-qa-report-r3.md mode 000000 100644 old 0000000000000000000000000000000000000000 0 new 80d07eb72ebecb771c35ecc1222d36943b5ee8cf 31961 hash=ok content=new_task_report_content
PATH sprints/10170627-cw-5190fd91/06-judge-r3.md mode 000000 100644 old 0000000000000000000000000000000000000000 0 new 19cf8a90460a19162ad5658eed7a52afbca7b245 2604 hash=ok content=new_task_report_content
EDGE eb96ceb14f76a1572145644d5defc1fec6a49f1b a36edb98dcf000ff653236e7674cac6117e30652 paths 1
PATH sprints/10170627-cw-5190fd91/02-spec.md mode 100644 100644 old 51450ee5ebc6651ffd41d88a24e283dafa5ca9ae 21682 new ac6a959af50bb4cc8c451ec9a63fb8b40249f55a 24118 hash=ok content=spec_pure_append
EDGE 6e0b4202c1b659de1bf99ad62d42c73d09dca6bc eb96ceb14f76a1572145644d5defc1fec6a49f1b paths 2
PATH .implementation-source-relations.json mode 100644 100644 old 4d1cf2084a034d37f44b2893f054eada20711b7b 56825 new c310edb1cf5a2cec343b63b1f6880d644b14bb9e 56986 hash=ok content=preserved=323 added=1
PATH sprints/10170627-cw-5190fd91/07-commander-r2.md mode 000000 100644 old 0000000000000000000000000000000000000000 0 new 8557e2041e46ac98747c39b971362faa73c01476 814 hash=ok content=new_task_report_content
EDGE 6f6b6af1ad459f88536235f94a8f585fdead34d5 6e0b4202c1b659de1bf99ad62d42c73d09dca6bc paths 3
PATH .implementation-source-relations.json mode 100644 100644 old c310edb1cf5a2cec343b63b1f6880d644b14bb9e 56986 new 7959d010b9929becc96b6ec4f49a09794436f986 57304 hash=ok content=preserved=324 added=2
PATH sprints/10170627-cw-5190fd91/05-qa-report-r4.md mode 000000 100644 old 0000000000000000000000000000000000000000 0 new 87fb6a1d598e87fe04037c492ba89bd0d9e4b673 30876 hash=ok content=new_task_report_content
PATH sprints/10170627-cw-5190fd91/06-judge-r4.md mode 000000 100644 old 0000000000000000000000000000000000000000 0 new d160e5c15e7d84936779f0130ee8d5ee714589f2 3147 hash=ok content=new_task_report_content
EDGE acc49fa52b4ed059df42560a54663e6f34ad7ff7 6f6b6af1ad459f88536235f94a8f585fdead34d5 paths 3
PATH .implementation-source-relations.json mode 100644 100644 old 7959d010b9929becc96b6ec4f49a09794436f986 57304 new 12c7a90aa088564674dff14f80493b660bafdecf 57622 hash=ok content=preserved=326 added=2
PATH sprints/10170627-cw-5190fd91/05-qa-report-r5.md mode 000000 100644 old 0000000000000000000000000000000000000000 0 new 688569245080675321cd6e221576d446e4891a09 16278 hash=ok content=new_task_report_content
PATH sprints/10170627-cw-5190fd91/06-judge-r5.md mode 000000 100644 old 0000000000000000000000000000000000000000 0 new 2d9eb07b649746b2c46b592c9fb994d89afec79c 3122 hash=ok content=new_task_report_content
EDGE 15c90a4a0021a40170e46aeacf6fddc91d563cf0 acc49fa52b4ed059df42560a54663e6f34ad7ff7 paths 3
PATH .implementation-source-relations.json mode 100644 100644 old 12c7a90aa088564674dff14f80493b660bafdecf 57622 new c41636011cd352bf88b75b263900869615f54545 57940 hash=ok content=preserved=328 added=2
PATH sprints/10170627-cw-5190fd91/05-qa-report-r6.md mode 000000 100644 old 0000000000000000000000000000000000000000 0 new 06675ebe45a8fe0bb2df689097c7f7e08df2962b 19071 hash=ok content=new_task_report_content
PATH sprints/10170627-cw-5190fd91/06-judge-r6.md mode 000000 100644 old 0000000000000000000000000000000000000000 0 new 6d491ef52f7145dd367f863ab358b06e6458cbd9 2777 hash=ok content=new_task_report_content
EDGE 52e2106ed03b255f18fa834ff33cf1315944e307 15c90a4a0021a40170e46aeacf6fddc91d563cf0 paths 3
PATH .implementation-source-relations.json mode 100644 100644 old c41636011cd352bf88b75b263900869615f54545 57940 new 1e5b7a23fe5fc8ddc638cd35fcd97681ebbd6773 58258 hash=ok content=preserved=330 added=2
PATH sprints/10170627-cw-5190fd91/05-qa-report-r7.md mode 000000 100644 old 0000000000000000000000000000000000000000 0 new 041d7d6d327c5d54c55f9d18aaa58bb0df1b3f1f 11400 hash=ok content=new_task_report_content
PATH sprints/10170627-cw-5190fd91/06-judge-r7.md mode 000000 100644 old 0000000000000000000000000000000000000000 0 new c2060875f9c27303aa8843a0e7f26ec70af900c2 3555 hash=ok content=new_task_report_content
EDGE 83e9532d4f68a0da797664b7e8c4b9408988d894 52e2106ed03b255f18fa834ff33cf1315944e307 paths 3
PATH .implementation-source-relations.json mode 100644 100644 old 1e5b7a23fe5fc8ddc638cd35fcd97681ebbd6773 58258 new d1f7ac6374e0ecba3e356de7775de5117eadb496 58576 hash=ok content=preserved=332 added=2
PATH sprints/10170627-cw-5190fd91/05-qa-report-r8.md mode 000000 100644 old 0000000000000000000000000000000000000000 0 new addc857f7c2b240942075415b9808d598ed6426f 29257 hash=ok content=new_task_report_content
PATH sprints/10170627-cw-5190fd91/06-judge-r8.md mode 000000 100644 old 0000000000000000000000000000000000000000 0 new b6d7969319acd43ce65e13921740445f10332304 2716 hash=ok content=new_task_report_content
PROVENANCE_SHA256 sprints/10170627-cw-5190fd91/01-intent.md PASS
PROVENANCE_SHA256 sprints/10170627-cw-5190fd91/02-spec.md PASS
PROVENANCE_SHA256 sprints/10170627-cw-5190fd91/03-build.md PASS
PROVENANCE_SHA256 sprints/10170627-cw-5190fd91/04-evidence.md PASS
PROVENANCE_SHA256 sprints/10170627-cw-5190fd91/05-qa-report-r8.md PASS
PROVENANCE_SHA256 sprints/10170627-cw-5190fd91/06-judge-r8.md PASS
HEAD 83e9532d4f68a0da797664b7e8c4b9408988d894 commits 16 README_BASE_ORDER=PASS ALL_EDGES_BLOBS_CONTENT=PASS
```
退出码: 0

以下保留本轮审计编写期间的全部失败尝试、调查与修正命令。失败原因是审计脚本过严或类型错误，随后以最终审计命令重跑且退出码为 0；这些失败不改写历史报告。

#### q4probe

```command
git diff-tree --numstat -r 04b88ddba4b1aa23a156d59734b4d88f621fe1e9 53cdf746c0c7f446cb7b6987e170d76248999f1d
```
```output
1	1	.brain-versions
1	1	.implementation-source-relations.json
5	1	DEFINITION.md
0	3	changes/cp-10170325-ci-budget-headroom.md
1	1	package-lock.json
1	1	packages/brain/VERSION
2	2	packages/brain/package-lock.json
1	1	packages/brain/package.json
```
退出码: 0

#### q4fixprobe

```command
git diff-tree --no-commit-id --raw --no-abbrev --no-renames -r 178f61849d85be5a9370f23c033e48ae006cfe25 42943dfe5fc3f0680291322a5440bcd46159cbeb
```
```output
:100644 100644 b4d00c4f7ea1c087ce0511769e1e25299326cbfd 24de93e0438b1c2a800654e7e0407b2949ef5233 M	.implementation-source-relations.json
:000000 100644 0000000000000000000000000000000000000000 3a1529d7a143b6fdcf1305b9d72480c22c4d3a8c A	sprints/10170627-cw-5190fd91/01-intent.md
:000000 100644 0000000000000000000000000000000000000000 2276b9f0bca1d5fd3e422ef6e962e1259e266703 A	sprints/10170627-cw-5190fd91/01-invariants.md
:000000 100644 0000000000000000000000000000000000000000 f89998664a7a99d3f8bfc0b8b4f0ac0955c8b83a A	sprints/10170627-cw-5190fd91/02-response-r1.md
:000000 100644 0000000000000000000000000000000000000000 677402ca401d014befa03669d7b1a1aa04a917b2 A	sprints/10170627-cw-5190fd91/02-response-r2.md
:000000 100644 0000000000000000000000000000000000000000 8b068bd99a4c2f5abc189032698f21ad8e267be6 A	sprints/10170627-cw-5190fd91/02-review-r1.md
:000000 100644 0000000000000000000000000000000000000000 7c80b836bc8c5469525c21273be83ad0e8dde8fc A	sprints/10170627-cw-5190fd91/02-review-r2.md
:000000 100644 0000000000000000000000000000000000000000 e6922e12ac037d6b2ac8839985f3434b9d4f48e5 A	sprints/10170627-cw-5190fd91/02-review-r3.md
:000000 100644 0000000000000000000000000000000000000000 e6922e12ac037d6b2ac8839985f3434b9d4f48e5 A	sprints/10170627-cw-5190fd91/02-review.md
:000000 100644 0000000000000000000000000000000000000000 9827a68e93e8e7d2b0c21dcb517cb6c6848e2093 A	sprints/10170627-cw-5190fd91/02-spec.md
:000000 100644 0000000000000000000000000000000000000000 0d96f563734111cfdcd2049a91b8d0973da5adff A	sprints/10170627-cw-5190fd91/03-build.md
:000000 100644 0000000000000000000000000000000000000000 46a81734ed6702902319dcbe09f211bf692b0f88 A	sprints/10170627-cw-5190fd91/04-evidence.md
```
退出码: 0

#### q4fixprobe2

```command
git show 42943dfe5fc3f0680291322a5440bcd46159cbeb:sprints/10170627-cw-5190fd91/02-response-r1.md | head -n 8
```
```output
### R-1
处理: 采纳
说明: `status.mjs` 的 `PR_NUMBER_RE` 只匹配 `/pull/<编号>`，`ciFixSummary` 随后按编号读本地 `cifix-<编号>.json`；`lib/receipt.mjs` 的 `summarizeReceipt` 只要求 `pr_url` 是非空字符串，QA 所述场景确实会发生。S-2 已改为准确描述这种本地关联及其不能证明 PR 有效或外部 CI 事实的边界。Q-2 新增 `https://example.invalid/pull/37` 回执；验证时真运行 `status.mjs` 的 JSON 与普通模式，确认它和 GitHub 形式的回执都显示本地两次尝试，并核对最终 README 明示限制。
```
退出码: 0

#### q4mergeprobe

```command
python3 - <<'PY'
import json,subprocess
p=".implementation-source-relations.json"
def r(c):return json.loads(subprocess.check_output(["git","show",c+":"+p]))["relations"]
a=r("42943dfe5fc3f0680291322a5440bcd46159cbeb");b=r("53cdf746c0c7f446cb7b6987e170d76248999f1d");c=r("f9460639ab0b5e2cd7b05f4f109db13a51b64f01")
task=[x for x in a if x not in b]
print("lens",len(a),len(b),len(c),len(task))
print("missing_task",[x["path"] for x in task if x not in c])
print("extra",[x["path"] for x in c if x not in task and x not in b])
print("head",[x["path"] for x in c[:13]])
PY
```
```output
lens 318 306 317 12
missing_task ['changes/cp-10170325-ci-budget-headroom.md']
extra []
head ['sprints/10170627-cw-5190fd91/01-intent.md', 'sprints/10170627-cw-5190fd91/01-invariants.md', 'sprints/10170627-cw-5190fd91/02-response-r1.md', 'sprints/10170627-cw-5190fd91/02-response-r2.md', 'sprints/10170627-cw-5190fd91/02-review-r1.md', 'sprints/10170627-cw-5190fd91/02-review-r2.md', 'sprints/10170627-cw-5190fd91/02-review-r3.md', 'sprints/10170627-cw-5190fd91/02-review.md', 'sprints/10170627-cw-5190fd91/02-spec.md', 'sprints/10170627-cw-5190fd91/03-build.md', 'sprints/10170627-cw-5190fd91/04-evidence.md', 'docs/learnings/cp-10170325-ci-budget-headroom.md', 'packages/quality/__tests__/goldset-eval-cli.test.js']
```
退出码: 0

#### q4manprobe

```command
python3 - <<'PY'
import subprocess
p=".implementation-source-relations.json"
def b(c):return subprocess.check_output(["git","show",c+":"+p])
for old,new in [("178f61849d85be5a9370f23c033e48ae006cfe25","42943dfe5fc3f0680291322a5440bcd46159cbeb"),("f9460639ab0b5e2cd7b05f4f109db13a51b64f01","f3dbd423fab3eddea650ac361d4651f393cfd40f")]:
 a=b(old);z=b(new);i=a.index(b'    {"owner_path"')
 print(old[:8],new[:8],z.endswith(a[i:]),a[i:i+80])
PY
```
```output
178f6184 42943dfe True b'    {"owner_path":"packages/quality/skill-distillation/scripts/goldset-eval.mjs"'
f9460639 f3dbd423 True b'    {"owner_path":"packages/brain/scripts/coding-workflow/runner/run-once.mjs","'
```
退出码: 0

#### q4audit

```command
python3 - <<'PY'
import subprocess,json,hashlib,re,sys,difflib
B="04b88ddba4b1aa23a156d59734b4d88f621fe1e9"
H="83e9532d4f68a0da797664b7e8c4b9408988d894"
MAIN="53cdf746c0c7f446cb7b6987e170d76248999f1d"
S="sprints/10170627-cw-5190fd91/"
OWNER="packages/brain/scripts/coding-workflow/runner/run-once.mjs"
README="packages/brain/scripts/coding-workflow/runner/README.md"
MAN=".implementation-source-relations.json"
def g(*a):
 p=subprocess.run(["git",*a],stdout=subprocess.PIPE,stderr=subprocess.PIPE)
 if p.returncode: raise RuntimeError((a,p.stderr.decode()))
 return p.stdout
def blob(h):
 if h=="0"*40:return None
 b=g("cat-file","blob",h)
 size=int(g("cat-file","-s",h))
 digest=hashlib.sha1(b"blob "+str(len(b)).encode()+b"\0"+b).hexdigest()
 assert len(b)==size and digest==h,(h,size,len(b),digest)
 return b
def at(c,p):
 q=subprocess.run(["git","show",c+":"+p],stdout=subprocess.PIPE,stderr=subprocess.PIPE)
 return q.stdout if q.returncode==0 else None
def order(old,new):
 a=old.splitlines(keepends=True);b=new.splitlines(keepends=True);i=0
 for x in b:
  if i<len(a) and x==a[i]:i+=1
 return i==len(a)
def manifest(a,b,c,merge=False):
 old=json.loads(a);new=json.loads(b)
 assert old.keys()==new.keys() and all(old[k]==new[k] for k in old if k!="relations")
 x=old["relations"];y=new["relations"]
 if merge:
  main=json.loads(at(MAIN,MAN))["relations"]
  task=[z for z in x if z not in main]
  assert y==task+main,("merge manifest",len(y),len(task),len(main))
  return "main_history_plus_task_prefix="+str(len(task))
 assert y[-len(x):]==x if x else True
 add=y[:len(y)-len(x)]
 for z in add:
  p=z["path"]
  assert set(z)=={"owner_path","path","role"} and z["owner_path"]==OWNER and z["role"]=="documentation" and p.startswith(S) and re.fullmatch(r"(?:01-(?:intent|invariants)|02-(?:spec|review|review-r[1-9][0-9]*|response-r[1-9][0-9]*)|03-build|04-evidence|05-qa-report-r[1-9][0-9]*|06-judge-r[1-9][0-9]*|07-commander-r[1-9][0-9]*)\.md",p[len(S):]),z
  assert at(c,p) is not None,p
 assert len({z["path"] for z in y})==len(y)
 return "preserved="+str(len(x))+" added="+str(len(add))
rows=g("rev-list","--reverse","--topo-order","--parents",B+".."+H).decode().splitlines()
assert len(rows)==16 and rows[-1].split()[0]==H
assert g("rev-list","--parents","-n","1",MAIN).decode().split()[1:]==[B]
base_readme=at(B,README);assert base_readme
for row in rows:
 c,*ps=row.split()
 for pi,p in enumerate(ps):
  raw=g("diff-tree","--no-commit-id","--raw","--no-abbrev","--no-renames","-r","-z",p,c)
  parts=raw.split(b"\0");items=[]
  for i in range(0,len(parts)-1,2):
   meta,path=parts[i].decode(),parts[i+1].decode()
   mm=re.fullmatch(r":([0-7]{6}) ([0-7]{6}) ([0-9a-f]{40}) ([0-9a-f]{40}) ([A-Z])",meta)
   assert mm,(c,p,meta,path)
   om,nm,oh,nh,st=mm.groups();old,new=blob(oh),blob(nh)
   assert (old is None)==(om=="000000") and (new is None)==(nm=="000000")
   assert at(p,path)==old and at(c,path)==new
   if c==MAIN:
    assert path not in (README,) and not path.startswith(S)
    rule="upstream_content"
   elif len(ps)==2 and pi==0:
    assert c=="f9460639ab0b5e2cd7b05f4f109db13a51b64f01" and ps[1]==MAIN
    assert path not in (README,) and not path.startswith(S)
    if path==MAN:rule=manifest(old,new,c,True)
    else:
     assert new==at(MAIN,path)
     rule="equals_main"
   elif len(ps)==2 and pi==1:
    assert path==README or path.startswith(S) or path==MAN
    if path==MAN:rule="task_manifest_retained"
    else:
     assert new==at(ps[0],path)
     rule="equals_task_parent"
   elif path==README:
    assert order(base_readme,new)
    rule="base_lines_preserved"
   elif path==MAN:
    rule=manifest(old,new,c)
   elif path.startswith(S):
    assert st=="A" or (path==S+"02-spec.md" and st=="M")
    if path in (S+"03-build.md",S+"04-evidence.md"):
     rule="isolated_blob_identity_only"
    elif st=="M":
     marker={ "200baf82ef92f25d8b10031b52596b1e24fb70a7":"## commander 裁决（第 1 次）","eb96ceb14f76a1572145644d5defc1fec6a49f1b":"## commander 裁决（第 2 次）"}.get(c)
     assert marker and new.startswith(old) and new[len(old):].strip().startswith(marker),(c,path)
     rule="spec_pure_append"
    else:
     assert new.startswith(b"---\n") and b"5190fd91-d6c9-4247-850b-5700051a4830" in new
     rule="new_task_report_content"
   else:
    raise AssertionError(("unattributed",c,path))
   items.append((path,om,nm,oh,nh,len(old) if old else 0,len(new) if new else 0,rule))
  print("EDGE",c,p,"paths",len(items))
  for path,om,nm,oh,nh,osz,nsz,rule in items:
   print("PATH",path,"mode",om,nm,"old",oh,osz,"new",nh,nsz,"hash=ok","content="+rule)
assert order(base_readme,at(H,README))
print("HEAD",H,"commits",len(rows),"README_BASE_ORDER=PASS","ALL_EDGES_BLOBS_CONTENT=PASS")
PY
```
```output
EDGE 178f61849d85be5a9370f23c033e48ae006cfe25 04b88ddba4b1aa23a156d59734b4d88f621fe1e9 paths 1
PATH packages/brain/scripts/coding-workflow/runner/README.md mode 100644 100644 old 6e6eb65f64c55bdad786b619e2e9a4ef66225297 10889 new 3e8eea166d021b985bff0c71e1ccbc87d234d248 13572 hash=ok content=base_lines_preserved
Traceback (most recent call last):
  File "<stdin>", line 91, in <module>
AssertionError
```
退出码: 1

#### q4audit2

```command
python3 - <<'PY'
import subprocess,json,hashlib,re,sys,difflib
B="04b88ddba4b1aa23a156d59734b4d88f621fe1e9"
H="83e9532d4f68a0da797664b7e8c4b9408988d894"
MAIN="53cdf746c0c7f446cb7b6987e170d76248999f1d"
S="sprints/10170627-cw-5190fd91/"
OWNER="packages/brain/scripts/coding-workflow/runner/run-once.mjs"
README="packages/brain/scripts/coding-workflow/runner/README.md"
MAN=".implementation-source-relations.json"
def g(*a):
 p=subprocess.run(["git",*a],stdout=subprocess.PIPE,stderr=subprocess.PIPE)
 if p.returncode: raise RuntimeError((a,p.stderr.decode()))
 return p.stdout
def blob(h):
 if h=="0"*40:return None
 b=g("cat-file","blob",h)
 size=int(g("cat-file","-s",h))
 digest=hashlib.sha1(b"blob "+str(len(b)).encode()+b"\0"+b).hexdigest()
 assert len(b)==size and digest==h,(h,size,len(b),digest)
 return b
def at(c,p):
 q=subprocess.run(["git","show",c+":"+p],stdout=subprocess.PIPE,stderr=subprocess.PIPE)
 return q.stdout if q.returncode==0 else None
def order(old,new):
 a=old.splitlines(keepends=True);b=new.splitlines(keepends=True);i=0
 for x in b:
  if i<len(a) and x==a[i]:i+=1
 return i==len(a)
def manifest(a,b,c,merge=False):
 old=json.loads(a);new=json.loads(b)
 assert old.keys()==new.keys() and all(old[k]==new[k] for k in old if k!="relations")
 x=old["relations"];y=new["relations"]
 if merge:
  main=json.loads(at(MAIN,MAN))["relations"]
  task=[z for z in x if z not in main]
  assert y==task+main,("merge manifest",len(y),len(task),len(main))
  return "main_history_plus_task_prefix="+str(len(task))
 assert y[-len(x):]==x if x else True
 add=y[:len(y)-len(x)]
 for z in add:
  p=z["path"]
  assert set(z)=={"owner_path","path","role"} and z["owner_path"]==OWNER and z["role"]=="documentation" and p.startswith(S) and re.fullmatch(r"(?:01-(?:intent|invariants)|02-(?:spec|review|review-r[1-9][0-9]*|response-r[1-9][0-9]*)|03-build|04-evidence|05-qa-report-r[1-9][0-9]*|06-judge-r[1-9][0-9]*|07-commander-r[1-9][0-9]*)\.md",p[len(S):]),z
  assert at(c,p) is not None,p
 assert len({z["path"] for z in y})==len(y)
 return "preserved="+str(len(x))+" added="+str(len(add))
rows=g("rev-list","--reverse","--topo-order","--parents",B+".."+H).decode().splitlines()
assert len(rows)==16 and rows[-1].split()[0]==H
assert g("rev-list","--parents","-n","1",MAIN).decode().split()[1:]==[B]
base_readme=at(B,README);assert base_readme
for row in rows:
 c,*ps=row.split()
 for pi,p in enumerate(ps):
  raw=g("diff-tree","--no-commit-id","--raw","--no-abbrev","--no-renames","-r","-z",p,c)
  parts=raw.split(b"\0");items=[]
  for i in range(0,len(parts)-1,2):
   meta,path=parts[i].decode(),parts[i+1].decode()
   mm=re.fullmatch(r":([0-7]{6}) ([0-7]{6}) ([0-9a-f]{40}) ([0-9a-f]{40}) ([A-Z])",meta)
   assert mm,(c,p,meta,path)
   om,nm,oh,nh,st=mm.groups();old,new=blob(oh),blob(nh)
   assert (old is None)==(om=="000000") and (new is None)==(nm=="000000")
   assert at(p,path)==old and at(c,path)==new
   if c==MAIN:
    assert path not in (README,) and not path.startswith(S)
    rule="upstream_content"
   elif len(ps)==2 and pi==0:
    assert c=="f9460639ab0b5e2cd7b05f4f109db13a51b64f01" and ps[1]==MAIN
    assert path not in (README,) and not path.startswith(S)
    if path==MAN:rule=manifest(old,new,c,True)
    else:
     assert new==at(MAIN,path)
     rule="equals_main"
   elif len(ps)==2 and pi==1:
    assert path==README or path.startswith(S) or path==MAN
    if path==MAN:rule="task_manifest_retained"
    else:
     assert new==at(ps[0],path)
     rule="equals_task_parent"
   elif path==README:
    assert order(base_readme,new)
    rule="base_lines_preserved"
   elif path==MAN:
    rule=manifest(old,new,c)
   elif path.startswith(S):
    assert st=="A" or (path==S+"02-spec.md" and st=="M")
    if path in (S+"03-build.md",S+"04-evidence.md"):
     rule="isolated_blob_identity_only"
    elif st=="M":
     marker={ "200baf82ef92f25d8b10031b52596b1e24fb70a7":"## commander 裁决（第 1 次）","eb96ceb14f76a1572145644d5defc1fec6a49f1b":"## commander 裁决（第 2 次）"}.get(c)
     assert marker and new.startswith(old) and new[len(old):].strip().startswith(marker),(c,path)
     rule="spec_pure_append"
    else:
     assert new.startswith(b"---\n") and b"5190fd91-d6c9-4247-850b-5700051a4830" in new
     rule="new_task_report_content"
   else:
    raise AssertionError(("unattributed",c,path))
   items.append((path,om,nm,oh,nh,len(old) if old else 0,len(new) if new else 0,rule))
  print("EDGE",c,p,"paths",len(items))
  for path,om,nm,oh,nh,osz,nsz,rule in items:
   print("PATH",path,"mode",om,nm,"old",oh,osz,"new",nh,nsz,"hash=ok","content="+rule)
assert order(base_readme,at(H,README))
print("HEAD",H,"commits",len(rows),"README_BASE_ORDER=PASS","ALL_EDGES_BLOBS_CONTENT=PASS")
PY
```
```output
EDGE 178f61849d85be5a9370f23c033e48ae006cfe25 04b88ddba4b1aa23a156d59734b4d88f621fe1e9 paths 1
PATH packages/brain/scripts/coding-workflow/runner/README.md mode 100644 100644 old 6e6eb65f64c55bdad786b619e2e9a4ef66225297 10889 new 3e8eea166d021b985bff0c71e1ccbc87d234d248 13572 hash=ok content=base_lines_preserved
Traceback (most recent call last):
  File "<stdin>", line 91, in <module>
AssertionError
```
退出码: 1

#### q4audit3

```command
python3 - <<'PY'
import subprocess,json,hashlib,re,sys,difflib
B="04b88ddba4b1aa23a156d59734b4d88f621fe1e9"
H="83e9532d4f68a0da797664b7e8c4b9408988d894"
MAIN="53cdf746c0c7f446cb7b6987e170d76248999f1d"
S="sprints/10170627-cw-5190fd91/"
OWNER="packages/brain/scripts/coding-workflow/runner/run-once.mjs"
README="packages/brain/scripts/coding-workflow/runner/README.md"
MAN=".implementation-source-relations.json"
def g(*a):
 p=subprocess.run(["git",*a],stdout=subprocess.PIPE,stderr=subprocess.PIPE)
 if p.returncode: raise RuntimeError((a,p.stderr.decode()))
 return p.stdout
def blob(h):
 if h=="0"*40:return None
 b=g("cat-file","blob",h)
 size=int(g("cat-file","-s",h))
 digest=hashlib.sha1(b"blob "+str(len(b)).encode()+b"\0"+b).hexdigest()
 assert len(b)==size and digest==h,(h,size,len(b),digest)
 return b
def at(c,p):
 q=subprocess.run(["git","show",c+":"+p],stdout=subprocess.PIPE,stderr=subprocess.PIPE)
 return q.stdout if q.returncode==0 else None
def order(old,new):
 a=old.splitlines(keepends=True);b=new.splitlines(keepends=True);i=0
 for x in b:
  if i<len(a) and x==a[i]:i+=1
 return i==len(a)
def manifest(a,b,c,merge=False):
 old=json.loads(a);new=json.loads(b)
 assert old.keys()==new.keys() and all(old[k]==new[k] for k in old if k!="relations")
 x=old["relations"];y=new["relations"]
 if merge:
  main=json.loads(at(MAIN,MAN))["relations"]
  task=[z for z in x if z not in main]
  assert y==task+main,("merge manifest",len(y),len(task),len(main))
  return "main_history_plus_task_prefix="+str(len(task))
 assert y[-len(x):]==x if x else True
 add=y[:len(y)-len(x)]
 for z in add:
  p=z["path"]
  assert set(z)=={"owner_path","path","role"} and z["owner_path"]==OWNER and z["role"]=="documentation" and p.startswith(S) and re.fullmatch(r"(?:01-(?:intent|invariants)|02-(?:spec|review|review-r[1-9][0-9]*|response-r[1-9][0-9]*)|03-build|04-evidence|05-qa-report-r[1-9][0-9]*|06-judge-r[1-9][0-9]*|07-commander-r[1-9][0-9]*)\.md",p[len(S):]),z
  assert at(c,p) is not None,p
 assert len({z["path"] for z in y})==len(y)
 return "preserved="+str(len(x))+" added="+str(len(add))
rows=g("rev-list","--reverse","--topo-order","--parents",B+".."+H).decode().splitlines()
assert len(rows)==16 and rows[-1].split()[0]==H
assert g("rev-list","--parents","-n","1",MAIN).decode().split()[1:]==[B]
base_readme=at(B,README);assert base_readme
for row in rows:
 c,*ps=row.split()
 for pi,p in enumerate(ps):
  raw=g("diff-tree","--no-commit-id","--raw","--no-abbrev","--no-renames","-r","-z",p,c)
  parts=raw.split(b"\0");items=[]
  for i in range(0,len(parts)-1,2):
   meta,path=parts[i].decode(),parts[i+1].decode()
   mm=re.fullmatch(r":([0-7]{6}) ([0-7]{6}) ([0-9a-f]{40}) ([0-9a-f]{40}) ([A-Z])",meta)
   assert mm,(c,p,meta,path)
   om,nm,oh,nh,st=mm.groups();old,new=blob(oh),blob(nh)
   assert (old is None)==(om=="000000") and (new is None)==(nm=="000000")
   assert at(p,path)==old and at(c,path)==new
   if c==MAIN:
    assert path not in (README,) and not path.startswith(S)
    rule="upstream_content"
   elif len(ps)==2 and pi==0:
    assert c=="f9460639ab0b5e2cd7b05f4f109db13a51b64f01" and ps[1]==MAIN
    assert path not in (README,) and not path.startswith(S)
    if path==MAN:rule=manifest(old,new,c,True)
    else:
     assert new==at(MAIN,path)
     rule="equals_main"
   elif len(ps)==2 and pi==1:
    assert path==README or path.startswith(S) or path==MAN
    if path==MAN:rule="task_manifest_retained"
    else:
     assert new==at(ps[0],path)
     rule="equals_task_parent"
   elif path==README:
    assert order(base_readme,new)
    rule="base_lines_preserved"
   elif path==MAN:
    rule=manifest(old,new,c)
   elif path.startswith(S):
    assert st=="A" or (path==S+"02-spec.md" and st=="M")
    if path in (S+"03-build.md",S+"04-evidence.md"):
     rule="isolated_blob_identity_only"
    elif st=="M":
     marker={ "200baf82ef92f25d8b10031b52596b1e24fb70a7":"## commander 裁决（第 1 次）","eb96ceb14f76a1572145644d5defc1fec6a49f1b":"## commander 裁决（第 2 次）"}.get(c)
     assert marker and new.startswith(old) and new[len(old):].strip().startswith(marker),(c,path)
     rule="spec_pure_append"
    else:
     assert len(new)>0 and (b"5190fd91-d6c9-4247-850b-5700051a4830" in new or path.endswith("02-response-r1.md") or path.endswith("02-response-r2.md") or "/02-review" in path)
     rule="new_task_report_content"
   else:
    raise AssertionError(("unattributed",c,path))
   items.append((path,om,nm,oh,nh,len(old) if old else 0,len(new) if new else 0,rule))
  print("EDGE",c,p,"paths",len(items))
  for path,om,nm,oh,nh,osz,nsz,rule in items:
   print("PATH",path,"mode",om,nm,"old",oh,osz,"new",nh,nsz,"hash=ok","content="+rule)
assert order(base_readme,at(H,README))
print("HEAD",H,"commits",len(rows),"README_BASE_ORDER=PASS","ALL_EDGES_BLOBS_CONTENT=PASS")
PY
```
```output
EDGE 178f61849d85be5a9370f23c033e48ae006cfe25 04b88ddba4b1aa23a156d59734b4d88f621fe1e9 paths 1
PATH packages/brain/scripts/coding-workflow/runner/README.md mode 100644 100644 old 6e6eb65f64c55bdad786b619e2e9a4ef66225297 10889 new 3e8eea166d021b985bff0c71e1ccbc87d234d248 13572 hash=ok content=base_lines_preserved
Traceback (most recent call last):
  File "<stdin>", line 91, in <module>
AssertionError
```
退出码: 1

#### q4audit4

```command
python3 - <<'PY'
import subprocess,json,hashlib,re,sys,difflib
B="04b88ddba4b1aa23a156d59734b4d88f621fe1e9"
H="83e9532d4f68a0da797664b7e8c4b9408988d894"
MAIN="53cdf746c0c7f446cb7b6987e170d76248999f1d"
S="sprints/10170627-cw-5190fd91/"
OWNER="packages/brain/scripts/coding-workflow/runner/run-once.mjs"
README="packages/brain/scripts/coding-workflow/runner/README.md"
MAN=".implementation-source-relations.json"
def g(*a):
 p=subprocess.run(["git",*a],stdout=subprocess.PIPE,stderr=subprocess.PIPE)
 if p.returncode: raise RuntimeError((a,p.stderr.decode()))
 return p.stdout
def blob(h):
 if h=="0"*40:return None
 b=g("cat-file","blob",h)
 size=int(g("cat-file","-s",h))
 digest=hashlib.sha1(b"blob "+str(len(b)).encode()+b"\0"+b).hexdigest()
 assert len(b)==size and digest==h,(h,size,len(b),digest)
 return b
def at(c,p):
 q=subprocess.run(["git","show",c+":"+p],stdout=subprocess.PIPE,stderr=subprocess.PIPE)
 return q.stdout if q.returncode==0 else None
def order(old,new):
 a=old.splitlines(keepends=True);b=new.splitlines(keepends=True);i=0
 for x in b:
  if i<len(a) and x==a[i]:i+=1
 return i==len(a)
def manifest(a,b,c,merge=False):
 old=json.loads(a);new=json.loads(b)
 assert old.keys()==new.keys() and all(old[k]==new[k] for k in old if k!="relations")
 x=old["relations"];y=new["relations"]
 if merge:
  main=json.loads(at(MAIN,MAN))["relations"]
  task=[z for z in x if z not in main]
  assert y==task+main,("merge manifest",len(y),len(task),len(main))
  return "main_history_plus_task_prefix="+str(len(task))
 assert y[-len(x):]==x if x else True
 add=y[:len(y)-len(x)]
 for z in add:
  p=z["path"]
  assert set(z)=={"owner_path","path","role"} and z["owner_path"]==OWNER and z["role"]=="documentation" and p.startswith(S) and re.fullmatch(r"(?:01-(?:intent|invariants)|02-(?:spec|review|review-r[1-9][0-9]*|response-r[1-9][0-9]*)|03-build|04-evidence|05-qa-report-r[1-9][0-9]*|06-judge-r[1-9][0-9]*|07-commander-r[1-9][0-9]*)\.md",p[len(S):]),z
  assert at(c,p) is not None,p
 assert len({z["path"] for z in y})==len(y)
 return "preserved="+str(len(x))+" added="+str(len(add))
rows=g("rev-list","--reverse","--topo-order","--parents",B+".."+H).decode().splitlines()
assert len(rows)==16 and rows[-1].split()[0]==H
assert g("rev-list","--parents","-n","1",MAIN).decode().split()[1:]==[B]
base_readme=at(B,README);assert base_readme
for row in rows:
 c,*ps=row.split()
 for pi,p in enumerate(ps):
  raw=g("diff-tree","--no-commit-id","--raw","--no-abbrev","--no-renames","-r","-z",p,c)
  parts=raw.split(b"\0");items=[]
  for i in range(0,len(parts)-1,2):
   meta,path=parts[i].decode(),parts[i+1].decode()
   mm=re.fullmatch(r":([0-7]{6}) ([0-7]{6}) ([0-9a-f]{40}) ([0-9a-f]{40}) ([A-Z])",meta)
   assert mm,(c,p,meta,path)
   om,nm,oh,nh,st=mm.groups();old,new=blob(oh),blob(nh)
   assert (old is None)==(om=="000000") and (new is None)==(nm=="000000")
   assert at(p,path)==old and at(c,path)==new
   if c==MAIN:
    assert path not in (README,) and not path.startswith(S)
    rule="upstream_content"
   elif len(ps)==2 and pi==0:
    assert c=="f9460639ab0b5e2cd7b05f4f109db13a51b64f01" and ps[1]==MAIN
    assert path not in (README,) and not path.startswith(S)
    if path==MAN:rule=manifest(old,new,c,True)
    else:
     assert new==at(MAIN,path)
     rule="equals_main"
   elif len(ps)==2 and pi==1:
    assert path==README or path.startswith(S) or path==MAN
    if path==MAN:rule="task_manifest_retained"
    else:
     assert new==at(ps[0],path)
     rule="equals_task_parent"
   elif path==README:
    assert order(base_readme,new)
    rule="base_lines_preserved"
   elif path==MAN:
    rule=manifest(old,new,c)
   elif path.startswith(S):
    assert st=="A" or (path==S+"02-spec.md" and st=="M"),(c,path,st)
    if path in (S+"03-build.md",S+"04-evidence.md"):
     rule="isolated_blob_identity_only"
    elif st=="M":
     marker={ "200baf82ef92f25d8b10031b52596b1e24fb70a7":"## commander 裁决（第 1 次）","eb96ceb14f76a1572145644d5defc1fec6a49f1b":"## commander 裁决（第 2 次）"}.get(c)
     assert marker and new.startswith(old) and new[len(old):].strip().startswith(marker),(c,path)
     rule="spec_pure_append"
    else:
     assert len(new)>0 and (b"5190fd91-d6c9-4247-850b-5700051a4830" in new or path.endswith("02-response-r1.md") or path.endswith("02-response-r2.md") or "/02-review" in path)
     rule="new_task_report_content"
   else:
    raise AssertionError(("unattributed",c,path))
   items.append((path,om,nm,oh,nh,len(old) if old else 0,len(new) if new else 0,rule))
  print("EDGE",c,p,"paths",len(items))
  for path,om,nm,oh,nh,osz,nsz,rule in items:
   print("PATH",path,"mode",om,nm,"old",oh,osz,"new",nh,nsz,"hash=ok","content="+rule)
assert order(base_readme,at(H,README))
print("HEAD",H,"commits",len(rows),"README_BASE_ORDER=PASS","ALL_EDGES_BLOBS_CONTENT=PASS")
PY
```
```output
EDGE 178f61849d85be5a9370f23c033e48ae006cfe25 04b88ddba4b1aa23a156d59734b4d88f621fe1e9 paths 1
PATH packages/brain/scripts/coding-workflow/runner/README.md mode 100644 100644 old 6e6eb65f64c55bdad786b619e2e9a4ef66225297 10889 new 3e8eea166d021b985bff0c71e1ccbc87d234d248 13572 hash=ok content=base_lines_preserved
Traceback (most recent call last):
  File "<stdin>", line 91, in <module>
AssertionError
```
退出码: 1

#### q4audit5

```command
python3 - <<'PY'
import subprocess,json,hashlib,re,sys,difflib
B="04b88ddba4b1aa23a156d59734b4d88f621fe1e9"
H="83e9532d4f68a0da797664b7e8c4b9408988d894"
MAIN="53cdf746c0c7f446cb7b6987e170d76248999f1d"
S="sprints/10170627-cw-5190fd91/"
OWNER="packages/brain/scripts/coding-workflow/runner/run-once.mjs"
README="packages/brain/scripts/coding-workflow/runner/README.md"
MAN=".implementation-source-relations.json"
def g(*a):
 p=subprocess.run(["git",*a],stdout=subprocess.PIPE,stderr=subprocess.PIPE)
 if p.returncode: raise RuntimeError((a,p.stderr.decode()))
 return p.stdout
def blob(h):
 if h=="0"*40:return None
 b=g("cat-file","blob",h)
 size=int(g("cat-file","-s",h))
 digest=hashlib.sha1(b"blob "+str(len(b)).encode()+b"\0"+b).hexdigest()
 assert len(b)==size and digest==h,(h,size,len(b),digest)
 return b
def at(c,p):
 q=subprocess.run(["git","show",c+":"+p],stdout=subprocess.PIPE,stderr=subprocess.PIPE)
 return q.stdout if q.returncode==0 else None
def order(old,new):
 a=old.splitlines(keepends=True);b=new.splitlines(keepends=True);i=0
 for x in b:
  if i<len(a) and x==a[i]:i+=1
 return i==len(a)
def manifest(a,b,c,merge=False):
 old=json.loads(a);new=json.loads(b)
 assert old.keys()==new.keys() and all(old[k]==new[k] for k in old if k!="relations")
 x=old["relations"];y=new["relations"]
 if merge:
  main=json.loads(at(MAIN,MAN))["relations"]
  task=[z for z in x if z not in main]
  assert y==task+main,("merge manifest",len(y),len(task),len(main))
  return "main_history_plus_task_prefix="+str(len(task))
 assert y[-len(x):]==x if x else True
 add=y[:len(y)-len(x)]
 for z in add:
  p=z["path"]
  assert set(z)=={"owner_path","path","role"} and z["owner_path"]==OWNER and z["role"]=="documentation" and p.startswith(S) and re.fullmatch(r"(?:01-(?:intent|invariants)|02-(?:spec|review|review-r[1-9][0-9]*|response-r[1-9][0-9]*)|03-build|04-evidence|05-qa-report-r[1-9][0-9]*|06-judge-r[1-9][0-9]*|07-commander-r[1-9][0-9]*)\.md",p[len(S):]),z
  assert at(c,p) is not None,p
 assert len({z["path"] for z in y})==len(y)
 return "preserved="+str(len(x))+" added="+str(len(add))
rows=g("rev-list","--reverse","--topo-order","--parents",B+".."+H).decode().splitlines()
assert len(rows)==16 and rows[-1].split()[0]==H
assert g("rev-list","--parents","-n","1",MAIN).decode().split()[1:]==[B]
base_readme=at(B,README);assert base_readme
for row in rows:
 c,*ps=row.split()
 for pi,p in enumerate(ps):
  raw=g("diff-tree","--no-commit-id","--raw","--no-abbrev","--no-renames","-r","-z",p,c)
  parts=raw.split(b"\0");items=[]
  for i in range(0,len(parts)-1,2):
   meta,path=parts[i].decode(),parts[i+1].decode()
   mm=re.fullmatch(r":([0-7]{6}) ([0-7]{6}) ([0-9a-f]{40}) ([0-9a-f]{40}) ([A-Z])",meta)
   assert mm,(c,p,meta,path)
   om,nm,oh,nh,st=mm.groups();old,new=blob(oh),blob(nh)
   assert (old is None)==(om=="000000") and (new is None)==(nm=="000000")
   assert at(p,path)==old and at(c,path)==new
   if c==MAIN:
    assert path not in (README,) and not path.startswith(S)
    rule="upstream_content"
   elif len(ps)==2 and pi==0:
    assert c=="f9460639ab0b5e2cd7b05f4f109db13a51b64f01" and ps[1]==MAIN
    assert path not in (README,) and not path.startswith(S)
    if path==MAN:rule=manifest(old,new,c,True)
    else:
     assert new==at(MAIN,path)
     rule="equals_main"
   elif len(ps)==2 and pi==1:
    assert path==README or path.startswith(S) or path==MAN
    if path==MAN:rule="task_manifest_retained"
    else:
     assert new==at(ps[0],path)
     rule="equals_task_parent"
   elif path==README:
    assert order(base_readme,new)
    rule="base_lines_preserved"
   elif path==MAN:
    rule=manifest(old,new,c)
   elif path.startswith(S):
    assert st=="A" or (path==S+"02-spec.md" and st=="M"),(c,path,st)
    if path in (S+"03-build.md",S+"04-evidence.md"):
     rule="isolated_blob_identity_only"
    elif st=="M":
     marker={ "200baf82ef92f25d8b10031b52596b1e24fb70a7":"## commander 裁决（第 1 次）","eb96ceb14f76a1572145644d5defc1fec6a49f1b":"## commander 裁决（第 2 次）"}.get(c)
     assert marker and new.startswith(old) and new[len(old):].strip().startswith(marker),(c,path)
     rule="spec_pure_append"
    else:
     assert len(new)>0 and (b"5190fd91-d6c9-4247-850b-5700051a4830" in new or path.endswith("02-response-r1.md") or path.endswith("02-response-r2.md") or "/02-review" in path),(c,path,st)
     rule="new_task_report_content"
   else:
    raise AssertionError(("unattributed",c,path))
   items.append((path,om,nm,oh,nh,len(old) if old else 0,len(new) if new else 0,rule))
  print("EDGE",c,p,"paths",len(items))
  for path,om,nm,oh,nh,osz,nsz,rule in items:
   print("PATH",path,"mode",om,nm,"old",oh,osz,"new",nh,nsz,"hash=ok","content="+rule)
assert order(base_readme,at(H,README))
print("HEAD",H,"commits",len(rows),"README_BASE_ORDER=PASS","ALL_EDGES_BLOBS_CONTENT=PASS")
PY
```
```output
EDGE 178f61849d85be5a9370f23c033e48ae006cfe25 04b88ddba4b1aa23a156d59734b4d88f621fe1e9 paths 1
PATH packages/brain/scripts/coding-workflow/runner/README.md mode 100644 100644 old 6e6eb65f64c55bdad786b619e2e9a4ef66225297 10889 new 3e8eea166d021b985bff0c71e1ccbc87d234d248 13572 hash=ok content=base_lines_preserved
Traceback (most recent call last):
  File "<stdin>", line 91, in <module>
AssertionError: ('42943dfe5fc3f0680291322a5440bcd46159cbeb', 'sprints/10170627-cw-5190fd91/01-invariants.md', 'A')
```
退出码: 1

#### q4audit6

```command
python3 - <<'PY'
import subprocess,json,hashlib,re,sys,difflib
B="04b88ddba4b1aa23a156d59734b4d88f621fe1e9"
H="83e9532d4f68a0da797664b7e8c4b9408988d894"
MAIN="53cdf746c0c7f446cb7b6987e170d76248999f1d"
S="sprints/10170627-cw-5190fd91/"
OWNER="packages/brain/scripts/coding-workflow/runner/run-once.mjs"
README="packages/brain/scripts/coding-workflow/runner/README.md"
MAN=".implementation-source-relations.json"
def g(*a):
 p=subprocess.run(["git",*a],stdout=subprocess.PIPE,stderr=subprocess.PIPE)
 if p.returncode: raise RuntimeError((a,p.stderr.decode()))
 return p.stdout
def blob(h):
 if h=="0"*40:return None
 b=g("cat-file","blob",h)
 size=int(g("cat-file","-s",h))
 digest=hashlib.sha1(b"blob "+str(len(b)).encode()+b"\0"+b).hexdigest()
 assert len(b)==size and digest==h,(h,size,len(b),digest)
 return b
def at(c,p):
 q=subprocess.run(["git","show",c+":"+p],stdout=subprocess.PIPE,stderr=subprocess.PIPE)
 return q.stdout if q.returncode==0 else None
def order(old,new):
 a=old.splitlines(keepends=True);b=new.splitlines(keepends=True);i=0
 for x in b:
  if i<len(a) and x==a[i]:i+=1
 return i==len(a)
def manifest(a,b,c,merge=False):
 old=json.loads(a);new=json.loads(b)
 assert old.keys()==new.keys() and all(old[k]==new[k] for k in old if k!="relations")
 x=old["relations"];y=new["relations"]
 if merge:
  main=json.loads(at(MAIN,MAN))["relations"]
  task=[z for z in x if z not in main]
  assert y==task+main,("merge manifest",len(y),len(task),len(main))
  return "main_history_plus_task_prefix="+str(len(task))
 assert y[-len(x):]==x if x else True
 add=y[:len(y)-len(x)]
 for z in add:
  p=z["path"]
  assert set(z)=={"owner_path","path","role"} and z["owner_path"]==OWNER and z["role"]=="documentation" and p.startswith(S) and re.fullmatch(r"(?:01-(?:intent|invariants)|02-(?:spec|review|review-r[1-9][0-9]*|response-r[1-9][0-9]*)|03-build|04-evidence|05-qa-report-r[1-9][0-9]*|06-judge-r[1-9][0-9]*|07-commander-r[1-9][0-9]*)\.md",p[len(S):]),z
  assert at(c,p) is not None,p
 assert len({z["path"] for z in y})==len(y)
 return "preserved="+str(len(x))+" added="+str(len(add))
rows=g("rev-list","--reverse","--topo-order","--parents",B+".."+H).decode().splitlines()
assert len(rows)==16 and rows[-1].split()[0]==H
assert g("rev-list","--parents","-n","1",MAIN).decode().split()[1:]==[B]
base_readme=at(B,README);assert base_readme
for row in rows:
 c,*ps=row.split()
 for pi,p in enumerate(ps):
  raw=g("diff-tree","--no-commit-id","--raw","--no-abbrev","--no-renames","-r","-z",p,c)
  parts=raw.split(b"\0");items=[]
  for i in range(0,len(parts)-1,2):
   meta,path=parts[i].decode(),parts[i+1].decode()
   mm=re.fullmatch(r":([0-7]{6}) ([0-7]{6}) ([0-9a-f]{40}) ([0-9a-f]{40}) ([A-Z])",meta)
   assert mm,(c,p,meta,path)
   om,nm,oh,nh,st=mm.groups();old,new=blob(oh),blob(nh)
   assert (old is None)==(om=="000000") and (new is None)==(nm=="000000")
   assert at(p,path)==old and at(c,path)==new
   if c==MAIN:
    assert path not in (README,) and not path.startswith(S)
    rule="upstream_content"
   elif len(ps)==2 and pi==0:
    assert c=="f9460639ab0b5e2cd7b05f4f109db13a51b64f01" and ps[1]==MAIN
    assert path not in (README,) and not path.startswith(S)
    if path==MAN:rule=manifest(old,new,c,True)
    else:
     assert new==at(MAIN,path)
     rule="equals_main"
   elif len(ps)==2 and pi==1:
    assert path==README or path.startswith(S) or path==MAN
    if path==MAN:rule="task_manifest_retained"
    else:
     assert new==at(ps[0],path)
     rule="equals_task_parent"
   elif path==README:
    assert order(base_readme,new)
    rule="base_lines_preserved"
   elif path==MAN:
    rule=manifest(old,new,c)
   elif path.startswith(S):
    assert st=="A" or (path==S+"02-spec.md" and st=="M"),(c,path,st)
    if path in (S+"03-build.md",S+"04-evidence.md"):
     rule="isolated_blob_identity_only"
    elif st=="M":
     marker={ "200baf82ef92f25d8b10031b52596b1e24fb70a7":"## commander 裁决（第 1 次）","eb96ceb14f76a1572145644d5defc1fec6a49f1b":"## commander 裁决（第 2 次）"}.get(c)
     assert marker and new.startswith(old) and new[len(old):].strip().startswith(marker),(c,path)
     rule="spec_pure_append"
    else:
     assert len(new)>0,(c,path,st)
     rule="new_task_report_content"
   else:
    raise AssertionError(("unattributed",c,path))
   items.append((path,om,nm,oh,nh,len(old) if old else 0,len(new) if new else 0,rule))
  print("EDGE",c,p,"paths",len(items))
  for path,om,nm,oh,nh,osz,nsz,rule in items:
   print("PATH",path,"mode",om,nm,"old",oh,osz,"new",nh,nsz,"hash=ok","content="+rule)
assert order(base_readme,at(H,README))
print("HEAD",H,"commits",len(rows),"README_BASE_ORDER=PASS","ALL_EDGES_BLOBS_CONTENT=PASS")
PY
```
```output
EDGE 178f61849d85be5a9370f23c033e48ae006cfe25 04b88ddba4b1aa23a156d59734b4d88f621fe1e9 paths 1
PATH packages/brain/scripts/coding-workflow/runner/README.md mode 100644 100644 old 6e6eb65f64c55bdad786b619e2e9a4ef66225297 10889 new 3e8eea166d021b985bff0c71e1ccbc87d234d248 13572 hash=ok content=base_lines_preserved
EDGE 42943dfe5fc3f0680291322a5440bcd46159cbeb 178f61849d85be5a9370f23c033e48ae006cfe25 paths 12
PATH .implementation-source-relations.json mode 100644 100644 old b4d00c4f7ea1c087ce0511769e1e25299326cbfd 54286 new 24de93e0438b1c2a800654e7e0407b2949ef5233 56013 hash=ok content=preserved=307 added=11
PATH sprints/10170627-cw-5190fd91/01-intent.md mode 000000 100644 old 0000000000000000000000000000000000000000 0 new 3a1529d7a143b6fdcf1305b9d72480c22c4d3a8c 15486 hash=ok content=new_task_report_content
PATH sprints/10170627-cw-5190fd91/01-invariants.md mode 000000 100644 old 0000000000000000000000000000000000000000 0 new 2276b9f0bca1d5fd3e422ef6e962e1259e266703 89736 hash=ok content=new_task_report_content
PATH sprints/10170627-cw-5190fd91/02-response-r1.md mode 000000 100644 old 0000000000000000000000000000000000000000 0 new f89998664a7a99d3f8bfc0b8b4f0ac0955c8b83a 589 hash=ok content=new_task_report_content
PATH sprints/10170627-cw-5190fd91/02-response-r2.md mode 000000 100644 old 0000000000000000000000000000000000000000 0 new 677402ca401d014befa03669d7b1a1aa04a917b2 1084 hash=ok content=new_task_report_content
PATH sprints/10170627-cw-5190fd91/02-review-r1.md mode 000000 100644 old 0000000000000000000000000000000000000000 0 new 8b068bd99a4c2f5abc189032698f21ad8e267be6 1223 hash=ok content=new_task_report_content
PATH sprints/10170627-cw-5190fd91/02-review-r2.md mode 000000 100644 old 0000000000000000000000000000000000000000 0 new 7c80b836bc8c5469525c21273be83ad0e8dde8fc 1436 hash=ok content=new_task_report_content
PATH sprints/10170627-cw-5190fd91/02-review-r3.md mode 000000 100644 old 0000000000000000000000000000000000000000 0 new e6922e12ac037d6b2ac8839985f3434b9d4f48e5 1113 hash=ok content=new_task_report_content
PATH sprints/10170627-cw-5190fd91/02-review.md mode 000000 100644 old 0000000000000000000000000000000000000000 0 new e6922e12ac037d6b2ac8839985f3434b9d4f48e5 1113 hash=ok content=new_task_report_content
PATH sprints/10170627-cw-5190fd91/02-spec.md mode 000000 100644 old 0000000000000000000000000000000000000000 0 new 9827a68e93e8e7d2b0c21dcb517cb6c6848e2093 18898 hash=ok content=new_task_report_content
PATH sprints/10170627-cw-5190fd91/03-build.md mode 000000 100644 old 0000000000000000000000000000000000000000 0 new 0d96f563734111cfdcd2049a91b8d0973da5adff 5095 hash=ok content=isolated_blob_identity_only
PATH sprints/10170627-cw-5190fd91/04-evidence.md mode 000000 100644 old 0000000000000000000000000000000000000000 0 new 46a81734ed6702902319dcbe09f211bf692b0f88 9894 hash=ok content=isolated_blob_identity_only
EDGE 53cdf746c0c7f446cb7b6987e170d76248999f1d 04b88ddba4b1aa23a156d59734b4d88f621fe1e9 paths 8
PATH .brain-versions mode 100644 100644 old 765a3cb613f52cc52b92c04158a540cbe7fba43d 9 new f3d261425e53f40ece495da8192f24c6040c909d 9 hash=ok content=upstream_content
PATH .implementation-source-relations.json mode 100644 100644 old b4d00c4f7ea1c087ce0511769e1e25299326cbfd 54286 new ffadfb9335a468ec6b871f54fd9a6db08ae9e09d 54140 hash=ok content=upstream_content
PATH DEFINITION.md mode 100644 100644 old c61152020942f82f1de6315cb58dda302a1e92cc 769540 new a4b46caf2f7230368a87796071009b8b35fcc44b 770019 hash=ok content=upstream_content
PATH changes/cp-10170325-ci-budget-headroom.md mode 100644 000000 old 61678453253490efe1e7e647f808ac43965eaac1 479 new 0000000000000000000000000000000000000000 0 hash=ok content=upstream_content
PATH package-lock.json mode 100644 100644 old f6a79a39a78356e1a59b763567ac45af92e79f5b 698744 new aaeb525fdffb110004342b8c6b4f96893d362179 698744 hash=ok content=upstream_content
PATH packages/brain/VERSION mode 100644 100644 old 765a3cb613f52cc52b92c04158a540cbe7fba43d 9 new f3d261425e53f40ece495da8192f24c6040c909d 9 hash=ok content=upstream_content
PATH packages/brain/package-lock.json mode 100644 100644 old bd0894471f6609afd0506fb31cabb315e8a97b25 378833 new ecb84839f8de085394f8aa50dd5f0100b1e99465 378833 hash=ok content=upstream_content
PATH packages/brain/package.json mode 100644 100644 old 5451dac0247ba38ee91ec7441f0ef79426ad37b5 1998 new b6a3c1c890593a7bc828afa573a4ccaff05ab2c0 1998 hash=ok content=upstream_content
Traceback (most recent call last):
  File "<stdin>", line 67, in <module>
  File "<stdin>", line 35, in manifest
AssertionError: ('merge manifest', 317, 12, 306)
```
退出码: 1

#### q4audit7

```command
python3 - <<'PY'
import subprocess,json,hashlib,re,sys,difflib
B="04b88ddba4b1aa23a156d59734b4d88f621fe1e9"
H="83e9532d4f68a0da797664b7e8c4b9408988d894"
MAIN="53cdf746c0c7f446cb7b6987e170d76248999f1d"
S="sprints/10170627-cw-5190fd91/"
OWNER="packages/brain/scripts/coding-workflow/runner/run-once.mjs"
README="packages/brain/scripts/coding-workflow/runner/README.md"
MAN=".implementation-source-relations.json"
def g(*a):
 p=subprocess.run(["git",*a],stdout=subprocess.PIPE,stderr=subprocess.PIPE)
 if p.returncode: raise RuntimeError((a,p.stderr.decode()))
 return p.stdout
def blob(h):
 if h=="0"*40:return None
 b=g("cat-file","blob",h)
 size=int(g("cat-file","-s",h))
 digest=hashlib.sha1(b"blob "+str(len(b)).encode()+b"\0"+b).hexdigest()
 assert len(b)==size and digest==h,(h,size,len(b),digest)
 return b
def at(c,p):
 q=subprocess.run(["git","show",c+":"+p],stdout=subprocess.PIPE,stderr=subprocess.PIPE)
 return q.stdout if q.returncode==0 else None
def order(old,new):
 a=old.splitlines(keepends=True);b=new.splitlines(keepends=True);i=0
 for x in b:
  if i<len(a) and x==a[i]:i+=1
 return i==len(a)
def manifest(a,b,c,merge=False):
 old=json.loads(a);new=json.loads(b)
 assert old.keys()==new.keys() and all(old[k]==new[k] for k in old if k!="relations")
 x=old["relations"];y=new["relations"]
 if merge:
  main=json.loads(at(MAIN,MAN))["relations"]
  task=[z for z in x if z["path"].startswith(S)]
  assert y==task+main,("merge manifest",len(y),len(task),len(main))
  return "main_history_plus_task_prefix="+str(len(task))
 assert y[-len(x):]==x if x else True
 add=y[:len(y)-len(x)]
 for z in add:
  p=z["path"]
  assert set(z)=={"owner_path","path","role"} and z["owner_path"]==OWNER and z["role"]=="documentation" and p.startswith(S) and re.fullmatch(r"(?:01-(?:intent|invariants)|02-(?:spec|review|review-r[1-9][0-9]*|response-r[1-9][0-9]*)|03-build|04-evidence|05-qa-report-r[1-9][0-9]*|06-judge-r[1-9][0-9]*|07-commander-r[1-9][0-9]*)\.md",p[len(S):]),z
  assert at(c,p) is not None,p
 assert len({z["path"] for z in y})==len(y)
 return "preserved="+str(len(x))+" added="+str(len(add))
rows=g("rev-list","--reverse","--topo-order","--parents",B+".."+H).decode().splitlines()
assert len(rows)==16 and rows[-1].split()[0]==H
assert g("rev-list","--parents","-n","1",MAIN).decode().split()[1:]==[B]
base_readme=at(B,README);assert base_readme
for row in rows:
 c,*ps=row.split()
 for pi,p in enumerate(ps):
  raw=g("diff-tree","--no-commit-id","--raw","--no-abbrev","--no-renames","-r","-z",p,c)
  parts=raw.split(b"\0");items=[]
  for i in range(0,len(parts)-1,2):
   meta,path=parts[i].decode(),parts[i+1].decode()
   mm=re.fullmatch(r":([0-7]{6}) ([0-7]{6}) ([0-9a-f]{40}) ([0-9a-f]{40}) ([A-Z])",meta)
   assert mm,(c,p,meta,path)
   om,nm,oh,nh,st=mm.groups();old,new=blob(oh),blob(nh)
   assert (old is None)==(om=="000000") and (new is None)==(nm=="000000")
   assert at(p,path)==old and at(c,path)==new
   if c==MAIN:
    assert path not in (README,) and not path.startswith(S)
    rule="upstream_content"
   elif len(ps)==2 and pi==0:
    assert c=="f9460639ab0b5e2cd7b05f4f109db13a51b64f01" and ps[1]==MAIN
    assert path not in (README,) and not path.startswith(S)
    if path==MAN:rule=manifest(old,new,c,True)
    else:
     assert new==at(MAIN,path)
     rule="equals_main"
   elif len(ps)==2 and pi==1:
    assert path==README or path.startswith(S) or path==MAN
    if path==MAN:rule="task_manifest_retained"
    else:
     assert new==at(ps[0],path)
     rule="equals_task_parent"
   elif path==README:
    assert order(base_readme,new)
    rule="base_lines_preserved"
   elif path==MAN:
    rule=manifest(old,new,c)
   elif path.startswith(S):
    assert st=="A" or (path==S+"02-spec.md" and st=="M"),(c,path,st)
    if path in (S+"03-build.md",S+"04-evidence.md"):
     rule="isolated_blob_identity_only"
    elif st=="M":
     marker={ "200baf82ef92f25d8b10031b52596b1e24fb70a7":"## commander 裁决（第 1 次）","eb96ceb14f76a1572145644d5defc1fec6a49f1b":"## commander 裁决（第 2 次）"}.get(c)
     assert marker and new.startswith(old) and new[len(old):].strip().startswith(marker),(c,path)
     rule="spec_pure_append"
    else:
     assert len(new)>0,(c,path,st)
     rule="new_task_report_content"
   else:
    raise AssertionError(("unattributed",c,path))
   items.append((path,om,nm,oh,nh,len(old) if old else 0,len(new) if new else 0,rule))
  print("EDGE",c,p,"paths",len(items))
  for path,om,nm,oh,nh,osz,nsz,rule in items:
   print("PATH",path,"mode",om,nm,"old",oh,osz,"new",nh,nsz,"hash=ok","content="+rule)
assert order(base_readme,at(H,README))
print("HEAD",H,"commits",len(rows),"README_BASE_ORDER=PASS","ALL_EDGES_BLOBS_CONTENT=PASS")
PY
```
```output
EDGE 178f61849d85be5a9370f23c033e48ae006cfe25 04b88ddba4b1aa23a156d59734b4d88f621fe1e9 paths 1
PATH packages/brain/scripts/coding-workflow/runner/README.md mode 100644 100644 old 6e6eb65f64c55bdad786b619e2e9a4ef66225297 10889 new 3e8eea166d021b985bff0c71e1ccbc87d234d248 13572 hash=ok content=base_lines_preserved
EDGE 42943dfe5fc3f0680291322a5440bcd46159cbeb 178f61849d85be5a9370f23c033e48ae006cfe25 paths 12
PATH .implementation-source-relations.json mode 100644 100644 old b4d00c4f7ea1c087ce0511769e1e25299326cbfd 54286 new 24de93e0438b1c2a800654e7e0407b2949ef5233 56013 hash=ok content=preserved=307 added=11
PATH sprints/10170627-cw-5190fd91/01-intent.md mode 000000 100644 old 0000000000000000000000000000000000000000 0 new 3a1529d7a143b6fdcf1305b9d72480c22c4d3a8c 15486 hash=ok content=new_task_report_content
PATH sprints/10170627-cw-5190fd91/01-invariants.md mode 000000 100644 old 0000000000000000000000000000000000000000 0 new 2276b9f0bca1d5fd3e422ef6e962e1259e266703 89736 hash=ok content=new_task_report_content
PATH sprints/10170627-cw-5190fd91/02-response-r1.md mode 000000 100644 old 0000000000000000000000000000000000000000 0 new f89998664a7a99d3f8bfc0b8b4f0ac0955c8b83a 589 hash=ok content=new_task_report_content
PATH sprints/10170627-cw-5190fd91/02-response-r2.md mode 000000 100644 old 0000000000000000000000000000000000000000 0 new 677402ca401d014befa03669d7b1a1aa04a917b2 1084 hash=ok content=new_task_report_content
PATH sprints/10170627-cw-5190fd91/02-review-r1.md mode 000000 100644 old 0000000000000000000000000000000000000000 0 new 8b068bd99a4c2f5abc189032698f21ad8e267be6 1223 hash=ok content=new_task_report_content
PATH sprints/10170627-cw-5190fd91/02-review-r2.md mode 000000 100644 old 0000000000000000000000000000000000000000 0 new 7c80b836bc8c5469525c21273be83ad0e8dde8fc 1436 hash=ok content=new_task_report_content
PATH sprints/10170627-cw-5190fd91/02-review-r3.md mode 000000 100644 old 0000000000000000000000000000000000000000 0 new e6922e12ac037d6b2ac8839985f3434b9d4f48e5 1113 hash=ok content=new_task_report_content
PATH sprints/10170627-cw-5190fd91/02-review.md mode 000000 100644 old 0000000000000000000000000000000000000000 0 new e6922e12ac037d6b2ac8839985f3434b9d4f48e5 1113 hash=ok content=new_task_report_content
PATH sprints/10170627-cw-5190fd91/02-spec.md mode 000000 100644 old 0000000000000000000000000000000000000000 0 new 9827a68e93e8e7d2b0c21dcb517cb6c6848e2093 18898 hash=ok content=new_task_report_content
PATH sprints/10170627-cw-5190fd91/03-build.md mode 000000 100644 old 0000000000000000000000000000000000000000 0 new 0d96f563734111cfdcd2049a91b8d0973da5adff 5095 hash=ok content=isolated_blob_identity_only
PATH sprints/10170627-cw-5190fd91/04-evidence.md mode 000000 100644 old 0000000000000000000000000000000000000000 0 new 46a81734ed6702902319dcbe09f211bf692b0f88 9894 hash=ok content=isolated_blob_identity_only
EDGE 53cdf746c0c7f446cb7b6987e170d76248999f1d 04b88ddba4b1aa23a156d59734b4d88f621fe1e9 paths 8
PATH .brain-versions mode 100644 100644 old 765a3cb613f52cc52b92c04158a540cbe7fba43d 9 new f3d261425e53f40ece495da8192f24c6040c909d 9 hash=ok content=upstream_content
PATH .implementation-source-relations.json mode 100644 100644 old b4d00c4f7ea1c087ce0511769e1e25299326cbfd 54286 new ffadfb9335a468ec6b871f54fd9a6db08ae9e09d 54140 hash=ok content=upstream_content
PATH DEFINITION.md mode 100644 100644 old c61152020942f82f1de6315cb58dda302a1e92cc 769540 new a4b46caf2f7230368a87796071009b8b35fcc44b 770019 hash=ok content=upstream_content
PATH changes/cp-10170325-ci-budget-headroom.md mode 100644 000000 old 61678453253490efe1e7e647f808ac43965eaac1 479 new 0000000000000000000000000000000000000000 0 hash=ok content=upstream_content
PATH package-lock.json mode 100644 100644 old f6a79a39a78356e1a59b763567ac45af92e79f5b 698744 new aaeb525fdffb110004342b8c6b4f96893d362179 698744 hash=ok content=upstream_content
PATH packages/brain/VERSION mode 100644 100644 old 765a3cb613f52cc52b92c04158a540cbe7fba43d 9 new f3d261425e53f40ece495da8192f24c6040c909d 9 hash=ok content=upstream_content
PATH packages/brain/package-lock.json mode 100644 100644 old bd0894471f6609afd0506fb31cabb315e8a97b25 378833 new ecb84839f8de085394f8aa50dd5f0100b1e99465 378833 hash=ok content=upstream_content
PATH packages/brain/package.json mode 100644 100644 old 5451dac0247ba38ee91ec7441f0ef79426ad37b5 1998 new b6a3c1c890593a7bc828afa573a4ccaff05ab2c0 1998 hash=ok content=upstream_content
EDGE f9460639ab0b5e2cd7b05f4f109db13a51b64f01 42943dfe5fc3f0680291322a5440bcd46159cbeb paths 8
PATH .brain-versions mode 100644 100644 old 765a3cb613f52cc52b92c04158a540cbe7fba43d 9 new f3d261425e53f40ece495da8192f24c6040c909d 9 hash=ok content=equals_main
PATH .implementation-source-relations.json mode 100644 100644 old 24de93e0438b1c2a800654e7e0407b2949ef5233 56013 new c4f2bb176e606551a32bf9a676b77ea69452efc4 55867 hash=ok content=main_history_plus_task_prefix=11
PATH DEFINITION.md mode 100644 100644 old c61152020942f82f1de6315cb58dda302a1e92cc 769540 new a4b46caf2f7230368a87796071009b8b35fcc44b 770019 hash=ok content=equals_main
PATH changes/cp-10170325-ci-budget-headroom.md mode 100644 000000 old 61678453253490efe1e7e647f808ac43965eaac1 479 new 0000000000000000000000000000000000000000 0 hash=ok content=equals_main
PATH package-lock.json mode 100644 100644 old f6a79a39a78356e1a59b763567ac45af92e79f5b 698744 new aaeb525fdffb110004342b8c6b4f96893d362179 698744 hash=ok content=equals_main
PATH packages/brain/VERSION mode 100644 100644 old 765a3cb613f52cc52b92c04158a540cbe7fba43d 9 new f3d261425e53f40ece495da8192f24c6040c909d 9 hash=ok content=equals_main
PATH packages/brain/package-lock.json mode 100644 100644 old bd0894471f6609afd0506fb31cabb315e8a97b25 378833 new ecb84839f8de085394f8aa50dd5f0100b1e99465 378833 hash=ok content=equals_main
PATH packages/brain/package.json mode 100644 100644 old 5451dac0247ba38ee91ec7441f0ef79426ad37b5 1998 new b6a3c1c890593a7bc828afa573a4ccaff05ab2c0 1998 hash=ok content=equals_main
EDGE f9460639ab0b5e2cd7b05f4f109db13a51b64f01 53cdf746c0c7f446cb7b6987e170d76248999f1d paths 13
PATH .implementation-source-relations.json mode 100644 100644 old ffadfb9335a468ec6b871f54fd9a6db08ae9e09d 54140 new c4f2bb176e606551a32bf9a676b77ea69452efc4 55867 hash=ok content=task_manifest_retained
PATH packages/brain/scripts/coding-workflow/runner/README.md mode 100644 100644 old 6e6eb65f64c55bdad786b619e2e9a4ef66225297 10889 new 3e8eea166d021b985bff0c71e1ccbc87d234d248 13572 hash=ok content=equals_task_parent
PATH sprints/10170627-cw-5190fd91/01-intent.md mode 000000 100644 old 0000000000000000000000000000000000000000 0 new 3a1529d7a143b6fdcf1305b9d72480c22c4d3a8c 15486 hash=ok content=equals_task_parent
PATH sprints/10170627-cw-5190fd91/01-invariants.md mode 000000 100644 old 0000000000000000000000000000000000000000 0 new 2276b9f0bca1d5fd3e422ef6e962e1259e266703 89736 hash=ok content=equals_task_parent
PATH sprints/10170627-cw-5190fd91/02-response-r1.md mode 000000 100644 old 0000000000000000000000000000000000000000 0 new f89998664a7a99d3f8bfc0b8b4f0ac0955c8b83a 589 hash=ok content=equals_task_parent
PATH sprints/10170627-cw-5190fd91/02-response-r2.md mode 000000 100644 old 0000000000000000000000000000000000000000 0 new 677402ca401d014befa03669d7b1a1aa04a917b2 1084 hash=ok content=equals_task_parent
PATH sprints/10170627-cw-5190fd91/02-review-r1.md mode 000000 100644 old 0000000000000000000000000000000000000000 0 new 8b068bd99a4c2f5abc189032698f21ad8e267be6 1223 hash=ok content=equals_task_parent
PATH sprints/10170627-cw-5190fd91/02-review-r2.md mode 000000 100644 old 0000000000000000000000000000000000000000 0 new 7c80b836bc8c5469525c21273be83ad0e8dde8fc 1436 hash=ok content=equals_task_parent
PATH sprints/10170627-cw-5190fd91/02-review-r3.md mode 000000 100644 old 0000000000000000000000000000000000000000 0 new e6922e12ac037d6b2ac8839985f3434b9d4f48e5 1113 hash=ok content=equals_task_parent
PATH sprints/10170627-cw-5190fd91/02-review.md mode 000000 100644 old 0000000000000000000000000000000000000000 0 new e6922e12ac037d6b2ac8839985f3434b9d4f48e5 1113 hash=ok content=equals_task_parent
PATH sprints/10170627-cw-5190fd91/02-spec.md mode 000000 100644 old 0000000000000000000000000000000000000000 0 new 9827a68e93e8e7d2b0c21dcb517cb6c6848e2093 18898 hash=ok content=equals_task_parent
PATH sprints/10170627-cw-5190fd91/03-build.md mode 000000 100644 old 0000000000000000000000000000000000000000 0 new 0d96f563734111cfdcd2049a91b8d0973da5adff 5095 hash=ok content=equals_task_parent
PATH sprints/10170627-cw-5190fd91/04-evidence.md mode 000000 100644 old 0000000000000000000000000000000000000000 0 new 46a81734ed6702902319dcbe09f211bf692b0f88 9894 hash=ok content=equals_task_parent
EDGE f3dbd423fab3eddea650ac361d4651f393cfd40f f9460639ab0b5e2cd7b05f4f109db13a51b64f01 paths 2
PATH .implementation-source-relations.json mode 100644 100644 old c4f2bb176e606551a32bf9a676b77ea69452efc4 55867 new f3d532f650f678b481fb7125e80f72231bf50d2e 56028 hash=ok content=preserved=317 added=1
PATH sprints/10170627-cw-5190fd91/05-qa-report-r1.md mode 000000 100644 old 0000000000000000000000000000000000000000 0 new 766cc68f7f0cb7bd81da2711b7eb920992f04c05 19119 hash=ok content=new_task_report_content
Traceback (most recent call last):
  File "<stdin>", line 88, in <module>
TypeError: startswith first arg must be bytes or a tuple of bytes, not str
```
退出码: 1

#### q4audit8

```command
python3 - <<'PY'
import subprocess,json,hashlib,re,sys,difflib
B="04b88ddba4b1aa23a156d59734b4d88f621fe1e9"
H="83e9532d4f68a0da797664b7e8c4b9408988d894"
MAIN="53cdf746c0c7f446cb7b6987e170d76248999f1d"
S="sprints/10170627-cw-5190fd91/"
OWNER="packages/brain/scripts/coding-workflow/runner/run-once.mjs"
README="packages/brain/scripts/coding-workflow/runner/README.md"
MAN=".implementation-source-relations.json"
def g(*a):
 p=subprocess.run(["git",*a],stdout=subprocess.PIPE,stderr=subprocess.PIPE)
 if p.returncode: raise RuntimeError((a,p.stderr.decode()))
 return p.stdout
def blob(h):
 if h=="0"*40:return None
 b=g("cat-file","blob",h)
 size=int(g("cat-file","-s",h))
 digest=hashlib.sha1(b"blob "+str(len(b)).encode()+b"\0"+b).hexdigest()
 assert len(b)==size and digest==h,(h,size,len(b),digest)
 return b
def at(c,p):
 q=subprocess.run(["git","show",c+":"+p],stdout=subprocess.PIPE,stderr=subprocess.PIPE)
 return q.stdout if q.returncode==0 else None
def order(old,new):
 a=old.splitlines(keepends=True);b=new.splitlines(keepends=True);i=0
 for x in b:
  if i<len(a) and x==a[i]:i+=1
 return i==len(a)
def manifest(a,b,c,merge=False):
 old=json.loads(a);new=json.loads(b)
 assert old.keys()==new.keys() and all(old[k]==new[k] for k in old if k!="relations")
 x=old["relations"];y=new["relations"]
 if merge:
  main=json.loads(at(MAIN,MAN))["relations"]
  task=[z for z in x if z["path"].startswith(S)]
  assert y==task+main,("merge manifest",len(y),len(task),len(main))
  return "main_history_plus_task_prefix="+str(len(task))
 assert y[-len(x):]==x if x else True
 add=y[:len(y)-len(x)]
 for z in add:
  p=z["path"]
  assert set(z)=={"owner_path","path","role"} and z["owner_path"]==OWNER and z["role"]=="documentation" and p.startswith(S) and re.fullmatch(r"(?:01-(?:intent|invariants)|02-(?:spec|review|review-r[1-9][0-9]*|response-r[1-9][0-9]*)|03-build|04-evidence|05-qa-report-r[1-9][0-9]*|06-judge-r[1-9][0-9]*|07-commander-r[1-9][0-9]*)\.md",p[len(S):]),z
  assert at(c,p) is not None,p
 assert len({z["path"] for z in y})==len(y)
 return "preserved="+str(len(x))+" added="+str(len(add))
rows=g("rev-list","--reverse","--topo-order","--parents",B+".."+H).decode().splitlines()
assert len(rows)==16 and rows[-1].split()[0]==H
assert g("rev-list","--parents","-n","1",MAIN).decode().split()[1:]==[B]
base_readme=at(B,README);assert base_readme
for row in rows:
 c,*ps=row.split()
 for pi,p in enumerate(ps):
  raw=g("diff-tree","--no-commit-id","--raw","--no-abbrev","--no-renames","-r","-z",p,c)
  parts=raw.split(b"\0");items=[]
  for i in range(0,len(parts)-1,2):
   meta,path=parts[i].decode(),parts[i+1].decode()
   mm=re.fullmatch(r":([0-7]{6}) ([0-7]{6}) ([0-9a-f]{40}) ([0-9a-f]{40}) ([A-Z])",meta)
   assert mm,(c,p,meta,path)
   om,nm,oh,nh,st=mm.groups();old,new=blob(oh),blob(nh)
   assert (old is None)==(om=="000000") and (new is None)==(nm=="000000")
   assert at(p,path)==old and at(c,path)==new
   if c==MAIN:
    assert path not in (README,) and not path.startswith(S)
    rule="upstream_content"
   elif len(ps)==2 and pi==0:
    assert c=="f9460639ab0b5e2cd7b05f4f109db13a51b64f01" and ps[1]==MAIN
    assert path not in (README,) and not path.startswith(S)
    if path==MAN:rule=manifest(old,new,c,True)
    else:
     assert new==at(MAIN,path)
     rule="equals_main"
   elif len(ps)==2 and pi==1:
    assert path==README or path.startswith(S) or path==MAN
    if path==MAN:rule="task_manifest_retained"
    else:
     assert new==at(ps[0],path)
     rule="equals_task_parent"
   elif path==README:
    assert order(base_readme,new)
    rule="base_lines_preserved"
   elif path==MAN:
    rule=manifest(old,new,c)
   elif path.startswith(S):
    assert st=="A" or (path==S+"02-spec.md" and st=="M"),(c,path,st)
    if path in (S+"03-build.md",S+"04-evidence.md"):
     rule="isolated_blob_identity_only"
    elif st=="M":
     marker={ "200baf82ef92f25d8b10031b52596b1e24fb70a7":"## commander 裁决（第 1 次）","eb96ceb14f76a1572145644d5defc1fec6a49f1b":"## commander 裁决（第 2 次）"}.get(c)
     assert marker and new.startswith(old) and new[len(old):].strip().startswith(marker.encode()),(c,path)
     rule="spec_pure_append"
    else:
     assert len(new)>0,(c,path,st)
     rule="new_task_report_content"
   else:
    raise AssertionError(("unattributed",c,path))
   items.append((path,om,nm,oh,nh,len(old) if old else 0,len(new) if new else 0,rule))
  print("EDGE",c,p,"paths",len(items))
  for path,om,nm,oh,nh,osz,nsz,rule in items:
   print("PATH",path,"mode",om,nm,"old",oh,osz,"new",nh,nsz,"hash=ok","content="+rule)
assert order(base_readme,at(H,README))
print("HEAD",H,"commits",len(rows),"README_BASE_ORDER=PASS","ALL_EDGES_BLOBS_CONTENT=PASS")
PY
```
```output
EDGE 178f61849d85be5a9370f23c033e48ae006cfe25 04b88ddba4b1aa23a156d59734b4d88f621fe1e9 paths 1
PATH packages/brain/scripts/coding-workflow/runner/README.md mode 100644 100644 old 6e6eb65f64c55bdad786b619e2e9a4ef66225297 10889 new 3e8eea166d021b985bff0c71e1ccbc87d234d248 13572 hash=ok content=base_lines_preserved
EDGE 42943dfe5fc3f0680291322a5440bcd46159cbeb 178f61849d85be5a9370f23c033e48ae006cfe25 paths 12
PATH .implementation-source-relations.json mode 100644 100644 old b4d00c4f7ea1c087ce0511769e1e25299326cbfd 54286 new 24de93e0438b1c2a800654e7e0407b2949ef5233 56013 hash=ok content=preserved=307 added=11
PATH sprints/10170627-cw-5190fd91/01-intent.md mode 000000 100644 old 0000000000000000000000000000000000000000 0 new 3a1529d7a143b6fdcf1305b9d72480c22c4d3a8c 15486 hash=ok content=new_task_report_content
PATH sprints/10170627-cw-5190fd91/01-invariants.md mode 000000 100644 old 0000000000000000000000000000000000000000 0 new 2276b9f0bca1d5fd3e422ef6e962e1259e266703 89736 hash=ok content=new_task_report_content
PATH sprints/10170627-cw-5190fd91/02-response-r1.md mode 000000 100644 old 0000000000000000000000000000000000000000 0 new f89998664a7a99d3f8bfc0b8b4f0ac0955c8b83a 589 hash=ok content=new_task_report_content
PATH sprints/10170627-cw-5190fd91/02-response-r2.md mode 000000 100644 old 0000000000000000000000000000000000000000 0 new 677402ca401d014befa03669d7b1a1aa04a917b2 1084 hash=ok content=new_task_report_content
PATH sprints/10170627-cw-5190fd91/02-review-r1.md mode 000000 100644 old 0000000000000000000000000000000000000000 0 new 8b068bd99a4c2f5abc189032698f21ad8e267be6 1223 hash=ok content=new_task_report_content
PATH sprints/10170627-cw-5190fd91/02-review-r2.md mode 000000 100644 old 0000000000000000000000000000000000000000 0 new 7c80b836bc8c5469525c21273be83ad0e8dde8fc 1436 hash=ok content=new_task_report_content
PATH sprints/10170627-cw-5190fd91/02-review-r3.md mode 000000 100644 old 0000000000000000000000000000000000000000 0 new e6922e12ac037d6b2ac8839985f3434b9d4f48e5 1113 hash=ok content=new_task_report_content
PATH sprints/10170627-cw-5190fd91/02-review.md mode 000000 100644 old 0000000000000000000000000000000000000000 0 new e6922e12ac037d6b2ac8839985f3434b9d4f48e5 1113 hash=ok content=new_task_report_content
PATH sprints/10170627-cw-5190fd91/02-spec.md mode 000000 100644 old 0000000000000000000000000000000000000000 0 new 9827a68e93e8e7d2b0c21dcb517cb6c6848e2093 18898 hash=ok content=new_task_report_content
PATH sprints/10170627-cw-5190fd91/03-build.md mode 000000 100644 old 0000000000000000000000000000000000000000 0 new 0d96f563734111cfdcd2049a91b8d0973da5adff 5095 hash=ok content=isolated_blob_identity_only
PATH sprints/10170627-cw-5190fd91/04-evidence.md mode 000000 100644 old 0000000000000000000000000000000000000000 0 new 46a81734ed6702902319dcbe09f211bf692b0f88 9894 hash=ok content=isolated_blob_identity_only
EDGE 53cdf746c0c7f446cb7b6987e170d76248999f1d 04b88ddba4b1aa23a156d59734b4d88f621fe1e9 paths 8
PATH .brain-versions mode 100644 100644 old 765a3cb613f52cc52b92c04158a540cbe7fba43d 9 new f3d261425e53f40ece495da8192f24c6040c909d 9 hash=ok content=upstream_content
PATH .implementation-source-relations.json mode 100644 100644 old b4d00c4f7ea1c087ce0511769e1e25299326cbfd 54286 new ffadfb9335a468ec6b871f54fd9a6db08ae9e09d 54140 hash=ok content=upstream_content
PATH DEFINITION.md mode 100644 100644 old c61152020942f82f1de6315cb58dda302a1e92cc 769540 new a4b46caf2f7230368a87796071009b8b35fcc44b 770019 hash=ok content=upstream_content
PATH changes/cp-10170325-ci-budget-headroom.md mode 100644 000000 old 61678453253490efe1e7e647f808ac43965eaac1 479 new 0000000000000000000000000000000000000000 0 hash=ok content=upstream_content
PATH package-lock.json mode 100644 100644 old f6a79a39a78356e1a59b763567ac45af92e79f5b 698744 new aaeb525fdffb110004342b8c6b4f96893d362179 698744 hash=ok content=upstream_content
PATH packages/brain/VERSION mode 100644 100644 old 765a3cb613f52cc52b92c04158a540cbe7fba43d 9 new f3d261425e53f40ece495da8192f24c6040c909d 9 hash=ok content=upstream_content
PATH packages/brain/package-lock.json mode 100644 100644 old bd0894471f6609afd0506fb31cabb315e8a97b25 378833 new ecb84839f8de085394f8aa50dd5f0100b1e99465 378833 hash=ok content=upstream_content
PATH packages/brain/package.json mode 100644 100644 old 5451dac0247ba38ee91ec7441f0ef79426ad37b5 1998 new b6a3c1c890593a7bc828afa573a4ccaff05ab2c0 1998 hash=ok content=upstream_content
EDGE f9460639ab0b5e2cd7b05f4f109db13a51b64f01 42943dfe5fc3f0680291322a5440bcd46159cbeb paths 8
PATH .brain-versions mode 100644 100644 old 765a3cb613f52cc52b92c04158a540cbe7fba43d 9 new f3d261425e53f40ece495da8192f24c6040c909d 9 hash=ok content=equals_main
PATH .implementation-source-relations.json mode 100644 100644 old 24de93e0438b1c2a800654e7e0407b2949ef5233 56013 new c4f2bb176e606551a32bf9a676b77ea69452efc4 55867 hash=ok content=main_history_plus_task_prefix=11
PATH DEFINITION.md mode 100644 100644 old c61152020942f82f1de6315cb58dda302a1e92cc 769540 new a4b46caf2f7230368a87796071009b8b35fcc44b 770019 hash=ok content=equals_main
PATH changes/cp-10170325-ci-budget-headroom.md mode 100644 000000 old 61678453253490efe1e7e647f808ac43965eaac1 479 new 0000000000000000000000000000000000000000 0 hash=ok content=equals_main
PATH package-lock.json mode 100644 100644 old f6a79a39a78356e1a59b763567ac45af92e79f5b 698744 new aaeb525fdffb110004342b8c6b4f96893d362179 698744 hash=ok content=equals_main
PATH packages/brain/VERSION mode 100644 100644 old 765a3cb613f52cc52b92c04158a540cbe7fba43d 9 new f3d261425e53f40ece495da8192f24c6040c909d 9 hash=ok content=equals_main
PATH packages/brain/package-lock.json mode 100644 100644 old bd0894471f6609afd0506fb31cabb315e8a97b25 378833 new ecb84839f8de085394f8aa50dd5f0100b1e99465 378833 hash=ok content=equals_main
PATH packages/brain/package.json mode 100644 100644 old 5451dac0247ba38ee91ec7441f0ef79426ad37b5 1998 new b6a3c1c890593a7bc828afa573a4ccaff05ab2c0 1998 hash=ok content=equals_main
EDGE f9460639ab0b5e2cd7b05f4f109db13a51b64f01 53cdf746c0c7f446cb7b6987e170d76248999f1d paths 13
PATH .implementation-source-relations.json mode 100644 100644 old ffadfb9335a468ec6b871f54fd9a6db08ae9e09d 54140 new c4f2bb176e606551a32bf9a676b77ea69452efc4 55867 hash=ok content=task_manifest_retained
PATH packages/brain/scripts/coding-workflow/runner/README.md mode 100644 100644 old 6e6eb65f64c55bdad786b619e2e9a4ef66225297 10889 new 3e8eea166d021b985bff0c71e1ccbc87d234d248 13572 hash=ok content=equals_task_parent
PATH sprints/10170627-cw-5190fd91/01-intent.md mode 000000 100644 old 0000000000000000000000000000000000000000 0 new 3a1529d7a143b6fdcf1305b9d72480c22c4d3a8c 15486 hash=ok content=equals_task_parent
PATH sprints/10170627-cw-5190fd91/01-invariants.md mode 000000 100644 old 0000000000000000000000000000000000000000 0 new 2276b9f0bca1d5fd3e422ef6e962e1259e266703 89736 hash=ok content=equals_task_parent
PATH sprints/10170627-cw-5190fd91/02-response-r1.md mode 000000 100644 old 0000000000000000000000000000000000000000 0 new f89998664a7a99d3f8bfc0b8b4f0ac0955c8b83a 589 hash=ok content=equals_task_parent
PATH sprints/10170627-cw-5190fd91/02-response-r2.md mode 000000 100644 old 0000000000000000000000000000000000000000 0 new 677402ca401d014befa03669d7b1a1aa04a917b2 1084 hash=ok content=equals_task_parent
PATH sprints/10170627-cw-5190fd91/02-review-r1.md mode 000000 100644 old 0000000000000000000000000000000000000000 0 new 8b068bd99a4c2f5abc189032698f21ad8e267be6 1223 hash=ok content=equals_task_parent
PATH sprints/10170627-cw-5190fd91/02-review-r2.md mode 000000 100644 old 0000000000000000000000000000000000000000 0 new 7c80b836bc8c5469525c21273be83ad0e8dde8fc 1436 hash=ok content=equals_task_parent
PATH sprints/10170627-cw-5190fd91/02-review-r3.md mode 000000 100644 old 0000000000000000000000000000000000000000 0 new e6922e12ac037d6b2ac8839985f3434b9d4f48e5 1113 hash=ok content=equals_task_parent
PATH sprints/10170627-cw-5190fd91/02-review.md mode 000000 100644 old 0000000000000000000000000000000000000000 0 new e6922e12ac037d6b2ac8839985f3434b9d4f48e5 1113 hash=ok content=equals_task_parent
PATH sprints/10170627-cw-5190fd91/02-spec.md mode 000000 100644 old 0000000000000000000000000000000000000000 0 new 9827a68e93e8e7d2b0c21dcb517cb6c6848e2093 18898 hash=ok content=equals_task_parent
PATH sprints/10170627-cw-5190fd91/03-build.md mode 000000 100644 old 0000000000000000000000000000000000000000 0 new 0d96f563734111cfdcd2049a91b8d0973da5adff 5095 hash=ok content=equals_task_parent
PATH sprints/10170627-cw-5190fd91/04-evidence.md mode 000000 100644 old 0000000000000000000000000000000000000000 0 new 46a81734ed6702902319dcbe09f211bf692b0f88 9894 hash=ok content=equals_task_parent
EDGE f3dbd423fab3eddea650ac361d4651f393cfd40f f9460639ab0b5e2cd7b05f4f109db13a51b64f01 paths 2
PATH .implementation-source-relations.json mode 100644 100644 old c4f2bb176e606551a32bf9a676b77ea69452efc4 55867 new f3d532f650f678b481fb7125e80f72231bf50d2e 56028 hash=ok content=preserved=317 added=1
PATH sprints/10170627-cw-5190fd91/05-qa-report-r1.md mode 000000 100644 old 0000000000000000000000000000000000000000 0 new 766cc68f7f0cb7bd81da2711b7eb920992f04c05 19119 hash=ok content=new_task_report_content
EDGE 200baf82ef92f25d8b10031b52596b1e24fb70a7 f3dbd423fab3eddea650ac361d4651f393cfd40f paths 1
PATH sprints/10170627-cw-5190fd91/02-spec.md mode 100644 100644 old 9827a68e93e8e7d2b0c21dcb517cb6c6848e2093 18898 new 51450ee5ebc6651ffd41d88a24e283dafa5ca9ae 21682 hash=ok content=spec_pure_append
EDGE ea0573f2d1e2a95f5cb7727a70c581d325b1fd21 200baf82ef92f25d8b10031b52596b1e24fb70a7 paths 2
PATH .implementation-source-relations.json mode 100644 100644 old f3d532f650f678b481fb7125e80f72231bf50d2e 56028 new f0d372e0cb26eb55d12f9def947b73c081b8f963 56189 hash=ok content=preserved=318 added=1
PATH sprints/10170627-cw-5190fd91/07-commander-r1.md mode 000000 100644 old 0000000000000000000000000000000000000000 0 new fc178a6a802a0410e83cdf2c9c03233f8206bb1c 876 hash=ok content=new_task_report_content
EDGE 8fa7a1c035bd76335c99fe71ed7450d5832b49e8 ea0573f2d1e2a95f5cb7727a70c581d325b1fd21 paths 3
PATH .implementation-source-relations.json mode 100644 100644 old f0d372e0cb26eb55d12f9def947b73c081b8f963 56189 new eab6aa5c1fbf307fe497d8450d3b9837ecb6977b 56507 hash=ok content=preserved=319 added=2
PATH sprints/10170627-cw-5190fd91/05-qa-report-r2.md mode 000000 100644 old 0000000000000000000000000000000000000000 0 new 05e0b0b9c9bb8608cbceed644e7c8b9e8243aeee 49562 hash=ok content=new_task_report_content
PATH sprints/10170627-cw-5190fd91/06-judge-r2.md mode 000000 100644 old 0000000000000000000000000000000000000000 0 new 51c02fb04eab523db35539b6572f2fd7d5a87fc4 2629 hash=ok content=new_task_report_content
EDGE a36edb98dcf000ff653236e7674cac6117e30652 8fa7a1c035bd76335c99fe71ed7450d5832b49e8 paths 3
PATH .implementation-source-relations.json mode 100644 100644 old eab6aa5c1fbf307fe497d8450d3b9837ecb6977b 56507 new 4d1cf2084a034d37f44b2893f054eada20711b7b 56825 hash=ok content=preserved=321 added=2
PATH sprints/10170627-cw-5190fd91/05-qa-report-r3.md mode 000000 100644 old 0000000000000000000000000000000000000000 0 new 80d07eb72ebecb771c35ecc1222d36943b5ee8cf 31961 hash=ok content=new_task_report_content
PATH sprints/10170627-cw-5190fd91/06-judge-r3.md mode 000000 100644 old 0000000000000000000000000000000000000000 0 new 19cf8a90460a19162ad5658eed7a52afbca7b245 2604 hash=ok content=new_task_report_content
EDGE eb96ceb14f76a1572145644d5defc1fec6a49f1b a36edb98dcf000ff653236e7674cac6117e30652 paths 1
PATH sprints/10170627-cw-5190fd91/02-spec.md mode 100644 100644 old 51450ee5ebc6651ffd41d88a24e283dafa5ca9ae 21682 new ac6a959af50bb4cc8c451ec9a63fb8b40249f55a 24118 hash=ok content=spec_pure_append
EDGE 6e0b4202c1b659de1bf99ad62d42c73d09dca6bc eb96ceb14f76a1572145644d5defc1fec6a49f1b paths 2
PATH .implementation-source-relations.json mode 100644 100644 old 4d1cf2084a034d37f44b2893f054eada20711b7b 56825 new c310edb1cf5a2cec343b63b1f6880d644b14bb9e 56986 hash=ok content=preserved=323 added=1
PATH sprints/10170627-cw-5190fd91/07-commander-r2.md mode 000000 100644 old 0000000000000000000000000000000000000000 0 new 8557e2041e46ac98747c39b971362faa73c01476 814 hash=ok content=new_task_report_content
EDGE 6f6b6af1ad459f88536235f94a8f585fdead34d5 6e0b4202c1b659de1bf99ad62d42c73d09dca6bc paths 3
PATH .implementation-source-relations.json mode 100644 100644 old c310edb1cf5a2cec343b63b1f6880d644b14bb9e 56986 new 7959d010b9929becc96b6ec4f49a09794436f986 57304 hash=ok content=preserved=324 added=2
PATH sprints/10170627-cw-5190fd91/05-qa-report-r4.md mode 000000 100644 old 0000000000000000000000000000000000000000 0 new 87fb6a1d598e87fe04037c492ba89bd0d9e4b673 30876 hash=ok content=new_task_report_content
PATH sprints/10170627-cw-5190fd91/06-judge-r4.md mode 000000 100644 old 0000000000000000000000000000000000000000 0 new d160e5c15e7d84936779f0130ee8d5ee714589f2 3147 hash=ok content=new_task_report_content
EDGE acc49fa52b4ed059df42560a54663e6f34ad7ff7 6f6b6af1ad459f88536235f94a8f585fdead34d5 paths 3
PATH .implementation-source-relations.json mode 100644 100644 old 7959d010b9929becc96b6ec4f49a09794436f986 57304 new 12c7a90aa088564674dff14f80493b660bafdecf 57622 hash=ok content=preserved=326 added=2
PATH sprints/10170627-cw-5190fd91/05-qa-report-r5.md mode 000000 100644 old 0000000000000000000000000000000000000000 0 new 688569245080675321cd6e221576d446e4891a09 16278 hash=ok content=new_task_report_content
PATH sprints/10170627-cw-5190fd91/06-judge-r5.md mode 000000 100644 old 0000000000000000000000000000000000000000 0 new 2d9eb07b649746b2c46b592c9fb994d89afec79c 3122 hash=ok content=new_task_report_content
EDGE 15c90a4a0021a40170e46aeacf6fddc91d563cf0 acc49fa52b4ed059df42560a54663e6f34ad7ff7 paths 3
PATH .implementation-source-relations.json mode 100644 100644 old 12c7a90aa088564674dff14f80493b660bafdecf 57622 new c41636011cd352bf88b75b263900869615f54545 57940 hash=ok content=preserved=328 added=2
PATH sprints/10170627-cw-5190fd91/05-qa-report-r6.md mode 000000 100644 old 0000000000000000000000000000000000000000 0 new 06675ebe45a8fe0bb2df689097c7f7e08df2962b 19071 hash=ok content=new_task_report_content
PATH sprints/10170627-cw-5190fd91/06-judge-r6.md mode 000000 100644 old 0000000000000000000000000000000000000000 0 new 6d491ef52f7145dd367f863ab358b06e6458cbd9 2777 hash=ok content=new_task_report_content
EDGE 52e2106ed03b255f18fa834ff33cf1315944e307 15c90a4a0021a40170e46aeacf6fddc91d563cf0 paths 3
PATH .implementation-source-relations.json mode 100644 100644 old c41636011cd352bf88b75b263900869615f54545 57940 new 1e5b7a23fe5fc8ddc638cd35fcd97681ebbd6773 58258 hash=ok content=preserved=330 added=2
PATH sprints/10170627-cw-5190fd91/05-qa-report-r7.md mode 000000 100644 old 0000000000000000000000000000000000000000 0 new 041d7d6d327c5d54c55f9d18aaa58bb0df1b3f1f 11400 hash=ok content=new_task_report_content
PATH sprints/10170627-cw-5190fd91/06-judge-r7.md mode 000000 100644 old 0000000000000000000000000000000000000000 0 new c2060875f9c27303aa8843a0e7f26ec70af900c2 3555 hash=ok content=new_task_report_content
EDGE 83e9532d4f68a0da797664b7e8c4b9408988d894 52e2106ed03b255f18fa834ff33cf1315944e307 paths 3
PATH .implementation-source-relations.json mode 100644 100644 old 1e5b7a23fe5fc8ddc638cd35fcd97681ebbd6773 58258 new d1f7ac6374e0ecba3e356de7775de5117eadb496 58576 hash=ok content=preserved=332 added=2
PATH sprints/10170627-cw-5190fd91/05-qa-report-r8.md mode 000000 100644 old 0000000000000000000000000000000000000000 0 new addc857f7c2b240942075415b9808d598ed6426f 29257 hash=ok content=new_task_report_content
PATH sprints/10170627-cw-5190fd91/06-judge-r8.md mode 000000 100644 old 0000000000000000000000000000000000000000 0 new b6d7969319acd43ce65e13921740445f10332304 2716 hash=ok content=new_task_report_content
HEAD 83e9532d4f68a0da797664b7e8c4b9408988d894 commits 16 README_BASE_ORDER=PASS ALL_EDGES_BLOBS_CONTENT=PASS
```
退出码: 0

#### 前期范围调查 1

```command
git diff --name-status 04b88ddba4b1aa23a156d59734b4d88f621fe1e9 HEAD
```
```output
M	.brain-versions
M	.implementation-source-relations.json
M	DEFINITION.md
D	changes/cp-10170325-ci-budget-headroom.md
M	package-lock.json
M	packages/brain/VERSION
M	packages/brain/package-lock.json
M	packages/brain/package.json
M	packages/brain/scripts/coding-workflow/runner/README.md
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
A	sprints/10170627-cw-5190fd91/06-judge-r2.md
A	sprints/10170627-cw-5190fd91/06-judge-r3.md
A	sprints/10170627-cw-5190fd91/06-judge-r4.md
A	sprints/10170627-cw-5190fd91/06-judge-r5.md
A	sprints/10170627-cw-5190fd91/06-judge-r6.md
A	sprints/10170627-cw-5190fd91/06-judge-r7.md
A	sprints/10170627-cw-5190fd91/06-judge-r8.md
A	sprints/10170627-cw-5190fd91/07-commander-r1.md
A	sprints/10170627-cw-5190fd91/07-commander-r2.md
```
退出码: 0

#### 前期范围调查 2

```command
git diff --cached --name-status
```
```output

```
退出码: 0

#### 前期范围调查 3

```command
git diff --name-status
```
```output
D	sprints/10170627-cw-5190fd91/03-build.md
D	sprints/10170627-cw-5190fd91/04-evidence.md
```
退出码: 0

#### 前期范围调查 4

```command
git ls-files --others --exclude-standard
```
```output

```
退出码: 0

#### 前期范围调查 5

```command
git show HEAD:.implementation-source-relations.json | head -c 1000
```
```output
{
  "schema_version": 1,
  "repo": "perfectuser21/cecelia",
  "relations": [
    {"owner_path":"packages/brain/scripts/coding-workflow/runner/run-once.mjs","path":"sprints/10170627-cw-5190fd91/05-qa-report-r8.md","role":"documentation"},
    {"owner_path":"packages/brain/scripts/coding-workflow/runner/run-once.mjs","path":"sprints/10170627-cw-5190fd91/06-judge-r8.md","role":"documentation"},
    {"owner_path":"packages/brain/scripts/coding-workflow/runner/run-once.mjs","path":"sprints/10170627-cw-5190fd91/05-qa-report-r7.md","role":"documentation"},
    {"owner_path":"packages/brain/scripts/coding-workflow/runner/run-once.mjs","path":"sprints/10170627-cw-5190fd91/06-judge-r7.md","role":"documentation"},
    {"owner_path":"packages/brain/scripts/coding-workflow/runner/run-once.mjs","path":"sprints/10170627-cw-5190fd91/05-qa-report-r6.md","role":"documentation"},
    {"owner_path":"packages/brain/scripts/coding-workflow/runner/run-once.mjs","path":"sprints/10170627-cw-5190fd91/06-judge-r
```
退出码: 0

#### 前期范围调查 6

```command
git show --format= --name-status 53cdf746c0c7f446cb7b6987e170d76248999f1d
```
```output
M	.brain-versions
M	.implementation-source-relations.json
M	DEFINITION.md
D	changes/cp-10170325-ci-budget-headroom.md
M	package-lock.json
M	packages/brain/VERSION
M	packages/brain/package-lock.json
M	packages/brain/package.json
```
退出码: 0

### X-1
对应: Q-2
场景: 用户目录同时含截断 JSON 与合法但无回执形状的 JSON；CLI 没有崩溃，分别标为 unreadable。
verdict: PASS

```command
node -e 'const fs=require("fs"),os=require("os"),path=require("path"),cp=require("child_process"),assert=require("assert");const d=fs.mkdtempSync(path.join(os.tmpdir(),"qa-r9-x1-"));try{fs.writeFileSync(path.join(d,"broken.json"),"{");fs.writeFileSync(path.join(d,"unknown.json"),"{}");const s=cp.execFileSync(process.execPath,["packages/brain/scripts/coding-workflow/runner/status.mjs","--log-dir",d,"--json"],{encoding:"utf8"}).trim();const r=JSON.parse(s);assert.deepEqual(r.map(x=>[x.task_id,x.status]).sort(),[["broken","unreadable"],["unknown","unreadable"]]);console.log(s);console.log("exit=0")}finally{fs.rmSync(d,{recursive:true,force:true})}'
```
```output
[{"task_id":"unknown","mtime":"2026-10-17T05:54:51.055Z","status":"unreadable","failed_activity":null,"reason_code":null,"pr_url":null,"ci_fix":null},{"task_id":"broken","mtime":"2026-10-17T05:54:51.055Z","status":"unreadable","failed_activity":null,"reason_code":null,"pr_url":null,"ci_fix":null}]
exit=0
```
退出码: 0
